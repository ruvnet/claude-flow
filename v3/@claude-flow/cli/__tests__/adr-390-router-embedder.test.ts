/**
 * ADR-390 — the semantic router uses the real sentence embedder.
 *
 * London-school: the local embedder (`generateLocalEmbedding`) is mocked so
 * each test pins one collaborator behaviour (onnx / mock backend / throws) and
 * asserts how hooks_route and the router embedder react. The bridge-first
 * `generateEmbedding` is also mocked, and must never be called (#2312).
 *
 * One real (unmocked) test runs only when the MiniLM model is cached locally.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

vi.mock('../src/memory/memory-initializer.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateLocalEmbedding: vi.fn(),
  generateEmbedding: vi.fn(async () => { throw new Error('bridge-first generateEmbedding must not be called by the router'); }),
}));
// Keep hooks_route on the local path: the AgentDB pre-route answers "nothing".
vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeRouteTask: vi.fn(async () => null) }));

import * as memoryInit from '../src/memory/memory-initializer.js';
import { hooksRoute, routeTaskForBench, resetSemanticRouterForTests } from '../src/mcp-tools/hooks-tools.js';
import {
  DEFAULT_ROUTER_EMBEDDER,
  clearRouterEmbedderCache,
  embedForRouter,
  generateSimpleEmbedding,
  resolveRouterEmbedder,
} from '../src/ruvector/router-embedder.js';

const localEmbed = vi.mocked(memoryInit.generateLocalEmbedding);
const bridgeEmbed = vi.mocked(memoryInit.generateEmbedding);

/** A deterministic "onnx" vector (distinct from the hash so provenance is checkable). */
function fakeOnnx(text: string) {
  const v = Array.from(generateSimpleEmbedding(`onnx::${text}`));
  return { embedding: v, dimensions: 384, model: 'onnx', backend: 'onnx' as const };
}

type RouteOut = { primaryAgent: { type: string }; embedder: string; embedderReason?: string; routing: { method: string } };
const route = (task: string) => hooksRoute.handler({ task }) as Promise<RouteOut>;

const ENV_KEYS = ['CLAUDE_FLOW_ROUTER_EMBEDDER', 'CLAUDE_FLOW_DISABLE_NATIVE_ROUTER', 'CLAUDE_FLOW_ROUTER_TYPESAFE'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  // Deterministic pure-JS backend (the native VectorDb is required via createRequire, not mockable).
  process.env.CLAUDE_FLOW_DISABLE_NATIVE_ROUTER = '1';
  delete process.env.CLAUDE_FLOW_ROUTER_TYPESAFE;
  delete process.env.CLAUDE_FLOW_ROUTER_EMBEDDER;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  localEmbed.mockReset();
  bridgeEmbed.mockClear();
  clearRouterEmbedderCache();
  resetSemanticRouterForTests();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe('ADR-390 router embedder selection', () => {
  it('defaults to hash when CLAUDE_FLOW_ROUTER_EMBEDDER is unset, and never loads the model', async () => {
    expect(DEFAULT_ROUTER_EMBEDDER).toBe('hash');
    expect(resolveRouterEmbedder().kind).toBe('hash');

    const out = await route('write unit tests for the auth module');

    expect(out.embedder).toBe('hash');
    expect(out.embedderReason).toBeUndefined();
    expect(localEmbed).not.toHaveBeenCalled();
    expect(bridgeEmbed).not.toHaveBeenCalled();
  });

  it('rejects an unknown env value and falls back to the default with a reason', () => {
    const sel = resolveRouterEmbedder(undefined, { CLAUDE_FLOW_ROUTER_EMBEDDER: 'bert' } as NodeJS.ProcessEnv);
    expect(sel.kind).toBe('hash');
    expect(sel.reason).toMatch(/bert/);
  });
});

describe('ADR-390 MiniLM path', () => {
  it('onnx available: pattern and query vectors come from generateLocalEmbedding; embedder=minilm', async () => {
    process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = 'minilm';
    localEmbed.mockImplementation(async (t: string) => fakeOnnx(t));

    const task = 'write unit tests for the auth module';
    const out = await route(task);

    expect(out.embedder).toBe('minilm');
    expect(out.embedderReason).toBeUndefined();
    expect(out.routing.method).not.toBe(undefined);
    const texts = localEmbed.mock.calls.map(c => c[0]);
    // patterns (every static keyword) ...
    for (const kw of ['test', 'authentication', 'refactor', 'deploy']) expect(texts).toContain(kw);
    // ... and the query, through the SAME function
    expect(texts).toContain(task);
    expect(bridgeEmbed).not.toHaveBeenCalled();
  });

  it('mock/hash backend: hash on BOTH sides, embedder=hash with a reason', async () => {
    process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = 'minilm';
    localEmbed.mockImplementation(async () => ({ embedding: new Array(128).fill(0.1), dimensions: 128, model: 'hash-fallback', backend: 'mock' as const }));

    const out = await route('write unit tests for the auth module');

    expect(out.embedder).toBe('hash');
    expect(out.embedderReason).toMatch(/not onnx/);
    // Degradation is decided once at index build: the query is not re-tried on the model.
    expect(localEmbed).toHaveBeenCalledTimes(1);
    expect(bridgeEmbed).not.toHaveBeenCalled();
  });

  it('generateLocalEmbedding throws: hash on both sides, embedder=hash with a reason', async () => {
    process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = 'minilm';
    localEmbed.mockRejectedValue(new Error('onnx runtime missing'));

    const out = await route('write unit tests for the auth module');

    expect(out.embedder).toBe('hash');
    expect(out.embedderReason).toMatch(/onnx runtime missing/);
    expect(bridgeEmbed).not.toHaveBeenCalled();
  });

  it('a non-384-d onnx vector is rejected (router index is 384-d)', async () => {
    localEmbed.mockImplementation(async () => ({ embedding: new Array(768).fill(0.01), dimensions: 768, model: 'onnx', backend: 'onnx' as const }));
    const res = await embedForRouter(['a', 'b'], 'minilm');
    expect(res.embedder).toBe('hash');
    expect(res.reason).toMatch(/768-d/);
    expect(res.vectors).toHaveLength(2);
    expect(Array.from(res.vectors[0])).toEqual(Array.from(generateSimpleEmbedding('a')));
  });

  it('query fails after a MiniLM index was built: index is rebuilt with hash so spaces never mix', async () => {
    process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = 'minilm';
    const task = 'profile the slow query';
    localEmbed.mockImplementation(async (t: string) => {
      if (t === task) throw new Error('model evicted');
      return fakeOnnx(t);
    });

    const out = await route(task);

    expect(out.embedder).toBe('hash');
    expect(out.embedderReason).toMatch(/model evicted/);
  });

  it('switching the env embedder rebuilds the index', async () => {
    localEmbed.mockImplementation(async (t: string) => fakeOnnx(t));
    expect((await route('improve test coverage')).embedder).toBe('hash');
    expect(localEmbed).not.toHaveBeenCalled();

    process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = 'minilm';
    expect((await route('improve test coverage')).embedder).toBe('minilm');
    expect(localEmbed).toHaveBeenCalled();
  });
});

describe('ADR-390 bench entry', () => {
  it('routeTaskForBench returns the same primary agent hooks_route does, for both embedders', async () => {
    localEmbed.mockImplementation(async (t: string) => fakeOnnx(t));
    const tasks = ['write unit tests for the auth module', 'deploy the service with docker', 'refactor the parser'];
    for (const kind of ['hash', 'minilm'] as const) {
      process.env.CLAUDE_FLOW_ROUTER_EMBEDDER = kind;
      for (const task of tasks) {
        const viaTool = await route(task);
        const viaBench = await routeTaskForBench(task, { embedder: kind });
        expect(viaBench.embedder).toBe(kind);
        expect(viaBench.primaryAgent).toBe(viaTool.primaryAgent.type);
      }
    }
    expect(bridgeEmbed).not.toHaveBeenCalled();
  });
});

describe('ADR-390 static guard (#2312)', () => {
  it('router-embedder.ts has no call path to the bridge-first generateEmbedding', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '../src/ruvector/router-embedder.ts'), 'utf8')
      .split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n'); // drop comments
    expect(src).toMatch(/generateLocalEmbedding/);
    expect(src).not.toMatch(/(?<![A-Za-z])generateEmbedding\s*\(/);
    expect(src).not.toMatch(/\{\s*generateEmbedding\s*[,}]/);
  });
});

// ── Real model (no mocks) ───────────────────────────────────────────────────
function localMiniLMCached(): boolean {
  const req = createRequire(import.meta.url);
  for (const pkg of ['@huggingface/transformers', '@xenova/transformers']) {
    try {
      let dir = dirname(req.resolve(pkg));
      for (let i = 0; i < 4 && !existsSync(join(dir, 'package.json')); i++) dir = dirname(dir);
      if (existsSync(join(dir, '.cache', 'Xenova', 'all-MiniLM-L6-v2'))) return true;
    } catch { /* not installed */ }
  }
  return false;
}

// The real model runs in a plain `node` child against the built dist: inside the
// vitest worker the transformers pipeline does not initialise and the local
// chain reports backend 'mock' (observed), which would test the harness, not
// the router. Skips unless both the model cache and dist exist.
const distHooks = join(dirname(fileURLToPath(import.meta.url)), '../dist/src/mcp-tools/hooks-tools.js');

describe.skipIf(!localMiniLMCached() || !existsSync(distHooks))('ADR-390 real MiniLM (runs only when the model is cached locally)', () => {
  it('routes "write unit tests for the auth module" to tester with embedder=minilm', () => {
    const script = `import(${JSON.stringify(pathToFileURL(distHooks).href)}).then(async (h) => {
      const r = await h.routeTaskForBench('write unit tests for the auth module', { embedder: 'minilm' });
      process.stdout.write('\\nRESULT=' + JSON.stringify(r) + '\\n');
    });`;
    const stdout = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 110_000, env: { ...process.env, CLAUDE_FLOW_ROUTER_TYPESAFE: '' } });
    const line = stdout.split('\n').find(l => l.startsWith('RESULT='));
    expect(line, stdout).toBeDefined();
    const out = JSON.parse(line!.slice('RESULT='.length));
    expect(out.embedder, out.embedderReason).toBe('minilm');
    expect(out.primaryAgent).toBe('tester');
  }, 120_000);
});
