/**
 * #4283: in one-shot CLI mode a successful trajectory bumped
 * `patternsLearned` in `.claude-flow/neural/stats.json` but never wrote the
 * pattern to `patterns.json`. `recordTrajectory()` saves the stats
 * synchronously, while the ReasoningBank save is debounced by 100 ms, and the
 * bins call `process.exit(0)` as soon as the command resolves, so the timer
 * never fired and the pattern was lost.
 *
 * The worker below does what `bin/cli.js` does after a one-shot command:
 * record a trajectory, then exit straight away.
 */
import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'intelligence-4283-'));
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(packageRoot, '..');
const compiled = join(scratch, 'compiled');
mkdirSync(compiled);
writeFileSync(join(compiled, 'package.json'), '{"type":"module"}');
const sources = [
  'cli/src/memory/intelligence.ts', 'cli/src/memory/stats-file-lock.ts',
  'cli/src/ruvector/lora-adapter.ts', 'cli/src/mcp-tools/types.ts', 'cli-core/src/mcp-tools/types.ts',
];
for (const source of sources) {
  const output = join(compiled, source.replace(/\.ts$/, '.js'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, ts.transpileModule(readFileSync(join(sourceRoot, source), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText);
}
// Route the real cli-core module to its transpiled source, without a built workspace.
const corePackage = join(compiled, 'node_modules/@claude-flow/cli-core');
mkdirSync(corePackage, { recursive: true });
writeFileSync(join(corePackage, 'package.json'), JSON.stringify({
  type: 'module', exports: { './mcp-tools/types': './types.js' },
}));
writeFileSync(join(corePackage, 'types.js'), readFileSync(join(compiled, 'cli-core/src/mcp-tools/types.js')));
const worker = join(compiled, 'worker.mjs');
writeFileSync(worker, `
import * as intel from './cli/src/memory/intelligence.js';
const steps = [{ type: 'action', content: 'edit src/app.ts #4283',
  embedding: Array.from({ length: 384 }, (_, i) => Math.sin(i + 1)) }];
const recorded = await intel.recordTrajectory(steps, 'success');
console.log(JSON.stringify({ recorded }));
process.exit(0); // what bin/cli.js and bin/ruflo.js do after a one-shot command
`);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('#4283 a one-shot recordTrajectory persists the pattern it counts', () => {
  it('writes patterns.json before the process exits', () => {
    const root = join(scratch, 'project');
    mkdirSync(join(root, '.claude-flow'), { recursive: true });
    const run = spawnSync(process.execPath, [worker], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, CLAUDE_FLOW_CWD: root },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout.trim().split('\n').pop()!)).toEqual({ recorded: true });

    const neural = join(root, '.claude-flow/neural');
    const stats = JSON.parse(readFileSync(join(neural, 'stats.json'), 'utf8'));
    expect(stats.patternsLearned).toBe(1);
    expect(existsSync(join(neural, 'patterns.json'))).toBe(true);
    const patterns = JSON.parse(readFileSync(join(neural, 'patterns.json'), 'utf8'));
    expect(patterns.map((p: { content: string }) => p.content)).toContain('edit src/app.ts #4283');
  });
});
