// Guards for companion reaction skills (#290).
//
// Reaction skills whose status lasts a second or so (Magic Rod, Root, Death Bound) gated on
// "not while I have it", so they were recast every time it ran out: a Sorcerer cast Magic Rod
// about once a second. They now wait for what they react to.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const PE = path.join(ROOT, 'third-party', 'population-engine', 'files');
const yaml = fs.readFileSync(path.join(PE, 'db', 'population_skill_db.yml'), 'utf8').replace(/\r\n/g, '\n');
const combat = fs.readFileSync(path.join(PE, 'src', 'map', 'population_engine', 'runtime',
	'population_engine_combat.cpp'), 'utf8').replace(/\r\n/g, '\n');
const EA = path.join(PE, 'src', 'map', 'population_engine', 'expanded_ai');
const predicates = fs.readFileSync(path.join(EA, 'predicates.hpp'), 'utf8').replace(/\r\n/g, '\n');
const bagHpp = fs.readFileSync(path.join(EA, 'expanded_condition.hpp'), 'utf8').replace(/\r\n/g, '\n');
const engine = fs.readFileSync(path.join(PE, 'src', 'map', 'population_engine.cpp'), 'utf8').replace(/\r\n/g, '\n');
const gen = fs.readFileSync(path.join(ROOT, 'scripts', 'gen-population-skill-presets.py'), 'utf8').replace(/\r\n/g, '\n');

// Every row of a skill: the one-line form, or the block form up to the next row.
function rows(skill) {
	const out = [];
	const re = new RegExp(`^ *- (\\{ SkillId: ${skill},[^\\n]*|SkillId: ${skill}\\n(?: {8,}[^\\n]*\\n)*)`, 'gm');
	let m;
	while ((m = re.exec(yaml)) !== null) out.push(m[1]);
	assert.ok(out.length > 0, `${skill} must have rows`);
	return out;
}


test('short reaction skills wait for what they react to', () => {
	const want = {
		SA_MAGICROD: /self_being_cast_on/, MO_BLADESTOP: /melee_attacked/, RK_DEATHBOUND: /melee_attacked/,
		SR_CRESCENTELBOW: /melee_attacked/, SR_LIGHTNINGWALK: /range_attacked/, KG_KAGEHUMI: /enemy_hidden/,
		LG_MOONSLASHER: /enemy_count_nearby/, RG_RAID: /enemy_count_nearby/, HN_GROUND_GRAVITATION: /enemy_count_nearby/,
		SR_CURSEDCIRCLE: /enemy_count_nearby/, LG_KINGS_GRACE: /hp_below/,
	};
	for (const [skill, re] of Object.entries(want)) {
		const all = rows(skill);
		for (const r of all)
			assert.doesNotMatch(r, /not_self_status/, `${skill} lasts a moment; recast on expiry is spam: ${r}`);
		assert.ok(all.some(r => re.test(r)), `${skill} must react to ${re}`);
	}
});
