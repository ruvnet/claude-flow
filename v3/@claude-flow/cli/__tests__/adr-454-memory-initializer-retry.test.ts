/**
 * ADR-454 — writable embedding model cache + retryable degraded-embedder state.
 *
 * #3692: a system-prefix global install's package-relative model cache dir
 * is root-owned, so an ordinary user hits EACCES the first time
 * `loadLocalEmbeddingChain()` tries to initialize transformers.js. Before
 * this fix, ANY failure on that path (including a transient/fixable one)
 * memoized `embeddingModelState.loaded = true` with the hash fallback
 * permanently for the rest of the process's life — the "already-running
 * workers required a restart" symptom. This suite proves:
 *
 *  1. A real backend that THROWS during init (EACCES-shaped) is marked
 *     `degradedReason: 'retryable'`, not permanent.
 *  2. A retryable failure does NOT re-attempt before `MODEL_INIT_RETRY_INTERVAL_MS`
 *     elapses (no retry-storm regression).
 *  3. A retryable failure DOES re-attempt — and recovers to `backend: 'onnx'`
 *     — once the interval has elapsed, without a process restart.
 *  4. No real backend importable at all is marked `degradedReason: 'permanent'`
 *     and is NEVER retried, even long after the interval elapses.
 *  5. `env.cacheDir` is resolved and set before `pipelineFn(...)` is invoked.
 *  6. Hot path: once healthy (backend 'onnx'), repeated embed calls do not
 *     re-run cache-dir resolution / re-invoke the pipeline factory.
 *  7. ADR-390's `backend: 'onnx' | 'mock'` contract keeps reporting accurately
 *     in both the recovered and the permanently-degraded case.
 *
 * London-school: the transformers packages, agentic-flow, and ruvector are
 * all mocked via hoisted mutable state (mirrors the established pattern in
 * `issue-3375-rescue-local-embedder.test.ts`) so each test can drive the
 * exact failure shape without touching the network or a real ONNX model.
 * `generateLocalEmbedding()` is used directly — per its own contract it never
 * consults the AgentDB bridge, so no bridge setup is needed here.
 *
 * `embeddingModelState` is private module state, so every test gets an
 * isolated instance via `vi.resetModules()` + a fresh dynamic import.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type PipelineMode = 'absent' | 'throw' | 'succeed';

const local = vi.hoisted(() => ({
  hfMode: 'absent' as PipelineMode,
  xenMode: 'absent' as PipelineMode,
  hfEnv: {} as Record<string, unknown>,
  xenEnv: {} as Record<string, unknown>,
  hfCacheDirAtCallTime: undefined as string | undefined,
  xenCacheDirAtCallTime: undefined as string | undefined,
  pipelineCallCount: 0,
  vec(text: string): number[] {
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return Array.from({ length: 384 }, (_, i) => Math.sin(h + i * 7) + 1.5);
  },
}));

function makePipelineGetter(which: 'hf' | 'xen') {
  return function pipeline() {
    const mode = which === 'hf' ? local.hfMode : local.xenMode;
    if (mode === 'absent') return undefined;
    return async (_task: string, _model?: string) => {
      local.pipelineCallCount++;
      const env = which === 'hf' ? local.hfEnv : local.xenEnv;
      if (which === 'hf') local.hfCacheDirAtCallTime = env.cacheDir as string | undefined;
      else local.xenCacheDirAtCallTime = env.cacheDir as string | undefined;
      if (mode === 'throw') {
        const err: NodeJS.ErrnoException = new Error('EACCES: permission denied, mkdir');
        err.code = 'EACCES';
        throw err;
      }
      // The resolved "extractor" — the callable returned by a real
      // pipeline('feature-extraction', ...) call.
      return async (text: string) => ({ data: Float32Array.from(local.vec(text)) });
    };
  };
}

vi.mock('@huggingface/transformers', () => ({
  get pipeline() {
    return makePipelineGetter('hf')();
  },
  get env() {
    return local.hfEnv;
  },
}));
vi.mock('@xenova/transformers', () => ({
  get pipeline() {
    return makePipelineGetter('xen')();
  },
  get env() {
    return local.xenEnv;
  },
}));
// Every fallback below the transformers branches is disabled so the hash
// fallback (the branch under test) is reliably reached.
vi.mock('agentic-flow/reasoningbank', () => ({ computeEmbedding: undefined }));
vi.mock('agentic-flow', () => ({ embeddings: undefined }));
vi.mock('ruvector', () => ({ initOnnxEmbedder: undefined, getOptimizedOnnxEmbedder: undefined }));

async function freshInit() {
  vi.resetModules();
  return await import('../src/memory/memory-initializer.js');
}

let tmpRoot: string;

beforeEach(() => {
  vi.useFakeTimers();
  local.hfMode = 'absent';
  local.xenMode = 'absent';
  local.hfEnv = {};
  local.xenEnv = {};
  local.hfCacheDirAtCallTime = undefined;
  local.xenCacheDirAtCallTime = undefined;
  local.pipelineCallCount = 0;
  delete process.env.TRANSFORMERS_CACHE;
  delete process.env.HF_HOME;
  delete process.env.RUFLO_REQUIRE_REAL_EMBEDDINGS;
  // generateLocalEmbedding() never touches the bridge per its own contract,
  // but generateEmbedding() (exercised once below) is bridge-first — force
  // the bridge off so that call stays on the local chain under test too,
  // instead of importing the real memory-bridge.js / AgentDB machinery.
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-mem-init-adr454-'));
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ADR-454 permanent degraded state (no transformers package importable)', () => {
  it('marks the hash fallback permanent and never retries, even long after the retry interval elapses', async () => {
    const init = await freshInit();

    const out1 = await init.generateLocalEmbedding('hello');
    expect(out1.backend).toBe('mock');
    expect(out1.dimensions).toBe(128);
    expect(local.pipelineCallCount).toBe(0);

    // Advance well past MODEL_INIT_RETRY_INTERVAL_MS (60s) and even flip the
    // backend to "would now succeed" — a permanent state must not care.
    vi.advanceTimersByTime(10 * 60_000);
    local.hfMode = 'succeed';

    const out2 = await init.generateLocalEmbedding('hello again, much later');
    expect(out2.backend).toBe('mock');
    expect(local.pipelineCallCount).toBe(0);
  });
});

describe('ADR-454 retryable degraded state (a real backend existed but init threw)', () => {
  it('marks retryable on an EACCES-shaped pipeline failure, does not retry before the interval elapses, and recovers to onnx after it does', async () => {
    local.hfMode = 'throw';
    const init = await freshInit();

    const out1 = await init.generateLocalEmbedding('alpha task');
    expect(out1.backend).toBe('mock');
    expect(out1.dimensions).toBe(128);
    expect(local.pipelineCallCount).toBe(1);

    // Too soon (30s < 60s interval): must return the cached degraded state,
    // not re-attempt — even though the backend has since "recovered".
    vi.advanceTimersByTime(30_000);
    local.hfMode = 'succeed'; // e.g. an admin fixed the cache-dir permissions
    const out2 = await init.generateLocalEmbedding('beta task, still too soon');
    expect(out2.backend).toBe('mock');
    expect(local.pipelineCallCount).toBe(1); // not re-attempted

    // Interval elapsed (30_000 + 30_001 = 60_001ms since the failed attempt):
    // must re-attempt and recover without a process restart.
    vi.advanceTimersByTime(30_001);
    const out3 = await init.generateLocalEmbedding('gamma task, now it works');
    expect(out3.backend).toBe('onnx');
    expect(out3.dimensions).toBe(384);
    expect(local.pipelineCallCount).toBe(2);
  });
});

describe('ADR-454 env.cacheDir set before pipelineFn(...) is called (memory-initializer.ts copy)', () => {
  it('resolves TRANSFORMERS_CACHE, creates the directory, and sets env.cacheDir before the hf pipeline is invoked', async () => {
    const cacheDir = join(tmpRoot, 'models');
    process.env.TRANSFORMERS_CACHE = cacheDir;
    local.hfMode = 'succeed';
    const init = await freshInit();

    const out = await init.generateLocalEmbedding('cache dir probe');
    expect(out.backend).toBe('onnx');
    expect(local.hfCacheDirAtCallTime).toBe(cacheDir);
    expect(existsSync(cacheDir)).toBe(true);
  });
});

describe('ADR-454 hot path: healthy onnx state does no redundant work per embed call', () => {
  it('does not re-resolve the cache dir or re-invoke the pipeline factory on subsequent healthy calls', async () => {
    const cacheDir = join(tmpRoot, 'models');
    process.env.TRANSFORMERS_CACHE = cacheDir;
    local.hfMode = 'succeed';
    const init = await freshInit();

    const out1 = await init.generateLocalEmbedding('task one');
    expect(out1.backend).toBe('onnx');
    expect(local.pipelineCallCount).toBe(1);

    // Many more calls on an already-healthy state must not touch the
    // pipeline factory (which is where cache-dir resolution + mkdir live)
    // again — only the retry-interval `Date.now()` comparison should run.
    await init.generateLocalEmbedding('task two');
    await init.generateLocalEmbedding('task three');
    await init.generateLocalEmbedding('task four');
    expect(local.pipelineCallCount).toBe(1);
  });
});

describe('ADR-454 / ADR-390 backend field regression guard', () => {
  it('reports backend:"onnx" in the recovered case and backend:"mock" in the permanently-degraded case', async () => {
    // Permanently degraded: no backend importable at all.
    const degradedInit = await freshInit();
    const degraded = await degradedInit.generateLocalEmbedding('no backend available');
    expect(degraded.backend).toBe('mock');

    // Recovered: a real backend loads successfully from a cold state.
    local.hfMode = 'succeed';
    const recoveredInit = await freshInit();
    const recovered = await recoveredInit.generateLocalEmbedding('real backend available');
    expect(recovered.backend).toBe('onnx');

    // generateEmbedding() (bridge-first, but no bridge configured here so it
    // falls through to the local chain) must report the same backend truthfully.
    const viaGenerateEmbedding = await recoveredInit.generateEmbedding('real backend available via generateEmbedding');
    expect(viaGenerateEmbedding.backend).toBe('onnx');
  });
});
