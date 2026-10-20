import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CommandParser } from '../v3/@claude-flow/cli/src/parser.ts';
const command = { name: 'build', description: '', options: [{ name: 'models', short: 'm', description: '', type: 'array' }] };
test('declared array options produce arrays across long, short and repeated forms', () => {
 const p = new CommandParser(); p.registerCommand(command);
 for (const args of [['build', '--models', 'model-a'], ['build', '-m', 'model-a'], ['build', '--models=model-a']]) assert.equal(p.parse(args).flags.models.join(', '), 'model-a');
 assert.deepEqual(p.parse(['build', '--models=007', '-m', 'false']).flags.models, ['007', 'false']);
});
test('custom array flags preserve text and accumulate values', () => {
 const p = new CommandParser({ arrayFlags: ['model-ids'] }); assert.deepEqual(p.parse(['--model-ids=007', '--model-ids=true']).flags.modelIds, ['007', 'true']);
});
test('array options without a value are rejected', () => {
 const p = new CommandParser(); p.registerCommand(command); assert.match(p.validateFlags(p.parse(['build', '--models']).flags, command).join(' '), /needs a value/);
});
