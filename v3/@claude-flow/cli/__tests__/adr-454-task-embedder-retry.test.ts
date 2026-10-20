/**
 * ADR-454 — task-embedder.ts's own permanent-vs-retryable bug.
 *
 * Separate from `memory-initializer.ts`'s bug: `loadExtractor()` cached
 * `_extractorPromise` permanently even when it resolved to `null` on a
 * transient/fixable failure (e.g. EACCES on the model cache dir), with no
 * way to distinguish that from a genuinely missing dependency. This suite
 * proves the same retryable/permanent distinction holds here, plus the
 * cache-dir fix and the hot-path no-redundant-work requirement.
 *
 * `embedTaskWithCache()` never throws and never consults any bridge, so no
 * bridge setup is needed. Module state is reset via the file's own test
 * seam, `__resetTaskEmbedderForTests()`, rather than `vi.resetModules()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetTaskEmbedderForTests,
  embedTaskWithCache,
  embedTaskWithCacheBatch,
} from '../src/ruvector/task-embedder.js';

type PipelineMode = 'absent' | 'throw' | 'succeed';

const local = vi.hoisted(() => ({
  mode: 'absent' as PipelineMode,
  env: {} as Record<string, unknown>,
  cacheDirAtCallTime: undefined as string | undefined,
  pipelineCallCount: 0,
}));

vi.mock('@xenova/transformers', () => ({
  get pipeline() {
    if (local.mode === 'absent') return undefined;
    return async (_task: string, _model?: string, _opts?: unknown) => {
      local.pipelineCallCount++;
      local.cacheDirAtCallTime = local.env.cacheDir as string | undefined;
      if (local.mode === 'throw') {
        const err: NodeJS.ErrnoException = new Error('EACCES: permission denied, mkdir');
        err.code = 'EACCES';
        throw err;
      }
      // The "extractor" callable returned by a real pipeline(...) call,
      // supporting both single-text and array-input modes.
      return async (input: string | string[], _opts: unknown) => {
        const texts = Array.isArray(input) ? input : [input];
        const dim = 384;
        const data = new Float32Array(texts.length * dim).fill(0.5);
        return { data, dims: [texts.length, dim] };
      };
    };
  },
  get env() {
    return local.env;
  },
}));

let tmpRoot: string;

beforeEach(() => {
  vi.useFakeTimers();
  __resetTaskEmbedderForTests();
  local.mode = 'absent';
  local.env = {};
  local.cacheDirAtCallTime = undefined;
  local.pipelineCallCount = 0;
  delete process.env.TRANSFORMERS_CACHE;
  delete process.env.HF_HOME;
  tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-task-embedder-adr454-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ADR-454 permanent degraded state (no @xenova/transformers pipeline export)', () => {
  it('returns undefined and never retries, even long after the retry interval elapses', async () => {
    const out1 = await embedTaskWithCache('alpha task');
    expect(out1).toBeUndefined();
    expect(local.pipelineCallCount).toBe(0);

    vi.advanceTimersByTime(10 * 60_000);
    local.mode = 'succeed'; // "the package got installed" — must not matter

    const out2 = await embedTaskWithCache('beta task, much later');
    expect(out2).toBeUndefined();
    expect(local.pipelineCallCount).toBe(0);
  });
});

describe('ADR-454 retryable degraded state (pipeline present but init threw)', () => {
  it('returns undefined on an EACCES-shaped failure, does not retry before the interval elapses, and recovers after it does', async () => {
    local.mode = 'throw';

    const out1 = await embedTaskWithCache('alpha task');
    expect(out1).toBeUndefined();
    expect(local.pipelineCallCount).toBe(1);

    // Too soon: must not re-attempt.
    vi.advanceTimersByTime(30_000);
    local.mode = 'succeed';
    const out2 = await embedTaskWithCache('beta task, still too soon');
    expect(out2).toBeUndefined();
    expect(local.pipelineCallCount).toBe(1);

    // Interval elapsed: must re-attempt and recover.
    vi.advanceTimersByTime(30_001);
    const out3 = await embedTaskWithCache('gamma task, now it works');
    expect(out3).toBeDefined();
    expect(out3).toHaveLength(384);
    expect(local.pipelineCallCount).toBe(2);
  });
});

describe('ADR-454 env.cacheDir set before pipeline(...) is called (task-embedder.ts copy)', () => {
  it('resolves TRANSFORMERS_CACHE, creates the directory, and sets env.cacheDir before the pipeline is invoked', async () => {
    const cacheDir = join(tmpRoot, 'models');
    process.env.TRANSFORMERS_CACHE = cacheDir;
    local.mode = 'succeed';

    const out = await embedTaskWithCache('cache dir probe task');
    expect(out).toBeDefined();
    expect(local.cacheDirAtCallTime).toBe(cacheDir);
    expect(existsSync(cacheDir)).toBe(true);
  });
});

describe('ADR-454 hot path: healthy extractor does no redundant work per embed call', () => {
  it('loads the pipeline once and does not re-invoke it on subsequent cache-miss calls', async () => {
    const cacheDir = join(tmpRoot, 'models');
    process.env.TRANSFORMERS_CACHE = cacheDir;
    local.mode = 'succeed';

    const out1 = await embedTaskWithCache('task one');
    expect(out1).toBeDefined();
    expect(local.pipelineCallCount).toBe(1);

    // Distinct task text each time so these are cache MISSES, not hits —
    // the embedder itself runs again, but the pipeline factory (where
    // cache-dir resolution + mkdir live) must not re-run.
    await embedTaskWithCache('task two');
    await embedTaskWithCache('task three');
    const batch = await embedTaskWithCacheBatch(['task four', 'task five']);
    expect(batch.every((v) => v !== undefined)).toBe(true);

    expect(local.pipelineCallCount).toBe(1);
  });
});
