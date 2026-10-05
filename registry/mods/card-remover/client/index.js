// The Card Remover window. The NPC (npc/card_remover.txt) opens it with
// "@@event cardremover open" when the player picks "Remove a card"; everything
// it shows and does goes through api.server.request('cardremover', ...), which
// the same script answers. The server checks every removal again: this window
// only proposes one.

const TIERS = ['Normal', 'Miniboss', 'MVP'];

const STYLE = `
:host, .wrap { font: 12px Tahoma, sans-serif; color: #273256; }
.wrap { display: flex; flex-direction: column; height: 100%; }
section { padding: 6px 8px; border-bottom: 1px solid #e3e7f2; }
section.grow { flex: 1; overflow: auto; }
h4 { margin: 0 0 4px; font-size: 12px; display: flex; gap: 6px; }
h4 small { margin-left: auto; font-weight: normal; color: #889; }
.note { color: #889; font-size: 11px; }
.item { margin-bottom: 6px; }
.item > div:first-child { display: flex; align-items: center; gap: 6px; font-weight: bold; }
.slots { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0 30px; }
.row { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 3px; border: 1px solid transparent; }
.row img, .item img { width: 24px; height: 24px; image-rendering: pixelated; }
.pick { cursor: pointer; }
.pick:hover { background: #eef2fc; }
.picked { background: #dfe7fb; border-color: #8ea2d8; }
.empty { color: #aaa; font-style: italic; }
.tier { font-size: 10px; padding: 0 4px; border-radius: 3px; background: #e9edf6; color: #556; white-space: nowrap; }
.tier.t1 { background: #fdf0d5; color: #8a5a00; }
.tier.t2 { background: #fbe0e0; color: #a12a2a; }
.right { margin-left: auto; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.right small { color: #889; }
input[type=number] { width: 42px; font: inherit; padding: 1px 3px; }
button { font: inherit; padding: 2px 8px; cursor: pointer; }
button.step { padding: 0 5px; }
.total { font-weight: bold; }
.enough { color: #2a7a2a; }
.short { color: #a33; }
.error { color: #a33; }
.done { color: #2a7a2a; }
.confirm { background: #fff8e6; border-top: 1px solid #f0d9a0; }
.line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
`;

const escape = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tierTag = tier => `<span class="tier t${tier}">${TIERS[tier] || TIERS[0]}</span>`;

/**
 * An answer from npc/card_remover.txt: { error } for a refusal, the state for
 * "ok", or null for something else.
 */
export function parseAnswer(line) {
    const text = String(line || '');
    if (text.startsWith('err|')) return { error: text.slice(4) };
    const fields = text.split('|');
    if (fields[0] !== 'ok' || fields.length < 5) return null;
    const numbers = field => field.split(',').map(Number);
    return {
        cost: numbers(fields[1]),
        points: numbers(fields[2]),
        equipment: fields[3].split(';').filter(Boolean).map(entry => {
            const [slot, item, refine, cards] = entry.split(':');
            return {
                slot: Number(slot), item: Number(item), refine: Number(refine),
                cards: (cards || '').split(',').map(card => {
                    const [id, tier] = card.split('.').map(Number);
                    return { id, tier };
                }),
            };
        }),
        cards: fields[4].split(',').filter(Boolean).map(entry => {
            const [id, amount, tier] = entry.split('.').map(Number);
            return { id, amount, tier };
        }),
    };
}

/** Points the offered cards are worth: offer is a Map of card id -> amount. */
export function offeredPoints(state, offer) {
    let total = 0;
    for (const card of state.cards) total += (offer.get(card.id) || 0) * (state.points[card.tier] || 0);
    return total;
}

/** The request text for a removal, or null if it would not fit in one request. */
export function removeRequest(target, offer) {
    const payment = [...offer].filter(([, amount]) => amount > 0).map(([id, amount]) => `${id}.${amount}`).join(',');
    const text = `remove ${target.slot} ${target.index} ${target.card} ${payment}`;
    return text.length <= 200 ? text : null;
}

export default function init(parameters, api) {
    if (api?.version !== 1) throw new Error('card-remover requires client API 1');
    const win = api.ui.window({ id: 'card-remover', title: 'Card Remover', width: 400, height: 560 });
    const body = win.body;
    body.innerHTML = `<style>${STYLE}</style><div class="wrap">
        <section><div class="note" data-prices></div></section>
        <section class="grow" data-equipment-section>
            <h4>1. Choose a card to remove</h4>
            <div data-equipment></div>
        </section>
        <section class="grow">
            <h4>2. Pay with cards <small data-total></small></h4>
            <div data-cards></div>
        </section>
        <section class="confirm" data-confirm hidden>
            <div data-confirm-text></div>
            <div class="line" style="margin-top:4px"><button data-yes>Yes, remove it</button><button data-back>Back</button></div>
        </section>
        <section class="line">
            <button data-remove disabled>Remove card</button>
            <span data-message></span>
        </section>
    </div>`;
    // A click in the window must not reach the map behind it, which walks the
    // character.
    const frame = body.getRootNode().host || body;
    const swallow = event => event.stopPropagation();
    frame.addEventListener('mousedown', swallow);
    api.cleanup(() => frame.removeEventListener('mousedown', swallow));

    const $ = selector => body.querySelector(selector);
    const message = $('[data-message]'), removeButton = $('[data-remove]'), confirmBox = $('[data-confirm]');
    let state = null;
    let target = null;        // { slot, index, card, tier }
    let offer = new Map();    // card id -> amount
    let busy = false;

    const icon = async (img, id) => { const url = await api.items.icon(id); if (url) img.src = url; };
    const icons = root => root.querySelectorAll('img[data-icon]').forEach(img => icon(img, Number(img.dataset.icon)));
    const itemName = id => api.items.get(id)?.name || `#${id}`;
    const say = (text, kind = 'error') => { message.className = kind; message.textContent = text; };

    async function ask(text) {
        busy = true;
        removeButton.disabled = true;
        try {
            const answer = parseAnswer(await api.server.request('cardremover', text));
            if (!answer) throw new Error('the server sent an answer this window does not understand');
            if (answer.error) { say(answer.error); return false; }
            state = answer;
            return true;
        } catch (error) {
            say(String(error.message || error));
            return false;
        } finally {
            busy = false;
            render();
        }
    }

    function cost() { return target && state ? state.cost[target.tier] || 0 : 0; }

    function render() {
        if (!state) return;
        const [cn, cmini, cmvp] = state.cost, [pn, pmini, pmvp] = state.points;
        $('[data-prices]').innerHTML = `Removing costs <b>${cn}</b> / <b>${cmini}</b> / <b>${cmvp}</b> points for a normal / miniboss / MVP card.
            Each card you pay with is worth <b>${pn}</b> / <b>${pmini}</b> / <b>${pmvp}</b>. Extra points are not given back.`;

        // Drop a pick that no longer exists (removed, unequipped, used up).
        if (target && !state.equipment.some(item => item.slot === target.slot && item.cards[target.index]?.id === target.card)) target = null;
        for (const id of [...offer.keys()]) {
            const owned = state.cards.find(card => card.id === id)?.amount || 0;
            if (owned <= 0) offer.delete(id); else offer.set(id, Math.min(offer.get(id), owned));
        }

        const equipment = $('[data-equipment]');
        equipment.innerHTML = state.equipment.length ? state.equipment.map(item => `<div class="item">
                <div><img data-icon="${item.item}"><span>${item.refine ? `+${item.refine} ` : ''}${escape(itemName(item.item))}</span></div>
                <div class="slots">${item.cards.map((card, index) => card.id
                    ? `<div class="row pick${target && target.slot === item.slot && target.index === index ? ' picked' : ''}" data-slot="${item.slot}" data-index="${index}" data-card="${card.id}" data-tier="${card.tier}">
                        <img data-icon="${card.id}"><span>${escape(itemName(card.id))}</span>${tierTag(card.tier)}
                        <span class="right"><small>${state.cost[card.tier]} pts</small></span></div>`
                    : '<div class="row empty">empty slot</div>').join('')}</div>
            </div>`).join('')
            : '<div class="empty">You are not wearing anything with a card in it.</div>';
        icons(equipment);
        equipment.querySelectorAll('[data-card]').forEach(row => row.addEventListener('click', () => {
            const { slot, index, card, tier } = row.dataset;
            target = { slot: Number(slot), index: Number(index), card: Number(card), tier: Number(tier) };
            hideConfirm();
            say('');
            render();
        }));

        const cards = $('[data-cards]');
        cards.innerHTML = state.cards.length ? state.cards.map(card => `<div class="row">
                <img data-icon="${card.id}"><span>${escape(itemName(card.id))}</span>${tierTag(card.tier)}
                <span class="right"><small>×${card.amount}</small>
                    <button class="step" data-less="${card.id}">−</button>
                    <input type="number" min="0" max="${card.amount}" value="${offer.get(card.id) || 0}" data-amount="${card.id}">
                    <button class="step" data-more="${card.id}">+</button></span>
            </div>`).join('')
            : '<div class="empty">You have no cards to pay with.</div>';
        icons(cards);
        const setAmount = (id, amount) => {
            const owned = state.cards.find(card => card.id === id)?.amount || 0;
            const value = Math.max(0, Math.min(owned, Math.floor(Number(amount) || 0)));
            if (value) offer.set(id, value); else offer.delete(id);
            hideConfirm();
            render();
        };
        cards.querySelectorAll('[data-less]').forEach(b => b.addEventListener('click', () => setAmount(Number(b.dataset.less), (offer.get(Number(b.dataset.less)) || 0) - 1)));
        cards.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => setAmount(Number(b.dataset.more), (offer.get(Number(b.dataset.more)) || 0) + 1)));
        cards.querySelectorAll('[data-amount]').forEach(input => input.addEventListener('change', () => setAmount(Number(input.dataset.amount), input.value)));

        const total = offeredPoints(state, offer);
        const needed = cost();
        $('[data-total]').innerHTML = target
            ? `<span class="total ${total >= needed ? 'enough' : 'short'}">${total} / ${needed} points</span>`
            : `<span class="total">${total} points</span>`;
        removeButton.disabled = busy || !target || total < needed;
    }

    function hideConfirm() { confirmBox.hidden = true; }

    // Ask before paying with an MVP card or more points than the removal costs.
    function warnings() {
        const notes = [];
        const mvp = state.cards.filter(card => card.tier === 2 && offer.get(card.id));
        if (mvp.length) notes.push(`You are paying with MVP cards: ${mvp.map(card => escape(itemName(card.id))).join(', ')}.`);
        const extra = offeredPoints(state, offer) - cost();
        if (extra > 0) notes.push(`That is ${extra} points more than this removal costs, and the rest is not given back.`);
        return notes;
    }

    async function remove() {
        const text = removeRequest(target, offer);
        if (!text) { say('Too many different cards in one payment. Pay with fewer kinds.'); return; }
        hideConfirm();
        const name = itemName(target.card);
        say('Removing…', 'note');
        if (await ask(text)) {
            offer = new Map();
            target = null;
            render();
            say(`${name} is back in your inventory.`, 'done');
        }
    }

    removeButton.addEventListener('click', () => {
        if (!state || !target) return;
        const notes = warnings();
        if (!notes.length) { remove(); return; }
        $('[data-confirm-text]').innerHTML = notes.join('<br>') + '<br>Remove the card anyway?';
        confirmBox.hidden = false;
    });
    $('[data-yes]').addEventListener('click', remove);
    $('[data-back]').addEventListener('click', hideConfirm);

    function open() {
        target = null;
        offer = new Map();
        hideConfirm();
        say('');
        win.show();
        ask('get');
    }

    api.on('server:event', ({ command, text }) => { if (command === 'cardremover' && text === 'open') open(); });
    api.on('map:leave', () => { if (win.isOpen()) win.hide(); }, { replay: false });
}
