import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CommandParser } from '../v3/@claude-flow/cli/src/parser.ts';

test('flags preserve positionals before and after them', () => {
  const parser = new CommandParser();
  parser.registerCommand({ name: 'memory', description: 'Memory', action() {} });
  for (const args of [['memory', 'key', '--verbose', 'value'], ['memory', 'key', '--format=json']]) {
    const result = parser.parse(args);
    assert.deepEqual(result.flags._, result.positional);
    assert.equal(result.flags._[0], 'key');
  }
});

test('flag values are excluded from positionals', () => {
  const result = new CommandParser().parse(['key', '--config', 'config.json', 'value']);
  assert.deepEqual(result.flags._, ['key', 'value']);
  assert.equal(result.flags.config, 'config.json');
});
