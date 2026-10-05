// Windows of a plugin's own (api.ui.window), the client's item tables
// (api.items), and answers from the server (api.server.request).
//
// A window is the plugin's to fill: a titled, draggable frame in the game's
// style, whose body is an element in its own shadow root, so a mod's CSS and
// the game's never touch. Its position is remembered, and typing in it does
// not walk the character.
//
// A server request is an @command the mod's own NPC script answers (bindatcmd)
// by sending lines back with dispbottom:
//
//     @@reply <id> <part>/<parts> <text>
//
// dispbottom lines reach the chat box with no "Name :" in front, so nobody can
// forge one by talking. The lines are gathered here, joined, and handed to the
// waiting request; they never show in chat.
//
// A script can also speak first, without being asked -- an NPC opening a
// mod's window, say:
//
//     @@event <command> <text>
//
// That goes to every plugin as the client event 'server:event'.

import ChatBox from 'UI/Components/ChatBox/ChatBox.js';
import Client from 'Core/Client.js';
import Mouse from 'Controls/MouseEventHandler.js';
import DB from 'DB/DBManager.js';
import ItemTable from 'DB/Items/ItemTable.js';
import Session from 'Engine/SessionStorage.js';
import EntityManager from 'Renderer/EntityManager.js';

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const STYLE = `
:host { position: fixed; z-index: 9000; font: 12px/1.4 Tahoma, "Segoe UI", system-ui, sans-serif; color: #333; }
.frame { display: flex; flex-direction: column; width: 100%; height: 100%; background: #fff;
	border: 1px solid #6b7a99; border-radius: 4px; box-shadow: 0 4px 18px rgba(0,0,0,.35); overflow: hidden; }
.title { display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 4px 0 8px; cursor: move; user-select: none;
	background: linear-gradient(#e9eefb, #c7d1ea); border-bottom: 1px solid #9aa7c4; color: #273256; font-weight: bold; }
.title span { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.close { width: 16px; height: 16px; border: 1px solid #8592b3; border-radius: 3px; background: #f4f6fc; color: #42507a;
	font: bold 11px/14px sans-serif; text-align: center; cursor: pointer; padding: 0; }
.close:hover { background: #fff; }
.body { flex: 1; overflow: auto; position: relative; }
.grip { position: absolute; right: 0; bottom: 0; width: 12px; height: 12px; cursor: nwse-resize; }
`;

/**
 * @param {string} plugin - the plugin's name, for remembering positions
 * @param {object} spec - { id, title, width, height, resizable } (checked by ExtensionRuntime)
 * @param {object} deps - { suspendInput(): release, load(key), save(key, value) }
 */
export function createWindow(plugin, spec, deps) {
	const key = `window:${spec.id}`;
	const saved = deps.load(key) || {};
	const host = document.createElement('div');
	host.dataset.plugin = plugin;
	host.dataset.window = spec.id;
	const root = host.attachShadow({ mode: 'open' });
	root.innerHTML = `<style>${STYLE}</style><div class="frame"><div class="title"><span></span><button class="close" title="Close">×</button></div><div class="body"></div>${spec.resizable ? '<div class="grip"></div>' : ''}</div>`;
	const title = root.querySelector('.title span');
	const body = root.querySelector('.body');
	title.textContent = spec.title;

	let width = saved.width || spec.width, height = saved.height || spec.height;
	let left = saved.left ?? Math.max(10, (innerWidth - width) / 2), top = saved.top ?? Math.max(10, (innerHeight - height) / 3);
	const place = () => {
		left = Math.min(Math.max(0, left), Math.max(0, innerWidth - 60));
		top = Math.min(Math.max(0, top), Math.max(0, innerHeight - 24));
		Object.assign(host.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
	};
	const remember = () => deps.save(key, { left, top, width, height });
	place();

	// Drag by the title bar, resize by the corner.
	const drag = (event, onMove) => {
		event.preventDefault();
		const start = { x: event.clientX, y: event.clientY, left, top, width, height };
		const move = e => { onMove(e.clientX - start.x, e.clientY - start.y, start); place(); };
		const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); remember(); };
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
	};
	root.querySelector('.title').addEventListener('pointerdown', event => {
		if (event.target.closest('.close')) return;
		drag(event, (dx, dy, s) => { left = s.left + dx; top = s.top + dy; });
	});
	root.querySelector('.grip')?.addEventListener('pointerdown', event => drag(event, (dx, dy, s) => {
		width = Math.max(160, s.width + dx);
		height = Math.max(100, s.height + dy);
	}));

	// Typing in the window must not walk the character or fire shortcuts.
	let release = null;
	root.addEventListener('focusin', event => {
		if (!release && event.target.matches?.('input, textarea, select, [contenteditable]')) release = deps.suspendInput();
	});
	root.addEventListener('focusout', () => { release?.(); release = null; });
	for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, event => event.stopPropagation());

	// Clicking in the window must not walk the character either. The map reads
	// every click on the page and acts on it while Mouse.intersect is set, so
	// the pointer over the window clears it, as the client's own windows do
	// (GUIComponent's MouseMode.STOP), and leaving or closing puts it back.
	let covering = false;
	const uncover = () => {
		if (!covering) return;
		covering = false;
		if (!Session.FreezeUI) Mouse.intersect = true;
		EntityManager.setOverEntity(null);
	};
	host.addEventListener('mouseenter', () => {
		if (covering || !Mouse.intersect) return;
		covering = true;
		Mouse.intersect = false;
		EntityManager.setOverEntity(null);
	});
	host.addEventListener('mouseleave', uncover);

	const closers = new Set();
	let visible = false;
	const hide = () => {
		if (!visible) return;
		visible = false;
		host.remove();
		uncover();
		release?.(); release = null;
		for (const fn of closers) { try { fn(); } catch (error) { console.error(error); } }
	};
	root.querySelector('.close').addEventListener('click', hide);

	return {
		body,
		show() { if (!visible) { visible = true; document.body.appendChild(host); place(); } },
		hide,
		toggle() { if (visible) hide(); else this.show(); },
		isOpen: () => visible,
		setTitle(text) { title.textContent = String(text).slice(0, 80); },
		onClose(fn) { closers.add(fn); return () => closers.delete(fn); },
		destroy() { hide(); closers.clear(); },
	};
}

// ---------------------------------------------------------------------------
// Items, from the client's own tables (what the game shows)
// ---------------------------------------------------------------------------

function itemSummary(id) {
	const info = DB.getItemInfo(id);
	if (!info || !info.identifiedDisplayName) return null;
	const description = info.identifiedDescriptionName;
	return {
		id,
		name: info.identifiedDisplayName,
		description: (Array.isArray(description) ? description.join('\n') : description || '').replace(/\^[0-9a-fA-F]{6}/g, ''),
		slots: Number(info.slotCount) || 0,
	};
}

/** Items whose name contains `text` (case-insensitive), or whose id is it. */
export function searchItems(text, limit = 50) {
	const query = String(text || '').trim().toLowerCase();
	if (!query) return [];
	const out = [];
	if (/^\d+$/.test(query)) {
		const exact = itemSummary(Number(query));
		if (exact) out.push(exact);
	}
	for (const key of Object.keys(ItemTable)) {
		if (out.length >= limit) break;
		const name = ItemTable[key]?.identifiedDisplayName;
		if (typeof name === 'string' && name.toLowerCase().includes(query)) {
			const item = itemSummary(Number(key));
			if (item && !out.some(o => o.id === item.id)) out.push(item);
		}
	}
	return out;
}

export function item(id) {
	return Number.isInteger(id) ? itemSummary(id) : null;
}

/** An item's icon as a URL an <img> can show, or null. */
export function itemIcon(id) {
	return new Promise(resolve => {
		const info = Number.isInteger(id) ? DB.getItemInfo(id) : null;
		if (!info || !info.identifiedResourceName) return resolve(null);
		Client.loadFile(`${DB.INTERFACE_PATH}item/${info.identifiedResourceName}.bmp`, url => resolve(url || null), () => resolve(null));
	});
}

// ---------------------------------------------------------------------------
// Server requests
// ---------------------------------------------------------------------------

const REPLY = /^@@reply (\d+) (\d+)\/(\d+) ?([\s\S]*)$/;
const EVENT = /^@@event ([a-z][a-z0-9_]{1,23})(?: ([\s\S]*))?$/;
const pending = new Map();  // id -> { parts: [], resolve, reject, timer }
let nextId = 1;
let installed = false;
let onServerEvent = null;

// dispbottom arrives as the player's own speech (ZC_NPC_CHAT, or
// ZC_NOTIFY_PLAYERCHAT without a colour), and the client draws it in a bubble
// over their head as well as in chat -- before the chat line for one packet,
// after it for the other. Take down the bubble that shows this line, and only
// that one, now and once the packet's handler is done.
function hideBubble(text) {
	const hide = () => {
		const dialog = Session.Entity?.dialog;
		if (dialog && dialog.text === text) dialog.remove();
	};
	hide();
	queueMicrotask(hide);
}

function install() {
	if (installed) return;
	installed = true;
	const addText = ChatBox.addText;
	ChatBox.addText = function (text, ...rest) {
		const event = typeof text === 'string' ? EVENT.exec(text) : null;
		if (event) {
			hideBubble(text);
			onServerEvent?.(event[1], event[2] || '');
			return undefined;
		}
		const match = typeof text === 'string' ? REPLY.exec(text) : null;
		if (!match) return addText.call(this, text, ...rest);
		hideBubble(text);
		const request = pending.get(Number(match[1]));
		if (!request) return undefined;  // late or stray: still not chat
		const part = Number(match[2]), parts = Number(match[3]);
		request.parts[part - 1] = match[4];
		if (part === parts || request.parts.filter(p => p !== undefined).length === parts) {
			clearTimeout(request.timer);
			pending.delete(Number(match[1]));
			request.resolve(request.parts.join(''));
		}
		return undefined;
	};
}

/**
 * Hand every @@event line to `listener(command, text)` from now on.
 */
export function listen(listener) {
	install();
	onServerEvent = listener;
}

/**
 * Ask the mod's server script for something: sends `@<command> <id> <text>`
 * and resolves with the text of its @@reply lines.
 * @param {Function} send - sends an @command as the player (serverCommand)
 */
export function request(command, text, timeout, send) {
	install();
	const id = nextId++;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`no answer to @${command} within ${timeout} ms -- is the mod's server script loaded?`));
		}, timeout);
		pending.set(id, { parts: [], resolve, reject, timer });
		if (!send(`@${command} ${id}${text ? ` ${text}` : ''}`)) {
			clearTimeout(timer);
			pending.delete(id);
			reject(new Error('not in game'));
		}
	});
}
