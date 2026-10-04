'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

// linkClient stops the asset server (assetServer.prepare) before it rebuilds the
// overlay. Removing a mod, or changing its options, while the game was open left
// the page with no asset server until the next Apply or restart.
test('a mod change rebuilds the overlay and restarts a running asset server', () => {
	const helper = main.match(/async function relinkForMods\(\) \{[\s\S]*?\r?\n\}\r?\n/);
	assert.ok(helper, 'relinkForMods is defined');
	assert.match(helper[0], /const hadAssets = assetServer\.running;/);
	assert.match(helper[0], /finally \{[\s\S]*if \(hadAssets\) await assetsStart\(\);/);
	for (const handler of ['set_mod_settings', 'remove_mod']) {
		const body = main.match(new RegExp(`\\t${handler}: async [\\s\\S]*?\\r?\\n\\t\\},\\r?\\n`));
		assert.ok(body, `${handler} handler found`);
		assert.match(body[0], /await relinkForMods\(\);/, `${handler} goes through relinkForMods`);
	}
	// Outside the helper, nothing rebuilds the mod overlay on its own.
	assert.equal(main.split('linkClient(getClientPaths())').length - 1, 1);
});
