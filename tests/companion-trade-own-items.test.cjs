// Guards companion trades against touching the companion's own things (#290).
//
// After a trade, population_engine_companion_equip_traded equipped every unworn item in the
// companion's bag and handed what it pushed off to the owner. The bag also holds the companion's
// own things - spare stacks of every arrow it stocks, its own gear a traded piece pushed off - so
// giving a Minstrel an instrument handed its Ballista and thousands of arrows to the player, onto
// the floor when the bag was full. Patch 0024 snapshots the companion's inventory before the
// items move; the equip pass now acts only on a new item in a slot, or a stack that grew.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
// Windows checks out CRLF; the patterns below are written against LF.
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const patch = read('third-party/population-engine/patches/0025-companion-trade-snapshot.patch');
const engine = read('third-party/population-engine/files/src/map/population_engine.cpp');

test('trade_tradecommit snapshots both sides before the items move', () => {
	const hunk = /\+\tif \(population_engine_is_population_pc\(sd->id\)\)\n\+\t\tpopulation_engine_companion_trade_snapshot\(sd\);\n\+\tif \(population_engine_is_population_pc\(tsd->id\)\)\n\+\t\tpopulation_engine_companion_trade_snapshot\(tsd\);\n\+\n \t\/\/ trade is accepted and correct\./;
	assert.match(patch, hunk);
});

test('the equip pass acts only on what the trade brought in', () => {
	const fn = /void population_engine_companion_equip_traded\([^)]*\)\n\{([\s\S]*?)\n\}\n/.exec(engine);
	assert.ok(fn, 'equip_traded found');
	assert.match(fn[1], /before\.swap\(shell->pop\.companion_trade_before\);/, 'the snapshot is consumed');
	assert.match(fn[1], /it\.nameid\) != before\[i\]\.first \|\| static_cast<int32_t>\(it\.amount\) > before\[i\]\.second/,
		'a new item in the slot, or a stack that grew');
	assert.match(fn[1], /if \(!slot\.nameid \|\| slot\.equip\) continue;\n\t\tif \(!traded\(i\)\) continue;/,
		'untraded items are neither equipped nor handed back');
	const snap = /void population_engine_companion_trade_snapshot\([^)]*\)\n\{([\s\S]*?)\n\}\n/.exec(engine);
	assert.ok(snap, 'snapshot function found');
	assert.match(snap[1], /before\.assign\(MAX_INVENTORY, \{0, 0\}\);/);
});
