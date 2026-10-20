/** Regression for #3286: home-level helpers must write to the active project. */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateAutoMemoryHook } from '../src/init/helpers-generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageHook = resolve(here, '../.claude/helpers/auto-memory-hook.mjs');
const dogfoodHook = resolve(here, '../../../../.claude/helpers/auto-memory-hook.mjs');
const tempRoots: string[] = [];

function fixture(source: string | null) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-root-3286-'));
  tempRoots.push(root);
  const project = join(root, 'project');
  const home = join(root, 'home');
  const hook = join(home, '.claude', 'helpers', 'auto-memory-hook.mjs');
  mkdirSync(project, { recursive: true });
  mkdirSync(dirname(hook), { recursive: true });
  if (source) copyFileSync(source, hook);
  else writeFileSync(hook, generateAutoMemoryHook());
  return { project, home, hook };
}

function run(hook: string, project: string, command: string) {
  const result = spawnSync(process.execPath, [hook, command], {
    cwd: project,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return result.stdout;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('#3286 auto-memory project root', () => {
  for (const [name, source] of [['package', packageHook], ['repository', dogfoodHook]] as const) {
    it(`${name} helper imports and syncs into the project when invoked from HOME`, () => {
      const { project, home, hook } = fixture(source);
      // The memory package resolves from the helper's install root (HOME here),
      // never from the project; data still lands in the project.
      const mockMemory = join(home, 'mock-memory.mjs');
      writeFileSync(mockMemory, `
import { writeFileSync } from 'node:fs';
export class AutoMemoryBridge {
  constructor(backend, config) { this.backend = backend; this.config = config; }
  async importFromAutoMemory() {
    await this.backend.store({ id: 'scope', key: 'scope', content: this.config.workingDir });
    return { imported: 1, skipped: 0 };
  }
  async syncToAutoMemory() {
    writeFileSync(new URL('./sync-root.txt', import.meta.url), this.config.workingDir);
    return { synced: 1, categories: [] };
  }
  async curateIndex() {}
}
`);
      mkdirSync(join(home, '.claude-flow'), { recursive: true });
      writeFileSync(join(home, '.claude-flow', 'memory-package.json'), JSON.stringify({ distPath: mockMemory }));

      expect(run(hook, project, 'import')).toContain('Imported 1 entries');
      const store = join(project, '.claude-flow', 'data', 'auto-memory-store.json');
      expect(JSON.parse(readFileSync(store, 'utf8'))[0].content).toBe(project);
      expect(run(hook, project, 'sync')).toContain('Synced 1 entries');
      expect(readFileSync(join(home, 'sync-root.txt'), 'utf8')).toBe(project);
      expect(existsSync(join(home, '.claude-flow', 'data', 'auto-memory-store.json'))).toBe(false);
    });
  }

  it('generated fallback reads the project store when invoked from HOME', () => {
    const { project, home, hook } = fixture(null);
    const data = join(project, '.claude-flow', 'data');
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, 'auto-memory-store.json'), '[]');

    expect(run(hook, project, 'status')).toContain('Store:          Initialized');
    expect(existsSync(join(home, '.claude-flow', 'data'))).toBe(false);
  });
});
