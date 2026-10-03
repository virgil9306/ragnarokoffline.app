'use strict';
//
// What settings.json holds, and what it means for the server.
//
// Moved out of main.js so it can be tested, and so the headless server's copy
// of this generator -- stack/src/settings.rs, which `ragnarok-stack serve` and
// `ragnarok-stack settings` use where there is no Electron -- can be checked
// against it: tests/server-settings-parity.test.cjs runs both on the same
// settings and fails if they disagree on a single byte. Change one, change the
// other.

const SETTINGS_DEFAULTS = {
	open_registration: true,
	// "Let an AI agent play with me" (#187) and whether its window shows. App
	// preferences, not server settings: turning them on or off restarts
	// nothing.
	agent_play: false,
	agent_window: true,
	// How many agents may play at once, each its own account and window.
	agent_count: 1,
	// How long a friends invitation stays valid, in days. Nothing to do with
	// Cloudflare -- the tunnel runs as long as the app shares; this is only how
	// long the invite token is accepted. A link posted in Discord should still
	// work next weekend, and "Replace invitation" revokes one at any time.
	sharing_invite_days: 7,
	base_exp_rate: 100,
	job_exp_rate: 100,
	quest_exp_rate: 100,
	item_rate_common: 100,
	item_rate_equip: 100,
	item_rate_card: 100,
	// How many monsters spawn per map, as a percentage of rAthena's spawn
	// tables (stock is 100 = 1x). Read once at boot when the maps parse;
	// 200 is twice as many as normal. There is no in-game reload that
	// re-bakes spawn counts without clobbering other mods' NPCs, so this is
	// a server setting only -- Apply restarts the map server for it.
	//
	// Spawn lines that ask for a single monster are left alone by rAthena, so
	// this thickens the ordinary population without duplicating MVPs.
	mob_count_rate: 100,
	zeny_from_mobs: false,
	// rAthena's own defaults, so leaving these alone changes nothing. Both are
	// caps a player raises to mess about on their own server; see toBattleConf
	// for why raising one writes several keys.
	max_aspd: 190,
	max_parameter: 99,
	// How much of the map the server sends, with the walk limit and monster
	// sight that have to move alongside it -- see electron/view-distance.js.
	// 'official' is rAthena's stock numbers.
	view_distance: 'official',
	free_kafra_warp: true,
	// Discord request (Joel): ammo of every kind never runs out. Maps to
	// rAthena's arrow_decrement (conf/battle/battle.conf): stock is 1 =
	// consumed. Off leaves stock behavior; on writes `arrow_decrement: no`.
	// Read at map-server boot, so Apply restarts the map server for it.
	unlimited_arrows: false,
	population_enable: false,
	// A ceiling, not a target. Demand-driven spawning builds only the maps
	// somebody is on, and a map holds 20-40 by the spawn tables, so this binds
	// only if a group fans out across dozens of maps at once. 1500 is
	// deliberately "never in a solo game".
	population_max: 1500,
	// How crowded a single map feels, as a percentage of what the server's
	// spawn tables ask for. This is the dial players actually want; the limit
	// above is only a safety net.
	population_density: 100,
	// Each area's share of that, 0-100 (Settings -> Population): towns,
	// fields and dungeons. 100 everywhere is the world as authored.
	population_town_pct: 100,
	population_field_pct: 100,
	population_dungeon_pct: 100,
	// Companions: 'free' (draft any job from the panel, as before), 'panel'
	// (hired from the panel: your class tier, your level, for a fee) or 'npc'
	// (the same, from a Companion Recruiter in town). The fee is zeny per level
	// of the companion and/or an item (id, amount; 0 = none).
	population_companion_hire: 'free',
	population_companion_fee_zeny: 1000,
	population_companion_fee_item: 0,
	population_companion_fee_item_amount: 0,
	// How many shells one player may recruit into their party at once. The
	// server enforces this per recruiter (not per map), and rAthena's MAX_PARTY
	// of 12 leaves a slot for real players, which is why the UI tops out at 11.
	population_companion_limit: 4,
	// Whether deleting a character takes effect at once or a day after it is
	// queued. rAthena's default is the day, and it stays the default here: the
	// countdown on the slot is what lets a player undo a deletion somebody else
	// started, which matters the moment friends can reach the server.
	instant_character_deletion: false,
	// Which window a launch opens. Off means the game, which is what anyone
	// who has not asked for this gets; on means the Settings window and no
	// game window at all. The only shell-side preference in this file -- it is
	// here because settings.json is where the app's preferences live and the
	// window already reads it, and it is deliberately ignored by
	// writeSettingsFiles: the server knows nothing about it.
	open_settings_first: false,
	// Pre-renewal is a different rAthena build, not a runtime option, so this
	// selects which of the two the supervisor starts. Each mode keeps its own
	// characters -- see db_volume() in stack/src/cmds.rs for why sharing them
	// is not safe.
	prerenewal: false,
	// Where the game's text comes from, and with it the codepage every table
	// the client ships is read through. kRO is Korean and the bundled
	// ROenglishRE translation covers it, which is why English is the default;
	// a Latin American or international client already has its own text and is
	// better served reading that. See GameText in stack/src/assets.rs for why
	// the text and the codepage are one setting rather than two.
	game_text: 'english',
	// Which client version the server is built for and the client speaks --
	// see electron/packetvers.js. null follows the app's default rather than
	// pinning today's, so a later app that moves the default moves this too.
	packetver: null,
};

// rAthena has no zeny multiplier: whether monsters drop zeny at all is a
// boolean and the amount derives from the mob's level. The *_boss and heal/use
// rates deliberately track the common rate rather than getting their own
// sliders, which keeps the Settings window to six numbers.
// rAthena's stock caps, by class group. These are raise-only settings: at or
// below the base default every group keeps its own stock value, and above it
// every group is lifted to the player's number.
//
// Raise-only because the stock values are not a flat line -- 99 for first and
// second jobs, 130 for third and summoner, 80 for baby. Any rule that mapped
// one number onto all of them while still allowing a decrease either nerfed
// third jobs on an untouched install or quietly raised baby classes from 80.
// Nobody asking for "max stats" wants either, and nobody has asked to lower
// them at all.
const ASPD_STOCK = { max_aspd: 190, max_third_aspd: 193, max_summoner_aspd: 193 };
const PARAM_STOCK = {
	max_parameter: 99,
	max_third_parameter: 130,
	max_baby_parameter: 80,
	max_extended_parameter: 130,
	max_summoner_parameter: 130,
};

// 100..199; rAthena refuses anything outside and falls back to its default,
// which would look like the setting doing nothing.
function aspdConf(v) {
	const want = Math.min(199, Math.max(100, Number(v) || ASPD_STOCK.max_aspd));
	return Object.entries(ASPD_STOCK)
		.map(([k, stock]) => `${k}: ${want > ASPD_STOCK.max_aspd ? Math.max(want, stock) : stock}\n`)
		.join('');
}

// 10..32767, rAthena's own bounds (SHRT_MAX).
function parameterConf(v) {
	const want = Math.min(32767, Math.max(10, Number(v) || PARAM_STOCK.max_parameter));
	return Object.entries(PARAM_STOCK)
		.map(([k, stock]) => `${k}: ${want > PARAM_STOCK.max_parameter ? Math.max(want, stock) : stock}\n`)
		.join('');
}

// Whether the player has asked for faster levelling at all. 100 is 1x, and
// rAthena's own bounds are the sliders' -- anything above 1x means the stock
// one-level-per-kill cap would start eating the difference.
function expRatesRaised(s) {
	return Number(s.base_exp_rate) > 100
		|| Number(s.job_exp_rate) > 100
		|| Number(s.quest_exp_rate) > 100;
}

function toBattleConf(s) {
	return (
		'// Generated by Ragnarok Offline. Edits here are overwritten.\n' +
		`base_exp_rate: ${s.base_exp_rate}\n` +
		`job_exp_rate: ${s.job_exp_rate}\n` +
		`quest_exp_rate: ${s.quest_exp_rate}\n` +
		// Follows the EXP sliders rather than getting a switch of its own.
		// rAthena ships this off, and off means a kill grants one level and
		// *discards* the overflow above it (pc_checkbaselevelup caps the carried
		// exp at next-1). So at any raised rate the sliders quietly stop paying
		// out most of what they promise -- the player sees one level per monster
		// at 50x and reads it as the setting not working. Quest exp counts too:
		// it feeds the same two bars, so a raised quest rate is discarded on
		// turn-in the same way.
		`multi_level_up: ${expRatesRaised(s) ? 'yes' : 'no'}\n` +
		require('./battle-rates').dropRateConf(s) +
		`item_rate_mvp: ${s.item_rate_common}\n` +
		`item_rate_treasure: ${s.item_rate_common}\n` +
		// Percentage of the spawn tables, read once when the maps parse at
		// boot; Apply restarts the map server so it takes effect. Clamped in
		// battle-rates, which is also where the reason for the ceiling is.
		require('./battle-rates').mobCountRateConf(s) +
		`zeny_from_mobs: ${s.zeny_from_mobs ? 'yes' : 'no'}\n` +
		// One arrow is all Joel ever needed: `no` stops rAthena from
		// decrementing ammo on any ranged attack (battle.cpp
		// battle_config.arrow_decrement). Default 'yes' == the shipped
		// battle.conf, so an untouched install writes nothing surprising.
		`arrow_decrement: ${s.unlimited_arrows ? 'no' : 'yes'}\n` +
		// One cap in the UI, several keys here, because rAthena caps third,
		// baby, extended and summoner classes separately and a player who
		// raises "the" limit means all of them -- setting only max_parameter
		// leaves every third-job character on the stock 130.
		//
		// Raised to the player's number, never lowered below rAthena's own
		// default for that class group: the stock split is 99 for first and
		// second jobs against 130 for third, so writing the player's 99
		// everywhere would quietly nerf third jobs on a fresh install that had
		// touched nothing.
		aspdConf(s.max_aspd) +
		parameterConf(s.max_parameter) +
		require('./view-distance').viewDistanceConf(s) +
		// Population keys: one module so the Settings window and the server
		// share their bounds -- see electron/population-conf.js.
		require('./population-conf').lines(s)
	);
}

module.exports = { SETTINGS_DEFAULTS, toBattleConf };
