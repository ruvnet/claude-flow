import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireHere = createRequire(join(cli, 'package.json'));
let owned: string;
let source: string;
let runner: string;
let sqlJs: string;
let nativeSqlite: string;

beforeAll(() => {
  owned = mkdtempSync(join(tmpdir(), 'ruflo-sona-routing-'));
  source = join(owned, 'source');
  for (const name of ['cli', 'cli-core', 'security', 'shared']) {
    cpSync(join(cli, '..', name, 'src'), join(source, name, 'src'), { recursive: true });
  }
  runner = join(dirname(requireHere.resolve('vitest/package.json')), 'vitest.mjs');
  sqlJs = requireHere.resolve('sql.js');
  nativeSqlite = requireHere.resolve('better-sqlite3');
  // Keep optional model packages absent. No replacements or model downloads.
  // pnpm's .bin shim exports NODE_PATH with every workspace dependency; drop it so the
  // absence check sees only what a clean install would resolve.
  const savedNodePath = process.env.NODE_PATH;
  delete process.env.NODE_PATH; (Module as any)._initPaths();
  try {
    const isolatedRequire = createRequire(join(source, 'cli', 'package.json'));
    for (const specifier of ['ruvector', '@ruvector/sona', '@huggingface/transformers', '@xenova/transformers', 'agentic-flow']) {
      expect(() => isolatedRequire.resolve(specifier)).toThrow();
    }
  } finally {
    if (savedNodePath !== undefined) process.env.NODE_PATH = savedNodePath;
    (Module as any)._initPaths();
  }
});
afterAll(() => { if (owned) rmSync(owned, { recursive: true, force: true }); });

type Scenario = { name: string; outcomes: number; agent?: string; success?: boolean; semantic?: boolean; task?: string; learned: boolean };
const task = 'implement widget feature';
const scenarios: Scenario[] = [
  { name: 'uses a supported persisted pattern after three real successful trajectories and a process restart', outcomes: 3, learned: true },
  { name: 'keeps static routing after one success below the existing 0.6 confidence gate', outcomes: 1, learned: false },
  { name: 'keeps static routing after two successes still below the confidence gate', outcomes: 2, learned: false },
  { name: 'keeps explicit keyword mode even when an eligible pattern exists', outcomes: 3, semantic: false, learned: false },
  { name: 'rejects an unsupported agent accepted by the trajectory recording API', outcomes: 3, agent: 'unknown-agent', learned: false },
  { name: 'does not consume an eligible pattern for an unrelated task', outcomes: 3, task: 'design distributed database system', learned: false },
  { name: 'does not promote failure outcomes into an eligible route', outcomes: 3, success: false, learned: false },
  { name: 'preserves static routing when there are no learned outcomes', outcomes: 0, learned: false },
];

function runScenario(scenario: Scenario) {
  const project = mkdtempSync(join(owned, 'project-'));
  const home = join(project, 'home');
  const temp = join(project, 'tmp');
  mkdirSync(home); mkdirSync(temp);
  const driver = join(project, 'native.test.ts');
  const config = join(project, 'native.config.mts');
  const record = join(project, 'receipt.json');
  const src = join(source, 'cli', 'src');
  const options = { ...scenario, task: scenario.task ?? task, agent: scenario.agent ?? 'tester', success: scenario.success ?? true };
  writeFileSync(driver, `
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { initializeMemoryDatabase, generateEmbedding } from ${JSON.stringify(join(src, 'memory/memory-initializer.ts'))};
import { getSONAOptimizer } from ${JSON.stringify(join(src, 'memory/sona-optimizer.ts'))};
import { hooksTrajectoryStart, hooksTrajectoryEnd, hooksRoute } from ${JSON.stringify(join(src, 'mcp-tools/hooks-tools.ts'))};
const options = ${JSON.stringify(options)};
it('actual public producer or fresh consumer', async () => {
  if (process.env.OWNED_SONA_PHASE === 'produce') {
    expect((await initializeMemoryDatabase({ backend: 'sqlite', migrate: false })).success).toBe(true);
    const embedding = await generateEmbedding('fixture backend identity');
    expect(embedding.backend).toBe('mock');
    for (let i = 0; i < options.outcomes; i++) {
      const start = await hooksTrajectoryStart.handler({ task: ${JSON.stringify(task)}, agent: options.agent }) as any;
      expect(start.persisted).toBe(true);
      const end = await hooksTrajectoryEnd.handler({ trajectoryId: start.trajectoryId, success: options.success }) as any;
      expect(end.persisted).toBe(true);
      expect(end.learning.sonaUpdate).toBe(true);
    }
    const db = new Database('.swarm/memory.db', { readonly: true });
    expect((db.prepare("SELECT count(*) AS n FROM memory_entries WHERE namespace='trajectories' AND key LIKE 'trajectory-traj-%'").get() as any).n).toBe(options.outcomes);
    const sqliteVersion = db.prepare('select sqlite_version() AS version').get();
    db.close();
    writeFileSync('producer.json', JSON.stringify({ embedding: { model: embedding.model, backend: embedding.backend }, sqliteVersion, state: existsSync('.swarm/sona-patterns.json') ? JSON.parse(readFileSync('.swarm/sona-patterns.json', 'utf8')) : null }));
  } else {
    const optimizer = await getSONAOptimizer();
    const suggestion = await optimizer.getRoutingSuggestion(options.task);
    const result = await hooksRoute.handler({ task: options.task, useSemanticRouter: options.semantic ?? true });
    writeFileSync(${JSON.stringify(record)}, JSON.stringify({ producer: JSON.parse(readFileSync('producer.json', 'utf8')), suggestion, result }));
  }
}, 10000);
`);
  writeFileSync(config, `export default ${JSON.stringify({
    root: project,
    cacheDir: join(project, 'vite-cache'),
    esbuild: { tsconfigRaw: { compilerOptions: {} } },
    resolve: { alias: {
      vitest: join(dirname(runner), 'dist', 'index.js'),
      'sql.js': sqlJs,
      'better-sqlite3': nativeSqlite,
      '@claude-flow/cli-core': join(source, 'cli-core', 'src'),
      '@claude-flow/security': join(source, 'security', 'src'),
      '@claude-flow/shared': join(source, 'shared', 'src'),
    } },
    test: { include: [driver], maxWorkers: 1, fileParallelism: false },
  })};`);
  for (const phase of ['produce', 'consume']) {
    const child = spawnSync(process.execPath, [runner, 'run', '--config', config, '--reporter=verbose'], {
      cwd: project,
      env: {
        PATH: process.env.PATH,
        HOME: home, TMPDIR: temp, TEMP: temp, TMP: temp,
        CLAUDE_FLOW_DISABLE_BRIDGE: '1', CLAUDE_FLOW_DISABLE_NATIVE_ROUTER: '1',
        CLAUDE_FLOW_ROUTER_EMBEDDER: 'hash', CLAUDE_FLOW_ROUTER_TYPESAFE: '0',
        RUFLO_DAEMON_AI_WORKERS: '0', OWNED_SONA_PHASE: phase,
      },
      encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    });
    expect(child.error, child.stdout + child.stderr).toBeUndefined();
    expect(child.status, child.stdout + child.stderr).toBe(0);
  }
  return JSON.parse(readFileSync(record, 'utf8'));
}

describe('hooks_route persisted SONA patterns (#3662)', () => {
  it.each(scenarios)('$name', scenario => {
    const { suggestion, result, producer } = runScenario(scenario);
    expect(producer.embedding).toEqual({ model: 'hash-fallback', backend: 'mock' });
    if (scenario.learned) {
      expect(suggestion.source).toBe('sona-pattern');
      expect(suggestion.confidence).toBeGreaterThanOrEqual(0.6);
      expect(producer.state.stats.successfulRoutings).toBe(3);
      expect(result.routing.method).toBe('sona-pattern');
      expect(result.primaryAgent.type).toBe('tester');
      expect(result.primaryAgent.confidence).toBeGreaterThanOrEqual(0.6);
    } else {
      expect(result.routing.method).not.toBe('sona-pattern');
      expect(result.primaryAgent.type).not.toBe('unknown-agent');
      if (scenario.semantic === false) {
        expect(suggestion.source).toBe('sona-pattern');
        expect(result.routing.method).toBe('keyword');
        expect(result.primaryAgent.type).toBe('architect');
      }
      if (scenario.outcomes === 1 || scenario.outcomes === 2) expect(suggestion.source).not.toBe('sona-pattern');
      if (scenario.agent === 'unknown-agent') expect(suggestion.agent).toBe('unknown-agent');
    }
  }, 25000);
});
