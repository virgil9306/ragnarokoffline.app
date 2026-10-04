// Copyright (c) rAthena Dev Teams - Licensed under GNU GPL
// For more information, see LICENCE in the main folder
//
// Population engine: YAML-driven equipment, identity, and name profile types.

#ifndef POPULATION_YAML_TYPES_HPP
#define POPULATION_YAML_TYPES_HPP

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include <common/mmo.hpp> // t_itemid

struct script_code;

/// Optional per-job attack skill list (db/population_engine.yml `Skills:` sequence).
struct PopulationShellYamlSkill {
	uint16_t skill_id = 0;
	/// From YAML `Level` (default 10 per entry). 0 = do not force level via pc_skill; else ensure at least this level (capped by skill max).
	uint16_t level_cap = 0;
};

/// High-level shell behavior after spawn (db/population_engine.yml: Behavior).
enum class PopulationBehavior : uint8_t {
	None    = 0, ///< No wander, no combat
	Wander  = 1, ///< Random walk only
	Combat  = 2, ///< AutoCombat + wander (default)
	Support = 3, ///< Reserved for support AI (wander, no combat)
	Sit     = 4, ///< /sit emote, stays near spawn; minimal wander
	Social  = 5, ///< Wander + frequent chat + emotes
	Vendor  = 6, ///< Stand at spawn, display overhead shop message
	Guard   = 7, ///< Stand at spawn, attack on approach; return after combat
};

/// Named gear set for GearSet: inheritance in db/population_engine.yml.
/// Only gear slot pools and skip_arrow are inherited; Script/identity/stats are not.
struct PopulationGearSet {
	std::vector<uint16_t> weapon_pool;
	std::vector<uint16_t> shield_pool;
	std::vector<uint16_t> head_top_pool;
	std::vector<uint16_t> head_mid_pool;
	std::vector<uint16_t> head_bottom_pool;
	std::vector<uint16_t> armor_pool;
	std::vector<uint16_t> garment_pool;
	std::vector<uint16_t> shoes_pool;
	std::vector<uint16_t> acc_l_pool;
	std::vector<uint16_t> acc_r_pool;
	bool skip_arrow = false;
};

/// Shell combat role for coordinated party play (db/population_engine.yml: Role).
enum class PopulationRoleType : int8_t {
	None     = 0, ///< No role bias (default)
	Tank     = 1, ///< Frontliner: intercepts enemies threatening low-HP allies; prefers melee
	Support  = 2, ///< Healer/buffer: deprioritizes direct combat; prioritizes heal/buff skills
	Attacker = 3, ///< DPS: maximizes offensive output
};

struct PopulationEngine {
	/// Equipment slot pools — a random entry is picked each spawn.
	/// YAML scalar 0 = empty slot; scalar item_id/AegisName = one fixed item;
	/// YAML sequence of item_ids/AegisNames = random pick per spawn.
	/// Parser validates each entry against the slot's equip flag at load time.
	std::vector<uint16_t> weapon_pool;
	std::vector<uint16_t> shield_pool;
	std::vector<uint16_t> head_top_pool;
	std::vector<uint16_t> head_mid_pool;
	std::vector<uint16_t> head_bottom_pool;
	std::vector<uint16_t> armor_pool;
	std::vector<uint16_t> garment_pool;
	std::vector<uint16_t> shoes_pool;
	std::vector<uint16_t> acc_l_pool;
	std::vector<uint16_t> acc_r_pool;
	/// Full raw script source (YAML: Script: |).  Run once at spawn via run_script
	/// to execute side-effect commands (setriding, setfalcon, setcart, setarrow).
	std::string script_str;
	/// Filtered script source: script_str with side-effect commands removed.
	/// Registered via pc_bonus_script_add so bonus commands (bonus bStr,
	/// bonus3 bAutoSpell, …) survive every future status_calc_pc call.
	/// Side-effect commands are excluded because they internally call
	/// status_calc_pc / pc_equipitem and would cause a "Double continuation" crash.
	std::string bonus_script_str;
	/// Compiled script block — pre-compiled for validation at load time.
	struct script_code* script = nullptr;
	/// If true, do not auto-equip arrows for bow-class YAML weapons (YAML: Arrow: false).
	bool skip_arrow = false;
	/// If true (default), run normal job skill tree after spawn. If false, only basic survival skills.
	bool grant_skill_tree = true;
	/// Non-empty when `Skills:` is a sequence (attack rotation + optional grants). Empty when `Skills:` is bool only.
	std::vector<PopulationShellYamlSkill> shell_attack_skill_yaml;
	PopulationBehavior behavior = PopulationBehavior::Combat;

	/// Per-map-category behavior overrides.
	/// When set (not None), replace `behavior` for shells spawned in that category.
	/// Allows e.g. Combat in fields but Wander in towns.
	PopulationBehavior town_behavior    = PopulationBehavior::None;
	PopulationBehavior field_behavior   = PopulationBehavior::None;
	PopulationBehavior dungeon_behavior = PopulationBehavior::None;

	/// Guard behavior: aggro range in cells (0 = use default 5).
	uint8_t guard_range = 0;

	/// Combat role for party coordination. Influences skill selection priority in combat.
	PopulationRoleType role_type = PopulationRoleType::None;

	/// Vendor behavior: overhead message text (empty = job-default string).
	std::string vendor_message;
	/// Optional key into db/population_vendors.yml (VendorKey:). Empty = built-in default stock.
	std::string vendor_key;
	/// RAGNAROKMAC: when true, this vendor Profile is resolved by its VendorKey
	/// (from the VendorPlacement that names it), NOT registered in the global
	/// job -> vendor map. So its Jobs: entry is a cosmetic sprite only: several
	/// vendors — across mods — can use the same sprite without colliding, and it
	/// never steals a job from the engine's own ambient vendors. A mod's vendors
	/// stay fully self-contained. Set via `PlacementBound: true`.
	bool placement_bound = false;
	/// RAGNAROKMAC: the job id this (synthetic, per-job) entry was built for —
	/// used as the shell's sprite when the entry is resolved by VendorKey.
	uint16_t sprite_job = 0;

	/// Phase 2 identity: -1 / unset = use engine defaults (random or job rule).
	int16_t str_min = -1, str_max = -1;
	int16_t agi_min = -1, agi_max = -1;
	int16_t vit_min = -1, vit_max = -1;
	int16_t intl_min = -1, intl_max = -1; // YAML key "Int"
	int16_t dex_min = -1, dex_max = -1;
	int16_t luk_min = -1, luk_max = -1;
	/// 4th-job trait stats (Renewal trait era); -1 = leave at engine default (0).
	int16_t pow_min = -1, pow_max = -1;
	int16_t sta_min = -1, sta_max = -1;
	int16_t wis_min = -1, wis_max = -1;
	int16_t spl_min = -1, spl_max = -1;
	int16_t con_min = -1, con_max = -1;
	int16_t crt_min = -1, crt_max = -1;
	int16_t base_level_min = -1, base_level_max = -1;
	int16_t job_level_min = -1, job_level_max = -1;
	/// -1 = auto (job rule + random); 0 = female; 1 = male
	int8_t sex_override = -1;
	int16_t hair_min = -1, hair_max = -1;
	int16_t hair_color_min = -1, hair_color_max = -1;
	int16_t cloth_color_min = -1, cloth_color_max = -1;
	std::string name_profile;
	std::string name_prefix;
	std::string name_suffix;
	/// Phase 3: key in db/population_chat.yml (ChatProfile rows); empty = no random overhead lines
	std::string chat_profile;
	/// Shell behavior flags — bitfield of PSF_* values below.
	uint32_t flags = 0;
	/// Name of the Profile: this entry inherited from (empty if none). Used by
	/// PopulationEngineDatabase::jobs_with_profile() so the spawn loader can
	/// translate a profile name from population_spawn.yml into a list of jobs.
	std::string source_profile_name;
	~PopulationEngine();
};

/// Population shell flags (bitfield stored in PopulationEngine::flags and sd->pop.flags).
namespace PSF {
	constexpr uint32_t Mortal      = 1u << 0; ///< Shell can take damage and die (default: immortal)
	constexpr uint32_t AttackOnly  = 1u << 1; ///< Skip skills/buffs; only basic attack
	constexpr uint32_t SkillOnly   = 1u << 2; ///< Skip basic attack; only skill attacks
	constexpr uint32_t FleeOnLow   = 1u << 3; ///< Flee when HP drops below 30% (squishy jobs)
	constexpr uint32_t Kite        = 1u << 4; ///< Maintain max skill range instead of closing to melee
	constexpr uint32_t BossAvoid     = 1u << 5; ///< Avoid targeting MVP/boss monsters (non-tank roles)
	constexpr uint32_t CombatActive  = 1u << 6; ///< Runtime: shell fully set up and not yet in teardown
}

struct PopulationNameProfile {
	enum class Strategy : uint8_t { None = 0, Syllables, AdjectiveNoun, PickOne, BotIndex, PrefixNumber };
	Strategy strategy = Strategy::None;
	std::vector<std::string> syllables_start;
	std::vector<std::string> syllables_mid;
	std::vector<std::string> syllables_end;
	std::vector<std::string> adjectives;
	std::vector<std::string> nouns;
	std::vector<std::string> pool;
	int min_len = 2;
	int max_len = 22;
};

/// One item in a vendor's predefined stock list (db/population_vendors.yml).
struct PopulationVendorStock {
	t_itemid nameid = 0;
	int16_t  amount = 1;
	uint32_t price  = 0; ///< 0 = auto (item_data.value_buy)
	/// RAGNAROKMAC: `Price: [min, max]` (Pool). price is then the minimum and each
	/// shell rolls in the range instead of applying PriceJitterPct.
	uint32_t price_max = 0;
	/// RAGNAROKMAC: what a player would actually have in a cart. All optional;
	/// a plain entry is the plain item, as before.
	uint8_t refine_min = 0;          ///< Refine level, rolled in [min, max] per shell (equipment only).
	uint8_t refine_max = 0;
	uint8_t element = 0;             ///< Forged weapon element (ELE_WATER..ELE_WIND); 0 = not forged.
	uint8_t stars   = 0;             ///< Forged weapon Star Crumbs, 0-3 ("Very Strong").
	std::vector<t_itemid> cards;     ///< Cards in its slots (not with a forged element).
};

/// RAGNAROKMAC: a shop sign that only goes up over stock that bears it out
/// (StockTitles). {item} and {price} in it are filled from a line the stall
/// really carries, so "B> {item} {price}" reads "B> Sticky Mucus 450z".
struct PopulationStockTitle {
	std::string text;
	std::vector<t_itemid> needs; ///< Every one of these must be in the stall.
	std::vector<t_itemid> any;   ///< At least one of these, when not empty.
};

/// Vendor stock sourcing mode. RAGNAROKMAC: added Pool as a third type (was bool dynamic).
enum class PopulationVendorType : uint8_t {
	Static  = 0, ///< Serve exactly the YAML `Stock:` list.
	Dynamic = 1, ///< Derive stock from mob drop tables of source maps at spawn.
	Pool    = 2, ///< Pick a random subset of `Pool:` entries per shell; optional rotation.
};

/// RAGNAROKMAC: one rectangle a mod vendor may stand in (inclusive corners).
struct PopulationModSpawnArea {
	int16_t x1 = 0, y1 = 0, x2 = 0, y2 = 0;
};

/// RAGNAROKMAC: one `Spawns:` block of a mod vendor entry. Mod vendors are
/// spawned by their own pass and never touch the base VendorPlacement path, so
/// a mod can place vendors without changing the engine's own vendors or
/// another mod's. Exactly one of `positions` (fixed seats, one shell each) or
/// `count` + `areas` (that many shells anywhere in the areas) is set.
struct PopulationModSpawn {
	std::string map;
	std::vector<std::pair<int16_t, int16_t>> positions; ///< Fixed seats; count = seat count.
	int count = 0;                                    ///< Shells to keep up (areas mode).
	std::vector<PopulationModSpawnArea> areas;        ///< Where those shells may stand.
	int min_spacing = 0;                              ///< Cells between shells of THIS block only.
	bool scale_with_density = false;                  ///< Opt in to the "How busy" slider.
	bool fill_lanes = false;                          ///< RAGNAROKMAC: "Fill: Lanes" -- areas fill in order, shells side by side.
	int lane_fill_min = 100;                          ///< RAGNAROKMAC: LaneFillPct -- share of a lane's usable cells
	int lane_fill_max = 100;                          ///< taken before the next lane opens, rolled per lane in [min, max].
	std::string spawn_id;                             ///< "<VendorKey>#<map>#<index>", stamped on each shell.
};

/// RAGNAROKMAC: one theme a market may roll for a spot.
struct PopulationMarketTheme {
	std::string key;   ///< VendorKey of the theme (an entry without Spawns).
	int weight = 1;    ///< Relative chance when a spot rolls.
	int min = 0;       ///< Spots kept on this theme before any other is rolled.
	int max = 0;       ///< Most spots on this theme at once; 0 = no limit.
};

/// A named vendor configuration entry from db/population_vendors.yml.
struct PopulationVendorEntry {
	std::string key;
	std::string title;           ///< Overhead vend title (empty = "Shop")
	PopulationVendorType type = PopulationVendorType::Static;
	int         max_slots = 12;  ///< Cap vend slots (MC_VENDING lv10 = 12)
	uint32_t    price_multiplier = 100; ///< % of item sell value for dynamic entries
	std::vector<PopulationVendorStock> stock;

	// Dynamic-mode source pool: which maps to scan for mob drops.
	// Priority: explicit source_maps > source_category auto-discovery > spawn map (legacy).
	std::vector<std::string> source_maps; ///< Explicit map list (overrides auto-discovery).
	std::string source_category;          ///< "dungeon" | "field" | "both" (empty = legacy/spawn map only).
	bool        randomize_per_shell = false; ///< If true, each shell picks ONE map; else merge all maps.

	// Item type filters for dynamic-mode item inclusion.
	bool allow_equipment = false; ///< Include items where item_data.equip != 0.
	bool allow_cards     = false; ///< Include IT_CARD items.
	bool allow_etc       = true;  ///< Include IT_ETC items.
	bool allow_usable    = true;  ///< Include IT_HEALING / IT_USABLE / IT_DELAYCONSUME.

	// MaxAmount: per-item stack-size randomization range for dynamic-mode stock.
	// When dyn_amount_max > 0, each generated stockpile rolls a random integer in
	// [dyn_amount_min, dyn_amount_max].  Equipment is always capped to 1 (non-stackable).
	int dyn_amount_min = 0; ///< 0 = use built-in default (30).
	int dyn_amount_max = 0; ///< 0 = use built-in default (30).

	// RAGNAROKMAC: Pool-type fields. A Pool vendor carries a themed superset
	// (e.g. 60 ninja-gear items) and every spawned shell draws a random subset
	// of pick_count items from it. Combined with rotation (shells get released
	// after rotation_sec and the autosummon pass re-fills with fresh picks),
	// this gives the "player vendor whose stock changes" feel without any
	// client-side change.
	std::vector<PopulationVendorStock> pool;         ///< Superset of items a Pool vendor draws from.
	int pick_count_min = 0;                          ///< Items per shell (low bound). 0 = max_slots.
	int pick_count_max = 0;                          ///< Items per shell (high bound). 0 = pick_count_min.
	int rotation_sec   = 0;                          ///< Shell lifetime before despawn. 0 = never rotate.
	int rotation_jitter_sec = 0;                     ///< Per-shell random offset: rotation_sec ± rotation_jitter_sec.
	std::vector<std::string> title_pool;             ///< When non-empty, each shell picks a title from here instead of `title`.
	std::vector<PopulationStockTitle> stock_titles;  ///< RAGNAROKMAC: signs a mod stall may add to the pick when its stock bears them out.
	/// RAGNAROKMAC: per-item price variation, rolled independently for each item
	/// of each spawned shell, so vendors undercut/overprice one another like a
	/// real market instead of all showing identical numbers.
	int price_jitter_pct = 0;                        ///< Each price rolled in base ± this %. 0 = fixed price.
	/// RAGNAROKMAC: "fat-finger" mispricing. Humans set prices by hand and rarely
	/// drop a digit, listing something far too cheap. 1-in-N chance per item of
	/// dividing its price by 10 — a very low N gives the occasional deal-of-a-
	/// lifetime find. 0 = never.
	int price_mistake_one_in = 0;
	/// RAGNAROKMAC: callout pacing for this vendor's shells. 0 keeps the engine's
	/// chat cooldown. A street of stalls shouting on the global cooldown is a wall
	/// of text; these space each stall out and keep stalls on one map from
	/// talking over one another.
	int callout_min_sec = 0;                         ///< Each shell waits [min, max] seconds between callouts.
	int callout_max_sec = 0;
	int callout_map_gap_sec = 0;                     ///< No two vendor callouts on one map closer than this.
	/// RAGNAROKMAC: `Undercut: { Chance, StepPct: [min, max] }` (Pool). When a
	/// stall opens, each plain item has Chance% to be listed StepPct% under the
	/// cheapest shell stall on the map selling it, never under its own range.
	int undercut_chance = 0;
	int undercut_step_min = 0;
	int undercut_step_max = 0;

	/// RAGNAROKMAC: non-empty only for a mod vendor (an entry with `Spawns:`).
	/// Its shells come from the mod vendor pass, look like the PlacementBound
	/// profile whose VendorKey equals this entry's key, and never use
	/// VendorPlacement. Base entries leave this empty and behave as upstream.
	std::vector<PopulationModSpawn> spawns;

	/// RAGNAROKMAC: a market (`Market:` instead of `VendorKey:`) sells nothing
	/// itself: each of its Spawns' spots rolls one of these themes whenever a
	/// stall is put there, so the stalls change as they rotate.
	bool is_market = false;
	/// RAGNAROKMAC: a buying store (`Buying: true`): its Pool says what it wants
	/// to buy, how many, and what it pays. Up to MAX_BUYINGSTORE_SLOTS (5) items.
	bool buying = false;
	std::vector<PopulationMarketTheme> themes;
};

/// Per-map vendor placement constraint (from db/population_engine.yml VendorPlacement: block).
struct PopulationVendorPlacement {
	std::string map;             ///< Map name this entry applies to.
	int min_spacing = 0;         ///< Minimum cells between two vendor shells (0 = no spacing check).
	int max_vendors = 0;         ///< Hard cap on simultaneous vendor shells on this map (0 = unlimited).
	int16_t area_x1 = -1, area_y1 = -1, area_x2 = -1, area_y2 = -1; ///< Optional bounding box (-1 = whole map).
};

#endif // POPULATION_YAML_TYPES_HPP
