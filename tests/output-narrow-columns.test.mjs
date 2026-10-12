import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OutputFormatter } from '../v3/@claude-flow/cli-core/src/output.ts';
test('one to three character columns never overflow their border', () => {
 const f = new OutputFormatter({ color: false });
 for (const width of [1, 2, 3, 4]) {
  const lines = f.table({ columns: [{ key: 'value', header: 'Header', width }], data: [{ value: 'Longer content' }] }).split('\n');
  for (const line of lines) assert.equal(line.length, lines[0].length);
  assert.equal(lines[0].length, width + 4);
 }
});
