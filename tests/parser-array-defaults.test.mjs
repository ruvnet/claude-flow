import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CommandParser } from '../v3/@claude-flow/cli/src/parser.ts';
test('command array defaults are independent across parses', () => {
 const defaults = ['base']; const p = new CommandParser(); p.registerCommand({ name: 'root', description: '', options: [{ name: 'models', description: '', type: 'array', default: defaults }] });
 p.parse(['root']).flags.models.push('injected'); assert.deepEqual(p.parse(['root']).flags.models, ['base']); assert.deepEqual(defaults, ['base']);
});
test('custom array defaults are independent across parses', () => {
 const defaults = ['base']; const p = new CommandParser({ defaults: { models: defaults } }); p.parse([]).flags.models.push('injected'); assert.deepEqual(p.parse([]).flags.models, ['base']); assert.deepEqual(defaults, ['base']);
});
