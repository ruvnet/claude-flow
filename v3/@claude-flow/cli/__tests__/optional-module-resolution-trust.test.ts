/**
 * The CLI, its MCP tools and plugin scripts load optional modules and plugin
 * scripts that they then execute. Those must resolve from the tool's own
 * install (or the user's marketplace checkout), never from the cwd: the cwd
 * is the opened project, and a project must not choose code that runs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ownInstallAncestors, ownPluginDirs } from '../src/plugins/own-install.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-optional-module-')));
  tempRoots.push(root);
  return root;
}

function write(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** Source of `function name(...) { ... }` up to the next top-level closing brace. */
function fnSource(file: string, name: string): string {
  const source = readFileSync(resolve(REPO, file), 'utf8');
  const start = source.search(new RegExp(`function ${name}\\(`));
  expect(start, `${name} in ${file}`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n}\n', start));
}

describe('locators of executed modules never consult the cwd', () => {
  const cases: Array<[string, string]> = [
    ['v3/@claude-flow/cli/src/mcp-tools/testgen-tools.ts', 'locateTestgenScripts'],
    ['v3/@claude-flow/cli/src/mcp-tools/metaharness-tools.ts', 'locatePluginScripts'],
    ['v3/@claude-flow/cli/src/commands/metaharness.ts', 'locatePluginScripts'],
    ['v3/@claude-flow/cli/src/commands/doctor.ts', 'checkMetaharnessIntegration'],
    ['v3/@claude-flow/cli/src/commands/init.ts', 'resolveCodexInitializer'],
    ['plugins/ruflo-ruos/scripts/lib/ledger.mjs', 'resolveCallTool'],
  ];
  for (const [file, name] of cases) {
    it(`${file} ${name}()`, () => {
      // Comments may still describe the old cwd lookup; only code counts.
      const body = fnSource(file, name).split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
      expect(body).not.toMatch(/process\.cwd\(\)|getProjectCwd\(\)|join\(cwd,/);
    });
  }

  it('compact.mjs does not resolve the token optimizer from the cwd', () => {
    const source = readFileSync(resolve(REPO, 'plugins/ruflo-cost-tracker/scripts/compact.mjs'), 'utf8');
    expect(source).not.toContain("tryResolveFrom(join(process.cwd(), 'package.json'))");
  });
});

describe('plugin locators stay inside the package own install', () => {
  const sources: Array<[string, string]> = [
    ['v3/@claude-flow/cli/src/mcp-tools/testgen-tools.ts', 'locateTestgenScripts'],
    ['v3/@claude-flow/cli/src/mcp-tools/metaharness-tools.ts', 'locatePluginScripts'],
    ['v3/@claude-flow/cli/src/commands/metaharness.ts', 'locatePluginScripts'],
    ['v3/@claude-flow/cli/src/commands/doctor.ts', 'checkMetaharnessIntegration'],
  ];
  for (const [file, name] of sources) {
    it(`${file} ${name}() walks up through the bounded helper, not a hand-rolled loop`, () => {
      const body = fnSource(file, name);
      expect(body).toMatch(/ownPluginDirs\(|ownInstallAncestors\(/);
      expect(body).not.toMatch(/(\w+) = dirname\(\1\)/);
    });
  }

  it("a project-local install never reaches the project's own plugins/ directory", () => {
    const project = scratch();
    const cliDir = join(project, 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'mcp-tools');
    for (const plugin of ['ruflo-testgen', 'ruflo-metaharness']) {
      const dirs = [...ownPluginDirs(cliDir, plugin, 'scripts'), ...ownInstallAncestors(cliDir).map((d) => join(d, 'plugins', plugin))];
      expect(dirs.length).toBeGreaterThan(0);
      // Every candidate is inside the package; none is the project or above it.
      for (const d of dirs) expect(d.startsWith(join(project, 'node_modules', '@claude-flow', 'cli')) || d.startsWith(join(project, 'node_modules', '@claude-flow', 'plugins'))).toBe(true);
      expect(dirs).not.toContain(join(project, 'plugins', plugin, 'scripts'));
    }
    // The package's own bundled plugin is still found.
    expect(ownPluginDirs(cliDir, 'ruflo-metaharness', 'scripts')).toContain(
      join(project, 'node_modules', '@claude-flow', 'cli', 'plugins', 'ruflo-metaharness', 'scripts'),
    );
  });

  it('pnpm and global layouts stop at their node_modules too', () => {
    const pnpm = '/p/node_modules/.pnpm/@claude-flow+cli@1/node_modules/@claude-flow/cli/dist/src/commands';
    expect(ownInstallAncestors(pnpm)).not.toContain('/p/node_modules/.pnpm/@claude-flow+cli@1');
    expect(ownInstallAncestors('/usr/lib/node_modules/@claude-flow/cli/dist/src')).toEqual([
      '/usr/lib/node_modules/@claude-flow/cli/dist/src',
      '/usr/lib/node_modules/@claude-flow/cli/dist',
      '/usr/lib/node_modules/@claude-flow/cli',
      '/usr/lib/node_modules/@claude-flow',
    ]);
  });

  it('a source checkout still reaches the repo root (monorepo dev)', () => {
    const repo = '/work/ruflo';
    expect(ownPluginDirs(`${repo}/v3/@claude-flow/cli/src/mcp-tools`, 'ruflo-testgen', 'scripts')).toContain(
      `${repo}/plugins/ruflo-testgen/scripts`,
    );
  });
});

describe('ruflo-ruos resolveCallTool at runtime', () => {
  it("never imports a dispatcher planted in the project's node_modules", async () => {
    const project = scratch();
    const marker = join(project, 'planted-dispatcher-ran');
    const planted = `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, '1');\nexport function callMCPTool() {}\n`;
    write(join(project, 'node_modules', '@claude-flow', 'cli', 'package.json'), JSON.stringify({ name: '@claude-flow/cli', type: 'module' }));
    write(join(project, 'node_modules', '@claude-flow', 'cli', 'dist', 'src', 'mcp-client.js'), planted);

    const { resolveCallTool } = await import(pathToFileURL(resolve(REPO, 'plugins/ruflo-ruos/scripts/lib/ledger.mjs')).href);
    await resolveCallTool(project, {});

    expect(existsSync(marker)).toBe(false);
  });
});

describe('cost-tracker compact.mjs at runtime', () => {
  it("never imports a token optimizer planted in the project's node_modules", () => {
    const project = scratch();
    const marker = join(project, 'planted-optimizer-ran');
    const pkg = join(project, 'node_modules', '@claude-flow', 'integration');
    write(join(pkg, 'package.json'), JSON.stringify({
      name: '@claude-flow/integration',
      type: 'module',
      exports: { './token-optimizer': './token-optimizer.js' },
    }));
    write(join(pkg, 'token-optimizer.js'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, '1');\n`);
    write(join(project, 'package.json'), JSON.stringify({ name: 'untrusted' }));

    const result = spawnSync(process.execPath, [resolve(REPO, 'plugins/ruflo-cost-tracker/scripts/compact.mjs'), 'query'], {
      cwd: project,
      env: { ...process.env, COMPACT_QUIET: '1' },
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.error).toBeUndefined();
    expect(existsSync(marker)).toBe(false);
  });
});
