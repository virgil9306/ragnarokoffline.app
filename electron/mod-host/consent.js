'use strict';
//
// The host's consent to a mod's host route, kept in <state>/mod-host.json:
//
//   { "<mod>": { "enabled": true, "connect": ["http://127.0.0.1:8080"] } }
//
// Consent is to a mod *and* to what it said it would reach. An update that
// changes `connect` -- even by one origin -- reads as off until the host
// switches it on again, having been shown the new list. Nothing in a mod's
// own files can turn it on.
//
const fs = require('node:fs');
const path = require('node:path');

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
	&& JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function createConsentStore(file) {
	function load() {
		try {
			const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
		} catch { return {}; }
	}
	function save(all) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temporary = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(temporary, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
		fs.renameSync(temporary, file);
	}
	return {
		// Whether the host has switched this mod's route on for exactly this
		// list of origins.
		allowed(name, connect) {
			const all = load();
			const entry = Object.hasOwn(all, name) ? all[name] : null;
			return Boolean(entry && entry.enabled === true && same(entry.connect, connect));
		},
		set(name, enabled, connect) {
			const all = load();
			if (enabled) all[name] = { enabled: true, connect: [...connect] };
			else delete all[name];
			save(all);
		},
		forget(name) {
			const all = load();
			if (!Object.hasOwn(all, name)) return;
			delete all[name];
			save(all);
		},
	};
}

module.exports = { createConsentStore };
