// Guards for Intensive Aim (#290).
//
// Intensive Aim is a toggle that roots its user. Its row had no condition, so each cast flipped
// it, and with it on a Night Watch stood still until warped back to its owner. It now only
// turns it on, and the companion drops it to follow, as a player toggles it off to move.
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


test('Intensive Aim only turns on, and is dropped to follow the owner', () => {
	for (const r of rows('NW_INTENSIVE_AIM'))
		assert.match(r, /Condition: not_self_status, CondValue: SC_INTENSIVE_AIM\b/, r);
	assert.match(engine, /status_change_end\(sd, SC_INTENSIVE_AIM\);\n\t\t\}\n(?:\t\t\/\/[^\n]*\n)*\t\tunit_walktobl\(sd, owner/,
		'the companion must drop Intensive Aim before walking after its owner');
});
