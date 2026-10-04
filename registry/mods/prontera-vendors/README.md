# prontera-vendors

A living player market on Prontera's main road, for a world with few or no
other players. Fake players run vending stalls on the inner sidewalks and
buying stores on the outer ones. They price things like a real server's
market, undercut each other, sell out, pack up and make room for others, so
the street keeps changing while you play.

Every vendor is a population-engine shell: a real character with a real
MC_VENDING stall or buying store, not an NPC dressed as one. You click it,
browse and trade exactly as you would with a player.

## What it needs

- **The population engine switched on:** Settings → Population → Fake
  players. Its vending economy (`population_engine_vending_enable`) must be
  on, which is the default.
- **App 1.4.5 or later.** The mod uses mod vendor markets, buying stores, the
  `population_vendor_*` script commands and `@vendorinfo` from that build. On
  an older build no stall appears, and the server log names what it doesn't
  know.

## Where

| Lane | What stands there |
|---|---|
| Inner sidewalks, x=147 and x=164, north (y=136–173) | Sell stalls, filled first |
| Inner sidewalks, x=147 and x=164, south (y=52–111) | Sell stalls, then these |
| East of the fountain, rows y=125 and y=110 (x=172–207) | Sell stalls, last |
| Outer sidewalks, x=140 and x=171 (y=136–172) | Buying stores, filled first |
| West of the fountain, rows y=125 and y=110 (x=104–135) | Buying stores, then these |

Stalls fill one lane at a time, in the order above, each opening near a
stall already there (sometimes leaving a cell free), the way players crowd
into a street that is already busy. Once a lane holds 70–80 % of the stalls
it has room for, the next stall goes to the following lane, so a busy lane
keeps a few natural gaps; when every lane has its share, the rest fill in
the same order. No stall stands within 3 cells of an NPC,
the same rule a player's own shop follows. On an app build older than the
one with lane filling, stalls spread at random over all their lanes instead.

The engine's own Prontera vendors keep spawning exactly as they would
without the mod; these are extra.

## Settings (Settings → Mods)

The mod's **Settings…** button opens its own page: every setting below,
grouped, with the customer rate tables beside the pace settings (they
follow the pace as you change it), Save, Save and restart, and Reset to
defaults. On an app without settings pages they show in the Mods tab.

| Setting | Default | What it does |
|---|---|---|
| Sell shops | on | Off removes every sell stall. |
| Sell stalls | 30 | How many sell stalls stand on their lanes (0–100). |
| Buy shops | on | Off removes every buying store. |
| Buy stalls | 30 | How many buying stores stand on their lanes (0–100). |
| Minutes before a stall changes | 240 | How long a vendor stays before packing up. Each varies by up to half either way, and stalls are checked once a minute, so short values run long (2 means roughly 1–5 minutes). 0 keeps them until the server restarts. |
| Price level (%) | 100 | Every price × this / 100, for sell stalls and buyers alike. Nothing goes below what an NPC pays. |
| Vendors respect the population limit | on | Off: stalls spawn even when the fake-player limit is reached (they still count toward it). |
| Vendors shout their wares | on | Stalls call out a real item and price now and then ("S> Elunium 13K", "B> Oridecon 9500"). |
| Seconds between a stall's shouts | 180 | Average per stall (each waits ½× to 1½×); no two stalls shout within 6 seconds of each other. |

Settings take effect when the server starts.

## Sell stalls

118 themes. Each time a spot gets a stall (at server start, after a rotation
or after a sell-out) it rolls a theme, so over a session the whole range
comes through:

- **Staples, always up:** general goods, potions, forge supplies, healing
  items, common cards and rare cards (at least one each, at most two).
- **Goods:** slim potions, gemstones, Ygg/Ori/Elu, skill supplies, ammo,
  magic scrolls, dyestuffs (every sign says so), taming items, elemental converters, Undershirt +
  Pantie, Bloody Branches, OBB/OPB, OCA/MCA.
- **Cards:** besides the two staples, binders by slot (weapon, armor,
  headgear, garment and shoes, shield, accessory) and a cheap-cards stall.
  Never MVP cards. Card stalls are twice as likely as other themes.
- **By class:** Knight, Crusader, Wizard, Sage, Hunter, Bard/Dancer, Priest,
  Monk, Assassin, Rogue, Blacksmith, Alchemist, Taekwon/SG/SL, Ninja,
  Gunslinger, Super Novice, Doram: gear that class wears and few others can.
- **By weapon type:** daggers, swords, two-handers, spears, axes, maces,
  staves, bows, books, knuckles, instruments and whips, guns, huuma.
- **By armor slot:** garments, footgear, shields, body armor, slotted gear,
  headgear, accessories, costumes.
- **Pets:** pet eggs with incubators and food, and pet equipment. An egg
  bought from a stall arrives as a real, hatchable egg: the server creates
  it for you at the moment you buy it.
- **Specials:** starter gear, low- and mid-level weapons, katars, elemental
  daggers (forged Fire/Water/Earth/Wind, some "Very Strong"), crimson
  weapons, shadow gear, a stall that sells nothing but an Ice Pick, rare
  collectibles, a "hunter's haul" of popular drops.
- **Carded:** carded weapons, carded armory (body, shield, garment, shoes,
  headgear) and carded accessories: the builds iRO players really listed
  (from ragnastats: "+7 Triple Critical Jur", "Thara Frog Guard", "Clip of
  Zerom"), weighted by how often, plus a few messed-up cardings sold cheap.
  Class stalls carry their guide builds (iRO wiki) and carded pieces that
  class wears; refined-weapon and slotted-gear stalls carry some too. A
  carded piece costs its item, refines and cards, plus a little for the
  work. Never MVP cards.
- **Refined:** weapons from their safe limit to three past it, armor +4 to
  +7, priced by what it costs to make, including failed attempts past the
  safe limit.
- **Loot:** one stall per dungeon (Byalan, Geffenia, Kiel, Payon Cave, Orc
  Dungeon, Ant Hell, Sphinx, Pyramids, Sunken Ship, Clock Tower, Glast Heim,
  Turtle Island, Toy Factory, Niflheim, Magma, Ice Cave, Abyss Lake,
  Thanatos, Odin, Juperos, Bio Lab, Comodo, Amatsu, the Culverts, the Guild
  Dungeon), loot by monster level (1–20 up to 81–99), mini-boss loot and MVP
  items. Each loot stall skips what dozens of monsters drop, so it shows its
  own place.
- **Random:** five stalls that each sample a broad pool: monster loot,
  consumables, equipment, cheap junk ("Cart Clearance") and a mixed bag.

Every other theme stands at most once at a time. Shop signs mix theme names
with the vague titles real stalls use ("Stuff", "SALE", "Happy hunting!",
"..."), taken from a sample of 500 iRO shops, and two stalls never show the
same sign (a repeat gets a number: "ores n more 2"). A sign that offers goods
("SALE", "cheap stuff") only ever hangs over a stall that sells; buyers get
their own ("WTB", "B> paying well"), and now and then a cheeky one ("B> your
mom", "WTB> a happy life"). Stalls of mixed goods (general goods, the
hunter's haul and the random stalls) get cheeky sell signs too ("S> my
sanity, cheap", "S> definitely not stolen"); a stall of one kind of thing
always says what it sells.

A sign that names items ("S> OBB OPB", "B> ori elu", "B> Soldier Skeleton
loot") only goes up over a stall that really has them, and some signs name
an item and price straight from the stall's stock: "S> Elunium 13k", "B>
Sticky Mucus 450z". These need an app build with the matching population
engine (`StockTitles`); on an older one, stalls show only the signs that
name no item, so a sign never lies either way.

A stall that sells out packs up within a minute, as a player would, and
another takes the spot.

## Buying stores

About 70 themes, most of them buying what you bring home from hunting:

- **Always there:** two buyers of upgrade ores (Elunium, Oridecon, Rough
  Elunium, Rough Oridecon, Emveretarcon), and one each for crafting
  materials (Steel, Iron, Iron Ore, Coal, Star Crumb), elemental stones and
  converters, herbs, alchemy and brewing materials (Witched Starsand, Empty
  Bottle, Poison Spore, Medicine Bowl and more), berries (Strawberry, Grape,
  Honey, the SP food no NPC sells) and junk: the drops nearly every monster
  leaves (Sticky Mucus, Zargon, Jellopy, Garlet, Cyfar, Shell...).
- **Dungeon buyers:** one per dungeon, about 38: "Buying Byalan loot",
  "WTB> Thor's Volcano loot", "B> Soldier Skeleton loot". Each wants what that
  dungeon's monsters drop most, weighted by how many of them spawn, so a Payon
  Cave buyer asks for Skel-Bones and Decayed Nails, not a rare drop.
- **Leveling-field buyers:** the fields players farm, where the loot has
  buyers on real servers: the spore fields (Strawberries, spores), Payon
  Forest (Horns, Acorns, Resin), the Sograt desert (Grit, Fine Sand, Frills),
  the Orc fields, Kokomo Beach, the Geffen, Juno, Einbroch and Rachel fields,
  and the fields of the EXP-quest NPCs. Their signs name the place and its
  monster, from that era's own spawns: the Sograt buyer is "B> Scorpion
  loot" in renewal and "B> Hode loot" in pre-renewal.
- **Quests:** turn-ins for the repeatable EXP quests and the Eden Group's
  collecting missions (Fluff, Grit, Huge Leaf, Rusty Screw...), anything
  several NPC quests ask for, and dyestuffs.
- **The rest:** rare cards (never the low-level ones: those you sell at a
  stall), OCA/MCA/OBB/OPB and branches, Ygg items, potions, other
  consumables, gemstones, loot by monster level (six bands), and a random
  buyer.

Dungeon and field buyers together hold a little over half the spots that
rotate; each stands at most once at a time.

- A store wants 2–5 kinds of item (rAthena's limit) and only items rAthena
  allows in buying stores, so never equipment. (Pre-renewal rAthena does not
  allow Jellopy, so no buyer there takes it.)
- Buyers of loot, turn-ins, herbs, berries and alchemy materials pay 75–95 %
  of the low end of the item's sell price; the rest (cards, boxes, Ygg,
  gems, ores...) pay 60–85 %. Either way it is less than any stall asks and
  never less than an NPC pays.
- It wants lots of cheap loot and a few of anything valuable.
- It packs up when it has bought everything or spent its zeny.
- Anyone can open a buying store, so buyers wear any class's sprite and gear.

## Customers for your own stalls

Two settings, both off by default, bring the street's customers to the
stalls *you* open (needs the app build whose population engine has them; on
an older one they do nothing):

- **Customers buy from your stalls.** Open a vending stall as usual (a
  Merchant-class skill, as on any server), online or on `@autotrade`, and
  customers buy now and then. You get the zeny less the vending tax and the
  usual "sold" message, as if a player bought.
- **Sellers fill your buying stores.** Open a buying store and players
  bring loot to it: common drops often, rare ones seldom.

What decides a sale:

| | Effect |
|---|---|
| Your price vs the market (the price list's range) | under an NPC's price: snapped up; under market: faster; at market: steady; 1.5x: rare; 2x: never |
| Your buying-store offer vs the market | above market: eager; near it: steady; a lowball: rare; no more than an NPC pays: never |
| Demand (`BuyersPerDay`, `SellersPerDay` in the price list) | what fake buyers want and quests ask for sells best; sellers come as often as monsters drop the item |
| A fake stall on the map selling it cheaper (or buying it dearer) | half as many customers, a third if it is more than 5 % better |
| The map | Prontera in full, anywhere else 75 % |

How often they come, at 100 % pace in Prontera and a fair price (every line
is checked once a minute; under market more often, over it far less):

| Your stall sells | Customers a day | About one every |
|---|---|---|
| Items fake buyers want (Elunium, Strawberry, their loot) | 36-75 | 20-40 minutes |
| Other everyday items | about 12 | 2 hours |
| Equipment, cards | 6-9 | 3-4 hours |
| Dear items (100k+, 1M+) | x0.6, x0.3 | slower still |

| Your buying store wants | Sellers a day | About one every |
|---|---|---|
| Common loot (Jellopy, Sticky Mucus) | 72 | 20 minutes |
| Uncommon drops | 18-36 | 40-80 minutes |
| Rare drops | 3-6 | 4-8 hours |
| MVP-only items | never | |

A customer takes 1-5 (cheap items 5-50), so a fairly priced stack of 30
Elunium sells in about three hours. The generator's `DEMAND_SCALE` sets this
base; the pace settings scale it per server. **Customers' pace** and **Sellers' pace**
scale all of it: 200 % twice as often, 50 % half.

**While you are away.** An `@autotrade` stall keeps trading. With
**Customers come while the server is off** on, a restart also gives it the
customers of the time the server was down (up to 48 hours). The Merchant
Guild mails you (RODEX) what your stall or store did while you were away:
after a start, when it sells out or closes, and every six hours.

**For GMs:** `@vendorinfo customers` lists the player stalls on your map
with each line's market price, price factor and expected customers a day,
and how long the last pass took; `@vendorinfo customers ff <minutes>`
fast-forwards them.

## Prices

Prices follow kRO's player market, which is cheaper and steadier than old
iRO's (Elunium ~13k rather than ~263k) and suits a solo world better. Where
each price comes from, in order:

1. **kro:** the 90-day median asking price on kRO's official servers, from
   RagMAYA (ragmaya.kr), where at least 3 listings back it.
2. **ragnastats:** iRO's average from ragnastats.com, converted to kRO's
   scale with a factor per kind of item, learned from items both price.
3. **npc:** an NPC's price, for gear an NPC sells. A stall never asks more
   than an NPC does for the same item.
4. **sibling:** a same-named item's price (Knife → Knife [3]).
5. **estimate:** a model's ballpark from what the item is, which monsters
   drop it, how rarely, and its level and stats. Typically within ×2.5
   either way, so worth checking.

Items none of these can price have no price and are never sold.

A few prices are set in the generator rather than taken from a market
(`PRICE_SET` in `build_vendors.py`, `set` in the price list):

| Item | Renewal | Pre-renewal |
|---|---|---|
| Old Card Album | 900,000 – 1,100,000 | 600,000 – 750,000 |
| Mystical Card Album | 2,700,000 – 3,300,000 | 1,800,000 – 2,250,000 |

An Old Card Album sells for about what the card it rolls is worth on average
on this price list, under the 2.5M the Eden market NPC asks; a Mystical Card
Album, a shot at the rare cards, for three OCAs.

Each item has a `[min, max]` range, and every stall rolls inside it. Half the
time an item is listed 1–5 % under the cheapest rival stall on the map, but
never below its range. Nothing goes below what an NPC pays for it, so
nothing can be flipped for profit, except the rare "fat-finger": 1 in 5000
per item, a price with a digit missing.

### Changing prices

`db/population_vendor_prices/prontera-vendors.csv` is the price list: one row
per tradeable item, `Id,Name,Min,Max,Source`. Open it in Excel or any
editor, change what you like and restart the server; it wins over the prices
in the YAML, for sell stalls and buyers. The Id decides; the Name is there to
find things, and `;` works as the separator too. `0,0` means "no price yet".

Refined, forged and carded lines keep the price in `population_vendors.yml`,
since a +9 isn't priced like a plain one. The file only prices this mod's
vendors.

## For GMs

- `@vendorinfo` lists every mod stall on your map: owner, place, theme, sign,
  item count and minutes to rotation.
- `@vendorinfo <theme or market>` shows a theme's stock and price ranges, or a
  market's themes and how many of each are up. The last part of a key is
  enough: `@vendorinfo byalan`, `@vendorinfo refine`, `@vendorinfo sidewalks`.

## Pre-renewal

A pre-renewal server gets its own set from `pre-re/db/` (`"prerenewalFolder"`
in mod.json lays it over `db/`): the same themes where the items exist,
without the renewal-only ones (costumes, shadow gear, Doram), with its own
price list.

## How it's built

`db/population_vendors.yml`, `db/population_vendor_pop.yml`, the price list
and the pre-renewal set are **generated** from rAthena's item, monster, pet
and spawn databases and two price caches. The tools live outside the mod in
[`registry/tools/prontera-vendors/`](../../tools/prontera-vendors/), so
players don't download them:

```
python3 registry/tools/prontera-vendors/build_vendors.py                   # rebuild from the caches
python3 registry/tools/prontera-vendors/build_vendors.py --era pre-re      # the pre-renewal set
python3 registry/tools/prontera-vendors/build_vendors.py --refresh-prices  # fetch iRO prices the cache lacks
python3 registry/tools/prontera-vendors/build_vendors.py --reprice         # rebuild the price list from the data
python3 registry/tools/prontera-vendors/scrape_ragmaya.py --workers 12     # refresh kRO prices (resumable)
python3 registry/tools/prontera-vendors/scrape_carded.py --adjectives      # iRO's card prefixes (once)
python3 registry/tools/prontera-vendors/scrape_carded.py                   # carded builds iRO players sold (resumable)
```

Themes are defined in `build_vendors.py`: a hand list, a rule over the item
database, "what these dungeons' monsters drop", or, for buyers, a place
(`AREAS_LOOT`, `BUY_ONLY_DUNGEONS`, `FIELD_SPOTS`). A re-run keeps
rows of the price list you changed by hand (marked `manual`); everything else
follows the data. The YAML can be edited by hand for a quick test, but a
re-run overwrites it.

How the YAML works:

- **The first two entries are the markets.** Each has `Spawns` (map, areas,
  Count, `Fill: Lanes`) and `Themes` (each with `Weight`, `Min`, `Max`). The
  areas are the lanes, filled in the order listed (`AREAS` and `BUY_AREAS` at
  the top of the generator).
- **The settings override some of it.** The Sell stalls and Buy stalls
  settings replace each market's Count.
- **Each theme is a `Type: Pool` vendor.** Its fields are `PickCount`,
  `MaxSlots`, `TitleFromPool` (`{name}` is the vendor's name), rotation,
  `PriceMistakeOneIn`, `Undercut` and `Callouts`. Buyers have
  `Buying: true`.
- **Each Pool line** has `Amount` and `Price: [min, max]`, and optionally
  `Refine`, `Element`, `Stars` and `Cards`.

## Known gaps

- Vendors use the engine's generated names, not player-style handles.
- When a stall rotates or sells out, a new vendor takes the spot rather than
  the same one restocking.

## Files

```
registry/mods/prontera-vendors/
├── mod.json                         settings
├── README.md
├── images/                          icon and screenshot
├── npc/
│   ├── prontera-vendors.txt         hands the settings to the engine
│   ├── prontera-vendors-customers.txt  the customer settings, for the engine
│   └── prontera-vendors-newer.txt   the settings that need app 1.4.5
├── db/
│   ├── population_vendors.yml       markets + themes (generated)
│   ├── population_vendor_pop.yml    one vendor profile per theme (generated)
│   └── population_vendor_prices/
│       └── prontera-vendors.csv     the price list; edit freely
└── pre-re/db/                       the pre-renewal set, same layout

registry/tools/prontera-vendors/     the generator, kept out of the mod
├── build_vendors.py
├── estimate.py                      the estimate model
├── scrape_ragmaya.py                kRO price fetcher
├── scrape_carded.py                 carded builds from iRO listings (ragnastats)
├── carded.json                      their cache: base item, refine, cards, listings
├── card_adjectives.json             iRO's card prefixes, to read those names
├── prices_kro.json                  kRO price cache (RagMAYA)
├── prices.json                      iRO price cache (ragnastats)
└── table_generated*.json            what it last wrote, to spot hand edits
```
