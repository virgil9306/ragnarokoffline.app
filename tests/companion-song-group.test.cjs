// Guards for the "one at a time" group in the companion skill picker (#290 item 15).
//
// Songs, dances and some stances end each other (status EndOnStart), so a companion can keep
// only one of them up, and with several ticked the one listed first plays. The picker mixed
// them in with everything else, so a player could not tell which of the ticks competed. The
// server now flags each listed skill that ends, or is ended by, another listed skill, and the
// panel shows those first, under their own heading and a note on how the choice works.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const engine = read('third-party', 'population-engine', 'files', 'src', 'map', 'population_engine.cpp');
const js = read('patches', 'CompanionPanel.js');

function fn(src, name) {
	const start = src.indexOf(name);
	assert.ok(start >= 0, `${name} must exist`);
	return src.slice(start, src.indexOf('\n}\n', start));
}

test('the server flags skills that end another listed skill, but not a chain step', () => {
	const ends = fn(engine, 'static bool pop_skill_ends_skill(');
	assert.match(ends, /status_db\.getEndOnStart\(sa\)/);
	assert.match(ends, /require\.status/, 'a status the skill needs is a chain, not a rival');
	assert.match(ends, /SC_COMMON_MIN && s[ab] <= SC_COMMON_MAX/, 'an ailment a skill inflicts on its caster is no buff');
	assert.match(ends, /#ifndef RENEWAL[\s\S]*INF2_ISSONG, INF2_ISENSEMBLE[\s\S]*#endif/,
		'pre-renewal performances end each other without a status naming the other');
	const self = fn(engine, 'static std::vector<uint16_t> pop_companion_self_buff_ids(');
	assert.match(self, /e\.target == 1/, 'only self buffs compete; a debuff on an enemy is no choice');
	const excl = fn(engine, 'static bool pop_skill_is_exclusive(');
	assert.match(excl, /pop_skill_ends_skill\(sid, other\) \|\| pop_skill_ends_skill\(other, sid\)/,
		'either direction counts');
	const list = fn(engine, 'void population_engine_companion_skill_list(');
	assert.match(list, /"@CPSK\|%u\|%s\|%d\|%u\|%d"/, 'the flag is a sixth field');
	assert.match(list, /pop_skill_is_exclusive\(sid, self_buffs\)/);
});

test('the panel reads the flag and lists those skills first, under their own heading', () => {
	const parse = fn(js, 'function parseSkillLine(');
	assert.match(parse, /exclusive: p\[5\] === '1'/);
	assert.match(parse, /p\.length < 5/, 'a five-field line from an older server still parses');
	const overlay = fn(js, 'function _skillPickerOverlay(');
	assert.match(overlay, /_skills\.filter\(s => s\.exclusive\)\.concat\(_skills\.filter\(s => !s\.exclusive\)\)/,
		'the group keeps the server order, which is the companion\'s preference order');
	assert.match(overlay, /s\.exclusive \? EXCLUSIVE_GROUP : _skillGroupOf\(s\.name\)/);
	assert.match(overlay, /Only one of these can run at a time/, 'the group explains the choice');
	assert.match(js, /const EXCLUSIVE_GROUP = '[^']+';/);
});
