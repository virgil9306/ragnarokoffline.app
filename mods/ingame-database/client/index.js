// An in-game database: items from the client's own tables (api.items), and
// monsters from the server (api.server.request, answered by npc/moddb.txt).
// Everything is drawn in a window of the plugin's own (api.ui.window).

const RACES = ['Formless', 'Undead', 'Brute', 'Plant', 'Insect', 'Fish', 'Demon', 'Demi-Human', 'Angel', 'Dragon'];
const ELEMENTS = ['Neutral', 'Water', 'Earth', 'Fire', 'Wind', 'Poison', 'Holy', 'Shadow', 'Ghost', 'Undead'];
const SIZES = ['Small', 'Medium', 'Large'];

const STYLE = `
.tabs { display: flex; gap: 2px; padding: 6px 6px 0; border-bottom: 1px solid #c9d1e6; background: #f3f5fb; }
.tabs button { border: 1px solid #c9d1e6; border-bottom: none; background: #e6eaf5; padding: 3px 10px; border-radius: 3px 3px 0 0; cursor: pointer; font: inherit; }
.tabs button.on { background: #fff; font-weight: bold; }
.search { display: flex; gap: 4px; padding: 6px; }
.search input { flex: 1; font: inherit; padding: 3px 5px; border: 1px solid #aab4cf; border-radius: 3px; }
.search button { font: inherit; padding: 3px 8px; }
.list { overflow: auto; padding: 0 6px 6px; }
.row { display: flex; align-items: center; gap: 6px; padding: 3px 4px; border-radius: 3px; cursor: pointer; }
.row:hover { background: #eef2fc; }
.row img { width: 24px; height: 24px; image-rendering: pixelated; }
.row small { color: #889; margin-left: auto; }
.detail { padding: 6px 10px 10px; border-top: 1px solid #e3e7f2; white-space: pre-wrap; }
.detail h3 { margin: 0 0 4px; font-size: 13px; }
.stats { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 2px 10px; margin: 4px 0; }
.stats b { color: #556; font-weight: normal; }
.empty { color: #889; padding: 8px; }
.launcher { position: fixed; right: 145px; top: 66px; width: 43px; height: 22px; z-index: 8999; font: bold 11px Tahoma, sans-serif; padding: 0;
  border: 1px solid #6b7a99; border-radius: 4px; background: linear-gradient(#f3f6fd, #d3dbef); color: #273256; cursor: pointer; display: none; }
.launcher.ingame { display: block; }
`;

const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A monster line from npc/moddb.txt, or null for "no such monster". */
export function parseMonster(line) {
    const fields = String(line || '').split('|');
    if (fields.length < 14 || !fields[0]) return null;
    const [id, name, level, hp, baseExp, jobExp, atk, def, mdef, race, element, elementLevel, size, drops] = fields;
    return {
        id: Number(id), name, level: Number(level), hp: Number(hp), baseExp: Number(baseExp), jobExp: Number(jobExp), atk,
        def: Number(def), mdef: Number(mdef), race: RACES[Number(race)] || race, element: `${ELEMENTS[Number(element)] || element} ${elementLevel}`,
        size: SIZES[Number(size)] || size,
        drops: (drops || '').split(',').filter(Boolean).map(pair => { const [item, rate] = pair.split(':').map(Number); return { item, rate }; }),
    };
}

export default function init(parameters, api) {
    if (api?.version !== 1) throw new Error('ingame-database requires client API 1');
    const win = api.ui.window({ id: 'database', title: 'Database', width: 420, height: 460 });
    const body = win.body;
    body.innerHTML = `<style>${STYLE}</style>
        <div class="tabs"><button data-tab="items" class="on">Items</button><button data-tab="monsters">Monsters</button></div>
        <form class="search"><input placeholder="Search items by name or id" autocomplete="off"><button>Find</button></form>
        <div class="list"></div><div class="detail" hidden></div>`;
    const input = body.querySelector('input');
    const list = body.querySelector('.list');
    const detail = body.querySelector('.detail');
    let tab = 'items';

    const icon = async (img, id) => { const url = await api.items.icon(id); if (url) img.src = url; };

    function showItem(id) {
        const item = api.items.get(id);
        if (!item) return;
        detail.hidden = false;
        detail.innerHTML = `<h3>${escape(item.name)} <small>#${item.id}${item.slots ? ` [${item.slots}]` : ''}</small></h3>${escape(item.description)}`;
    }

    async function showMonster(query) {
        detail.hidden = false;
        detail.textContent = 'Asking the server…';
        let monster;
        try {
            monster = parseMonster(await api.server.request('moddb', `mob ${query}`));
        } catch (error) {
            detail.textContent = String(error.message || error);
            return;
        }
        if (!monster) {
            detail.textContent = `No monster called "${query}".`;
            return;
        }
        const drops = monster.drops.map(drop => {
            const item = api.items.get(drop.item);
            return `<div class="row" data-item="${drop.item}"><img data-icon="${drop.item}"><span>${escape(item ? item.name : `#${drop.item}`)}</span><small>${(drop.rate / 100).toFixed(2)}%</small></div>`;
        }).join('');
        detail.innerHTML = `<h3>${escape(monster.name)} <small>#${monster.id}</small></h3>
            <div class="stats"><b>Level</b><span>${monster.level}</span><b>HP</b><span>${monster.hp.toLocaleString()}</span>
            <b>Base exp</b><span>${monster.baseExp.toLocaleString()}</span><b>Job exp</b><span>${monster.jobExp.toLocaleString()}</span>
            <b>Attack</b><span>${escape(monster.atk)}</span><b>Def / Mdef</b><span>${monster.def} / ${monster.mdef}</span>
            <b>Race</b><span>${escape(monster.race)}</span><b>Element</b><span>${escape(monster.element)}</span>
            <b>Size</b><span>${escape(monster.size)}</span></div>
            <div>${drops || '<span class="empty">No drops.</span>'}</div>`;
        detail.querySelectorAll('img[data-icon]').forEach(img => icon(img, Number(img.dataset.icon)));
        detail.querySelectorAll('[data-item]').forEach(row => row.addEventListener('click', () => {
            select('items');
            input.value = row.dataset.item;
            search();
        }));
    }

    function search() {
        const query = input.value.trim();
        detail.hidden = true;
        if (tab === 'monsters') {
            list.innerHTML = '';
            if (query) showMonster(query);
            return;
        }
        const items = api.items.search(query, 60);
        list.innerHTML = items.length
            ? items.map(item => `<div class="row" data-id="${item.id}"><img data-icon="${item.id}"><span>${escape(item.name)}</span><small>#${item.id}</small></div>`).join('')
            : (query ? '<div class="empty">Nothing found.</div>' : '');
        list.querySelectorAll('img[data-icon]').forEach(img => icon(img, Number(img.dataset.icon)));
        list.querySelectorAll('[data-id]').forEach(row => row.addEventListener('click', () => showItem(Number(row.dataset.id))));
    }

    function select(name) {
        tab = name;
        body.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
        input.placeholder = name === 'items' ? 'Search items by name or id' : 'A monster name or id, e.g. Poring or 1002';
        list.innerHTML = '';
        detail.hidden = true;
    }

    body.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { select(b.dataset.tab); input.focus(); }));
    body.querySelector('form').addEventListener('submit', event => { event.preventDefault(); search(); });

    // Only in game: not on the login and character screens, where there is nothing to
    // look things up for and the button sat on top of their windows.
    let inGame = false;
    let launcher = null;
    const setInGame = value => {
        inGame = value;
        launcher?.classList.toggle('ingame', value);
        if (!value && win.isOpen()) win.hide();
    };
    api.on('map:enter', () => setInGame(true), { replay: true });
    api.on('map:leave', () => setInGame(false));

    // Open with Alt+D, or the button.
    const onKey = event => { if (inGame && event.altKey && event.code === 'KeyD') { event.preventDefault(); win.toggle(); if (win.isOpen()) input.focus(); } };
    addEventListener('keydown', onKey, true);
    api.cleanup(() => removeEventListener('keydown', onKey, true));
    if (parameters?.show_button !== false) {
        const host = document.createElement('div');
        const root = host.attachShadow({ mode: 'open' });
        // Under the Cash Shop button by the minimap (right: 145px, top: 17px, 43x45 in the
        // client's CashShopIcon.css), anchored to the same edge so it stays beside it.
        root.innerHTML = `<style>${STYLE}</style><button class="launcher${inGame ? ' ingame' : ''}" title="Database (Alt+D)">DB</button>`;
        launcher = root.querySelector('button');
        // The map is under the button: a press here must not walk the character there.
        launcher.addEventListener('mousedown', event => event.stopImmediatePropagation());
        launcher.addEventListener('click', () => { win.toggle(); if (win.isOpen()) input.focus(); });
        document.body.appendChild(host);
        api.cleanup(() => host.remove());
    }
}
