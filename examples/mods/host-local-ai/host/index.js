// Runs on the host's machine, in the app's sandbox, once the host has switched
// "Runs a host service" on for this mod in Settings -> Mods. It can fetch only
// the origins in mod.json's "connect" -- here a llama.cpp server (or any
// OpenAI-compatible one) on 127.0.0.1:8080.
const AI = 'http://127.0.0.1:8080';

export default async function handle(request, host) {
    if (request.method === 'GET' && request.path === '/health') {
        try {
            const response = await fetch(`${AI}/health`);
            return { body: { ok: response.ok } };
        } catch {
            return { status: 503, body: { ok: false, error: 'The local AI server is not running.' } };
        }
    }
    if (request.method === 'POST' && request.path === '/complete') {
        let prompt;
        try { prompt = JSON.parse(request.body || '{}').prompt; } catch { /* checked below */ }
        if (typeof prompt !== 'string' || !prompt || prompt.length > 2000) {
            return { status: 400, body: { error: 'Send { "prompt": "..." }, up to 2000 characters.' } };
        }
        const response = await fetch(`${AI}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], max_tokens: 200 }),
        });
        if (!response.ok) {
            host.log(`the model answered HTTP ${response.status}`);
            return { status: 502, body: { error: 'The local AI could not answer.' } };
        }
        const answer = await response.json();
        // Who asked is in request.from: 'host' or 'friend'.
        host.log(`answered a ${request.from}`);
        return { body: { text: String(answer?.choices?.[0]?.message?.content ?? '') } };
    }
    return { status: 404, body: { error: 'Not found' } };
}
