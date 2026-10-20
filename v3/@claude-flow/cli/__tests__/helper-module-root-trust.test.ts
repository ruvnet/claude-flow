/**
 * A home-level helper can serve an untrusted project: CLAUDE_PROJECT_DIR picks
 * where data goes, never which JavaScript is imported. Executable modules must
 * resolve from the helper's own install root.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateAutoMemoryHook } from '../src/init/helpers-generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageHelpers = resolve(here, '../.claude/helpers');
const dogfoodHelpers = resolve(here, '../../../../.claude/helpers');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A module that leaves a marker file if it is ever imported. */
function payload(marker: string): string {
  return `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'executed');\n` +
    'export class AutoMemoryBridge {}\n';
}

/** Plant a payload in every location the memory resolver has probed from the project. */
function plantProject(project: string, marker: string) {
  const write = (file: string, content: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  write(join(project, 'evil-sidecar.mjs'), payload(marker));
  write(join(project, '.claude-flow', 'memory-package.json'), JSON.stringify({ distPath: join(project, 'evil-sidecar.mjs') }));
  write(join(project, 'v3', '@claude-flow', 'memory', 'dist', 'index.js'), payload(marker));
  write(join(project, 'package.json'), JSON.stringify({ name: 'untrusted', type: 'module' }));
  const pkg = join(project, 'node_modules', '@claude-flow', 'memory');
  write(join(pkg, 'package.json'), JSON.stringify({ name: '@claude-flow/memory', type: 'module', main: 'dist/index.js' }));
  write(join(pkg, 'dist', 'index.js'), payload(marker));
}

function fixture(source: string | null) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-module-root-'));
  tempRoots.push(root);
  const project = join(root, 'project');
  const home = join(root, 'home');
  const hook = join(home, '.claude', 'helpers', 'auto-memory-hook.mjs');
  const marker = join(root, 'payload-executed');
  mkdirSync(dirname(hook), { recursive: true });
  if (source) copyFileSync(source, hook);
  else writeFileSync(hook, generateAutoMemoryHook());
  plantProject(project, marker);
  return { project, hook, marker };
}

function run(hook: string, project: string, command: string) {
  const result = spawnSync(process.execPath, [hook, command], {
    cwd: project,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe('auto-memory-hook resolves modules from the helper root only', () => {
  const sources = [
    ['package', join(packageHelpers, 'auto-memory-hook.mjs')],
    ['repository', join(dogfoodHelpers, 'auto-memory-hook.mjs')],
    ['generated fallback', null],
  ] as const;

  for (const [name, source] of sources) {
    it(`${name} helper never imports project code from a home-level install`, () => {
      const { project, hook, marker } = fixture(source);
      for (const command of ['import', 'sync', 'status']) {
        run(hook, project, command);
        expect(existsSync(marker), `${command} executed a project module`).toBe(false);
      }
    });
  }
  // Project data placement for home-level helpers is covered by
  // auto-memory-project-root-3286.test.ts.
});

describe('learning-service resolves modules from the helper root only', () => {
  for (const [name, dir] of [['package', packageHelpers], ['repository', dogfoodHelpers]] as const) {
    it(`${name} helper builds import paths from MODULE_ROOT`, () => {
      const source = readFileSync(join(dir, 'learning-service.mjs'), 'utf8');
      expect(source).toContain("const MODULE_ROOT = join(__dirname, '../..');");
      expect(source).toMatch(/join\(MODULE_ROOT, 'node_modules\/agentic-flow\//);
      expect(source).not.toMatch(/join\(PROJECT_ROOT, 'node_modules/);
    });
  }
});
