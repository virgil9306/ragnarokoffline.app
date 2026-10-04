// Guards against Warp Portal on companions (#290).
//
// Casting Warp Portal opens a destination menu on the caster's own client (warpportal.cpp sends
// clif_skill_warppoint), and the portal is only made once a destination is picked there. A
// companion has no client, so no portal ever appeared; its rows, gated on two enemies nearby,
// spent a cast and its after-cast delay in the middle of a fight for nothing. Nothing lets the
// player choose a destination for a companion either, so it is not curated, and the generator
// must not put it back.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const yaml = fs.readFileSync(path.join(ROOT, 'third-party', 'population-engine', 'files', 'db',
	'population_skill_db.yml'), 'utf8');
const gen = fs.readFileSync(path.join(ROOT, 'scripts', 'gen-population-skill-presets.py'), 'utf8');

test('no companion casts Warp Portal, and the generator skips it', () => {
	assert.ok(!/SkillId: AL_WARP\b/.test(yaml));
	const skip = /SKIP = re\.compile\(([\s\S]*?)\n\)/.exec(gen);
	assert.ok(skip && /\|AL_WARP"/.test(skip[1]), 'AL_WARP must be in the generator\'s SKIP list');
});
