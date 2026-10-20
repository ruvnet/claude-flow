/**
 * Noise-robust timing helpers for the performance package's CI tests.
 *
 * Why this exists: CI runs the whole repo's test files in parallel on shared
 * runners, so absolute wall-clock thresholds ("p95 < 100 us") are measuring
 * the machine's momentary load as much as the code. Two defences are used:
 *
 *  1. Relative measurement. Every timed batch of the code under test is paired
 *     with a batch of a fixed, independent reference workload, run back to
 *     back (order alternates so neither side systematically goes first). Both
 *     halves see the same CPU contention, so the per-batch ratio cancels it.
 *     The reference does NOT call the code under test, so a slowdown of the
 *     code under test still moves the ratio.
 *  2. Robust statistics. The gate is the MEDIAN of the per-batch ratios after
 *     an untimed warm-up, not a tail percentile, so a few batches that were
 *     pre-empted mid-run (or hit JIT/GC) cannot decide the outcome.
 */

const REF_PARTS = ['profile.ref', 'tool.ref', 'a'.repeat(64), 'host.ref', 'b'.repeat(64), '2026-09-21T13:59:30.000Z'];
let refSink = 0;

/** Fixed workload with the same flavour as the code under test (string build + hash + date parse). */
export function referenceUnit(n: number): void {
  const material = `${REF_PARTS.join('|')}|${n}`;
  let a = 2166136261 >>> 0;
  let b = 2246822519 >>> 0;
  for (let i = 0; i < material.length; i += 1) {
    const c = material.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 3266489917) >>> 0;
  }
  refSink ^= a ^ b ^ Date.parse('2026-09-21T14:00:00.000Z');
}

export function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export interface PairedTiming {
  /** Median microseconds per unit of the code under test. */
  medianMicros: number;
  /** Median microseconds per unit of the reference workload. */
  referenceMedianMicros: number;
  /** Median of per-batch (code under test / reference). The robust gate. */
  medianRatio: number;
  /** Tail view, reported but not gated: p95 of the per-batch microseconds. */
  p95Micros: number;
  batchMicros: number[];
  ratios: number[];
}

/**
 * Time `runBatch(i)` (which must process `unitsPerBatch` units) against the
 * reference workload, interleaved, after `warmupBatches` untimed batches.
 */
export function pairedTiming(
  runBatch: (batchIndex: number) => void,
  options: { batches: number; unitsPerBatch: number; warmupBatches: number },
): PairedTiming {
  const { batches, unitsPerBatch, warmupBatches } = options;
  for (let w = 0; w < warmupBatches; w += 1) {
    runBatch(w % batches);
    for (let n = 0; n < unitsPerBatch; n += 1) referenceUnit(n);
  }

  const batchMicros: number[] = [];
  const refMicros: number[] = [];
  const ratios: number[] = [];
  for (let batch = 0; batch < batches; batch += 1) {
    let candidate = 0;
    let reference = 0;
    const timeCandidate = () => {
      const start = performance.now();
      runBatch(batch);
      candidate = ((performance.now() - start) * 1000) / unitsPerBatch;
    };
    const timeReference = () => {
      const start = performance.now();
      for (let n = 0; n < unitsPerBatch; n += 1) referenceUnit(n);
      reference = ((performance.now() - start) * 1000) / unitsPerBatch;
    };
    if (batch % 2 === 0) { timeCandidate(); timeReference(); } else { timeReference(); timeCandidate(); }
    batchMicros.push(candidate);
    refMicros.push(reference);
    ratios.push(candidate / Math.max(reference, Number.EPSILON));
  }

  return {
    medianMicros: median(batchMicros),
    referenceMedianMicros: median(refMicros),
    medianRatio: median(ratios),
    p95Micros: percentile(batchMicros, 0.95),
    batchMicros,
    ratios,
  };
}
