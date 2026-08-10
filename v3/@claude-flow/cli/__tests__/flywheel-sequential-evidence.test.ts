import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALPHA_TOTAL,
  DEFAULT_LAMBDA,
  alphaForTest,
  checkPairedOutcomesConsistency,
  minInformativePairsToClear,
  remainingAlphaBudget,
  sequentialEvidenceVerdict,
  type PairedTaskOutcome,
} from '../src/services/flywheel-sequential-evidence.js';

const win = (i: number): PairedTaskOutcome => ({ taskId: `t${i}`, baselineScore: 0.5, candidateScore: 0.7 });
const loss = (i: number): PairedTaskOutcome => ({ taskId: `t${i}`, baselineScore: 0.7, candidateScore: 0.5 });
const tie = (i: number): PairedTaskOutcome => ({ taskId: `t${i}`, baselineScore: 0.6, candidateScore: 0.6 });

describe('alpha allocation across the candidate stream', () => {
  it('sums to at most alphaTotal over arbitrarily many tests', () => {
    let spent = 0;
    for (let k = 1; k <= 10_000; k++) spent += alphaForTest(k, 0.05);
    expect(spent).toBeLessThanOrEqual(0.05);
    // and converges to (nearly all of) the budget rather than wasting it
    expect(spent).toBeGreaterThan(0.0499);
  });

  it('rejects invalid indices and budgets', () => {
    expect(() => alphaForTest(0)).toThrow(RangeError);
    expect(() => alphaForTest(1.5)).toThrow(RangeError);
    expect(() => alphaForTest(1, 1)).toThrow(RangeError);
  });

  it('minInformativePairsToClear is exactly the all-win count that clears the threshold', () => {
    for (const k of [1, 2, 5, 10]) {
      const n = minInformativePairsToClear(k);
      // n all-win pairs clear; n-1 do not.
      expect(Math.pow(1 + DEFAULT_LAMBDA, n)).toBeGreaterThanOrEqual(1 / alphaForTest(k));
      expect(Math.pow(1 + DEFAULT_LAMBDA, n - 1)).toBeLessThan(1 / alphaForTest(k));
    }
    // Concrete anchor: test 1 needs 9 net wins at lambda 0.5.
    expect(minInformativePairsToClear(1)).toBe(9);
  });

  it('remainingAlphaBudget decreases monotonically and never goes negative', () => {
    let prev = DEFAULT_ALPHA_TOTAL;
    for (let k = 0; k <= 50; k += 5) {
      const left = remainingAlphaBudget(k);
      expect(left).toBeLessThanOrEqual(prev + 1e-12);
      expect(left).toBeGreaterThanOrEqual(0);
      prev = left;
    }
    expect(remainingAlphaBudget(0)).toBe(DEFAULT_ALPHA_TOTAL);
  });
});

describe('sequential evidence e-process', () => {
  it('carries no information in concordant pairs', () => {
    const verdict = sequentialEvidenceVerdict([tie(0), tie(1), tie(2)], 1);
    expect(verdict.eValue).toBe(1);
    expect(verdict.informativePairs).toBe(0);
    expect(verdict.significant).toBe(false);
  });

  it('reaches significance on a strong candidate at test 1 but not at test 2', () => {
    const outcomes = Array.from({ length: 10 }, (_, i) => win(i)); // e = 1.5^10 ≈ 57.7
    const first = sequentialEvidenceVerdict(outcomes, 1);
    expect(first.significant).toBe(true);
    expect(first.threshold).toBeCloseTo(1 / alphaForTest(1), 6);
    const second = sequentialEvidenceVerdict(outcomes, 2); // threshold ≈ 131.6
    expect(second.significant).toBe(false);
  });

  it('is order-invariant and symmetric between wins and losses', () => {
    const mixed = [win(0), loss(1), win(2), win(3)];
    const shuffled = [win(3), win(0), win(2), loss(1)];
    expect(sequentialEvidenceVerdict(mixed, 1).eValue).toBeCloseTo(sequentialEvidenceVerdict(shuffled, 1).eValue, 12);
    // one win and one loss cancel: (1.5)(0.5) = 0.75 < 1
    expect(sequentialEvidenceVerdict([win(0), loss(1)], 1).eValue).toBeCloseTo(0.75, 12);
  });
});

describe('paired-outcome consistency', () => {
  const outcomes: PairedTaskOutcome[] = [
    { taskId: 'a', baselineScore: 0.5, candidateScore: 0.6 },
    { taskId: 'b', baselineScore: 0.4, candidateScore: 0.55 },
  ];

  it('accepts outcomes that reproduce their aggregate deltas', () => {
    expect(checkPairedOutcomesConsistency(outcomes, [0.1, 0.15]).ok).toBe(true);
  });

  it('refuses length mismatch, duplicate ids, and irreproducible deltas', () => {
    expect(checkPairedOutcomesConsistency(outcomes, [0.1]).ok).toBe(false);
    expect(checkPairedOutcomesConsistency([outcomes[0], { ...outcomes[1], taskId: 'a' }], [0.1, 0.15]).ok).toBe(false);
    expect(checkPairedOutcomesConsistency(outcomes, [0.1, 0.2]).ok).toBe(false);
    expect(checkPairedOutcomesConsistency([], []).ok).toBe(false);
  });
});

describe('acceptance: family-wise false promotion under the null', () => {
  it('stays at or below the 5% budget across 1,000 null-improvement streams', () => {
    // Each stream simulates an ADAPTIVE flywheel run under the global null
    // (no candidate is truly better): 20 candidates per stream, 40 paired
    // tasks per candidate, every pair discordant with P(candidate wins) = 1/2
    // — the worst case for the e-process, since concordant pairs carry no
    // signal. A false promotion is ANY candidate in the stream clearing its
    // allocated threshold. The theoretical bound is
    // sum_k alpha_k = alphaTotal = 5%.
    let seed = 0x5eed5eed >>> 0;
    const rnd = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const STREAMS = 1_000;
    const CANDIDATES_PER_STREAM = 20;
    const PAIRS_PER_CANDIDATE = 40;
    let streamsWithFalsePromotion = 0;

    for (let s = 0; s < STREAMS; s++) {
      let promotedFalsely = false;
      for (let k = 1; k <= CANDIDATES_PER_STREAM; k++) {
        const outcomes: PairedTaskOutcome[] = Array.from({ length: PAIRS_PER_CANDIDATE }, (_, i) =>
          rnd() < 0.5 ? win(i) : loss(i));
        if (sequentialEvidenceVerdict(outcomes, k).significant) {
          promotedFalsely = true;
          break;
        }
      }
      if (promotedFalsely) streamsWithFalsePromotion++;
    }

    const rate = streamsWithFalsePromotion / STREAMS;
    expect(rate).toBeLessThanOrEqual(DEFAULT_ALPHA_TOTAL);
  });
});
