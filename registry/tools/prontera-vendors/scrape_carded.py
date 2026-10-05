#!/usr/bin/env python3
"""Fetch the carded and refined gear iRO players really sold, from ragnastats.

    python3 registry/tools/prontera-vendors/scrape_carded.py [--workers 4] [--min-seen 30]
    python3 registry/tools/prontera-vendors/scrape_carded.py --adjectives       # iRO's card prefixes, once
    python3 registry/tools/prontera-vendors/scrape_carded.py --retry-undecoded  # after new prefixes

ragnastats.com kept iRO's vending listings (roughly 2013-2020). Each item's
market page lists "Related Searches": the variants players listed, named the
way the client names them ("+8 Tripple Critical Jur [3]", "Chain Mail of
Ares [1]", "+5 Poaching Double Clamorous Jur [3]"). For every slotted weapon
and armor piece players traded (prices.json: seen at least --min-seen times),
this reads those variants, decodes the name into refine and cards with the
client's card prefix table, and fetches each carded variant's own page for
how often it was listed and at what price. It saves

    carded.json  { "<base item id>": { "name": "Jur", "variants": [
                     { "name": ..., "refine": 8, "cards": [4086, 4086, 4086],
                       "listings": 50, "median": 1200000 }, ... ] } }

Already fetched items are skipped and progress is saved as it goes, so it can
be stopped and resumed; delete an entry to fetch it again. Requests go a few
at a time with a pause, to stay gentle on a hobby site.

Prefixes: ragnastats' names are iRO's, older than today's translation, so
iRO's own come first: the "Adjective" each card's page on the iRO wiki
database lists (--adjectives fetches them into card_adjectives.json). The
English translation project's table fills in the rest
(vendor/ROenglishRE/Translation/Renewal/data/cardprefixnametable.txt). Both
are only needed here, not by build_vendors.py, which reads carded.json.
Forged weapons ("Very Strong Fire Stiletto") have no cards and stay
undecoded, rightly.
"""
import html
import json
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
RA = os.path.join(REPO, "vendor", "rathena")
PREFIXES = os.path.join(REPO, "vendor", "ROenglishRE", "Translation", "Renewal", "data", "cardprefixnametable.txt")
PRICES = os.path.join(HERE, "prices.json")
OUT = os.path.join(HERE, "carded.json")
ADJECTIVES = os.path.join(HERE, "card_adjectives.json")
IWDB = "https://db.irowiki.org/db/item-info/"
BASE = "https://ragnastats.com"
Loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)

MULTIPLIERS = {"double": 2, "triple": 3, "tripple": 3, "quadruple": 4, "quadra": 4}


def arg(name, default):
    return type(default)(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def get(url):
    try:
        raw = subprocess.run(["curl", "-s", "-m", "30", "-A", "Mozilla/5.0", url], capture_output=True, timeout=45).stdout
    except subprocess.TimeoutExpired:
        return None
    return raw.decode("utf-8", errors="replace")


def load_items():
    """Every weapon, armor and card of either era, by id."""
    out = {}
    for era in ("re", "pre-re"):
        for f in ("item_db_equip.yml", "item_db_etc.yml"):
            path = os.path.join(RA, "db", era, f)
            for e in yaml.load(open(path, encoding="utf-8"), Loader=Loader).get("Body") or []:
                out.setdefault(e["Id"], e)
    return out


def load_prefixes(items):
    """Prefix (or "of ..." postfix) -> the card it names: iRO's own first,
    then the translation table's. Where several cards share a name, the
    lowest id wins."""
    out = {}
    try:
        for cid, name in sorted(json.load(open(ADJECTIVES)).items(), key=lambda kv: int(kv[0])):
            if name and (items.get(int(cid)) or {}).get("Type") == "Card":
                out.setdefault(name.strip().lower(), int(cid))
    except FileNotFoundError:
        pass
    for line in open(PREFIXES, encoding="latin-1"):
        parts = line.strip().split("#")
        if len(parts) < 2 or not parts[0].isdigit() or not parts[1]:
            continue
        cid, name = int(parts[0]), parts[1].strip().lower()
        if (items.get(cid) or {}).get("Type") != "Card":
            continue
        out.setdefault(name, cid)
    return out


def decode(name, base, prefixes):
    """"+8 Tripple Critical Jur [3]" -> (8, [4086, 4086, 4086]), or None when
    the name does not read as base + known prefixes."""
    s = html.unescape(name).strip()
    s = re.sub(r"\s*\[\d\]$", "", s).strip()
    refine = 0
    m = re.match(r"^\+(\d+)\s+(.*)$", s)
    if m:
        refine, s = int(m.group(1)), m.group(2)
    i = s.lower().find(base.lower())
    if i < 0:
        return None
    before, after = s[:i].strip(), s[i + len(base):].strip()
    cards = []
    words = before.split()
    names = sorted(prefixes, key=lambda n: -len(n.split()))
    k = 0
    while k < len(words):
        times = 1
        if words[k].lower() in MULTIPLIERS:
            times = MULTIPLIERS[words[k].lower()]
            k += 1
        for n in names:
            nw = n.split()
            if n.startswith("of ") or [w.lower() for w in words[k:k + len(nw)]] != nw:
                continue
            cards += [prefixes[n]] * times
            k += len(nw)
            break
        else:
            return None
    if after:
        a = after.lower()
        times = 1
        for word, t in MULTIPLIERS.items():
            if a.startswith(word + " "):
                times, a = t, a[len(word) + 1:]
                break
        if a not in prefixes:
            return None
        cards += [prefixes[a]] * times
    return refine, cards


ROW = re.compile(r"x(\d+) for ([\d,]+)z")
PAGES = re.compile(r"<a href='\?(?:id=\d+&)?page=(\d+)'")
RELATED = re.compile(r"<a href='/market\?id=(\d+)'>([^<]*)</a>")


def listings(page_html):
    """(listings, median price) of a market page: pages x 25 rows, the first
    page's prices. ragnastats links at most six pages, so 150 means "150 or
    more"."""
    prices = [int(p.replace(",", "")) for _, p in ROW.findall(page_html)]
    pages = max([1] + [int(p) for p in PAGES.findall(page_html)])
    return (pages - 1) * 25 + len(prices), (int(statistics.median(prices)) if prices else None)


def fetch_item(iid, e, prefixes):
    time.sleep(0.4)
    name = f"{e['Name']} [{e['Slots']}]"
    page = get(f"{BASE}/market/{urllib.parse.quote_plus(name)}")
    if page is None or "RagnaStats" not in page:
        return iid, None
    variants, undecoded = [], []
    for mid, vname in RELATED.findall(page):
        d = decode(vname, e["Name"], prefixes)
        if d is None:
            undecoded.append(html.unescape(vname).strip())
            continue
        refine, cards = d
        if not cards:
            continue  # refined only: the generator prices those already
        time.sleep(0.4)
        vpage = get(f"{BASE}/market?id={mid}")
        n, med = listings(vpage) if vpage else (0, None)
        variants.append({"name": html.unescape(vname).strip(), "refine": refine, "cards": cards,
                         "listings": n, "median": med})
    return iid, {"name": e["Name"], "slots": e["Slots"], "variants": variants, "undecoded": undecoded}


ADJ = re.compile(r'infoTitle">Adjective</td>\s*<td[^>]*>([^<]*)</td>')


def fetch_adjective(cid):
    time.sleep(0.5)
    page = get(f"{IWDB}{cid}/")
    if page is None or "iW Database" not in page:
        return cid, None
    m = ADJ.search(page)
    return cid, html.unescape(m.group(1)).strip() if m else ""


def adjectives(items):
    """Every card's iRO prefix, from the iRO wiki database."""
    try:
        out = json.load(open(ADJECTIVES))
    except FileNotFoundError:
        out = {}
    todo = sorted(i for i, e in items.items() if e.get("Type") == "Card" and str(i) not in out)
    print(f"{len(todo)} card prefixes to fetch ({len(out)} cached)", file=sys.stderr)
    with ThreadPoolExecutor(arg("--workers", 3)) as pool:
        for n, (cid, adj) in enumerate(pool.map(fetch_adjective, todo), 1):
            if adj is not None:
                out[str(cid)] = adj
            if n % 100 == 0:
                json.dump(out, open(ADJECTIVES, "w"), indent=0, sort_keys=True)
                print(f"    {n}/{len(todo)}", file=sys.stderr)
    json.dump(out, open(ADJECTIVES, "w"), indent=0, sort_keys=True)
    print(f"done: {sum(1 for v in out.values() if v)} cards with a prefix", file=sys.stderr)


def main():
    items = load_items()
    if "--adjectives" in sys.argv:
        adjectives(items)
        return
    prefixes = load_prefixes(items)
    prices = json.load(open(PRICES))
    min_seen = arg("--min-seen", 30)
    try:
        cache = json.load(open(OUT))
    except FileNotFoundError:
        cache = {}
    if "--retry-undecoded" in sys.argv:
        # Fetch again what now decodes with the prefixes fetched since.
        again = [k for k, rec in cache.items()
                 if any(decode(n, rec["name"], prefixes) for n in rec.get("undecoded", []))]
        for k in again:
            del cache[k]
        print(f"{len(again)} items have names that decode now; fetching them again", file=sys.stderr)
    todo = [(i, e) for i, e in sorted(items.items())
            if e.get("Type") in ("Weapon", "Armor") and e.get("Slots", 0) > 0
            and (prices.get(str(i)) or [None, 0])[1] >= min_seen and str(i) not in cache]
    print(f"{len(prefixes)} card prefixes; {len(todo)} items to fetch ({len(cache)} cached)", file=sys.stderr)
    done = 0
    with ThreadPoolExecutor(arg("--workers", 4)) as pool:
        for iid, res in pool.map(lambda t: fetch_item(t[0], t[1], prefixes), todo):
            if res is None:
                continue  # failed; retried next run
            cache[str(iid)] = res
            done += 1
            if done % 20 == 0:
                json.dump(cache, open(OUT, "w"), indent=0, sort_keys=True)
                print(f"    {done}/{len(todo)}", file=sys.stderr)
    json.dump(cache, open(OUT, "w"), indent=0, sort_keys=True)
    carded = sum(len(v["variants"]) for v in cache.values())
    print(f"done: {len(cache)} items, {carded} carded variants", file=sys.stderr)


if __name__ == "__main__":
    main()
