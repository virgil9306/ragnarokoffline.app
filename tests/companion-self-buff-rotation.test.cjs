// Guards for self buffs in the combat rotation (#290).
//
// Self buffs filed as combat rows with no condition (Meltdown, Reproduce, Servant Weapon, Shadow
// Exceed, Potent Venom, Attack Stance, Rebound Shield, Abyss Slayer, From the Abyss) were recast
// on every turn the rotation gave them, while they still ran; Attack Stance, a toggle, turned
// itself off. A Whitesmith cast Meltdown again and again.
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


test('self buffs in the combat rotation wait for their status to run out', () => {
	const sc = { WS_MELTDOWN: 'SC_MELTDOWN', SC_REPRODUCE: 'SC__REPRODUCE', DK_SERVANTWEAPON: 'SC_SERVANTWEAPON',
		SHC_SHADOW_EXCEED: 'SC_SHADOW_EXCEED', SHC_POTENT_VENOM: 'SC_POTENT_VENOM', IG_ATTACK_STANCE: 'SC_ATTACK_STANCE',
		IG_REBOUND_SHIELD: 'SC_REBOUND_S', ABC_ABYSS_SLAYER: 'SC_ABYSS_SLAYER', ABC_FROM_THE_ABYSS: 'SC_ABYSSFORCEWEAPON' };
	for (const [skill, status] of Object.entries(sc))
		for (const r of rows(skill))
			assert.match(r, new RegExp(`Condition: not_self_status, CondValue: ${status}\\b`), r);
});
