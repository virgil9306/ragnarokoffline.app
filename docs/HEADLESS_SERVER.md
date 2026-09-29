# Running a dedicated server, headless

`ragnarok-stack serve` is the whole app minus the window: it writes
`client.json`, brings the microVM and rAthena containers up, starts the asset
server in the foreground, and tears both down on Ctrl-C or `systemctl stop`.
There is no Electron here and nothing to click — it is the same supervisor
binary the desktop app already ships, run from a terminal, on a Linux box that
is never going to open a window.

```
ragnarok-stack serve [--config <client.json>] [--grf <data.grf>] [--rdata <rdata.grf>]
                      [--official <official_data.grf>] [--bgm <dir>]
                      [--era renewal|prerenewal] [--lan|--no-lan] [--ram MiB]
```

Everything is optional after the first successful run: `serve` writes what it
was given into `<data root>/client.json`, and a bare `serve` next time reuses
it. So a systemd unit's `ExecStart` can end up as just `ragnarok-stack serve
--lan` — the GRF paths, era and RAM ceiling were already decided the first
time.

## What each flag does

| Flag | Meaning |
|---|---|
| `--config <file>` | A JSON file in the same shape as `client.json` (see below). Read once, merged in, and never referenced again. |
| `--grf`, `--rdata`, `--official` | Your client's `data.grf`, `rdata.grf` and `official_data.grf`. Only `data.grf` is required, and only the first time — it must be reachable from every source (flag, `--config` file, or an existing `client.json`) or `serve` refuses to start and says so. |
| `--bgm` | The client's `BGM/` folder, if you want music served. |
| `--era renewal\|prerenewal` | Also accepts `pre-renewal`. Flips the marker `up` and `link-assets` already read; omit it and whatever the last run chose stays chosen. |
| `--lan`, `--no-lan` | `--lan` listens on every interface instead of loopback only, and tells rAthena to advertise this machine's LAN address instead of `127.0.0.1`. **Required for any other machine to connect** — without it the asset server is reachable only from `localhost` on the box it runs on (which is exactly right behind an SSH tunnel or a reverse proxy that terminates on that same host). Sticky like the rest, because it is the same `lan` key the app's Settings writes: `--no-lan` turns it back off. |
| `--ram MiB` | The microVM's memory ceiling. Sticky, like the rest: omit it on later runs and the value already in `client.json` is kept. |

Precedence for every one of these, per key, is **flag > `--config` file >
whatever is already in `client.json`.** `era` may also be set as a key in the
`--config` file, at the same precedence, but it is never written back into
`client.json` — it lives in a separate marker file, exactly as it does for the
desktop app's Settings toggle.

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

## Linux host setup

1. **`/dev/kvm` and the `kvm` group.** The microVM needs KVM. Confirm it
   exists and check who can open it:

   ```sh
   ls -l /dev/kvm
   ```

   If your account is not in the group that owns it (usually `kvm`), add it
   and start a new login session — group membership does not apply
   retroactively to a shell that is already running:

   ```sh
   sudo usermod -aG kvm "$USER"
   ```

2. **Extract the AppImage.** The release build for Linux is an AppImage; a
   headless box does not need to mount and run it as one, it only needs what
   is inside:

   ```sh
   chmod +x "Ragnarok Offline-*.AppImage"
   ./Ragnarok*.AppImage --appimage-extract
   ```

   This leaves `squashfs-root/`, and the supervisor and its runtime tree at
   `squashfs-root/resources/payload/`.

3. **The runtime tree must be writable.** The first `serve` unpacks the
   translation textures in place (`vendor/ROenglishRE/Translation/*/data.tar`)
   and deletes the tar once it succeeds — same as the desktop app's install
   step, just run lazily instead of ahead of time. If `squashfs-root/` is on a
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
   prints `Stopping...` and runs the same `down` a normal shutdown does —
   stopping the login/char/map containers and the microVM cleanly — before
   the process exits. If the asset server itself dies (crash, killed out from
   under `serve`), `serve` notices, tears the stack down the same way, and
   exits non-zero instead of leaving containers running unattended.

## Joining it

From the Mac (or any platform) app: Settings → Mode → **Join a friend**, and
give it `http://<ip>:3338/`. From a plain browser, the same address opens the
game directly — that is the same static site the desktop app's own window
loads, per [docs/FRIENDS_SHARING.md](FRIENDS_SHARING.md) and the "Joining from
a browser" section of the [README](../README.md#joining-from-a-browser-with-nothing-installed).

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
ExecStart=/opt/ragnarok/squashfs-root/resources/payload/bin/ragnarok-stack serve --lan
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=300
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Notes on that file:

- `User=` must name an account in the `kvm` group (see above) — the unit
  inherits none of your desktop session's group membership.
- `KillMode=mixed` is not optional. The default, `control-group`, sends
  `SIGTERM` to every process in the unit at once — including the nebula
  daemon `up` started, which is the VM. The VM can then die before `down`
  has stopped MariaDB, and a database killed that way can lose its redo log.
  `mixed` signals only `serve`, which runs `down` in order.
- `network-online.target`: with `--lan`, `up` works out which address to
  advertise from the machine's route to the network, so it has to exist.
- `TimeoutStopSec=300`: `down` stops three rAthena containers and the microVM
  in sequence, and on a slow disk or a first shutdown after a crash that is
  not always fast. systemd's default (90s) can fire before it finishes and
  send `SIGKILL`, which skips `serve`'s own teardown entirely.
- `Restart=on-failure` restarts the unit when the asset server exits on its
  own (`serve`'s non-zero exit), but not on a clean `systemctl stop`, which
  sends `SIGTERM` and gets exit code 0.
- The GRF paths are deliberately absent from `ExecStart`: the first manual
  `serve --grf ... --lan` run wrote them into `client.json`, and every run
  after that reuses it. Rerunning with different flags updates it in place.

## Known limitations

- **Rates and other `battle_conf.txt` settings are not touched.** The desktop
  app generates that file from Settings (`toBattleConf`, in `electron/`);
  `serve` leaves whatever is already there alone, and `up` writes an empty
  one (default rates) if none exists yet. Edit
  `<state>/conf/battle_conf.txt` by hand (`up` never overwrites an existing one) for anything else.
- **The app's own Settings window, if ever pointed at this install's state
  directory, will rewrite the era marker on Apply.** Two things editing the
  same marker is a bad idea; treat a headless install as headless.
- **No Cloudflare sharing.** That is Electron-only (`electron/`'s
  `sharing`/tunnel code); `--lan` plus your own reverse proxy or VPN is the
  headless equivalent for reaching it from outside your network.
