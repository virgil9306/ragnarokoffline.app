'use strict';
//
// Population engine lines for the generated battle configuration.
//
// Kept in its own module because main.js exports nothing and so nothing here
// could be tested -- which is how a setting went out unclamped before (see
// battle-rates.js). Every number goes through one place, so the Settings
// window and the server always agree on bounds.

// rAthena's MAX_PARTY in our fork is 12, counting the leader, so 11 companions
// is a full party and the UI and this clamp top out there. At 11 no second real
// player can join, which is why the default stays at the historic 4: a party
// that is meant for friends needs room left for them.
const COMPANION_LIMIT_MIN = 4;
const COMPANION_LIMIT_MAX = 11;

/**
 * How busy towns, fields and dungeons are, each 0-100: a share of what "How
 * busy" makes the area. 0 leaves it empty; a save from before these existed
 * (no key) means 100, which is how the world was.
 */
const AREAS = ['town', 'field', 'dungeon'];
function areaShare(s, area) {
	const raw = s[`population_${area}_pct`];
	if (raw === undefined || raw === null || raw === '') return 100;
	const v = Number(raw);
	if (!Number.isFinite(v)) return 100;
	return Math.min(100, Math.max(0, Math.round(v)));
}

function companionLimit(s) {
	const v = Number(s.population_companion_limit);
	if (!Number.isFinite(v)) return COMPANION_LIMIT_MIN;
	return Math.min(COMPANION_LIMIT_MAX, Math.max(COMPANION_LIMIT_MIN, Math.round(v)));
}

/**
 * Companions: free choice (0, as before), hired from the Companions panel (1)
 * or hired from a Companion Recruiter NPC (2). A hired companion is of the
 * player's own class tier, at their level, for the fee below.
 */
const HIRE_MODES = ['free', 'panel', 'npc'];
function companionHire(s) {
	const i = HIRE_MODES.indexOf(s.population_companion_hire);
	return i < 0 ? 0 : i;
}
const clampInt = (v, lo, hi, fallback) => {
	const n = Number(v);
	if (v === undefined || v === null || v === '' || !Number.isFinite(n)) return fallback;
	return Math.min(hi, Math.max(lo, Math.round(n)));
};
/** The fee: zeny per level of the companion, and an item id and amount (0 = none). */
function companionFee(s) {
	return {
		zenyPerLevel: clampInt(s.population_companion_fee_zeny, 0, 1000000, 1000),
		item: clampInt(s.population_companion_fee_item, 0, 2147483647, 0),
		amount: clampInt(s.population_companion_fee_item_amount, 0, 30000, 0),
	};
}

/**
 * Whether companions must hold the weapon a skill asks for, as players must
 * (1), or may use any skill with whatever they carry (0, as before). Off
 * unless the player turns it on: their default gear does not always fit their
 * skills, a performer's bow cannot play a song, so turning it on can cost a
 * companion skills until it is given the right weapon.
 */
function skillWeaponCheck(s) {
	return s.population_skill_weapon_check === true ? 1 : 0;
}

/**
 * Every population key the server reads, in order. The count is always
 * written, even when the engine is off: rAthena refuses a 0 for it and "none"
 * is expressed by the enable flag alone (see main.js toBattleConf).
 */
function lines(settings) {
	const on = settings.population_enable ? 1 : 0;
	const max = Math.max(1, Number(settings.population_max) || 1);
	const density = Math.min(500, Math.max(10, Number(settings.population_density) || 100));
	return (
		`population_engine_enable: ${on}\n` +
		`population_engine_max_count: ${max}\n` +
		`population_engine_density_pct: ${density}\n` +
		// Written even while the engine is off, so a raise sticks if it is turned on later.
		`population_engine_companion_limit: ${companionLimit(settings)}\n` +
		AREAS.map(area => `population_engine_${area}_pct: ${areaShare(settings, area)}\n`).join('') +
		`population_engine_companion_hire: ${companionHire(settings)}\n` +
		`population_engine_companion_hire_zeny_per_level: ${companionFee(settings).zenyPerLevel}\n` +
		`population_engine_companion_hire_item: ${companionFee(settings).item}\n` +
		`population_engine_companion_hire_item_amount: ${companionFee(settings).amount}\n` +
		`population_engine_skill_weapon_check: ${skillWeaponCheck(settings)}\n` +
		// Off in the compiled defaults. Upstream turns it on in a conf file we
		// deliberately do not import, so without this line no shell ever opens
		// a stall -- and a town of people with nothing to sell is most of what
		// makes one feel dead.
		`population_engine_vending_enable: ${on}\n`
	);
}

module.exports = { lines, companionLimit, areaShare, companionHire, companionFee, skillWeaponCheck, HIRE_MODES, AREAS, COMPANION_LIMIT_MIN, COMPANION_LIMIT_MAX };
