/**
 * Canary — bounded live-slice telemetry + no-worse gate (ADR-176 phase 5).
 */
import { describe, it, expect } from 'vitest';
import { runCanary, compareCanary, type CanaryRunner, type CanaryTelemetry } from '../src/services/harness-canary.js';

function slice(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: 't' + String(i).padStart(4, '0'), input: i }));
}

describe('runCanary', () => {
  it('bounds the sample by fraction and maxSamples', () => {
    const runner: CanaryRunner<number> = () => ({ ok: true, rolledBack: false, latencyMs: 10, costUsd: 0.001, accepted: true });
    expect(runCanary(0, slice(1000), runner, { sampleFraction: 0.1, maxSamples: 50 }).n).toBe(50); // cap
    expect(runCanary(0, slice(200), runner, { sampleFraction: 0.1 }).n).toBeLessThanOrEqual(20 + 1);
  });

  it('aggregates rollback/failure/acceptance rates + p95 latency + cost', () => {
    // 20% roll back, latencies spread 1..100, cost 0.002 each.
    const runner: CanaryRunner<number> = (input) => {
      const i = input as number;
      const rolledBack = i % 5 === 0;
      return { ok: !rolledBack, rolledBack, latencyMs: (i % 100) + 1, costUsd: 0.002, accepted: !rolledBack };
    };
    const t = runCanary(0, slice(100), runner, { sampleFraction: 1, maxSamples: 100 });
    expect(t.n).toBe(100);
    expect(t.rollbackRate).toBeCloseTo(0.2, 5);
    expect(t.failureRate).toBeCloseTo(0.2, 5);
    expect(t.costPerTask).toBeCloseTo(0.002, 5);
    expect(t.latencyP95).toBeGreaterThan(t.latencyMean); // p95 above mean for a spread dist
    // eslint-disable-next-line no-console
    console.log(`[bench] canary: n=${t.n} rollback=${t.rollbackRate} p95=${t.latencyP95}ms cost/task=$${t.costPerTask}`);
  });

  it('treats a throwing runner as a rollback/failure (fail-closed)', () => {
    const t = runCanary(0, slice(10), () => { throw new Error('boom'); }, { sampleFraction: 1 });
    expect(t.rollbackRate).toBe(1);
    expect(t.failureRate).toBe(1);
  });
});

describe('compareCanary — no-worse gate', () => {
  const base: CanaryTelemetry = { n: 100, rollbackRate: 0.05, failureRate: 0.05, acceptanceRate: 0.9, latencyP95: 100, latencyMean: 50, costPerTask: 0.003, costTotalUsd: 0.3 };

  it('passes when candidate is no worse', () => {
    const better: CanaryTelemetry = { ...base, rollbackRate: 0.02, latencyP95: 90, costPerTask: 0.0025 };
    expect(compareCanary(better, base).pass).toBe(true);
  });

  it('fails when rollback / latency / cost regress', () => {
    expect(compareCanary({ ...base, rollbackRate: 0.06 }, base).failed).toContain('rollback_no_worse');
    expect(compareCanary({ ...base, latencyP95: 200 }, base).failed).toContain('latency_no_worse');
    expect(compareCanary({ ...base, costPerTask: 0.01 }, base).failed).toContain('cost_no_worse');
  });
});
