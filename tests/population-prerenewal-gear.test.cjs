// Guards gear sets on pre-renewal worlds (#325).
//
// Most gear sets are built from renewal-only items (the Paradise/Eden gear). The pre-renewal item
// db lacks them, the loader skipped each, and a slot left with nothing spawned empty: most second
// and trans-class companions had no weapon, armour, garment or shoes. A set's PreRenewal block now
// replaces those pools on a pre-renewal server; renewal ignores it. validate.py checks the block's
// items against db/pre-re, and that no slot a pre-renewal job uses is left empty.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
// Windows checks out CRLF; the patterns below are written against LF.
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const loader = read('third-party/population-engine/files/src/map/population_engine/config/population_config.cpp');
const sets = read('third-party/population-engine/files/db/population_gear_sets.yml');

test('a pre-renewal server takes a slot from the PreRenewal block when it has one', () => {
	const m = /if \(this->nodeExists\(node, "GearSetName"\)\) \{([\s\S]*?)m_gear_sets\[name\]/.exec(loader);
	assert.ok(m, 'gear set branch found');
	const body = m[1];
	assert.match(body, /#ifndef RENEWAL\n\t\tconst bool has_pre = this->nodeExists\(node, "PreRenewal"\);/);
	assert.match(body, /if \(this->nodeExists\(pre_node, std::string\(k\)\)\) \{\n\t+this->parseEquipSlotPool\(pre_node, keys, flag, pool, 0\);\n\t+return;/);
	assert.match(body, /#endif\n\t\t\tthis->parseEquipSlotPool\(node, keys, flag, pool, 0\);/, 'otherwise the set\'s own pool');
	for (const slot of ['Weapon', 'Shield', 'HeadTop', 'HeadMid', 'HeadBottom', 'Armor', 'Garment', 'Shoes', 'AccL', 'AccR'])
		assert.match(body, new RegExp(`slot\\(\\{"${slot}",`), slot);
	assert.ok(!/this->parseEquipSlotPool\(node, \{"/.test(body), 'every slot goes through the PreRenewal check');
});

test('every set whose renewal gear leaves a pre-renewal job empty has a PreRenewal block', () => {
	const blocks = new Map(sets.split(/^  - GearSetName: /m).slice(1).map((b) => [b.split(/\s/)[0], b]));
	const want = {
		para_swordsman: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_knight_base: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_crusader: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_mage: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_bow: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_monk: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_thief: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_merchant: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_ninja: ['Weapon', 'Armor', 'Garment', 'Shoes'],
		para_taekwon: ['Armor', 'Garment', 'Shoes'],
		para_gun: ['Armor', 'Garment', 'Shoes'],
		para_assassin_katar: ['Armor', 'Garment', 'Shoes'],
		novice_set: ['HeadBottom'],
	};
	for (const [name, slots] of Object.entries(want)) {
		const pre = (blocks.get(name) || '').split('\n    PreRenewal:\n')[1];
		assert.ok(pre, `${name} has a PreRenewal block`);
		for (const slot of slots) assert.match(pre, new RegExp(`^      ${slot}:\\n        - \\S+`, 'm'), `${name}/${slot}`);
	}
});
