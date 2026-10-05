// Guards for choosing spells by element (#290 testing).
//
// The attack rotation cycled skills in list order whatever the target was: a Mage cast Fire Bolt
// at a Fire monster (25%, or healing it at Fire 3) as often as Cold Bolt (150%). The picker now
// reads rAthena's element table: the ready skill the target is weakest to goes first, a resisted
// one waits while a full-damage skill is ready, and one that would do nothing or heal never fires.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const combat = fs.readFileSync(path.join(__dirname, '..', 'third-party', 'population-engine', 'files', 'src',
	'map', 'population_engine', 'runtime', 'population_engine_combat.cpp'), 'utf8').replace(/\r\n/g, '\n');

const start = combat.indexOf('static void population_shell_pick_attack_skill(');
const picker = combat.slice(start, combat.indexOf('\n}\n', start));

test('the multiplier comes from rAthena\'s element table, for the target\'s current element', () => {
	assert.match(picker, /status_get_element\(target_bl\)/, 'a frozen target reads as Water');
	assert.match(picker, /status_get_element_level\(target_bl\)/);
	assert.match(picker, /elemental_attribute_db\.getAttribute\(def_lv, ele, def_ele\)/);
	assert.match(picker, /if \(!CHK_ELEMENT\(ele\) \|\| !CHK_ELEMENT\(def_ele\)\)\s*return 100;/,
		'a weapon-element skill counts as neutral');
});

test('the best ready skill is promoted, resisted ones wait, and a useless one never fires', () => {
	assert.match(picker, /if \(m > best\)/);
	assert.match(picker, /if \(combo_promote_idx == SIZE_MAX\)\s*combo_promote_idx = best_idx;/,
		'a combo finisher or a crowd blast still comes first');
	assert.match(picker, /elem_cutoff = any_full \? 100 : 1;/);
	const loop = picker.slice(picker.indexOf('for (size_t t = 0; t < n; ++t)'));
	assert.match(loop, /if \(elem_cutoff != INT_MIN && elem_mult\(sk\) < elem_cutoff\)\s*continue;/);
});

test('only skills that are ready count toward the choice', () => {
	const pre = picker.slice(picker.indexOf('bool any_full = false;'), picker.indexOf('elem_cutoff = any_full'));
	assert.match(pre, /sd->scd\.find\(sk\.skill_id\)/, 'not on cooldown');
	assert.match(pre, /skill_get_sp\(sk\.skill_id, sk\.skill_lv\)/, 'affordable');
	assert.match(pre, /pop_skill_cond_satisfied\(sd, sk, target_bl\)/, 'its condition holds');
});
