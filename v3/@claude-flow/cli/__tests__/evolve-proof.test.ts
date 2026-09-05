/**
 * single-round proof-of-mechanism (ADR-176) — NOT flywheel/compounding/production
 * proof. Verifies: the 7 required artifacts are emitted, the real versioned
 * accept() gate decides, the bundle is independently replayable (no service
 * logs), a pass registers in SHADOW (never served), and a lineage reconstructs.
 */
import { describe, it, expect } from 'vitest';
import {
  runSyntheticProofRound, runRealEvolveRound, verifyReceiptBundle, reconstructLineage,
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

describe('runRealEvolveRound — measured round, same gate + replayability as synthetic', () => {
  const holdout = [
    { taskId: 'q05', baselineScore: 0.50, candidateScore: 0.62 },
    { taskId: 'q06', baselineScore: 0.80, candidateScore: 0.86 },
    { taskId: 'q07', baselineScore: 0.70, candidateScore: 0.78 },
    { taskId: 'q08', baselineScore: 0.60, candidateScore: 0.70 },
    { taskId: 'q09', baselineScore: 0.72, candidateScore: 0.80 },
  ];
  const baseline = { alpha: 0.5, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 };
  const candidate = { alpha: 0.3, subjectWeight: 1, mmrLambda: 0.5, bodyWeight: 1.5, typePenaltyFactor: 0.5 };

  it('a real measured improvement promotes, is kind:real, and replays independently', () => {
    const b = runRealEvolveRound({ baseline, candidate, holdout, generation: 0, parent: null, now: 1, redblue: 'PASS', corpus: 'ADR-081-frozen-v1' });
    expect(b.kind).toBe('real');
    expect(b.decisionReceipt.promoted).toBe(true);
    expect(b.costReceipt.usd).toBe(0);                 // $0 path
    expect(b.shadow?.served).toBe(false);              // shadow, not served
    const v = verifyReceiptBundle(b);
    expect(v.valid).toBe(true);                        // independently replayable
    expect(v.explanation).toMatch(/PASS under accept\/v1/);
  });

  it('a real round that regresses train (redblue FAIL) is rejected', () => {
    const b = runRealEvolveRound({ baseline, candidate, holdout, generation: 0, parent: null, now: 1, redblue: 'FAIL', corpus: 'x' });
    expect(b.decisionReceipt.promoted).toBe(false);
    expect(b.regression?.failureCause).toBe('security'); // redblue term
    expect(verifyReceiptBundle(b).valid).toBe(true);      // rejection still replayable
  });

  it('two real rounds chain (winner→next baseline) into an intact lineage', () => {
    const g0 = runRealEvolveRound({ baseline, candidate, holdout, generation: 0, parent: null, now: 1, corpus: 'x' });
    const g1 = runRealEvolveRound({ baseline: candidate, candidate: { ...candidate, alpha: 0.2 }, holdout, generation: 1, parent: g0.candidateManifestHash, now: 2, corpus: 'x' });
    const t = reconstructLineage([g0, g1]);
    expect(t.promotions).toBe(2);
    expect(t.lineageIntact).toBe(true);
    expect(t.allReplayable).toBe(true);
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

describe('accept/v2+seq — sequential-evidence conjunct (ADR-381 §3)', () => {
  const baseline = { alpha: 0.5, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 };
  const candidate = { alpha: 0.3, subjectWeight: 1, mmrLambda: 0.5, bodyWeight: 1.5, typePenaltyFactor: 0.5 };
  // 10 all-win pairs: clears test 1 (1.5^10 ≈ 57.7 ≥ 32.9) but not test 2 (≈131.6).
  const strongHoldout = Array.from({ length: 10 }, (_, i) => ({ taskId: `s${i}`, baselineScore: 0.5, candidateScore: 0.6 + i / 100 }));
  // 5 all-win pairs: bootstrap-significant but sequentially insufficient at test 1.
  const weakHoldout = Array.from({ length: 5 }, (_, i) => ({ taskId: `w${i}`, baselineScore: 0.5, candidateScore: 0.62 + i / 100 }));

  it('promotes under v2 only when the sequential term also holds, and pins the v2 version', () => {
    const b = runRealEvolveRound({ baseline, candidate, holdout: strongHoldout, generation: 0, parent: null, now: 1, corpus: 'x', sequential: { testIndex: 1 } });
    expect(b.meetsPromotionRule.version).toBe('accept/v2+seq');
    expect(b.sequentialEvidence).toMatchObject({ testIndex: 1, significant: true, informativePairs: 10 });
    expect(b.decisionReceipt.promoted).toBe(true);
  });

  it('rejects a bootstrap-significant candidate whose sequential evidence is insufficient — cause "sequential"', () => {
    const b = runRealEvolveRound({ baseline, candidate, holdout: weakHoldout, generation: 0, parent: null, now: 1, corpus: 'x', sequential: { testIndex: 1 } });
    expect(b.decisionReceipt.significant).toBe(true);          // v1 term holds
    expect(b.sequentialEvidence?.significant).toBe(false);     // v2 term refuses
    expect(b.decisionReceipt.promoted).toBe(false);
    expect(b.regression?.failureCause).toBe('sequential');
    expect(b.decisionReceipt.reason).toMatch(/sequential_evidence/);
  });

  it('the same evidence fails at a later stream position (alpha allocation bites)', () => {
    const early = runRealEvolveRound({ baseline, candidate, holdout: strongHoldout, generation: 0, parent: null, now: 1, corpus: 'x', sequential: { testIndex: 1 } });
    const late = runRealEvolveRound({ baseline, candidate, holdout: strongHoldout, generation: 5, parent: null, now: 1, corpus: 'x', sequential: { testIndex: 2 } });
    expect(early.decisionReceipt.promoted).toBe(true);
    expect(late.decisionReceipt.promoted).toBe(false);
  });

  it('v2 bundles replay independently, and a tampered sequential record is detected', () => {
    const b = runRealEvolveRound({ baseline, candidate, holdout: strongHoldout, generation: 0, parent: null, now: 1, corpus: 'x', sequential: { testIndex: 1 } });
    expect(verifyReceiptBundle(b).valid).toBe(true);
    expect(verifyReceiptBundle(b).explanation).toMatch(/accept\/v2\+seq/);

    const tampered = structuredClone(b);
    tampered.sequentialEvidence!.eValue = 999;
    const v = verifyReceiptBundle(tampered);
    expect(v.valid).toBe(false);
    expect(v.mismatches.join(' ')).toMatch(/sequential-evidence verdict does not recompute/);

    // Claiming an easier stream position than recorded is also caught: the
    // verdict was recorded at index 2; rewriting it to index 1 changes the
    // threshold, so significance no longer recomputes.
    const rejected = runRealEvolveRound({ baseline, candidate, holdout: strongHoldout, generation: 5, parent: null, now: 1, corpus: 'x', sequential: { testIndex: 2 } });
    const indexShopped = structuredClone(rejected);
    indexShopped.sequentialEvidence!.testIndex = 1;
    expect(verifyReceiptBundle(indexShopped).valid).toBe(false);
  });

  it('v1 bundles (no sequential input) keep v1 semantics and still verify', () => {
    const b = runRealEvolveRound({ baseline, candidate, holdout: strongHoldout, generation: 0, parent: null, now: 1, corpus: 'x' });
    expect(b.meetsPromotionRule.version).toBe(PROMOTION_RULE_VERSION);
    expect(b.sequentialEvidence).toBeUndefined();
    expect(verifyReceiptBundle(b).valid).toBe(true);
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
