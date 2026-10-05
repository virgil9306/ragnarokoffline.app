# waypoint-system

Travel you earn, instead of a free warper.

Waypoint boards stand on 41 fields and dungeon floors, from low-level spots
to end-game ones. Walk there, bring the board what the monsters around it
drop, and it attunes to you. From then on a **Waypoint Keeper** in any town
sends you there for a fee, and the board sends you back to the town you came
from, once per trip.

**Where things are defined:** every waypoint is one row of
[`registry/tools/waypoint-system/waypoints.csv`](../../tools/waypoint-system/waypoints.csv):
the map, its name in the keeper's menu, where the board stands, the items it
asks for and the travel fee, each per era (`PreReItems`/`ReItems`,
`PreReFee`/`ReFee`). The keepers' towns are in `towns.csv` beside it. Those
files are the source; the mod ships only the scripts generated from them. See
[Adding or changing a waypoint](#adding-or-changing-a-waypoint). The settings
scale every fee and item count at once.

## Playing it

- **Find a board.** It stands a few steps from where you walk onto the map.
  Talking to it shows what it wants and how many of each you carry.
- **Attune.** Offer the items. They are used up, and the waypoint is yours.
- **Travel.** A Waypoint Keeper stands beside the usual warper spot in every
  major town. Pick *Fields* or *Dungeons*, then a waypoint.
- **Return.** After a keeper sends you out, the board you arrived at offers
  one free trip back to the town you left from.

What a board wants comes from the monsters on its map: the drops you collect
naturally while levelling there. Fields ask for one common drop. Dungeon
floors add a rarer one (0.5–5%), and the highest-level spots ask for more.
Cards, MVP drops, refine ores, gemstones and anything an NPC shop sells are
never asked for.

The fee depends on the waypoint's level and how many maps it is from the
nearest town: 800 zeny for a field next to town, up to a few thousand for a
deep, high-level dungeon. Dungeon floors further down cost a little more.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Waypoints are shared by the whole account | off | Off: each character attunes on its own. On: one character's waypoints work for all of them. Both are always saved, so switching loses nothing. |
| Travel fee (%) | 100 | Scales every fee. 0 makes travel free once attuned. |
| Items to attune (%) | 100 | Scales how many items each board asks for. Never less than one. |
| Keepers list boards you have found | on | Keepers also list boards you visited but did not attune to yet, as a reminder. |

## Both eras

Renewal and pre-renewal have different monsters, drops and levels, so each
has its own generated table (`npc/waypoints_placed.txt`, and
`pre-re/npc/waypoints_placed.txt`, which replaces it in pre-renewal). The
three renewal-only waypoints (Krakatau, Malaya field, Rockridge mine) are
left out of pre-renewal.

## Adding or changing a waypoint

Everything about a waypoint is one row of
[`registry/tools/waypoint-system/waypoints.csv`](../../tools/waypoint-system/waypoints.csv):
its map, menu name, where the board stands, and per era what it asks for
(`Resin:50 Fin:5`, by AegisName) and what the trip costs. `towns.csv` beside it
says where the keepers stand. Neither is shipped: the build script turns them
into `npc/waypoints_placed.txt` and `pre-re/npc/waypoints_placed.txt`, and
those are what the mod carries.

To add a waypoint, add a row with the next unused `Id`, the `Map`, `Type`
(Field or Dungeon), `Region` and `Name`, and leave the rest empty. Then, from
the repository root:

```
python3 registry/tools/waypoint-system/build_waypoints.py --suggest   # fills the empty cells
python3 registry/tools/waypoint-system/build_waypoints.py --write     # checks every row, writes the scripts
python3 scripts/mod-index.py                                          # the scripts' digests changed
```

`build_waypoints.py --check` fails when the committed scripts are not exactly
what the CSVs generate, so a reviewer can trust them from the CSV diff alone.

The CSVs and the build script live outside the mod: players need only the
generated scripts, and the registry does not carry `.py` files.

`--suggest` applies the mod's balance rules to rAthena's spawns and drops: a
spot beside the warp you walk in by (for a dungeon floor, the stairs from the
floor above), drops of the monsters there, and a fee from the map's level and
distance from town. It only fills empty cells, so change whatever you like
afterwards. `-` in an era's items or fee leaves the waypoint out of that era.
`--write` refuses an unknown item, an unwalkable spot or a malformed cell and
names the row. Never renumber or reuse an `Id`: unlocks are saved under it.

## Files

| Path | What it is |
|---|---|
| `npc/waypoints.txt` | the board and keeper templates, and the unlock helpers |
| `npc/waypoints_placed.txt` | generated, renewal: the data, and every board and keeper |
| `pre-re/npc/waypoints_placed.txt` | generated, pre-renewal |
| `System/jobname.lub` | gives the keeper NPC id 19520 its sprite |
| `data/sprite/npc/wp_npc.*` | the keeper's sprite |

The boards use the stock bulletin-board sprite (858).
