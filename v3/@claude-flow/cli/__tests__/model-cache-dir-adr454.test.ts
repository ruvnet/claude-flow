/**
 * ADR-454 — `@claude-flow/cli`'s own copy of `resolveModelCacheDir()`.
 *
 * `v3/@claude-flow/cli/src/memory/model-cache-dir.ts` is an intentional,
 * dependency-free duplicate of `@claude-flow/embeddings/src/transformers-loader.ts`'s
 * helper of the same name (the CLI package has no dependency on
 * `@claude-flow/embeddings`, to avoid reintroducing the ADR-094 circular
 * optional-dep issue). Verified independently per the ADR: testing one copy
 * does not cover the other.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveModelCacheDir } from '../src/memory/model-cache-dir.js';

const savedEnv: { TRANSFORMERS_CACHE?: string; HF_HOME?: string } = {};

beforeEach(() => {
  savedEnv.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE;
  savedEnv.HF_HOME = process.env.HF_HOME;
  delete process.env.TRANSFORMERS_CACHE;
  delete process.env.HF_HOME;
});

afterEach(() => {
  if (savedEnv.TRANSFORMERS_CACHE === undefined) delete process.env.TRANSFORMERS_CACHE;
  else process.env.TRANSFORMERS_CACHE = savedEnv.TRANSFORMERS_CACHE;
  if (savedEnv.HF_HOME === undefined) delete process.env.HF_HOME;
  else process.env.HF_HOME = savedEnv.HF_HOME;
});

describe('ADR-454 resolveModelCacheDir() precedence (@claude-flow/cli copy)', () => {
  it('prefers TRANSFORMERS_CACHE when set', () => {
    process.env.TRANSFORMERS_CACHE = '/custom/transformers-cache';
    process.env.HF_HOME = '/custom/hf-home';
    expect(resolveModelCacheDir()).toBe('/custom/transformers-cache');
  });

  it('falls back to HF_HOME when TRANSFORMERS_CACHE is unset', () => {
    process.env.HF_HOME = '/custom/hf-home';
    expect(resolveModelCacheDir()).toBe('/custom/hf-home');
  });

  it('falls back to ~/.cache/ruflo/models when neither env var is set', () => {
    expect(resolveModelCacheDir()).toBe(join(homedir(), '.cache', 'ruflo', 'models'));
  });
});
