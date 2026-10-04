'use strict';
// The app and a headless server must turn one settings.json into one server.
//
// The desktop app generates conf/battle_conf.txt in JavaScript (toBattleConf in
// electron/main.js). `ragnarok-stack serve` runs where there is no JavaScript,
// so the supervisor carries a port of it (stack/src/settings.rs). Two copies of
// a generator are two things that will drift, so this runs both on the same
// settings and fails on any difference -- in the defaults, in the output for
// settings the app writes, and in the output for the hand-edited files the
// port's JavaScript coercions exist for.
//
// main.js is read as it is, not refactored for this test, so pulling upstream
// never conflicts here. When upstream changes the generator, this fails and
// names the line: port the change to settings.rs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

// The top-level declarations toBattleConf needs, cut out of main.js by name
// and run on their own. Each runs from its first line to the first line that
// closes it at column 0; a one-line `const` is complete as it stands.
function fromMain(names) {
	const lines = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8').split(/\r?\n/);
	const parts = names.map(name => {
		const start = lines.findIndex(l => new RegExp(`^(const|function) ${name}\\b`).test(l));
		assert.ok(start >= 0, `electron/main.js no longer declares ${name} at the top level; update this test and stack/src/settings.rs`);
		if (/;\s*$/.test(lines[start])) return lines[start];
		const end = lines.findIndex((l, i) => i > start && /^\};?\s*$/.test(l));
		return lines.slice(start, end + 1).join('\n');
	});
	const electronRequire = id => require(id.startsWith('./') ? path.join(__dirname, '../electron', id) : id);
	const sandbox = { require: electronRequire, Object, Number, Math, String };
	vm.runInNewContext(`${parts.join('\n')}\nthis.out = { ${names.join(', ')} };`, sandbox);
	return sandbox.out;
}
const { SETTINGS_DEFAULTS, toBattleConf } = fromMain([
	'SETTINGS_DEFAULTS', 'ASPD_STOCK', 'PARAM_STOCK', 'aspdConf', 'parameterConf', 'expRatesRaised', 'toBattleConf',
]);

const skip = process.env.STACK_BIN ? false : 'needs STACK_BIN';

function stack(state, args) {
	const result = spawnSync(process.env.STACK_BIN, args, {
		encoding: 'utf8',
		env: { ...process.env, RAGNAROKMAC_STATE: state, RAGNAROK_OFFLINE_HOME: state },
		timeout: 15000,
	});
	assert.equal(result.status, 0, `ragnarok-stack ${args.join(' ')}: ${result.stderr}`);
	return result.stdout;
}

function rustBattleConf(settings) {
	const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ro-parity-'));
	try {
		fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify(settings));
		return stack(state, ['settings', 'battle-conf']);
	} finally {
		fs.rmSync(state, { recursive: true, force: true });
	}
}

// What the app does: settings-store.js fills the defaults in, then toBattleConf.
const jsBattleConf = settings => toBattleConf({ ...SETTINGS_DEFAULTS, ...settings });

test('the defaults agree, key for key', { skip }, () => {
	const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ro-parity-'));
	try {
		// Through JSON: the sandbox's objects have its own Object prototype.
		assert.deepEqual(JSON.parse(stack(state, ['settings', 'defaults'])), JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)));
	} finally {
		fs.rmSync(state, { recursive: true, force: true });
	}
});

test('settings the Settings window writes generate the same server', { skip }, () => {
	const cases = [
		{},
		{ base_exp_rate: 500, job_exp_rate: 500, quest_exp_rate: 200 },
		{ item_rate_common: 300, item_rate_equip: 150, item_rate_card: 1000 },
		{ mob_count_rate: 200, zeny_from_mobs: true, unlimited_arrows: true },
		{ max_aspd: 195, max_parameter: 255 },
		{ max_aspd: 150, max_parameter: 50 },
		{ view_distance: 'wide' },
		{ view_distance: 'ultrawide' },
		{ population_enable: true, population_max: 800, population_density: 250, population_companion_limit: 11 },
		{ population_town_pct: 40, population_field_pct: 0, population_dungeon_pct: 75 },
		{ population_companion_hire: 'npc', population_companion_fee_zeny: 5000, population_companion_fee_item: 7227, population_companion_fee_item_amount: 3 },
		{ population_companion_hire: 'panel' },
	];
	for (const settings of cases) {
		assert.equal(rustBattleConf(settings), jsBattleConf(settings), JSON.stringify(settings));
	}
});

// mulberry32: the same sequence on every run and every platform, so a failure
// here reproduces.
function prng(seed) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// What a hand-edited settings.json might hold: out-of-range numbers, numbers
// as text, blanks, nulls, the wrong type. Nothing so large that JavaScript
// prints it in exponent form, which no setting has a use for.
const VALUES = [
	0, -1, 1, 1.5, 4, 11, 12, 99, 100, 101, 150, 150.5, 190, 195, 199, 250, 500, 1000, 5000,
	32767, 40000, 2147483647, '', ' ', 'abc', '200', ' 300 ', '0x10', '1e3', '-0x10', '.5',
	null, true, false, [], [5], ['wide'], {}, 'official', 'wide', 'ultrawide', 'huge',
	'free', 'panel', 'npc', 'constructor', '__proto__',
];

test('hand-edited settings generate the same server', { skip }, () => {
	const random = prng(20221005);
	const keys = Object.keys(SETTINGS_DEFAULTS);
	for (let i = 0; i < 150; i++) {
		const settings = {};
		for (const key of keys) {
			if (random() < 0.5) settings[key] = VALUES[Math.floor(random() * VALUES.length)];
		}
		assert.equal(rustBattleConf(settings), jsBattleConf(settings), JSON.stringify(settings));
	}
});
