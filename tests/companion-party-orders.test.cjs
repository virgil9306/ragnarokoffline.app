// Party chat is the companions' command channel: the panel's stance, Taunt and Recall buttons
// all send a plain word there. These guards pin that each message is read once, and that
// every order in it is reached.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const MOD = path.join(ROOT, 'third-party', 'population-engine');
const engine = fs.readFileSync(path.join(MOD, 'files', 'src', 'map', 'population_engine.cpp'), 'utf8')
	.replace(/\r\n/g, '\n');

function functionBody(signature) {
	const i = engine.lastIndexOf(signature);
	assert.ok(i >= 0, `expected to find ${signature}`);
	const rest = engine.slice(i);
	const end = rest.indexOf('\n}\n');
	return end > 0 ? rest.slice(0, end + 3) : rest;
}

test('a message that sets no role still reaches the orders after it', () => {
	const body = functionBody('void population_engine_on_party_chat(');
	const roles = body.indexOf('std::set<PopulationRoleType> requested_roles;');
	const orders = body.indexOf('// --- Orders ---');
	assert.ok(roles > 0 && orders > roles, 'roles are read before the orders');
	// "taunt" and "recall" carry no role word. A return here is what made both buttons silent.
	assert.ok(!/\breturn;/.test(body.slice(roles, orders).replace(/\/\/.*$/gm, '')),
		'nothing between the role words and the orders may end the handler');
	assert.match(body.slice(orders), /has_token\(tokens, "taunt"\)/);
	assert.match(body.slice(orders), /has_token\(tokens, "recall"\)/);
});

test('each party message reaches the companion handler once, without the sender\'s name', () => {
	const patches = fs.readdirSync(path.join(MOD, 'patches')).filter(f => f.endsWith('.patch')).sort()
		.map(f => fs.readFileSync(path.join(MOD, 'patches', f), 'utf8')).join('\n');
	// party_send_message gets "<name> : <text>", so its words include the sender's name: a
	// player called "Tank" would set roles by talking. It also doubled every stance reply.
	assert.ok(!/^\+.*population_engine_on_party_chat\(/m.test(patches),
		'no patch may add a second call; clif_parse_PartyMessage has the one');
	const hook = fs.readFileSync(path.join(ROOT, 'scripts', 'apply-party-chat-hook.py'), 'utf8');
	assert.match(hook, /population_engine_on_party_chat\(sd, message\);/,
		'the one call passes the text the player typed, without their name');
});

test('a companion is moved with a map index, never a map id', () => {
	// pc_setpos takes a map INDEX. Given sd->m (the map's id) the move failed with
	// SETPOS_MAPINDEX or named another map: Recall answered "recalled 0" from any distance.
	const calls = engine.match(/pc_setpos\([^;]*;/g) || [];
	assert.ok(calls.length > 0);
	for (const call of calls) {
		const map = call.slice('pc_setpos('.length).split(',')[1].trim();
		assert.ok(!/(^|->)m$|^map_id$/.test(map), `pc_setpos must not be given a map id: ${call}`);
	}
});

test('a knight-line tank raises Auto Counter on a hit, not whenever it is down', () => {
	// Auto Counter roots the caster and lasts moments. Kept up on not_self_status it was cast
	// every turn, so a taunting tank stood still re-casting it instead of fighting.
	const skills = fs.readFileSync(path.join(MOD, 'files', 'db', 'population_skill_db.yml'), 'utf8');
	const entries = skills.split('\n').filter(l => /SkillId: KN_AUTOCOUNTER/.test(l));
	assert.ok(entries.length > 0);
	for (const e of entries)
		assert.ok(!/not_self_status/.test(e), `Auto Counter must not be kept up: ${e.trim()}`);
});
