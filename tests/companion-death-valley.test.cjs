// Guards for Death Valley (WM_DEADHILLHERE) on Minstrel and Wanderer companions (#290).
//
// Death Valley revives a dead party member and does nothing to a living one (valleyofdeath.cpp
// returns at once unless the target is dead). It was curated like a heal - an ally row on
// `ally_hp_below 70` and a self row on `hp_below 50` - so a Minstrel or Wanderer cast it at every
// hurt ally and at itself, spending SP and cast time on nothing, over and over. It now goes
// through the party-resurrection routine Priest-line companions use for Resurrection, which
// fires only for a dead party member in range.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const PE = path.join(ROOT, 'third-party', 'population-engine', 'files');
const combat = fs.readFileSync(path.join(PE, 'src', 'map', 'population_engine', 'runtime',
	'population_engine_combat.cpp'), 'utf8').replace(/\r\n/g, '\n');
const yaml = fs.readFileSync(path.join(PE, 'db', 'population_skill_db.yml'), 'utf8');
const gen = fs.readFileSync(path.join(ROOT, 'scripts', 'gen-population-skill-presets.py'), 'utf8');

function fn(name) {
	const start = combat.indexOf(name);
	assert.ok(start >= 0, `${name} must exist`);
	return combat.slice(start, combat.indexOf('\n}\n', start));
}

test('a companion that knows Death Valley revives dead party members with it', () => {
	const pick = fn('static bool pop_party_revive_skill(');
	assert.match(pick, /pop_is_resurrection_job\(sd->status\.class_\)[\s\S]*skill_id = ALL_RESURRECTION;\s*skill_lv = 3;/,
		'Priest-line companions keep level-3 Resurrection');
	assert.match(pick, /pc_checkskill\(sd, WM_DEADHILLHERE\)/);
	assert.match(pick, /skill_id = WM_DEADHILLHERE;\s*skill_lv = death_valley;/, 'Death Valley at the learned level');
});

test('the party-resurrection routine casts whichever revive skill the companion has', () => {
	const body = fn('static bool population_shell_try_party_resurrection(');
	assert.match(body, /pop_party_revive_skill\(sd, skill_id, skill_lv\)/);
	assert.ok(!/ALL_RESURRECTION/.test(body), 'the routine must not hard-code Resurrection any more');
	assert.match(body, /map_foreachinrange\(pop_dead_party_ally_scan_cb/, 'it still looks only for dead party members');
	assert.match(body, /unit_skilluse_id\(sd, ctx\.result->id, skill_id, skill_lv\)/);
});

test('no curated row casts Death Valley, and the generator skips it', () => {
	assert.ok(!/SkillId: WM_DEADHILLHERE\b/.test(yaml), 'Death Valley rows cast it at living allies');
	const skip = /SKIP = re\.compile\(([\s\S]*?)\n\)/.exec(gen);
	assert.ok(skip && /\|WM_DEADHILLHERE/.test(skip[1]), 'WM_DEADHILLHERE must be in the generator\'s SKIP list');
});
