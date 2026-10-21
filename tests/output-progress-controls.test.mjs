import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OutputFormatter } from '../v3/@claude-flow/cli-core/src/output.ts';
test('zero-item work has a finite completed progress bar', () => {
 const f = new OutputFormatter({ color: false }); assert.equal(f.progressBar(0, 0, 4), '[####] 100.0%');
});
test('showPercentage false suppresses the percentage suffix', () => {
 const f = new OutputFormatter({ color: false }); f.supportsInteractiveOutput = () => true; const progress = f.createProgress({ total: 2, current: 1, width: 4, showPercentage: false, showETA: false });
 const original = process.stdout.write; let captured = ''; process.stdout.write = function(value) { captured += value; return true; };
 try { progress.render(); } finally { process.stdout.write = original; } assert.equal(captured, '[##--]');
});
test('default percentage output remains unchanged', () => { assert.equal(new OutputFormatter({ color: false }).progressBar(1, 2, 4), '[##--] 50.0%'); });
