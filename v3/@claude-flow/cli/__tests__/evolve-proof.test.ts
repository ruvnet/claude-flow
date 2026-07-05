/**
 * single-round proof-of-mechanism (ADR-176) — NOT flywheel/compounding/production
 * proof. Verifies: the 7 required artifacts are emitted, the real versioned
 * accept() gate decides, the bundle is independently replayable (no service
 * logs), a pass registers in SHADOW (never served), and a lineage reconstructs.
 */
import { describe, it, expect } from 'vitest';
import {
  runSyntheticProofRound, verifyReceiptBundle, reconstructLineage,
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

describe('reconstructLineage — flywheel acceptance test scaffolding', () => {
  it('a single gen-0 bundle reconstructs a trivially-intact, replayable lineage', () => {
    const t = reconstructLineage([runSyntheticProofRound({ now: 1, generation: 0, parent: null })]);
    expect(t.generations).toBe(1);
    expect(t.promotions).toBe(1);
    expect(t.lineageIntact).toBe(true);
    expect(t.allReplayable).toBe(true);
  });

  it('a chained lineage (winner→next baseline) reconstructs back to gen 0', () => {
    const g0 = runSyntheticProofRound({ now: 1, generation: 0, parent: null,
      baseline: { alpha: 0.5, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 },
      candidate: { alpha: 0.4, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 } });
    const g1 = runSyntheticProofRound({ now: 2, generation: 1, parent: g0.candidateManifestHash,
      baseline: { alpha: 0.4, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 }, // inherits g0 winner
      candidate: { alpha: 0.3, subjectWeight: 2, mmrLambda: 0.7, bodyWeight: 1, typePenaltyFactor: 1 } });
    const t = reconstructLineage([g0, g1]);
    expect(t.promotions).toBe(2);
    expect(t.lineageIntact).toBe(true);
    expect(t.cumulativeHeldOutImprovement).toBeGreaterThan(0);
  });

  it('detects a broken lineage (a gen that did not inherit the previous winner)', () => {
    const g0 = runSyntheticProofRound({ now: 1, generation: 0, parent: null });
    const g1 = runSyntheticProofRound({ now: 2, generation: 1, parent: 'sha256:wrong-parent' });
    expect(reconstructLineage([g0, g1]).lineageIntact).toBe(false);
  });
});
