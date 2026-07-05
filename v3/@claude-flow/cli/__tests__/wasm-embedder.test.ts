/**
 * Optional WASM embedder tier — opt-in + fail-closed degradation.
 * Not configured (no RUFLO_EMBED_WASM_PKG) ⇒ inert; callers fall through to
 * ruvector ONNX → hash with zero regression.
 */
import { describe, it, expect } from 'vitest';
import {
  wasmEmbedderAvailable, wasmEmbed, wasmEmbedderModels, EMBED_WASM_PKG, DEFAULT_EMBED_MODEL,
} from '../src/ruvector/wasm-embedder.js';

describe('optional wasm embedder (opt-in, fail-closed)', () => {
  it('is INERT when no package is configured (no 404-by-default)', async () => {
    expect(EMBED_WASM_PKG).toBe('');                 // no default package — opt-in only
    expect(await wasmEmbedderAvailable()).toBe(false);
    expect(await wasmEmbed('hello world')).toBeNull(); // → caller falls through to next tier
    expect(wasmEmbedderModels()).toEqual([]);
  });

  it('exposes a default model + is env-configurable', () => {
    expect(DEFAULT_EMBED_MODEL).toBeTruthy();          // via RUFLO_EMBED_MODEL
  });
});
