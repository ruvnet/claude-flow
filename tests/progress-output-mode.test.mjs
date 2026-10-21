import { test } from 'vitest';
import assert from 'node:assert/strict';
import { OutputFormatter } from '../v3/@claude-flow/cli-core/src/output.ts';
function capture(run) { const original = process.stdout.write; let output = ''; process.stdout.write = function(text) { output += text; return true; }; try { run(); return output; } finally { process.stdout.write = original; } }
test('progress redraws stay out of redirected output', () => {
 const f = new OutputFormatter({ color: false }); f.supportsInteractiveOutput = () => false; const p = f.createProgress({ total: 2, showETA: false }); assert.equal(capture(() => { p.update(1); p.finish(); }), '');
});
test('quiet mode suppresses transient progress even on a terminal', () => {
 const f = new OutputFormatter({ color: false, verbosity: 'quiet' }); f.supportsInteractiveOutput = () => true; const p = f.createProgress({ total: 2, showETA: false }); assert.equal(capture(() => { p.update(1); p.finish(); }), '');
});
test('interactive progress remains visible', () => {
 const f = new OutputFormatter({ color: false }); f.supportsInteractiveOutput = () => true; const p = f.createProgress({ total: 2, width: 4, showETA: false }); assert.match(capture(() => p.update(1)), /\[##--\] 50.0%/);
});
