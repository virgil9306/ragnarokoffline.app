// Mods' host routes (electron/mod-host/, docs/MODDING.md "Host routes"), end to
// end: the real app, the real sharing gateway, an invited headless browser over
// a local TLS connector fixture or (RO_E2E_REAL_CLOUDFLARE=1) a real temporary
// Cloudflare tunnel, and the host's own game page through the client API.
//
// Same ownership rules as friends-sharing.cjs, whose setup this follows: one
// stopped disposable world, no client.json in it, and everything it changes
// put back. A fake OpenAI-compatible model listens on 127.0.0.1:18080 (8080 is
// often somebody's real one) and a decoy on 18081 that nothing may reach.
//
//   RO_E2E_WORLD=<disposable world> RO_E2E_CLIENT_JSON=<client.json> \
//     [RO_E2E_REAL_CLOUDFLARE=1] node tests/e2e/host-routes.cjs
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { _electron, chromium, expect } = require('@playwright/test');
const { verifyWorld } = require('./support.cjs');
const work = path.resolve(__dirname, '../..');
const liveCloudflare = process.env.RO_E2E_REAL_CLOUDFLARE === '1';
if (!process.env.RO_E2E_WORLD || !process.env.RO_E2E_CLIENT_JSON)
  throw Error('Set RO_E2E_WORLD and RO_E2E_CLIENT_JSON; stop the disposable world first');
const world = fs.realpathSync(process.env.RO_E2E_WORLD);
if (JSON.parse(fs.readFileSync(path.join(world, '.ragnarok-e2e.json'))).disposable !== true)
  throw Error('Not a disposable world');
const clientPath = path.join(world, 'client.json');
if (fs.existsSync(clientPath)) throw Error('Fixture requires no existing client.json');
const selected = JSON.parse(fs.readFileSync(process.env.RO_E2E_CLIENT_JSON));
const state = path.join(world, 'state');
const settingsPath = path.join(state, 'settings.json');
const settings = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath) : null;
if (fs.existsSync(path.join(state, 'prerenewal'))) throw Error('Start with renewal selected');
const modsDir = path.join(state, 'mods');
const consentPath = path.join(state, 'mod-host.json');
const TEST_MODS = ['host-local-ai', 'host-probe-e2e'];
for (const name of TEST_MODS) if (fs.existsSync(path.join(modsDir, name))) throw Error(`${name} is already installed in this world`);
if (fs.existsSync(consentPath)) throw Error('Fixture requires no existing mod-host.json');
const out = path.join(world, 'account-tests', 'host-routes-' + Date.now());
fs.mkdirSync(out, { recursive: true });
const report = { checks: [], failed: [], screens: [], pageErrors: [], startedAt: new Date().toISOString(),
  transport: liveCloudflare ? 'real temporary Cloudflare tunnel' : 'local TLS connector fixture' };
const env = { ...process.env, RAGNAROK_OFFLINE_HOME: world,
  RAGNAROKMAC_ROOT: path.join(world, 'runtime'), RAGNAROKMAC_STATE: state,
  NEBULA_HOME: path.join(world, 'nebula') };
const AI_PORT = 18080, DECOY_PORT = 18081;
const CANNED = 'Canned completion from the e2e fake model.';

async function freePorts(ports = [3338, 3339, 6900, 6121, 5121, 7462, AI_PORT, DECOY_PORT]) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); reject(Error(`Port ${port} is occupied; stop the other host first`)); });
      socket.once('error', e => e.code === 'ECONNREFUSED' ? resolve() : reject(e));
      socket.setTimeout(1000, () => { socket.destroy(); reject(Error(`Port ${port} did not refuse connections`)); });
    });
  }
}

// One check: recorded as passed or failed, and the run carries on, so a report
// names every result rather than only the first failure.
async function check(name, fn) {
  try { const evidence = await fn(); report.checks.push({ name, ok: true, evidence }); console.log('PASS', name); }
  catch (error) { report.failed.push({ name, error: String(error.message || error).slice(0, 2000) }); console.log('FAIL', name, '-', error.message); }
}

// A fake OpenAI-compatible model, and a decoy that must never be reached.
function recorder(port, handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { seen.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, res, body); });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, seen })));
}
const model = (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: CANNED } }] }));
  }
  res.writeHead(404); res.end();
};

// The example mod, pointed at the fake model, with a client that hands the
// test api.host.request; and a probe mod whose handler tries to reach places
// it was not allowed.
function installTestMods() {
  const ai = path.join(modsDir, 'host-local-ai');
  fs.cpSync(path.join(work, 'examples/mods/host-local-ai'), ai, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ai, 'mod.json'), 'utf8'));
  manifest.host.connect = [`http://127.0.0.1:${AI_PORT}`];
  fs.writeFileSync(path.join(ai, 'mod.json'), JSON.stringify(manifest, null, 2));
  const handler = path.join(ai, 'host/index.js');
  fs.writeFileSync(handler, fs.readFileSync(handler, 'utf8').replace("'http://127.0.0.1:8080'", `'http://127.0.0.1:${AI_PORT}'`));
  fs.writeFileSync(path.join(ai, 'client/index.js'), `export default function initialize(parameters, api) {
    window.__hostRoutesE2E = (route, options) => api.host.request(route, options);
    return () => { delete window.__hostRoutesE2E; };
}
`);
  const probe = path.join(modsDir, 'host-probe-e2e');
  fs.mkdirSync(path.join(probe, 'host'), { recursive: true });
  fs.writeFileSync(path.join(probe, 'mod.json'), JSON.stringify({ name: 'host-probe-e2e', version: '1.0.0', description: 'e2e: tries to reach origins it did not declare',
    host: { entry: 'host/index.js', connect: [`http://127.0.0.1:${AI_PORT}`] } }, null, 2));
  fs.writeFileSync(path.join(probe, 'host/index.js'), `export default async function handle(request, host) {
    const url = new URLSearchParams(request.query).get('url');
    if (request.path === '/socket') {
        return await new Promise(resolve => {
            let socket;
            try { socket = new WebSocket(url); } catch (error) { return resolve({ body: { ok: false, error: String(error) } }); }
            socket.onopen = () => { socket.close(); resolve({ body: { ok: true } }); };
            socket.onerror = () => resolve({ body: { ok: false, error: 'websocket error' } });
        });
    }
    try {
        const response = await fetch(url);
        return { body: { ok: true, status: response.status } };
    } catch (error) {
        return { body: { ok: false, error: String(error && error.message || error) } };
    }
}
`);
}

async function main() {
  await freePorts();
  const fake = await recorder(AI_PORT, model);
  const decoy = await recorder(DECOY_PORT, (req, res) => { res.writeHead(200); res.end('decoy reached'); });
  installTestMods();
  const app = await _electron.launch({ executablePath: require('electron'),
    args: [path.join(work, 'tests/fixtures/sharing-main.cjs'), '--quiet', '--user-data-dir=' + path.join(world, 'host-routes-electron-profile')],
    env, cwd: work, timeout: 45000 });
  let owner, browser, tls, failure;
  const tlsSockets = new Set();
  let fixtureSecretCreated = false;
  const invoke = (name, args) => owner.evaluate(({ name, args }) => window.__ELECTRON__.core.invoke(name, args), { name, args });
  try {
    owner = await app.firstWindow();
    await expect(owner.locator('body')).toContainText('Waiting for your client', { timeout: 30000 });
    const boot = owner;
    boot.on('dialog', dialog => dialog.accept().catch(() => {}));
    boot.on('pageerror', error => report.pageErrors.push('host: ' + error.message));
    await invoke('open_settings');
    await expect.poll(() => app.windows().some(p => p.url().endsWith('settings.html'))).toBe(true);
    const page = app.windows().find(p => p.url().endsWith('settings.html'));
    owner = page;
    await expect.poll(() => app.windows().some(p => p.url().endsWith('setup.html'))).toBe(true);
    const setup = app.windows().find(p => p.url().endsWith('setup.html'));
    await app.evaluate(({ dialog }) => { globalThis.roOriginalOpenDialog = dialog.showOpenDialog; });
    try {
      for (const key of ['data_grf', 'rdata_grf', 'official_grf', 'bgm_dir']) {
        if (!selected[key]) continue;
        await app.evaluate(({ dialog }, chosen) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }); }, selected[key]);
        await setup.locator(`[data-pick="${key}"]`).click();
        await expect(setup.locator('#p-' + key)).toHaveText(selected[key]);
      }
    } finally {
      await app.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.roOriginalOpenDialog; delete globalThis.roOriginalOpenDialog; });
    }
    await setup.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(boot).toHaveURL(/^http:\/\/127\.0\.0\.1:3338\//, { timeout: 600000 });
    await expect(boot.locator('#WinLogin .user')).toBeVisible({ timeout: 120000 });
    await verifyWorld();
    await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setTitle('Ragnarok Offline — disposable acceptance test'); });

    let origin;
    if (!liveCloudflare) {
      tls = https.createServer({ key: fs.readFileSync(path.join(work, 'tests/fixtures/tls/localhost-key.pem')),
        cert: fs.readFileSync(path.join(work, 'tests/fixtures/tls/localhost-cert.pem')) }, (req, res) => {
        const proxy = http.request({ host: '127.0.0.1', port: 3339, method: req.method, path: req.url, headers: req.headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
        proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(proxy);
      });
      tls.on('connection', socket => { tlsSockets.add(socket); socket.on('close', () => tlsSockets.delete(socket)); });
      await new Promise(resolve => tls.listen(0, '127.0.0.1', resolve));
      origin = 'https://localhost:' + tls.address().port;
    }
    await app.evaluate(({ clipboard }) => { globalThis.roSharingClipboard = clipboard.readText(); });
    if (!liveCloudflare) await app.evaluate(({ safeStorage }, { work, world, origin }) => {
      const require = globalThis.roFixtureRequire;
      const fs = require('node:fs'), path = require('node:path');
      const secretFile = path.join(world, 'sharing/cloudflare.enc');
      if (fs.existsSync(secretFile)) throw Error('Refusing to overwrite existing Cloudflare setup');
      const store = new (require(path.join(work, 'electron/sharing/secrets')).SharingSecrets)(path.join(world, 'sharing'), safeStorage);
      store.save({ hostname: new URL(origin).host, tunnelId: '11111111-2222-3333-4444-555555555555', accountId: 'a'.repeat(32), secret: Buffer.alloc(32, 1).toString('base64') });
      const Controller = require(path.join(work, 'electron/sharing/controller')).SharingController;
      // Only the connector is substituted; the gateway is the real one, given
      // the same modHost the controller would give it.
      Controller.prototype.start = async function() {
        await this.guard();
        this.gateway = new (require(path.join(work, 'electron/sharing/gateway')).FriendGateway)({ origin, register: this.register, modHost: this.modHost });
        await this.gateway.start();
        this.update('sharing', 'Sharing through the local TLS acceptance fixture.');
      };
    }, { work, world, origin });
    fixtureSecretCreated = !liveCloudflare;
    // Settings is tabbed now; the sharing controls are under Multiplayer.
    await page.locator('#tab-multiplayer').click();
    await page.locator('#mp-internet-setup').check();
    await expect(page.locator('#sharing-start')).toBeEnabled({ timeout: 10000 });
    await page.locator('#sharing-start').click();
    const sharingDeadline = Date.now() + 240000;
    for (;;) {
      const status = await invoke('sharing_status');
      if (status.state === 'failed') throw Error(status.message);
      if (status.state === 'sharing') break;
      if (Date.now() >= sharingDeadline) throw Error('Sharing did not become ready: ' + status.message);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    await page.locator('#sharing-copy').click();
    const link = await app.evaluate(({ clipboard }) => clipboard.readText());
    origin = new URL(link).origin;
    report.origin = liveCloudflare ? origin.replace(/\/\/[^.]+/, '//<random>') : origin;
    console.log('Sharing at', origin);

    // The invited friend: a real browser that opened the invitation link.
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: !liveCloudflare });
    const friend = await context.newPage();
    friend.on('pageerror', error => report.pageErrors.push('friend: ' + error.message));
    await friend.goto(link);
    await expect(friend.locator('#ready')).toBeVisible({ timeout: 60000 });
    const call = (route, init = {}) => friend.evaluate(async ({ route, init }) => {
      const response = await fetch(route, { credentials: 'same-origin', cache: 'no-store', ...init });
      return { status: response.status, type: response.headers.get('content-type'), csp: response.headers.get('content-security-policy'),
        cookie: response.headers.get('set-cookie'), text: await response.text() };
    }, { route, init });
    const AI = '/_friend/mod/host-local-ai';
    const completion = { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer friend-sentinel' }, body: JSON.stringify({ prompt: 'Say hello' }) };

    await check('friend: before consent, the route is 404 and the model is not reached', async () => {
      const health = await call(AI + '/health'), post = await call(AI + '/complete', completion);
      expect([health.status, post.status]).toEqual([404, 404]);
      expect(fake.seen.length).toBe(0);
      return { health: health.status, complete: post.status, modelRequests: fake.seen.length };
    });
    await check('Settings lists both host routes, off, with their connect lists', async () => {
      const list = await invoke('mod_host_list');
      const mine = list.filter(entry => TEST_MODS.includes(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
      expect(mine).toEqual([
        { name: 'host-local-ai', connect: [`http://127.0.0.1:${AI_PORT}`], allowed: false },
        { name: 'host-probe-e2e', connect: [`http://127.0.0.1:${AI_PORT}`], allowed: false },
      ]);
      return mine;
    });
    // Consent through the Settings UI itself: the switch in the mod's row,
    // under Host service once the row is open.
    await check('consent switched on from the Mods tab card', async () => {
      await page.bringToFront();
      await page.locator('#tab-mods').click();
      await page.locator('#modstab-installed').click();
      const row = page.locator('#mods-list .mrow[data-mod="host-local-ai"]');
      await row.locator('.mrow-hit').click();
      const toggle = row.locator('.hostroute input[type=checkbox]');
      await expect(toggle).toBeVisible({ timeout: 30000 });
      await expect(toggle).not.toBeChecked();
      const caption = await row.locator('.hostroute').innerText();
      expect(caption).toContain(`may connect to: http://127.0.0.1:${AI_PORT}`);
      await toggle.check();
      await expect.poll(async () => (await invoke('mod_host_list')).find(e => e.name === 'host-local-ai').allowed).toBe(true);
      const stored = JSON.parse(fs.readFileSync(consentPath, 'utf8'));
      expect(stored).toEqual({ 'host-local-ai': { enabled: true, connect: [`http://127.0.0.1:${AI_PORT}`] } });
      await row.locator('.mbox.host').screenshot({ path: path.join(out, 'settings-consent.png') });
      report.screens.push('settings-consent.png');
      return { caption, stored };
    });
    await check('friend: GET /health answers 200 from the handler', async () => {
      const r = await call(AI + '/health');
      expect(r.status).toBe(200);
      expect(JSON.parse(r.text)).toEqual({ ok: true });
      expect(r.csp).toContain('sandbox');
      expect(r.cookie).toBe(null);
      return r;
    });
    await check('friend: POST /complete answers the canned text; the model saw one completion, no cookie or authorization', async () => {
      const before = fake.seen.length;
      const r = await call(AI + '/complete', completion);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.text)).toEqual({ text: CANNED });
      const posts = fake.seen.slice(before).filter(s => s.method === 'POST');
      expect(posts.length).toBe(1);
      expect(posts[0].url).toBe('/v1/chat/completions');
      expect(JSON.parse(posts[0].body)).toEqual({ messages: [{ role: 'user', content: 'Say hello' }], max_tokens: 200 });
      for (const s of fake.seen) { expect(s.headers.cookie).toBeUndefined(); expect(s.headers.authorization).toBeUndefined(); }
      return { response: r, modelRequests: fake.seen.slice(before).map(s => ({ method: s.method, url: s.url, origin: s.headers.origin, headerNames: Object.keys(s.headers) })) };
    });
    await check('no invitation cookie (a fresh browser context) is 401', async () => {
      const stranger = await browser.newContext({ ignoreHTTPSErrors: !liveCloudflare });
      try {
        const r = await stranger.request.get(origin + AI + '/health');
        expect(r.status()).toBe(401);
        return { status: r.status() };
      } finally { await stranger.close(); }
    });
    await check('cross-origin POST with the friend\'s cookie is 403', async () => {
      const before = fake.seen.length;
      const r = await context.request.post(origin + AI + '/complete', { headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, data: { prompt: 'x' } });
      expect(r.status()).toBe(403);
      expect(fake.seen.length).toBe(before);
      return { status: r.status() };
    });
    await check('host\'s own game page: api.host.request gives the same answer', async () => {
      await boot.bringToFront();
      await expect.poll(() => boot.evaluate(() => typeof window.__hostRoutesE2E), { timeout: 30000 }).toBe('function');
      const before = fake.seen.length;
      const health = await boot.evaluate(() => window.__hostRoutesE2E('/health'));
      const answer = await boot.evaluate(() => window.__hostRoutesE2E('/complete', { method: 'POST', body: { prompt: 'Say hello' } }));
      expect(health.status).toBe(200);
      expect(answer.status).toBe(200);
      expect(answer.data).toEqual({ text: CANNED });
      expect(fake.seen.slice(before).filter(s => s.method === 'POST').length).toBe(1);
      await boot.screenshot({ path: path.join(out, 'host-game.png') });
      report.screens.push('host-game.png');
      return { health, answer };
    });
    await check('friend: api.host.request in the friend\'s page shape (fetch /_friend/mod) matches', async () => {
      const r = await call(AI + '/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Say hello' }) });
      expect(JSON.parse(r.text)).toEqual({ text: CANNED });
      return { status: r.status };
    });
    await check('sandbox: undeclared origins and WebSockets fail; the declared one works; the log says blocked', async () => {
      await invoke('mod_host_set', { name: 'host-probe-e2e', enabled: true });
      const probe = url => call('/_friend/mod/host-probe-e2e/probe?url=' + encodeURIComponent(url));
      const socket = url => call('/_friend/mod/host-probe-e2e/socket?url=' + encodeURIComponent(url));
      const allowed = JSON.parse((await probe(`http://127.0.0.1:${AI_PORT}/health`)).text);
      const asset = JSON.parse((await probe('http://127.0.0.1:3338/')).text);
      const list = JSON.parse((await probe('http://127.0.0.1:3338/list-files')).text);
      const decoyed = JSON.parse((await probe(`http://127.0.0.1:${DECOY_PORT}/`)).text);
      const localhost = JSON.parse((await probe(`http://localhost:${AI_PORT}/health`)).text);
      const ws = JSON.parse((await socket(`ws://127.0.0.1:${AI_PORT}/`)).text);
      expect(allowed).toEqual({ ok: true, status: 200 });
      for (const r of [asset, list, decoyed, localhost, ws]) expect(r.ok).toBe(false);
      expect(decoy.seen.length).toBe(0);
      await new Promise(resolve => setTimeout(resolve, 500));
      const log = fs.readFileSync(path.join(state, 'app.log'), 'utf8').split('\n').filter(line => line.includes('mod-host host-probe-e2e'));
      const blocked = log.filter(line => line.includes('blocked'));
      for (const url of ['http://127.0.0.1:3338/', `http://127.0.0.1:${DECOY_PORT}/`, `http://localhost:${AI_PORT}/health`, `ws://127.0.0.1:${AI_PORT}/`]) {
        expect(blocked.some(line => line.includes(url))).toBe(true);
      }
      return { allowed, asset, list, decoyed, localhost, ws, decoyHits: decoy.seen.length, log };
    });
    await check('mod switched off: the route is 404 again and its handler stops', async () => {
      await invoke('set_mod_enabled', { name: 'host-local-ai', enabled: false });
      const r = await call(AI + '/health');
      expect(r.status).toBe(404);
      const hostSide = await boot.evaluate(() => window.__hostRoutesE2E('/health'));
      expect(hostSide.status).toBe(404);
      await invoke('set_mod_enabled', { name: 'host-local-ai', enabled: true });
      return { friend: r.status, host: hostSide.status };
    });
    await check('consent revoked: 404', async () => {
      await invoke('mod_host_set', { name: 'host-local-ai', enabled: false });
      const r = await call(AI + '/health');
      expect(r.status).toBe(404);
      return { status: r.status };
    });
    await friend.screenshot({ path: path.join(out, 'friend-portal.png') });
    report.screens.push('friend-portal.png');
    report.appLog = fs.readFileSync(path.join(state, 'app.log'), 'utf8').split('\n').filter(line => line.includes('mod-host')).slice(-60);
    expect(report.pageErrors.filter(e => /host\.request|HostRoutes|mod-host/i.test(e))).toEqual([]);
    if (report.failed.length) throw Error(`${report.failed.length} check(s) failed`);
    console.log('Host routes acceptance passed:', out);
  } catch (error) {
    failure = error;
    report.failure = String(error.message || error);
    console.error('Acceptance failed:', report.failure);
    for (const [index, p] of app.windows().entries()) {
      if (p.isClosed()) continue;
      await p.screenshot({ path: path.join(out, `failure-${index}.png`), mask: [p.locator('input, textarea')] }).catch(() => {});
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (owner && !owner.isClosed()) await invoke('sharing_stop').catch(() => {});
    if (tls) { for (const socket of tlsSockets) socket.destroy(); await new Promise(resolve => tls.close(resolve)); }
    await app.evaluate(({ clipboard }) => { if (globalThis.roSharingClipboard !== undefined) clipboard.writeText(globalThis.roSharingClipboard); }).catch(() => {});
    if (fixtureSecretCreated) fs.rmSync(path.join(world, 'sharing/cloudflare.enc'), { force: true });
    let stopped = false;
    try {
      if (owner && !owner.isClosed()) { await invoke('assets_stop'); await invoke('stack_down'); }
    } catch (error) { report.cleanupFailure = String(error.message || error); }
    if (owner && !owner.isClosed()) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await app.close().catch(() => {});
    for (const s of [fake.server, decoy.server]) { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
    try { await freePorts(); stopped = true; } catch (error) { report.cleanupFailure = (report.cleanupFailure || '') + ' ' + error.message; }
    if (stopped) {
      fs.rmSync(clientPath, { force: true });
      if (settings) fs.writeFileSync(settingsPath, settings); else fs.rmSync(settingsPath, { force: true });
      fs.rmSync(path.join(state, 'prerenewal'), { force: true });
      for (const name of TEST_MODS) fs.rmSync(path.join(modsDir, name), { recursive: true, force: true });
      fs.rmSync(consentPath, { force: true });
    }
    report.teardown = { portsFree: stopped };
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('Report:', path.join(out, 'report.json'));
    if (!stopped && !failure) failure = Error('Owned teardown did not free all ports; selection files retained');
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
