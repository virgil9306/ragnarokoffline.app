'use strict';
// Settings → Mods: what is waiting for Apply, and what Apply leaves to do.
//
// Kept apart from settings.html so the rules can be tested under node, and so
// the warning in the Mods header and the Apply button's emphasis are both
// worked out here, from one place, and cannot disagree.
//
// No DOM in this file. Loaded by settings.html as a plain script (it becomes
// window.ModsState) and by tests/mods-state.test.cjs through require().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ModsState = api;
})(typeof self !== 'undefined' ? self : this, () => {
  /**
   * What the server was last started with, as `{ name: enabled }`.
   *
   * The first listing is taken as applied: nothing the page can see says
   * otherwise, and a warning on every open would be a warning nobody reads.
   * After that, a mod that appears (installed since) counts as off in the
   * running server -- installs do not restart it, so an install that is on
   * is a change waiting for Apply -- except a UI skin or cursor pack, whose
   * installer switches it on and rebuilds the client files itself.
   */
  function adopt(baseline, mods) {
    const next = { ...(baseline || {}) };
    for (const m of mods) {
      if (m.refused || Object.hasOwn(next, m.name)) continue;
      next[m.name] = baseline && !m.kind ? false : !!m.enabled;
    }
    return next;
  }

  /** The baseline once everything listed now is what the server runs. */
  function applied(mods, checked) {
    const next = {};
    for (const m of mods) {
      if (m.refused) continue;
      next[m.name] = Object.hasOwn(checked, m.name) ? !!checked[m.name] : !!m.enabled;
    }
    return next;
  }

  /**
   * The changes Apply would carry, as a list of `{ name, change }`, where
   * change is `on`, `off`, `removed` or `settings`.
   *
   * `checked` is the checkboxes as they stand; `present` every mod name in
   * the list, refused ones included, so a mod that is merely refused now is
   * not mistaken for one that was removed. `updated` names mods whose files
   * an Update (or a reinstall) replaced since the last Apply: the running
   * server still has the old copy, so that is a change too, as `updated`.
   */
  function pending({ baseline, checked, present, settings = {}, settingsBaseline = {}, updated = [] }) {
    const out = [];
    if (!baseline) return out;
    for (const [name, on] of Object.entries(checked)) {
      const was = Object.hasOwn(baseline, name) ? baseline[name] : false;
      if (!!on !== !!was) out.push({ name, change: on ? 'on' : 'off' });
    }
    for (const [name, was] of Object.entries(baseline)) {
      if (was && !present.includes(name)) out.push({ name, change: 'removed' });
    }
    for (const [name, values] of Object.entries(settings)) {
      if (JSON.stringify(values) !== settingsBaseline[name]) {
        // Switching a mod off and changing its options is still one mod.
        if (!out.some(p => p.name === name)) out.push({ name, change: 'settings' });
      }
    }
    for (const name of updated) {
      // Only a mod that is on in the server needs restarting for new files.
      if (!present.includes(name) || out.some(p => p.name === name)) continue;
      if (checked[name]) out.push({ name, change: 'updated' });
    }
    return out;
  }

  /**
   * The unapplied options to keep once the Installed list is redrawn: those
   * of a mod whose Options box was drawn again, which is every name in
   * `settingsBaseline`. A mod that is gone, refused, or now has its own
   * settings page instead (an update can add one) has no box any more, and
   * its old entry, with nothing to compare against, would read as "options
   * changed" through every Apply.
   */
  function keptOptions(settings, settingsBaseline) {
    const out = {};
    for (const [name, values] of Object.entries(settings || {})) {
      if (Object.hasOwn(settingsBaseline || {}, name)) out[name] = values;
    }
    return out;
  }

  /**
   * How many installed mods have an update waiting, for the red number on the
   * Mods tab and its Updates sub-tab. `updates` is check_mod_updates' answer by
   * name; a lookup that failed, or a mod no longer in the registry, is not an
   * update. `installed` is the names in the last mod listing, or null when
   * there has been none yet: a mod removed since the lookup no longer counts.
   */
  function updateCount(updates, installed) {
    let n = 0;
    for (const [name, u] of Object.entries(updates || {})) {
      if (!u || !u.update || u.error || u.listed === false) continue;
      if (installed && !installed.includes(name)) continue;
      n++;
    }
    return n;
  }

  /** What a screen reader hears for that number, or '' for none. */
  function updateCountLabel(n) {
    return n > 0 ? `${n} mod update${n === 1 ? '' : 's'} available` : '';
  }

  /** The Apply bar's headline for a list from pending(), or '' for none. */
  function pendingText(changes) {
    if (!changes.length) return '';
    const n = changes.length;
    return `${n} change${n === 1 ? '' : 's'} to mods not applied yet — press Apply.`;
  }

  /** What each pending change is, in a few words, for under the headline. */
  function pendingDetail(changes) {
    const words = { on: 'on', off: 'off', removed: 'removed', settings: 'options changed', updated: 'updated' };
    return changes.map(c => `${c.name} ${words[c.change] || c.change}`).join(' · ');
  }

  /**
   * Whether Apply with these changes leaves the game to reopen. `client` is
   * `{ name: true|false }` from the listing (mods.rs has_client_layers); a
   * mod it does not know -- an older supervisor, or one removed before it was
   * ever listed -- is taken as client-side, which is what Apply always said
   * before the app could tell.
   */
  function needsReopen(changes, client) {
    return changes.some(c => !client || client[c.name] !== false);
  }

  /**
   * The header's line after a successful Apply, until the game has loaded
   * again. `after` is the game's launch count when Apply finished; `game` is
   * `{ open, launches }` as the app reports it now. Null once there is
   * nothing left to say.
   */
  function appliedNotice(after, game) {
    if (after === null || after === undefined) return null;
    if (game && game.launches > after) return null;
    return game && game.open
      ? { text: 'Mods applied. Reopen the game to load them.', button: 'Reopen game' }
      : { text: 'Mods applied. They load the next time you open the game.', button: 'Open game' };
  }

  return { adopt, applied, pending, keptOptions, pendingText, pendingDetail, needsReopen, appliedNotice, updateCount, updateCountLabel };
});
