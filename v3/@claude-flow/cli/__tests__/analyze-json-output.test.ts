import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(join(cli, 'package.json'));

// The private PATH contains a real executable symlink; creating it can require
// privileges on Windows. Platform build acceptance is a separate gate.
describe.skipIf(process.platform === 'win32')('analyze JSON output', () => {
  let owned: string;
  let source: string;
  let runner: string;
  let aliases: Record<string, string>;

  beforeAll(() => {
    owned = mkdtempSync(join(tmpdir(), 'ruflo-analyze-json-'));
    source = join(owned, 'source');
    for (const name of ['cli', 'cli-core', 'security']) {
      cpSync(join(cli, '..', name, 'src'), join(source, name, 'src'), { recursive: true });
    }
    runner = join(dirname(requireHere.resolve('vitest/package.json')), 'vitest.mjs');
    aliases = {
      vitest: join(dirname(runner), 'dist/index.js'),
      semver: requireHere.resolve('semver'),
      bcryptjs: requireHere.resolve('bcryptjs'),
      zod: requireHere.resolve('zod'),
      '@claude-flow/cli-core': join(source, 'cli-core/src'),
      '@claude-flow/security': join(source, 'security/src'),
    };
    // pnpm's .bin shim exports NODE_PATH with every workspace dependency; drop it so the
    // absence check sees only what a clean install would resolve.
    const savedNodePath = process.env.NODE_PATH;
    delete process.env.NODE_PATH; (Module as any)._initPaths();
    try {
      const isolatedRequire = createRequire(join(source, 'cli', 'package.json'));
      for (const name of ['ruvector', '@ruvector/ast', '@ruvector/wasm', '@ruvector/sona', '@huggingface/transformers', '@xenova/transformers', 'agentic-flow']) {
        expect(() => isolatedRequire.resolve(name)).toThrow();
      }
    } finally {
      if (savedNodePath !== undefined) process.env.NODE_PATH = savedNodePath;
      (Module as any)._initPaths();
    }
  });
  afterAll(() => { if (owned) rmSync(owned, { recursive: true, force: true }); });

  function run(command: string, mode: 'populated' | 'empty' | 'missing' = 'populated', format?: string, artifact = false, malformedPackage = false) {
    const project = mkdtempSync(join(owned, 'project-'));
    const home = join(project, 'home');
    const temp = join(project, 'tmp');
    const bin = join(project, 'bin');
    const target = join(project, mode);
    for (const directory of [home, temp, bin]) mkdirSync(directory);
    symlinkSync(process.execPath, join(bin, 'node'));
    if (mode !== 'missing') mkdirSync(target);
    if (mode === 'populated') {
      writeFileSync(join(target, 'dependency.ts'), 'export const value = 1;\nexport function noop() {}\n');
      writeFileSync(join(target, 'fixture.ts'), "import { value } from './dependency';\nexport function increment() { return value + 1; }\n");
    }
    writeFileSync(join(project, 'package.json'), JSON.stringify({
      name: 'owned-analysis-fixture', version: '1.0.0', dependencies: { fixture: '1.0.0' }, devDependencies: { development: '2.0.0' },
    }));
    const outputFile = join(project, 'analysis.json');
    const args = ['analyze', command, ...(command === 'code' ? ['--path', target] : command === 'deps' ? [] : [target]),
      ...(format ? ['--format', format] : []), ...(artifact ? ['--output', outputFile] : [])];
    const driver = join(project, 'native.test.ts');
    const config = join(project, 'native.config.mts');
    const receipt = join(project, 'receipt.json');
    writeFileSync(driver, `
import { it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { CommandParser } from ${JSON.stringify(join(source, 'cli/src/parser.ts'))};
import { analyzeCommand } from ${JSON.stringify(join(source, 'cli/src/commands/analyze.ts'))};
it('registered parser and real analysis action', async () => {
  const parser = new CommandParser();
  parser.registerCommand(analyzeCommand);
  const parsed = parser.parse(${JSON.stringify(args)});
  const command = analyzeCommand.subcommands!.find(c => c.name === ${JSON.stringify(command)})!;
  expect(parser.validateFlags(parsed.flags, command)).toEqual([]);
  // Keep the runner's package discovery valid, then give the real action the
  // malformed document in this child-owned project.
  if (${JSON.stringify(malformedPackage)}) writeFileSync('package.json', '{invalid json');
  process.stdout.write('OWNED_ANALYZE_BEGIN\\n');
  const result = await command.action!({ args: parsed.positional, flags: parsed.flags, cwd: process.cwd(), interactive: false });
  process.stdout.write('OWNED_ANALYZE_END\\n');
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ parsed, result, node: process.version, bun: process.versions.bun ?? null }));
}, 10000);
`);
    writeFileSync(config, `export default ${JSON.stringify({
      root: project, cacheDir: join(project, 'cache'), esbuild: { tsconfigRaw: { compilerOptions: {} } },
      resolve: { alias: aliases }, test: { include: [driver], maxWorkers: 1, fileParallelism: false },
    })};`);
    const child = spawnSync(process.execPath, [runner, 'run', '--config', config, '--reporter=verbose'], {
      cwd: project,
      env: { PATH: bin, HOME: home, TMPDIR: temp, TEMP: temp, TMP: temp, CI: 'true', TERM: 'dumb', NO_COLOR: '1',
        RUFLO_DAEMON_AUTOSTART: '0', CLAUDE_FLOW_NATIVE_ROUTER: '0', CLAUDE_FLOW_AI_WORKERS: '0', CLAUDE_FLOW_ROUTER_BRIDGE: '1' },
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    });
    expect(child.error, child.stdout + child.stderr).toBeUndefined();
    expect(child.status, child.stdout + child.stderr).toBe(0);
    const data = JSON.parse(readFileSync(receipt, 'utf8'));
    expect(data.bun).toBeNull();
    const begin = 'OWNED_ANALYZE_BEGIN\n';
    const end = 'OWNED_ANALYZE_END\n';
    expect(child.stdout.split(begin)).toHaveLength(2);
    expect(child.stdout.split(end)).toHaveLength(2);
    const stdout = child.stdout.split(begin)[1].split(end)[0];
    return { ...data, stdout, stderr: child.stderr, outputFile };
  }

  it('emits one JSON document for populated code analysis', () => {
    const { result, stdout } = run('code', 'populated', 'json');
    expect(result.success).toBe(true);
    expect(JSON.parse(stdout)).toEqual(result.data);
    expect(result.data).toMatchObject({ files: 2, totalFunctions: 2, totalImports: 1, avgFileSize: 2 });
  }, 20000);

  it('emits one JSON document for dependency counts', () => {
    const { result, stdout } = run('deps', 'populated', 'json');
    expect(result.success).toBe(true);
    expect(JSON.parse(stdout)).toEqual({ name: 'owned-analysis-fixture', version: '1.0.0', dependencies: 1,
      devDependencies: 1, optionalDependencies: 0, peerDependencies: 0, total: 2 });
  }, 20000);

  it.each(['empty', 'missing'] as const)('preserves successful %s code scans with an empty JSON shape', mode => {
    const { result, stdout } = run('code', mode, 'json');
    expect(result.success).toBe(true);
    expect(JSON.parse(stdout)).toEqual(result.data);
    expect(result.data).toMatchObject({ type: 'quality', files: 0, totalLoc: 0, totalTodos: 0,
      totalFunctions: 0, totalImports: 0, avgFileSize: 0, fileStats: [] });
  }, 20000);

  it('emits finite zero totals for an empty AST JSON result', () => {
    const { result, stdout } = run('ast', 'empty', 'json');
    expect(result.success).toBe(true);
    expect(JSON.parse(stdout)).toEqual({ files: [], totals: { files: 0, functions: 0, classes: 0, imports: 0, avgComplexity: 0, totalLoc: 0 } });
  }, 20000);

  it('writes the same empty AST JSON shape to a requested artifact', () => {
    const { result, stdout, outputFile } = run('ast', 'empty', 'json', true);
    expect(result.success).toBe(true);
    expect(JSON.parse(readFileSync(outputFile, 'utf8'))).toEqual(result.data);
    expect(result.data).toEqual({ files: [], totals: { files: 0, functions: 0, classes: 0, imports: 0, avgComplexity: 0, totalLoc: 0 } });
    expect(stdout).toContain('Results written to');
  }, 20000);

  it.each(['ast', 'complexity', 'symbols', 'imports', 'boundaries', 'modules', 'dependencies', 'circular'])('retains the existing valid %s JSON document', command => {
    const { result, stdout } = run(command, 'populated', 'json');
    expect(result.success).toBe(true);
    expect(JSON.parse(stdout)).toEqual(result.data);
  }, 20000);

  it.each(['code', 'deps'])('retains the default %s text heading and summary', command => {
    const { result, stdout } = run(command);
    expect(result.success).toBe(true);
    expect(stdout).toContain(command === 'code' ? 'Code Analysis' : 'Dependency Analysis');
    expect(stdout).toContain(command === 'code' ? 'Quality Summary' : 'Dependency Summary');
  }, 20000);

  it.each(['code', 'ast'])('retains the empty %s text warning', command => {
    const { result, stderr } = run(command, 'empty');
    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(stderr).toContain(command === 'code' ? 'No source files found' : 'No files analyzed');
  }, 20000);

  it('retains failure status and stderr for a malformed package document', () => {
    const { result, stderr } = run('deps', 'populated', 'json', false, true);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.data).toBeUndefined();
    expect(stderr).toContain('Dependency analysis failed');
  }, 20000);

  it('retains failure status and stderr for a missing AST target', () => {
    const { result, stderr } = run('ast', 'missing', 'json');
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.data).toBeUndefined();
    expect(stderr).toContain('AST analysis failed');
  }, 20000);
});
