//! settings.json: the one file the desktop app's Settings window and a
//! headless `ragnarok-stack serve` both read, and what it means for the server.
//!
//!   ragnarok-stack settings                     every setting, defaults filled in
//!   ragnarok-stack settings get KEY
//!   ragnarok-stack settings set KEY VALUE [KEY VALUE ...]
//!   ragnarok-stack settings apply               regenerate what the server reads
//!   ragnarok-stack settings path                where the shared files are
//!   ragnarok-stack settings defaults            the defaults, as JSON
//!   ragnarok-stack settings battle-conf         the battle config, printed, not written
//!
//! Most of settings.json the supervisor already reads directly -- the era's
//! packet version, the game text, the hosting scope, registration. The rest
//! has to be turned into files first: `conf/battle_conf.txt` (rates, caps,
//! view distance, the population engine) and the `prerenewal` and
//! `free_kafra_warp` markers. In the desktop app that is `toBattleConf` and
//! `saveSettings`, in JavaScript, and a Linux box running `serve` has no
//! JavaScript. So this is a port of `electron/server-settings.js`, and
//! `tests/server-settings-parity.test.cjs` runs both on the same settings and
//! fails on any difference -- including in the defaults. Change one, change
//! the other.
//!
//! The JavaScript is ported with its coercions, not tidied: `Number("")` is 0,
//! `Number(null)` is 0, `"abc"` interpolates as itself. A hand-edited
//! settings.json has to produce the same server whichever of the two read it.

use crate::json::{self, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// `SETTINGS_DEFAULTS` in electron/server-settings.js, key for key. Some are
/// the app's own (which window opens, the AI agent, the invite lifetime);
/// they are here so that `settings set` knows every key and writes a complete
/// file, exactly as the app's Apply does.
pub fn defaults() -> BTreeMap<String, Value> {
    let n = |v: f64| Value::Number(v);
    let s = |v: &str| Value::String(v.to_string());
    [
        ("open_registration", Value::Bool(true)),
        ("agent_play", Value::Bool(false)),
        ("agent_window", Value::Bool(true)),
        ("agent_count", n(1.0)),
        ("sharing_invite_days", n(7.0)),
        ("base_exp_rate", n(100.0)),
        ("job_exp_rate", n(100.0)),
        ("quest_exp_rate", n(100.0)),
        ("item_rate_common", n(100.0)),
        ("item_rate_equip", n(100.0)),
        ("item_rate_card", n(100.0)),
        ("mob_count_rate", n(100.0)),
        ("zeny_from_mobs", Value::Bool(false)),
        ("max_aspd", n(190.0)),
        ("max_parameter", n(99.0)),
        ("view_distance", s("official")),
        ("free_kafra_warp", Value::Bool(true)),
        ("unlimited_arrows", Value::Bool(false)),
        ("population_enable", Value::Bool(false)),
        ("population_max", n(1500.0)),
        ("population_density", n(100.0)),
        ("population_town_pct", n(100.0)),
        ("population_field_pct", n(100.0)),
        ("population_dungeon_pct", n(100.0)),
        ("population_companion_hire", s("free")),
        ("population_companion_fee_zeny", n(1000.0)),
        ("population_companion_fee_item", n(0.0)),
        ("population_companion_fee_item_amount", n(0.0)),
        ("population_companion_limit", n(4.0)),
        ("instant_character_deletion", Value::Bool(false)),
        ("open_settings_first", Value::Bool(false)),
        ("prerenewal", Value::Bool(false)),
        ("game_text", s("english")),
        ("packetver", Value::Null),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

/// The two settings that become marker files rather than lines in a config,
/// with the marker each one writes. Synced only when settings.json names the
/// key, as Apply does: an install that has never saved settings has no markers
/// and keeps having none.
const MARKERS: [&str; 2] = ["free_kafra_warp", "prerenewal"];

pub fn path(state: &Path) -> PathBuf {
    state.join("settings.json")
}

/// settings.json as written, without defaults. Absent is `{}`; anything the
/// app's settings-store would refuse to read is refused here too.
fn read_raw(state: &Path) -> Result<BTreeMap<String, Value>, String> {
    match crate::registration::settings(state)? {
        Value::Object(map) => Ok(map),
        _ => Ok(BTreeMap::new()),
    }
}

/// Every setting, with the defaults filled in -- what the Settings window
/// shows, and what the server is generated from.
pub fn effective(state: &Path) -> Result<BTreeMap<String, Value>, String> {
    let mut out = defaults();
    out.extend(read_raw(state)?);
    Ok(out)
}

// ---------------------------------------------------------------------------
// JavaScript's coercions, as far as the generator uses them
// ---------------------------------------------------------------------------

/// `String(n)` for the numbers these files hold. Whole numbers print without a
/// fraction, as JavaScript does; -0 prints as 0.
fn js_number_string(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if n == 0.0 {
        "0".into()
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{n:.0}")
    } else {
        format!("{n}")
    }
}

/// `${value}`: what a template literal prints. `None` is `undefined`.
fn js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => js_number_string(*n),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => js_string(Some(other)),
            })
            .collect::<Vec<_>>()
            .join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

/// `Number(string)`: trimmed, empty is 0, decimal or 0x/0o/0b, and
/// `Infinity` spelled out. Nothing else -- Rust's own parser would also take
/// "inf" and "nan", which JavaScript reads as NaN.
fn js_string_number(s: &str) -> f64 {
    let t = s.trim();
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = t.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).map(|v| v as f64).unwrap_or(f64::NAN);
        }
    }
    if !t.chars().all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number(value)`. `None` is `undefined`, which is NaN.
fn js_number(v: Option<&Value>) -> f64 {
    match v {
        None => f64::NAN,
        Some(Value::Null) => 0.0,
        Some(Value::Bool(b)) => if *b { 1.0 } else { 0.0 },
        Some(Value::Number(n)) => *n,
        Some(Value::String(s)) => js_string_number(s),
        Some(Value::Array(_)) => js_string_number(&js_string(v)),
        Some(Value::Object(_)) => f64::NAN,
    }
}

/// `value ? a : b`.
fn js_truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => *n != 0.0 && !n.is_nan(),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(_)) | Some(Value::Object(_)) => true,
    }
}

/// `x || fallback` for a number: 0 and NaN take the fallback.
fn or(x: f64, fallback: f64) -> f64 {
    if x == 0.0 || x.is_nan() { fallback } else { x }
}

// Math.min/Math.max propagate NaN; f64::min/max do not.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) }
}
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}
/// Math.round: halves go up, -2.5 is -2.
fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn clamp(lo: f64, hi: f64, x: f64) -> f64 {
    js_min(hi, js_max(lo, x))
}

/// A value the population module treats as "not given": undefined, null, ''.
fn blank(v: Option<&Value>) -> bool {
    matches!(v, None | Some(Value::Null)) || matches!(v, Some(Value::String(s)) if s.is_empty())
}

// ---------------------------------------------------------------------------
// The generator: toBattleConf and the three modules it calls
// ---------------------------------------------------------------------------

/// battle-rates.js: CATEGORY_SLIDER and FAMILIES.
const DROP_CATEGORIES: [(&str, &str); 5] = [
    ("common", "item_rate_common"),
    ("heal", "item_rate_common"),
    ("use", "item_rate_common"),
    ("equip", "item_rate_equip"),
    ("card", "item_rate_card"),
];
const DROP_FAMILIES: [&str; 3] = ["", "_boss", "_mvp"];

/// main.js: ASPD_STOCK and PARAM_STOCK, in their order.
const ASPD_STOCK: [(&str, f64); 3] = [("max_aspd", 190.0), ("max_third_aspd", 193.0), ("max_summoner_aspd", 193.0)];
const PARAM_STOCK: [(&str, f64); 5] = [
    ("max_parameter", 99.0),
    ("max_third_parameter", 130.0),
    ("max_baby_parameter", 80.0),
    ("max_extended_parameter", 130.0),
    ("max_summoner_parameter", 130.0),
];

/// view-distance.js: PRESETS. `official` is rAthena's own numbers.
const VIEW_PRESETS: [(&str, [(&str, u32); 4]); 3] = [
    ("official", [("area_size", 14), ("max_walk_path", 17), ("view_range_rate", 100), ("chase_range_rate", 100)]),
    ("wide", [("area_size", 20), ("max_walk_path", 20), ("view_range_rate", 140), ("chase_range_rate", 140)]),
    ("ultrawide", [("area_size", 28), ("max_walk_path", 24), ("view_range_rate", 200), ("chase_range_rate", 200)]),
];

/// population-conf.js: HIRE_MODES and AREAS.
const HIRE_MODES: [&str; 3] = ["free", "panel", "npc"];
const AREAS: [&str; 3] = ["town", "field", "dungeon"];

/// Raise-only caps: above the base stock every class group is lifted to the
/// player's number, at or below it every group keeps its own stock value.
fn raise_only(out: &mut String, stock: &[(&str, f64)], want: f64) {
    let base = stock[0].1;
    for (key, value) in stock {
        let v = if want > base { js_max(want, *value) } else { *value };
        out.push_str(&format!("{key}: {}\n", js_number_string(v)));
    }
}

/// `clampInt` in population-conf.js.
fn clamp_int(v: Option<&Value>, lo: f64, hi: f64, fallback: f64) -> f64 {
    let n = js_number(v);
    if blank(v) || !n.is_finite() {
        return fallback;
    }
    clamp(lo, hi, js_round(n))
}

/// `toBattleConf(settings)`: settings with the defaults already filled in.
pub fn battle_conf(s: &BTreeMap<String, Value>) -> String {
    let get = |k: &str| s.get(k);
    let num = |k: &str| js_number(get(k));
    let text = |k: &str| js_string(get(k));
    let yes_no = |on: bool| if on { "yes" } else { "no" };
    let mut out = String::from("// Generated by Ragnarok Offline. Edits here are overwritten.\n");

    for key in ["base_exp_rate", "job_exp_rate", "quest_exp_rate"] {
        out.push_str(&format!("{key}: {}\n", text(key)));
    }
    let raised = num("base_exp_rate") > 100.0 || num("job_exp_rate") > 100.0 || num("quest_exp_rate") > 100.0;
    out.push_str(&format!("multi_level_up: {}\n", yes_no(raised)));

    for family in DROP_FAMILIES {
        for (category, slider) in DROP_CATEGORIES {
            out.push_str(&format!("item_rate_{category}{family}: {}\n", text(slider)));
        }
    }
    out.push_str(&format!("item_rate_mvp: {}\n", text("item_rate_common")));
    out.push_str(&format!("item_rate_treasure: {}\n", text("item_rate_common")));

    let want = js_round(num("mob_count_rate"));
    let mob = if want.is_finite() && want > 0.0 { js_min(1000.0, want) } else { 100.0 };
    out.push_str(&format!("mob_count_rate: {}\n", js_number_string(mob)));

    out.push_str(&format!("zeny_from_mobs: {}\n", yes_no(js_truthy(get("zeny_from_mobs")))));
    out.push_str(&format!("arrow_decrement: {}\n", yes_no(!js_truthy(get("unlimited_arrows")))));

    raise_only(&mut out, &ASPD_STOCK, clamp(100.0, 199.0, or(num("max_aspd"), 190.0)));
    raise_only(&mut out, &PARAM_STOCK, clamp(10.0, 32767.0, or(num("max_parameter"), 99.0)));

    let view = text("view_distance");
    let preset = VIEW_PRESETS.iter().find(|(name, _)| *name == view).unwrap_or(&VIEW_PRESETS[0]);
    for (key, value) in preset.1 {
        out.push_str(&format!("{key}: {value}\n"));
    }

    // population-conf.js `lines`.
    let on = if js_truthy(get("population_enable")) { 1 } else { 0 };
    let max = js_max(1.0, or(num("population_max"), 1.0));
    let density = clamp(10.0, 500.0, or(num("population_density"), 100.0));
    let limit = {
        let v = num("population_companion_limit");
        if v.is_finite() { clamp(4.0, 11.0, js_round(v)) } else { 4.0 }
    };
    out.push_str(&format!("population_engine_enable: {on}\n"));
    out.push_str(&format!("population_engine_max_count: {}\n", js_number_string(max)));
    out.push_str(&format!("population_engine_density_pct: {}\n", js_number_string(density)));
    out.push_str(&format!("population_engine_companion_limit: {}\n", js_number_string(limit)));
    for area in AREAS {
        let raw = get(&format!("population_{area}_pct"));
        let v = js_number(raw);
        let share = if blank(raw) || !v.is_finite() { 100.0 } else { clamp(0.0, 100.0, js_round(v)) };
        out.push_str(&format!("population_engine_{area}_pct: {}\n", js_number_string(share)));
    }
    let hire = match get("population_companion_hire") {
        Some(Value::String(mode)) => HIRE_MODES.iter().position(|m| m == mode).unwrap_or(0),
        _ => 0,
    };
    out.push_str(&format!("population_engine_companion_hire: {hire}\n"));
    let fee = [
        ("zeny_per_level", clamp_int(get("population_companion_fee_zeny"), 0.0, 1_000_000.0, 1000.0)),
        ("item", clamp_int(get("population_companion_fee_item"), 0.0, 2_147_483_647.0, 0.0)),
        ("item_amount", clamp_int(get("population_companion_fee_item_amount"), 0.0, 30_000.0, 0.0)),
    ];
    for (key, value) in fee {
        out.push_str(&format!("population_engine_companion_hire_{key}: {}\n", js_number_string(value)));
    }
    out.push_str(&format!("population_engine_vending_enable: {on}\n"));
    out
}

// ---------------------------------------------------------------------------
// Validation and writing
// ---------------------------------------------------------------------------

/// What electron/settings-store.js refuses, refused here too, so a value
/// `settings set` accepts is one the app can still open.
fn validate(s: &BTreeMap<String, Value>) -> Result<(), String> {
    if let Some(v) = s.get("open_registration") {
        if !matches!(v, Value::Bool(_)) {
            return Err("Cannot read account creation policy. Repair settings.json before starting the server; registration was not enabled.".into());
        }
    }
    if let Some(v) = s.get("hosting_scope") {
        if !matches!(v, Value::String(x) if ["local", "lan", "friends", "public"].contains(&x.as_str())) {
            return Err("Invalid hosting scope. Choose local, lan, friends or public before starting.".into());
        }
    }
    if let Some(v) = s.get("game_text") {
        if !matches!(v, Value::String(x) if ["english", "client_western", "client_korean", "client_taiwan"].contains(&x.as_str())) {
            return Err("Cannot read the game text setting. Choose english, client_western, client_korean or client_taiwan.".into());
        }
    }
    if let Some(v) = s.get("packetver") {
        let eight_digits = |t: &str| t.len() == 8 && t.bytes().all(|b| b.is_ascii_digit());
        let ok = match v {
            Value::Null => true,
            Value::String(t) => eight_digits(t),
            Value::Number(n) => eight_digits(&js_number_string(*n)),
            _ => false,
        };
        if !ok {
            return Err("Cannot read the client version setting. Use an eight-digit date from config/PACKETVERS, or null for the default.".into());
        }
    }
    if let Some(v) = s.get("instant_character_deletion") {
        if !matches!(v, Value::Bool(_)) {
            return Err("Cannot read the character deletion setting. Repair settings.json before starting the server; the deletion delay was left in place.".into());
        }
    }
    Ok(())
}

/// A command-line value: JSON when it reads as JSON (`true`, `500`, `null`,
/// `"quoted"`), otherwise the text itself, so `set view_distance wide` needs
/// no quotes. Then held to the type of the key's default, which catches
/// `set base_exp_rate 5O0` before it becomes a rate rAthena cannot read.
fn parse_value(key: &str, raw: &str) -> Result<Value, String> {
    let mut defaults = defaults();
    // Not in the app's defaults -- absent means "follow client.json's lan" --
    // but settable, and it is the setting LAN hosting actually reads.
    defaults.insert("hosting_scope".into(), Value::String("local".into()));
    let Some(default) = defaults.get(key) else {
        let known: Vec<&str> = defaults.keys().map(String::as_str).collect();
        return Err(format!("{key} is not a setting. Settings are: {}", known.join(", ")));
    };
    let value = json::parse(raw).unwrap_or_else(|_| Value::String(raw.to_string()));
    let fits = match (default, &value) {
        (Value::Number(_), Value::Number(_)) => true,
        (Value::Bool(_), Value::Bool(_)) => true,
        (Value::String(_), Value::String(_)) => true,
        // packetver: null for the app's default, or a date.
        (Value::Null, Value::Null | Value::String(_) | Value::Number(_)) => true,
        _ => false,
    };
    if !fits {
        let kind = match default {
            Value::Number(_) => "a number",
            Value::Bool(_) => "true or false",
            Value::String(_) => "text",
            _ => "null or a date",
        };
        return Err(format!("{key} must be {kind}, got {raw}"));
    }
    Ok(value)
}

/// Replace a file the way settings-store.js does: a private temporary file
/// beside it, synced, then renamed over it, so a crash never leaves half a
/// settings.json for the next start to refuse.
pub fn write_atomic(path: &Path, body: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| format!("{} has no parent", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| format!("creating {}: {e}", parent.display()))?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temporary = parent.join(format!("{name}.{}.tmp", crate::private_fs::random_hex(12)?));
    let result = (|| {
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|e| format!("writing {}: {e}", path.display()))?;
        file.write_all(body.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("writing {}: {e}", path.display()))?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| format!("writing {}: {e}", path.display()))
    })();
    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// Merge `update` into settings.json, as the app's Apply does: every default
/// written out, then what was there, then the change.
pub fn save(state: &Path, update: BTreeMap<String, Value>) -> Result<BTreeMap<String, Value>, String> {
    let mut merged = defaults();
    merged.extend(read_raw(state)?);
    merged.extend(update);
    validate(&merged)?;
    write_atomic(&path(state), &json::to_string_pretty(&Value::Object(merged.clone())))?;
    Ok(merged)
}

/// Everything settings.json implies for the server, written out: the battle
/// config, and the era and Kafra markers when settings.json names them.
///
/// The desktop app writes the same files -- the config on every start
/// (`writeSettingsFiles`), the markers on Apply (`saveSettings`) -- so running
/// this changes nothing for a settings.json the app last wrote.
pub fn apply(state: &Path) -> Result<(), String> {
    let raw = read_raw(state)?;
    let mut merged = defaults();
    merged.extend(raw.clone());
    let conf = state.join("conf");
    fs::create_dir_all(&conf).map_err(|e| format!("creating {}: {e}", conf.display()))?;
    let battle = conf.join("battle_conf.txt");
    fs::write(&battle, battle_conf(&merged)).map_err(|e| format!("writing {}: {e}", battle.display()))?;
    for key in MARKERS {
        let Some(value) = raw.get(key) else { continue };
        let marker = state.join(key);
        if js_truthy(Some(value)) {
            fs::write(&marker, "").map_err(|e| format!("writing {}: {e}", marker.display()))?;
        } else if let Err(e) = fs::remove_file(&marker) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("removing {}: {e}", marker.display()));
            }
        }
    }
    Ok(())
}

/// A value for a person to read: text as itself, anything else as JSON.
fn show(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => json::to_string_pretty(other).trim_end().to_string(),
    }
}

const USAGE: &str = "usage: ragnarok-stack settings [get KEY | set KEY VALUE [KEY VALUE ...] | apply | path | defaults | battle-conf]";

/// `ragnarok-stack settings ...`. `set` and `apply` take the operation lock in
/// main.rs: they write files `up` reads.
pub fn command(state: &Path, args: &[String]) -> Result<(), String> {
    match args.first().map(String::as_str) {
        None => {
            print!("{}", json::to_string_pretty(&Value::Object(effective(state)?)));
            Ok(())
        }
        Some("get") => {
            let key = args.get(1).ok_or(USAGE)?;
            match effective(state)?.get(key.as_str()) {
                Some(v) => {
                    println!("{}", show(v));
                    Ok(())
                }
                None => Err(format!("{key} is not set")),
            }
        }
        Some("set") => {
            let pairs = &args[1..];
            if pairs.is_empty() || pairs.len() % 2 != 0 {
                return Err(USAGE.into());
            }
            let mut update = BTreeMap::new();
            for pair in pairs.chunks(2) {
                update.insert(pair[0].clone(), parse_value(&pair[0], &pair[1])?);
            }
            let changed: Vec<String> = update.keys().cloned().collect();
            let saved = save(state, update)?;
            apply(state)?;
            for key in changed {
                println!("{key} = {}", show(&saved[&key]));
            }
            println!(
                "Saved to {}. A running server picks this up when it restarts: \
                 stop and start `ragnarok-stack serve` (or its service), or press Apply in the app.",
                path(state).display()
            );
            Ok(())
        }
        Some("apply") => apply(state),
        Some("path") => {
            println!("settings: {}", path(state).display());
            println!("client:   {}", crate::config::data_root().join("client.json").display());
            Ok(())
        }
        Some("defaults") => {
            print!("{}", json::to_string_pretty(&Value::Object(defaults())));
            Ok(())
        }
        Some("battle-conf") => {
            print!("{}", battle_conf(&effective(state)?));
            Ok(())
        }
        Some(_) => Err(USAGE.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
        let mut s = defaults();
        for (k, v) in pairs {
            s.insert(k.to_string(), v.clone());
        }
        s
    }

    fn conf(pairs: &[(&str, Value)]) -> BTreeMap<String, String> {
        battle_conf(&with(pairs))
            .lines()
            .filter(|l| !l.starts_with("//"))
            .map(|l| {
                let (k, v) = l.split_once(": ").unwrap();
                (k.to_string(), v.to_string())
            })
            .collect()
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ro-settings-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn an_untouched_install_writes_stock_rathena() {
        let c = conf(&[]);
        assert_eq!(c["base_exp_rate"], "100");
        assert_eq!(c["multi_level_up"], "no");
        assert_eq!(c["mob_count_rate"], "100");
        assert_eq!(c["arrow_decrement"], "yes");
        assert_eq!(c["max_third_aspd"], "193");
        assert_eq!(c["max_baby_parameter"], "80");
        assert_eq!(c["area_size"], "14");
        assert_eq!(c["population_engine_enable"], "0");
        assert_eq!(c["population_engine_companion_limit"], "4");
    }

    #[test]
    fn every_drop_family_follows_its_slider() {
        let c = conf(&[
            ("item_rate_common", Value::Number(300.0)),
            ("item_rate_equip", Value::Number(200.0)),
            ("item_rate_card", Value::Number(50.0)),
        ]);
        for family in DROP_FAMILIES {
            assert_eq!(c[&format!("item_rate_heal{family}")], "300");
            assert_eq!(c[&format!("item_rate_equip{family}")], "200");
            assert_eq!(c[&format!("item_rate_card{family}")], "50");
        }
        assert_eq!(c["item_rate_mvp"], "300");
    }

    #[test]
    fn raised_exp_turns_on_multi_level_up() {
        assert_eq!(conf(&[("quest_exp_rate", Value::Number(150.0))])["multi_level_up"], "yes");
    }

    #[test]
    fn caps_only_raise() {
        let c = conf(&[("max_parameter", Value::Number(50.0)), ("max_aspd", Value::Number(195.0))]);
        assert_eq!(c["max_parameter"], "99");
        assert_eq!(c["max_third_parameter"], "130");
        assert_eq!(c["max_aspd"], "195");
        assert_eq!(c["max_third_aspd"], "195");
        let c = conf(&[("max_parameter", Value::Number(1000.0))]);
        assert_eq!(c["max_baby_parameter"], "1000");
    }

    #[test]
    fn javascript_coercions_are_kept() {
        // Number("") is 0, so the || fallback applies; a string interpolates as itself.
        let c = conf(&[("max_aspd", Value::String("".into())), ("base_exp_rate", Value::String("abc".into()))]);
        assert_eq!(c["max_aspd"], "190");
        assert_eq!(c["base_exp_rate"], "abc");
        assert_eq!(conf(&[("mob_count_rate", Value::Number(5000.0))])["mob_count_rate"], "1000");
        assert_eq!(conf(&[("mob_count_rate", Value::Number(-3.0))])["mob_count_rate"], "100");
        assert_eq!(conf(&[("view_distance", Value::String("huge".into()))])["area_size"], "14");
        assert_eq!(conf(&[("population_town_pct", Value::Null)])["population_engine_town_pct"], "100");
        assert_eq!(conf(&[("population_companion_limit", Value::Null)])["population_engine_companion_limit"], "4");
        assert_eq!(js_string_number("0x10"), 16.0);
        assert!(js_string_number("inf").is_nan());
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_number_string(150.5), "150.5");
    }

    #[test]
    fn set_validates_like_the_app() {
        assert!(parse_value("base_exp_rate", "500").is_ok());
        assert!(parse_value("base_exp_rate", "5O0").is_err());
        assert!(parse_value("view_distance", "wide").is_ok());
        assert!(parse_value("nonsense", "1").unwrap_err().contains("not a setting"));
        assert!(parse_value("packetver", "20221005").is_ok());
        assert!(parse_value("hosting_scope", "lan").is_ok());
        let state = scratch("validate");
        let mut update = BTreeMap::new();
        update.insert("packetver".to_string(), Value::String("2022".into()));
        assert!(save(&state, update).is_err());
        assert!(!path(&state).exists(), "a refused value is never written");
        fs::remove_dir_all(state).unwrap();
    }

    #[test]
    fn apply_writes_the_config_and_syncs_only_named_markers() {
        let state = scratch("apply");
        // Nothing saved yet: the config is written, markers are left alone.
        fs::write(state.join("free_kafra_warp"), "").unwrap();
        apply(&state).unwrap();
        assert!(fs::read_to_string(state.join("conf/battle_conf.txt")).unwrap().contains("base_exp_rate: 100"));
        assert!(state.join("free_kafra_warp").exists());

        let mut update = BTreeMap::new();
        update.insert("prerenewal".to_string(), Value::Bool(true));
        update.insert("base_exp_rate".to_string(), Value::Number(500.0));
        save(&state, update).unwrap();
        apply(&state).unwrap();
        assert!(state.join("prerenewal").exists());
        // save wrote every default, so free_kafra_warp (true) is now named.
        assert!(state.join("free_kafra_warp").exists());
        assert!(fs::read_to_string(state.join("conf/battle_conf.txt")).unwrap().contains("base_exp_rate: 500"));

        let mut update = BTreeMap::new();
        update.insert("prerenewal".to_string(), Value::Bool(false));
        update.insert("free_kafra_warp".to_string(), Value::Bool(false));
        save(&state, update).unwrap();
        apply(&state).unwrap();
        assert!(!state.join("prerenewal").exists());
        assert!(!state.join("free_kafra_warp").exists());

        // Unknown keys someone else wrote survive a save.
        fs::write(path(&state), "{\"hosting_scope\":\"lan\",\"later_key\":3}").unwrap();
        save(&state, BTreeMap::new()).unwrap();
        let back = effective(&state).unwrap();
        assert_eq!(back["later_key"], Value::Number(3.0));
        assert_eq!(back["hosting_scope"], Value::String("lan".into()));
        fs::remove_dir_all(state).unwrap();
    }
}
