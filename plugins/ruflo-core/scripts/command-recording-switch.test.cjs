'use strict';
/**
 * #4056: the PostToolUse Bash shim stands down when command recording is off.
 * Pure-function test of the switch (RUFLO_HOOK_UNIT_TEST keeps main() from
 * running on require).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.RUFLO_HOOK_UNIT_TEST = '1';
const { commandRecordingOff } = require('./ruflo-hook.cjs');

test('recording is on by default', () => {
  assert.equal(commandRecordingOff({}), false);
});

test('CLAUDE_FLOW_HOOKS_RECORD_COMMANDS 0/false/off/no turns it off', () => {
  for (const v of ['0', 'false', 'off', 'no', 'FALSE', ' Off ']) {
    assert.equal(commandRecordingOff({ CLAUDE_FLOW_HOOKS_RECORD_COMMANDS: v }), true, v);
  }
});

test('CLAUDE_FLOW_HOOKS_ENABLED=false turns it off', () => {
  assert.equal(commandRecordingOff({ CLAUDE_FLOW_HOOKS_ENABLED: 'false' }), true);
  assert.equal(commandRecordingOff({ CLAUDE_FLOW_HOOKS_ENABLED: 'true' }), false);
});

test('other values leave it on', () => {
  for (const v of ['1', 'true', 'on', '']) {
    assert.equal(commandRecordingOff({ CLAUDE_FLOW_HOOKS_RECORD_COMMANDS: v }), false, v);
  }
});
