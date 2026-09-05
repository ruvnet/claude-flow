/**
 * Benchmark corpus + held-out gate + accept() conjunction (ADR-176 phase 2).
 */
import { describe, it, expect } from 'vitest';
import {
  hashCorpus, verifyCorpus, scoreOnTasks, computeHeldOutSplit, accept,
  type BenchTask, type HarnessBenchmarkCorpus, type PromotionVerdict,
} from '../src/services/harness-benchmark.js';

function tasks(n: number): BenchTask[] {
  // task i: input=i, expected=2*i. A "candidate" is a multiplier.
  return Array.from({ length: n }, (_, i) => ({ id: `t${String(i).padStart(3, '0')}`, input: i, expected: 2 * i }));
}
const evalFn = (input: unknown, mult: number) => (input as number) * mult;
const gradeFn = (out: unknown, exp: unknown) => (out === exp ? 1 : 0);

describe('corpus integrity', () => {
  it('hash matches its tasks; tampering breaks verify', () => {
    const c: HarnessBenchmarkCorpus = { version: 'v1', tasks: tasks(10), corpusHash: hashCorpus(tasks(10)) };
    expect(verifyCorpus(c)).toBe(true);
    const tampered = { ...c, tasks: [...c.tasks.slice(1), { id: 't999', input: 1, expected: 999 }] };
    expect(verifyCorpus(tampered)).toBe(false);
  });
});

describe('held-out split (deterministic, disjoint)', () => {
  it('splits ~holdoutFrac, disjoint, reproducible', () => {
    const t = tasks(100);
    const a = computeHeldOutSplit(t, 0.2);
    const b = computeHeldOutSplit([...t].reverse(), 0.2); // order-independent
    expect(a.heldOut.length).toBe(20);
    expect(a.train.length).toBe(80);
    const trainIds = new Set(a.train.map(x => x.id));
    expect(a.heldOut.every(x => !trainIds.has(x.id))).toBe(true); // disjoint
    expect(a.heldOut.map(x => x.id)).toEqual(b.heldOut.map(x => x.id)); // reproducible
  });
});

describe('scoring — measured, not marketing', () => {
  it('a correct candidate scores 1.0; a wrong one lower', () => {
    const t = tasks(50);
    const good = scoreOnTasks(t, 2, evalFn, gradeFn);   // mult=2 is exactly right
    const bad = scoreOnTasks(t, 3, evalFn, gradeFn);
    expect(good.fitness).toBe(1);
    expect(good.passRate).toBe(1);
    expect(bad.fitness).toBeLessThan(1);
    // eslint-disable-next-line no-console
    console.log(`[bench] candidate mult=2 held-out fitness=${good.fitness} vs mult=3 fitness=${bad.fitness.toFixed(3)}`);
  });

  it('held-out delta: improved candidate beats baseline on the held-out split', () => {
    const t = tasks(100);
    const { heldOut } = computeHeldOutSplit(t, 0.2);
    // baseline mult=3 (wrong), champion mult=2 (right) — improvement is measured on held-out.
    const baseline = scoreOnTasks(heldOut, 3, evalFn, gradeFn);
    const champion = scoreOnTasks(heldOut, 2, evalFn, gradeFn);
    expect(champion.fitness).toBeGreaterThan(baseline.fitness);
  });
});

describe('accept() — conjunction of externally-measurable predicates', () => {
  const passing: PromotionVerdict = {
    heldOutScore: 0.82, baselineHeldOutScore: 0.79,
    redblue: 'PASS', drift: 0.01, driftThreshold: 0.05,
    replayDeterministic: true, receiptCoverage: 1,
    canaryRollbackRate: 0.02, baselineRollbackRate: 0.03,
  };

  it('accepts when every term holds', () => {
    const r = accept(passing);
    expect(r.accept).toBe(true);
    expect(r.failed).toEqual([]);
  });

  it('rejects on ANY single failing term', () => {
    expect(accept({ ...passing, heldOutScore: 0.79 }).failed).toContain('held_out_improves');
    expect(accept({ ...passing, redblue: 'FAIL' }).failed).toContain('redblue_pass');
    expect(accept({ ...passing, drift: 0.1 }).failed).toContain('drift_within');
    expect(accept({ ...passing, replayDeterministic: false }).failed).toContain('replay_deterministic');
    expect(accept({ ...passing, receiptCoverage: 0.9 }).failed).toContain('receipt_coverage_full');
    expect(accept({ ...passing, canaryRollbackRate: 0.05 }).failed).toContain('canary_no_worse');
    // each of the above is accept:false
    for (const over of [{ heldOutScore: 0.79 }, { redblue: 'FAIL' as const }, { drift: 0.1 }, { replayDeterministic: false }, { receiptCoverage: 0.9 }, { canaryRollbackRate: 0.05 }]) {
      expect(accept({ ...passing, ...over }).accept).toBe(false);
    }
  });
});
