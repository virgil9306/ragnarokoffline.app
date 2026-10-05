// Guards for the classes whose skills cost coins or spirit spheres (#290).
//
// Night Watch skills cost coins and Inquisitor skills spirit spheres, but neither class had a row
// that makes them. And Call Spirits and Soul Collect (Zen) fill spirit spheres and leave no status
// to check, so with no condition they were recast with the spheres already full, and refused.
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


// Night Watch skills cost coins and Inquisitor skills spirit spheres, but neither class had a row
// that makes them: a Night Watch never cast Adjustment or Madness Canceller, an Inquisitor never
// its Gentle Touches. Each now makes them up to a count, with the new `spheres` numeric token.
test('classes whose skills cost coins or spheres make them', () => {
	const pred = fs.readFileSync(path.join(PE, 'src', 'map', 'population_engine', 'expanded_ai', 'predicates.hpp'), 'utf8');
	assert.match(pred, /if \(s == "spheres"\)\s*\{ out = NumKind::Spheres;/);
	assert.match(pred, /case NumKind::Spheres: \{[\s\S]*?lhs = sd->spiritball;/);
	const block = id => yaml.split(/\n(?=  - JobId: )/).find(b => new RegExp(`^\\s*- JobId: ${id}\\n`).test(b));
	assert.match(block(4306), /- SkillId: GS_GLITTERING\n(?: {8,}.*\n)*? {12}- self_spheres_lt10/);
	assert.ok(block(4306).indexOf('GS_GLITTERING') < block(4306).indexOf('GS_ADJUSTMENT'), 'coins first');
	assert.match(block(4262), /- SkillId: MO_CALLSPIRITS\n(?: {8,}.*\n)*? {12}- self_spheres_lt5/);
});

test('sphere makers wait until spheres run short', () => {
	for (const skill of ['MO_CALLSPIRITS', 'CH_SOULCOLLECT'])
		for (const r of rows(skill))
			assert.match(r, /self_spheres_lt\d+/, r);
});
