# Population Engine

Server-side fake players for rAthena: "shells" that walk, fight, sit, chat and
open real vending stalls, and that appear to any client as ordinary players in
the player list. Ambient shells and party recruitment use normal rAthena
packets. Companion resurrection additionally needs the generic dead-PC
lifecycle correction on our roBrowserLegacy fork, described below.

| | |
|---|---|
| Upstream | https://github.com/YlenXWalker/Population-Engine |
| Vendored at | `a191b70` ("fix build in linux"), 2026-08-18 |
| Licence | GPL-3.0, same as rAthena. Attribution appreciated, not required |
| Forum thread | https://rathena.org/board/topic/149283-population-engine-advance-fake-players |

## Why it is vendored rather than cloned

Upstream ships as a **whole fork of rAthena**, not as a patch set — its history
is a squashed import of the rAthena tree with the engine committed on top. We
build from a clean upstream rAthena clone and have no interest in tracking
somebody else's fork of it, so what lives here is the engine's own delta,
extracted from `417f713..a191b70`:

    files/       new files, copied verbatim into the rAthena checkout
    patches/     the hunks that touch rAthena's own sources

`scripts/apply-server-mods.sh` puts both into a checkout, and both build paths
call it before `docker build` — `scripts/bootstrap.sh` locally and
`.github/workflows/images.yml` in CI.

## What we deliberately left out

The upstream fork carries changes we do not want:

- **`src/custom/defines_pre.hpp`** hard-codes `PACKETVER 20250716`. Ours comes
  from `--enable-packetver` and has to match the client era — see
  `containers/rathena/Dockerfile`.
- **`conf/import/*`** — the app bind-mounts its own `conf` directory over
  `/rathena/conf/import` at `stack/src/cmds.rs:401-406`, so anything upstream
  writes there is shadowed at runtime and would be silently dead. The one line
  that mattered (`import: conf/battle/population_engine.conf`) is unnecessary
  for us because every setting is registered in `battle_config_init.inc` with a
  default, and the app writes the two we expose directly into the mounted
  `battle_conf.txt`.
- **`db/import/*`** — upstream's own server data, including a 136,000-line
  `job_stats.yml`. Not required by the engine: `population_engine_equipment_strict_load`
  defaults to off, so gear rows referencing items we do not have are warned
  about and zeroed rather than failing the load.
- **MSVC project files**, which we have no build path for.

## What we added

`patches/0002-master-enable-switch.patch`, plus a matching guard in
`files/src/map/population_engine.cpp` (search `RAGNAROKMAC`).

Upstream has no master on/off switch — population is driven by whatever
`db/population_spawn.yml` asks for, and `population_engine_max_count` has a
minimum of 1, so there is no way to express "none". We add
`population_engine_enable`, defaulting to **0**, which:

- returns from `do_init_population_engine_load_databases()` before any of the
  nine YAML databases are parsed or the autosummon timer is registered, so a
  disabled engine costs nothing at all; and
- refuses `@populate` and `@reloadpopenginedb` with a message pointing at the
  app's settings, rather than half-starting an engine whose databases were
  never loaded.

The app writes `population_engine_enable` and `population_engine_max_count`
into the mounted `conf/import/battle_conf.txt` from the Population section of
the Settings window (`electron/main.js`, `toBattleConf`).

This switch is worth offering upstream.

## What we changed, beyond the switch

The behavioural changes below are marked `RAGNAROKMAC` in the vendored sources.
They exist because upstream is tuned for a public server with hundreds of real
players, and this app is nearly always one person and a couple of friends.

### Recruitable party companions

A real player can recruit shells into a normal rAthena party: four by default
and up to eleven, set by **Party invitations** in the app's Population
settings. The player first whispers `party`, `pt`, `join`, or `invite`; the
shell stops for a 60-second invitation window and accepts that player's formal
party request.
After joining it:

- follows its recruiter between maps and teleports back when separated;
- uses deterministic free cells around the recruiter while idle;
- shares EXP through the ordinary rAthena party system;
- attributes its monster-drop ownership to its recruiter while both remain on
  the same map, so the recruiter's `@autoloot`, `@alootid`, and
  `@autoloottype` settings work normally;
- is excluded as an item-sharing recipient, preventing loot from being placed
  in an inaccessible shell inventory while preserving normal distribution
  between real party members;
- uses the same class, equipment, and skill data it had as an ambient shell;
- obeys party-wide Attack, Defensive, and Passive modes; and
- accepts individual Tank, Support, and Attacker roles from the party leader.

Only party-leader messages in party chat are commands. Full mode words can sit
inside sentences; the `atk`, `def`, and `pass` aliases must be the entire
message to avoid collisions with normal stat discussion. Role commands require
the shell's exact name and answer in party chat so the assignment is visible.
See the [AI companion guide](../../docs/COMPANIONS.md) for the player-facing
command reference. Implementation invariants, verification evidence, and the
future-work backlog are kept in the
[AI companion development guide](../../docs/COMPANION_DEVELOPMENT.md).

Companion death uses real PC semantics. The original actor stays targetable on
the map and in the party. Priest-line shells can cast level 3 Resurrection with
an intentionally unlimited virtual Blue Gemstone supply, and Yggdrasil Leaves
work normally when a player targets the corpse. Leaving the map releases a dead
companion. Ambient mortal shells retain their original timed-respawn behaviour.

The matching roBrowserLegacy change is a commit on our fork's `ragnarokoffline`
branch ([docs/FORKS.md](../../docs/FORKS.md)): a dead PC keeps its
`EntityManager` GID until a genuine removal packet arrives,
allowing `ZC_RESURRECTION` to update the existing corpse instead of creating a
second visual actor.

Ranged companion ammunition is also virtual because shell inventories are not
player-accessible. A single runtime module provisions and validates arrows for
bow-line weapons, bullets (or pre-renewal grenade spheres) for every rAthena
gun weapon type, and shuriken or elemental kunai when a Ninja skill needs them.
It selects useful elemental ammo for the current target, repairs the equipped
stack after map changes, and stops stocking before the shell becomes
overweight. All ammo uses normal `pc_isequip`/`pc_equipitem` validation;
invalid items are never forced into the equipment slot.

### Appearance, names, and ambient chat

Hair and clothes now use rAthena's client-supported palette constants instead
of hard-coded ranges that selected invalid values and collapsed most shells to
the same red-haired fallback. Profile ranges remain able to narrow the choice.

The generated-name tables use a root, consonant bridge, and ending structure,
providing 16,896 pronounceable combinations before repetition. The same shape
is used by the compiled fallback when no YAML-generated name is available.

Ambient chat now reports whether its timer is enabled at server startup. The
existing configurable chat categories and cooldowns are otherwise unchanged.

### Demand-driven population

Upstream's autosummon timer walks every entry in `db/population_spawn.yml` on
every tick and tops up each map to its quota, whether or not a human is there.
The shipped YAML asks for **4,060 shells across 124 maps**. With a global cap the
fill also runs in database order, so a low cap produces a crowded Prontera and
empty dungeons rather than a thin scatter.

We keep the YAML's densities and change only which maps they apply to:

- an occupied-map set, refreshed at most once a second from a pass over the pc
  list. It cannot be read off `mapdata->users`, because shells increment that
  themselves (`population_engine.cpp:1802`);
- `fill_category` and the vendor-placement pass skip maps that are not live;
- shells on maps vacated longer than `population_engine_demand_grace_ms`
  (default 5 minutes) are released;
- the autosummon interval drops from 10s to 2s when demand mode is on, because
  per-tick work is now proportional to occupied maps rather than to 124.

Net effect: the same per-map density, on the two or three maps anybody is
standing on. Because profiles overlap — a town appears in ~13 of them — an
occupied town lands around 20-25 shells and a field or dungeon rather more.

`population_engine_demand_spawn: 0` restores upstream behaviour exactly.

### Density is a setting, not a rebuild

`population_engine_density_pct` (default 100, range 10-500) scales every
category total *before* the engine distributes it across its map list, and
scales `max_per_map` and vendor placement targets with it. The world keeps the
shape it was authored with -- same maps, same job mixes, same weighting between
towns, fields and dungeons -- and only its crowding changes.

Without it, "how busy does one map feel" was a property of a YAML file inside
the container image, which no player can reach. `max_count` looks like that dial
but is not: it is a global ceiling that a solo game never approaches, because
demand-driven spawning only ever builds the map you are standing on.

Surfaced in the app as **How busy** (25-300%), which reads out as an estimated
per-map count against the measured ~40 at 100%.

### The Prontera fields were missing from the main profile

`db/population_spawn.yml` is upstream's, with one edit. Its `combat_pve`
profile carries the largest field population and the widest job pool
(Swordsman, Mage, Archer, Acolyte, Thief, Priest, Assassin, Rogue, Alchemist),
and its field list covered `gef_fild*`, `moc_fild*` and `pay_fild*` — but no
`prt_fild` maps at all. The Prontera fields, which is where a new character
actually spends its first hours, were reachable only through `pve_knight`
(100 shells across 11 maps), so `prt_fild08` held nine knights spread over a
full-size map and read as empty.

We added `prt_fild01`-`prt_fild11` to `combat_pve` and raised its
`FieldsPopulation` from 1000 to 1440, holding the per-map density at ~30 across
the now-48 maps. With the `pve_knight` shells on top, an early Prontera field
lands around 39.

Note the arithmetic that makes this affordable: the population is *distributed*
across the map list, so widening the list without raising the total would have
thinned every other field. Under demand-driven spawning only occupied maps are
ever built, so the declared total is a shape, not a cost.

### Wander only where someone can see it

The combat tick was already proximity-driven (`population_engine.cpp:1208`,
`map_foreachpc` over real players), but the wander sweep was not: it walked
every shell in the world every 500 ms via a cursor
(`population_engine_path.cpp:133`), which was the entire idle CPU cost of the
engine. It now skips shells whose map holds no real player. A shell standing
still on an empty map is indistinguishable from one wandering there, and it
starts moving again the moment somebody arrives.

### Vendors a mod can add

Upstream places vendors per map with one `VendorPlacement` each, and picks the
shell's stock by its job. A mod can now add its own vendors without changing
either. The additions do nothing unless a mod uses them; with no mods, the
engine's vendors spawn exactly as upstream's do.

- `Type: Pool` in `population_vendors.yml`: each shell draws `PickCount` items
  from a list, rolls each price by `PriceJitterPct`, rarely drops a digit
  (`PriceMistakeOneIn`), picks a title from `TitleFromPool`, and is replaced
  after `RotationHours` (or `RotationMinutes`) ± `RotationJitterMinutes` with
  a fresh pick. `{name}` in a shop title is the shell's own name.
- `StockTitles:` on a mod vendor: signs that name what is for sale, each
  `{ Title, Needs: [items], Any: [items] }`. A mod stall picks its sign after
  its stock, from `TitleFromPool` plus every `StockTitles` sign that stock
  bears out (all of `Needs`, one of `Any`), so a sign never names an item the
  stall lacks. `{item}` and `{price}` in one are filled from a line it really
  carries ("S> {item} {price}" reads "S> Elunium 13k"). Older builds ignore
  the key, so item names belong there, not in `TitleFromPool`; without it a
  stall picks its sign exactly as before.
- **Customers for players' stalls** (`runtime/population_customers.cpp`):
  once a minute, every vending stall and buying store a real player has
  open (online or `@autotrade`) gets the customers a busy server would
  bring, by the item's market price and demand (a mod price table's `Min`,
  `Max`, `BuyersPerDay`, `SellersPerDay`), the asking price, cheaper fake
  stalls on the map and how busy the map is. The sale is half of rAthena's
  own (`vending_purchasereq`, `buyingstore_trade`): zeny, tax, cart or
  inventory, the autotrade rows and the stock report; nobody is shown. The
  time the server was off is caught up for restored `@autotrade` stalls (up
  to 48 h), and what they did is mailed by RODEX. Off unless a mod sets the
  `$@pop_customers_*` variables (the file's header lists them); with no
  price table named it does nothing, not even its clock
  (`$pop_customers_clock`). `@vendorinfo customers [ff <minutes>]` shows the
  model for the player stalls on a map, or fast-forwards them.
- `Spawns:` on a vendor entry makes it a mod vendor. Each block names a `Map`
  and either fixed `Positions` (one shell per seat; a taken seat stays empty
  until it is free) or `Count` shells in `Areas` (with optional `MinSpacing`).
  `Fill: Lanes` fills the `Areas` one at a time in the order listed, each
  shell on a free cell within two cells of one already in that area, the way
  players open shops next to a busy street; the next area gets shells once
  the earlier ones have their share. `LaneFillPct: [70, 80]` sets that share
  of a lane's usable cells, rolled per lane (default 100: full), which leaves
  natural gaps; once every lane has its share the rest fill in order.
  `Fill: Random` (the default) spreads them over all areas.
  A shell in `Areas` keeps `min_npc_vendchat_distance` (3 cells) from any
  NPC, as a player's own shop must, so an NPC another mod puts there is not
  covered by a stall; fixed `Positions` are taken as given.
  Counts are exact unless `ScaleWithDensity: true`. Mod vendors are spawned by
  their own pass after the engine's, never count toward a map's `MaxVendors`,
  and do count toward the global Limit.
- `PlacementBound: true` on a profile in `population_vendor_pop.yml` keys the
  profile by its `VendorKey` instead of its job, so the job is only the sprite.
  A mod vendor's look comes from the profile with its key.
- Pool stock lines can say what a player's cart really holds: `Refine: 7` (or
  `[min, max]`), a forged `Element: Fire` with `Stars: 0-3`, or `Cards: [...]`.
  `Price: [min, max]` rolls in a range, `Undercut: { Chance, StepPct }` lists
  some items just under the cheapest rival shell stall on the map, and no
  price goes below the NPC sell value except a fat-finger.
- A mod vendor stall that sells out packs up, and its spot refills.
- A `Market:` entry holds spots (`Spawns:`) and a weighted list of themes
  (`Themes: [{ Theme, Weight, Min, Max }]`, each theme an ordinary vendor
  entry without Spawns). Every time a spot gets a stall it rolls a theme:
  first any below its Min, then by weight, each theme's weight divided by
  one plus the stalls of it already standing, skipping any at its Max. So
  the stalls change as they rotate rather than only on a restart.
- `Buying: true` on a Pool vendor makes its shells open a real buying store
  instead of a stall: up to 5 items from the pool (only items rAthena lets a
  buying store take), each with its wanted amount and a price rolled in its
  range at the mod's price level, never below what an NPC pays. The shell
  gets one of each item, exactly the zeny it offers and room to carry it all;
  when its store closes (all bought, or out of zeny) it packs up like a
  sold-out stall. Its callouts come from `buyer_call` in population_chat.yml.
  Patch 0020 keeps shells' buying stores out of the database, as 0001 does
  for vending.
- Patch 0021: a pet egg bought from a shell's stall is created for the buyer
  there and then (`pet_create_egg`), since a stall's eggs are placeholders
  with no pet row and would not hatch; unsold eggs leave nothing behind.
- `@vendorinfo` (patch 0019) lists the mod stalls on the GM's map, or shows a
  theme's stock and prices or a market's themes.
- A mod's price table, `db/population_vendor_prices/<prefix>.csv` with rows
  `Id,Name,Min,Max`, prices the plain stock lines of the vendors whose key
  starts with `<prefix>/`, over their YAML Price. Hand-editable in a
  spreadsheet.
- `Callouts: { EverySeconds: [min, max], MapGapSeconds }` paces a mod vendor's
  callouts and keeps stalls on one map from talking over one another.
- Script commands (patch 0018) let a mod's settings reach its vendors at
  startup, per VendorKey prefix: `population_vendor_count` (a total split
  across the mod's Spawns by their Counts), `population_vendor_rotation`
  (minutes), `population_vendor_callouts` (on/off and pace),
  `population_vendor_limit` (whether they wait for room under the population
  limit) and `population_vendor_price` (price level in percent).
- `{item}` and `{price}` in a chat line name a real item from the speaking
  shell's own stall. The shipped `vendor_call` lines use them.
- Both vendor databases import `db/import/`, with empty stubs in
  `db/import-tmpl/`, so a mod's file is read rather than ignored.

`registry/mods/prontera-vendors` is the worked example (its generator is in
`registry/tools/prontera-vendors`).

## Measured cost

Alpine/musl, arm64, packetver 20221005, map server only, 4 GiB guest:

| | shells | map-server RSS | CPU |
|---|---|---|---|
| engine off | 0 | 439 MiB | ~1% |
| demand-driven, nobody logged in | 0 | 435 MiB | 0.9% |
| upstream behaviour (`demand_spawn: 0`), cap 200 | 163-184 | 510 MiB | 5.7% |
| upstream behaviour, cap 2000 | 1855 | 960 MiB | 22-25% |

The middle row is the point of the exercise: with the engine switched **on** and
nobody playing, it costs what having it off costs. The upstream row is what we
used to pay around the clock for a world nobody was looking at.

Per-shell resident cost is **~0.3-0.4 MB** — 0.38 MB at 184 shells, 0.28 MB at
1855 as allocator overhead amortises. Either way it is roughly five times
upstream's ~80 KB, which is the size of the struct rather than the resident cost
once inventory and skill arrays are counted. `src/settings.html` budgets on 0.4,
deliberately the pessimistic end.

**Memory is not the constraint; CPU is.** 1855 shells cost under a gigabyte in a
4 GiB guest, with the guest reporting no memory pressure — but they burn
22-25% of one core continuously with nobody logged in, against 5.7% at 184.
The map server is single-threaded, so that is a quarter of the budget the actual
game runs in, spent animating a world no one is looking at. This is exactly the
cost demand-driven mode exists to avoid: the same cap, with shells only on
occupied maps, costs nothing until somebody logs in.

`population_engine_max_count` is a ceiling, not a target: the spawn YAML asked
for 184 at a cap of 200. Densities also stack, because a map appears in many
profiles — a town is named by about 13 of them — so an occupied town lands
around 20-25 shells.

**Not yet measured:** cost with a real player online, which is when shells
actually tick, and therefore the true per-map count under demand-driven mode.
That needs a client session rather than a headless stack.

## Updating

1. Clone upstream, find the commit range over their rAthena import.
2. Regenerate `patches/0001-*` from the files rAthena already owns, and refresh
   `files/` from the rest.
3. Re-apply the `RAGNAROKMAC` guard to `files/src/map/population_engine.cpp`.
4. Delete `vendor/rathena` and re-run `scripts/bootstrap.sh` — the apply script
   stamps a checkout and refuses to re-patch one built from a different patch
   set.

`0001` is a patch against rAthena's own files and will rot as rAthena moves;
when a hunk stops applying the script fails loudly rather than shipping a
half-wired server.
