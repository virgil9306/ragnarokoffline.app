// Guards for songs and other mutually exclusive buffs (#290 item 8).
//
// A Bard's Whistle, Assassin Cross, Bragi and Apple of Idun end each other (status EndOnStart),
// and so do a Dancer's dances, the ensembles and the 3rd-job songs. The self-buff loop cast each
// one as soon as its own status was missing, so every song wiped the one before it, and the
// dispatch record (active_buffs) then kept the wiped song from coming back for its full duration.
// The loop now skips a buff that would end one the companion cast itself from an earlier row:
// list order is the priority, so the first song holds until it runs out.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const PE = path.join(ROOT, 'third-party', 'population-engine', 'files');
const combat = fs.readFileSync(path.join(PE, 'src', 'map', 'population_engine', 'runtime',
	'population_engine_combat.cpp'), 'utf8').replace(/\r\n/g, '\n');
const yaml = fs.readFileSync(path.join(PE, 'db', 'population_skill_db.yml'), 'utf8').replace(/\r\n/g, '\n');

function fn(name) {
	const start = combat.indexOf(name);
	assert.ok(start >= 0, `${name} must exist`);
	return combat.slice(start, combat.indexOf('\n}\n', start));
}

test('a buff that would end an earlier row\'s own running buff is not cast', () => {
	const body = fn('static bool pop_buff_would_end_own(');
	assert.match(body, /status_db\.getEndOnStart\(sc_id\)/);
	assert.match(body, /if \(&own == &bs\) \{\s*earlier = false;/, 'only rows listed before this one outrank it');
	assert.match(body, /if \(earlier && std::find\(ends\.begin\(\), ends\.end\(\), own_sc\) != ends\.end\(\) && held_own\(own\)\)/);
	assert.match(body, /scc->hasSCE\(own_sc\)/);
	assert.match(body, /sd->pop\.active_buffs/, 'only buffs this shell cast itself count');
	assert.match(body, /ab\.expires_at > now/);
});

// A status the new skill requires is a step in a chain, not a rival. The Inquisitor's Second
// Judge ends First Faith Power and requires it (renewal status.yml, skill_db.yml), and Third Exor
// Flame does the same with Second Judge. Without the exemption the gate refused Judge every time
// it could be cast, and the faith chain stopped at its first step.
test('a buff may end a running buff that its own skill requires', () => {
	const body = fn('static bool pop_buff_would_end_own(');
	assert.match(body, /skill_db\.find\(bs\.skill_id\)/);
	assert.match(body, /skill->require\.status/);
	const exempt = body.search(/std::find\(required\.begin\(\), required\.end\(\), own_sc\) != required\.end\(\)\)\s*continue;/);
	assert.ok(exempt >= 0, 'a required status must not count as one the buff would end');
	assert.ok(exempt < body.indexOf('held_own(own)'), 'the exemption runs before either direction is checked');
});

test('the Inquisitor keeps its faith chain in order', () => {
	const block = yaml.split(/\n(?=  - JobId: )/).find((b) => /^\s*- JobId: 4262\n/.test(b));
	assert.ok(block, 'the 4262 block must exist');
	const row = (id) => {
		const m = new RegExp(`\\{ SkillId: ${id},[^}]*Target: self[^}]*\\}`).exec(block);
		assert.ok(m, `${id} must be a self row in the 4262 block`);
		return m.index;
	};
	const faith = row('IQ_FIRST_FAITH_POWER');
	const judge = row('IQ_JUDGE');
	const exor = row('IQ_THIRD_EXOR_FLAME');
	assert.ok(faith < judge && judge < exor, 'each step must come after the one it requires');
});

test('the self-buff loop consults the gate before it casts', () => {
	const loop = fn('static bool population_shell_cast_expired_self_buffs(');
	const self = loop.indexOf('// --- Self-targeted (target == 1) ---');
	const gate = loop.indexOf('pop_buff_would_end_own(sd, scc, bs, current_tick)', self);
	assert.ok(self >= 0 && gate > self, 'the gate is in the self-targeted branch');
	assert.ok(gate < loop.indexOf('unit_skilluse_id(sd, sd->id, bs.skill_id, use_lv)', self),
		'the gate runs before the cast');
});

// Pre-renewal songs are performances on the ground: the singer holds SC_DANCING while one plays
// and never gets the song's own status, so the EndOnStart gate cannot see it, and a new song would
// stop the one playing. Renewal solo songs never set SC_DANCING, but ensembles are performances in
// both eras, so in renewal this holds Ring of Nibelungen against Siegfried and the like.
test('a song is not started while the companion is performing one', () => {
	const loop = fn('static bool population_shell_cast_expired_self_buffs(');
	const self = loop.indexOf('// --- Self-targeted (target == 1) ---');
	const gate = /if \(scc && scc->hasSCE\(SC_DANCING\) &&\s*skill_get_inf2_\(bs\.skill_id, \{ INF2_ISSONG, INF2_ISENSEMBLE \}\)\)\s*continue;/.exec(loop.slice(self));
	assert.ok(gate, 'the self-targeted branch must skip songs while SC_DANCING is on');
	assert.ok(self + gate.index < loop.indexOf('unit_skilluse_id(sd, sd->id, bs.skill_id, use_lv)', self),
		'the gate runs before the cast');
});

// Pre-renewal Adaptation to Circumstances does nothing but end the performance (amp.cpp). Kept up
// like a buff, it stopped each song 3 s in, once its post-song lockout ended, and the next song in
// the list took over, so the companion cycled through every song. Renewal Adaptation is a real
// buff, so it is skipped in the pre-renewal build only.
test('pre-renewal companions never cast Adaptation to Circumstances', () => {
	const loop = fn('static bool population_shell_cast_expired_self_buffs(');
	const guard = /#ifndef RENEWAL\n[\s\S]*?if \(bs\.skill_id == BD_ADAPTATION\)\s*continue;\n#endif/.exec(loop);
	assert.ok(guard, 'BD_ADAPTATION must be skipped under #ifndef RENEWAL');
	assert.ok(guard.index < loop.indexOf('unit_skilluse_id(sd, sd->id, bs.skill_id, use_lv)', guard.index),
		'the skip runs before the cast');
});

// With list order as the priority, a row ahead of its upgrade would keep the upgrade from ever
// being cast: Max Power-Thrust ends Power-Thrust, so it must come first.
test('Max Power-Thrust is listed before Power-Thrust wherever both appear', () => {
	for (const block of yaml.split(/\n(?=  - JobId: )/)) {
		const max = block.indexOf('SkillId: WS_OVERTHRUSTMAX,');
		const plain = block.indexOf('SkillId: BS_OVERTHRUST,');
		if (max >= 0 && plain >= 0)
			assert.ok(max < plain, `${block.slice(0, 16).trim()}: Max Power-Thrust must come first`);
	}
});

// In renewal Encore only recasts the singer's last song (skill_id_dance) at half SP. Its rows
// waited on `not_self_status SC_DANCING`, which renewal songs never set, so every companion cast it
// each time its 10-second cooldown ended: the current song was recast early, over and over, and
// Dissonance, also a song, could take Whistle's place. The song rows already recast a song when it
// runs out, so Encore is not curated, and the generator must not put it back.
test('no companion casts Encore, and the generator skips it', () => {
	assert.ok(!/SkillId: BD_ENCORE\b/.test(yaml));
	const gen = fs.readFileSync(path.join(ROOT, 'scripts', 'gen-population-skill-presets.py'), 'utf8');
	const skip = /SKIP = re\.compile\(([\s\S]*?)\n\)/.exec(gen);
	assert.ok(skip && /\|BD_ENCORE/.test(skip[1]), 'BD_ENCORE must be in the generator\'s SKIP list');
});
