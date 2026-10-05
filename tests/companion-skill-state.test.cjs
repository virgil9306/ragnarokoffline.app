// Guards for skills that need a state before they can start (#290 testing).
//
// rAthena refuses a skill whose required state (skill_db Requires: State) is not met: a Sky Emperor's
// Light of Sun needs Sun Stance, Auto Guard a shield, a Mechanic's attacks a Mado, Water Ball water
// underfoot. Rows did not check it, so such skills were tried and refused every few seconds; a Sky
// Emperor in Lunar Stance had Light of Sun, Light of Star and Falling Star refused 66 times each.
// The condition gate now checks the state first, as it checks the weapon under Weapon rules.
// Later testing found the same for costs and for statuses that stop the caster using skills: a
// Night Watch with too little AP had Hidden Card refused 37 times, and an Inquisitor under Steel
// Body tried Blessing and Increase AGI 52 times.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const combat = fs.readFileSync(path.join(__dirname, '..', 'third-party', 'population-engine', 'files', 'src',
	'map', 'population_engine', 'runtime', 'population_engine_combat.cpp'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
	const start = combat.indexOf(name);
	assert.ok(start >= 0, `${name} must exist`);
	return combat.slice(start, combat.indexOf('\n}\n', start));
}

test('the required state is read from the skill database and checked like castbegin does', () => {
	const body = fn('static bool pop_skill_state_ok(');
	assert.match(body, /switch \(skill->require\.state\)/);
	assert.match(body, /sd->spiritball < skill->require\.spiritball\[lv - 1\]/, 'spheres or coins the skill costs');
	assert.match(body, /sd->battle_status\.ap < static_cast<uint32>\(skill->require\.ap\[lv - 1\]\)/, 'the AP the skill costs');
	assert.match(body, /if \(!status_check_skilluse\(sd, nullptr, skill_id, 0\)\)\s*return false;/,
		'a status that stops the caster using skills (Steel Body, Silence)');
	for (const st of ['ST_SUNSTANCE', 'ST_MOONSTANCE', 'ST_STARSTANCE', 'ST_UNIVERSESTANCE', 'ST_SHIELD', 'ST_CART',
		'ST_MADO', 'ST_FALCON', 'ST_WUG', 'ST_RIDINGDRAGON', 'ST_WATER', 'ST_HIDDEN'])
		assert.match(body, new RegExp(`case ${st}:`), st);
	assert.match(body, /case ST_SUNSTANCE:\s*return sc->getSCE\(SC_SUNSTANCE\) \|\| sc->getSCE\(SC_UNIVERSESTANCE\);/,
		'Universe Stance counts as each of the others, as in rAthena');
});

test('every skill row passes through it', () => {
	const gate = fn('static inline bool pop_skill_cond_satisfied(');
	assert.match(gate, /if \(!pop_skill_weapon_ok\(sd, sk\.skill_id\) \|\| !pop_skill_state_ok\(sd, sk\.skill_id, sk\.skill_lv\)\)\s*return false;/);
});

test('a dead shell does not react to the hit that killed it', () => {
	const body = fn('void population_engine_shell_reactive_cast(');
	assert.match(body, /if \(pc_isdead\(sd\) \|\| status_isdead\(\*sd\)\)\s*return;/,
		'HP 0 before pc_dead sets the dead flag counts too');
	assert.ok(body.indexOf('status_isdead(*sd)') < body.indexOf('population_shell_cast_expired_self_buffs'),
		'before any cast');
});
