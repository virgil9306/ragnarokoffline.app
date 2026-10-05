// Guards for Grand Cross (#290).
//
// Grand Cross counted every enemy in detection range (30 cells), not the ones its cross of
// cells reaches, so a Royal Guard cast it every time it could, at 20% of its HP a cast.
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


test('a blast around the caster counts only the enemies it reaches, in AND/OR rows too', () => {
	const radius = /static int pop_self_blast_radius\([^)]*\)\n\{([\s\S]*?)\n\}/.exec(combat);
	assert.ok(radius && /CR_GRANDCROSS[\s\S]*?return 2;/.test(radius[1]), 'Grand Cross must have a blast radius');
	assert.match(bagHpp, /int\s+enemies_in_blast = -1;/);
	const expanded = /if \(sk\.expanded\) \{([\s\S]*?)return \(\*sk\.expanded\)\(bag\);/.exec(combat);
	assert.ok(expanded && /bag\.enemies_in_blast = pop_enemies_within\(sd, radius\)/.test(expanded[1]));
	assert.match(predicates, /cond_ == 12 && bag\.enemies_in_blast >= 0/);
});
