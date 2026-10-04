// Guards the companion's own gear coming back on after a player takes their gear back (#290).
//
// Gear a player trades to a companion pushes the companion's own piece off into its bag (a
// Minstrel's Ballista, for an instrument). Taking the given piece back left the slot empty:
// nothing re-equipped the companion's own gear. population_engine_companion_return_gear now
// collects the positions it freed and hands them to pop_companion_reequip_own, which puts the
// pushed-off piece back on, or, when the unsaved bag lost it in a restart, takes a piece from
// the job's gear set.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '..', 'third-party', 'population-engine', 'files', 'src',
	'map', 'population_engine.cpp'), 'utf8').replace(/\r\n/g, '\n'); // Windows checks out CRLF

const body = (name) => {
	const m = new RegExp(`\\n[^\\n]*\\b${name}\\([^)]*\\)\\n\\{([\\s\\S]*?)\\n\\}\\n`).exec(src);
	assert.ok(m, `${name} not found`);
	return m[1];
};

test('returning gear re-equips the companion\'s own gear in the freed positions', () => {
	const ret = body('population_engine_companion_return_gear');
	assert.match(ret, /const uint32_t worn = slot\.equip;\n\t\tif \(pop_companion_hand_back\(owner, shell, i, LOG_TYPE_NPC\)\) \{\n\t\t\t\+\+returned;\n\t\t\tfreed \|= worn;/);
	assert.match(ret, /if \(returned > 0\) \{\n\t\tpop_companion_reequip_own\(shell, freed\);/,
		'before the save, so the re-equipped gear is persisted');
});

test('the pushed-off piece goes back first, then the job\'s gear set fills what is left', () => {
	const fn = body('pop_companion_reequip_own');
	const bag = fn.indexOf('pc_equipitem(shell, i, pos, false)');
	const set = fn.indexOf('population_engine_db_for_shell(shell)');
	assert.ok(bag > 0 && set > bag, 'bag pass before the gear-set pass');
	assert.match(fn, /if \(!slot\.nameid \|\| slot\.equip \|\| slot\.amount <= 0\)\n\t\t\tcontinue;/, 'only unworn pieces from the bag');
	assert.match(fn, /pos & pop_companion_worn_positions\(shell\)/, 'never over something still worn');
	for (const pool of ['weapon_pool', 'shield_pool', 'armor_pool', 'shoes_pool', 'garment_pool',
		'head_top_pool', 'head_mid_pool', 'head_bottom_pool', 'acc_l_pool', 'acc_r_pool'])
		assert.match(fn, new RegExp(`refill\\(equipment->${pool},`), pool);
	assert.match(fn, /if \(!\(freed & slot_pos\) \|\| pool\.empty\(\)\)\n\t\t\treturn;/, 'only freed positions are refilled');
});
