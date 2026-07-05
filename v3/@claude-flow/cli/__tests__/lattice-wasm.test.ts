/**
 * Lattice WASM embedder adapter — fail-closed degradation (embedding substrate).
 * The package is optional + not installed in CI, so these assert the ZERO-
 * REGRESSION path: absent Lattice ⇒ unavailable + null, callers fall through.
 */
import { describe, it, expect } from 'vitest';
import {
  latticeAvailable, latticeEmbed, latticeModels, LATTICE_WASM_PKG, DEFAULT_LATTICE_MODEL,
} from '../src/ruvector/lattice-wasm.js';

describe('lattice-wasm adapter (fail-closed)', () => {
  it('reports unavailable and returns null when the package is absent', async () => {
    expect(await latticeAvailable()).toBe(false);          // optional dep not installed
    expect(await latticeEmbed('hello world')).toBeNull();   // → caller falls through to next tier
    expect(await latticeEmbed('x', 'qwen3-0.6b')).toBeNull(); // GPU model path also degrades
    expect(latticeModels()).toEqual([]);                    // no models advertised until available
  });

  it('exposes a configurable package specifier and a default model', () => {
    expect(LATTICE_WASM_PKG).toContain('lattice');          // overridable via RUFLO_LATTICE_WASM_PKG
    expect(DEFAULT_LATTICE_MODEL).toBeTruthy();             // selectable via RUFLO_EMBED_MODEL
  });
});
