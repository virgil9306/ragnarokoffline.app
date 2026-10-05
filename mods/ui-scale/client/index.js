// Windows drawn larger or smaller (api.ui.scale), set in a window of the
// plugin's own (api.ui.window) that opens from a button in the option menu
// (api.ui.menuButton). The client remembers nothing, so the factors are kept
// here, in api.preferences, and set again every time the game starts.

const MIN = 0.5;
const MAX = 3;
const STEP = 0.05;

/** What the player calls each window. A window the client adds later shows by its own name. */
const LABELS = {
    ShortCut: 'Hotbar',
    ShortCuts: 'Shortcut window',
    ChatBox: 'Chat',
    Inventory: 'Inventory',
    StatusIcons: 'Buff icons',
    BasicInfo: 'Basic info (HP/SP)',
    MiniMap: 'Minimap',
    MapName: 'Map name',
    PvPTimer: 'PvP timer',
    CashShopIcon: 'Cash shop icon',
    RodexIcon: 'Mail icon',
    PCGoldTimer: 'Gold timer',
    JoystickUI: 'Gamepad hotbar',
    JoystickSelectionUI: 'Gamepad shortcut picker',
    Equipment: 'Equipment',
    SkillList: 'Skills',
    SkillDescription: 'Skill description',
    Storage: 'Storage',
    PartyFriends: 'Party & friends',
    WhisperBox: 'Whispers',
    NpcBox: 'NPC dialog',
    NpcMenu: 'NPC choices',
    ItemInfo: 'Item info',
    ItemPreview: 'Item preview',
    ItemCompare: 'Item compare',
    ItemObtain: 'Item obtained',
    WinStats: 'Stats',
    Escape: 'Option menu',
    GraphicsOption: 'Graphics settings',
    SoundOption: 'Sound settings',
    InputBox: 'Input box',
    Emoticons: 'Emotions',
    CardIllustration: 'Card art',
    PlayerViewEquip: "Another player's equipment",
    WinLogin: 'Login',
    WinList: 'Server list',
    CharSelect: 'Character select',
    CharCreate: 'Character creation',
    PincodeWindow: 'PIN code',
};

const STYLE = `
.scale { font: 12px Tahoma, Arial, sans-serif; color: #273256; }
.scale { display: flex; flex-direction: column; height: 100%; }
.all { padding: 8px 10px; border-bottom: 1px solid #c9d1e6; background: #f3f5fb; }
.list { overflow: auto; flex: 1; padding: 4px 10px 8px; }
.row { display: grid; grid-template-columns: 1fr 22px 120px 22px 42px; align-items: center; gap: 4px; padding: 2px 0; }
.all .row { grid-template-columns: 1fr 22px 140px 22px 42px; font-weight: bold; }
.row label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row input[type=range] { width: 100%; margin: 0; }
.row output { text-align: right; font-variant-numeric: tabular-nums; }
.row output.set { color: #1f4fbf; font-weight: bold; }
.row button, .footer button { font: inherit; padding: 0; height: 20px; border: 1px solid #6b7a99; border-radius: 3px;
  background: linear-gradient(#f3f6fd, #d3dbef); color: #273256; cursor: pointer; }
.row button:hover, .footer button:hover { background: linear-gradient(#e2e9fb, #bccbec); }
.hint { margin: 4px 0 0; color: #667; font-size: 11px; }
.footer { display: flex; justify-content: flex-end; gap: 6px; padding: 6px 10px; border-top: 1px solid #c9d1e6; background: #f3f5fb; }
.footer button { padding: 0 10px; }
`;

// On a 5% grid, so a factor reads as it was set (1.15, not 1.1500000000000001).
const clamp = value => Math.min(MAX, Math.max(MIN, Math.round(value / STEP) / (1 / STEP)));
const percent = value => `${Math.round(value * 100)}%`;
const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The factors the player chose, as saved: `{ all, windows: { name: factor } }`.
 * Anything malformed is dropped rather than trusted.
 */
export function readSaved(saved) {
    const all = Number.isFinite(saved?.all) ? clamp(saved.all) : 1;
    const windows = {};
    if (saved?.windows && typeof saved.windows === 'object') {
        for (const [name, value] of Object.entries(saved.windows)) {
            if (Number.isFinite(value) && clamp(value) !== 1) windows[name] = clamp(value);
        }
    }
    return { all, windows };
}

/**
 * Put the saved factors on the client's windows. A window the client no
 * longer scales is skipped.
 */
export function apply(scale, saved) {
    const names = new Set(scale.windows());
    scale.setGlobal(saved.all);
    for (const [name, value] of Object.entries(saved.windows)) {
        if (names.has(name)) scale.set(name, value);
    }
}

export default function init(parameters, api) {
    if (api?.version !== 1) throw new Error('ui-scale requires client API 1');
    const scale = api.ui?.scale;
    if (!scale?.supported?.() || typeof api.ui.menuButton !== 'function') {
        console.warn('[ui-scale] this app or client cannot scale windows yet');
        return;
    }

    let saved = readSaved(api.preferences.get('scale', null));
    apply(scale, saved);

    const save = () => {
        try {
            api.preferences.set('scale', saved);
        } catch {
            /* storage full or off: the factors last until the game is closed */
        }
    };

    const win = api.ui.window({ id: 'ui-scale', title: 'UI Scale', width: 360, height: 420 });
    const row = (name, label, value) => `
        <div class="row" data-name="${escape(name)}">
            <label for="s-${escape(name)}" title="${escape(label)}">${escape(label)}</label>
            <button type="button" class="less" aria-label="Smaller">−</button>
            <input type="range" id="s-${escape(name)}" min="${MIN}" max="${MAX}" step="${STEP}" value="${value}">
            <button type="button" class="more" aria-label="Larger">+</button>
            <output class="${value !== 1 ? 'set' : ''}">${percent(value)}</output>
        </div>`;

    function render() {
        const names = scale.windows();
        win.body.innerHTML = `<style>${STYLE}</style>
            <div class="scale">
                <div class="all">
                    ${row('*', 'All windows', saved.all)}
                    <p class="hint">Each window below is drawn at this size times its own.</p>
                </div>
                <div class="list">${names.map(name => row(name, LABELS[name] || name, saved.windows[name] ?? 1)).join('')}</div>
                <div class="footer"><button type="button" class="reset">Reset all</button></div>
            </div>`;
    }

    function change(name, value) {
        const factor = clamp(value);
        if (name === '*') {
            saved.all = scale.setGlobal(factor) ?? factor;
        } else {
            const set = scale.set(name, factor) ?? factor;
            if (set === 1) delete saved.windows[name];
            else saved.windows[name] = set;
        }
        save();
        const el = win.body.querySelector(`.row[data-name="${CSS.escape(name)}"]`);
        if (el) {
            const now = name === '*' ? saved.all : saved.windows[name] ?? 1;
            el.querySelector('input').value = now;
            el.querySelector('output').textContent = percent(now);
            el.querySelector('output').classList.toggle('set', now !== 1);
        }
    }

    win.body.addEventListener('input', event => {
        const el = event.target.closest('.row');
        if (el && event.target.type === 'range') change(el.dataset.name, Number(event.target.value));
    });
    win.body.addEventListener('click', event => {
        const el = event.target.closest('.row');
        if (el && event.target.matches('.less, .more')) {
            const now = Number(el.querySelector('input').value);
            change(el.dataset.name, now + (event.target.matches('.more') ? STEP * 2 : -STEP * 2));
        }
        if (event.target.matches('.reset')) {
            saved = { all: 1, windows: {} };
            apply(scale, saved);
            for (const name of scale.windows()) scale.set(name, 1);
            save();
            render();
        }
    });

    render();

    api.ui.menuButton({
        background: 'esc_uiscale_a.bmp',
        hover: 'esc_uiscale_b.bmp',
        down: 'esc_uiscale_c.bmp',
        title: 'UI Scale',
        onClick: () => win.toggle(),
    });
}
