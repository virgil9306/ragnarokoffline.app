# Running a dedicated server, headless

`ragnarok-stack serve` is the whole app minus the window. It reads the settings
the app's Settings window wrote, links your client's GRFs, brings the microVM
and rAthena containers up, runs the asset server in the foreground, and tears
both down on Ctrl-C or `systemctl stop`. There is no Electron and nothing to
click.

## Set it up in the app, serve it from a checkout

On the machine the desktop app is installed on:

1. **Configure everything in the app**: pick your client in the setup window,
   then rates, era, client version, mods and Multiplayer → LAN in Settings, and
   press Apply. Quit the app and let it finish quitting.
2. **Serve the latest commit of this repository with those settings:**

   ```sh
   git clone https://github.com/<you>/ragnarokoffline.app.git   # once
   cd ragnarokoffline.app
   git pull && scripts/serve.sh
   ```

That is the whole workflow. `scripts/serve.sh` builds the checkout into
`payload/` the way a release is built, then runs `payload/bin/ragnarok-stack
serve`. That reads `settings.json` and `client.json` from the app's own data
folder, so there is nothing to copy, export or pass. The first build takes a
while: it builds the web client and two pinned Rust helpers, and downloads the
engine kit and the server images. After a `git pull` it rebuilds only what the
pull changed. `scripts/serve.sh --build-only` builds without starting.

To change a setting, open the app, change it, press Apply, and quit. Then
restart `serve.sh` (Ctrl-C, then run it again). The app and `serve` cannot run
at the same time: they share ports and the database disk, and `serve` refuses
to start while the app's asset server holds its port.

What it needs: git, curl, Node.js 22 and Rust (see CONTRIBUTING.md "What you
need"); an Apple silicon Mac, or x64 Linux with `/dev/kvm` (below). The server
images come from the project's `images` release, which is built from `main`.
If your checkout changes the server itself (`containers/`, `third-party/`, the
rAthena pin), build the images locally (CONTRIBUTING.md "Building the server
images"), or set `RAGNAROK_IMAGES_REPO=owner/repo` to a fork that publishes
its own.

Any flags after `serve.sh` go to `ragnarok-stack serve`:

```
ragnarok-stack serve [--config <client.json>] [--grf <data.grf>] [--rdata <rdata.grf>]
                      [--official <official_data.grf>] [--bgm <dir>]
                      [--era renewal|prerenewal] [--lan|--no-lan] [--ram MiB]
```

None of them is needed on the app's machine. Each one changes the same saved
setting the app changes, so the app shows it next time it opens.

## One configuration, shared with the app

The app and `serve` keep their configuration in the same two files, in the
app's data folder:

| File | What is in it | Who writes it |
|---|---|---|
| `<data root>/state/settings.json` | Everything in the Settings window: EXP and drop rates, monster count, caps, view distance, the population engine, era, client version, game text, hosting scope, registration | the app's Settings window, `ragnarok-stack settings set`, and `serve --era/--lan` |
| `<data root>/client.json` | This machine: where the GRFs and BGM folder are, the VM's memory | the app's setup window, and `serve --grf/--rdata/--official/--bgm/--ram` |

The data root is:

| Platform | Data root |
|---|---|
| Linux | `~/.local/share/Ragnarok Offline` (or `$XDG_DATA_HOME/Ragnarok Offline`) |
| macOS | `~/Library/Application Support/Ragnarok Offline` |
| Windows | `%APPDATA%\Ragnarok Offline` |
| any | `$RAGNAROK_OFFLINE_HOME`, when it is set |

`ragnarok-stack settings path` prints both paths for the install you are on.

Both programs read these files every time they start a server, and both turn
`settings.json` into the same server config. So:

- **On one machine,** the app and `serve` are already sharing, as above.
- **On a box with no app,** there is no Settings window, so use the
  `settings` command instead (below), or edit `settings.json` in any text
  editor. To start from the settings you already have on your desktop, copy
  your `settings.json` across. `client.json` describes a single machine (its
  GRF paths), so let `serve --grf …` write that one rather than copying it.

The app turns `settings.json` into server config in JavaScript
(`electron/server-settings.js`). `serve` does it in Rust
(`stack/src/settings.rs`), and CI checks that the two produce byte-for-byte
the same config (`tests/server-settings-parity.test.cjs`). A server set up in
either place therefore runs the same.

### Changing settings from a terminal

```sh
ragnarok-stack settings                          # every setting, defaults filled in
ragnarok-stack settings get base_exp_rate
ragnarok-stack settings set base_exp_rate 500 job_exp_rate 500
ragnarok-stack settings set view_distance wide population_enable true
ragnarok-stack settings set prerenewal true      # the era
ragnarok-stack settings set hosting_scope lan    # same as serve --lan
ragnarok-stack settings path                     # where the files are
```

`set` checks each value before saving: the key must be a real setting, and the
value must be the right type (`500` for a rate, `true`/`false` for a switch,
text such as `wide` for a choice). It also refuses the same values the app
refuses, so whatever `set` writes, the app can still open. It writes the
generated config immediately, but a running server reads that config only at
startup. **Restart `serve` (or its systemd unit) for a change to take effect.**

The settings that matter on a server, with the app's defaults:

| Key | Default | Meaning |
|---|---|---|
| `base_exp_rate`, `job_exp_rate`, `quest_exp_rate` | `100` | 100 = 1x |
| `item_rate_common`, `item_rate_equip`, `item_rate_card` | `100` | drop rates, 100 = 1x, applied to normal monsters, bosses and MVPs |
| `mob_count_rate` | `100` | monsters per map, as a percentage (max 1000) |
| `zeny_from_mobs` | `false` | monsters drop zeny |
| `unlimited_arrows` | `false` | ammo is never used up |
| `max_aspd`, `max_parameter` | `190`, `99` | raise-only caps |
| `view_distance` | `official` | `official`, `wide` or `ultrawide` |
| `free_kafra_warp` | `true` | free Kafra teleports and storage |
| `prerenewal` | `false` | era: `true` is pre-renewal |
| `packetver` | `null` | client version, an 8-digit date from `config/PACKETVERS`; `null` is the default |
| `game_text` | `english` | `english`, `client_western`, `client_korean`, `client_taiwan` |
| `hosting_scope` | (unset) | `local` or `lan` (see below) |
| `open_registration` | `true` | new players can create accounts at the login screen |
| `instant_character_deletion` | `false` | deletion takes effect immediately instead of a day later |
| `population_enable`, `population_max`, `population_density`, `population_town_pct`, `population_field_pct`, `population_dungeon_pct`, `population_companion_*` | see `settings defaults` | the population engine |

`ragnarok-stack settings defaults` lists every key, including the ones only the
app's window uses.

## What each `serve` flag does

| Flag | Meaning |
|---|---|
| `--config <file>` | A JSON file in the same shape as `client.json` (see below). Read once, merged in, and never referenced again. |
| `--grf`, `--rdata`, `--official` | Your client's `data.grf`, `rdata.grf` and `official_data.grf`. Only `data.grf` is required, and only the first time. Each must exist, or `serve` refuses to start and saves nothing. |
| `--bgm` | The client's `BGM/` folder, if you want music served. |
| `--era renewal\|prerenewal` | Also accepts `pre-renewal`. Saved as `prerenewal` in `settings.json`, exactly as the app's era switch saves it. Omit it and the saved era is kept. |
| `--lan`, `--no-lan` | `--lan` listens on every interface instead of loopback only, and tells rAthena to advertise this machine's LAN address instead of `127.0.0.1`. **Required for any other machine to connect**: without it the server is reachable only from `localhost` on the box it runs on, which is exactly right behind an SSH tunnel or a reverse proxy on that same host. Saved as `hosting_scope` (`lan` or `local`) in `settings.json`, the same setting the app's Multiplayer switch writes. |
| `--ram MiB` | The microVM's memory ceiling, saved in `client.json`. With no saved value, `serve` picks what the app picks: a quarter of the machine's memory, between 2048 and 4096. |

For `client.json` keys the precedence is **flag > `--config` file > what is
already in `client.json`**. `era` can also be a key in the `--config` file, at
the same precedence. It is saved to `settings.json`, never to `client.json`.

A `--config` file looks like `client.json` itself:

```json
{
  "data_grf": "/srv/ragnarok-client/data.grf",
  "rdata_grf": "/srv/ragnarok-client/rdata.grf",
  "bgm_dir": "/srv/ragnarok-client/BGM",
  "era": "renewal",
  "vm_ram_mib": 3072
}
```

The ports can be moved, as for any copy of the app, with
`RAGNAROK_OFFLINE_{ASSET,LOGIN,CHAR,MAP}_PORT` (see
[AGENT_TESTING.md](AGENT_TESTING.md#running-beside-the-app)). `serve` follows
them, including the address it prints.

## Linux without a checkout: the AppImage

For a Linux box where you would rather not build anything, the release
AppImage carries a ready-built supervisor. Settings then come from
`ragnarok-stack settings set` or a copied `settings.json` (above), since there
is no app on the box.

1. **`/dev/kvm` and the `kvm` group.** The microVM needs KVM. Confirm it
   exists and check who can open it:

   ```sh
   ls -l /dev/kvm
   ```

   If your account is not in the group that owns it (usually `kvm`), add it
   and start a new login session. Group membership does not apply
   retroactively to a shell that is already running:

   ```sh
   sudo usermod -aG kvm "$USER"
   ```

2. **Extract the AppImage.** The Linux release is an AppImage. A headless box
   does not need to mount and run it as one; it only needs what is inside:

   ```sh
   chmod +x "Ragnarok Offline-*.AppImage"
   ./Ragnarok*.AppImage --appimage-extract
   ```

   This leaves `squashfs-root/`, with the supervisor and its runtime tree at
   `squashfs-root/resources/payload/`. However you run it, that runtime keeps
   its state in the data root above, the same place the app would use, so
   `status`, `sql`, `backup` and `settings` from a terminal all see the server
   `serve` started.

3. **The runtime tree must be writable.** The first `serve` unpacks the
   translation textures in place (`vendor/ROenglishRE/Translation/*/data.tar`)
   and deletes each tar once it succeeds. The desktop app does the same at
   install; `serve` does it on first start instead. If `squashfs-root/` is on a
   read-only mount, copy it somewhere writable first.

4. **Run it:**

   ```sh
   squashfs-root/resources/payload/bin/ragnarok-stack serve \
     --grf /srv/ragnarok-client/data.grf \
     --rdata /srv/ragnarok-client/rdata.grf \
     --lan
   ```

   `Serving at http://<address>:3338/` means it is up. Smoke-test it from
   another machine (or `curl` on the box itself if you have not opened
   `--lan` yet):

   ```sh
   curl http://<ip>:3338/
   ```

5. **Stop it** with Ctrl-C, or `SIGTERM` from a service manager. Either way it
   prints `Stopping...` and runs the same `down` a normal shutdown does,
   stopping the login, char and map containers and the microVM cleanly before
   the process exits. If the asset server itself dies (it crashes, or is
   killed out from under `serve`), `serve` notices, tears the stack down the
   same way, and exits non-zero instead of leaving containers running
   unattended.

## Joining it

From the app on any platform: Settings → Mode → **Join a friend**, and give it
`http://<ip>:3338/`. From a plain browser, the same address opens the game
directly. It is the same static site the desktop app's own window loads, per
[FRIENDS_SHARING.md](FRIENDS_SHARING.md) and the "Joining from a browser"
section of the [README](../README.md#joining-from-a-browser-with-nothing-installed).

## A systemd unit

```ini
[Unit]
Description=Ragnarok Offline (headless)
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=ragnarok
Environment=HOME=/home/ragnarok
ExecStart=/opt/ragnarok/squashfs-root/resources/payload/bin/ragnarok-stack serve
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=300
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

With the checkout workflow, point `ExecStart` at the script instead, and run
the unit as **your own desktop account** (`User=` and `HOME=`), because the
data folder, and so the settings the app wrote, belongs to that account:

```ini
ExecStart=/home/you/ragnarokoffline.app/scripts/serve.sh
```

The script rebuilds before it serves when the checkout changed, so a restart
after a `git pull` can take minutes. Run `scripts/serve.sh --build-only` after
pulling, then restart the unit, to keep that out of the restart.

Notes on that file:

- `User=` must name an account in the `kvm` group (see above). The unit
  inherits none of your desktop session's group membership.
- `Environment=HOME=` decides the data root, and so which `settings.json` and
  `client.json` the unit uses: `~ragnarok/.local/share/Ragnarok Offline/`.
  Run your first `serve --grf … --lan` and any `settings set` **as that user**
  (`sudo -u ragnarok -H …`), or they land in your own home directory and the
  unit never sees them. Alternatively, set
  `Environment=RAGNAROK_OFFLINE_HOME=/srv/ragnarok` in the unit and export the
  same variable in your shell.
- `KillMode=mixed` is not optional. The default, `control-group`, sends
  `SIGTERM` to every process in the unit at once, including the nebula
  daemon `up` started, which is the VM. The VM can then die before `down`
  has stopped MariaDB, and a database killed that way can lose its redo log.
  `mixed` signals only `serve`, which runs `down` in order.
- `network-online.target`: with LAN hosting, `up` works out which address to
  advertise from the machine's route to the network, so that route has to
  exist.
- `TimeoutStopSec=300`: `down` stops three rAthena containers and the microVM
  in sequence, and on a slow disk, or the first shutdown after a crash, that
  is not always fast. systemd's default (90s) can fire before it finishes and
  send `SIGKILL`, which skips `serve`'s own teardown entirely.
- `Restart=on-failure` restarts the unit when the asset server exits on its
  own (`serve`'s non-zero exit), but not on a clean `systemctl stop`, which
  sends `SIGTERM` and gets exit code 0.
- No GRF paths, `--lan` or `--era` in `ExecStart`: they are saved in
  `client.json` and `settings.json` from the first run. Change them with
  `settings set` or another `serve --flag` run, then
  `systemctl restart ragnarok`.

## Known limitations

- **Friends and Public hosting are app-only.** They run through the app's
  Cloudflare tunnel (`electron/sharing/`). A headless server with
  `hosting_scope` set to `friends` or `public` serves loopback only. Use
  `--lan` plus your own reverse proxy or VPN to reach it from outside your
  network.
- **No remembered logins for LAN players.** The autologin mod's remembered
  logins are served by the app's own process (`electron/sharing/lan-remember.js`),
  so they are unavailable on a headless server. Players type their password.
- **One server at a time per data root.** The app and `serve` share a data
  root, which is the point, so do not run both at once. They would fight over
  the same ports and the same database disk.
