/**
 * Canary — separate promotion from deployment (ADR-176 phase 5).
 *
 * Held-out evaluation proves a candidate on FROZEN data; it has not observed
 * real-world behavior. The canary runs the candidate on a bounded, reversible
 * SLICE of live work and measures rollback rate, latency, cost, failure
 * frequency, and acceptance — the telemetry the accept() conjunction needs
 * (canary.rollback_rate <= baseline). Only after canary evidence does PROMOTE
 * fire. This is what stops benchmark-specific evolution from reaching global
 * rollout. Zero deps, $0 (the runner is injected; a real one meters real work).
 */

/** One canary run's observed outcome. */
export interface CanaryOutcome {
  ok: boolean;         // completed without error
  rolledBack: boolean; // the change had to be reverted
  latencyMs: number;
  costUsd: number;
  accepted: boolean;   // user/downstream accepted the result
}

/** Executes a candidate on one task input under real (or simulated) conditions. */
export type CanaryRunner<C> = (input: unknown, candidate: C) => CanaryOutcome;

export interface CanaryTelemetry {
  n: number;
  rollbackRate: number;   // rolledBack / n
  failureRate: number;    // !ok / n
  acceptanceRate: number; // accepted / n
  latencyP95: number;
  latencyMean: number;
  costPerTask: number;    // mean cost
  costTotalUsd: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export interface CanaryOptions {
  sampleFraction?: number; // fraction of the slice to run (default 0.1)
  maxSamples?: number;     // hard cap (default 100) — bounds cost + blast radius
}

/**
 * Run the candidate on a bounded, deterministic sample of the slice and
 * aggregate telemetry. Deterministic sampling (stride over id-sorted inputs) so
 * two runs converge (ADR-176 acceptance test).
 */
export function runCanary<C>(
  candidate: C,
  slice: Array<{ id: string; input: unknown }>,
  runner: CanaryRunner<C>,
  opts: CanaryOptions = {},
): CanaryTelemetry {
  const frac = opts.sampleFraction ?? 0.1;
  const cap = opts.maxSamples ?? 100;
  const ordered = [...slice].sort((a, b) => a.id.localeCompare(b.id));
  const want = Math.min(cap, Math.max(1, Math.round(ordered.length * frac)));
  // Even stride so the sample spans the slice rather than a contiguous head.
  const stride = Math.max(1, Math.floor(ordered.length / want));
  const sample: typeof ordered = [];
  for (let i = 0; i < ordered.length && sample.length < want; i += stride) sample.push(ordered[i]);

  const outcomes: CanaryOutcome[] = sample.map(s => {
    try { return runner(s.input, candidate); }
    catch { return { ok: false, rolledBack: true, latencyMs: 0, costUsd: 0, accepted: false }; }
  });

  const n = outcomes.length || 1;
  const lat = outcomes.map(o => o.latencyMs).sort((a, b) => a - b);
  const costTotal = outcomes.reduce((s, o) => s + o.costUsd, 0);
  return {
    n: outcomes.length,
    rollbackRate: outcomes.filter(o => o.rolledBack).length / n,
    failureRate: outcomes.filter(o => !o.ok).length / n,
    acceptanceRate: outcomes.filter(o => o.accepted).length / n,
    latencyP95: percentile(lat, 0.95),
    latencyMean: lat.reduce((s, v) => s + v, 0) / n,
    costPerTask: costTotal / n,
    costTotalUsd: costTotal,
  };
}

export interface CanaryComparison {
  pass: boolean;
  checks: Record<string, { candidate: number; baseline: number; pass: boolean }>;
  failed: string[];
}

/**
 * Canary gate: the candidate must be NO WORSE than the baseline on rollback,
 * latency, and cost (the ADR-176 metrics table constraints). Feeds accept()'s
 * `canary.rollback_rate <= baseline` term plus the latency/cost guards.
 */
export function compareCanary(candidate: CanaryTelemetry, baseline: CanaryTelemetry, tolerance = 1e-9): CanaryComparison {
  const checks: CanaryComparison['checks'] = {
    rollback_no_worse: { candidate: candidate.rollbackRate, baseline: baseline.rollbackRate, pass: candidate.rollbackRate <= baseline.rollbackRate + tolerance },
    latency_no_worse: { candidate: candidate.latencyP95, baseline: baseline.latencyP95, pass: candidate.latencyP95 <= baseline.latencyP95 * (1 + 0.01) },
    cost_no_worse: { candidate: candidate.costPerTask, baseline: baseline.costPerTask, pass: candidate.costPerTask <= baseline.costPerTask * (1 + 0.01) },
  };
  const failed = Object.entries(checks).filter(([, c]) => !c.pass).map(([k]) => k);
  return { pass: failed.length === 0, checks, failed };
}
