# host-local-ai

**Layers:** `client/`, and a host route (`host/`). **Not yet run in game** —
the routing, limits and sandbox rules have unit tests, but this mod has not
been played against a model.

A host route is JavaScript of the mod's own that runs on the host's computer
and answers requests from the game: from the host's own window and from every
invited friend's. This one passes a prompt to an OpenAI-compatible model the
host runs locally (llama.cpp's `llama-server --port 8080`, for instance) and
returns its text, so friends can use the host's model without reaching the
host's machine themselves.

What to look at:

- `mod.json`'s `"host"`: the entry module, and `"connect"`, the only addresses
  the handler can reach. The host sees that list in Settings → Mods and has to
  switch the service on; changing the list switches it off again.
- `host/index.js`: `export default async function handle(request, host)`,
  returning `{ status, type, body }`.
- `client/index.js`: `api.host.request('/complete', { method: 'POST', body })`.
  Press Alt+A in game.

Friends reach it through a sharing link (Settings → Sharing). Players who join
over LAN do not: see "Host routes" in [docs/MODDING.md](../../../docs/MODDING.md).
