/**
 * ADR-179 sub-feature 5 (swarm diversity gate) — mock-first tests.
 *
 * Pure functions: no fs, no timers, no collaborators. computeDiversityScore
 * and checkDiversityGate encapsulate the entire gate contract; the
 * agent_spawn wiring in cli/src/mcp-tools/agent-tools.ts is a thin,
 * best-effort adapter (roster = swarm.agents.map(type) → checkDiversityGate,
 * try/caught, never blocks a spawn) whose logic is fully covered here.
 */

import { describe, it, expect } from 'vitest';
import { computeDiversityScore, checkDiversityGate } from '../cost-governor/diversity.js';
import type { CostGovernorConfig } from '../cost-governor/types.js';

const WARN: CostGovernorConfig['diversityGate'] = { enabled: true, floor: 0.2, enforce: 'warn' };
const REJECT: CostGovernorConfig['diversityGate'] = { ...WARN, enforce: 'reject' };
const DISABLED: CostGovernorConfig['diversityGate'] = { ...WARN, enabled: false };

// --- computeDiversityScore: test-vector table -----------------------------

describe('computeDiversityScore', () => {
  it('is 0 for a fully homogeneous roster (all same type)', () => {
    expect(computeDiversityScore(['a', 'a', 'a'])).toBe(0);
    expect(computeDiversityScore(['a'])).toBe(0);
  });

  it('is (N-1)/N for N evenly-split distinct types', () => {
    expect(computeDiversityScore(['a', 'b'])).toBe(0.5); // (2-1)/2
    expect(computeDiversityScore(['a', 'b', 'c'])).toBeCloseTo(2 / 3, 10); // (3-1)/3
    expect(computeDiversityScore(['a', 'b', 'c', 'd'])).toBe(0.75); // (4-1)/4
  });

  it('reflects the largest same-type cluster for mixed rosters', () => {
    expect(computeDiversityScore(['a', 'a', 'b', 'c'])).toBe(0.5); // maxShare 2/4
    expect(computeDiversityScore(['a', 'a', 'a', 'b'])).toBe(0.25); // maxShare 3/4
  });

  it('returns 1 for an empty roster (edge)', () => {
    expect(computeDiversityScore([])).toBe(1);
  });
});

// --- checkDiversityGate: gate contract ------------------------------------

describe('checkDiversityGate', () => {
  it('does not evaluate below the 3-agent floor, even if homogeneous', () => {
    const res = checkDiversityGate(['a', 'a'], REJECT); // score 0, but only 2 agents
    expect(res).toEqual({ diversity_score: 0, blocked: false });
    expect(res.message).toBeUndefined();
  });

  it('never blocks and surfaces no message when disabled — but still returns the score', () => {
    const res = checkDiversityGate(['a', 'a', 'a'], DISABLED);
    expect(res.diversity_score).toBe(0);
    expect(res.blocked).toBe(false);
    expect(res.message).toBeUndefined();
  });

  it('allows a diverse roster (>= floor) with no message in either enforce mode', () => {
    for (const cfg of [WARN, REJECT]) {
      const res = checkDiversityGate(['a', 'b', 'c'], cfg); // score ~0.667 >= 0.2
      expect(res.blocked).toBe(false);
      expect(res.message).toBeUndefined();
      expect(res.diversity_score).toBeCloseTo(2 / 3, 10);
    }
  });

  it('warn mode: homogeneous roster returns the score + message but NEVER blocks', () => {
    const res = checkDiversityGate(['a', 'a', 'a'], WARN); // score 0 < floor 0.2
    expect(res.diversity_score).toBe(0);
    expect(res.blocked).toBe(false); // warn-only never blocks
    expect(res.message).toBeDefined(); // score/message still surfaced
  });

  it('reject mode: homogeneous roster (score < floor) blocks with a message', () => {
    const res = checkDiversityGate(['a', 'a', 'a', 'a', 'a', 'b'], REJECT); // maxShare 5/6 → score ~0.167 < 0.2
    expect(res.diversity_score).toBeCloseTo(1 / 6, 10);
    expect(res.blocked).toBe(true);
    expect(res.message).toBeDefined();
  });

  it('floor boundary: exactly-80%-homogeneous (maxShare 4/5) DOES trigger due to IEEE-754', () => {
    // ['a','a','a','a','b'] → maxShare = 4/5. In exact arithmetic 1 - 0.8 == 0.2
    // (== floor, NOT < floor), but IEEE-754 makes `1 - 4/5` === 0.19999999999999996,
    // which IS < 0.2 — so the strict `diversity_score < floor` gate fires at exactly
    // 80% homogeneous. This satisfies the ADR's "≥80% triggers" intent, but the exact
    // trigger point is floating-point-fragile (FLAGGED to coordinator for Round 6).
    expect(1 - 4 / 5).toBeLessThan(0.2); // the float fact this behavior rests on
    const res = checkDiversityGate(['a', 'a', 'a', 'a', 'b'], REJECT);
    expect(res.blocked).toBe(true);
    expect(res.message).toBeDefined();
  });

  it('clearly-below-floor homogeneity (maxShare 3/5, score 0.4) is allowed', () => {
    const res = checkDiversityGate(['a', 'a', 'a', 'b', 'c'], REJECT); // maxShare 3/5 → score 0.4
    expect(res.diversity_score).toBeCloseTo(0.4, 10);
    expect(res.blocked).toBe(false);
    expect(res.message).toBeUndefined();
  });
});
