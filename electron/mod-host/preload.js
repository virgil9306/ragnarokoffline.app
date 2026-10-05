'use strict';
//
// The only bridge a mod's host handler page gets (sandbox.js). Not preload.js,
// which hands the app's own pages every handler in main.js, and not the mod
// settings bridge either: this one can take a request, answer it, and write a
// line to the log. It can name no other mod, file, handler or window.
//
const { contextBridge, ipcRenderer } = require('electron');

// The answer's body is turned into text here, before it crosses to the main
// process, so a handler cannot push an arbitrarily large object down the IPC
// channel. The main process checks the size again, in bytes.
const LIMIT = 1024 * 1024;
let handler = null;

ipcRenderer.on('mod-host:request', (_event, id, request) => { if (handler) handler(id, request); });

contextBridge.exposeInMainWorld('ragnarokModHost', {
	// The first registration wins: the app's own loader makes it before the
	// mod's module has started loading.
	onRequest(fn) { if (handler === null && typeof fn === 'function') handler = fn; },
	ready() { ipcRenderer.send('mod-host:ready'); },
	respond(id, response) {
		let out;
		try {
			if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('the handler must return { status, type, body }');
			let body = response.body, type = typeof response.type === 'string' ? response.type : undefined;
			if (body !== undefined && body !== null && typeof body === 'object') {
				body = JSON.stringify(body);
				if (type === undefined) type = 'application/json; charset=utf-8';
			}
			if (body !== undefined && body !== null && typeof body !== 'string') throw new Error('body must be a string or a JSON-able object');
			// More UTF-16 units than the limit is certainly more bytes.
			if (typeof body === 'string' && body.length > LIMIT) throw new Error(`the response is larger than ${LIMIT} bytes`);
			out = { status: response.status, type, body: body === undefined ? null : body };
		} catch (error) {
			ipcRenderer.send('mod-host:fail', id, String(error && error.message || error).slice(0, 2000));
			return;
		}
		ipcRenderer.send('mod-host:response', id, out);
	},
	fail(id, message) { ipcRenderer.send('mod-host:fail', id, String(message).slice(0, 2000)); },
	log(text) { ipcRenderer.send('mod-host:log', String(text).slice(0, 2000)); },
});
