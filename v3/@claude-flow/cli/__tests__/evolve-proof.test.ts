/**
 * single-round proof-of-mechanism (ADR-176) — NOT flywheel/compounding/production
 * proof. Verifies: the 7 required artifacts are emitted, the real versioned
 * accept() gate decides, the bundle is independently replayable (no service
 * logs), a pass registers in SHADOW (never served), and a lineage reconstructs.
 */
import { describe, it, expect } from 'vitest';
import {
  runSyntheticProofRound, verifyReceiptBundle, reconstructLineage,
  mutationEffectiveness, detectPlateau, classifyMutation,
  PROMOTION_RULE_VERSION, PROOF_LABEL,
} from '../src/services/evolve-proof.js';

describe('runSyntheticProofRound — required artifacts + gate wiring', () => {
  const b = runSyntheticProofRound({ now: 1000 });

  it('emits all seven required artifacts', () => {
    expect(b.inputHoldoutHash).toMatch(/^sha256:/);
    expect(b.baselineManifestHash).toMatch(/^sha256:/);
    expect(b.candidateManifestHash).toMatch(/^sha256:/);
    expect(b.meetsPromotionRule.version).toBe(PROMOTION_RULE_VERSION);   // meetsPromotionRule version
    expect(b.decisionReceipt.result.terms).toBeTruthy();                 // decision receipt
    expect(b.shadow?.registrationId).toMatch(/^shadow:/);                // SHADOW registration id
    expect(b.costReceipt).toEqual({ usd: 0, llmCalls: 0, tier: 'synthetic', notes: expect.any(String) }); // cost receipt
  });

  it('is labeled exactly, and carries the anti-marketing disclaimers', () => {
    expect(b.label).toBe(PROOF_LABEL);
    expect(b.label).toBe('single-round proof-of-mechanism');
    expect(b.disclaimers).toEqual(['not flywheel proof', 'not compounding learning', 'not production learning']);
  });

  it('the REAL versioned accept() decided promotion (gate wiring)', () => {
    expect(b.decisionReceipt.promotionRuleVersion).toBe(PROMOTION_RULE_VERSION);
    expect(b.decisionReceipt.promoted).toBe(b.meetsPromotionRule.result);
  });

  it('a pass registers in SHADOW and is NOT served (no auto-serve path)', () => {
    expect(b.meetsPromotionRule.result).toBe(true);
    expect(b.shadow).not.toBeNull();
    expect(b.shadow!.state).toBe('shadow');
    expect(b.shadow!.served).toBe(false);
  });
});

describe('verifyReceiptBundle — independent replay (no service logs)', () => {
  it('independently recomputes the decision and confirms the pass', () => {
    const b = runSyntheticProofRound({ now: 1 });
    const v = verifyReceiptBundle(b);
    expect(v.valid).toBe(true);
    expect(v.hashChecks).toEqual({ inputHoldout: true, baselineManifest: true, candidateManifest: true });
    expect(v.decisionMatches).toBe(true);
    expect(v.noAutoServe).toBe(true);
    expect(v.explanation).toMatch(/PASS under accept\/v1/);
  });

  it('detects a tampered holdout (hash mismatch → invalid)', () => {
    const b = runSyntheticProofRound({ now: 1 });
    b.holdout[0].candidateScore = 0.999; // tamper after hashing
    const v = verifyReceiptBundle(b);
    expect(v.valid).toBe(false);
    expect(v.mismatches).toContain('input holdout hash mismatch');
  });

  it('detects a forged decision (recorded promoted != recomputed)', () => {
    const b = runSyntheticProofRound({ now: 1 });
    b.meetsPromotionRule.result = false; // lie about the outcome
    const v = verifyReceiptBundle(b);
    expect(v.decisionMatches).toBe(false);
    expect(v.valid).toBe(false);
  });

  it('flags an auto-served candidate (served=true violates shadow-only)', () => {
    const b = runSyntheticProofRound({ now: 1 });
    (b.shadow as unknown as { served: boolean }).served = true;
    expect(verifyReceiptBundle(b).noAutoServe).toBe(false);
  });

  it('REJECT path: a regressing candidate fails the gate and does NOT register shadow', () => {
    const b = runSyntheticProofRound({ now: 1, regress: true });
    expect(b.meetsPromotionRule.result).toBe(false);
    expect(b.shadow).toBeNull();
    const v = verifyReceiptBundle(b);
    expect(v.valid).toBe(true);               // the rejection is itself replayable
    expect(v.explanation).toMatch(/FAIL under accept\/v1/);
  });
});

describe('causality — the record explains WHY, not just what', () => {
  it('a promotion carries a mutation class, summary, and multi-dimensional deltas', () => {
    const b = runSyntheticProofRound({ now: 1 });
    expect(b.mutationClass).toBe('retrieval:multi');           // 5 knobs changed
    expect(b.mutationSummary).toMatch(/alpha:0.5→0.3/);
    expect(b.deltas.benchmark).toBeGreaterThan(0);
    expect(b.deltas.security).toBe(0);
    expect(b.promotion).not.toBeNull();
    expect(b.regression).toBeNull();
    expect(verifyReceiptBundle(b).causalConsistent).toBe(true);
  });

  it('a rejection records failure cause + ancestor (regression ancestry)', () => {
    const b = runSyntheticProofRound({ now: 1, regress: true });
    expect(b.promotion).toBeNull();
    expect(b.regression).not.toBeNull();
    expect(b.regression!.failureCause).toBe('canary');         // regressing task → canary_no_worse fails first
    expect(b.regression!.failedTerms.length).toBeGreaterThan(0);
    expect(b.regression!.ancestor).toBeTruthy();
  });

  it('classifyMutation names single-knob vs multi-knob changes', () => {
    expect(classifyMutation({ alpha: 0.5, x: 1 }, { alpha: 0.3, x: 1 }).mutationClass).toBe('retrieval:alpha');
    expect(classifyMutation({ alpha: 0.5, x: 1 }, { alpha: 0.3, x: 2 }).mutationClass).toBe('retrieval:multi');
  });
});

// helper: build a linear promoted chain of `n` generations
function chainOf(n: number, branch = 'main'): ReturnType<typeof runSyntheticProofRound>[] {
  const cfg = (a: number) => ({ alpha: a, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 });
  const out = [];
  let parent: string | null = null, base = cfg(0.9);
  for (let g = 0; g < n; g++) {
    const cand = cfg(+(0.9 - (g + 1) * 0.01).toFixed(3));
    const b = runSyntheticProofRound({ now: g + 1, generation: g, parent, branch, baseline: base, candidate: cand });
    out.push(b); parent = b.candidateManifestHash; base = cand;
  }
  return out;
}

describe('reconstructLineage — DAG back to the immutable root', () => {
  it('a single gen-0 bundle reconstructs a trivially-intact, replayable lineage', () => {
    const t = reconstructLineage([runSyntheticProofRound({ now: 1, generation: 0, parent: null })]);
    expect(t.generations).toBe(1);
    expect(t.promotions).toBe(1);
    expect(t.lineageIntact).toBe(true);
    expect(t.rootHash).toBeTruthy();
    expect(t.branches).toEqual(['main']);
  });

  it('a chained lineage reconstructs back to the immutable root with intact DAG invariants', () => {
    const t = reconstructLineage(chainOf(3));
    expect(t.promotions).toBe(3);
    expect(t.lineageIntact).toBe(true);
    expect(t.cumulativeHeldOutImprovement).toBeGreaterThan(0);
  });

  it('supports branches (DAG, not a linked list) — a fork off gen 0 keeps the lineage intact', () => {
    const main = chainOf(2, 'main');
    // branch off the root (main gen 0) into a separate branch that inherits its policy.
    const rootCand = main[0].candidateManifest.policy.value as Record<string, number>;
    const branch = runSyntheticProofRound({
      now: 99, generation: 1, branch: 'legal', parent: main[0].candidateManifestHash,
      baseline: rootCand, candidate: { ...rootCand, subjectWeight: 3 },
    });
    const t = reconstructLineage([...main, branch]);
    expect(t.branches.sort()).toEqual(['legal', 'main']);
    expect(t.lineageIntact).toBe(true);
  });

  it('detects >1 root, a missing parent, and a non-inheriting child', () => {
    expect(reconstructLineage([runSyntheticProofRound({ now: 1, generation: 1, parent: 'sha256:ghost' })]).lineageIntact).toBe(false);
    const g0 = runSyntheticProofRound({ now: 1, generation: 0, parent: null });
    const g0b = runSyntheticProofRound({ now: 2, generation: 0, parent: null }); // 2nd root
    expect(reconstructLineage([g0, g0b]).problems.some((p) => /one immutable root/.test(p))).toBe(true);
  });
});

describe('mutationEffectiveness — evidence-grounded meta-learning', () => {
  it('aggregates attempts/promotions/mean-delta per mutation class', () => {
    const bundles = [
      runSyntheticProofRound({ now: 1 }),                       // multi, promoted
      runSyntheticProofRound({ now: 2, regress: true }),        // multi, rejected
    ];
    const stats = mutationEffectiveness(bundles);
    const multi = stats.find((s) => s.mutationClass === 'retrieval:multi')!;
    expect(multi.attempts).toBe(2);
    expect(multi.promotions).toBe(1);
    expect(multi.meanDelta).toBeGreaterThan(0);
  });
});

describe('detectPlateau — rigorous, not intuitive', () => {
  it('insufficient-data below the window', () => {
    expect(detectPlateau(chainOf(3), { window: 20 }).status).toBe('insufficient-data');
  });

  it('reports active while improvements keep landing', () => {
    const r = detectPlateau(chainOf(20), { window: 20 });
    expect(r.status).toBe('active');
    expect(r.promotionRate).toBe(1);
  });
});
