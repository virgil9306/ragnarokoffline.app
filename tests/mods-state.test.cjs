'use strict';
// Settings → Mods: the "not applied yet" warning and the "reopen the game"
// line that follows Apply. The rules live in src/mods-state.js so they can be
// exercised here without a window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/mods-state.js');

const mods = [
  { name: 'alpha', enabled: true },
  { name: 'beta', enabled: false },
  { name: 'broken', enabled: false, refused: true },
];
const present = list => list.map(m => m.name);

test('the first listing is taken as applied', () => {
  const baseline = M.adopt(null, mods);
  assert.deepEqual(baseline, { alpha: true, beta: false });
  assert.deepEqual(M.pending({ baseline, checked: { alpha: true, beta: false }, present: present(mods) }), []);
  assert.equal(M.pendingText([]), '');
});

test('toggling a mod is pending until Apply, and toggling it back is not', () => {
  const baseline = M.adopt(null, mods);
  const checked = { alpha: false, beta: true };
  assert.deepEqual(M.pending({ baseline, checked, present: present(mods) }),
    [{ name: 'alpha', change: 'off' }, { name: 'beta', change: 'on' }]);
  assert.match(M.pendingText(M.pending({ baseline, checked, present: present(mods) })), /press Apply/);
  assert.deepEqual(M.pending({ baseline, checked: { alpha: true, beta: false }, present: present(mods) }), []);
});

test('a changed setting is pending; the same values are not', () => {
  const baseline = M.adopt(null, mods);
  const settingsBaseline = { alpha: JSON.stringify({ rate: 1 }) };
  const checked = { alpha: true, beta: false };
  assert.deepEqual(M.pending({ baseline, checked, present: present(mods), settings: { alpha: { rate: 2 } }, settingsBaseline }),
    [{ name: 'alpha', change: 'settings' }]);
  assert.deepEqual(M.pending({ baseline, checked, present: present(mods), settings: { alpha: { rate: 1 } }, settingsBaseline }), []);
});

test('an install that is on waits for Apply; a skin installs itself', () => {
  let baseline = M.adopt(null, mods);
  const after = [...mods, { name: 'gamma', enabled: true }, { name: 'blue', enabled: true, kind: 'skin' }];
  baseline = M.adopt(baseline, after);
  assert.deepEqual(M.pending({ baseline, checked: { alpha: true, beta: false, gamma: true, blue: true }, present: present(after) }),
    [{ name: 'gamma', change: 'on' }]);
});

test('removing a mod that was on waits for Apply; one that was off does not', () => {
  const baseline = M.adopt(null, mods);
  const left = mods.filter(m => m.name !== 'alpha');
  assert.deepEqual(M.pending({ baseline, checked: { beta: false }, present: present(left) }),
    [{ name: 'alpha', change: 'removed' }]);
  const left2 = mods.filter(m => m.name !== 'beta');
  assert.deepEqual(M.pending({ baseline, checked: { alpha: true }, present: present(left2) }), []);
});

test('pending → applied → reopened', () => {
  let baseline = M.adopt(null, mods);
  const checked = { alpha: false, beta: true };
  assert.equal(M.pending({ baseline, checked, present: present(mods) }).length, 2);

  // Apply: the server now runs what was ticked.
  baseline = M.applied(mods, checked);
  assert.deepEqual(M.pending({ baseline, checked, present: present(mods) }), []);

  // With the game open, the line asks for a reopen...
  const after = 3;
  assert.deepEqual(M.appliedNotice(after, { open: true, launches: 3 }),
    { text: 'Mods applied. Reopen the game to load them.', button: 'Reopen game' });
  // ...with none open, it says the next launch picks them up...
  assert.deepEqual(M.appliedNotice(after, { open: false, launches: 3 }),
    { text: 'Mods applied. They load the next time you open the game.', button: 'Open game' });
  // ...and once the client has loaded again, there is nothing left to say.
  assert.equal(M.appliedNotice(after, { open: true, launches: 4 }), null);
  // No Apply yet: no line at all.
  assert.equal(M.appliedNotice(null, { open: true, launches: 0 }), null);
});

test('settings.html loads mods-state.js before the script that uses it', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/settings.html'), 'utf8');
  const loaded = html.indexOf('<script src="mods-state.js"></script>');
  assert.ok(loaded > 0);
  assert.ok(loaded < html.indexOf('ModsState.'));
});

test('the update count: real updates of installed mods only', () => {
  const updates = {
    a: { name: 'a', update: true, installed: 'v1', latest: 'v2' },
    b: { name: 'b', update: false },
    c: { name: 'c', update: true, error: 'rate limited' },
    d: { name: 'd', update: true, listed: false },
    e: { name: 'e', update: true },
  };
  assert.equal(M.updateCount(updates, null), 2);
  assert.equal(M.updateCount(updates, ['a', 'b', 'c', 'd', 'e']), 2);
  // Removed since the lookup: no longer counted.
  assert.equal(M.updateCount(updates, ['a', 'b']), 1);
  assert.equal(M.updateCount({}, null), 0);
  assert.equal(M.updateCount(undefined, null), 0);
});

test('the update count reads as words for a screen reader', () => {
  assert.equal(M.updateCountLabel(0), '');
  assert.equal(M.updateCountLabel(1), '1 mod update available');
  assert.equal(M.updateCountLabel(3), '3 mod updates available');
});

test('an update of a mod that is on waits for Apply; one that is off does not', () => {
  const mods = [{ name: 'a', enabled: true }, { name: 'b', enabled: false }];
  const baseline = M.adopt(null, mods);
  const checked = { a: true, b: false };
  assert.deepEqual(M.pending({ baseline, checked, present: ['a', 'b'], updated: ['a', 'b'] }),
    [{ name: 'a', change: 'updated' }]);
  // Switched off as well: one change for the mod, not two.
  assert.deepEqual(M.pending({ baseline, checked: { a: false, b: false }, present: ['a', 'b'], updated: ['a'] }),
    [{ name: 'a', change: 'off' }]);
});

test('the Apply bar says how many changes and what each one is', () => {
  const changes = [{ name: 'a', change: 'on' }, { name: 'b', change: 'settings' }, { name: 'c', change: 'updated' }];
  assert.match(M.pendingText(changes), /^3 changes to mods not applied yet/);
  assert.match(M.pendingText(changes.slice(0, 1)), /^1 change to mods/);
  assert.equal(M.pendingDetail(changes), 'a on · b options changed · c updated');
});

test('the game needs reopening only for a mod with client layers, or one it cannot tell', () => {
  const client = { server: false, window: true };
  assert.equal(M.needsReopen([{ name: 'server', change: 'on' }], client), false);
  assert.equal(M.needsReopen([{ name: 'server', change: 'on' }, { name: 'window', change: 'off' }], client), true);
  // Not in the listing (removed, or an older supervisor without the column).
  assert.equal(M.needsReopen([{ name: 'gone', change: 'removed' }], client), true);
  assert.equal(M.needsReopen([{ name: 'server', change: 'on' }], null), true);
  assert.equal(M.needsReopen([], client), false);
});
