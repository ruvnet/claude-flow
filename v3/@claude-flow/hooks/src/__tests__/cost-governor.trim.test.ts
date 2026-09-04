/**
 * ADR-179 sub-feature 1 (context trim) — London-school mock-first tests.
 *
 * Covers the pure filter `trimCandidates`, the higher-level
 * `trimGuidanceResult` (with an injected mock TurnCounter — no real disk),
 * and the master/sub opt-in gate in `loadCostGovernorConfig`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  trimCandidates,
  trimGuidanceResult,
  type RetrievedCandidate,
} from '../cost-governor/trim.js';
import { loadCostGovernorConfig, type CostGovernorConfig } from '../cost-governor/types.js';
import type { TurnCounter } from '../cost-governor/turn-counter.js';
import type { GuidancePattern, GuidanceResult } from '../reasoningbank/index.js';

// --- fixtures -------------------------------------------------------------

const TRIM_ON: CostGovernorConfig['contextTrim'] = {
  enabled: true,
  maxTurnAge: 3,
  minRetrievalScore: 0.4,
};
const TRIM_OFF: CostGovernorConfig['contextTrim'] = { ...TRIM_ON, enabled: false };

function candidate(similarity: number, lastAccessTurn: number): RetrievedCandidate {
  return { pattern: makePattern(), similarity, lastAccessTurn };
}

let patternSeq = 0;
function makePattern(overrides: Partial<GuidancePattern> = {}): GuidancePattern {
  patternSeq += 1;
  return {
    id: `p${patternSeq}`,
    strategy: 'strat',
    domain: 'domain',
    embedding: new Float32Array(0),
    quality: 1,
    usageCount: 0,
    successCount: 0,
    createdAt: 0,
    updatedAt: 1000,
    metadata: {},
    ...overrides,
  };
}

function guidance(
  patterns: Array<{ pattern: GuidancePattern; similarity: number }>,
  recommendations: string[] = ['rec-a', 'rec-b'],
): GuidanceResult {
  return {
    patterns,
    context: 'ctx',
    recommendations,
    searchTimeMs: 1,
  };
}

/** London-school mock of the TurnCounter collaborator — no disk, no timers. */
function mockTurnCounter(current: number, turnAt = 0): TurnCounter {
  return {
    current: vi.fn(() => current),
    turnAt: vi.fn(() => turnAt),
    increment: vi.fn(),
  } as unknown as TurnCounter;
}

// --- trimCandidates: pure filter -----------------------------------------

describe('trimCandidates (pure filter)', () => {
  it('opt-in gate off → returns the input array unchanged (identity, no filtering)', () => {
    // A candidate that WOULD be trimmed if the gate were on (too old + low score).
    const cands = [candidate(0.1, 0)];
    const out = trimCandidates(cands, /* turn */ 100, TRIM_OFF);
    expect(out).toBe(cands); // same reference — no copy, no filter
    expect(out).toHaveLength(1);
  });

  it('age boundary: candidate at exactly maxTurnAge is KEPT, at maxTurnAge+1 is TRIMMED', () => {
    // Isolate the age predicate — similarity below floor so the OR can't rescue.
    const turn = 10;
    const atBoundary = candidate(0.1, turn - TRIM_ON.maxTurnAge); // age == 3 → 3 <= 3 → kept
    const overBoundary = candidate(0.1, turn - (TRIM_ON.maxTurnAge + 1)); // age == 4 → 4 <= 3 → trimmed
    const out = trimCandidates([atBoundary, overBoundary], turn, TRIM_ON);
    expect(out).toEqual([atBoundary]);
  });

  it('score boundary: similarity == minRetrievalScore is KEPT, just below is TRIMMED', () => {
    // Isolate the score predicate — age beyond maxTurnAge so age can't rescue.
    const turn = 100; // every candidate is ancient
    const atFloor = candidate(TRIM_ON.minRetrievalScore, 0); // 0.4 >= 0.4 → kept
    const belowFloor = candidate(TRIM_ON.minRetrievalScore - 0.001, 0); // 0.399 >= 0.4 → trimmed
    const out = trimCandidates([atFloor, belowFloor], turn, TRIM_ON);
    expect(out).toEqual([atFloor]);
  });

  it('OR semantics: recent-but-low-score kept, old-but-high-score kept, old-and-low-score trimmed', () => {
    const turn = 100;
    const recentLowScore = candidate(0.0, turn); // age 0 kept by age predicate
    const oldHighScore = candidate(0.9, 0); // ancient but score rescues it
    const oldLowScore = candidate(0.1, 0); // neither predicate → trimmed
    const out = trimCandidates([recentLowScore, oldHighScore, oldLowScore], turn, TRIM_ON);
    expect(out).toEqual([recentLowScore, oldHighScore]);
  });

  it('empty candidate set → empty result, no crash', () => {
    expect(trimCandidates([], 5, TRIM_ON)).toEqual([]);
  });

  it('is deterministic — same input yields byte-identical output across calls', () => {
    const cands = [candidate(0.5, 8), candidate(0.1, 0), candidate(0.41, 2)];
    const a = trimCandidates(cands, 10, TRIM_ON);
    const b = trimCandidates(cands, 10, TRIM_ON);
    expect(a).toEqual(b);
    expect(cands).toHaveLength(3); // input not mutated
  });
});

// --- trimGuidanceResult: higher-level seam -------------------------------

describe('trimGuidanceResult (guidance-result seam)', () => {
  it('opt-in gate off → guidance passes through untouched, trimmedCount 0', () => {
    const g = guidance([{ pattern: makePattern({ lastAccessTurn: 0 }), similarity: 0.0 }]);
    const tc = mockTurnCounter(100);
    const { result, trimmedCount } = trimGuidanceResult(g, 'sess', TRIM_OFF, tc);
    expect(result).toBe(g); // same reference — no work done
    expect(trimmedCount).toBe(0);
    expect(tc.current).not.toHaveBeenCalled(); // short-circuits before touching the collaborator
  });

  it('filters patterns but leaves recommendations untouched', () => {
    const keep = { pattern: makePattern({ lastAccessTurn: 100 }), similarity: 0.0 }; // recent → kept
    const drop = { pattern: makePattern({ lastAccessTurn: 0 }), similarity: 0.1 }; // old+low → trimmed
    const g = guidance([keep, drop], ['keep-rec-1', 'keep-rec-2']);
    const tc = mockTurnCounter(100);
    const { result, trimmedCount } = trimGuidanceResult(g, 'sess', TRIM_ON, tc);
    expect(result.patterns).toEqual([keep]);
    expect(result.recommendations).toEqual(['keep-rec-1', 'keep-rec-2']); // untouched
    expect(result.context).toBe('ctx');
    expect(trimmedCount).toBe(1);
  });

  it('uses an explicit pattern.lastAccessTurn and does NOT consult turnCounter.turnAt for it', () => {
    const g = guidance([{ pattern: makePattern({ lastAccessTurn: 100 }), similarity: 0.0 }]);
    const tc = mockTurnCounter(100);
    const { result, trimmedCount } = trimGuidanceResult(g, 'sess', TRIM_ON, tc);
    expect(tc.turnAt).not.toHaveBeenCalled(); // explicit value short-circuits the ?? fallback
    expect(result.patterns).toHaveLength(1); // age 0 → kept
    expect(trimmedCount).toBe(0);
  });

  it('falls through to turnCounter.turnAt(sessionId, updatedAt) when lastAccessTurn is absent', () => {
    const pattern = makePattern({ updatedAt: 4242 }); // no lastAccessTurn
    const g = guidance([{ pattern, similarity: 0.0 }]);
    const tc = mockTurnCounter(/* current */ 100, /* turnAt */ 98); // age = 100-98 = 2 <= 3 → kept
    const { result, trimmedCount } = trimGuidanceResult(g, 'sess-xyz', TRIM_ON, tc);
    expect(tc.turnAt).toHaveBeenCalledWith('sess-xyz', 4242);
    expect(result.patterns).toHaveLength(1);
    expect(trimmedCount).toBe(0);
  });

  it('empty patterns → no crash, trimmedCount 0, recommendations preserved', () => {
    const g = guidance([], ['r1']);
    const tc = mockTurnCounter(100);
    const { result, trimmedCount } = trimGuidanceResult(g, 'sess', TRIM_ON, tc);
    expect(result.patterns).toEqual([]);
    expect(result.recommendations).toEqual(['r1']);
    expect(trimmedCount).toBe(0);
  });
});

// --- loadCostGovernorConfig: opt-in gate (off by default) ----------------

describe('loadCostGovernorConfig (opt-in gate)', () => {
  const ENV_KEYS = [
    'RUFLO_COST_GOVERNOR',
    'RUFLO_COST_GOVERNOR_TRIM_AGE_TURNS',
    'RUFLO_COST_GOVERNOR_TRIM_SCORE_FLOOR',
  ];
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('defaults every sub-feature OFF when no env/flag is set', () => {
    const cfg = loadCostGovernorConfig([]);
    expect(cfg.enabled).toBe(false);
    expect(cfg.contextTrim.enabled).toBe(false);
    expect(cfg.contextTrim.maxTurnAge).toBe(3);
    expect(cfg.contextTrim.minRetrievalScore).toBe(0.4);
  });

  it('master env gate RUFLO_COST_GOVERNOR=1 enables contextTrim', () => {
    process.env.RUFLO_COST_GOVERNOR = '1';
    expect(loadCostGovernorConfig([]).contextTrim.enabled).toBe(true);
  });

  it('CLI --cost-governor takes precedence over an unset env', () => {
    expect(loadCostGovernorConfig(['--cost-governor']).contextTrim.enabled).toBe(true);
  });

  it('CLI --cost-governor=off overrides env RUFLO_COST_GOVERNOR=1', () => {
    process.env.RUFLO_COST_GOVERNOR = '1';
    expect(loadCostGovernorConfig(['--cost-governor=off']).enabled).toBe(false);
  });

  it('honors env overrides for trim age/score tunables', () => {
    process.env.RUFLO_COST_GOVERNOR = '1';
    process.env.RUFLO_COST_GOVERNOR_TRIM_AGE_TURNS = '7';
    process.env.RUFLO_COST_GOVERNOR_TRIM_SCORE_FLOOR = '0.75';
    const cfg = loadCostGovernorConfig([]);
    expect(cfg.contextTrim.maxTurnAge).toBe(7);
    expect(cfg.contextTrim.minRetrievalScore).toBe(0.75);
  });
});
