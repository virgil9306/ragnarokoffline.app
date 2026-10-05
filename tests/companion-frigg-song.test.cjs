// Guards Frigg's Song on Minstrel and Wanderer companions (#290).
//
// Frigg's Song is a party buff, not a heal: friggssong.cpp starts SC_FRIGG_SONG on the party
// for 60 s, which raises MaxHP and restores HP every second while it lasts. It was curated like
// an emergency heal, on hp_below 30, so the performer only sang it when nearly dead. It is kept
// up like the other songs instead, as the Troubadour and Trouvere rows already do.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const yaml = fs.readFileSync(path.join(ROOT, 'third-party', 'population-engine', 'files', 'db',
	'population_skill_db.yml'), 'utf8');

test('Frigg\'s Song is kept up as a buff, not gated on low HP', () => {
	const rows = yaml.split('\n').filter((l) => /SkillId: WM_FRIGG_SONG\b/.test(l));
	assert.ok(rows.length >= 6, 'Minstrel, Wanderer, Troubadour and Trouvere rows expected');
	for (const row of rows) {
		assert.ok(!/Condition: hp_below/.test(row), row);
		assert.match(row, /Target: self, Condition: not_self_status, CondValue: SC_FRIGG_SONG/);
	}
});
