// Guards for keeping the party alive before anything else (#290 testing).
//
// Each tick ran the self-buff loop first, then the ally rows in list order, then attacks. A Priest
// kept Blessing and Increase AGI up while a party member died, because those rows came before Heal,
// and a companion on the Attacker duty skipped the ally rows altogether, so it never healed anyone.
// A rescue pass now runs first for every duty: the rows gated on an ally's HP (ally_hp_below) or the
// companion's own (hp_below), with no Rate roll.
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

test('rescue rows are the ones gated on HP', () => {
	const body = fn('static bool pop_row_is_rescue(');
	assert.match(body, /AllyHpBelow/);
	assert.match(body, /HpBelow/);
});

test('both passes can run rescue rows alone, and a rescue is not left to the Rate roll', () => {
	const ally = fn('static bool population_shell_cast_ally_attack_skill(');
	assert.match(ally, /if \(rescue_only && !pop_row_is_rescue\(sk\.condition\)\)/);
	assert.match(ally, /if \(!rescue_only && sk\.rate < 10000/);
	const self = fn('static bool population_shell_cast_expired_self_buffs(');
	assert.match(self, /if \(rescue_only && !pop_row_is_rescue\(bs\.condition\)\)/);
});

test('the rescue pass runs first, for every duty', () => {
	const tick = combat.slice(combat.indexOf('// Rescue first, whatever the duty'));
	const rescue = tick.indexOf('population_shell_cast_ally_attack_skill(sd, current_tick, true)');
	const buffs = tick.indexOf('population_shell_cast_expired_self_buffs(sd, current_tick)');
	const allies = tick.indexOf('population_shell_cast_ally_attack_skill(sd, current_tick)');
	assert.ok(rescue > 0 && rescue < buffs && buffs < allies, 'rescue, then buffs, then the other ally rows');
	assert.match(tick.slice(0, rescue), /^[^\n]*\n\tif \(!flag_attack_only && do_skills/m);
	assert.doesNotMatch(tick.slice(0, buffs), /shell_role/, 'the rescue pass must not depend on the duty');
});
