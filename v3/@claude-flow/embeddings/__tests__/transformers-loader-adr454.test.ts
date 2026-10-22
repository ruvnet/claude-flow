/**
 * ADR-454 — writable embedding model cache dir.
 *
 * Covers `transformers-loader.ts`'s `resolveModelCacheDir()` precedence
 * (TRANSFORMERS_CACHE > HF_HOME > ~/.cache/ruflo/models) and the requirement
 * that `env.cacheDir` is set on the resolved transformers module BEFORE the
 * returned `pipeline` function is ever invoked by a caller, for both the
 * `@huggingface/transformers` and `@xenova/transformers` branches.
 *
 * London-school: both packages are mocked via hoisted mutable state so each
 * test can flip availability/behavior without re-declaring `vi.mock`. Module
 * state (`cached`/`cacheChecked`) is private to transformers-loader.ts, so
 * every test gets an isolated instance via `vi.resetModules()` + a fresh
 * dynamic import.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  hfHasPipeline: false,
  xenHasPipeline: false,
  hfEnv: {} as Record<string, unknown>,
  xenEnv: {} as Record<string, unknown>,
  hfCacheDirAtCallTime: undefined as string | undefined,
  xenCacheDirAtCallTime: undefined as string | undefined,
}));

vi.mock('@huggingface/transformers', () => ({
  get pipeline() {
    if (!state.hfHasPipeline) return undefined;
    return async (_task: string, _model?: string) => {
      state.hfCacheDirAtCallTime = state.hfEnv.cacheDir as string | undefined;
      return async () => ({ data: new Float32Array(384) });
    };
  },
  get env() {
    return state.hfEnv;
  },
  version: '4.0.0-test',
}));

vi.mock('@xenova/transformers', () => ({
  get pipeline() {
    if (!state.xenHasPipeline) return undefined;
    return async (_task: string, _model?: string) => {
      state.xenCacheDirAtCallTime = state.xenEnv.cacheDir as string | undefined;
      return async () => ({ data: new Float32Array(384) });
    };
  },
  get env() {
    return state.xenEnv;
  },
  version: '2.17.0-test',
}));

let tmpRoot: string;

beforeEach(() => {
  vi.resetModules();
  state.hfHasPipeline = false;
  state.xenHasPipeline = false;
  state.hfEnv = {};
  state.xenEnv = {};
  state.hfCacheDirAtCallTime = undefined;
  state.xenCacheDirAtCallTime = undefined;
  delete process.env.TRANSFORMERS_CACHE;
  delete process.env.HF_HOME;
  tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-embeddings-adr454-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ADR-454 resolveModelCacheDir() precedence', () => {
  it('prefers TRANSFORMERS_CACHE when set', async () => {
    process.env.TRANSFORMERS_CACHE = '/custom/transformers-cache';
    process.env.HF_HOME = '/custom/hf-home';
    const { resolveModelCacheDir } = await import('../src/transformers-loader.js');
    expect(resolveModelCacheDir()).toBe('/custom/transformers-cache');
  });

  it('falls back to HF_HOME when TRANSFORMERS_CACHE is unset', async () => {
    process.env.HF_HOME = '/custom/hf-home';
    const { resolveModelCacheDir } = await import('../src/transformers-loader.js');
    expect(resolveModelCacheDir()).toBe('/custom/hf-home');
  });

  it('falls back to ~/.cache/ruflo/models when neither env var is set', async () => {
    const { resolveModelCacheDir } = await import('../src/transformers-loader.js');
    expect(resolveModelCacheDir()).toBe(join(homedir(), '.cache', 'ruflo', 'models'));
  });
});

describe('ADR-454 env.cacheDir set before pipeline(...) is called', () => {
  it('@huggingface/transformers branch: cache dir is created and env.cacheDir is set before the pipeline function is invoked', async () => {
    const cacheDir = join(tmpRoot, 'models');
    process.env.TRANSFORMERS_CACHE = cacheDir;
    state.hfHasPipeline = true;

    const { loadTransformersPipeline } = await import('../src/transformers-loader.js');
    const handle = await loadTransformersPipeline();

    expect(handle?.source).toBe('@huggingface/transformers');
    // env.cacheDir must already be the resolved path immediately after
    // loadTransformersPipeline() resolves, before any downstream pipeline() call.
    expect(state.hfEnv.cacheDir).toBe(cacheDir);
    expect(existsSync(cacheDir)).toBe(true);

    // Invoking the returned pipeline function (as a real caller would) must
    // see the cache dir already configured — proves ordering, not just
    // end-state.
    await handle!.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    expect(state.hfCacheDirAtCallTime).toBe(cacheDir);
  });

  it('@xenova/transformers branch: cache dir is created and env.cacheDir is set before the pipeline function is invoked', async () => {
    const cacheDir = join(tmpRoot, 'models');
    process.env.HF_HOME = cacheDir;
    state.hfHasPipeline = false; // force fallback to xenova
    state.xenHasPipeline = true;

    const { loadTransformersPipeline } = await import('../src/transformers-loader.js');
    const handle = await loadTransformersPipeline();

    expect(handle?.source).toBe('@xenova/transformers');
    expect(state.xenEnv.cacheDir).toBe(cacheDir);
    expect(existsSync(cacheDir)).toBe(true);

    await handle!.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    expect(state.xenCacheDirAtCallTime).toBe(cacheDir);
  });

  it('prefers @huggingface/transformers over @xenova/transformers when both are available', async () => {
    const cacheDir = join(tmpRoot, 'models');
    process.env.TRANSFORMERS_CACHE = cacheDir;
    state.hfHasPipeline = true;
    state.xenHasPipeline = true;

    const { loadTransformersPipeline } = await import('../src/transformers-loader.js');
    const handle = await loadTransformersPipeline();

    expect(handle?.source).toBe('@huggingface/transformers');
  });

  it('returns null and caches the miss when neither package exposes a pipeline function', async () => {
    const { loadTransformersPipeline, getCachedTransformersSource } = await import('../src/transformers-loader.js');
    const handle = await loadTransformersPipeline();
    expect(handle).toBeNull();
    expect(getCachedTransformersSource()).toBeNull();
  });
});
