import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseConfigValue } from '../v3/@claude-flow/cli/src/services/config-file-manager.ts';
test('numeric configuration values preserve JSON number semantics', () => {
 for (const value of ['-1', '-0.5', '1e3', '1E-3', ' 42 ']) assert.equal(parseConfigValue(value), JSON.parse(value));
});
test('non-numeric strings and existing structured scalars retain their semantics', () => {
 for (const value of ['auto', 'Infinity', 'NaN', 'host']) assert.equal(parseConfigValue(value), value);
 assert.deepEqual(parseConfigValue('[1,2]'), [1,2]); assert.equal(parseConfigValue('false'), false); assert.equal(parseConfigValue('123'), 123);
});
