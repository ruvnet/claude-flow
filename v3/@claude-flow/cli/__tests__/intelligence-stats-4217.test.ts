import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scratch = mkdtempSync(join(tmpdir(), 'intelligence-4217-'));
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(packageRoot, '..');
const compiled = join(scratch, 'compiled');
const node = process.env.LEARNING_STATS_TEST_NODE || process.execPath;
mkdirSync(compiled);
writeFileSync(join(compiled, 'package.json'), '{"type":"module"}');
const sources = [
  'cli/src/memory/intelligence.ts', 'cli/src/ruvector/lora-adapter.ts',
  'cli/src/mcp-tools/types.ts', 'cli-core/src/mcp-tools/types.ts',
];
if (existsSync(join(packageRoot, 'src/memory/stats-file-lock.ts'))) sources.push('cli/src/memory/stats-file-lock.ts');
for (const source of sources) {
  const input = join(sourceRoot, source);
  const output = join(compiled, source.replace(/\.ts$/, '.js'));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, ts.transpileModule(readFileSync(input, 'utf8'), {
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
import * as fs from 'node:fs';
import { join } from 'node:path';
const [mode, root, id = '0'] = process.argv.slice(2);
const stats = join(root, '.claude-flow/neural/stats.json');
const pause = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
if (mode === 'owner') {
  const { withStatsFileLock } = await import('./cli/src/memory/stats-file-lock.js');
  withStatsFileLock(stats, () => {
    fs.writeFileSync(join(root, 'owned'), '');
    while (!fs.existsSync(join(root, 'release'))) pause();
  });
} else if (mode === 'hot') {
  fs.writeFileSync(join(root, id + '.ready'), '');
  while (!fs.existsSync(join(root, 'start'))) pause();
  for (let i = 0; i < 200; i++) { intel.recordSignalProcessed(); intel.flushIntelligenceStats(); }
  fs.writeFileSync(join(root, id + '.done'), '');
  while (!fs.existsSync(join(root, id + '.drain'))) pause();
  intel.flushIntelligenceStats();
} else if (mode === 'retry') {
  intel.recordSignalProcessed(); intel.flushIntelligenceStats();
  fs.writeFileSync(join(root, 'failed'), fs.readFileSync(stats));
  fs.rmdirSync(stats + '.lock');
  intel.flushIntelligenceStats(); intel.flushIntelligenceStats();
} else if (mode === 'malformed') {
  intel.recordSignalProcessed(); intel.getIntelligenceStats(); intel.flushIntelligenceStats();
  fs.writeFileSync(join(root, 'failed'), fs.readFileSync(stats));
  fs.writeFileSync(stats, '{"signalsProcessed":10,"lastAdaptation":123}');
  intel.flushIntelligenceStats(); intel.flushIntelligenceStats();
} else if (mode === 'write-fail') {
  intel.recordSignalProcessed();
  fs.mkdirSync(stats + '.' + process.pid + '.tmp');
  intel.flushIntelligenceStats();
  fs.writeFileSync(join(root, 'failed'), fs.readFileSync(stats));
  fs.rmdirSync(stats + '.' + process.pid + '.tmp');
  intel.flushIntelligenceStats(); intel.flushIntelligenceStats();
} else if (mode === 'overflow') {
  intel.recordSignalProcessed(); intel.flushIntelligenceStats();
} else {
  intel.recordSignalProcessed(); intel.getIntelligenceStats();
  intel.flushIntelligenceStats(); intel.flushIntelligenceStats();
}
`);
function project(name: string, initial?: string) {
  const root = join(scratch, name);
  mkdirSync(join(root, '.claude-flow/neural'), { recursive: true });
  if (initial !== undefined) writeFileSync(statsPath(root), initial);
  return root;
}
function statsPath(root: string) { return join(root, '.claude-flow/neural/stats.json'); }
function run(mode: string, root: string) {
  return spawnSync(node, [worker, mode, root], {
    env: { ...process.env, CLAUDE_FLOW_CWD: root }, encoding: 'utf8', timeout: 10000,
  });
}
function read(root: string) { return JSON.parse(readFileSync(statsPath(root), 'utf8')); }
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('worker barrier timed out');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function childExit(child: ReturnType<typeof spawn>) {
  let stderr = '';
  child.stderr?.on('data', data => { stderr += data; });
  let forced: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    forced = setTimeout(() => child.kill('SIGKILL'), 50);
  }, 12000);
  const ended = new Promise<void>((resolve, reject) => {
    const clear = () => { clearTimeout(timer); if (forced) clearTimeout(forced); };
    child.once('error', error => { clear(); reject(error); });
    child.once('exit', code => {
      clear();
      if (timedOut) reject(new Error('worker exit deadline exceeded'));
      else if (code === 0) resolve();
      else reject(new Error(stderr || `worker exited: ${code}`));
    });
  });
  // A child can fail while another child's barrier is being awaited.
  void ended.catch(() => {});
  return ended;
}
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
describe('cooperating process learning stats transactions (#4217)', () => {
  it('retains every hot-phase increment after a coordinated final drain', async () => {
    const root = project('concurrent');
    const children = Array.from({ length: 8 }, (_, i) => {
      const child = spawn(node, [worker, 'hot', root, String(i)], {
        env: { ...process.env, CLAUDE_FLOW_CWD: root }, stdio: ['ignore', 'ignore', 'pipe'],
      });
      const ended = childExit(child);
      return { child, ended };
    });
    try {
      await until(() => children.every((_, i) => existsSync(join(root, i + '.ready'))));
      writeFileSync(join(root, 'start'), '');
      await until(() => children.every((_, i) => existsSync(join(root, i + '.done'))));
      for (let i = 0; i < children.length; i++) {
        writeFileSync(join(root, i + '.drain'), '');
        await children[i].ended;
      }
      expect(read(root).signalsProcessed).toBe(1600);
    } finally {
      for (const { child } of children) if (child.exitCode === null) child.kill();
      await Promise.allSettled(children.map(child => child.ended));
    }
  }, 30000);
  it('refuses an old held lock and retries pending increments exactly once', () => {
    const initial = '{"signalsProcessed":10}';
    const root = project('held', initial);
    mkdirSync(statsPath(root) + '.lock');
    utimesSync(statsPath(root) + '.lock', new Date(0), new Date(0));
    const result = run('retry', root);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'failed'), 'utf8')).toBe(initial);
    expect(result.stderr).toContain('Could not persist learning stats');
    expect(read(root).signalsProcessed).toBe(11);
  });
  it('preserves malformed JSON, arrays and invalid counter bytes', () => {
    const invalidFiles = [
      '{', '[]', '{"signalsProcessed":"secret"}', '{"signalsProcessed":-1}',
      '{"signalsProcessed":null}', '{"signalsProcessed":0.5}',
      '{"signalsProcessed":9007199254740992}', '{"lastAdaptation":"secret"}',
    ];
    for (const [i, bytes] of invalidFiles.entries()) {
      const root = project('invalid-' + i, bytes);
      const result = run('malformed', root);
      expect(result.status).toBe(0);
      expect(readFileSync(join(root, 'failed'), 'utf8')).toBe(bytes);
      expect(result.stderr).toContain('Could not persist learning stats');
      expect(result.stderr).not.toContain('secret');
      expect(read(root).signalsProcessed).toBe(11);
      expect(read(root).lastAdaptation).toBe(123);
    }
  });
  it('uses the same lock through a symlinked project directory', () => {
    const root = project('real-project', '{"signalsProcessed":10}');
    const alias = join(scratch, 'project-alias');
    symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    mkdirSync(statsPath(root) + '.lock');
    const busy = run('healthy', alias);
    expect(busy.status).toBe(0);
    expect(read(root).signalsProcessed).toBe(10);
    expect(busy.stderr).toContain('Could not persist learning stats');
    rmSync(statsPath(root) + '.lock', { recursive: true });
    expect(run('healthy', alias).status).toBe(0);
    expect(read(root).signalsProcessed).toBe(11);
  });
  it('retains a failed write delta for retry without double counting', () => {
    const root = project('write-failure', '{"signalsProcessed":10}');
    const result = run('write-fail', root);
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'failed'), 'utf8')).toBe('{"signalsProcessed":10}');
    expect(result.stderr).toContain('Could not persist learning stats');
    expect(read(root).signalsProcessed).toBe(11);
  });
  it('preserves a safe counter when adding the pending delta would overflow', () => {
    const bytes = '{"signalsProcessed":9007199254740991}';
    const root = project('overflow', bytes);
    const result = run('overflow', root);
    expect(result.status).toBe(0);
    expect(readFileSync(statsPath(root), 'utf8')).toBe(bytes);
    expect(result.stderr).toContain('EINVALIDSTATS');
  });
  it('supports first use, partial legacy files, late load and repeated flush', () => {
    const fresh = project('fresh');
    expect(run('healthy', fresh).status).toBe(0);
    expect(read(fresh).signalsProcessed).toBe(1);
    const legacy = project('legacy', '{"signalsProcessed":10,"lastAdaptation":null}');
    expect(run('healthy', legacy).status).toBe(0);
    expect(read(legacy).signalsProcessed).toBe(11);
  });
});

// Helper lifecycle controls are additional to the identical baseline API cases above.
describe('stats lock owner lifecycle', () => {
  it('does not steal a paused live owner even when its directory looks old', async () => {
    const root = project('paused-owner', '{"signalsProcessed":10}');
    const child = spawn(node, [worker, 'owner', root], {
      env: { ...process.env, CLAUDE_FLOW_CWD: root }, stdio: 'ignore',
    });
    const ended = childExit(child);
    try {
      await until(() => existsSync(join(root, 'owned')));
      utimesSync(statsPath(root) + '.lock', new Date(0), new Date(0));
      const contender = run('healthy', root);
      expect(contender.status).toBe(0);
      expect(contender.stderr).toContain('ELOCKED');
      expect(read(root).signalsProcessed).toBe(10);
      expect(child.exitCode).toBe(null);
      writeFileSync(join(root, 'release'), '');
      await ended;
      expect(existsSync(statsPath(root) + '.lock')).toBe(false);
      expect(run('healthy', root).status).toBe(0);
      expect(read(root).signalsProcessed).toBe(11);
    } finally {
      if (child.exitCode === null) child.kill();
      await Promise.allSettled([ended]);
    }
  }, 20000);
});
