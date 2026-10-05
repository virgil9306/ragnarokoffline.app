// Guards for Soul Gathering on the Soul Ascetic (#290 item 11).
//
// The issue read the Soul Ascetic's `sp_below 50` row as a sign that companions never run low on
// SP. They do: they spend SP and regenerate it like players. The row was wrong instead. Soul
// Gathering restores no SP; it fills Soul Energy to its cap (soulgathering.cpp:
// 5 + 3 x SP_SOULENERGY), and skill_check_condition_castbegin refuses it unless Soul Collect is up.
// Gated on SP, it fired at random against the thing it refills and failed whenever Soul Collect was
// down. It now fires when Soul Collect is up and the Soul Energy has run out.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const yaml = fs.readFileSync(path.join(ROOT, 'third-party', 'population-engine', 'files', 'db',
	'population_skill_db.yml'), 'utf8').replace(/\r\n/g, '\n');

function block(jobId) {
	const m = new RegExp(`\\n  - JobId: ${jobId}\\n`).exec(yaml);
	assert.ok(m, `job ${jobId} must have a curated block`);
	const start = m.index + m[0].length;
	const next = yaml.indexOf('\n  - JobId: ', start);
	return yaml.slice(start, next < 0 ? yaml.length : next);
}

test('the Soul Ascetic gathers Soul Energy when it has run out, not when SP is low', () => {
	const body = block(4303);
	const row = /\n      - SkillId: SOA_SOUL_GATHERING\n((?:        .*\n)+)/.exec(body);
	assert.ok(row, 'the Soul Ascetic keeps a Soul Gathering row');
	assert.match(row[1], /Condition:\n\s+AND:\n\s+- self_soulcollect\n\s+- not_self_soulenergy\n/,
		'it needs Soul Collect up and no Soul Energy left');
	assert.ok(!/Target: (self|ally)/.test(row[1]), 'it stays in the combat rotation');
});

test('no row gates Soul Gathering on SP', () => {
	assert.ok(!/SkillId: SOA_SOUL_GATHERING,[^}]*sp_below/.test(yaml));
});
