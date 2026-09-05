/**
 * Loop orchestrator (ADR-176 phase 8) — composition + fail-closed gates.
 */
import { describe, it, expect } from 'vitest';
import { runHarnessLoop, type HarnessLoopOptions } from '../src/services/harness-loop.js';
import { hashCorpus, type BenchTask, type HarnessBenchmarkCorpus } from '../src/services/harness-benchmark.js';
import type { Trajectory, ReplayFn } from '../src/services/harness-qualification.js';
import type { CanaryRunner } from '../src/services/harness-canary.js';

function corpus(n = 100): HarnessBenchmarkCorpus {
  const tasks: BenchTask[] = Array.from({ length: n }, (_, i) => ({ id: 't' + String(i).padStart(3, '0'), input: i, expected: 2 * i }));
  return { version: 'LAB-v1', tasks, corpusHash: hashCorpus(tasks) };
}
const evalFn = (input: unknown, mult: number) => (input as number) * mult;
const gradeFn = (o: unknown, e: unknown) => (o === e ? 1 : 0);

const trajectories: Trajectory[] = [
  { id: 'a', steps: [{ action: 'edit', tier: 'oracle:test-exec' }], outcome: 'success', benchmarkTaskId: 'LAB-v1/t1', inputs: { x: 1 }, recordedOutputs: { ok: true } },
  { id: 'b', steps: [{ action: 'test', tier: 'oracle:test-exec' }], outcome: 'success', benchmarkTaskId: 'LAB-v1/t2', inputs: { x: 2 }, recordedOutputs: { ok: true } },
];
const replay: ReplayFn = (t) => t.recordedOutputs;

// candidate mult=2 is correct; baseline mult=3 wrong. Canary: correct mult never rolls back.
const canaryRunner: CanaryRunner<number> = (_input, mult) => ({ ok: mult === 2, rolledBack: mult !== 2, latencyMs: 10, costUsd: 0.001, accepted: mult === 2 });

function base(over: Partial<HarnessLoopOptions<number>> = {}): HarnessLoopOptions<number> {
  return {
    trajectories, corpus: corpus(), baseline: 3, candidate: 2, evalFn, gradeFn, replay,
    verify: { redblue: async () => 'PASS', drift: async () => 0.01 },
    canaryRunner, policyRefOf: (c) => 'sha256:policy-' + c, layer: 'framework/node-cli',
    ...over,
  };
}

describe('runHarnessLoop', () => {
  it('ACCEPTS when every gate holds and emits an unsigned champion manifest with a receipt', async () => {
    const r = await runHarnessLoop(base());
    expect(r.accepted).toBe(true);
    expect(r.verdict?.accept).toBe(true);
    expect(r.manifest).toBeDefined();
    expect(r.manifest!.policy.ref).toBe('sha256:policy-2');
    expect(r.manifest!.receipt!.heldOutDelta).toBeGreaterThan(0); // candidate beats baseline
    expect(r.manifest!.benchmark!.corpus).toBe('LAB-v1');
    expect(r.manifest!.layer).toBe('framework/node-cli');
  });

  it('does not promote without a candidate', async () => {
    const r = await runHarnessLoop(base({ candidate: undefined }));
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/no candidate/);
  });

  it('does not promote with no qualified trajectories (receipt_coverage=0)', async () => {
    const r = await runHarnessLoop(base({ trajectories: [{ ...trajectories[0], benchmarkTaskId: undefined }] }));
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/no qualified/);
  });

  it('FAIL-CLOSED: SKIPPED adversarial verify (default, no runner) cannot promote', async () => {
    const r = await runHarnessLoop(base({ verify: {} }));
    expect(r.accepted).toBe(false);
    expect(r.verify?.redblue).toBe('SKIPPED');
  });

  it('requires a canary runner (separate promotion from deployment)', async () => {
    const r = await runHarnessLoop(base({ canaryRunner: undefined }));
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/canary required/);
  });

  it('rejects a candidate that does not beat baseline on held-out', async () => {
    const r = await runHarnessLoop(base({ baseline: 2, candidate: 3 })); // candidate now the wrong one
    expect(r.accepted).toBe(false);
    expect(r.verdict?.failed).toContain('held_out_improves');
    expect(r.manifest).toBeUndefined();
  });

  it('rejects when the adversarial red-team FAILs', async () => {
    const r = await runHarnessLoop(base({ verify: { redblue: async () => 'FAIL', drift: async () => 0 } }));
    expect(r.accepted).toBe(false);
    expect(r.verdict?.failed).toContain('redblue_pass');
  });
});
