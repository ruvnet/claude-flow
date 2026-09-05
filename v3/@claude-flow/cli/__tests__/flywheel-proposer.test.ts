import { describe, expect, it } from 'vitest';
import {
  DarwinUnavailableError,
  proposeFlywheelCandidates,
  type SafetyEnvelope,
} from '../src/services/flywheel-proposer.js';

const envelope: SafetyEnvelope = {
  ref: 'sha256:safety',
  allowedPolicyKeys: ['alpha'],
  numericBounds: { alpha: { min: 0.1, max: 0.9 } },
  maxP95LatencyMicros: 10_000,
  maxCostMicrosPerTask: 100,
  maxTokensPerTask: 1_000,
  maxFailureRate: 0.01,
  maxEvaluationCostMicros: 10_000,
};
const resources = {
  p95LatencyMicros: 1_000,
  costMicrosPerTask: 10,
  tokensPerTask: 100,
  failureRate: 0,
  evaluationCostMicros: 1_000,
};
const localProposer = () => [
  { policy: { alpha: 0.3 }, resources },
  { policy: { alpha: 1.2 }, resources: { ...resources, p95LatencyMicros: 20_000 } },
];

describe('flywheel proposer adapter', () => {
  it('applies hard admissibility constraints before archive selection', async () => {
    const archive = await proposeFlywheelCandidates({
      mode: 'local',
      baselinePolicy: { alpha: 0.5 },
      safetyEnvelope: envelope,
      seed: 42,
      localProposer,
    });
    expect(archive.candidates).toHaveLength(2);
    expect(archive.admissibleCandidates).toHaveLength(1);
    expect(archive.paretoCandidates).toHaveLength(1);
    expect(archive.candidates[1].rejectionReasons).toEqual(expect.arrayContaining([
      'alpha above maximum',
      'p95 latency exceeds envelope',
    ]));
  });

  it('keeps only non-dominated admissible policies on the Pareto frontier', async () => {
    const archive = await proposeFlywheelCandidates({
      mode: 'local',
      baselinePolicy: { alpha: 0.5 },
      safetyEnvelope: envelope,
      seed: 42,
      localProposer: () => [
        { policy: { alpha: 0.3 }, score: 0.8, resources },
        {
          policy: { alpha: 0.4 },
          score: 0.7,
          resources: { ...resources, p95LatencyMicros: 2_000, costMicrosPerTask: 20 },
        },
        {
          policy: { alpha: 0.2 },
          score: 0.9,
          resources: { ...resources, costMicrosPerTask: 30 },
        },
      ],
    });
    expect(archive.admissibleCandidates).toHaveLength(3);
    expect(archive.paretoCandidates.map((candidate) => candidate.policy.alpha)).toEqual([0.3, 0.2]);
  });

  it('fails closed when Darwin is explicitly requested and unavailable', async () => {
    await expect(proposeFlywheelCandidates({
      mode: 'darwin',
      baselinePolicy: { alpha: 0.5 },
      safetyEnvelope: envelope,
      seed: 42,
      localProposer,
    })).rejects.toBeInstanceOf(DarwinUnavailableError);
  });

  it('marks auto fallback as evaluation-only unless substitution promotion is explicitly allowed', async () => {
    const archive = await proposeFlywheelCandidates({
      mode: 'auto',
      baselinePolicy: { alpha: 0.5 },
      safetyEnvelope: envelope,
      seed: 42,
      localProposer,
    });
    expect(archive).toMatchObject({
      effectiveProposer: 'local',
      proposerSubstitution: 'darwin-unavailable',
      promotionAllowed: false,
    });
  });

  it('records completed Darwin output while still rejecting inadmissible candidates', async () => {
    const archive = await proposeFlywheelCandidates({
      mode: 'darwin',
      baselinePolicy: { alpha: 0.5 },
      safetyEnvelope: envelope,
      seed: 42,
      localProposer,
      darwinInvoker: async () => ({
        completed: true,
        candidates: [{ policy: { networkAccess: true }, resources }],
      }),
    });
    expect(archive.effectiveProposer).toBe('darwin');
    expect(archive.admissibleCandidates).toHaveLength(0);
    expect(archive.candidates[0].rejectionReasons).toContain('policy key not allowed: networkAccess');
  });

  it('enforces aggregate Darwin budget even when the invoker ignores it', async () => {
    await expect(proposeFlywheelCandidates({
      mode: 'darwin',
      baselinePolicy: { alpha: 0.5 },
      safetyEnvelope: { ...envelope, maxEvaluationCostMicros: 1_500 },
      seed: 42,
      localProposer,
      darwinInvoker: async () => ({
        completed: true,
        candidates: [
          { policy: { alpha: 0.3 }, resources },
          { policy: { alpha: 0.4 }, resources },
        ],
      }),
    })).rejects.toThrow(/evaluation-cost budget/);
  });
});
