import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CommandParser } from '../v3/@claude-flow/cli/src/parser.ts';
const option = (value) => ({ name: 'format', description: 'Format', type: 'string', default: value });
const parser = () => { const p = new CommandParser(); p.registerCommand({ name: 'root', description: '', options: [option('root')], subcommands: [{ name: 'child', description: '', options: [option('child')], subcommands: [{ name: 'nested', description: '', options: [option('nested')], subcommands: [{ name: 'deep', description: '', options: [option('deep')] }] }] }] }); return p; };
test('nested and deep defaults take precedence over parent defaults', () => {
 assert.equal(parser().parse(['root', 'child', 'nested']).flags.format, 'nested');
 assert.equal(parser().parse(['root', 'child', 'nested', 'deep']).flags.format, 'deep');
});
test('explicit values still override defaults', () => {
 assert.equal(parser().parse(['root', 'child', 'nested', 'deep', '--format=json']).flags.format, 'json');
});
