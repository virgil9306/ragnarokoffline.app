// A small window that asks this mod's host route. api.host.request works the
// same on the host's own game window and on an invited friend's.
export default function initialize(parameters, api) {
    if (api?.version !== 1 || !api.host) throw new Error('This example requires client API 1 with api.host');
    const win = api.ui.window({ id: 'local-ai', title: 'Ask the host\'s AI', width: 360, height: 240 });
    const input = document.createElement('textarea');
    input.style.cssText = 'width:100%;height:60px;box-sizing:border-box';
    const ask = document.createElement('button');
    ask.textContent = 'Ask';
    const output = document.createElement('p');
    output.style.cssText = 'white-space:pre-wrap;margin:6px 0 0';
    win.body.append(input, ask, output);

    ask.onclick = async () => {
        ask.disabled = true;
        output.textContent = '…';
        try {
            const health = await api.host.request('/health');
            if (health.status === 404) { output.textContent = 'The host has not switched this mod\'s host service on.'; return; }
            if (!health.data?.ok) { output.textContent = health.data?.error || 'The host\'s AI is not running.'; return; }
            const answer = await api.host.request('/complete', { method: 'POST', body: { prompt: input.value } });
            output.textContent = answer.status === 200 ? answer.data.text : (answer.data?.error || `HTTP ${answer.status}`);
        } catch (error) {
            output.textContent = String(error.message || error);
        } finally {
            ask.disabled = false;
        }
    };
    // Alt+A opens it; a real mod would add a button instead.
    const key = event => { if (event.altKey && event.code === 'KeyA') win.toggle(); };
    window.addEventListener('keydown', key);
    api.cleanup(() => window.removeEventListener('keydown', key));
}
