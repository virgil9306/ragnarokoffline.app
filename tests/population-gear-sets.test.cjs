// Guards for gear pools that held items their jobs cannot wear (#290 testing).
//
// pc_equipitem refuses an item the job cannot wear, and the slot stays empty. An audit of every
// set against the jobs that use it, in both item databases, found:
//   * low_blunt (Acolyte, High Acolyte, level 10-26): Waghnakh is a Monk and Priest knuckle, so
//     about half of those shells spawned with no weapon.
//   * para_mage, pre-renewal: Saint Robe is for Acolytes and Merchants, not the Wizard and Sage lines.
//   * para_ninja, pre-renewal: a Ninja cannot wear Boots.
//   * para_assassin_katar, pre-renewal: P_Katar1 is not in the pre-renewal item database.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const sets = fs.readFileSync(path.join(__dirname, '..', 'third-party', 'population-engine', 'files', 'db',
	'population_gear_sets.yml'), 'utf8').replace(/\r\n/g, '\n');

function set(name) {
	const start = sets.indexOf(`  - GearSetName: ${name}`);
	assert.ok(start >= 0, `${name} must exist`);
	const next = sets.indexOf('\n  - GearSetName:', start + 1);
	return sets.slice(start, next < 0 ? undefined : next);
}

test('every weapon in the low Acolyte set is one an Acolyte can hold', () => {
	assert.ok(!/Waghnakh/.test(set('low_blunt')));
	assert.match(set('low_blunt'), /Weapon:\n      - Club\n      - Mace\n/);
});

test('pre-renewal pools hold only items their jobs can wear', () => {
	assert.ok(!/Saint_Robe/.test(set('para_mage')), 'not for the Wizard and Sage lines');
	assert.ok(!/- Boots\n/.test(set('para_ninja')), 'a Ninja cannot wear Boots');
	assert.match(set('para_assassin_katar'), /PreRenewal:\n      Weapon:\n        - Katar_\n        - Jamadhar\n/,
		'P_Katar1 is not in the pre-renewal item database');
});
