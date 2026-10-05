// The companion window's close button is drawn from basic_interface/sys_close_off.bmp, an
// 11x11 bitmap. The button was 15x15, so the background tiled and a sliver of a second X
// showed to its right and below. It is now the bitmap's size and sits where the stock windows'
// close button does (top 3px, right 2px in a 17px titlebar; Achievement.css .btn-right).
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'patches', 'CompanionPanel.css'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(ROOT, 'patches', 'CompanionPanel.html'), 'utf8').replace(/\r\n/g, '\n');

test('the close button is the size of its bitmap', () => {
	assert.match(html, /class="btn-right close"\s*bg="basic_interface\/sys_close_off\.bmp"/);
	const rule = /#CompanionPanel \.titlebar \.close \{([^}]*)\}/.exec(css);
	assert.ok(rule, 'the close button must have its own rule');
	assert.match(rule[1], /width: 11px;/);
	assert.match(rule[1], /height: 11px;/);
	assert.match(rule[1], /top: 3px;/);
	assert.match(rule[1], /right: 2px;/);
});
