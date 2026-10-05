# autoloot

An **Autoloot** window in game. Open it with **Alt+O**.

- **By rarity**: loot every drop whose chance is at or below a percent you
  choose. 5% picks up everything rarer than a 1-in-20 drop; 100% picks up
  everything.
- **By item type**: loot every card, every weapon, and so on, whatever its
  rarity.
- **These items**: a list of exact items to always loot. Search by name or id
  and click one to add it. The list holds up to 100 items.
- **Check a monster**: type a monster's name to see its drops with the base
  rate, your own chance, and a ✓ on the ones your settings would pick up.

A drop is looted if any of the three says so. **Turn everything off** clears
all three.

## Presets

Five named slots at the top of the window. Type a name and press **Save** to
keep the current rarity, item types and item list; **Load** puts them back,
**Rename** changes only the name, **×** empties the slot. Presets are kept on
the character, so they survive logging out and follow it to another computer.
Loading runs the commands again, so it prints their chat lines too.

## Works where @autoloot is for GMs only

The window doesn't need the player to be allowed `@autoloot`, `@autoloottype`
or `@alootid`. Its server script runs them for the player, so a server that
keeps them for GMs can still offer autoloot through the window. The commands
print their usual confirmation in chat when the window changes something.

## What is kept

The server keeps the rarity and the item types on the character. The item list
is kept by this mod: it is saved when you change it and when you log out, and
put back when you log in. Putting it back runs `@alootid` once for each item, so
you'll see a line in chat for each one when you log in. A list you changed by
typing `@alootid` is saved too.

## Base rate or your chance?

rAthena compares the rarity setting with the monster's **base** drop rate: the
number in the database, before the server's drop rates and your bonuses
(Bubble Gum, cards, VIP). That's the stock behaviour, and the window says so
under the setting. A server with `autoloot_adjust: yes` in
`conf/battle/drops.conf` compares your real chance instead, and the window then
says that. **Check a monster** shows both numbers either way.

## Needs

The rAthena fork's `getautolootitems`, `setautolootitems` and `getmobdroprate`
script commands and its 100-item autoloot list, which come with the app version
in `mod.json`.

Not supported: a minimum rarity ("only loot common items") and a list of items
never to loot. rAthena's autoloot has neither.
