'use strict';
// Hired companions (Settings -> Population -> Companions): the engine, the
// rAthena patch, the recruiter NPC and the Companions panel have to agree on
// one set of rules. These read the sources, as the other companion tests do;
// the C++ is compiled by images.yml.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const engine = read('third-party/population-engine/files/src/map/population_engine.cpp');
const patch = read('third-party/population-engine/patches/0022-companion-hire.patch');
const npc = read('third-party/population-engine/files/npc/custom/population/recruiter.txt');
const panel = read('patches/CompanionPanel.js');

test('@companion draft goes through the hiring rules, and terms reports them', () => {
	assert.match(patch, /\+\t\tconst uint32_t made = population_engine_companion_hire\(sd, job_id, chosen\[0\] \? chosen : nullptr, false, why\);/,
		'the panel and anyone typing @companion draft are held to the rules (from_npc = false)');
	assert.match(patch, /^-\t\tconst uint32_t made = population_engine_companion_draft\(/m, 'and no longer draft directly');
	assert.match(patch, /\+\tif \(strcmpi\(cmd, "terms"\) == 0\) \{/);
	for (const key of ['companion_hire', 'companion_hire_zeny_per_level', 'companion_hire_item', 'companion_hire_item_amount'])
		assert.match(patch, new RegExp(`\\+\\{ "population_engine_${key}",`), key);
});

test('a hired companion is the owner\'s tier and level, and is paid for only once it exists', () => {
	const hire = engine.slice(engine.indexOf('uint32_t population_engine_companion_hire('), engine.indexOf('void population_engine_companion_terms('));
	assert.match(hire, /if \(mode == 2 && !from_npc\)/, 'recruiter mode refuses the panel');
	assert.match(hire, /pop_hire_allowed\(owner, job_id, msg\)/, 'tier and fee are checked before drafting');
	const draft = hire.indexOf('population_engine_companion_draft(owner, job_id, 1, name_hint, sex);\n\tg_pop_draft_level = 0;');
	assert.ok(draft > 0, 'the draft runs at the owner\'s level, and the override is cleared at once');
	assert.ok(hire.indexOf('pc_payzeny(') > draft && hire.indexOf('pc_delitem(') > draft, 'paid only after a successful draft');
	assert.match(engine, /if \(g_pop_draft_level > 0\)\n\t\t\trolled = /, 'spawn_shell takes the owner\'s level, within the profile band');
});

test('the recruiter is registered, hides unless recruiter mode is on, and hires through the engine', () => {
	assert.match(patch, /\+npc: npc\/custom\/population\/recruiter\.txt/);
	assert.match(npc, /OnInit:\n\tif \(getbattleflag\("population_engine_companion_hire"\) != 2\)\n\t\tdisablenpc strnpcinfo\(0\);/);
	assert.match(npc, /companion_hire\(\.@list\$\[\.@i\]\)/);
	for (const cmd of ['companion_hire_jobs', 'companion_hire_fee', 'companion_hire'])
		assert.match(patch, new RegExp(`\\+BUILDIN_DEF\\(${cmd}, `), cmd);
	assert.ok(npc.split('\n').filter(l => /\tduplicate\(CompanionRecruiter\)\t/.test(l)).length >= 10, 'one in every main town');
});

test('the panel reads the terms before the roster parser sees the line, and draws by mode', () => {
	assert.match(panel, /parseSkillLine\(text\) \|\| parseTermsLine\(text\) \|\| parseRosterLine\(text\)/,
		'parseRosterLine would otherwise let @CPTERMS through to chat');
	assert.match(panel, /talk\('@companion terms', false\);/);
	assert.match(panel, /if \(t && t\.mode === 2\) \{/);
	assert.match(panel, /tiers = t\.jobs\.length \? \[\['Your tier', t\.jobs\]\] : \[\];/);
});
