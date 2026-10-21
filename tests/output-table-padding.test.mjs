import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OutputFormatter } from '../v3/@claude-flow/cli-core/src/output.ts';
test('maxWidth accounts for configured padding', () => {
 const f = new OutputFormatter({ color: false });
 for (const padding of [0, 1, 2, 3]) { const table = f.table({ columns: [{ key: 'a', header: 'A' }, { key: 'b', header: 'B' }], data: [{ a: 'a'.repeat(30), b: 'b'.repeat(30) }], padding, maxWidth: 40 }); for (const line of table.split('\n')) assert.ok(line.length <= 40, `padding=${padding} width=${line.length}`); }
});
