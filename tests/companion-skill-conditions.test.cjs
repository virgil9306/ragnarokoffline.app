// Guards for companion skill conditions that let a skill fire with no reason, or never (#290).
//
// An audit of every class's rows found:
//   * Slow Poison cast on any ally without Slow Poison, poisoned or not; Detoxify and Cure on the
//     companion itself fired on low HP, which neither cures.
//   * Status names rAthena does not have (SC_PROPERTYFIRE for the Sage endows, SC_INVISIBILITY),
//     so their rows never resolved and never fired.
//   * Ally rows gated on something other than an ally (map_zone town) found no ally to cast on.
//   * Attacks around the caster filed as self buffs, gated on "not while <the ailment they
//     inflict>" or on nothing (Frost Joker, Scream, Grand Cross, Full Moon Kick, Earth Shaker),
//     so they fired with no enemy near.
//   * Sanctuary and Slim Potion Pitcher placed where two enemies stood, not where the party is hurt.
//   * Frost Diver cast at an enemy already frozen, wasting the freeze another skill could use.
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


test('cures fire on the ailment they cure', () => {
	for (const r of rows('PR_SLOWPOISON'))
		assert.match(r, /Condition: ally_status, CondValue: SC_POISON\b/, r);
	for (const skill of ['AL_CURE', 'TF_DETOXIFY'])
		for (const r of rows(skill))
			assert.doesNotMatch(r, /hp_below/, `${skill} cures no HP: ${r}`);
});

test('every status a row names exists', () => {
	assert.doesNotMatch(yaml, /SC_PROPERTY(FIRE|WATER|WIND|GROUND)\b/);
	assert.doesNotMatch(yaml, /CondValue: SC_INVISIBILITY\b/, 'the status is SC__INVISIBILITY, and it blocks casting');
});

test('an ally row gated on something else still picks an ally', () => {
	const start = combat.indexOf('static map_session_data* population_shell_find_ally_target(');
	const body = combat.slice(start, combat.indexOf('\n}\n', start));
	assert.doesNotMatch(body, /default:\s*break;/, 'map_zone and expanded rows must not find nobody');
	assert.match(body, /default:[\s\S]*pop_ally_any_scan_cb/);
});

test('attacks around the caster wait for enemies', () => {
	for (const skill of ['BA_FROSTJOKER', 'DC_SCREAM', 'BA_DISSONANCE', 'DC_UGLYDANCE', 'BD_LULLABY',
		'CR_GRANDCROSS', 'SJ_FULLMOONKICK', 'SJ_STAREMPEROR', 'SR_EARTHSHAKER', 'RK_DRAGONHOWLING'])
		for (const r of rows(skill))
			assert.match(r, /enemy_count_nearby/, `${skill} must need an enemy near: ${r}`);
	assert.match(gen, /if meta\["hits"\] and status:[\s\S]{0,200}enemy_count_nearby/,
		'the generator must not write a self attack as a self buff');
});

test('area heals go where the party is hurt, and Frost Diver skips a frozen enemy', () => {
	for (const skill of ['PR_SANCTUARY', 'CR_SLIMPITCHER'])
		for (const r of rows(skill))
			assert.doesNotMatch(r, /enemy_count_nearby/, `${skill} heals, it is not placed on enemies: ${r}`);
	for (const r of rows('MG_FROSTDIVER'))
		assert.match(r, /not_enemy_status, CondValue: SC_FREEZE/, r);
});
