'use strict';
//
// Host routes: one request in, one answer out, with every limit enforced here
// in the main process rather than trusted to the mod's page.
//
// Two callers reach this: the friend gateway (sharing/gateway.js, a friend's
// browser on /_friend/mod/<mod>/...) and the host's own game window over IPC
// (main.js, `mod_host_request`). Neither talks to a mod directly. This asks
// `resolve(name)` whether the mod is installed, switched on and consented to,
// and hands the request to a runner made by `transport(declaration)` -- in the
// app, sandbox.js's hidden window; in the tests, a fake.
//
// What the handler gets and may return is in docs/MODDING.md ("Host routes").
//
const LIMITS = Object.freeze({
	requestBytes: 200 * 1024,
	responseBytes: 1024 * 1024,
	timeout: 30000,
	concurrency: 4,
	perMinute: 60,
	logPerMinute: 30,
});
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const TYPE = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(\s*;\s*[A-Za-z0-9_-]+=("[^"\r\n]*"|[A-Za-z0-9_.+-]+))*$/;

const answer = (status, error) => ({ status, type: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify({ error })) });

// What reaches the handler, and nothing more. The gateway has already applied
// the same rules to a friend's request; the host's own page arrives over IPC
// as whatever its JavaScript sent, so they are applied again here.
function normalizeRequest(input, from, limits = LIMITS) {
	if (!input || typeof input !== 'object') return null;
	const method = String(input.method || 'GET').toUpperCase();
	if (!METHODS.has(method)) return null;
	const path = input.path === undefined || input.path === '' ? '/' : input.path;
	if (typeof path !== 'string' || !path.startsWith('/') || path.length > 1024 || /[\x00-\x1f\x7f\\?#]/.test(path)) return null;
	const query = input.query === undefined ? '' : input.query;
	if (typeof query !== 'string' || query.length > 2048 || /[\x00-\x1f\x7f#]/.test(query)) return null;
	const headers = {};
	for (const name of ['content-type', 'accept']) {
		const value = input.headers && input.headers[name];
		if (value === undefined || value === null || value === '') continue;
		if (typeof value !== 'string' || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) return null;
		headers[name] = value;
	}
	let body = input.body === undefined ? null : input.body;
	if (body !== null && typeof body !== 'string') return null;
	if (method === 'GET' && body) return null;
	return { method, path, query, headers, body, from };
}

// The handler's answer, checked: a status, a content type safe to put in a
// header, and a body that fits. Throws on anything else (the caller turns that
// into a 502 and logs why).
function normalizeResponse(raw, limits = LIMITS) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('the handler must return { status, type, body }');
	const status = raw.status === undefined ? 200 : raw.status;
	// 1xx would be read by the friend's browser as an interim reply to a
	// request that never finishes, so the floor is 200.
	if (!Number.isInteger(status) || status < 200 || status > 599) throw new Error(`status ${String(status).slice(0, 20)} is not 200-599`);
	let body = raw.body === undefined || raw.body === null ? '' : raw.body;
	let type = raw.type;
	if (typeof body === 'object') {
		body = JSON.stringify(body);
		if (type === undefined) type = 'application/json; charset=utf-8';
	} else if (typeof body !== 'string') throw new Error('body must be a string or a JSON-able object');
	if (type === undefined) type = 'text/plain; charset=utf-8';
	if (typeof type !== 'string' || type.length > 200 || !TYPE.test(type)) throw new Error('type must be a content type like "application/json"');
	const bytes = Buffer.from(body, 'utf8');
	if (bytes.length > limits.responseBytes) throw new Error(`the response is ${bytes.length} bytes; the limit is ${limits.responseBytes}`);
	return { status, type, body: bytes };
}

// Two declarations run the same code against the same allow-list.
const sameDeclaration = (a, b) => a.root === b.root && a.entry === b.entry && JSON.stringify(a.connect) === JSON.stringify(b.connect);

class ModHostManager {
	// resolve(name)      -> declaration ({ name, root, entry, connect }) of an
	//                       installed, switched-on, consented mod, or null
	// transport(decl)    -> runner (or a promise of one):
	//                       { call(request) -> Promise<raw response>,
	//                         alive() -> boolean, destroy() }
	constructor({ resolve, transport, log = () => {}, now = Date.now, limits = {} }) {
		Object.assign(this, { resolve, transport, log, now });
		this.limits = { ...LIMITS, ...limits };
		this.runners = new Map(); // name -> { decl, ready: Promise<runner>, active }
		this.rates = new Map();   // client -> recent request times
		this.logs = new Map();    // name -> recent log line times
	}
	// Per caller: each friend's invitation session, and the host as one.
	allow(client) {
		const since = this.now() - 60000;
		const recent = (this.rates.get(client) || []).filter(time => time > since);
		if (recent.length >= this.limits.perMinute) { this.rates.set(client, recent); return false; }
		recent.push(this.now()); this.rates.set(client, recent);
		// Forget callers who have gone quiet, so this cannot grow without end.
		if (this.rates.size > 256) for (const [key, times] of this.rates) if (!times.some(time => time > since)) this.rates.delete(key);
		return true;
	}
	async runnerFor(decl) {
		const current = this.runners.get(decl.name);
		if (current) {
			let runner = null;
			try { runner = await current.ready; } catch { /* failed to start: replaced below */ }
			// A crashed or hung renderer is replaced on the next request rather
			// than restarted in a loop; a changed mod or allow-list likewise.
			if (runner && runner.alive() && sameDeclaration(current.decl, decl) && this.runners.get(decl.name) === current) return current;
			if (this.runners.get(decl.name) === current) this.stop(decl.name);
			else return this.runnerFor(decl);
		}
		const entry = { decl, ready: Promise.resolve().then(() => this.transport(decl)), active: 0 };
		this.runners.set(decl.name, entry);
		entry.ready.catch(() => { if (this.runners.get(decl.name) === entry) this.runners.delete(decl.name); });
		return entry;
	}
	// Always resolves to { status, type, body: Buffer }.
	async request(name, input, { client = 'host', from = 'host' } = {}) {
		const request = normalizeRequest(input, from === 'friend' ? 'friend' : 'host', this.limits);
		if (!request) return answer(400, 'Invalid request');
		if (request.body !== null && Buffer.byteLength(request.body, 'utf8') > this.limits.requestBytes) return answer(413, 'Request too large');
		if (!this.allow(String(client))) return answer(429, 'Too many requests. Try again in a minute.');
		let decl = null;
		try { decl = await this.resolve(name); } catch (error) { this.log(`mod-host ${name}: could not be looked up: ${error.message}`); }
		if (!decl) { this.stop(name); return answer(404, 'Not found'); }
		let entry;
		try { entry = await this.runnerFor(decl); } catch (error) {
			this.log(`mod-host ${name}: could not start: ${error.message}`);
			return answer(502, 'This mod\'s host service is not available.');
		}
		if (entry.active >= this.limits.concurrency) return answer(429, 'This mod is busy. Try again shortly.');
		entry.active++;
		let timer;
		try {
			const runner = await entry.ready;
			const late = Symbol('timeout');
			const raw = await Promise.race([runner.call(request), new Promise(resolve => { timer = setTimeout(() => resolve(late), this.limits.timeout); })]);
			if (raw === late) {
				this.log(`mod-host ${name}: ${request.method} ${request.path} took longer than ${this.limits.timeout / 1000} s`);
				return answer(504, 'This mod\'s host service did not answer in time.');
			}
			return normalizeResponse(raw, this.limits);
		} catch (error) {
			// The details are for the host's log; a friend sees a fixed sentence.
			this.log(`mod-host ${name}: ${request.method} ${request.path} failed: ${String(error && error.message || error).slice(0, 500)}`);
			return answer(502, 'This mod\'s host service failed.');
		} finally {
			clearTimeout(timer);
			entry.active--;
		}
	}
	// host.log() from a handler: into the app log under the mod's name, at a
	// bounded rate, so a handler cannot fill the disk.
	hostLog(name, text) {
		const since = this.now() - 60000;
		const recent = (this.logs.get(name) || []).filter(time => time > since);
		if (recent.length >= this.limits.logPerMinute) { this.logs.set(name, recent); return; }
		recent.push(this.now()); this.logs.set(name, recent);
		this.log(`mod-host ${name}: ${String(text).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ' ').slice(0, 500)}`);
	}
	stop(name) {
		const entry = this.runners.get(name);
		if (!entry) return;
		this.runners.delete(name);
		entry.ready.then(runner => runner.destroy(), () => {});
	}
	stopAll() { for (const name of [...this.runners.keys()]) this.stop(name); }
}

module.exports = { ModHostManager, normalizeRequest, normalizeResponse, LIMITS, METHODS };
