// api.host.request: a mod's own host route (docs/MODDING.md, "Host routes").
//
// The route runs on the host's machine, in the app (electron/mod-host/), so it
// is reached two ways and a plugin sees one:
//
//   - the host's own window -- the app's game window, on loopback -- asks the
//     app over its game-page IPC handler, `mod_host_request`, which checks for
//     itself that the page is the one it loaded;
//   - a friend's browser fetches /_friend/mod/<mod>/<path> on the origin it
//     loaded the game from, which is the friend gateway
//     (electron/sharing/gateway.js).
//
// A LAN player loads the game straight from the asset server, which has no
// such path: the request answers 404 there, like a mod with no route.
//
// The mod's name is bound by the runtime (ExtensionRuntime.mjs), not chosen by
// the plugin. No roBrowser imports, so tests can run it under plain node.

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const LIMIT = 200 * 1024;

export function createHostRoutes({ invoke = null, fetch: fetchImpl = globalThis.fetch, origin = () => globalThis.location?.origin } = {}) {
    const local = () => {
        if (typeof invoke !== 'function') return false;
        try { return LOOPBACK.has(new URL(origin()).hostname); } catch { return false; }
    };
    const result = (status, type, body) => {
        let data = null;
        if (/^application\/json\b/i.test(type || '')) { try { data = JSON.parse(body); } catch { data = null; } }
        return { status, type: type || '', body, data };
    };

    // Resolves { status, type, body (text), data (parsed JSON, or null) } for
    // any answer, errors included; rejects only when nothing answered.
    return async function request(mod, path, options = {}) {
        if (typeof mod !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(mod)) throw new TypeError('host.request: this plugin has no mod name');
        if (typeof path !== 'string' || !path.startsWith('/') || path.length > 3072 || /[\x00-\x1f\x7f\\#]/.test(path))
            throw new TypeError('host.request: path must start with / and be one line');
        const method = String(options?.method || 'GET').toUpperCase();
        if (!METHODS.has(method)) throw new TypeError('host.request: method must be GET, POST, PUT or DELETE');
        let body = null, type;
        if (options?.body !== undefined && options?.body !== null) {
            if (typeof options.body === 'string') { body = options.body; type = 'text/plain; charset=utf-8'; }
            else { body = JSON.stringify(options.body); type = 'application/json'; }
        }
        if (method === 'GET' && body !== null) throw new TypeError('host.request: a GET has no body');
        if (body !== null && new TextEncoder().encode(body).length > LIMIT) throw new RangeError('host.request: the body is over 200 KiB');
        const [route, ...rest] = path.split('?');
        const query = rest.join('?');
        const timeout = Math.min(Math.max(Number(options?.timeout) || 35000, 1000), 35000);

        if (local()) {
            let timer;
            const answer = await Promise.race([
                invoke('mod_host_request', { mod, method, path: route, query, body, type, accept: 'application/json, text/plain;q=0.9, */*;q=0.1' }),
                new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('host.request: no answer in time')), timeout); }),
            ]).finally(() => clearTimeout(timer));
            if (!answer || typeof answer !== 'object') throw new Error('host.request: no answer from the app');
            return result(Number(answer.status) || 502, String(answer.type || ''), String(answer.body ?? ''));
        }
        if (typeof fetchImpl !== 'function') throw new Error('host.request: this page cannot reach host routes');
        const headers = { accept: 'application/json, text/plain;q=0.9, */*;q=0.1' };
        if (type) headers['content-type'] = type;
        const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeout) : undefined;
        const response = await fetchImpl(`/_friend/mod/${encodeURIComponent(mod)}${route}${query ? '?' + query : ''}`, {
            method, credentials: 'same-origin', cache: 'no-store', headers, body: body ?? undefined, signal,
        });
        return result(response.status, response.headers.get('content-type') || '', await response.text());
    };
}
