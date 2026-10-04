// Issue #290: "Summoning from the UI is always female" and "benching and resummoning or server
// restart/relog always swaps gender ... the first time". spawn_shell takes the sex as 'M' or 'F';
// the draft passed rnd() % 2, and recall read rAthena's e_sex (0 = SEX_FEMALE) the wrong way round.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const engine = fs.readFileSync(path.join(__dirname, '..', 'third-party', 'population-engine', 'files', 'src',
	'map', 'population_engine.cpp'), 'utf8').replace(/\r\n/g, '\n');

function body(signature) {
	const i = engine.lastIndexOf(signature);
	assert.ok(i >= 0, `expected to find ${signature}`);
	return engine.slice(i, engine.indexOf('\n}\n', i));
}

test('spawn_shell reads the sex as a letter', () => {
	assert.match(engine, /sd->status\.sex = \(sex == 'M' \? SEX_MALE : SEX_FEMALE\);/);
});

test('a hired companion is given a letter, and a job with its own sex keeps it', () => {
	const draft = body('uint32_t population_engine_companion_draft(');
	assert.ok(!/sex = static_cast<uint8_t>\(rnd\(\) % 2\)/.test(draft), 'a number is never \'M\', so always female');
	assert.match(draft, /char sex = get_job_required_sex\(job_id\);/);
	assert.match(draft, /\(rnd\(\) % 2\) \? 'M' : 'F'/);
});

test('recall reads the saved sex as rAthena\'s e_sex', () => {
	const recall = body('int population_engine_recall_companions(');
	assert.ok(!/sexv == 1 \? 'F' : 'M'/.test(recall), '1 is SEX_MALE');
	assert.match(recall, /sexv == SEX_MALE \? 'M' : 'F'/);
	assert.match(recall, /get_job_required_sex\(/, 'a Bard is male whatever the row says');
	// The row is written from status.sex, i.e. e_sex - which is what makes the read above right.
	assert.match(engine, /\(int\)sd->status\.sex,/);
});
