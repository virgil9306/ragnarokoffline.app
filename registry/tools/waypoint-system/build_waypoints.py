#!/usr/bin/env python3
"""Build the waypoint-system mod's scripts from waypoints.csv and towns.csv.

The CSVs say everything: where each board stands, what it asks for and what
the trip costs, per era. This script only checks them against rAthena's maps
and items and writes them out as the mod's NPC scripts.

    python3 build_waypoints.py              check the CSVs, show what would be written
    python3 build_waypoints.py --write      write the mod's scripts
    python3 build_waypoints.py --check      fail if the mod's scripts are stale
    python3 build_waypoints.py --suggest    fill the empty cells of new rows

The CSVs live here, beside this script, and are not shipped: the mod carries
only the scripts generated from them. After --write, run scripts/mod-index.py.

--suggest is the balance rules below, applied to rAthena's spawns and drops: a
board spot beside the warp you walk in by, items the monsters there drop, and a
fee from the map's level and distance from town. It only fills empty cells, so
a value somebody chose is never overwritten; "-" marks an era as off.

--rathena (or RATHENA_DIR) points at the checkout; the default is the app's
vendor/rathena. Python 3, no packages. Nothing here runs in the game.
"""
import argparse
import collections
import csv
import glob
import math
import os
import re
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "../../.."))
MOD = os.path.join(ROOT, "registry/mods/waypoint-system")
# Where each era's generated script goes. Renewal is the mod's own npc/, and
# the pre-re folder (mod.json "prerenewalFolder") replaces it in pre-renewal.
OUT = {"re": "npc/waypoints_placed.txt", "pre-re": "pre-re/npc/waypoints_placed.txt"}

# --- Balance knobs -----------------------------------------------------------
# Fee: the larger of a distance price (maps from the nearest town) and a level
# price, plus a surcharge per dungeon floor below the first, rounded to 50.
FEE_BASE, FEE_PER_HOP = 300, 250
FEE_PER_LEVEL = {"Field": 15, "Dungeon": 30}
FEE_PER_FLOOR = 300
FEE_CAP = 5000
# Unlock: roughly how many kills on the map the items should take.
BUDGET = {("Field", False): 120, ("Field", True): 240,
          ("Dungeon", False): 300, ("Dungeon", True): 500}
HIGH_BAND = {"pre-re": 66, "re": 111}    # average mob level that counts as "high"
COMMON_MIN = 0.02                        # expected drops per kill to count as common
UNCOMMON = (50, 500)                     # per-drop rate (of 10000) for the uncommon pick
UNCOMMON_MIN_SHARE = 0.15                # ...from a mob that is this share of the map
# (least, most, round up to a multiple of) for a common and a rare item.
QTY_COMMON = (10, 200, 10)
QTY_UNCOMMON = (5, 20, 5)
SERVER_DROP_RATE = 1.0                   # conf/battle/drops.conf item_rate_common / 100
# Generic items found everywhere and worth more than the unlock: refine ores and
# gemstones. Never asked for.
EXCLUDE_ITEMS = {"Elunium", "Oridecon", "Elunium_Stone", "Oridecon_Stone",
                 "Red_Gemstone", "Blue_Gemstone", "Yellow_Gemstone"}
PLANT_AI = {"06"}                        # plants' drops do not count

# --- Map graph ---------------------------------------------------------------
# Scripts whose warps are not a player's way into a map.
SKIP_SCRIPTS = re.compile(r"custom|events|instances|CashShop|kafras|guides|eden|warper|test|jobs/|achievements|adven_boards")
NOISE_TOWNS = {"-", "bat_room", "turbo_room", "job3_rune01", "lhz_in02", "moc_para01",
               "alb2trea", "izlu2dun", "pay_arche", "prt_fild05", "moc_ruins", "glast_01"}
# Kafra teleport destinations that are not towns, and towns served by other
# teleport services.
KAFRA_EXTRA = {"cmd_fild07", "mjolnir_02", "gef_fild10", "izlude", "dicastes01"}
# Ways in that the script scan misses (the NPC is defined on "-" and duplicated).
MANUAL_EDGES = [("izlude", "izlu2dun", None, None)]

# The keeper's NPC id, mapped to its sprite in the mod's System/jobname.lub.
# Ids 19000-19998 are free for mods, but one id per mod: card-remover has 19510.
KEEPER_SPRITE = 19520

# --- Board placement ---------------------------------------------------------
BOARD_RING = (3, 8)        # cells from where you walk onto the map
BOARD_KEEP_CLEAR = 3       # cells from any warp portal or other NPC


def npc_files(rathena, era):
    confs = [c for c in glob.glob(f"{rathena}/npc/scripts_*.conf") + glob.glob(f"{rathena}/npc/{era}/scripts_*.conf")
             if "custom" not in c and "test" not in c]
    files, dels = [], set()
    for c in confs:
        for line in open(c, errors="ignore"):
            m = re.match(r"(npc|delnpc):\s*(\S+)", line.split("//")[0].strip())
            if m:
                (dels.add if m.group(1) == "delnpc" else files.append)(m.group(2))
    return [f for f in files if f not in dels and os.path.exists(f"{rathena}/{f}")]


class World:
    """The parts of an era's NPC scripts the generator needs."""

    def __init__(self, rathena, era):
        self.edges = collections.defaultdict(set)
        self.walk_edges = collections.defaultdict(set)  # warps only, plus boats and sailors from town
        script_edges = []
        self.arrivals = collections.defaultdict(list)   # map -> [(from map, x, y)]
        self.portals = collections.defaultdict(list)    # map -> [(x, y)] warp portals on it
        self.npcs = collections.defaultdict(list)       # map -> [(x, y)] NPCs standing on it
        self.spawns = collections.defaultdict(list)
        self.dungeon_maps, self.shop_items, kafra = set(), set(), set()
        for f in npc_files(rathena, era):
            script_ok = not SKIP_SCRIPTS.search(f)
            is_dungeon_spawn = "/mobs/dungeons/" in f
            cur = None
            for line in open(f"{rathena}/{f}", errors="ignore"):
                if line.startswith("//"):
                    continue
                parts = line.rstrip("\n").split("\t")
                kind = parts[1] if len(parts) >= 3 else ""
                head = parts[0].split(",")
                if kind in ("warp", "warp2") and len(parts) >= 4:
                    d = parts[3].split(",")
                    dst = d[2] if len(d) > 2 else d[0]
                    if head[0] != dst:
                        self.edges[head[0]].add(dst)
                        self.walk_edges[head[0]].add(dst)
                        if len(d) >= 5:
                            self.arrivals[dst].append((head[0], int(d[3]), int(d[4])))
                    if len(head) >= 3:
                        self.portals[head[0]].append((int(head[1]), int(head[2])))
                elif kind == "monster" and len(parts) >= 4:
                    a = parts[3].split(",")
                    try:
                        self.spawns[head[0]].append((int(a[0]), int(a[1])))
                    except ValueError:
                        pass
                    if is_dungeon_spawn:
                        self.dungeon_maps.add(head[0])
                elif kind in ("shop", "marketshop") and len(parts) >= 4:
                    for it in parts[3].split(",")[1:]:
                        self.shop_items.add(it.split(":")[0].strip())
                if ("script" in kind or kind in ("shop", "marketshop") or kind.startswith("duplicate")) and len(head) >= 3:
                    try:
                        self.npcs[head[0]].append((int(head[1]), int(head[2])))
                    except ValueError:
                        pass
                if "script" in kind:
                    cur = head[0]
                if cur and 'callfunc "F_Kafra"' in line:
                    kafra.add(cur)
                if cur and script_ok and cur != "-":
                    for dst, x, y in re.findall(r'\bwarp\s*"(\w+)"\s*,\s*(\d+)\s*,\s*(\d+)', line):
                        if dst != cur:
                            self.edges[cur].add(dst)
                            script_edges.append((cur, dst))
                            self.arrivals[dst].append((cur, int(x), int(y)))
        for a, b, x, y in MANUAL_EDGES:
            self.edges[a].add(b)
            self.walk_edges[a].add(b)
        self.hubs = (kafra - NOISE_TOWNS) | KAFRA_EXTRA
        for a, b in script_edges:
            if a in self.hubs:
                self.walk_edges[a].add(b)

    def walking(self):
        """Maps from the nearest town on foot: warps, and the boats and sailors
        in town, but not a quest NPC's shortcut into a dungeon's deep end."""
        return bfs(self.walk_edges, sorted(self.hubs))


def read_yaml_list(path, fields):
    """Read a rAthena YAML DB's Body as dicts. Not a YAML parser: it knows the shape."""
    out, cur, sub = [], None, None
    for line in open(path, errors="ignore"):
        m = re.match(r"  - Id: (\d+)", line)
        if m:
            cur = {"Id": int(m.group(1)), "Drops": []}
            out.append(cur)
            sub = None
            continue
        if cur is None:
            continue
        m = re.match(r"    (\w+):\s*(.*)", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            sub = key
            if key in fields and key not in cur:
                cur[key] = val
            continue
        if sub == "Drops":
            m = re.match(r"\s+- Item: (\S+)", line)
            if m:
                cur["Drops"].append([m.group(1), 0])
            m = re.match(r"\s+Rate: (\d+)", line)
            if m and cur["Drops"]:
                cur["Drops"][-1][1] = int(m.group(1))
    return out


def read_map_cache(rathena, era):
    """Walkability of every map: name -> (width, height, cells), cell 0 = walkable."""
    maps = {}
    for path in (f"{rathena}/db/map_cache.dat", f"{rathena}/db/{era}/map_cache.dat"):
        data = open(path, "rb").read()
        _, count = struct.unpack_from("<IH", data, 0)
        off = 8
        for _ in range(count):
            name = data[off:off + 12].split(b"\0")[0].decode(errors="replace")
            xs, ys, ln = struct.unpack_from("<hhi", data, off + 12)
            off += 20
            maps[name] = (xs, ys, data[off:off + ln])
            off += ln
    return maps


class Cells:
    def __init__(self, entry):
        self.w, self.h, packed = entry
        self.c = zlib.decompress(packed)

    def walkable(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h and self.c[x + y * self.w] == 0

    def open(self, x, y, need=9):
        """Walkable, with enough of the 3x3 around it walkable that the board
        does not plug a corridor. need=9 is fully open."""
        return self.walkable(x, y) and \
            sum(self.walkable(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)) >= need


def bfs(edges, starts):
    dist = {s: 0 for s in starts}
    q = collections.deque(starts)
    while q:
        u = q.popleft()
        for v in edges.get(u, ()):
            if v not in dist:
                dist[v] = dist[u] + 1
                q.append(v)
    return dist


def round50(x):
    return int(round(x / 50.0)) * 50


def suggest_spot(mp, eras, dungeon):
    """A spot for the board beside the warp you walk onto the map by, open in
    every era the map exists in. eras: [(world, cells, nearest)]. Returns
    (x, y, entry map) or None.

    The entry is the warp from the side nearest a town, counted over all eras
    together, so both eras agree on one spot."""
    eras = [e for e in eras if e[1]]
    if not eras:
        return None
    score = collections.defaultdict(int)
    land = {}
    for world, _, nearest in eras:
        for src, x, y in world.arrivals.get(mp, []):
            score[src] += nearest.get(src, 99)
            land.setdefault(src, (x, y))
    for src in score:  # a side missing from an era counts as far away
        score[src] += 99 * sum(1 for w, _, _ in eras if src not in {a[0] for a in w.arrivals.get(mp, [])})
    above = floor_above(mp) if dungeon else None
    if above in score:
        # A dungeon floor: you come down the stairs from the floor above.
        entry = above
        ax, ay = land[entry]
    elif score:
        entry = min(score, key=lambda s: (score[s], s))
        ax, ay = land[entry]
    else:
        entry, (ax, ay) = None, (eras[0][1].w // 2, eras[0][1].h // 2)
    crowd = [p for w, _, _ in eras for p in w.portals.get(mp, []) + w.npcs.get(mp, [])]
    # Fully open spots near the way in first; failing that, a looser spot a
    # little farther out (narrow dungeons such as Magma).
    for need, far in ((9, BOARD_RING[1]), (7, BOARD_RING[1] + 6)):
        for r in range(BOARD_RING[0], far + 1):
            best = None
            for x in range(ax - r, ax + r + 1):
                for y in range(ay - r, ay + r + 1):
                    if max(abs(x - ax), abs(y - ay)) != r:
                        continue
                    if not all(c.open(x, y, need) and land_beside(c, x, y) for _, c, _ in eras):
                        continue
                    if any(max(abs(x - px), abs(y - py)) < BOARD_KEEP_CLEAR for px, py in crowd):
                        continue
                    # The spot closest to straight ahead of the warp.
                    key = abs(x - ax) + abs(y - ay)
                    if best is None or key < best[0]:
                        best = (key, x, y)
            if best:
                return best[1], best[2], entry
    return None


def floor_above(mp):
    """The floor above a numbered dungeon floor, by name: pay_dun02 ->
    pay_dun01, gl_prison1 -> gl_prison. None for an unnumbered map."""
    m = re.match(r"(.*?)(\d+)$", mp)
    if not m:
        return None
    n = int(m.group(2)) - 1
    if n < 0:
        return None
    if n == 0 and len(m.group(2)) == 1:
        return m.group(1)
    return m.group(1) + str(n).zfill(len(m.group(2)))


def land_beside(cells, bx, by):
    """Where a warp to the board puts the traveller: two cells south of it, or
    anywhere beside it."""
    for dx, dy in ((0, -2), (0, -1), (1, -1), (-1, -1), (2, 0), (-2, 0), (0, 2), (1, 1), (-1, 1)):
        if cells.walkable(bx + dx, by + dy):
            return bx + dx, by + dy
    return None


def load_items(rathena, era):
    """AegisName -> item, from the era's item tables."""
    items = {}
    for p in glob.glob(f"{rathena}/db/{era}/item_db*.yml"):
        for it in read_yaml_list(p, {"AegisName", "Name", "Type"}):
            items[it.get("AegisName")] = it
    return items


def suggest_era(rathena, era, rows):
    """What the balance rules would ask for and charge, per row of one era.

    Returns {Id: dict(Level, Fee, Items=[(aegis, qty, source mob, rate)], ...)},
    or a dict with Skip saying why there is no suggestion."""
    world = World(rathena, era)
    cache = read_map_cache(rathena, era)
    mobs = {m["Id"]: m for m in read_yaml_list(f"{rathena}/db/{era}/mob_db.yml",
                                                {"Name", "Level", "Class", "Ai", "MvpExp"})}
    items = load_items(rathena, era)
    sold = {a for a, it in items.items() if a in world.shop_items or str(it["Id"]) in world.shop_items}

    # Floor depth: how many dungeon maps deep, walking in from outside.
    dun = world.dungeon_maps
    outside = [m for m in set(world.edges) | {d for v in world.edges.values() for d in v} if m not in dun]
    depth = {m: d for m, d in bfs({u: {v for v in vs if v in dun} for u, vs in world.edges.items()},
                                  outside).items() if m in dun}
    nearest = bfs(world.edges, sorted(world.hubs))

    out = {}
    for r in rows:
        mp, typ = r["Map"], r["Type"]
        w = out[r["Id"]] = {}
        if mp not in cache:
            w["Skip"] = "map not in this era"
            continue
        pop = [(mobs[i], n) for i, n in world.spawns.get(mp, []) if i in mobs]
        eligible = [(m, n) for m, n in pop if m.get("Ai") not in PLANT_AI and "MvpExp" not in m]
        total = sum(n for _, n in eligible)
        if not total:
            w["Skip"] = "no eligible spawns"
            continue
        level = round(sum(int(m.get("Level", 1)) * n for m, n in eligible) / total)
        high = level >= HIGH_BAND[era]
        budget = BUDGET[(typ, high)]

        # Expected drops per kill of each Etc item, and which mob gives the most.
        share = collections.Counter()
        for m, n in eligible:
            share[m.get("Name")] += n / total
        epk, source, best_rate = collections.Counter(), {}, {}
        for m, n in eligible:
            for aegis, rate in m["Drops"]:
                it = items.get(aegis)
                if not it or it.get("Type") != "Etc" or aegis in EXCLUDE_ITEMS or aegis in sold:
                    continue
                gain = n / total * min(rate * SERVER_DROP_RATE, 10000) / 10000
                epk[aegis] += gain
                if gain > source.get(aegis, (None, 0, 0))[1]:
                    source[aegis] = (m.get("Name"), gain, rate)
                if share[m.get("Name")] >= UNCOMMON_MIN_SHARE:
                    best_rate[aegis] = max(best_rate.get(aegis, 0), rate)

        picks, used_mobs = [], set()

        def pick(cands, n, lo_hi):
            for a in cands:
                if len(picks) >= n:
                    return
                if a in (p[0] for p in picks):
                    continue
                if source[a][0] in used_mobs and len(cands) > n:
                    continue
                lo, hi, step = lo_hi
                picks.append((a, min(hi, max(lo, math.ceil(budget * epk[a] / step) * step))))
                used_mobs.add(source[a][0])

        ranked = [a for a, _ in epk.most_common()]
        commons = [a for a in ranked if epk[a] >= COMMON_MIN] or \
                  [a for a in ranked if source[a][2] >= UNCOMMON[0]][:1]
        uncommons = [a for a in ranked if UNCOMMON[0] <= best_rate.get(a, 0) <= UNCOMMON[1]]
        pick(commons, 2 if high else 1, QTY_COMMON)
        if typ == "Dungeon":
            pick(uncommons, len(picks) + 1, QTY_UNCOMMON)
        if not picks:
            w["Skip"] = "no item qualifies: pick one by hand"
            continue

        hops = nearest.get(mp)
        if hops is None:
            w["Skip"] = "no route from any town: set the fee by hand"
            continue
        floors = max(0, depth.get(mp, 1) - 1) if typ == "Dungeon" else 0
        fee = min(FEE_CAP, round50(max(FEE_BASE + FEE_PER_HOP * hops, FEE_PER_LEVEL[typ] * level)
                                   + FEE_PER_FLOOR * floors))
        w.update(Level=level, High=high, Budget=budget, Hops=hops, Fee=fee,
                 Items=[(a, q, source[a][0], source[a][2]) for a, q in picks])
    return out


ERA_COLS = {"pre-re": ("PreReItems", "PreReFee"), "re": ("ReItems", "ReFee")}
MAX_ITEMS = 3                            # the board script reads $@WP_IT1..3


def parse_items(text):
    """"Resin:21 Fin:2" -> [("Resin", 21), ("Fin", 2)]. Raises ValueError."""
    out = []
    for part in text.split():
        name, _, qty = part.partition(":")
        if not name or not qty.isdigit() or int(qty) < 1:
            raise ValueError(f"{part!r} is not AegisName:Quantity")
        out.append((name, int(qty)))
    return out


def from_csv(rathena, era, rows):
    """The waypoints of one era exactly as waypoints.csv says, checked against
    the era's maps and items. Returns (waypoints, problems, off)."""
    cache = read_map_cache(rathena, era)
    items = load_items(rathena, era)
    items_col, fee_col = ERA_COLS[era]
    live, problems, off = [], [], []
    for r in rows:
        where = f"{r['Id']} {r['Map']} ({era})"
        if r[items_col].strip() in ("", "-") or r[fee_col].strip() in ("", "-"):
            off.append((r, "empty" if "" in (r[items_col].strip(), r[fee_col].strip()) else "-"))
            continue
        try:
            wanted = parse_items(r[items_col])
        except ValueError as e:
            problems.append(f"{where}: {items_col}: {e}")
            continue
        unknown = [a for a, _ in wanted if a not in items]
        if unknown:
            problems.append(f"{where}: {items_col}: no such item in this era: {', '.join(unknown)}")
            continue
        if len(wanted) > MAX_ITEMS:
            problems.append(f"{where}: {items_col}: at most {MAX_ITEMS} items")
            continue
        if not r[fee_col].strip().isdigit():
            problems.append(f"{where}: {fee_col} must be a whole number of zeny")
            continue
        if r["Map"] not in cache:
            problems.append(f"{where}: no such map in this era (put - in {items_col} to leave it out)")
            continue
        if not (r["BoardX"].isdigit() and r["BoardY"].isdigit()):
            problems.append(f"{where}: BoardX,BoardY missing: run --suggest")
            continue
        board = (int(r["BoardX"]), int(r["BoardY"]))
        cells = Cells(cache[r["Map"]])
        landing = land_beside(cells, *board) if cells.walkable(*board) else None
        if not landing:
            problems.append(f"{where}: BoardX,BoardY {board[0]},{board[1]} is not walkable")
            continue
        live.append(dict(r, Fee=int(r[fee_col]), Board=board, Land=landing,
                         Items=[(items[a]["Id"], items[a]["Name"], q) for a, q in wanted]))
    return cache, live, problems, off


def read_csv(name):
    with open(os.path.join(HERE, name), newline="") as f:
        return list(csv.DictReader(l for l in f if not l.startswith("#")))


def check_towns(towns, cache, world, era):
    ok = []
    for t in towns:
        if t["Era"] not in ("any", era):
            continue
        if t["Map"] not in cache:
            print(f"  town {t['Map']}: not a map in {era}, left out", file=sys.stderr)
            continue
        x, y = int(t["X"]), int(t["Y"])
        if not Cells(cache[t["Map"]]).walkable(x, y):
            print(f"  town {t['Map']}: {x},{y} is not walkable in {era}, left out", file=sys.stderr)
            continue
        ok.append(t)
    return ok


def script_text(era, waypoints, towns):
    q = lambda s: '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'
    live = waypoints
    L = ["//===== Ragnarok Offline: waypoint-system ===================",
         f"//= Generated for {'renewal' if era == 're' else 'pre-renewal'} by",
         "//= registry/tools/waypoint-system/build_waypoints.py --write.",
         "//= Do not edit: change registry/tools/waypoint-system/waypoints.csv",
         "//= or towns.csv and regenerate.",
         "//============================================================",
         "",
         "// What each waypoint is, indexed by its permanent Id.",
         "-\tscript\tWaypointData\t-1,{",
         "OnInit:"]
    ids = [int(w["Id"]) for w in live]
    L.append(f"\t$@WP_MAXID = {max(ids) if ids else 0};")
    L.append(f"\tsetarray $@WP_IDS[0], {', '.join(map(str, ids))};")
    for w in live:
        i = int(w["Id"])
        sets = [f'$@WP_MAP$[{i}] = {q(w["Map"])};',
                f'$@WP_NAME$[{i}] = {q(w["Region"] + " - " + w["Name"])};',
                f'$@WP_TYPE[{i}] = {0 if w["Type"] == "Field" else 1};',
                f'$@WP_FEE[{i}] = {w["Fee"]};',
                f'$@WP_X[{i}] = {w["Land"][0]}; $@WP_Y[{i}] = {w["Land"][1]};']
        for n, (iid, _, qty) in enumerate(w["Items"], 1):
            sets.append(f"$@WP_IT{n}[{i}] = {iid}; $@WP_QT{n}[{i}] = {qty};")
        names = "; ".join(f"{qty}x {nm}" for _, nm, qty in w["Items"])
        L.append(f"\t// {w['Map']}: {names}")
        L.extend("\t" + s for s in sets)
    for t in towns:
        L.append(f'\t$@WPT_{t["Map"]}$ = {q(t["Name"])};')
    L += ["\tend;", "}", "", "// The boards, one per waypoint."]
    for w in live:
        bx, by = w["Board"]
        L.append(f"{w['Map']},{bx},{by},4\tduplicate(WaypointBoard)\tWaypoint#{w['Id']}\t858")
    L += ["", "// The Waypoint Keepers, one per town."]
    # rAthena caps an NPC's full name, # part included, at 24 characters.
    for n, t in enumerate(towns, 1):
        L.append(f"{t['Map']},{t['X']},{t['Y']},{t['Dir']}\tduplicate(WaypointKeeper)\tWaypoint Keeper#{n}\t{KEEPER_SPRITE}")
    return "\n".join(L) + "\n"


def read_rows():
    path = os.path.join(HERE, "waypoints.csv")
    lines = open(path, newline="").read().splitlines()
    comments = [l for l in lines if l.startswith("#")]
    rows = list(csv.DictReader(l for l in lines if l and not l.startswith("#")))
    return path, comments, rows


def suggest(rathena):
    """Fill every empty cell of waypoints.csv that the rules can fill: the
    board spot, and each era's items and fee. A filled cell is never changed;
    "-" means "off in this era" and is left alone too."""
    path, comments, rows = read_rows()
    eras = {}
    for era in ("re", "pre-re"):
        world = World(rathena, era)
        eras[era] = (world, read_map_cache(rathena, era), world.walking())
    for r in rows:
        if not (r["BoardX"] and r["BoardY"]):
            spot = suggest_spot(r["Map"], [(w, Cells(c[r["Map"]]) if r["Map"] in c else None, n)
                                           for w, c, n in eras.values()], r["Type"] == "Dungeon")
            if spot:
                r["BoardX"], r["BoardY"] = str(spot[0]), str(spot[1])
                print(f"{r['Id']:>3} {r['Map']:12} board {spot[0]},{spot[1]}, beside the warp from {spot[2]}")
            else:
                print(f"{r['Id']:>3} {r['Map']:12} no open spot found: set BoardX,BoardY by hand")
    for era, (items_col, fee_col) in ERA_COLS.items():
        todo = [r for r in rows if not r[items_col].strip() or not r[fee_col].strip()]
        if not todo:
            continue
        got = suggest_era(rathena, era, todo)
        for r in todo:
            w = got[r["Id"]]
            if "Skip" in w:
                print(f"{r['Id']:>3} {r['Map']:12} {era}: nothing suggested ({w['Skip']})")
                continue
            if not r[items_col].strip():
                r[items_col] = " ".join(f"{a}:{q}" for a, q, _, _ in w["Items"])
            if not r[fee_col].strip():
                r[fee_col] = str(w["Fee"])
            why = "; ".join(f"{a} from {m} {rate / 100:g}%" for a, _, m, rate in w["Items"])
            print(f"{r['Id']:>3} {r['Map']:12} {era}: L{w['Level']}, ~{w['Budget']} kills, "
                  f"{r[items_col]}, {r[fee_col]}z  ({why})")
    with open(path, "w", newline="") as f:
        f.write("\n".join(comments) + "\n")
        out = csv.DictWriter(f, fieldnames=list(rows[0].keys()), lineterminator="\n")
        out.writeheader()
        out.writerows(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--rathena", default=os.environ.get("RATHENA_DIR", os.path.join(ROOT, "vendor/rathena")))
    ap.add_argument("--suggest", action="store_true",
                    help="fill the empty cells of waypoints.csv: board spot, items and fee")
    ap.add_argument("--write", action="store_true", help="write the mod's scripts from the CSVs")
    ap.add_argument("--check", action="store_true",
                    help="fail if the mod's scripts are not exactly what the CSVs generate")
    a = ap.parse_args()
    if a.suggest:
        suggest(a.rathena)
    _, _, rows = read_rows()
    towns = read_csv("towns.csv")
    ids = [r["Id"] for r in rows]
    if len(set(ids)) != len(ids) or not all(i.isdigit() for i in ids):
        print("waypoints.csv: every Id must be a unique whole number", file=sys.stderr)
        return 1
    failed = stale = False
    for era in ("pre-re", "re"):
        cache, live, problems, off = from_csv(a.rathena, era, rows)
        if not a.check:
            print(f"===== {era}: {len(live)} waypoints")
            for w in live:
                names = ", ".join(f"{q}x {n}" for _, n, q in w["Items"])
                print(f"{w['Id']:>3} {w['Map']:12} {w['Type']:7} board {w['Board'][0]},{w['Board'][1]}  "
                      f"fee {w['Fee']:<5} {names}")
            for r, why in off:
                print(f"{r['Id']:>3} {r['Map']:12} off in this era" + (" (no items or fee yet: run --suggest)" if why == "empty" else ""))
        for p in problems:
            print(f"PROBLEM {p}", file=sys.stderr)
        failed |= bool(problems)
        if problems:
            continue
        text = script_text(era, live, check_towns(towns, cache, None, era))
        path = os.path.join(MOD, OUT[era])
        if a.check:
            # Line endings aside, as git sees them: a Windows checkout has CRLF.
            on_disk = open(path, newline="").read().replace("\r\n", "\n") if os.path.exists(path) else ""
            if on_disk != text:
                print(f"{os.path.relpath(path, ROOT)} is not what the CSVs generate: "
                      f"run build_waypoints.py --write", file=sys.stderr)
                stale = True
            else:
                print(f"{os.path.relpath(path, ROOT)} matches the CSVs")
        elif a.write:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", newline="\n") as f:
                f.write(text)
            print(f"wrote {os.path.relpath(path, ROOT)}")
    if failed:
        print("nothing written for an era with problems" if a.write else "fix the problems above", file=sys.stderr)
        return 1
    if stale:
        return 1
    if a.write:
        print("now run: python3 scripts/mod-index.py   (the scripts' digests changed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
