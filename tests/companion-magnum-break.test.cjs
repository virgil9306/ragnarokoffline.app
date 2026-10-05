// Guards for Magnum Break on the Swordsman lines (#290).
//
// Nine Knight- and Crusader-line blocks kept SM_MAGNUM up as a self buff, gated only on
// `not_self_status SC_WATK_ELEMENT`. Self buffs are maintained whether or not anything is in
// reach, and the fire bonus lasts 10 seconds, so a companion cast Magnum Break every 10 seconds
// in town and on empty fields. It is an area attack around the caster: it belongs in the attack
// rotation, which only runs while the companion fights a target, gated on a crowd - the row the
// Swordsman block already carries.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const YAML = path.join(ROOT, 'third-party', 'population-engine', 'files', 'db', 'population_skill_db.yml');
const yaml = fs.readFileSync(YAML, 'utf8').replace(/\r\n/g, '\n');

const rows = yaml.split('\n').filter((l) => /SkillId: SM_MAGNUM\b/.test(l));

test('Magnum Break is never kept up as a self buff', () => {
	assert.ok(rows.length > 0);
	for (const r of rows) {
		assert.ok(!/Target: self/.test(r), `self-buff Magnum Break row: ${r.trim()}`);
		assert.ok(!/SC_WATK_ELEMENT/.test(r), `Magnum Break gated on its fire bonus: ${r.trim()}`);
	}
});

test('Magnum Break is cast in combat when enemies crowd the companion', () => {
	for (const r of rows)
		assert.ok(/Condition: enemy_count_nearby, CondValue: 2 \}/.test(r), r.trim());
});

// enemy_count_nearby counts the whole detection range (30 cells), so the crowd that let a Lord
// Knight cast Magnum Break could be well outside its 5x5 blast. For a blast centred on the caster
// the gate counts only enemies inside the skill's splash.
const COMBAT = path.join(ROOT, 'third-party', 'population-engine', 'files', 'src', 'map',
	'population_engine', 'runtime', 'population_engine_combat.cpp');
const combat = fs.readFileSync(COMBAT, 'utf8').replace(/\r\n/g, '\n');

test('a blast around the caster counts only the enemies inside its splash', () => {
	const radius = /static int pop_self_blast_radius\([^)]*\)\n\{([\s\S]*?)\n\}/.exec(combat);
	assert.ok(radius, 'pop_self_blast_radius must exist');
	assert.match(radius[1], /INF_SELF_SKILL/);
	assert.match(radius[1], /skill_get_range\(skill_id, skill_lv\) > 1/);
	assert.match(radius[1], /skill_get_splash\(skill_id, skill_lv\)/);

	const gate = /static inline bool pop_skill_cond_satisfied\([^)]*\) \{([\s\S]*?)\n\}/.exec(combat);
	assert.ok(gate, 'pop_skill_cond_satisfied must exist');
	const body = gate[1];
	const blast = body.indexOf('PopSkillCondition::EnemyCountNearby');
	assert.ok(blast >= 0, 'the gate must special-case enemy_count_nearby');
	assert.ok(blast < body.indexOf('if (sk.expanded)'), 'the blast count runs before the flat check');
	assert.match(body, /pop_enemies_within\(sd, radius\) >= static_cast<int>\(sk\.cond_value_num\)/);
});

// In the plain round robin Magnum Break was one of a Lord Knight's 13 attack slots, so even with
// ten monsters on it the companion spent nearly every turn on single-target skills. A blast whose
// crowd is inside it goes first, unless it is on its own cooldown.
test('a blast with its crowd inside it is tried first', () => {
	const pick = combat.slice(combat.indexOf('static void population_shell_pick_attack_skill'));
	const body = pick.slice(0, pick.indexOf('\n}\n'));
	const promote = body.indexOf('pop_self_blast_radius(sk.skill_id, sk.skill_lv) == 0');
	assert.ok(promote >= 0, 'the picker must promote a blast around the caster');
	const block = body.slice(body.lastIndexOf('for (size_t i = 0; i < n; ++i)', promote), body.indexOf('break;', promote));
	assert.match(block, /PopSkillCondition::EnemyCountNearby/);
	assert.match(block, /sd->scd\.find\(sk\.skill_id\) != sd->scd\.end\(\)/);
	// Pre-renewal Magnum Break has no cooldown, only an after-cast delay: skip it while that runs.
	assert.match(block, /DIFF_TICK\(now_tick, sd->ud\.canact_tick\) < 0/);
	assert.match(block, /pop_skill_cond_satisfied\(sd, sk, target_bl\)/);
	assert.match(block, /combo_promote_idx = i;/);
	assert.ok(promote < body.indexOf('const bool use_cursor'), 'the promotion runs before the cursor is chosen');
});
