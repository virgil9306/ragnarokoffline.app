'use strict';
// Guild emblems (#388). roBrowserLegacy uploads and downloads them over HTTP, on the origin it was
// loaded from, and rAthena's web server is what keeps them. The app built that server but never
// ran it, never created its table, and gave the asset server nowhere to send the requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const cmds = read('stack/src/cmds.rs');

test('the web server is started on loopback, and a failure there does not stop the world', () => {
  assert.match(cmds, /if let Err\(e\) = run_server\(cfg, dk, WEB_SERVER, ports\.web, &format!\("\/rathena\/web-server\{ver\}"\), false\)/,
    'loopback even when hosting: only the asset server talks to it');
  assert.match(cmds, /write_conf\(&conf, "web_conf\.txt", &cfg\.ports\.web_conf\(\)\)\?;/);
  assert.match(cmds, /const WEB_SERVER: &str = "ragnarok-web";/);
  assert.ok(!/SERVERS: \[&str; 3\] = \[[^\]]*ragnarok-web/.test(read('stack/src/config.rs')), 'not one of the servers a launch waits on');
});

test('it is stopped with the game servers and removed on shutdown', () => {
  assert.match(cmds, /for service in \[WEB_SERVER, "ragnarok-map", "ragnarok-char", "ragnarok-login"\]/);
  assert.match(cmds, /for service in \[WEB_SERVER, "ragnarok-map", "ragnarok-char", "ragnarok-login", DB_CONTAINER\]/);
  assert.match(cmds, /dk\.remove_container\(WEB_SERVER\);/);
});

test('its emblem table exists before it starts', () => {
  assert.match(cmds, /CREATE TABLE IF NOT EXISTS `guild_emblems`/);
  assert.match(cmds, /ensure_companion_table\(dk\)\?;\n\s*ensure_guild_emblems_table\(dk\)\?;/);
});

test('the asset server is told where to forward emblem requests', () => {
  assert.match(read('electron/main.js'), /WEB_SERVER_TARGET: `127\.0\.0\.1:\$\{gamePorts\(\)\.web\}`/);
});
