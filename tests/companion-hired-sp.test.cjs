// A hired companion healed and buffed nobody until a relog. The draft wrote spawn_shell's
// HP/SP placeholders AFTER the spawn had calculated and filled them, and the skill AI judged
// SP from that stored field rather than the live one, so the companion believed it had 1 SP.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const SRC = path.join(__dirname, '..', 'third-party', 'population-engine', 'files', 'src', 'map');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n');
const engine = read('population_engine.cpp');

test('a drafted companion keeps the HP and SP its spawn gave it', () => {
	const i = engine.indexOf('uint32_t population_engine_companion_draft(');
	assert.ok(i > 0);
	const body = engine.slice(i, engine.indexOf('\n}\n', i));
	assert.ok(!/shell->status\.(max_)?(hp|sp) = /.test(body),
		'the draft must not overwrite HP or SP after spawn_shell has set them');
});

test('the skill AI judges SP by the live value, which casting spends', () => {
	for (const f of ['population_engine/runtime/population_engine_combat.cpp',
		'population_engine/runtime/population_shell_runtime.cpp']) {
		const src = read(f);
		assert.ok(!/sd->status\.(max_)?sp\b/.test(src),
			`${f} must read battle_status.sp / max_sp: status.sp is the stored value, which a cast never lowers`);
	}
});
