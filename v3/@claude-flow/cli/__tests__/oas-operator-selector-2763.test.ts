/**
 * Regression guard for #2763 dream-cycle OAS memory-operator selector.
 *
 * Rules the selector must obey:
 *   1. Hint-driven pick when the hinted operator fits.
 *   2. Otherwise, most-expensive-that-still-fits (spend the budget on
 *      the best-fidelity operator we can afford).
 *   3. When no operator fits, fall back to merge with needsSplit + a
 *      batch size ≤ what the budget can pay for.
 */

import { describe, it, expect } from 'vitest';
import { selectOperator, OPERATORS } from '../src/memory/oas-operator-selector.js';

describe('#2763 OAS operator selector', () => {
  it('picks distill on a small set with a rich budget', () => {
    const r = selectOperator({ budget: 500, entries: 50 });
    expect(r.operator).toBe('distill');
    expect(r.estimatedCost).toBe(OPERATORS.distill.costPerEntry * 50);
    expect(r.needsSplit).toBe(false);
  });

  it('picks merge on a huge set with a tiny budget (Rule 3 fallback + needsSplit)', () => {
    const r = selectOperator({ budget: 2, entries: 5000 });
    expect(r.operator).toBe('merge');
    expect(r.needsSplit).toBe(true);
    // Budget 2 / merge cost 0.02 → batch size 100
    expect(r.suggestedBatchSize).toBe(100);
  });

  it('honors a "duplicates" hint by preferring merge even when a fancier operator would fit', () => {
    const r = selectOperator({ budget: 500, entries: 100, hint: 'duplicates' });
    expect(r.operator).toBe('merge');
    expect(r.reason).toMatch(/Hint "duplicates"/);
  });

  it('honors a "patterns" hint by preferring distill when it fits', () => {
    const r = selectOperator({ budget: 300, entries: 50, hint: 'patterns' });
    expect(r.operator).toBe('distill');
  });

  it('ignores a hint when the hinted operator does not fit', () => {
    // Distill at 100 entries costs 300; give budget 50 (can afford summarize but not distill).
    const r = selectOperator({ budget: 50, entries: 100, hint: 'patterns' });
    expect(r.operator).not.toBe('distill');
    // Should pick the best fitting alternative — summarize (100 × 0.5 = 50) fits exactly.
    expect(r.operator).toBe('summarize');
  });

  it('returns all four operators in the considered list, ranked by cost ascending', () => {
    const r = selectOperator({ budget: 1000, entries: 100 });
    const ids = r.considered.map((c) => c.id);
    expect(new Set(ids)).toEqual(new Set(['merge', 'summarize', 'compress', 'distill']));
    for (let i = 1; i < r.considered.length; i++) {
      expect(r.considered[i].cost).toBeGreaterThanOrEqual(r.considered[i - 1].cost);
    }
  });

  it('needsSplit=true when entries exceed the chosen operator\'s maxEntries', () => {
    // distill.maxEntries = 100; ask for 200 with a rich budget so distill is picked
    const r = selectOperator({ budget: 500, entries: 200 });
    expect(r.needsSplit).toBe(true);
    expect(r.suggestedBatchSize).toBe(OPERATORS[r.operator].maxEntries);
  });
});
