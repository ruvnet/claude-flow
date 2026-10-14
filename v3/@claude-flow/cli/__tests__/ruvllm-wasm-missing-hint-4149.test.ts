/**
 * #4149: with @ruvector/ruvllm-wasm absent (the state of a plain global
 * install) every ruvllm_* tool but ruvllm_status failed with a bare
 * ERR_MODULE_NOT_FOUND. The error and the status must say how to fix it.
 * The package is deliberately not a dependency of this workspace, so these
 * tests run against the real missing-module path with no mocks.
 */
import { describe, it, expect } from 'vitest';
import {
  getRuvllmStatus,
  initRuvllmWasm,
  isRuvllmWasmAvailable,
} from '../src/ruvector/ruvllm-wasm.js';

describe('#4149 missing @ruvector/ruvllm-wasm is actionable', () => {
  it('precondition: the package is not installed here', async () => {
    expect(await isRuvllmWasmAvailable()).toBe(false);
  });

  it('getRuvllmStatus carries an install hint when unavailable', async () => {
    const s = await getRuvllmStatus();
    expect(s.available).toBe(false);
    expect(s.hint).toMatch(/npm i(nstall)? (-g )?@ruvector\/ruvllm-wasm/);
  });

  it('initRuvllmWasm names the package and the install command', async () => {
    await expect(initRuvllmWasm()).rejects.toThrow(/npm i(nstall)? (-g )?@ruvector\/ruvllm-wasm/);
  });
});
