import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(join(cli, 'package.json'));

// The private PATH uses a real executable symlink, which requires privileges
// on Windows. The inherited platform build remains separate from these cases.
describe.skipIf(process.platform === 'win32')('doctor component selection', () => {
  let owned: string;
  let source: string;
  let runner: string;
  let semver: string;
  let nativeSqlite: string;

  beforeAll(() => {
    owned = mkdtempSync(join(tmpdir(), 'ruflo-doctor-selection-'));
    source = join(owned, 'source');
    for (const name of ['cli', 'cli-core', 'security']) {
      cpSync(join(cli, '..', name, 'src'), join(source, name, 'src'), { recursive: true });
    }
    runner = join(dirname(requireHere.resolve('vitest/package.json')), 'vitest.mjs');
    semver = requireHere.resolve('semver');
    nativeSqlite = requireHere.resolve('better-sqlite3');
    // Physical source isolation keeps optional providers genuinely absent.
    // pnpm's .bin shim exports NODE_PATH with every workspace dependency; drop it so the
    // absence check sees only what a clean install would resolve.
    const savedNodePath = process.env.NODE_PATH;
    delete process.env.NODE_PATH; (Module as any)._initPaths();
    try {
      const isolatedRequire = createRequire(join(source, 'cli', 'package.json'));
      for (const name of ['ruvector', '@ruvector/sona', '@huggingface/transformers', '@xenova/transformers', 'agentic-flow']) {
        expect(() => isolatedRequire.resolve(name)).toThrow();
      }
    } finally {
      if (savedNodePath !== undefined) process.env.NODE_PATH = savedNodePath;
      (Module as any)._initPaths();
    }
  });
  afterAll(() => { if (owned) rmSync(owned, { recursive: true, force: true }); });

  function run(args: string[], withNativeStore = false) {
    const project = mkdtempSync(join(owned, 'project-'));
    const home = join(project, 'home');
    const temp = join(project, 'tmp');
    const bin = join(project, 'bin');
    for (const directory of [home, temp, bin]) mkdirSync(directory);
    // No npm, installers or other diagnostic tools are on the private PATH.
    symlinkSync(process.execPath, join(bin, 'node'));
    const driver = join(project, 'native.test.ts');
    const config = join(project, 'native.config.mts');
    const receipt = join(project, 'receipt.json');
    writeFileSync(driver, `
import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { CommandParser } from ${JSON.stringify(join(source, 'cli/src/parser.ts'))};
import { doctorCommand } from ${JSON.stringify(join(source, 'cli/src/commands/doctor.ts'))};
it('registered parser and real doctor action', async () => {
  if (${JSON.stringify(withNativeStore)}) {
    mkdirSync('.swarm');
    const db = new Database('.swarm/agentdb-memory.db');
    db.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY); INSERT INTO fixture VALUES (1)');
    db.close();
  }
  const parser = new CommandParser();
  parser.registerCommand(doctorCommand);
  const parsed = parser.parse(${JSON.stringify(['doctor', ...args])});
  expect(parser.validateFlags(parsed.flags, doctorCommand)).toEqual([]);
  expect(parsed.flags.install).toBe(false);
  expect(parsed.flags.fix).toBe(false);
  const result = await doctorCommand.action!({ args: parsed.positional, flags: parsed.flags, cwd: process.cwd(), interactive: false });
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ parsed, result, node: process.version, bun: process.versions.bun ?? null }));
}, 10000);
`);
    writeFileSync(config, `export default ${JSON.stringify({
      root: project, cacheDir: join(project, 'cache'),
      esbuild: { tsconfigRaw: { compilerOptions: {} } },
      resolve: { alias: {
        vitest: join(dirname(runner), 'dist/index.js'),
        semver,
        'better-sqlite3': nativeSqlite,
        '@claude-flow/cli-core': join(source, 'cli-core/src'),
        '@claude-flow/security': join(source, 'security/src'),
      } },
      test: { include: [driver], maxWorkers: 1, fileParallelism: false },
    })};`);
    const child = spawnSync(process.execPath, [runner, 'run', '--config', config, '--reporter=verbose'], {
      cwd: project,
      env: { PATH: bin, HOME: home, TMPDIR: temp, TEMP: temp, TMP: temp, CI: 'true', TERM: 'dumb',
        RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_NATIVE_ROUTER: '0', CLAUDE_FLOW_AI_WORKERS: '0', CLAUDE_FLOW_ROUTER_BRIDGE: '1' },
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    });
    expect(child.error, child.stdout + child.stderr).toBeUndefined();
    expect(child.status, child.stdout + child.stderr).toBe(0);
    return JSON.parse(readFileSync(receipt, 'utf8'));
  }

  it.each(['--component', '-c'])('runs only the real Node check with %s', flag => {
    const { result, node, bun } = run([flag, 'node']);
    expect(result.success).toBe(true);
    expect(bun).toBeNull();
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({ name: 'Node.js Version', status: 'pass' });
    expect(result.data.results[0].message).toContain(node);
  }, 20000);

  it.each(['not-a-doctor-component', 'toString', 'constructor', '__proto__', ''])('rejects unsupported component %j without health results', component => {
    const { result } = run(['--component', component]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/unknown.*component/i);
    expect(result.data).toBeUndefined();
  }, 20000);

  it.each(['learning', 'learning-bridge'])('preserves the existing %s alias', component => {
    const { result } = run(['--component', component]);
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0].name).toBe('Learning Bridge');
  }, 20000);

  it('preserves the lazy grouped memory checks on an uninitialized private project', () => {
    const { result } = run(['--component', 'memory']);
    const names = result.data.results.map((check: { name: string }) => check.name);
    expect(names).toHaveLength(8);
    expect(names[0]).toBe('Memory Database Presence');
    expect(names).not.toContain('Node.js Version');
    expect(names).not.toContain('npm Version');
  }, 20000);

  it('includes the discovered native authority in the grouped memory checks', () => {
    const { result } = run(['--component', 'memory'], true);
    expect(result.data.results).toHaveLength(9);
    const native = result.data.results.find((check: { name: string }) => check.name === 'Native AgentDB Structural Integrity (quick_check)');
    expect(native).toMatchObject({ status: 'pass' });
    expect(native.message).toContain('PRAGMA quick_check: ok');
  }, 20000);
});
