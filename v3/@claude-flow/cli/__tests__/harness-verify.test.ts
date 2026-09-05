/**
 * Adversarial + drift verify gate (ADR-176 phase 4) — fail-closed.
 */
import { describe, it, expect } from 'vitest';
import { runVerify } from '../src/services/harness-verify.js';

describe('runVerify', () => {
  it('passes when redblue PASS and drift within threshold', async () => {
    const r = await runVerify({ redblue: async () => 'PASS', drift: async () => 0.01 });
    expect(r.adversarialPass).toBe(true);
    expect(r.driftVerdict).toBe('ok');
  });

  it('fails when redblue FAILs', async () => {
    const r = await runVerify({ redblue: async () => 'FAIL', drift: async () => 0.01 });
    expect(r.adversarialPass).toBe(false);
  });

  it('fails when drift regresses past threshold', async () => {
    const r = await runVerify({ redblue: async () => 'PASS', drift: async () => 0.2, driftThreshold: 0.05 });
    expect(r.adversarialPass).toBe(false);
    expect(r.driftVerdict).toBe('regressed');
  });

  it('FAIL-CLOSED: defaults to SKIPPED (no verifier wired) → cannot promote', async () => {
    const r = await runVerify();
    expect(r.redblue).toBe('SKIPPED');
    expect(r.adversarialPass).toBe(false); // no promotion without real adversarial evidence
  });

  it('a throwing redblue runner is SKIPPED, not a pass (degrade)', async () => {
    const r = await runVerify({ redblue: async () => { throw new Error('metaharness absent'); }, drift: async () => 0 });
    expect(r.redblue).toBe('SKIPPED');
    expect(r.adversarialPass).toBe(false);
  });

  it('a negative drift (unavailable) is skipped, not ok', async () => {
    const r = await runVerify({ redblue: async () => 'PASS', drift: async () => -1 });
    expect(r.driftVerdict).toBe('skipped');
    expect(r.adversarialPass).toBe(false);
  });
});
