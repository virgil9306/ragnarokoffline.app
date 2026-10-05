// Guards for companions losing gear across a save and a recall (#290 testing).
//
// Arch Bishop, Sorcerer and Sky Emperor companions came back without a weapon, headgear or garment:
//   * The headgear and garment columns were written from status.head_* / status.robe, which hold
//     each piece's LOOK (Elven Ears saved as 73, a cape with no look as 0), so recall rebuilt those
//     slots as nothing.
//   * Recall spawns at level 99 and equips the weapon, shield, garment and headgear before the
//     saved level is restored, so a piece above 99 (a Sky Emperor's level-130 book) was refused.
// Only worn pieces are saved, so whatever came back unworn was gone for good at the next save.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '..', 'third-party', 'population-engine', 'files', 'src',
	'map', 'population_engine.cpp'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
	const start = src.indexOf(name);
	assert.ok(start >= 0, `${name} must exist`);
	return src.slice(start, src.indexOf('\n}\n', start));
}

test('no save writes a headgear or garment column from a look', () => {
	assert.doesNotMatch(src, /\(uint32_t\)sd->status\.head_(top|mid|bottom)/, 'the recruit save must write worn items');
	assert.doesNotMatch(src, /\(uint32_t\)sd->status\.robe/, 'the garment column is the worn cape');
	const gear = fn('void population_engine_persist_companion_gear(');
	assert.doesNotMatch(gear, /sd->status\.head_(top|mid|bottom),/, 'the periodic save must write worn items');
	for (const body of [gear, src.slice(src.indexOf('uint32_t head_top = 0, head_mid = 0, head_low = 0, garment = 0;'))])
		assert.match(body, /slot\.equip & EQP_HEAD_TOP\)\s+head_top\s*= slot\.nameid/);
});

test('a recall fills a slot left empty, from the bag first, then the job\'s gear set', () => {
	const at = src.indexOf('pop_companion_restore_gear_detail(shell, gear_detail);');
	assert.ok(at > 0);
	const after = src.slice(at, at + 1200);
	assert.match(after, /pop_companion_reequip_own\(shell, \(EQP_HAND_R \| EQP_HAND_L \| EQP_ARMOR/);
	assert.match(after, /& ~pop_companion_worn_positions\(shell\)\);/, 'only positions nothing is worn in');
	const own = fn('static void pop_companion_reequip_own(');
	assert.ok(own.indexOf('pc_isequip(shell, i)') < own.indexOf('equipment->weapon_pool'), 'the bag before the gear set');
});
