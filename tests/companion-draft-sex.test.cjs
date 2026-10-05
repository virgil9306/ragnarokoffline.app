'use strict';
// Choosing a companion's sex: `@companion draft <job> [name] [m|f]` and the
// Summon tab's Male / Female / Random. A job that is only ever one sex keeps it.
// These read the sources, as the other companion tests do; the C++ is compiled
// by images.yml.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const engine = read('third-party/population-engine/files/src/map/population_engine.cpp');
const header = read('third-party/population-engine/files/src/map/population_engine.hpp');
const patch = read('third-party/population-engine/patches/0024-companion-draft-sex.patch');
const panel = read('patches/CompanionPanel.js');

test('the draft takes the chosen sex after the job\'s own and before the profile\'s', () => {
	assert.match(header, /population_engine_companion_draft\([^;]*char sex = '\\0'\);/, 'defaulted, so the recruiter\'s call is unchanged');
	assert.match(header, /population_engine_companion_hire\([^;]*std::string &msg, char sex = '\\0'\);/);
	const draft = engine.slice(engine.indexOf('uint32_t population_engine_companion_draft('), engine.indexOf('// Attach it to the owner as a summoned companion'));
	const own = draft.indexOf('char sex = get_job_required_sex(job_id);');
	const chosen = draft.indexOf("if (sex == '\\0' && (chosen_sex == 'M' || chosen_sex == 'F'))");
	const profile = draft.indexOf('sex = prof->sex_override >= 0');
	assert.ok(own > 0 && chosen > own && profile > chosen, 'job, then the choice, then the profile');
	const hire = engine.slice(engine.indexOf('uint32_t population_engine_companion_hire('), engine.indexOf('void population_engine_companion_terms('));
	assert.strictEqual(hire.split('population_engine_companion_draft(owner, job_id, 1, name_hint, sex);').length - 1, 2,
		'free choice and hired drafts both pass it on');
});

test('the sex is saved with the companion, so a recall keeps it', () => {
	// The row is written from status.sex and read back as e_sex; nothing here may bypass that.
	assert.match(engine, /index_, sd->status\.name, \(int16_t\)sd->status\.class_, \(int\)sd->status\.sex,/);
	assert.match(engine, /sex_letter = sexv == SEX_MALE \? 'M' : 'F';/);
});

test('@companion draft reads m|f|male|female as the first or last word after the job', () => {
	assert.match(patch, /^\+\t\tconst int parsed = sscanf\(param, "%31s %63\[\^\\n\]", jobtok, resttok\);/m);
	assert.match(patch, /strcmpi\(word, "m"\) == 0 \|\| strcmpi\(word, "male"\) == 0/);
	assert.match(patch, /strcmpi\(word, "f"\) == 0 \|\| strcmpi\(word, "female"\) == 0/);
	assert.match(patch, /^\+\t\tconst uint32_t made = population_engine_companion_hire\(sd, job_id, chosen\[0\] \? chosen : nullptr, false, why, want_sex\);/m);
	assert.match(patch, /" A %s is always %s\."/, 'a fixed-sex job says why the choice did not apply');
	assert.match(patch, /draft <job> \[name\] \[m\|f\] \| jobs/, 'the usage line lists it');
});

test('the Summon tab offers Male / Female / Random and leaves fixed-sex jobs alone', () => {
	const src = panel.slice(panel.indexOf('const FIXED_SEX = {'), panel.indexOf('/**\n * Which job tier'));
	const table = src.slice(src.indexOf('{'), src.indexOf('};') + 1);
	const FIXED_SEX = new Function(`return (${table});`)();
	const fn = src.slice(src.indexOf('function _draftCommand'));
	const _draftCommand = new Function('FIXED_SEX', `${fn}; return _draftCommand;`)(FIXED_SEX);
	assert.strictEqual(_draftCommand('Knight', 'f'), '@companion draft Knight f');
	assert.strictEqual(_draftCommand('Knight', 'm'), '@companion draft Knight m');
	assert.strictEqual(_draftCommand('Knight', ''), '@companion draft Knight');
	assert.strictEqual(_draftCommand('Bard', 'f'), '@companion draft Bard', 'the engine would keep a Bard male anyway');
	assert.strictEqual(_draftCommand('Trouvere', 'm'), '@companion draft Trouvere');
	for (const job of ['Bard', 'Clown', 'Minstrel', 'Troubadour'])
		assert.strictEqual(FIXED_SEX[job], 'm', job);
	for (const job of ['Dancer', 'Gypsy', 'Wanderer', 'Trouvere'])
		assert.strictEqual(FIXED_SEX[job], 'f', job);
	assert.match(panel, /\[\['m', 'Male'\], \['f', 'Female'\], \['', 'Random'\]\]/);
	assert.match(panel, /talk\(_draftCommand\(job, _preferences\.draftSex \|\| ''\), false\);/);
});
