// Guards the companion ammo lists against items the era's item db lacks (#256).
//
// population_shell_ammo.cpp stocks companions from fixed arrow and bullet lists. Elven and
// Hunting Arrows (1773, 1774) and the renewal bullets (13215-13221, 13228-13232) exist only in
// db/re, so on a pre-renewal world each restock looked them up, printed an itemdb_search
// warning, and stocked nothing. They are compiled only under RENEWAL.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'third-party', 'population-engine', 'files', 'src', 'map',
	'population_engine', 'runtime', 'population_shell_ammo.cpp'), 'utf8');

/** Every ammo id in the file, with the era it is compiled for: 're', 'pre' or 'both'. */
function ammoEras() {
	const eras = new Map();
	const stack = [];
	for (const line of src.split('\n')) {
		const t = line.trim();
		if (t.startsWith('#ifdef RENEWAL')) { stack.push('re'); continue; }
		if (t.startsWith('#ifndef RENEWAL')) { stack.push('pre'); continue; }
		if (t.startsWith('#endif')) { stack.pop(); continue; }
		for (const m of line.matchAll(/\{ (\d+), AMMO_/g)) eras.set(Number(m[1]), stack.at(-1) ?? 'both');
	}
	return eras;
}

const RENEWAL_ONLY = [1773, 1774, 13215, 13216, 13217, 13218, 13219, 13220, 13221, 13228, 13229, 13230, 13231, 13232];

test('renewal-only arrows and bullets are compiled only for renewal', () => {
	const eras = ammoEras();
	for (const id of RENEWAL_ONLY) assert.equal(eras.get(id), 're', String(id));
	// The rest of both lists still stocks in either era.
	for (const id of [1750, 1772, 13200, 13201]) assert.equal(eras.get(id), 'both', String(id));
});

// With the pinned rAthena checked out (scripts/vendor fetch), every id compiled for an era
// must exist in that era's item db. Skipped where vendor/ isn't present, as in a bare checkout.
const DB = path.join(ROOT, 'vendor', 'rathena', 'db');
test('every compiled ammo id exists in its era\'s item db', { skip: !fs.existsSync(DB) && 'vendor/rathena not checked out' }, () => {
	const ids = (era) => {
		const dir = path.join(DB, era);
		const found = new Set();
		for (const f of fs.readdirSync(dir).filter((f) => /^item_db.*\.yml$/.test(f)))
			for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\s*- Id: (\d+)$/gm)) found.add(Number(m[1]));
		return found;
	};
	const pre = ids('pre-re');
	const re = ids('re');
	for (const [id, era] of ammoEras()) {
		if (era !== 're') assert.ok(pre.has(id), `${id} is compiled for pre-renewal but missing from db/pre-re`);
		if (era !== 'pre') assert.ok(re.has(id), `${id} is compiled for renewal but missing from db/re`);
	}
});
