import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CommandParser } from '../v3/@claude-flow/cli/src/parser.ts';
const parser = () => { const p = new CommandParser(); p.registerCommand({ name: 'memory', description: 'Memory', action() {} }); return p; };
test('unknown command slot is not replaced by later command names', () => {
 const result = parser().parse(['unknown', 'memory']);
 assert.deepEqual(result.command, []);
 assert.deepEqual(result.positional, ['unknown', 'memory']);
});
test('end-of-options arguments remain literal positionals', () => {
 const result = parser().parse(['--', 'memory']);
 assert.deepEqual(result.command, []);
 assert.deepEqual(result.positional, ['memory']);
});
test('leading flag values do not occupy the command slot', () => {
 const result = parser().parse(['--config', 'memory', 'memory']);
 assert.deepEqual(result.command, ['memory']);
 assert.equal(result.flags.config, 'memory');
});
