'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lines, companionLimit, areaShare, companionHire, companionFee, skillWeaponCheck, COMPANION_LIMIT_MIN, COMPANION_LIMIT_MAX } = require('../electron/population-conf');

// The bounds the Settings slider exposes: 4 (the historic cap) to 11, because
// rAthena's MAX_PARTY in our fork is 12 and a slot must stay free for real
// players.
test('bounds match the party headroom', () => {
	assert.equal(COMPANION_LIMIT_MIN, 4);
	assert.equal(COMPANION_LIMIT_MAX, 11);
});

test('the slider value passes through when in range', () => {
	for (const v of [4, 5, 6, 7, 8, 9, 10, 11]) assert.equal(companionLimit({ population_companion_limit: v }), v);
});

// Old saves have no key at all; NaN and garbage land on the historic default
// rather than silently raising or lowering what a player already had.
test('missing or invalid values fall back to the historic cap of 4', () => {
	for (const v of [undefined, null, NaN, 'nonsense']) assert.equal(companionLimit({ population_companion_limit: v }), 4);
});

// A hand-edited settings.json above the party headroom is clamped down rather
// than allowed to fill every slot; below 4 it comes back up.
test('out-of-range values are clamped, never refused', () => {
	assert.equal(companionLimit({ population_companion_limit: 3 }), 4);
	assert.equal(companionLimit({ population_companion_limit: 12 }), 11);
	assert.equal(companionLimit({ population_companion_limit: 99 }), 11);
});

// Every key the server reads for the feature, one per line, so battle_conf.txt
// stays parseable no matter what the window sends.
test('every population key is written on its own line', () => {
	const text = lines({ population_enable: true, population_max: 1500, population_density: 200, population_companion_limit: 9 });
	const keys = ['population_engine_enable', 'population_engine_max_count', 'population_engine_density_pct', 'population_engine_companion_limit', 'population_engine_vending_enable'];
	for (const key of keys) assert.match(text, new RegExp(`^${key}: \\d+$`, 'm'), key);
});

test('the companion limit is written even while the engine is off', () => {
	// Turning it on later must not silently use a stale cap: the count always
	// lands in battle_conf.txt so the server never runs one configuration
	// while the window shows another.
	const text = lines({ population_enable: false, population_max: 1500, population_density: 100, population_companion_limit: 7 });
	assert.match(text, /^population_engine_companion_limit: 7$/m);
});

test('neighbouring keys keep their own clamps', () => {
	const text = lines({ population_enable: true, population_max: 0, population_density: 900, population_companion_limit: 12 });
	assert.match(text, /^population_engine_max_count: 1$/m);   // rAthena refuses 0; the flag alone means off
	assert.match(text, /^population_engine_density_pct: 500$/m);
	assert.match(text, /^population_engine_companion_limit: 11$/m);
});

// Towns, fields and dungeons each get a share of "How busy", 0-100.
test('each area share is written, clamped, and a save without them means 100', () => {
	const text = lines({ population_enable: true, population_max: 1500, population_density: 100, population_town_pct: 40, population_field_pct: 0, population_dungeon_pct: 250 });
	assert.match(text, /^population_engine_town_pct: 40$/m);
	assert.match(text, /^population_engine_field_pct: 0$/m, '0 is a real choice: none in fields');
	assert.match(text, /^population_engine_dungeon_pct: 100$/m);
	const old = lines({ population_enable: true, population_max: 1500, population_density: 100 });
	for (const area of ['town', 'field', 'dungeon']) assert.match(old, new RegExp(`^population_engine_${area}_pct: 100$`, 'm'));
	assert.equal(areaShare({ population_town_pct: -5 }, 'town'), 0);
	assert.equal(areaShare({ population_town_pct: 'x' }, 'town'), 100);
	assert.equal(areaShare({ population_town_pct: 33.4 }, 'town'), 33);
});

// Companions: free choice (0), hired from the panel (1) or from a recruiter (2),
// and the fee. A save from before has none of these: free, 1000 zeny/level, no item.
test('the hiring mode and fee are written, clamped, and default to free choice', () => {
	const base = { population_enable: true, population_max: 1500, population_density: 100 };
	const old = lines(base);
	assert.match(old, /^population_engine_companion_hire: 0$/m);
	assert.match(old, /^population_engine_companion_hire_zeny_per_level: 1000$/m);
	assert.match(old, /^population_engine_companion_hire_item: 0$/m);
	assert.match(old, /^population_engine_companion_hire_item_amount: 0$/m);
	const npc = lines({ ...base, population_companion_hire: 'npc', population_companion_fee_zeny: 2500000,
		population_companion_fee_item: 607, population_companion_fee_item_amount: 3 });
	assert.match(npc, /^population_engine_companion_hire: 2$/m);
	assert.match(npc, /^population_engine_companion_hire_zeny_per_level: 1000000$/m, 'clamped to the server maximum');
	assert.match(npc, /^population_engine_companion_hire_item: 607$/m);
	assert.match(npc, /^population_engine_companion_hire_item_amount: 3$/m);
	assert.equal(companionHire({ population_companion_hire: 'panel' }), 1);
	assert.equal(companionHire({ population_companion_hire: 'nonsense' }), 0);
	assert.deepEqual(companionFee({ population_companion_fee_zeny: 0 }), { zenyPerLevel: 0, item: 0, amount: 0 });
});

// Weapon rules (#290): off unless the box is ticked, so a save from before, or a
// hand-edited truthy string, keeps companions using any skill with any weapon.
test('the weapon rule is written, and is off unless turned on', () => {
	const base = { population_enable: true, population_max: 1500, population_density: 100 };
	assert.match(lines(base), /^population_engine_skill_weapon_check: 0$/m);
	assert.match(lines({ ...base, population_skill_weapon_check: true }), /^population_engine_skill_weapon_check: 1$/m);
	assert.match(lines({ ...base, population_enable: false, population_skill_weapon_check: true }),
		/^population_engine_skill_weapon_check: 1$/m, 'written while the engine is off, so it sticks');
	for (const v of [false, 'yes', 1, null, undefined]) assert.equal(skillWeaponCheck({ population_skill_weapon_check: v }), 0, String(v));
});
