// Guards the Weapon rules setting (#290: "Weapon requirement for skills are ignored").
//
// skill_get_requirement returns early for population PCs, before the weapon, ammo and item
// requirements, so companions used any skill with any weapon. Settings -> Population ->
// Weapon rules turns on population_engine_skill_weapon_check: the server then keeps the
// weapon requirement for them (ammo and items stay relaxed), and the engine passes over a
// skill the held weapon can't use instead of having it refused every turn. Off is the default.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
// Windows checks out CRLF; the patterns below are written against LF.
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const patch = read('third-party/population-engine/patches/0023-skill-weapon-check.patch');
const combat = read('third-party/population-engine/files/src/map/population_engine/runtime/population_engine_combat.cpp');
const settings = read('src/settings.html');
const main = read('electron/main.js');

test('the server option is registered, off by default, 0 to 1', () => {
	assert.match(patch, /^\+\{ "population_engine_skill_weapon_check",&battle_config\.population_engine_skill_weapon_check,0,0,1,\},$/m);
	assert.match(patch, /^\+int32 population_engine_skill_weapon_check;$/m);
});

test('with the option on, population PCs keep only the weapon requirement', () => {
	const hunk = /\+\tif \(population_engine_is_population_pc\(sd->id\)\) \{\n([\s\S]*?)\n \t\treturn req;\n\+\t\}/.exec(patch);
	assert.ok(hunk, 'the early return gains a block');
	assert.match(hunk[1], /if \(battle_config\.population_engine_skill_weapon_check\)\n\+\t\t\treq\.weapon = skill->require\.weapon;/);
	assert.ok(!/req\.(ammo|itemid|amount)/.test(hunk[1]), 'ammo and items stay relaxed');
});

test('the picker passes over a skill the held weapon cannot use', () => {
	const fn = /static bool pop_skill_weapon_ok\([^)]*\)\n\{([\s\S]*?)\n\}/.exec(combat);
	assert.ok(fn, 'pop_skill_weapon_ok exists');
	assert.match(fn[1], /if \(!battle_config\.population_engine_skill_weapon_check\)\n\t\treturn true;/);
	assert.match(fn[1], /weapon == 0 \|\| pc_check_weapontype\(sd, weapon\)/);
	const gate = /static inline bool pop_skill_cond_satisfied\([^)]*\) \{\n\tif \(!pop_skill_weapon_ok\(sd, sk\.skill_id\)( \|\| [^)]*\))?\)\n\t\treturn false;/;
	assert.match(combat, gate, 'every row goes through the weapon check first');
});

test('Settings offers the choice, off by default, and explains it', () => {
	assert.match(main, /population_skill_weapon_check: false,/);
	assert.match(settings, /id="population_skill_weapon_check"/);
	assert.match(settings, /settings\.population_skill_weapon_check = \$\('population_skill_weapon_check'\)\.checked;/);
	assert.match(settings, /\$\('population_skill_weapon_check'\)\.checked = s\.population_skill_weapon_check === true;/);
	assert.match(settings, /id="weapon-check-note"/);
	assert.match(settings, /Arrows, gemstones and other items are still never needed/);
});
