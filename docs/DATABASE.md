# Reading and repairing the database

Everything the server remembers — accounts, characters, what is in their bags,
their homunculi, their guilds — is rows in a MariaDB database called
`ragnarok`. Settings shows a little of it and changes less. This is the door to
the rest.

Almost nobody needs it. It is here for the two cases where nothing else works:
a character that has got into a state the game has no button for, and a
question about what the server actually stored, as opposed to what the client
is drawing.

```
ragnarok-stack sql [--write] [--file <path>] [<statement>]
```

Most repairs no longer need the command line: **Settings → Tools → Database**
shows the same database table by table. You can filter and sort it, edit cells, add and
delete rows, and save them together. It is read-only until you turn editing
on, and a save works the way `sql --write` does: a backup first, the game
stopped while the change is written, and everything undone if any part of it
fails. Underneath it is `ragnarok-stack db`; see [The Database tool](#the-database-tool).

For the things people most often open the database for -- what a character
looks like and carries, where it is, moving a stuck one, deleting one -- use
**Settings → Tools → Control panel** instead. Each of its changes is made the
way the game makes it; see [The Control panel](#the-control-panel).

## Where the command is

The supervisor binary ships inside the app and is the same one the app itself
runs. It is not on your `PATH`; give the full path, or alias it.

| Platform | Path |
|---|---|
| macOS | `~/Library/Application Support/Ragnarok Offline/runtime/bin/ragnarok-stack` |
| Linux | `~/.local/share/Ragnarok Offline/runtime/bin/ragnarok-stack` |
| Windows | `%APPDATA%\Ragnarok Offline\runtime\bin\ragnarok-stack.exe` |

A shortcut, so the rest of this page can say `rostack`:

```sh
# macOS
alias rostack="$HOME/Library/Application Support/Ragnarok Offline/runtime/bin/ragnarok-stack"

# Linux
alias rostack="$HOME/.local/share/Ragnarok Offline/runtime/bin/ragnarok-stack"
```

```powershell
# Windows, in PowerShell
Set-Alias rostack "$env:APPDATA\Ragnarok Offline\runtime\bin\ragnarok-stack.exe"
```

```
rostack status
```

It needs no arguments and no environment. It finds the engine, the database and
the app's state from its own location.

**The examples below are written for a POSIX shell**, where `` \` `` escapes the
backquotes that `char` needs. PowerShell uses the backquote as its own escape
character, so quote those statements with single quotes instead and nothing
needs escaping:

```powershell
rostack sql 'SELECT char_id, name, homun_id FROM `char`'
```

Heredocs are POSIX-only as well. On PowerShell, put a multi-statement script in
a file and pass `--file`.

**The server has to be running.** The database lives in a container, inside the
microVM, on a network that publishes no port to your machine, which is why
there is no host and port to connect a normal client to and why this command
exists at all. If the app is closed, the answer is "Start this era's server
first" — open the app and press play, or run `ragnarok-stack up`.

**Renewal and pre-renewal are two separate databases**, with separate
characters. The command always talks to the one that is running, and refuses if
the running database and the selected era disagree.

## Reading

A read runs against the live server and changes nothing. No flag needed:

```sh
rostack sql "SELECT char_id, name, base_level, class FROM \`char\`"
```

Statements arrive as an argument, on standard input, or in a file:

```sh
rostack sql <<'SQL'
SELECT COUNT(*) FROM login;
SELECT COUNT(*) FROM `char`;
SQL

rostack sql --file ~/look.sql
```

Rows come back as tab-separated values with a header row, on stdout. Everything
else — progress, errors — goes to stderr, so a pipe gets clean data. A failing
statement exits non-zero and prints what MariaDB said, including the line.

Anything that is not `SELECT`, `SHOW`, `DESCRIBE` or `EXPLAIN` is refused
without a `--write` flag. That is a guard against a mistyped `UPDATE`, not a
security boundary — the owner of the machine can already do anything.

## Writing

```sh
rostack sql --write "UPDATE \`char\` SET homun_id = 0 WHERE char_id = 150000"
```

`--write` does three things before your statements run, and they are the reason
to use it rather than reaching for the container yourself:

1. **It saves a backup**, into `state/backups/before-sql-<era>-<random>.sql`,
   and prints the path. `char` and `homunculus` are MyISAM tables with no
   transaction to roll back, so this is the undo.
2. **It stops the game servers**, and starts again afterwards whichever ones
   were running. This is the part that matters. rAthena holds characters,
   homunculi, pets and inventories in memory and writes them back on save, so
   an edit made underneath a running map server is overwritten within the
   minute — and nothing tells you. The `UPDATE` reports a row changed, the game
   goes on with the old value, and it looks like the database ignored you.
3. **It checks which era's database is mounted**, so an edit cannot land in the
   world you are not playing.

Anyone logged in is disconnected while this runs. On a single-player install
that is you, and you should be at the character select screen or out of the
game entirely.

Batch related changes into one invocation rather than one `--write` per
statement: each one is a full stop and start.

## Limits

A statement may be up to 16 KiB, a result up to 64 KiB, and a call has 30
seconds. Narrow a large read with `LIMIT` or fewer columns. These are the
bounds the rest of the app's database plumbing has always used; nothing here is
meant to be a reporting tool.

## The Database tool

Settings → Tools → Database is a window onto the same `ragnarok` database.

- **Browsing** never stops anything. Pick a table; page through it, sort by a
  column, filter (`name contains Agent`, `class = 4252`), or type a raw
  `WHERE` condition. The raw condition runs in a read-only transaction and
  has to be a single condition, so no `;` and no comments.
- **Editing** is off until you turn it on. Changes are staged and highlighted;
  *Review and save* lists every one (old → new), then saves them all at once.
  A table with no primary key (`loginlog`, `bonus_script`) can be read and
  not edited, because nothing says which row an edit means. A key column
  cannot be edited in place: add the new row and delete the old one.
- **Saving** checks first that every row is still there and still holds what
  you were shown. Then it takes a backup (`backups/before-db-browser-*.sql`),
  stops the game, applies the changes, and starts the game again. Most of
  rAthena's tables are MyISAM, which cannot roll back, so if any statement
  fails the tool loads that backup again. The error names the change that failed,
  and nothing was saved.
- **Deleting a row deletes that row and nothing else.** That matters most for
  `char`. The game's own delete (`char_delete` in `src/char/char.cpp`) also
  clears the character's `inventory`, `cart_inventory`, `skill`, `hotkey`,
  `memo`, `quest`, `achievement`, `char_reg_num`, `char_reg_str`, `friends`,
  `mail`, `sc_data`, `bonus_script` and pets, removes its homunculus and
  elemental, and leaves its party, guild and marriage. Deleting the `char` row
  here leaves all of that behind as orphans. Delete a character from the
  character select screen in the game, or with the
  [Control panel](#the-control-panel); the review step says so when a save
  deletes from `char`.

Its answers come back through a file in `backups/` (`db-browser-*.out`,
removed once read), not through `docker exec`'s output, which docker-slim cut
short past 8 KiB: 38 characters of `char` come to ~24 KiB, and that is what made it show
"The database answered in a form this tool does not read" over an empty grid.

The page never sends SQL for a write, only a list of changes.
`ragnarok-stack db` builds the statements, with every value hex-encoded:

```
ragnarok-stack db tables
ragnarok-stack db describe <table>
echo '{"table":"char","filters":[{"column":"name","op":"contains","value":"Agent"}]}' | ragnarok-stack db rows
echo '{"changes":[{"table":"char","key":{"char_id":"150000"},"set":{"zeny":"1000"}}]}' | ragnarok-stack db apply
```

Values in the JSON are strings, including numbers, because
`inventory.unique_id` does not fit in a JavaScript number.

Know what a column means before you change it. Editing a table's values does
not teach rAthena anything new. A variable in `mapreg` whose name has no
trailing `$` is a number, so the map server reads the text `hello` as 0, and it
deletes zero-valued variables when it next saves.

## The Control panel

Settings → Tools → Control panel lists every player account and its
characters, and shows one character the way the game draws it, with its job,
levels and experience, zeny, stats, guild, party, position, save point and
equipment. It can do three things, and each is written the way rAthena writes
it rather than as a row edit:

| Action | What it writes | Does the game stop? |
|---|---|---|
| **Move to save point** / **Move to…** | `char.last_map`, `last_x`, `last_y`, and `last_instanceid` = 0: the columns the char server writes for a position (`char_mmo_char_tosql`) | No |
| **Delete character** | rAthena's `char_delete` statements, in its order: divorce and wedding rings, adoption, pets and pet eggs, homunculus, elemental, mercenary, friends both ways, hotkeys, inventory, cart, memo points, variables, skills, mail, status changes, bonus scripts, quests, achievements, the `charlog` line, then the `char` row | Yes, for a few seconds, after a backup |
| **Create account** | Exactly what Settings → Accounts → Create writes: it is the same call (`ragnarok-stack accounts`) | Yes, briefly, as there |

**Why a move does not stop the game.** rAthena keeps a copy of a character
in the char server only while it is in the game. Choosing a character sets
`online` to 1 *before* loading it, so that tools reading the database know
the row is no longer the truth ("set char as online prior to loading its data
so 3rd party applications will realise the sql data is not reliable",
`chclif_parse_charselect` in `src/char/char_clif.cpp`). Logging out ends
with the map server's final save, after which `char_set_char_offline`
(`src/char/char.cpp`) drops the character from the char server's cache and
only then writes `online` = 0. A row that says `online` = 0 therefore has no
copy anywhere that could be saved over the change, and the next time the
character is chosen it is loaded from those columns. The update itself checks
`online` = 0, for the character and every other character on its account, in
the same statement, so a player who logs in at that moment keeps the old
position and the panel says nothing moved. A map the server does not have is
not an error: rAthena sends the character to a major city instead, and
coordinates off the map, or 0, 0, become a random spot on it.

**Deleting** refuses, before anything is stopped, a character that is in the
game (or whose account has another character in it), one in a guild or a
party -- `char_del_restriction` refuses those by default, and the game's own
party and guild leave steps need the servers -- one that leads a guild, and
a name typed that is not exactly the character's. It does not wait for the
game's deletion timer or ask for the account's birthday: those slow down a
player at the character select screen, and here the owner confirms by typing
the name. Then it saves a backup to `backups/before-control-panel-*.sql`,
stops the game, checks everything again, runs the statements in one script,
and starts the game. If any statement fails, the backup is loaded back and
nothing has changed. Tables `char_delete` does not touch, such as
`mail_attachments` and `storage`, are left as the game leaves them.

What the panel reads goes through the Database tool's read path: one
read-only transaction, every value hex-encoded, answered through a file in
`backups/`. It never reads `login.user_pass`. The server's own account and
the AI agents' accounts are not listed.

The sprite is drawn from the same files the game window asks the asset server
for, with roBrowser's own sprite-name tables: body, hair and clothes colours,
headgear and garment, standing and facing south. Weapons, shields, mounts and
carts are not drawn.

Underneath it is `ragnarok-stack cp`, one JSON request on stdin and one JSON
answer on stdout, errors included:

```
echo '{"action":"characters"}' | ragnarok-stack cp
echo '{"action":"character","char_id":"150000"}' | ragnarok-stack cp
echo '{"action":"reset-position","char_id":"150000","target":"save"}' | ragnarok-stack cp
echo '{"action":"reset-position","char_id":"150000","target":{"map":"prontera","x":156,"y":191}}' | ragnarok-stack cp
echo '{"action":"delete-character","char_id":"150000","name":"Bob"}' | ragnarok-stack cp
```

The two writes take the same operation lock as `sql --write`, and from the
app they wait in the same queue as every other server operation.

## What is in there

rAthena's schema, plus the tables noted as ours or our fork's below. The full definitions are
in `vendor/rathena/sql-files/main.sql`; these are the ones worth knowing.

| Table | Holds |
|---|---|
| `login` | accounts: `userid`, `user_pass`, `pass_flags`, `group_id` (99 is GM), `state` (0 normal, 5 banned). `user_pass` is a salted PBKDF2 hash (`$pbkdf2-sha256$...`), which Settings → Accounts writes directly. `pass_flags` records whether the password was weak (1) or the default `ragnarok` (2). A plain-text password you set yourself with `--write` still works. The login server hashes it at that account's next login, or when it next starts. It does not check on a timer. Server accounts (`sex` S) stay plain text |
| `char` | characters, and the pointers to everything attached to one: `homun_id`, `pet_id`, `party_id`, `guild_id` |
| `inventory`, `cart_inventory`, `storage`, `guild_storage` | items, by `char_id` or `account_id` |
| `homunculus`, `skill_homunculus` | homunculi and their skills, by `homun_id` |
| `pet`, `mercenary`, `elemental` | the other things that follow a character |
| `skill` | learned skills, by `char_id` |
| `quest`, `achievement`, `friends`, `hotkey`, `memo` | per-character odds and ends |
| `char_reg_num`, `char_reg_str`, `global_acc_reg_num`, `global_acc_reg_str` | script variables — where most NPC and quest state actually lives |
| `sc_data` | status changes saved across a logout |
| `guild`, `party`, `mail`, `vendings` | the social side |
| `picklog`, `npclog`, `atcommandlog`, `cashlog`, `loginlog` | rAthena's logs, from `sql-files/logs.sql`: every item gained or lost (with how: vending, trade, shop, script...), `logmes` lines, `@` commands. `zenylog` and `chatlog` exist but stay empty, because the stock config doesn't log them. A mod can read them; see [Knowing what players did](MODDING.md#knowing-what-players-did-rathenas-logs) |
| `cp_population_stats` | ours, not rAthena's: the population engine's live shell count |
| `login_tokens` | one-time login tokens for [Google/Apple sign-in](FRIENDS_SHARING.md#sign-in-with-google-or-apple): the SHA-256 only, the account, an expiry 60 seconds out, and whether it was used. From our rAthena fork; rows expire and are deleted as new ones are issued |
| `app_sign_in_identities` | ours: which game account a Google or Apple sign-in plays as, by the provider's id for the person and the email it verified |
| `app_remembered_logins` | ours: the [autologin](../mods/autologin) mod's remembered logins -- the SHA-256 of each credential, its account, and when it was made and last used. Each launch trades one for a `login_tokens` row. Deleting a row signs that browser or window out; rows unused for 30 days are deleted, and a password change or disabling the account in Settings → Accounts deletes all of that account's |

`char` is quoted in SQL — `` `char` `` — because it is also a type name.

## A homunculus that is not there

The worked example, because it is the one that brought this page into
existence. The symptom: the homunculus is invisible, autofeed has stopped
consuming food, and Call, Rest and Resurrect all fail with no message — and so
does feeding it a new Embryo, because the game is sure you already have one.

Start with what the character points at, and what is on the other end:

```sh
rostack sql "SELECT c.char_id, c.name, c.homun_id, h.homun_id AS row_found, h.name AS homun,
                    h.class, h.level, h.vaporize, h.hp, h.max_hp, h.hunger, h.intimacy
             FROM \`char\` c LEFT JOIN homunculus h ON h.homun_id = c.homun_id
             WHERE c.name = 'YourCharacter'"
```

`char.homun_id` is 0 when the character has no homunculus. Anything else is a
pointer into `homunculus`, and two columns there explain almost every case.

| What you see | What it is | The fix |
|---|---|---|
| `vaporize` 0, `hp` above 0 | out and active | nothing is wrong in the database; look at the client |
| `vaporize` 0, `hp` 0 | **dead** | Call refuses a homunculus that was never vaporized, and Resurrect needs the Alchemist skill and a Blue Gemstone, so a player without both is stuck |
| `vaporize` 1 | resting | normal; Call brings it back |
| `vaporize` 2 | **morphing** | the real dead end, below |
| `row_found` is `NULL` | the row is gone | the homunculus no longer exists; clear the pointer |

Revive a dead one and put it to rest, so Call works:

```sh
rostack sql --write "UPDATE homunculus SET hp = max_hp, sp = max_sp, vaporize = 1 WHERE homun_id = <row_found>"
```

State 2 is the Homunculus S mutation, half done. `morphembryo` in an NPC script
vaporizes the homunculus into that state and hands over a Strange Embryo;
`homunculus_mutate` takes the Strange Embryo back and undoes it. Lose the item
between the two and there is no way out: rAthena tests for state 2 by name in
`hom_call`, `hom_vaporize` and `hom_ressurect`
(`vendor/rathena/src/map/homunculus.cpp`) and refuses each one, while
`char.homun_id` stays set and blocks creating another. It takes an evolved
homunculus at level 99 to get into, so it is only possible for a character that
went through that quest.

```sh
rostack sql --write "UPDATE homunculus SET vaporize = 1 WHERE homun_id = <row_found>"
```

If `row_found` came back `NULL`, the character points at a homunculus that is
not in the table. Clear the pointer; the next Embryo makes a new one, and the
old homunculus is gone either way.

```sh
rostack sql --write "UPDATE \`char\` SET homun_id = 0 WHERE char_id = <char_id>"
```

`alive` is in the table and means nothing — the char server neither reads nor
writes it. `hp` is the column that decides whether a homunculus is dead.

While you are here, look at `state/crashes/`. An unexpected map-server exit is
preserved there, and a crash is one of the ways a homunculus and its character
stop agreeing about what happened.

Log in afterwards and check the change took. If it seems to have been
forgotten, the game was running when you made it — that is exactly what
`--write` is for, so make sure you passed it.

## Other things people ask for

Make an account a GM, or take it back. Settings → Accounts creates, disables
and re-passwords accounts but does not change groups, so this is the only way:

```sh
rostack sql "SELECT account_id, userid, group_id FROM login"
rostack sql --write "UPDATE login SET group_id = 99 WHERE userid = 'name'"
```

Find where a character is stranded, and move it:

```sh
rostack sql "SELECT name, last_map, last_x, last_y, online FROM \`char\`"
rostack sql --write "UPDATE \`char\` SET last_map = 'prontera', last_x = 156, last_y = 191 WHERE char_id = <id>"
```

See what a character is carrying:

```sh
rostack sql "SELECT i.nameid, i.amount, i.equip, i.refine
             FROM inventory i JOIN \`char\` c USING (char_id)
             WHERE c.name = 'YourCharacter'"
```

Characters left marked online by a crash. The char server clears these when it
starts, so reach for this only if one survives a restart:

```sh
rostack sql "SELECT name, online FROM \`char\` WHERE online <> 0"
rostack sql --write "UPDATE \`char\` SET online = 0"
```

Unban an account. `state` is 0 for a normal account and 5 for a banned one:

```sh
rostack sql --write "UPDATE login SET state = 0, unban_time = 0 WHERE userid = 'name'"
```

## Backups

`--write` saves one every time, into the app's own backup directory, which is
inside the state folder and is not cleaned up for you. Delete the ones you do
not want.

For a backup you keep, use Settings → **Save Data** → **Back up database…**,
which writes both eras' databases to one `.sql` (and **Restore database…**,
which asks which eras to put back), or:

```sh
rostack backup ~/Desktop/ragnarok.sql
rostack inspect ~/Desktop/ragnarok.sql                 # what it holds, as JSON; changes nothing
rostack restore ~/Desktop/ragnarok.sql                 # every era in it
rostack restore ~/Desktop/ragnarok.sql --eras renewal  # only that one
```

The file is each era's `mariadb-dump`, one after the other, each beginning with
its stamp (below). `restore` replaces each chosen era's whole database and
takes a pre-restore backup of it first, into `state/backups/`. An era whose
database this install has never created is refused: switch Game era to it and
start the server once. Both stop the game; `backup` starts it again afterwards
and `restore` leaves it stopped, so restart the server yourself once a restore
is done.

A `.sql` from 1.4.3 or before is one era's dump with no stamp. It restores into
the era that is set now, so switch Game era first if it was the other one.

Before stopping anything, `restore` checks that the file is a dump of a game
database (it has `char` and `login` tables), and refuses a "Back up
everything" archive, a zip or a rar with what to use instead. It prints each
step as it goes, and keeps them in `state/logs/restore-<time>.log`. If the
database refuses the dump, the error it gave (with the statement and line) is
in the message, together with the pre-restore backup to restore to undo it.
Backups write `state/logs/backup-<time>.log` the same way, and every backup and
restore is also appended to `state/logs/backup-restore.log`, which Settings →
Tools → **Log viewer** shows as *Backup & restore*.

Every backup records what made it, in a comment near the top:

```
-- Ragnarok Offline backup: app 1.4.4, era renewal, packetver 20221005, made 2026-10-02T19:46:28Z
```

`app` is the version, `era` whose database it is (each era's dump says its
own), `packetver` the client version the server ran, and `made` the time in
UTC. Restore prints it, and loads each dump into the era its stamp names: the
tables are the same in both, so a dump in the wrong era would load, and the
world would be wrong. A file with the same era twice is refused.

Restore also brings an older backup up to date before loading it, by
running every migration in `stack/src/dump_migrations.rs` newer than the
backup (a backup from before 1.4.4 has no stamp and gets them all; each one
checks the dump itself, so it is harmless where nothing needs changing). What
each did is printed and logged. Today there is one: a backup from before 1.4
has no sign-in tables, so the ones already there are cleared rather than left
pointing at the previous world's accounts; startup makes them again, empty,
and players sign in afresh. A release that changes what a backup must contain
adds its migration there; the module's comment says how.

That `.sql` is the two databases and nothing else. To keep or move a whole
world, settings and mods included, back up everything.

### Backing up everything

Settings → **Save Data** → **Back up everything…** (and **Restore
everything…**, which asks which parts to put back), or:

```sh
rostack backup --full ~/Desktop/my-world.tar.gz
rostack inspect --full ~/Desktop/my-world.tar.gz      # what it holds, as JSON; changes nothing
rostack restore --full ~/Desktop/my-world.tar.gz      # everything in it
rostack restore --full ~/Desktop/my-world.tar.gz --eras prerenewal --no-settings
```

`--eras` takes `renewal`, `prerenewal`, both separated by a comma, or `none`;
an era left out keeps its characters. `--no-settings` keeps the current
settings and mods folder. Asking for an era the backup does not have is
refused before anything stops.

One `.tar.gz` holds the whole world. Any archiver opens it:

| In the archive | What it is |
|---|---|
| `manifest.json` | always first; described below |
| `database/renewal.sql`, `database/prerenewal.sql` | a dump of each era's database that exists. The era that is not running is reached by starting the database on its volume for the length of the dump, then switching back |
| `settings/settings.json`, `settings/mod-settings.json` | everything Settings saves, and every mod's settings |
| `settings/prerenewal`, `settings/free_kafra_warp` | the era and Kafra markers, when they are set |
| `settings/conf/battle_conf.txt` | what `settings.json` means to the server, so a restore from the command line is consistent before the app rewrites it |
| `mods/…` | `state/mods`, byte for byte: every installed mod, and `disabled.txt` / `enabled.txt`, which hold what is switched on and off |
| `machine/client.json` | where this machine's GRFs and BGM are, its memory setting, host or join. Recorded so you can see what you had; a restore never applies it, because it describes a computer, not a world |

Mods are copied as plain folders. The backup does not read or depend on
`mod.json`, except to note each mod's version in the manifest.

**What is left out**, and listed in every manifest under `excluded`:

- Cloudflare sharing credentials, the friends invitation and the sharing
  helpers (the app's `sharing` folder): secrets, and tied to this install.
- The database's internal service passwords
  (`state/private/service-credentials`): secrets. A restore keeps the
  restoring install's own, and resets the restored server login to them.
- The AI agent's access token (`state/agent`).
- The address of a host you join, which can carry a friends invitation.
- Your game client's GRFs: they are never copied.
- Logs, crash reports, earlier backups, generated assets and the server's
  generated configuration, which are rebuilt on every start.

Only the paths in the table are ever read, so a secret added somewhere else in
a later version is left out without anyone remembering to exclude it.

**The archive is private.** The database dumps contain every account's
password, exactly as the database holds them. Keep the file where you would
keep the database itself.

#### The manifest

```json
{
  "format": "ragnarok-offline-archive",
  "format_version": 1,
  "kind": "backup",
  "created": "2026-10-01T12:00:00Z",
  "app_version": "1.3.5",
  "rathena": "c3231aa87c39984c629ad093d7acb8465e80e926",
  "era": "renewal",
  "packetver": "20221005",
  "databases": [{ "era": "renewal", "path": "database/renewal.sql" }],
  "mods": [{ "name": "cursor", "source": "installed", "state": "on", "version": "1.0.0",
             "sha256": "…", "files": 12, "bytes": 40960 }],
  "excluded": ["…"],
  "files": [{ "path": "database/renewal.sql", "size": 1048576, "sha256": "…" }]
}
```

`rathena` is the server commit this app was built from (`config/VENDOR_PINS`),
so a later version can tell which schema upgrades a dump needs. A mod's
`sha256` is over its files' checksums and paths, so two archives show whether a
mod changed between them. `kind` is `backup` here; the shareable, scrubbed world
archive planned for hand-offs will use the same manifest as `world`.

#### Restoring

`restore --full` does these in order, and stops at the first that fails:

1. **Checks the whole archive** before touching anything: that it is one of
   ours, that it was not made by a newer app (it says which version to install
   if it was), and every file against its checksum. A damaged download, an
   edited file, or a file the manifest does not list is refused here.
2. **Stops the game servers.** The server has to be running, as for any
   backup: the database is only reachable then.
3. **Saves everything as it is now**, in the same format, to
   `state/world-backups/before-restore-everything-<date>.tar.gz`, and prints the
   path. If that fails, nothing is restored. Restoring that file is the way
   back.
4. **Restores each era's database** into its own volume, including the era
   that is not running, and resets the server login in each to this install's.
   An era the archive does not have is left as it was, and the output says so.
5. **Restores the settings and swaps in the mods folder** whole: mods
   installed here but not in the backup are gone (they are in step 3's file).
6. From the command line, the game is left stopped. From Settings, the app
   then starts the server and rebuilds the client's assets with the restored
   mods, as Apply does.

GRF locations are not restored, so the restoring machine keeps its own client.

## For an agent working on someone's install

Everything above, condensed:

- The binary is at the path in the table above, takes no environment, and needs
  the server running. `ragnarok-stack status` says whether it is.
- `sql` reads. `sql --write` writes, and stopping the game around the write is
  not optional — a write against a running map server is silently lost.
- Output is TSV with a header on stdout; errors are on stderr with a non-zero
  exit. Results are capped at 64 KiB, so page with `LIMIT`.
- `vendor/rathena/sql-files/main.sql` is the schema. `vendor/rathena/src/map/`
  is the code that decides what a value means — read that before inferring a
  rule from a column name.
- Take a copy of anything before changing it, and check the change survived a
  login before saying it worked.
- `backup --full <file>` / `restore --full <file>` move a whole world: both
  eras, settings, installed mods. Restore checks the archive first, saves the
  current world to `state/world-backups/before-restore-everything-*.tar.gz`, and
  prints that path. Tell the player where it is.
