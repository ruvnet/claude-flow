/**
 * ADR-322 regression: the REAL local proposer against the REAL production
 * safety envelope.
 *
 * The shipped v1 envelope allowed `['alpha','topK','rerank','mmrLambda']` while
 * `retrievalPolicyNeighbors` emits full `RetrievalConfig` snapshots keyed
 * `alpha, subjectWeight, mmrLambda, bodyWeight, typePenaltyFactor`. Since
 * `validateCandidate` rejects a candidate when ANY of its keys is outside the
 * allowlist, every locally-proposed candidate was inadmissible and
 * `runFlywheelWorker` always returned
 * `{ran:false, reason:'proposer archive contained no admissible candidates'}`.
 *
 * The existing suites could not catch this: `flywheel-proposer.test.ts` builds a
 * synthetic `allowedPolicyKeys: ['alpha']` envelope with synthetic alpha-only
 * candidates, and `harness-flywheel.test.ts` calls `runFlywheelTick` directly,
 * bypassing the proposer archive. Nothing bound the two real pieces together.
 * These tests do exactly that.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, retrievalPolicyNeighbors, type RetrievalConfig } from '../src/services/harness-flywheel.js';
import { proposeFlywheelCandidates } from '../src/services/flywheel-proposer.js';
import { retrievalSafetyEnvelope } from '../src/services/harness-flywheel-runtime.js';

const ZERO_RESOURCES = {
  p95LatencyMicros: 0,
  costMicrosPerTask: 0,
  tokensPerTask: 0,
  failureRate: 0,
  evaluationCostMicros: 0,
};

const proposeReal = (baseline: RetrievalConfig) => proposeFlywheelCandidates({
  mode: 'local',
  baselinePolicy: baseline as unknown as Record<string, unknown>,
  safetyEnvelope: retrievalSafetyEnvelope(),
  seed: 1,
  localProposer: () => retrievalPolicyNeighbors(baseline).map((policy) => ({
    policy: policy as unknown as Record<string, unknown>,
    resources: { ...ZERO_RESOURCES },
  })),
});

describe('ADR-322 envelope <-> local proposer contract', () => {
  it('should admit locally-proposed candidates when baseline is DEFAULT_CONFIG', async () => {
    const archive = await proposeReal(DEFAULT_CONFIG);

    expect(archive.candidates.length).toBeGreaterThan(0);
    expect(archive.admissibleCandidates.length).toBeGreaterThan(0);
  });

  it('should yield a non-empty Pareto front, which runFlywheelWorker requires to proceed', async () => {
    const archive = await proposeReal(DEFAULT_CONFIG);

    expect(archive.paretoCandidates.length).toBeGreaterThan(0);
  });

  it('should allow exactly the keys the proposer emits', () => {
    const envelope = retrievalSafetyEnvelope();
    const emittedKeys = Object.keys(retrievalPolicyNeighbors(DEFAULT_CONFIG)[0]).sort();

    expect([...envelope.allowedPolicyKeys].sort()).toEqual(emittedKeys);
  });

  it('should bound every allowed key, since an unbounded key is never range-checked', () => {
    const envelope = retrievalSafetyEnvelope();

    for (const key of envelope.allowedPolicyKeys) {
      const bounds = envelope.numericBounds?.[key];
      expect(bounds, `${key} has no numeric bounds`).toBeDefined();
      expect(Number.isFinite(bounds?.min), `${key} min is not finite`).toBe(true);
      expect(Number.isFinite(bounds?.max), `${key} max is not finite`).toBe(true);
    }
  });

  it('should reject an out-of-range weight on a previously unbounded axis', async () => {
    const archive = await proposeFlywheelCandidates({
      mode: 'local',
      baselinePolicy: DEFAULT_CONFIG as unknown as Record<string, unknown>,
      safetyEnvelope: retrievalSafetyEnvelope(),
      seed: 1,
      localProposer: () => [{
        policy: { ...DEFAULT_CONFIG, subjectWeight: 1e9 } as unknown as Record<string, unknown>,
        resources: { ...ZERO_RESOURCES },
      }],
    });

    expect(archive.admissibleCandidates).toHaveLength(0);
    expect(archive.candidates[0].rejectionReasons).toContain('subjectWeight above maximum');
  });
});
