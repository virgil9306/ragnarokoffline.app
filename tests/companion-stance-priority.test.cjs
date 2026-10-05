// Guards for stances that end each other (#290 item 15 testing).
//
// A Star Emperor's stances have no duration: each lasts until another ends it. The self-buff
// loop protects a buff from an earlier row only through its dispatch record, and a cast with no
// duration is never recorded, so the protection never applied: with Lunar and Star Stance both
// ticked, each row saw its own stance missing and cast it, ending the other, back and forth.
// A stance from an earlier row the companion holds now outranks the later row by itself.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const combat = fs.readFileSync(path.join(ROOT, 'third-party', 'population-engine', 'files', 'src', 'map',
	'population_engine', 'runtime', 'population_engine_combat.cpp'), 'utf8').replace(/\r\n/g, '\n');

test('a held stance with no duration outranks a later row that would end it', () => {
	const start = combat.indexOf('static bool pop_buff_would_end_own(');
	const body = combat.slice(start, combat.indexOf('\n}\n', start));
	const held = body.slice(body.indexOf('auto held_own = '));
	const stance = held.indexOf('skill_get_time(own.skill_id, skill_get_max(own.skill_id)) <= 0');
	assert.ok(stance > 0, 'a buff with no duration must be protected while held');
	assert.ok(stance < held.indexOf('active_buffs'), 'without needing a dispatch record');
	assert.match(body, /!scc->hasSCE\(own_sc\)\)\s*continue;/, 'only while the companion holds it');
});

// Banding ends Prestige and rAthena refuses Prestige while Banding is up; Maximum Power Thrust
// ends Power-Thrust at its next refresh. Neither ends the other back, so the check above never
// fired: a Royal Guard tried Prestige 63 times under Banding, a Whitesmith recast Power-Thrust
// only for Maximum Power Thrust to wipe it.
test('a buff that a held buff would end is not cast either', () => {
	const start = combat.indexOf('static bool pop_buff_would_end_own(');
	const body = combat.slice(start, combat.indexOf('\n}\n', start));
	assert.match(body, /const std::vector<sc_type> own_ends = status_db\.getEndOnStart\(own_sc\);/);
	assert.match(body, /std::find\(own_ends\.begin\(\), own_ends\.end\(\), sc_id\) != own_ends\.end\(\) && held_own\(own\)/);
	assert.doesNotMatch(body, /if \(ends\.empty\(\)\)\s*return false;/, 'a buff that ends nothing can still be ended');
});
