'use strict';
// Host routes (electron/mod-host/, docs/MODDING.md "Host routes"): the
// mod.json declaration, the host's consent, the main-process limits, the
// sandbox's allow-list rules and the client's api.host transport. The
// Electron window itself cannot run under node:test; sandbox.js keeps it thin
// and its pure rules are tested here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateHost, readHost } = require('../electron/mod-host/manifest');
const { createConsentStore } = require('../electron/mod-host/consent');
const { ModHostManager, normalizeResponse } = require('../electron/mod-host/manager');
const { allowedRequest, fileFor, csp, bootScript } = require('../electron/mod-host/sandbox');

function modFolder(t, files = { 'host/index.js': 'export default () => ({})' }) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mod-host-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	for (const [name, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
		fs.writeFileSync(path.join(dir, name), text);
	}
	return dir;
}

test('host.entry must be a module file inside the mod\'s host/ folder', t => {
	const dir = modFolder(t, { 'host/index.js': '', 'host/lib/a.mjs': '', 'client/index.js': '', 'host/readme.txt': '' });
	const ok = validateHost(dir, { entry: 'host/index.js', connect: [] });
	assert.equal(ok.entry, 'index.js');
	assert.equal(ok.root, fs.realpathSync(path.join(dir, 'host')));
	assert.equal(validateHost(dir, { entry: 'host/lib/a.mjs' }).entry, 'lib/a.mjs');
	assert.equal(validateHost(dir, undefined), null, 'no host section is not an error');
	for (const entry of ['../x/host/index.js', 'host/../client/index.js', '/etc/passwd', 'host\\index.js', 'C:/host/index.js',
		'client/index.js', 'index.js', 'host/./index.js', 'host//index.js', 'host/missing.js', 'host/readme.txt', 'host', '', 42, null]) {
		assert.ok(validateHost(dir, { entry }) instanceof Error, `refused ${entry}`);
	}
	for (const bad of [null, [], 'host/index.js', { entry: 'host/index.js', run: 'x' }]) {
		assert.ok(validateHost(dir, bad) instanceof Error, `refused ${JSON.stringify(bad)}`);
	}
});

test('host.entry links that lead out of host/ are refused', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, t => {
	const outside = modFolder(t, { 'secret.js': 'export default () => ({})' });
	const dir = modFolder(t, { 'host/index.js': '', 'client/index.js': '' });
	fs.symlinkSync(path.join(outside, 'secret.js'), path.join(dir, 'host', 'link.js'));
	assert.ok(validateHost(dir, { entry: 'host/link.js' }) instanceof Error);
	const other = modFolder(t, { 'client/index.js': '' });
	fs.symlinkSync(outside, path.join(other, 'host'));
	assert.ok(validateHost(other, { entry: 'host/secret.js' }) instanceof Error, 'host/ itself may not be a link out of the mod');
	// A link that stays inside host/ is fine.
	fs.symlinkSync(path.join(dir, 'host', 'index.js'), path.join(dir, 'host', 'alias.js'));
	assert.equal(validateHost(dir, { entry: 'host/alias.js' }).entry, 'index.js');
});

test('host.connect is a short list of exact http(s) origins that are not the app\'s own ports', t => {
	const dir = modFolder(t);
	const ok = validateHost(dir, { entry: 'host/index.js', connect: ['http://127.0.0.1:8080', 'https://api.example.com', 'http://[::1]:11434'] });
	assert.deepEqual(ok.connect, ['http://127.0.0.1:8080', 'https://api.example.com', 'http://[::1]:11434']);
	const refused = connect => validateHost(dir, { entry: 'host/index.js', connect });
	for (const origin of ['http://127.0.0.1:8080/', 'http://127.0.0.1:8080/v1', 'http://127.0.0.1:8080?x', 'http://user:pw@127.0.0.1:8080',
		'ws://127.0.0.1:8080', 'file:///etc', 'ftp://example.com', 'javascript:alert(1)', 'http://*.example.com', 'HTTP://127.0.0.1:8080',
		'http://example.com:80', '127.0.0.1:8080', '', 7]) {
		assert.ok(refused([origin]) instanceof Error, `refused ${origin}`);
	}
	// The asset, login, char, map, agent and gateway ports, on any host name:
	// a name can resolve back to loopback.
	for (const origin of ['http://127.0.0.1:3338', 'http://localhost:6900', 'http://192.168.1.4:6121', 'http://[::1]:5121',
		'http://localtest.me:7490', 'https://example.com:3339', 'http://10.0.0.2:3338']) {
		assert.match(refused([origin]).message, /app's own/, origin);
	}
	// A copy with moved ports refuses those instead.
	const moved = { asset: 4338, login: 7900, char: 7121, map: 6121, agent: 8490 };
	assert.ok(validateHost(dir, { entry: 'host/index.js', connect: ['http://127.0.0.1:4338'] }, { ports: moved }) instanceof Error);
	assert.ok(!(validateHost(dir, { entry: 'host/index.js', connect: ['http://127.0.0.1:3338'] }, { ports: moved }) instanceof Error));
	assert.ok(refused('http://127.0.0.1:8080') instanceof Error, 'a string, not a list');
	assert.ok(refused(['http://127.0.0.1:8080', 'http://127.0.0.1:8080']) instanceof Error, 'no duplicates');
	assert.ok(refused(Array.from({ length: 9 }, (_, i) => `http://127.0.0.1:${9000 + i}`)) instanceof Error, 'at most 8');
	assert.deepEqual(validateHost(dir, { entry: 'host/index.js' }).connect, [], 'none at all is allowed');
});

test('readHost reads mod.json, and ignores a mod without a host section', t => {
	const dir = modFolder(t, { 'host/index.js': '', 'mod.json': JSON.stringify({ name: 'm', host: { entry: 'host/index.js', connect: ['http://127.0.0.1:8080'] } }) });
	assert.deepEqual(readHost(dir, 'm'), { name: 'm', root: fs.realpathSync(path.join(dir, 'host')), file: fs.realpathSync(path.join(dir, 'host/index.js')), entry: 'index.js', connect: ['http://127.0.0.1:8080'] });
	assert.equal(readHost(modFolder(t, { 'mod.json': '{"name":"plain"}' }), 'plain'), null);
	assert.equal(readHost(modFolder(t, {}), 'none'), null);
	assert.match(readHost(modFolder(t, { 'mod.json': '{"host":{"entry":"../x.js"}}' }), 'bad').message, /^mod\.json: /);
	assert.ok(readHost(dir, '../m') instanceof Error);
});

test('consent is off by default, bound to the connect list, and reset when an update changes it', t => {
	const dir = modFolder(t, {});
	const file = path.join(dir, 'state', 'mod-host.json');
	const consent = createConsentStore(file);
	const connect = ['http://127.0.0.1:8080'];
	assert.equal(consent.allowed('ai', connect), false);
	consent.set('ai', true, connect);
	assert.equal(consent.allowed('ai', connect), true);
	assert.equal(consent.allowed('ai', ['http://127.0.0.1:8080']), true, 'the same list, read again');
	// An update that adds, removes or swaps an origin reads as off.
	assert.equal(consent.allowed('ai', ['http://127.0.0.1:8080', 'https://evil.example']), false);
	assert.equal(consent.allowed('ai', []), false);
	assert.equal(consent.allowed('ai', ['http://127.0.0.1:8081']), false);
	assert.equal(consent.allowed('other', connect), false, 'per mod');
	// Order does not matter; contents do.
	consent.set('two', true, ['http://a.example', 'http://b.example']);
	assert.equal(consent.allowed('two', ['http://b.example', 'http://a.example']), true);
	consent.set('ai', false, connect);
	assert.equal(consent.allowed('ai', connect), false);
	consent.forget('two');
	assert.equal(consent.allowed('two', ['http://a.example', 'http://b.example']), false);
	// Only `enabled: true` counts; a corrupt file is no consent at all.
	fs.writeFileSync(file, JSON.stringify({ ai: { enabled: 'yes', connect } }));
	assert.equal(consent.allowed('ai', connect), false);
	fs.writeFileSync(file, '{not json');
	assert.equal(consent.allowed('ai', connect), false);
	if (process.platform !== 'win32') {
		consent.set('ai', true, connect);
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	}
});

// A fake transport in place of sandbox.js: each runner answers with `reply`.
function managerFixture({ reply = async request => ({ body: { echo: request } }), limits = {}, decl = { name: 'echo', root: '/r', entry: 'index.js', connect: [] } } = {}) {
	const started = [], destroyed = [], logs = [];
	let current = decl, time = 0;
	const manager = new ModHostManager({
		resolve: async name => (current && name === current.name ? current : null),
		transport: d => {
			const runner = { alive: () => !runner.dead, destroy: () => { runner.dead = true; destroyed.push(d); }, call: request => reply(request, runner) };
			started.push(d);
			return runner;
		},
		log: line => logs.push(line),
		now: () => time,
		limits,
	});
	return { manager, started, destroyed, logs, set: d => { current = d; }, tick: ms => { time += ms; } };
}

test('the manager hands the handler only the documented request, and checks its answer', async () => {
	const f = managerFixture();
	const r = await f.manager.request('echo', { method: 'post', path: '/a/b', query: 'x=1', headers: { 'content-type': 'application/json', cookie: 'c', authorization: 'a' }, body: '{}' }, { client: 'k', from: 'friend' });
	assert.equal(r.status, 200);
	assert.equal(r.type, 'application/json; charset=utf-8');
	assert.deepEqual(JSON.parse(r.body).echo, { method: 'POST', path: '/a/b', query: 'x=1', headers: { 'content-type': 'application/json' }, body: '{}', from: 'friend' });
	assert.equal((await f.manager.request('nobody', { path: '/' })).status, 404);
	for (const bad of [{ method: 'PATCH' }, { path: 'no-slash' }, { path: '/a\nb' }, { path: '/a?b' }, { body: 5, method: 'POST' }, { method: 'GET', body: 'x' }, null]) {
		assert.equal((await f.manager.request('echo', bad)).status, 400, JSON.stringify(bad));
	}
	assert.equal((await f.manager.request('echo', { method: 'POST', body: 'x'.repeat(200 * 1024 + 1) })).status, 413);
	assert.equal(f.started.length, 1, 'one runner, reused');
});

test('normalizeResponse: status, type and body are checked, objects become JSON', () => {
	assert.deepEqual(normalizeResponse({ body: 'hi' }), { status: 200, type: 'text/plain; charset=utf-8', body: Buffer.from('hi') });
	assert.equal(normalizeResponse({ status: 404, body: { a: 1 } }).type, 'application/json; charset=utf-8');
	assert.equal(normalizeResponse({ type: 'text/html', body: '<b>' }).type, 'text/html');
	assert.equal(normalizeResponse({}).body.length, 0);
	for (const bad of [null, 'x', [], { status: 99 }, { status: 101 }, { status: 600 }, { status: '200' }, { status: 200.5 },
		{ type: 'text/plain\r\nset-cookie: a=b' }, { type: 'nonsense' }, { body: 5 }, { body: 'x'.repeat(1024 * 1024 + 1) }]) {
		assert.throws(() => normalizeResponse(bad), JSON.stringify(bad)?.slice(0, 60));
	}
	// The cap is in bytes, not characters.
	assert.throws(() => normalizeResponse({ body: 'é'.repeat(600 * 1024) }), /limit/);
});

test('the manager answers 502 for a handler that throws or answers badly, without its details', async () => {
	const f = managerFixture({ reply: async request => {
		if (request.path === '/throw') throw new Error('stack trace with /Users/secret');
		if (request.path === '/big') return { body: 'x'.repeat(1024 * 1024 + 1) };
		return 'not an object';
	} });
	for (const route of ['/throw', '/big', '/odd']) {
		const r = await f.manager.request('echo', { path: route });
		assert.equal(r.status, 502, route);
		assert.doesNotMatch(r.body.toString(), /secret|stack/);
	}
	assert.ok(f.logs.some(line => line.includes('/Users/secret')), 'the details go to the host\'s log');
});

test('the manager times a request out at its limit with a 504', async () => {
	const f = managerFixture({ reply: () => new Promise(() => {}), limits: { timeout: 50 } });
	const started = Date.now();
	const r = await f.manager.request('echo', { path: '/slow' });
	assert.equal(r.status, 504);
	assert.ok(Date.now() - started < 1000);
	assert.match(f.logs.at(-1), /longer than/);
});

test('the manager allows at most N requests per mod at once, and frees the slot afterwards', async () => {
	const releases = [];
	const f = managerFixture({ reply: () => new Promise(resolve => releases.push(() => resolve({ body: 'done' }))), limits: { concurrency: 2 } });
	const first = f.manager.request('echo', { path: '/1' }, { client: 'a' });
	const second = f.manager.request('echo', { path: '/2' }, { client: 'b' });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal((await f.manager.request('echo', { path: '/3' }, { client: 'c' })).status, 429);
	releases.forEach(release => release());
	assert.equal((await first).status, 200); assert.equal((await second).status, 200);
	const next = f.manager.request('echo', { path: '/4' }, { client: 'c' });
	await new Promise(resolve => setImmediate(resolve));
	releases.at(-1)();
	assert.equal((await next).status, 200);
});

test('the manager rate-limits each caller separately, per minute', async () => {
	const f = managerFixture({ limits: { perMinute: 3 } });
	for (let i = 0; i < 3; i++) assert.equal((await f.manager.request('echo', { path: '/' }, { client: 'friend-1' })).status, 200);
	assert.equal((await f.manager.request('echo', { path: '/' }, { client: 'friend-1' })).status, 429);
	assert.equal((await f.manager.request('echo', { path: '/' }, { client: 'friend-2' })).status, 200, 'another friend is not affected');
	assert.equal((await f.manager.request('echo', { path: '/' }, { client: 'host' })).status, 200);
	f.tick(60001);
	assert.equal((await f.manager.request('echo', { path: '/' }, { client: 'friend-1' })).status, 200);
});

test('the manager restarts a dead runner lazily, and stops one whose mod is switched off or changed', async () => {
	const f = managerFixture();
	await f.manager.request('echo', { path: '/' });
	assert.equal(f.started.length, 1);
	// Crashed: replaced on the next request, not before.
	const [first] = f.started;
	f.manager.runners.get('echo').ready.then(runner => { runner.dead = true; });
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.started.length, 1);
	await f.manager.request('echo', { path: '/' });
	assert.equal(f.started.length, 2);
	// The allow-list changed (a consented update): a new runner with it.
	f.set({ ...first, connect: ['http://127.0.0.1:8080'] });
	await f.manager.request('echo', { path: '/' });
	assert.equal(f.started.length, 3);
	assert.deepEqual(f.started.at(-1).connect, ['http://127.0.0.1:8080']);
	// Consent revoked or mod switched off: 404, and the runner is destroyed.
	const destroyedBefore = f.destroyed.length;
	f.set(null);
	assert.equal((await f.manager.request('echo', { path: '/' })).status, 404);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(f.destroyed.length, destroyedBefore + 1);
	assert.equal(f.manager.runners.size, 0);
});

test('host.log is rate-limited and stripped of control characters', () => {
	const f = managerFixture({ limits: { logPerMinute: 2 } });
	f.manager.hostLog('echo', 'one\x1b[31m');
	f.manager.hostLog('echo', 'two');
	f.manager.hostLog('echo', 'three');
	assert.deepEqual(f.logs, ['mod-host echo: one [31m', 'mod-host echo: two']);
});

test('the sandbox allows its own scheme and exactly the consented origins, nothing else', () => {
	const connect = ['http://127.0.0.1:8080', 'https://api.example.com'];
	for (const url of ['mod-host://mod/index.js', 'http://127.0.0.1:8080/v1/chat/completions', 'https://api.example.com/x?y=1']) {
		assert.equal(allowedRequest(url, connect), true, url);
	}
	for (const url of ['http://127.0.0.1:3338/list-files', 'http://localhost:8080/', 'http://127.0.0.1:8081/', 'https://127.0.0.1:8080/',
		'ws://127.0.0.1:8080/', 'wss://api.example.com/', 'file:///etc/passwd', 'data:text/plain,x', 'blob:mod-host://mod/1',
		'mod-host://other/x', 'https://api.example.com.evil.example/', 'http://api.example.com/', 'not a url']) {
		assert.equal(allowedRequest(url, connect), false, url);
	}
	assert.equal(allowedRequest('http://127.0.0.1:8080/', []), false);
	assert.match(csp(connect), /connect-src 'self' http:\/\/127\.0\.0\.1:8080 https:\/\/api\.example\.com/);
	assert.match(csp([]), /default-src 'none'/);
});

test('the sandbox serves only files inside host/, and never its own loader names from disk', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, t => {
	const dir = modFolder(t, { 'host/index.js': 'a', 'host/lib/b.js': 'b', 'host/__ragnarok__/boot.js': 'evil', 'secret.txt': 's' });
	const root = fs.realpathSync(path.join(dir, 'host'));
	fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(root, 'out.txt'));
	assert.equal(fileFor(root, 'mod-host://mod/index.js'), path.join(root, 'index.js'));
	assert.equal(fileFor(root, 'mod-host://mod/lib/b.js'), path.join(root, 'lib', 'b.js'));
	for (const url of ['mod-host://mod/../secret.txt', 'mod-host://mod/%2e%2e/secret.txt', 'mod-host://mod/lib%2f..%2f..%2fsecret.txt',
		'mod-host://mod/out.txt', 'mod-host://mod/__ragnarok__/boot.js', 'mod-host://mod/', 'mod-host://mod/lib', 'mod-host://other/index.js', 'http://mod/index.js']) {
		assert.equal(fileFor(root, url), null, url);
	}
	// The loader names the mod's entry and hands each request to its default export.
	const boot = bootScript({ name: 'echo', entry: 'lib/b.js', connect: ['http://127.0.0.1:8080'] });
	assert.match(boot, /import\("mod-host:\/\/mod\/lib\/b\.js"\)/);
	assert.match(boot, /bridge\.onRequest/);
});

test('api.host.request: IPC on the host\'s own window, /_friend/mod/ on a friend\'s', async () => {
	const { createHostRoutes } = await import('../patches/client/HostRoutes.mjs');
	const invoked = [];
	const invoke = async (name, args) => { invoked.push({ name, args }); return { status: 200, type: 'application/json; charset=utf-8', body: '{"ok":true}' }; };
	const local = createHostRoutes({ invoke, origin: () => 'http://127.0.0.1:3338', fetch: () => { throw Error('not on the host'); } });
	const answer = await local('host-local-ai', '/complete?x=1', { method: 'post', body: { prompt: 'hi' } });
	assert.deepEqual(answer, { status: 200, type: 'application/json; charset=utf-8', body: '{"ok":true}', data: { ok: true } });
	assert.equal(invoked[0].name, 'mod_host_request');
	assert.deepEqual({ ...invoked[0].args, accept: undefined }, { mod: 'host-local-ai', method: 'POST', path: '/complete', query: 'x=1', body: '{"prompt":"hi"}', type: 'application/json', accept: undefined });

	const fetched = [];
	const fetch = async (url, init) => { fetched.push({ url, init }); return { status: 404, headers: { get: () => 'text/plain' }, text: async () => 'Not found' }; };
	// A friend's page has no invoke, and a joined page is not on loopback.
	for (const remote of [createHostRoutes({ fetch, origin: () => 'https://play.example.com' }), createHostRoutes({ invoke, fetch, origin: () => 'https://play.example.com' })]) {
		const r = await remote('host-local-ai', '/health');
		assert.deepEqual(r, { status: 404, type: 'text/plain', body: 'Not found', data: null });
	}
	assert.equal(fetched[0].url, '/_friend/mod/host-local-ai/health');
	assert.equal(fetched[0].init.credentials, 'same-origin');
	assert.equal(invoked.length, 1);
	await createHostRoutes({ fetch, origin: () => 'https://play.example.com' })('m', '/say', { method: 'PUT', body: 'hello' });
	assert.equal(fetched.at(-1).init.headers['content-type'], 'text/plain; charset=utf-8');
	assert.equal(fetched.at(-1).init.body, 'hello');

	const routes = createHostRoutes({ fetch, origin: () => 'https://play.example.com' });
	await assert.rejects(routes('m', 'no-slash'), TypeError);
	await assert.rejects(routes('m', '/a', { method: 'PATCH' }), TypeError);
	await assert.rejects(routes('m', '/a', { body: 'x' }), TypeError, 'a GET has no body');
	await assert.rejects(routes('m', '/a', { method: 'POST', body: 'x'.repeat(200 * 1024 + 1) }), RangeError);
	await assert.rejects(routes('../m', '/a'), TypeError);
});

test('api.host is bound to the plugin\'s own mod name', async () => {
	const { createRuntime } = await import('../patches/client/ExtensionRuntime.mjs');
	const runtime = createRuntime({});
	const asked = [];
	runtime.configure({ hostRequest: async (mod, route, options) => { asked.push({ mod, route, options }); return { status: 200, type: 'text/plain', body: 'x', data: null }; } });
	const { api, dispose } = runtime.scope('host-local-ai');
	const answer = await api.host.request('/health');
	assert.equal(answer.status, 200);
	assert.ok(Object.isFrozen(answer));
	assert.deepEqual(asked, [{ mod: 'host-local-ai', route: '/health', options: {} }]);
	dispose();
	await assert.rejects(api.host.request('/health'), /disposed/);
});
