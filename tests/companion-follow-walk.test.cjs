// Guards for a companion's walk to its owner (#290 follow-up).
//
// pop_companion_follow_owner sends a companion more than 4 cells away towards its owner with
// unit_walktobl, throttled to every 400 ms. Between those calls it reports "close enough" as soon as
// the companion is within 4 cells, and the companion tick then stopped any walk that was not a
// formation walk - including the follow itself, while the owner was still moving. The companion
// stopped, snapped in place (USW_FIXPOS) and set off again on the next follow, and a fast one
// (a mounted Lord Knight) caught up often enough for that to read as constant stutter.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'third-party', 'population-engine', 'files', 'src', 'map', 'population_engine.cpp');
const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

// The follow walk used the easy path (unit_walktobl flag 1), which never walks round an obstacle:
// with a wall or a tree in between it did not start, and the companion stood still until the owner
// was far enough away to warp it.
test('the follow walk is a walk to the owner that paths round obstacles', () => {
	const follow = src.slice(src.indexOf('static bool pop_companion_follow_owner'));
	assert.match(follow.slice(0, follow.indexOf('\n}\n')), /unit_walktobl\(sd, owner, 3, 0\);/);
});

test('an idle companion keeps walking to its owner instead of being stopped', () => {
	const idle = /if \(desired_target == 0\) \{\n([\s\S]*?)\n\t\t\}/.exec(src);
	assert.ok(idle, 'the idle branch of the companion tick must exist');
	const stop = /if \(([^{;]*?)\)\s*unit_stop_walking\(sd, USW_FIXPOS\);/.exec(idle[1].replace(/\/\/[^\n]*/g, ''));
	assert.ok(stop, 'the idle branch still stops other walks');
	assert.match(stop[1], /sd->ud\.target_to != owner->id/);
	assert.match(stop[1], /!sd->pop\.companion_formation_active/);
});
