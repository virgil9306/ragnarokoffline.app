'use strict';
//
// The "host" section of a mod.json: a mod's own JavaScript that answers HTTP
// requests on the host machine (docs/MODDING.md, "Host routes").
//
//   "host": { "entry": "host/index.js", "connect": ["http://127.0.0.1:8080"] }
//
// Read here rather than by the supervisor: nothing in the server or the client
// overlay uses it, and a mod whose host section is wrong should still load its
// other layers. A bad section only means its host route never runs, and the
// reason is shown on its card in Settings.
//
// Everything a host handler may reach is in `connect`. That list is what the
// player consents to and what the sandbox's network filter enforces, so it is
// checked hard here: exact origins only, http(s) only, and never a port of the
// app's own.
//
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS: DEFAULT_PORTS } = require('../ports');

// The friend gateway's listening port (sharing/gateway.js start()).
const GATEWAY_PORT = 3339;
const MAX_CONNECT = 8;
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

function isInside(root, candidate) {
	const rel = path.relative(root, candidate);
	return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// The ports a host handler may never be pointed at: the asset server (which
// would hand it every file, and /list-files), the three game servers, the
// agent API and the friend gateway itself. Refused on *every* hostname, not
// only 127.0.0.1 and LAN addresses: a name like localtest.me resolves to
// loopback, and a player reading the consent line would not know that.
function reservedPorts(ports = DEFAULT_PORTS, gatewayPort = GATEWAY_PORT) {
	return new Set([ports.asset, ports.login, ports.char, ports.map, ports.agent, gatewayPort]
		.filter(p => Number.isInteger(p)));
}

// One origin from `connect`, as the browser will spell it, or an Error.
function checkOrigin(value, reserved) {
	if (typeof value !== 'string' || !value || value.length > 200) return new Error('each "connect" entry must be an origin like "http://127.0.0.1:8080"');
	let url;
	try { url = new URL(value); } catch { return new Error(`"${value}" in "connect" is not a URL`); }
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return new Error(`"${value}" in "connect" must be http:// or https://`);
	if (url.username || url.password) return new Error(`"${value}" in "connect" must not carry a user name or password`);
	if (!url.hostname || url.hostname.includes('*')) return new Error(`"${value}" in "connect" needs a host name`);
	// Exactly the origin, so what the player is shown is what is enforced:
	// no path, query or fragment, and the browser's own spelling of it.
	if (value !== url.origin) return new Error(`"${value}" in "connect" must be an origin only -- write it as "${url.origin}"`);
	const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
	if (reserved.has(port)) return new Error(`"${value}" in "connect" uses port ${port}, which is one of the app's own (asset, game, agent or sharing). A host route may not reach those.`);
	return url.origin;
}

// `entry` is a module file under the mod's host/ folder, and stays there after
// following links. Only host/ is served to the sandbox, so the rest of the mod
// folder (its db/, conf/, the other files a mod may carry) is never readable
// from the handler.
function checkEntry(modDir, entry) {
	if (typeof entry !== 'string' || !entry || entry.length > 200 || entry.startsWith('/')
		|| /[\\:\0]/.test(entry) || entry.split('/').some(p => !p || p === '.' || p === '..')) {
		throw new Error('"host.entry" must be a relative path like "host/index.js"');
	}
	const parts = entry.split('/');
	if (parts[0] !== 'host' || parts.length < 2) throw new Error('"host.entry" must be inside the mod\'s host/ folder, like "host/index.js"');
	if (!/\.m?js$/.test(entry)) throw new Error('"host.entry" must be a .js or .mjs module');
	let modRoot, root, file;
	try {
		modRoot = fs.realpathSync(modDir);
		root = fs.realpathSync(path.join(modRoot, 'host'));
		file = fs.realpathSync(path.join(modRoot, ...parts));
	} catch {
		throw new Error(`"host.entry" names ${entry}, which is not in the mod folder`);
	}
	// host/ itself may not be a link out of the mod, nor the file out of host/.
	if (!isInside(modRoot, root) || !isInside(root, file) || !fs.statSync(file).isFile()) {
		throw new Error(`"host.entry" names ${entry}, which is not a file inside the mod's host/ folder`);
	}
	return { root, file, entry: path.relative(root, file).split(path.sep).join('/') };
}

// The validated declaration for one mod, `null` when it declares no host
// section, or an Error naming what is wrong with it.
//
// `ports` is this copy's (electron/ports.js); `gatewayPort` the sharing
// gateway's.
function validateHost(modDir, host, { ports = DEFAULT_PORTS, gatewayPort = GATEWAY_PORT } = {}) {
	if (host === undefined) return null;
	try {
		if (!host || typeof host !== 'object' || Array.isArray(host)) throw new Error('"host" must be an object with "entry" and "connect"');
		for (const key of Object.keys(host)) {
			if (key !== 'entry' && key !== 'connect') throw new Error(`"host" has no setting called "${key}" (this build understands "entry" and "connect")`);
		}
		const { root, file, entry } = checkEntry(modDir, host.entry);
		const given = host.connect === undefined ? [] : host.connect;
		if (!Array.isArray(given)) throw new Error('"host.connect" must be a list of origins');
		if (given.length > MAX_CONNECT) throw new Error(`"host.connect" may name at most ${MAX_CONNECT} origins`);
		const reserved = reservedPorts(ports, gatewayPort);
		const connect = [];
		for (const value of given) {
			const origin = checkOrigin(value, reserved);
			if (origin instanceof Error) throw origin;
			if (connect.includes(origin)) throw new Error(`"${origin}" is in "host.connect" twice`);
			connect.push(origin);
		}
		return { root, file, entry, connect };
	} catch (error) {
		return new Error(`mod.json: ${error.message}`);
	}
}

// Reads <modDir>/mod.json and validates its host section. Same answers as
// validateHost, plus an Error when mod.json cannot be read at all.
function readHost(modDir, name, options) {
	if (!NAME.test(String(name || ''))) return new Error('not a mod name');
	let manifest;
	try { manifest = JSON.parse(fs.readFileSync(path.join(modDir, 'mod.json'), 'utf8')); } catch { return null; }
	if (!manifest || typeof manifest !== 'object') return null;
	const host = validateHost(modDir, manifest.host, options);
	return host instanceof Error || !host ? host : { name, ...host };
}

module.exports = { validateHost, readHost, checkOrigin, reservedPorts, NAME, GATEWAY_PORT, MAX_CONNECT };
