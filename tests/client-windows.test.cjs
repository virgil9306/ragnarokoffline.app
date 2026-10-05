'use strict';
// api.ui, api.items and api.server.request: what a plugin may ask for, and
// that what it opens goes when it does. The DOM and chat side
// (patches/client/PluginWindows.mjs) needs the client; these check the API.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const runtimeModule = import('../patches/client/ExtensionRuntime.mjs');

function fakeWindow() {
    const calls = [];
    return { calls, handle: { body: { tag: 'body' }, show: () => calls.push('show'), hide: () => calls.push('hide'), toggle: () => calls.push('toggle'), isOpen: () => false, setTitle: t => calls.push(`title:${t}`), onClose: () => () => {}, destroy: () => calls.push('destroy') } };
}

test('a window is opened checked, remembers through preferences, and is destroyed with the plugin', async () => {
    const { createRuntime } = await runtimeModule;
    const store = new Map();
    const runtime = createRuntime({ storage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
    const made = [];
    const fake = fakeWindow();
    runtime.configure({ createWindow: (plugin, spec, deps) => { made.push({ plugin, spec, deps }); return fake.handle; } });
    const scope = runtime.scope('ingame-database');
    const win = scope.api.ui.window({ id: 'db', title: 'Database', width: 50, height: 99999 });
    assert.deepEqual(made[0].spec, { id: 'db', title: 'Database', width: 120, height: 2000, resizable: true });
    assert.equal(made[0].plugin, 'ingame-database');
    assert.deepEqual(win.body, { tag: 'body' });
    win.show();
    win.setTitle('Items');
    made[0].deps.save('window:db', { left: 10, top: 20 });
    assert.deepEqual(made[0].deps.load('window:db'), { left: 10, top: 20 }, 'positions go through the plugin preferences');
    const release = made[0].deps.suspendInput();
    assert.equal(scope.api.input.state().canMove, false);
    release();
    assert.throws(() => scope.api.ui.window({ id: 'bad id!' }), TypeError);
    scope.dispose();
    assert.deepEqual(fake.calls, ['show', 'title:Items', 'destroy']);
});

test('items come from the bridge as frozen copies, with limits', async () => {
    const { createRuntime } = await runtimeModule;
    const runtime = createRuntime();
    let asked;
    runtime.configure({
        searchItems: (text, limit) => { asked = { text, limit }; return [{ id: 501, name: 'Red Potion', description: '', slots: 0 }]; },
        item: id => id === 501 ? { id: 501, name: 'Red Potion' } : null,
        itemIcon: id => (id === 501 ? 'blob:icon' : null),
    });
    const { api } = runtime.scope('p');
    const found = api.items.search('potion', 5000);
    assert.deepEqual(asked, { text: 'potion', limit: 200 });
    assert.equal(found[0].name, 'Red Potion');
    assert.ok(Object.isFrozen(found) && Object.isFrozen(found[0]));
    assert.equal(api.items.get(501).name, 'Red Potion');
    assert.equal(api.items.get('501'), null);
    assert.equal(await api.items.icon(501), 'blob:icon');
    assert.equal(await api.items.icon(1.5), null);
});

test('server requests take a command name and one line of text, nothing else', async () => {
    const { createRuntime } = await runtimeModule;
    const runtime = createRuntime();
    const sent = [];
    runtime.configure({ serverRequest: (command, text, timeout) => { sent.push({ command, text, timeout }); return Promise.resolve('ok'); } });
    const { api } = runtime.scope('p');
    assert.equal(await api.server.request('moddb', 'mob Poring'), 'ok');
    assert.equal(await api.server.request('moddb', '', { timeout: 999999 }), 'ok');
    assert.deepEqual(sent, [{ command: 'moddb', text: 'mob Poring', timeout: 5000 }, { command: 'moddb', text: '', timeout: 30000 }]);
    assert.throws(() => api.server.request('Mod DB', 'x'), TypeError);
    assert.throws(() => api.server.request('@moddb', 'x'), TypeError);
    assert.throws(() => api.server.request('moddb', 'two\nlines'), TypeError);
    assert.throws(() => api.server.request('moddb', 'x'.repeat(201)), TypeError);
    const { api: old } = createRuntime().scope('q');
    await assert.rejects(old.server.request('moddb', 'x'), /cannot make server requests/);
});

test('a server script speaking first reaches plugins as server:event', async () => {
    const { createRuntime } = await runtimeModule;
    const runtime = createRuntime();
    const { api } = runtime.scope('card-remover');
    const heard = [];
    api.on('server:event', event => heard.push(event));
    runtime.serverEvent('cardremover', 'open');
    runtime.serverEvent('cardremover', 42);
    assert.deepEqual(heard, [{ command: 'cardremover', text: 'open' }]);
    assert.ok(Object.isFrozen(heard[0]));
});
