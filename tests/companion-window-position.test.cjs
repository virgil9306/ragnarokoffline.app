// The companion window remembers where the player left it (#290 follow-up).
//
// Closing the window (its X or the toggle) only hides it, and reopening goes through
// GUIComponent.append(), which always runs onAppend - and onAppend places the window from the
// saved preference. The position was saved only in onRemove (a map change or logout), so a
// window moved and then closed came back wherever it had been before the move.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const js = fs.readFileSync(path.join(__dirname, '..', 'patches', 'CompanionPanel.js'), 'utf8')
	.replace(/\r\n/g, '\n');

function body(name) {
	const start = js.indexOf(name);
	assert.ok(start >= 0, `${name} must exist`);
	return js.slice(start, js.indexOf('\n}', start));
}

test('every way of closing the window saves its position first', () => {
	const hide = body('function _hidePanel()');
	assert.ok(hide.indexOf('_savePosition();') >= 0 &&
		hide.indexOf('_savePosition();') < hide.indexOf("style.display = 'none'"),
		'_hidePanel saves before it hides');
	// _hidePanel is the only place that hides the host.
	assert.equal([...js.matchAll(/_host\.style\.display = 'none'/g)].length, 1);
	assert.match(js, /\.titlebar \.close'\)\.addEventListener\('click', \(\) => \{\s*_hidePanel\(\);/);
	assert.match(body('CompanionPanel.toggle = function toggle()'), /\} else \{\s*_hidePanel\(\);/);
	assert.match(body('CompanionPanel.onRemove = function onRemove()'), /_savePosition\(\);/);
});

test('a hidden window does not overwrite its saved position with 0,0', () => {
	const save = body('function _savePosition()');
	const guard = save.indexOf("style.display === 'none'");
	assert.ok(guard >= 0 && guard < save.indexOf('= CompanionPanel._host.offsetLeft;'),
		'a hidden host reports offsetLeft/Top as 0, so the save must skip it');
});
