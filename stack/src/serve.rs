//! `ragnarok-stack serve`: a headless front door for a Linux host with no
//! Electron and no window.
//!
//! Electron's `start_stack` (electron/main.js:2200-2228) does five things
//! before a player ever sees a boot page: write `client.json`, flip the era
//! marker, unpack the translation textures, link the client's GRFs into the
//! served root, bring the VM and containers up, and only then start the asset
//! server -- which it then owns and watches with a private handshake
//! (`--managed`, electron/asset-server.js). A systemd unit has none of that:
//! no window to hold settings, no process to supervise the child for it. So
//! `serve` does the same five things itself, in the same order, spawns the
//! asset server unmanaged (matching scripts/cowork-dev.cjs, the existing
//! non-Electron precedent), and holds the foreground until a signal -- or the
//! asset server exiting on its own -- says to run `down` and stop.
//!
//! Kept deliberately free of anything Docker- or filesystem-shaped where it
//! can be: arg parsing, precedence, the `client.json` merge, the link-assets
//! positional vector, the proxy targets and the tar reader are all plain
//! functions over plain inputs, so they are tested without a `Config` or a
//! spawned process.

use crate::config::{self, Config};
use crate::docker::Docker;
use crate::json::{self, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Set by the signal handler (unix) and polled by the run loop. Never reset:
/// once a shutdown is requested there is exactly one way this process ends.
static SHUTDOWN: AtomicBool = AtomicBool::new(false);

#[derive(Default, Debug, PartialEq)]
struct Args {
    config: Option<PathBuf>,
    grf: Option<String>,
    rdata: Option<String>,
    official: Option<String>,
    bgm: Option<String>,
    era: Option<String>,
    /// `Some` only when a flag said so: `--lan` or `--no-lan`. Absent, the
    /// config file or the saved `client.json` decides, like every other key.
    lan: Option<bool>,
    ram: Option<u32>,
}

/// Parse `serve`'s own flags. Unlike `main.rs`'s generic `--lan`/`--ram` scan
/// (which just looks for them anywhere and ignores everything else), this
/// rejects a flag it does not recognise and a flag missing its value: a typo
/// in a systemd `ExecStart` line should fail loudly, not silently start the
/// server with the default GRF-less config.
fn parse_args(args: &[String]) -> Result<Args, String> {
    let mut out = Args::default();
    let mut i = 0;
    while i < args.len() {
        let flag = args[i].as_str();
        let mut value = || -> Result<String, String> {
            i += 1;
            args.get(i).cloned().ok_or_else(|| format!("{flag} needs a value"))
        };
        match flag {
            "--config" => out.config = Some(PathBuf::from(value()?)),
            "--grf" => out.grf = Some(value()?),
            "--rdata" => out.rdata = Some(value()?),
            "--official" => out.official = Some(value()?),
            "--bgm" => out.bgm = Some(value()?),
            "--era" => out.era = Some(value()?),
            "--lan" => out.lan = Some(true),
            "--no-lan" => out.lan = Some(false),
            "--ram" => {
                let raw = value()?;
                out.ram = Some(
                    raw.parse::<u32>()
                        .map_err(|_| format!("--ram needs a number of MiB, got {raw:?}"))?,
                );
            }
            other => return Err(format!("unknown flag {other}")),
        }
        i += 1;
    }
    Ok(out)
}

/// `renewal` / `prerenewal` / `pre-renewal` -> whether the marker should be
/// present. Anything else is named back to the caller rather than guessed at.
fn normalize_era(raw: &str) -> Result<bool, String> {
    match raw {
        "renewal" => Ok(false),
        "prerenewal" | "pre-renewal" => Ok(true),
        other => Err(format!(
            "--era must be renewal, prerenewal or pre-renewal, got {other:?}"
        )),
    }
}

/// `--era` beats an `"era"` key in the `--config` file; neither is required,
/// and when both are absent the marker is left exactly as it was (a bare
/// `serve` re-run must not silently flip a running install back to renewal).
fn resolve_era(flag: Option<&str>, config_file_era: Option<&str>) -> Result<Option<bool>, String> {
    if let Some(f) = flag {
        return normalize_era(f).map(Some);
    }
    if let Some(c) = config_file_era {
        return normalize_era(c).map(Some);
    }
    Ok(None)
}

fn apply_era_marker(state: &Path, is_prerenewal: Option<bool>) -> Result<(), String> {
    let Some(pre) = is_prerenewal else { return Ok(()) };
    fs::create_dir_all(state).map_err(|e| format!("creating {}: {e}", state.display()))?;
    let marker = state.join("prerenewal");
    if pre {
        fs::write(&marker, "").map_err(|e| format!("writing {}: {e}", marker.display()))
    } else {
        match fs::remove_file(&marker) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("removing {}: {e}", marker.display())),
        }
    }
}

/// `client.json` as it exists already (the common case: nothing there yet
/// means nothing has been chosen, not an error).
fn load_client_json(path: &Path) -> Result<Value, String> {
    match fs::read_to_string(path) {
        Ok(body) => {
            let v = json::parse(&body).map_err(|e| format!("{}: {e}", path.display()))?;
            require_object(v, &format!("{}", path.display()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(BTreeMap::new())),
        Err(e) => Err(format!("reading {}: {e}", path.display())),
    }
}

/// A `--config` file, unlike the existing `client.json`, was named explicitly:
/// if it is not there, that is a typo worth stopping for rather than a fresh
/// install worth defaulting past.
fn load_config_file(path: &Path) -> Result<Value, String> {
    let body = fs::read_to_string(path)
        .map_err(|e| format!("reading --config file {}: {e}", path.display()))?;
    let v = json::parse(&body).map_err(|e| format!("--config file {}: {e}", path.display()))?;
    require_object(v, &format!("--config file {}", path.display()))
}

fn require_object(v: Value, context: &str) -> Result<Value, String> {
    if v.is_object() {
        Ok(v)
    } else {
        Err(format!("{context} must be a JSON object"))
    }
}

/// Merge order is flag > `--config` file > existing `client.json`, applied in
/// that order so each later step's `insert` simply wins. Unknown keys already
/// in `client.json` (anything Settings wrote that `serve` does not know
/// about) survive because they are never removed, only overwritten.
///
/// `era` is deliberately not copied from the config file into the merged
/// object: it belongs to the marker file (`apply_era_marker`), not to
/// `client.json`'s schema, which `getClientPaths()` in main.js also does not
/// carry it in.
fn merge_client(existing: Value, config_file: Option<Value>, args: &Args) -> Value {
    let mut map = match existing {
        Value::Object(m) => m,
        _ => BTreeMap::new(),
    };
    if let Some(Value::Object(cf)) = config_file {
        for (k, v) in cf {
            if k == "era" {
                continue;
            }
            map.insert(k, v);
        }
    }
    map.insert("mode".to_string(), Value::String("host".to_string()));
    if let Some(lan) = args.lan {
        map.insert("lan".to_string(), Value::Bool(lan));
    }
    if let Some(v) = &args.grf {
        map.insert("data_grf".to_string(), Value::String(v.clone()));
    }
    if let Some(v) = &args.rdata {
        map.insert("rdata_grf".to_string(), Value::String(v.clone()));
    }
    if let Some(v) = &args.official {
        map.insert("official_grf".to_string(), Value::String(v.clone()));
    }
    if let Some(v) = &args.bgm {
        map.insert("bgm_dir".to_string(), Value::String(v.clone()));
    }
    if let Some(v) = args.ram {
        map.insert("vm_ram_mib".to_string(), Value::Number(v as f64));
    }
    Value::Object(map)
}

fn optional_str(v: &Value, key: &str) -> String {
    v.str(key).unwrap_or("").to_string()
}

/// What `up` is told, read back out of the merged `client.json` rather than
/// from the flags, so a saved `"lan": true` or `"vm_ram_mib"` means the same
/// thing to a bare `serve` as it does to the app's `withEngineFlags`
/// (main.js:497). A RAM value that is not a positive whole number is left to
/// config.toml, as the app does.
fn engine_flags(client: &Value) -> (bool, Option<u32>) {
    let lan = matches!(client.get("lan"), Some(Value::Bool(true)));
    let ram = match client.get("vm_ram_mib") {
        Some(Value::Number(n)) if *n >= 1.0 && n.fract() == 0.0 && *n <= u32::MAX as f64 => Some(*n as u32),
        _ => None,
    };
    (lan, ram)
}

/// The positional vector `assets::link` expects, exactly `main.js`:855's
/// shape: an empty string keeps rdata's slot so official and bgm still land
/// in theirs, and official is only pushed at all when something after it is.
fn link_positional(data_grf: &str, rdata_grf: &str, official_grf: &str, bgm_dir: &str) -> Vec<String> {
    let mut out = vec![data_grf.to_string(), rdata_grf.to_string()];
    if !official_grf.is_empty() || !bgm_dir.is_empty() {
        out.push(official_grf.to_string());
    }
    if !bgm_dir.is_empty() {
        out.push(bgm_dir.to_string());
    }
    out
}

fn bracket(host: &str) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    }
}

fn public_url(advertise: &str) -> String {
    format!("http://{}:3338", bracket(advertise))
}

/// Login always names the host-side proxy's loopback; rAthena hands a
/// connecting client its own char/map address, so those two follow `--lan`.
/// Mirrors `proxyTargets` (main.js:754) including the final sort -- the two
/// must agree on the wire, and roBrowser is handed this same list shape.
fn ws_allowed_targets(advertise: &str, lan: bool) -> String {
    let backend = if lan { advertise } else { "127.0.0.1" };
    let mut targets = vec![
        "127.0.0.1:6900".to_string(),
        format!("{backend}:6121"),
        format!("{backend}:5121"),
    ];
    targets.sort();
    targets.join(",")
}

/// The address other machines are told to come back to, straight from the
/// `endpoint.json` `up` just wrote (cmds.rs:1637) -- the same file
/// `advertiseHost()` reads in Electron, so a client is never told to go
/// somewhere the WS proxy's allow-list will refuse.
fn read_advertise_host(state: &Path) -> String {
    let path = state.join("endpoint.json");
    let Ok(body) = fs::read_to_string(&path) else {
        return "127.0.0.1".to_string();
    };
    match json::parse(&body) {
        Ok(v) => v.str("host").unwrap_or("127.0.0.1").to_string(),
        Err(_) => "127.0.0.1".to_string(),
    }
}

fn read_trimmed(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default().trim().to_string()
}

/// FNV-1a, the same algorithm `assets.rs` already uses for its own
/// fingerprints (`fnv`, assets.rs:366). The `RAGNAROK_*_ID` variables Electron
/// sends the asset server are opaque to it: reading the pinned RemoteClient
/// source (`config/REMOTECLIENT_PIN`) shows nothing in `Config::from_env`
/// (src/config.rs) or anywhere else reads a `RAGNAROK_` variable except the
/// literal string `RAGNAROK_ASSET_READY ` the managed protocol prints on
/// stdout -- itself unrelated. There is no reason to hand-roll sha256 to
/// match Electron's bytes when nothing ever compares them.
fn fnv_hex(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Vars the caller's own environment wins for, matching `assetsStart()`
/// (main.js:647-654): systemd's `Environment=` lines behave exactly like the
/// `.env`/shell overrides Electron already respects, rather than being a
/// second, competing source of the same setting.
const PASSTHROUGH_DEFAULTS: &[(&str, &str)] = &[
    ("ENABLE_COMPRESSION", "true"),
    ("CACHE_MAX_FILES", "5000"),
    ("CACHE_MAX_MEMORY_MB", "1024"),
    ("CACHE_WARM_UP", "false"),
    ("CACHE_WARM_UP_LIMIT", "500"),
    ("CLIENT_ENABLESEARCH", "true"),
    ("CLIENT_AUTOEXTRACT", "true"),
    ("GRF_FILENAME_ENCODING", "auto"),
];

/// Takes the lookup as a closure (rather than reading `std::env` itself) so
/// the precedence rule is testable without touching the process environment.
fn passthrough_env(lookup: &dyn Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    PASSTHROUGH_DEFAULTS
        .iter()
        .map(|(k, default)| ((*k).to_string(), lookup(k).unwrap_or_else(|| (*default).to_string())))
        .collect()
}

/// The full environment for the asset server child, matching `assetsStart()`
/// (main.js:617-662) key for key, minus `RAGNAROK_ASSET_SOURCES_ID` (see
/// `fnv_hex`'s doc comment -- it, like its siblings, is read by nothing) and
/// the managed-mode handshake, which `serve` does not use.
fn build_env(cfg: &Config, lan: bool, advertise: &str) -> Vec<(String, String)> {
    let state = &cfg.state;
    let mut env = vec![
        ("PORT".to_string(), "3338".to_string()),
        (
            "HOST".to_string(),
            if lan { "0.0.0.0".to_string() } else { "127.0.0.1".to_string() },
        ),
        ("CLIENT_PUBLIC_URL".to_string(), public_url(advertise)),
        ("NODE_ENV".to_string(), "production".to_string()),
        ("SERVER_ROOT".to_string(), state.join("assets").to_string_lossy().into_owned()),
        ("CLIENT_RESPATH".to_string(), "resources/".to_string()),
        (
            "CLIENT_DATAINI".to_string(),
            state.join("asset-config/DATA.INI").to_string_lossy().into_owned(),
        ),
        ("BGM_PATH".to_string(), read_trimmed(&state.join("asset-config/bgm.path"))),
        ("AI_PATH".to_string(), read_trimmed(&state.join("asset-config/ai.path"))),
        ("ENABLE_STATIC_SERVE".to_string(), "true".to_string()),
        ("ENABLE_WSPROXY".to_string(), "true".to_string()),
        (
            "ROBROWSER_PATH".to_string(),
            cfg.root.join("vendor/roBrowserLegacy/dist/Web").to_string_lossy().into_owned(),
        ),
        ("WS_ALLOWED_TARGETS".to_string(), ws_allowed_targets(advertise, lan)),
        (
            "DATA_OVERRIDE_PATH".to_string(),
            state.join("assets/.translation/data").to_string_lossy().into_owned(),
        ),
    ];
    env.extend(passthrough_env(&|k| std::env::var(k).ok()));
    env.push(("RAGNAROK_PAYLOAD_VERSION".to_string(), read_trimmed(&cfg.root.join("VERSION"))));
    env.push((
        "RAGNAROK_OVERLAY_ID".to_string(),
        read_trimmed(&state.join("assets/overlay.id")),
    ));
    env.push((
        "RAGNAROK_MANIFEST_ID".to_string(),
        fnv_hex(fs::read(state.join("asset-config/DATA.INI")).unwrap_or_default().as_slice()),
    ));
    env.push((
        "RAGNAROK_CLIENT_CONFIG_ID".to_string(),
        fnv_hex(fs::read(state.join("assets/Config.local.js")).unwrap_or_default().as_slice()),
    ));
    env
}

fn remoteclient_binary(cfg: &Config) -> Result<PathBuf, String> {
    let name = format!("robrowser-remoteclient{}", config::EXE);
    let bundled = cfg.root.join("bin").join(&name);
    if bundled.exists() {
        return Ok(bundled);
    }
    if let Some(dirs) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&dirs) {
            let candidate = dir.join(&name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    Err(format!(
        "{name} not found under {} or on PATH",
        cfg.root.join("bin").display()
    ))
}

fn div_ceil(n: usize, d: usize) -> usize {
    (n + d - 1) / d
}

/// A tar reader ported from `extractTarLatin1` (main.js:261-303), field for
/// field, decoding names as UTF-8 rather than Latin-1: the bytes this ever
/// reads were already UTF-8 on the filesystem the archive was built from (see
/// that function's own comment), and `serve` has no CP949 client tree to
/// round-trip against, only these packaged tars.
///
/// Deliberately permissive in the same way the original is: an unsupported
/// record type is skipped rather than refused, and a path that tries to climb
/// out of `dest` has its `.`/`..`/empty components dropped rather than the
/// whole archive rejected -- matching the JS reader exactly, including for
/// archives nobody has ever seen do this.
fn extract_tar(archive: &[u8], dest: &Path) -> Result<(), String> {
    const BLOCK: usize = 512;
    let mut off = 0usize;
    let mut long_name: Option<String> = None;

    let slice = |start: usize, len: usize| -> &[u8] {
        if start >= archive.len() {
            return &[];
        }
        &archive[start..(start + len).min(archive.len())]
    };
    let str_at = |start: usize, len: usize| -> String {
        let bytes = slice(start, len);
        let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).into_owned()
    };

    while off + BLOCK <= archive.len() {
        if archive[off] == 0 {
            break; // end-of-archive padding
        }
        let name = str_at(off, 100);
        let size_bytes = slice(off + 124, 12);
        let nul = size_bytes.iter().position(|&b| b == 0).unwrap_or(size_bytes.len());
        let size_str = String::from_utf8_lossy(&size_bytes[..nul]).trim().to_string();
        let size = usize::from_str_radix(&size_str, 8).unwrap_or(0);
        let type_byte = *archive.get(off + 156).unwrap_or(&0) as char;
        let prefix = str_at(off + 345, 155);
        off += BLOCK;

        // GNU long name: the following record's data is the real name.
        if type_byte == 'L' {
            long_name = Some(
                String::from_utf8_lossy(slice(off, size))
                    .trim_end_matches('\0')
                    .to_string(),
            );
            off += div_ceil(size, BLOCK) * BLOCK;
            continue;
        }

        let full = long_name
            .take()
            .unwrap_or_else(|| if prefix.is_empty() { name } else { format!("{prefix}/{name}") });

        // Never let an archive write outside its destination.
        let parts: Vec<&str> = full
            .split('/')
            .filter(|p| !p.is_empty() && *p != "." && *p != "..")
            .collect();
        let target = parts.iter().fold(dest.to_path_buf(), |acc, p| acc.join(p));

        if type_byte == '5' || full.ends_with('/') {
            fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else if type_byte == '0' || type_byte == '\0' {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&target, slice(off, size)).map_err(|e| e.to_string())?;
        }
        off += div_ceil(size, BLOCK) * BLOCK;
    }
    Ok(())
}

/// `unpackTranslationData` (main.js:218-236), for one era. Electron runs this
/// once, when a payload is installed; a headless run has no install step, so
/// `serve` runs it itself, every time, and the "already unpacked" case (the
/// common one, after the first run) is just an absent tar.
fn unpack_translation_tar(cfg: &Config, era: &str) -> Result<(), String> {
    let dir = cfg.root.join("vendor/ROenglishRE/Translation").join(era);
    let archive = dir.join("data.tar");
    if !archive.exists() {
        return Ok(()); // already unpacked, or an older payload
    }
    let writable_hint = "the runtime tree must be writable";
    let bytes = fs::read(&archive)
        .map_err(|e| format!("reading {}: {e} ({writable_hint})", archive.display()))?;
    extract_tar(&bytes, &dir)
        .map_err(|e| format!("unpacking {}: {e} ({writable_hint})", archive.display()))?;
    fs::remove_file(&archive)
        .map_err(|e| format!("removing {}: {e} ({writable_hint})", archive.display()))?;
    Ok(())
}

#[cfg(unix)]
mod signals {
    use super::SHUTDOWN;
    use std::sync::atomic::Ordering;

    // libc is already linked (nebula and docker-slim need it); this is the
    // one function of it stack/ uses, so it is declared rather than pulling
    // in a crate for a single FFI call. Precedent: private_fs.rs's own
    // `unsafe extern "C" { fn geteuid() -> u32; }`.
    unsafe extern "C" {
        fn signal(signum: i32, handler: usize) -> usize;
    }
    const SIGINT: i32 = 2;
    const SIGTERM: i32 = 15;

    extern "C" fn on_signal(_: i32) {
        SHUTDOWN.store(true, Ordering::SeqCst);
    }

    pub fn install() {
        let handler = on_signal as *const () as usize;
        unsafe {
            signal(SIGINT, handler);
            signal(SIGTERM, handler);
        }
    }
}

#[cfg(not(unix))]
mod signals {
    /// No console-control-event FFI here (yet): with no crates allowed, that
    /// is a larger surface for a platform this ships to but is not the first
    /// target for `serve`. Ctrl-C aside, the asset server exiting on its own
    /// still ends the loop and runs `down`, so the subcommand itself is not
    /// `#[cfg]`-gated on Windows -- only its idea of what a signal is.
    pub fn install() {}
}

pub fn run(cfg: &Config, dk: &Docker, args: &[String]) -> Result<(), String> {
    let parsed = parse_args(args)?;
    // First, so a Ctrl-C or `systemctl stop` during the long `up` is a request
    // to stop rather than the end of this process: without a handler the
    // default action kills `serve` mid-boot and leaves a half-started VM with
    // nobody left to take it down.
    signals::install();

    let client_json_path = config::data_root().join("client.json");
    let existing = load_client_json(&client_json_path)?;
    let config_file = match &parsed.config {
        Some(p) => Some(load_config_file(p)?),
        None => None,
    };
    let config_file_era = config_file.as_ref().and_then(|v| v.str("era")).map(str::to_string);
    let is_prerenewal = resolve_era(parsed.era.as_deref(), config_file_era.as_deref())?;

    let client = merge_client(existing, config_file, &parsed);
    let data_grf = client.str("data_grf").filter(|s| !s.is_empty()).map(str::to_string).ok_or_else(|| {
        format!(
            "data_grf is required: pass --grf <data.grf>, or put \"data_grf\" in --config or in {}",
            client_json_path.display()
        )
    })?;
    let (lan, ram) = engine_flags(&client);
    let rdata_grf = optional_str(&client, "rdata_grf");
    let official_grf = optional_str(&client, "official_grf");
    let bgm_dir = optional_str(&client, "bgm_dir");

    fs::create_dir_all(config::data_root())
        .map_err(|e| format!("creating {}: {e}", config::data_root().display()))?;
    fs::write(&client_json_path, json::to_string_pretty(&client))
        .map_err(|e| format!("writing {}: {e}", client_json_path.display()))?;

    apply_era_marker(&cfg.state, is_prerenewal)?;

    for era in ["Renewal", "Pre-Renewal"] {
        unpack_translation_tar(cfg, era)?;
    }

    let positional = link_positional(&data_grf, &rdata_grf, &official_grf, &bgm_dir);
    crate::assets::link(cfg, &positional)?;

    // The lock is held only around `up`, not for `serve`'s whole lifetime:
    // `sql`, `backup` and `status` from another terminal must still be able
    // to queue behind it and run while the asset server is in the foreground.
    let started = {
        let _lock = crate::operation_lock::acquire(&cfg.state)?;
        crate::cmds::up(cfg, dk, lan, ram)
    };

    // A stop asked for during `up` is honoured once it returns, whether it
    // finished or not: in a terminal Ctrl-C reaches `up`'s own docker and
    // nebula children too, so a failure here is often just the interruption.
    // Either way, take down whatever did come up.
    if SHUTDOWN.load(Ordering::SeqCst) {
        println!("Stopping (asked to stop while the server was starting)...");
        let _lock = crate::operation_lock::acquire(&cfg.state)?;
        return crate::cmds::down(cfg, dk);
    }
    started?;

    let advertise = read_advertise_host(&cfg.state);
    let binary = remoteclient_binary(cfg)?;
    let env = build_env(cfg, lan, &advertise);

    if !lan {
        println!(
            "Loopback only (no --lan): reachable at http://127.0.0.1:3338/ on this machine, \
             or through an SSH tunnel / reverse proxy. Pass --lan for other machines to connect directly."
        );
    }
    println!("Serving at {}/", public_url(&advertise));

    let mut child = Command::new(&binary)
        .current_dir(&cfg.root)
        .envs(env)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("starting {}: {e}", binary.display()))?;

    let died_on_its_own = loop {
        if SHUTDOWN.load(Ordering::SeqCst) {
            break false;
        }
        match child.try_wait() {
            Ok(Some(_status)) => break true,
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(_) => break true, // cannot observe it any further; treat as gone
        }
    };

    if !died_on_its_own {
        let _ = child.kill(); // a signal: stop it quietly before tearing the stack down
    }
    let status = child.wait();
    // Ctrl-C in a terminal goes to the whole foreground process group, so the
    // asset server can exit from the same keypress a moment before the flag
    // is seen. That is a requested stop, not a crash, and must not exit
    // non-zero -- or systemd's Restart=on-failure would read it as one.
    let died_on_its_own = died_on_its_own && !SHUTDOWN.load(Ordering::SeqCst);

    println!("Stopping...");
    {
        // A second Ctrl-C landing here does not need special handling: the
        // flag is already set, `down` is not re-entered, and there is nothing
        // left to check it against.
        let _lock = crate::operation_lock::acquire(&cfg.state)?;
        crate::cmds::down(cfg, dk)?;
    }

    if died_on_its_own {
        let detail = match status {
            Ok(s) => format!("exit status {s}"),
            Err(e) => e.to_string(),
        };
        Err(format!("the asset server exited on its own ({detail})"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(pairs: &[(&str, Value)]) -> Value {
        let mut m = BTreeMap::new();
        for (k, v) in pairs {
            m.insert(k.to_string(), v.clone());
        }
        Value::Object(m)
    }

    // --- arg parsing ---------------------------------------------------

    #[test]
    fn every_flag_is_recognised() {
        let a = parse_args(&[
            "--config".into(), "cfg.json".into(),
            "--grf".into(), "data.grf".into(),
            "--rdata".into(), "rdata.grf".into(),
            "--official".into(), "official.grf".into(),
            "--bgm".into(), "BGM".into(),
            "--era".into(), "pre-renewal".into(),
            "--lan".into(),
            "--ram".into(), "3072".into(),
        ]).unwrap();
        assert_eq!(a.config, Some(PathBuf::from("cfg.json")));
        assert_eq!(a.grf.as_deref(), Some("data.grf"));
        assert_eq!(a.rdata.as_deref(), Some("rdata.grf"));
        assert_eq!(a.official.as_deref(), Some("official.grf"));
        assert_eq!(a.bgm.as_deref(), Some("BGM"));
        assert_eq!(a.era.as_deref(), Some("pre-renewal"));
        assert_eq!(a.lan, Some(true));
        assert_eq!(a.ram, Some(3072));
        assert_eq!(parse_args(&["--no-lan".into()]).unwrap().lan, Some(false));
        assert_eq!(parse_args(&[]).unwrap().lan, None);
    }

    #[test]
    fn unknown_flags_are_rejected() {
        assert!(parse_args(&["--nonsense".into()]).unwrap_err().contains("unknown flag"));
    }

    #[test]
    fn a_flag_missing_its_value_is_rejected() {
        let e = parse_args(&["--grf".into()]).unwrap_err();
        assert!(e.contains("--grf"), "{e}");
    }

    #[test]
    fn a_non_numeric_ram_is_rejected() {
        assert!(parse_args(&["--ram".into(), "lots".into()]).is_err());
    }

    // --- era precedence --------------------------------------------------

    #[test]
    fn era_flag_wins_over_the_config_file() {
        assert_eq!(resolve_era(Some("renewal"), Some("prerenewal")), Ok(Some(false)));
    }

    #[test]
    fn era_falls_back_to_the_config_file() {
        assert_eq!(resolve_era(None, Some("pre-renewal")), Ok(Some(true)));
    }

    #[test]
    fn era_absent_from_both_leaves_the_marker_untouched() {
        assert_eq!(resolve_era(None, None), Ok(None));
    }

    #[test]
    fn an_unrecognised_era_is_refused() {
        assert!(resolve_era(Some("classic"), None).is_err());
    }

    #[test]
    fn era_marker_is_written_removed_or_left_alone() {
        let state = std::env::temp_dir().join(format!("ro-serve-era-{}-{}", std::process::id(), line!()));
        let marker = state.join("prerenewal");

        apply_era_marker(&state, Some(true)).unwrap();
        assert!(marker.exists());

        apply_era_marker(&state, None).unwrap(); // left alone
        assert!(marker.exists());

        apply_era_marker(&state, Some(false)).unwrap();
        assert!(!marker.exists());

        apply_era_marker(&state, Some(false)).unwrap(); // removing twice is not an error
        fs::remove_dir_all(&state).unwrap();
    }

    // --- client.json merge -----------------------------------------------

    #[test]
    fn merge_keeps_unknown_keys_and_sets_mode_host() {
        let existing = obj(&[
            ("mode", Value::String("join".into())),
            ("join_host", Value::String("http://elsewhere".into())),
            ("data_grf", Value::String("/old/data.grf".into())),
        ]);
        let args = Args::default();
        let merged = merge_client(existing, None, &args);
        assert_eq!(merged.str("mode"), Some("host"));
        assert_eq!(merged.str("join_host"), Some("http://elsewhere"));
        // Nothing asked to change data_grf: the existing value survives.
        assert_eq!(merged.str("data_grf"), Some("/old/data.grf"));
    }

    #[test]
    fn config_file_overrides_existing_and_a_flag_overrides_the_config_file() {
        let existing = obj(&[("data_grf", Value::String("/existing/data.grf".into()))]);
        let config_file = obj(&[
            ("data_grf", Value::String("/config-file/data.grf".into())),
            ("era", Value::String("prerenewal".into())), // must not land in client.json
        ]);
        let merged = merge_client(existing.clone(), Some(config_file.clone()), &Args::default());
        assert_eq!(merged.str("data_grf"), Some("/config-file/data.grf"));
        assert_eq!(merged.get("era"), None);

        let mut args = Args::default();
        args.grf = Some("/flag/data.grf".into());
        let merged = merge_client(existing, Some(config_file), &args);
        assert_eq!(merged.str("data_grf"), Some("/flag/data.grf"));
    }

    #[test]
    fn ram_is_only_written_when_given() {
        let merged = merge_client(Value::Object(BTreeMap::new()), None, &Args::default());
        assert_eq!(merged.get("vm_ram_mib"), None);

        let mut args = Args::default();
        args.ram = Some(2048);
        let merged = merge_client(Value::Object(BTreeMap::new()), None, &args);
        assert_eq!(merged.get("vm_ram_mib"), Some(&Value::Number(2048.0)));
    }

    #[test]
    fn lan_and_ram_follow_the_same_precedence_as_everything_else() {
        let existing = obj(&[("lan", Value::Bool(true)), ("vm_ram_mib", Value::Number(3072.0))]);
        // A bare `serve` keeps what was saved, and tells `up` so.
        let merged = merge_client(existing.clone(), None, &Args::default());
        assert_eq!(engine_flags(&merged), (true, Some(3072)));

        // A config file beats the saved file...
        let config_file = obj(&[("lan", Value::Bool(false))]);
        let merged = merge_client(existing.clone(), Some(config_file.clone()), &Args::default());
        assert_eq!(engine_flags(&merged), (false, Some(3072)));

        // ...and a flag beats both.
        let mut args = Args::default();
        args.lan = Some(true);
        args.ram = Some(2048);
        let merged = merge_client(existing, Some(config_file), &args);
        assert_eq!(engine_flags(&merged), (true, Some(2048)));

        // Nothing saved at all: loopback, and config.toml's RAM.
        let merged = merge_client(Value::Object(BTreeMap::new()), None, &Args::default());
        assert_eq!(engine_flags(&merged), (false, None));
        assert_eq!(engine_flags(&obj(&[("vm_ram_mib", Value::Number(-1.0))])), (false, None));
    }

    // --- link-assets positional vector, matching main.js:855 -------------

    #[test]
    fn link_positional_matches_main_js_shapes() {
        assert_eq!(link_positional("data.grf", "", "", ""), vec!["data.grf", ""]);
        assert_eq!(link_positional("data.grf", "rdata.grf", "", ""), vec!["data.grf", "rdata.grf"]);
        assert_eq!(
            link_positional("data.grf", "", "official.grf", ""),
            vec!["data.grf", "", "official.grf"]
        );
        assert_eq!(
            link_positional("data.grf", "", "", "BGM"),
            vec!["data.grf", "", "", "BGM"]
        );
        assert_eq!(
            link_positional("data.grf", "rdata.grf", "official.grf", "BGM"),
            vec!["data.grf", "rdata.grf", "official.grf", "BGM"]
        );
    }

    // --- CLIENT_PUBLIC_URL / WS_ALLOWED_TARGETS ---------------------------

    #[test]
    fn public_url_brackets_ipv6_but_targets_do_not() {
        assert_eq!(public_url("192.168.1.5"), "http://192.168.1.5:3338");
        assert_eq!(public_url("::1"), "http://[::1]:3338");
        assert_eq!(ws_allowed_targets("::1", true), "127.0.0.1:6900,::1:5121,::1:6121");
    }

    #[test]
    fn targets_stay_loopback_without_lan_and_follow_advertise_with_it() {
        // Sorted lexicographically, matching Array.prototype.sort() in main.js.
        let mut expected = vec!["127.0.0.1:6900".to_string(), "127.0.0.1:6121".to_string(), "127.0.0.1:5121".to_string()];
        expected.sort();
        assert_eq!(ws_allowed_targets("192.168.1.5", false), expected.join(","));

        let mut expected = vec!["127.0.0.1:6900".to_string(), "192.168.1.5:6121".to_string(), "192.168.1.5:5121".to_string()];
        expected.sort();
        assert_eq!(ws_allowed_targets("192.168.1.5", true), expected.join(","));
    }

    // --- passthrough env precedence ---------------------------------------

    #[test]
    fn passthrough_env_prefers_the_caller_and_falls_back_to_the_electron_default() {
        let env = passthrough_env(&|k| if k == "CACHE_WARM_UP" { Some("true".to_string()) } else { None });
        let map: std::collections::HashMap<_, _> = env.into_iter().collect();
        assert_eq!(map.get("CACHE_WARM_UP"), Some(&"true".to_string())); // caller wins
        assert_eq!(map.get("ENABLE_COMPRESSION"), Some(&"true".to_string())); // Electron default
    }

    // --- tar extraction ----------------------------------------------------

    fn tar_header(name: &str, typeflag: u8, size: usize, prefix: &str) -> [u8; 512] {
        let mut h = [0u8; 512];
        let n = name.as_bytes();
        h[..n.len().min(100)].copy_from_slice(&n[..n.len().min(100)]);
        let size_oct = format!("{size:o}");
        let s = size_oct.as_bytes();
        h[124..124 + s.len()].copy_from_slice(s);
        h[156] = typeflag;
        let p = prefix.as_bytes();
        h[345..345 + p.len().min(155)].copy_from_slice(&p[..p.len().min(155)]);
        h
    }

    fn pad(mut data: Vec<u8>) -> Vec<u8> {
        let rem = data.len() % 512;
        if rem != 0 {
            data.extend(std::iter::repeat(0u8).take(512 - rem));
        }
        data
    }

    #[test]
    fn tar_extraction_handles_gnu_long_names_ustar_prefixes_and_path_escapes() {
        let mut archive = Vec::new();

        // A GNU long-name record followed by the real file's header (whose
        // own `name` field is irrelevant once a long name is pending).
        let long_name = "very/long/path/that/needs/gnu/longlink/support.dat";
        archive.extend_from_slice(&tar_header("././@LongLink", b'L', long_name.len(), ""));
        archive.extend(pad(long_name.as_bytes().to_vec()));
        let long_content = b"gnu-long-name-content";
        archive.extend_from_slice(&tar_header("ignored", b'0', long_content.len(), ""));
        archive.extend(pad(long_content.to_vec()));

        // A ustar `prefix` + `name` split.
        let prefix_content = b"prefixed-content";
        archive.extend_from_slice(&tar_header("short.txt", b'0', prefix_content.len(), "some/long/prefix/dir"));
        archive.extend(pad(prefix_content.to_vec()));

        // A directory entry.
        archive.extend_from_slice(&tar_header("a/dir/", b'5', 0, ""));

        // A member that tries to climb out of dest.
        let escape_content = b"escaped-content";
        archive.extend_from_slice(&tar_header("../../escape.txt", b'0', escape_content.len(), ""));
        archive.extend(pad(escape_content.to_vec()));

        // End-of-archive padding.
        archive.extend(vec![0u8; 1024]);

        let dest = std::env::temp_dir().join(format!("ro-serve-tar-{}-{}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&dest);
        fs::create_dir_all(&dest).unwrap();

        extract_tar(&archive, &dest).unwrap();

        assert_eq!(
            fs::read(dest.join("very/long/path/that/needs/gnu/longlink/support.dat")).unwrap(),
            long_content
        );
        assert_eq!(
            fs::read(dest.join("some/long/prefix/dir/short.txt")).unwrap(),
            prefix_content
        );
        assert!(dest.join("a/dir").is_dir());
        // Landed inside dest, not two levels above it.
        assert_eq!(fs::read(dest.join("escape.txt")).unwrap(), escape_content);

        fs::remove_dir_all(&dest).unwrap();
    }

    #[test]
    fn a_missing_tar_is_skipped_silently() {
        let root = std::env::temp_dir().join(format!("ro-serve-notar-{}-{}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let cfg = Config {
            root: root.clone(),
            state: root.join("state"),
            nebula_home: root.join("nebula"),
            nebula: root.join("nebula-bin"),
            docker: root.join("docker-bin"),
            image: String::new(),
            db_image: String::new(),
            app_version: None,
            ports: crate::ports::Ports::DEFAULT,
        };
        unpack_translation_tar(&cfg, "Renewal").unwrap();
        fs::remove_dir_all(&root).unwrap();
    }
}
