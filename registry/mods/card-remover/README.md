# card-remover

A **Card Remover** takes one card out of a piece of equipment you are wearing.
The item keeps everything else and stays equipped, and the card goes back into
your inventory. Nothing is ever destroyed.

He stands in seven towns:

| Town | Cell |
|---|---|
| Prontera | 182, 216 |
| Geffen | 115, 73 |
| Alberta | 104, 61 |
| Morroc | 155, 64 |
| Payon | 166, 99 |
| Izlude | 119, 157 |
| Al De Baran | 160, 100 |

## Paid in cards, not zeny

A single-player world has no real economy, so zeny would be no price at all.
He takes cards instead, and prices them by points:

| | Normal | Miniboss | MVP |
|---|---|---|---|
| A card you pay with is worth | 1 | 5 | 15 |
| Removing a card of this tier costs | 3 | 10 | 20 |

All six numbers are the mod's settings. Paying with points rather than a count
of cards means a stack of Poring cards can't buy an MVP card's freedom cheaply,
and an MVP card you don't need is worth what it should be.

Talk to him and choose **Remove a card**. His window lists what you are
wearing that has a card in it. Pick the card to remove, then the cards to pay
with. The total turns green when it is enough. If you pay with an MVP card, or
with more points than the removal costs, the window asks before going ahead.
Extra points are not given back.

## Which cards are MVP and miniboss cards

The tier comes from the monster that drops the card: an MVP gives an MVP card,
any other Boss-class monster a miniboss card, and everything else a normal card.
Event, instance and champion copies of a monster don't count, so Bigfoot Card
stays a normal card even though an event Eddga drops it. A card no monster
drops is a normal card.

The lists, for renewal and pre-renewal, are in `npc/card_tiers.txt`. It is
generated from rAthena's databases: run `python3 scripts/gen-card-tiers.py
--rathena ../rathena` to rebuild it after the pinned server changes.

## Looks

He is drawn with `data/sprite/npc/vadon.spr` from the game's own `data.grf`.
`System/jobname.lub` maps the NPC's id, 19510, to that sprite, so the mod ships
no sprite of its own.

## Needs

`successremovecards` with a card slot, from the rAthena fork, and the client's
`server:event`, which opens the window from the NPC. Both come with the app
version in `mod.json`.
