/**
 * Regression for #4058 (auto-memory hooks): the generated hooks must reach the
 * helper with their subcommand, sync must see the learnings the bridge asks
 * for, the index line must not claim work that was skipped, worktree sessions
 * must target the main repository's memory directory, and concurrent writers
 * must not lose each other's entries.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeSettingsForUpgrade } from '../src/init/executor.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageHook = resolve(here, '../.claude/helpers/auto-memory-hook.mjs');
const dogfoodHook = resolve(here, '../../../../.claude/helpers/auto-memory-hook.mjs');
const packageIntel = resolve(here, '../.claude/helpers/intelligence.cjs');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-4058-')));
  tempRoots.push(root);
  const project = join(root, 'project');
  const home = join(root, 'home');
  mkdirSync(project, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, project, home };
}

/** A memory package stub whose bridge calls the backend exactly like the real one. */
const MOCK_MEMORY = `
import { EventEmitter } from 'node:events';
import { appendFileSync, writeFileSync } from 'node:fs';
export class AutoMemoryBridge extends EventEmitter {
  constructor(backend, config) { super(); this.backend = backend; this.config = config; }
  async importFromAutoMemory() {
    appendFileSync(new URL('./config-seen.jsonl', import.meta.url), JSON.stringify(this.config) + '\\n');
    const id = 'imp-' + process.pid + '-' + Math.random().toString(16).slice(2);
    await this.backend.store({ id, key: id, namespace: 'auto-memory', content: 'x', type: 'semantic', tags: [], metadata: {}, createdAt: Date.now(), updatedAt: Date.now() });
    return { imported: 1, skipped: 0 };
  }
  async syncToAutoMemory() {
    // AutoMemoryBridge.queryRecentInsights, verbatim shape
    const found = await this.backend.query({ type: 'hybrid', namespace: 'learnings', tags: ['insight'], updatedAfter: 0, limit: 50 });
    writeFileSync(new URL('./sync-found.json', import.meta.url), JSON.stringify(found.map(e => e.id)));
    return { synced: found.length, categories: [] };
  }
  async curateIndex() { this.emit('index:skipped', { reason: 'no-matching-topic-files' }); }
}
`;

function installHook(source: string, home: string) {
  const hook = join(home, '.claude', 'helpers', 'auto-memory-hook.mjs');
  mkdirSync(dirname(hook), { recursive: true });
  copyFileSync(source, hook);
  const mock = join(home, 'mock-memory.mjs');
  writeFileSync(mock, MOCK_MEMORY);
  mkdirSync(join(home, '.claude-flow'), { recursive: true });
  writeFileSync(join(home, '.claude-flow', 'memory-package.json'), JSON.stringify({ distPath: mock }));
  return { hook, mock };
}

function run(hook: string, project: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, [hook, ...args], {
    cwd: project,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(r.error).toBeUndefined();
  return r.stdout + r.stderr;
}

function upgradeCommands() {
  const { project } = sandbox();
  const { merged } = mergeSettingsForUpgrade({}, project);
  const hooks = merged.hooks as Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>>;
  const pick = (event: string) => hooks[event].flatMap(g => g.hooks).find(h => h.command.includes('auto-memory-hook'))!;
  return { project, importHook: pick('SessionStart'), syncHook: pick('SessionEnd') };
}

describe('#4058 point 1: the generated command delivers the subcommand', () => {
  for (const sub of ['import', 'sync'] as const) {
    it(`upgrade-generated ${sub} command passes "${sub}" as the helper's first argument`, () => {
      const { project, importHook, syncHook } = upgradeCommands();
      const fake = join(project, '.claude', 'helpers', 'auto-memory-hook.mjs');
      mkdirSync(dirname(fake), { recursive: true });
      writeFileSync(fake, "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./argv.json', import.meta.url), JSON.stringify(process.argv.slice(2)));\n");
      const cmd = (sub === 'import' ? importHook : syncHook).command;
      const r = spawnSync(cmd, { shell: true, cwd: project, env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8', timeout: 15_000 });
      expect(r.status).toBe(0);
      expect(JSON.parse(readFileSync(join(dirname(fake), 'argv.json'), 'utf8'))).toEqual([sub]);
    });
  }

  for (const [name, source] of [['package', packageHook], ['repository', dogfoodHook]] as const) {
    it(`${name} helper still imports when an older settings.json passes the subcommand as argv[1] (node -e form)`, () => {
      const { project, home } = sandbox();
      const { hook } = installHook(source, home);
      const legacy = `var u=require('url');import(u.pathToFileURL(${JSON.stringify(hook)}).href)`;
      const r = spawnSync(process.execPath, ['-e', legacy, 'import'], {
        cwd: project, env: { ...process.env, CLAUDE_PROJECT_DIR: project }, encoding: 'utf8', timeout: 15_000,
      });
      expect(r.stdout).toContain('Imported 1 entries');
      expect(r.stdout).not.toContain('Auto Memory Bridge Status');
    });
  }
});

describe('#4058 point 2: hook timeouts are in seconds', () => {
  it('auto-memory hooks written on upgrade use second-scale timeouts', () => {
    const { importHook, syncHook } = upgradeCommands();
    for (const h of [importHook, syncHook]) {
      expect(h.timeout).toBeGreaterThanOrEqual(5);
      expect(h.timeout).toBeLessThanOrEqual(120);
    }
  });
});

describe('#4058 point 4: sync sees learnings, and curate does not claim skipped work', () => {
  for (const [name, source] of [['package', packageHook], ['repository', dogfoodHook]] as const) {
    it(`${name} helper answers the bridge's learnings query and reports a skipped index honestly`, () => {
      const { project, home } = sandbox();
      const { hook } = installHook(source, home);
      const data = join(project, '.claude-flow', 'data');
      mkdirSync(data, { recursive: true });
      const entry = (id: string, namespace: string, tags: string[]) =>
        ({ id, key: id, namespace, content: id, type: 'semantic', tags, metadata: { confidence: 0.9 }, createdAt: 1, updatedAt: 2 });
      writeFileSync(join(data, 'auto-memory-store.json'), JSON.stringify([
        entry('insight-1', 'learnings', ['insight']),
        entry('insight-2', 'learnings', ['insight', 'extra']),
        entry('other-ns', 'auto-memory', ['insight']),
        entry('untagged', 'learnings', []),
      ]));
      const out = run(hook, project, ['sync']);
      expect(out).toContain('Synced 2 entries');
      expect(JSON.parse(readFileSync(join(home, 'sync-found.json'), 'utf8')).sort()).toEqual(['insight-1', 'insight-2']);
      expect(out).not.toContain('Curated MEMORY.md index');
      expect(out).toMatch(/index unchanged|skipped/i);
    });
  }
});

describe('#4058 point 5: a git worktree uses the main repository memory directory', () => {
  it('passes the main checkout key as memoryDir, never the worktree key', () => {
    const { root, home } = sandbox();
    const main = join(root, 'main_repo');
    const wt = join(root, 'wt-feature');
    mkdirSync(main, { recursive: true });
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
    git(main, 'init', '-q', '-b', 'main');
    writeFileSync(join(main, 'f.txt'), 'x');
    git(main, 'add', '.');
    git(main, 'commit', '-q', '-m', 'init');
    git(main, 'worktree', 'add', '-q', wt, '-b', 'feature');
    expect(existsSync(join(wt, '.git'))).toBe(true);

    const { hook } = installHook(packageHook, home);
    run(hook, wt, ['import'], { HOME: home, USERPROFILE: home });
    const seen = readFileSync(join(home, 'config-seen.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const key = (p: string) => p.split('/').join('/').replace(/[\/_:]/g, '-');
    expect(seen[0].memoryDir).toBe(join(home, '.claude', 'projects', key(main), 'memory'));
    expect(seen[0].memoryDir).not.toContain(key(wt));
  });

  it('a plain checkout is unchanged (no memoryDir override needed)', () => {
    const { root, home } = sandbox();
    const repo = join(root, 'plain');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    const { hook } = installHook(packageHook, home);
    run(hook, repo, ['import'], { HOME: home, USERPROFILE: home });
    const seen = JSON.parse(readFileSync(join(home, 'config-seen.jsonl'), 'utf8').trim().split('\n')[0]);
    const key = repo.replace(/[\/_:]/g, '-');
    expect(seen.memoryDir ?? join(home, '.claude', 'projects', key, 'memory')).toBe(join(home, '.claude', 'projects', key, 'memory'));
  });
});

describe('#4058 point 6: concurrent writers do not lose entries', () => {
  it('eight overlapping imports all land in the store, with no temp files left', async () => {
    const { project, home } = sandbox();
    const { hook } = installHook(packageHook, home);
    mkdirSync(join(project, '.claude-flow', 'data'), { recursive: true });
    const runs = Array.from({ length: 8 }, () => new Promise<void>((done) => {
      const p = spawn(process.execPath, [hook, 'import'], { cwd: project, env: { ...process.env, CLAUDE_PROJECT_DIR: project }, stdio: 'ignore' });
      p.on('close', () => done());
    }));
    await Promise.all(runs);
    const dir = join(project, '.claude-flow', 'data');
    const store = JSON.parse(readFileSync(join(dir, 'auto-memory-store.json'), 'utf8'));
    expect(store.length).toBe(8);
    expect(readdirSync(dir).filter(f => f.includes('.tmp') || f.endsWith('.lock'))).toEqual([]);
  }, 60_000);

  it('intelligence.cjs writes JSON atomically (no truncated file under a concurrent reader)', () => {
    const source = readFileSync(packageIntel, 'utf8');
    expect(source).toMatch(/renameSync\(/);
    const writer = /function writeJSON\(filePath, data\) \{[\s\S]*?\n\}/.exec(source)![0];
    expect(writer).toContain('renameSync');
    expect(writer).not.toMatch(/writeFileSync\(filePath,/);
  });
});
