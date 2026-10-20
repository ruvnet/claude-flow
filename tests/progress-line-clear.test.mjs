import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OutputFormatter } from '../v3/@claude-flow/cli-core/src/output.ts';
test('colored progress clears the terminal row without padding by ANSI byte length', () => {
 const f = new OutputFormatter({ color: true }); f.supportsInteractiveOutput = () => true; const p = f.createProgress({ total: 2, width: 8, showETA: false });
 const original = process.stdout.write; const writes = []; process.stdout.write = function(value) { writes.push(value); return true; };
 try { p.update(1); p.update(2); } finally { process.stdout.write = original; }
 assert.equal(writes[1], '\r\x1b[2K'); assert.equal(writes.length, 3);
});
