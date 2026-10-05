'use strict';
// The ui-scale mod: what it keeps, what it puts back on the client, and the
// button it puts in the option menu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const mod = import('../mods/ui-scale/client/index.js');

function fakeScale() {
    const own = new Map();
    let global = 1;
    return {
        own,
        current: () => global,
        supported: () => true,
        windows: () => ['ShortCut', 'ChatBox', 'Inventory', 'StatusIcons'],
        get: name => own.get(name) ?? 1,
        set: (name, value) => { own.set(name, value); return value; },
        global: () => global,
        setGlobal: value => { global = value; return value; },
    };
}

test('ui-scale reads back what it saved, and drops what it cannot trust', async () => {
    const { readSaved } = await mod;
    assert.deepEqual(readSaved(null), { all: 1, windows: {} });
    assert.deepEqual(readSaved({ all: 1.5, windows: { ShortCut: 2, ChatBox: 1, Inventory: 'big', StatusIcons: 9 } }),
        { all: 1.5, windows: { ShortCut: 2, StatusIcons: 3 } });
    assert.deepEqual(readSaved({ all: 0.1234 }), { all: 0.5, windows: {} });
    assert.deepEqual(readSaved({ all: 1.149 }).all, 1.15, 'kept on the 5% grid');
});

test('ui-scale puts the saved sizes back, skipping windows the client no longer scales', async () => {
    const { apply } = await mod;
    const scale = fakeScale();
    apply(scale, { all: 1.25, windows: { ShortCut: 2, Gone: 2 } });
    assert.equal(scale.current(), 1.25);
    assert.deepEqual([...scale.own], [['ShortCut', 2]]);
});

test('ui-scale sets the saved sizes at start and opens its window from the option menu', async () => {
    const { default: init } = await mod;
    const scale = fakeScale();
    const buttons = [];
    let toggled = 0;
    const api = {
        version: 1,
        preferences: { get: () => ({ all: 1.5, windows: { ChatBox: 0.75 } }), set() {} },
        ui: {
            scale,
            window: () => ({ body: { innerHTML: '', addEventListener() {} }, toggle: () => { toggled++; } }),
            menuButton: button => { buttons.push(button); return () => {}; },
        },
    };
    init({}, api);
    assert.equal(scale.current(), 1.5);
    assert.equal(scale.own.get('ChatBox'), 0.75);
    assert.equal(buttons.length, 1);
    assert.deepEqual([buttons[0].background, buttons[0].hover, buttons[0].down], ['esc_uiscale_a.bmp', 'esc_uiscale_b.bmp', 'esc_uiscale_c.bmp']);
    buttons[0].onClick();
    assert.equal(toggled, 1);
});

test('ui-scale does nothing on an app or client that cannot scale windows', async () => {
    const { default: init } = await mod;
    const warn = console.warn;
    console.warn = () => {};
    try {
        assert.doesNotThrow(() => init({}, { version: 1, ui: { window() { throw new Error('should not open'); } } }));
        assert.doesNotThrow(() => init({}, { version: 1, ui: { scale: { supported: () => false } } }));
    } finally {
        console.warn = warn;
    }
});
