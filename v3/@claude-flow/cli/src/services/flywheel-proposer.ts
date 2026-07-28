/**
 * ADR-322B proposer adapter.
 *
 * Proposers are untrusted candidate generators. This adapter normalizes local
 * and Darwin output, enforces hard policy/resource admissibility before Pareto
 * ranking, and makes auto-mode substitution evaluation-only by default.
 */
import { canonicalizeJcs, policyCandidateId, sha256Ref, type ProposerName } from './flywheel-receipt.js';

export type ProposerMode = 'auto' | ProposerName;

export interface SafetyEnvelope {
  ref: string;
  allowedPolicyKeys: string[];
  numericBounds?: Record<string, { min?: number; max?: number }>;
  maxP95LatencyMicros: number;
  maxCostMicrosPerTask: number;
  maxTokensPerTask: number;
  maxFailureRate: number;
  maxEvaluationCostMicros: number;
}

export interface CandidateResources {
  p95LatencyMicros: number;
  costMicrosPerTask: number;
  tokensPerTask: number;
  failureRate: number;
  evaluationCostMicros: number;
}

export interface ProposedCandidate {
  policy: Record<string, unknown>;
  resources: CandidateResources;
  score?: number;
  mutation?: string;
  parentIds?: string[];
}

export interface NormalizedCandidate extends ProposedCandidate {
  candidateId: string;
  admissible: boolean;
  rejectionReasons: string[];
}

export interface CandidateArchive {
  archiveVersion: 'ruflo.candidate-archive/v1';
  archiveId: string;
  requestedProposer: ProposerMode;
  effectiveProposer: ProposerName;
  proposerSubstitution?: string;
  promotionAllowed: boolean;
  baselineRef: string;
  safetyEnvelopeRef: string;
  seed: number;
  candidates: NormalizedCandidate[];
  admissibleCandidates: NormalizedCandidate[];
  paretoCandidates: NormalizedCandidate[];
  completed: boolean;
}

export interface DarwinRunInput {
  baselinePolicy: Record<string, unknown>;
  seed: number;
  budget: {
    maxEvaluationCostMicros: number;
    maxConcurrency: number;
    maxWallTimeMs: number;
  };
}

export type DarwinInvoker = (input: DarwinRunInput) => Promise<{
  completed: boolean;
  candidates: ProposedCandidate[];
  reason?: string;
}>;

export interface ProposeCandidatesInput {
  mode: ProposerMode;
  baselinePolicy: Record<string, unknown>;
  safetyEnvelope: SafetyEnvelope;
  seed: number;
  localProposer: (baseline: Record<string, unknown>, seed: number) => ProposedCandidate[] | Promise<ProposedCandidate[]>;
  darwinInvoker?: DarwinInvoker;
  allowSubstitutionPromotion?: boolean;
  maxConcurrency?: number;
  maxWallTimeMs?: number;
  maxCandidates?: number;
}

export class DarwinUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DarwinUnavailableError';
  }
}

function validateCandidate(candidate: ProposedCandidate, envelope: SafetyEnvelope): NormalizedCandidate {
  const reasons: string[] = [];
  const allowed = new Set(envelope.allowedPolicyKeys);
  for (const [key, value] of Object.entries(candidate.policy)) {
    if (!allowed.has(key)) {
      reasons.push(`policy key not allowed: ${key}`);
      continue;
    }
    const bounds = envelope.numericBounds?.[key];
    if (bounds && typeof value === 'number') {
      if (bounds.min !== undefined && value < bounds.min) reasons.push(`${key} below minimum`);
      if (bounds.max !== undefined && value > bounds.max) reasons.push(`${key} above maximum`);
    }
  }
  const r = candidate.resources;
  if (r.p95LatencyMicros > envelope.maxP95LatencyMicros) reasons.push('p95 latency exceeds envelope');
  if (r.costMicrosPerTask > envelope.maxCostMicrosPerTask) reasons.push('cost per task exceeds envelope');
  if (r.tokensPerTask > envelope.maxTokensPerTask) reasons.push('tokens per task exceeds envelope');
  if (r.failureRate > envelope.maxFailureRate) reasons.push('failure rate exceeds envelope');
  if (r.evaluationCostMicros > envelope.maxEvaluationCostMicros) reasons.push('evaluation cost exceeds envelope');
  return {
    ...candidate,
    candidateId: policyCandidateId(candidate.policy),
    admissible: reasons.length === 0,
    rejectionReasons: reasons,
  };
}

function finalizeArchive(input: {
  requested: ProposerMode;
  effective: ProposerName;
  substitution?: string;
  promotionAllowed: boolean;
  baselineRef: string;
  safetyEnvelope: SafetyEnvelope;
  seed: number;
  candidates: ProposedCandidate[];
  completed: boolean;
}): CandidateArchive {
  const normalized = input.candidates.map((candidate) => validateCandidate(candidate, input.safetyEnvelope));
  const admissible = normalized.filter((candidate) => candidate.admissible);
  const dominates = (a: NormalizedCandidate, b: NormalizedCandidate): boolean => {
    const av = [
      a.score ?? 0,
      -a.resources.p95LatencyMicros,
      -a.resources.costMicrosPerTask,
      -a.resources.tokensPerTask,
      -a.resources.failureRate,
      -a.resources.evaluationCostMicros,
    ];
    const bv = [
      b.score ?? 0,
      -b.resources.p95LatencyMicros,
      -b.resources.costMicrosPerTask,
      -b.resources.tokensPerTask,
      -b.resources.failureRate,
      -b.resources.evaluationCostMicros,
    ];
    return av.every((value, index) => value >= bv[index])
      && av.some((value, index) => value > bv[index]);
  };
  const paretoCandidates = admissible.filter((candidate, index) =>
    !admissible.some((other, otherIndex) => otherIndex !== index && dominates(other, candidate)));
  const core = {
    archiveVersion: 'ruflo.candidate-archive/v1' as const,
    requestedProposer: input.requested,
    effectiveProposer: input.effective,
    ...(input.substitution ? { proposerSubstitution: input.substitution } : {}),
    promotionAllowed: input.promotionAllowed,
    baselineRef: input.baselineRef,
    safetyEnvelopeRef: input.safetyEnvelope.ref,
    seed: input.seed,
    candidates: normalized,
    completed: input.completed,
  };
  return {
    ...core,
    archiveId: sha256Ref(canonicalizeJcs(core)),
    admissibleCandidates: admissible,
    paretoCandidates,
  };
}

export async function proposeFlywheelCandidates(input: ProposeCandidatesInput): Promise<CandidateArchive> {
  const baselineRef = policyCandidateId(input.baselinePolicy);
  const runLocal = async (substitution?: string) => finalizeArchive({
    requested: input.mode,
    effective: 'local',
    substitution,
    promotionAllowed: substitution ? input.allowSubstitutionPromotion === true : true,
    baselineRef,
    safetyEnvelope: input.safetyEnvelope,
    seed: input.seed,
    candidates: await input.localProposer(input.baselinePolicy, input.seed),
    completed: true,
  });

  if (input.mode === 'local') return runLocal();
  if (!input.darwinInvoker) {
    if (input.mode === 'darwin') throw new DarwinUnavailableError('Darwin explicitly requested but unavailable');
    return runLocal('darwin-unavailable');
  }

  try {
    const maxWallTimeMs = input.maxWallTimeMs ?? 60_000;
    let timeout: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      input.darwinInvoker({
        baselinePolicy: input.baselinePolicy,
        seed: input.seed,
        budget: {
          maxEvaluationCostMicros: input.safetyEnvelope.maxEvaluationCostMicros,
          maxConcurrency: input.maxConcurrency ?? 2,
          maxWallTimeMs,
        },
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new DarwinUnavailableError('Darwin exceeded wall-time budget')), maxWallTimeMs);
        timeout.unref?.();
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
    if (!result.completed) {
      if (input.mode === 'darwin') throw new DarwinUnavailableError(result.reason ?? 'Darwin archive incomplete');
      return runLocal(`darwin-incomplete:${result.reason ?? 'unknown'}`);
    }
    if (result.candidates.length > (input.maxCandidates ?? 256)) {
      throw new DarwinUnavailableError('Darwin archive exceeded candidate-count budget');
    }
    const evaluationCost = result.candidates.reduce(
      (sum, candidate) => sum + candidate.resources.evaluationCostMicros,
      0,
    );
    if (evaluationCost > input.safetyEnvelope.maxEvaluationCostMicros) {
      throw new DarwinUnavailableError('Darwin archive exceeded evaluation-cost budget');
    }
    return finalizeArchive({
      requested: input.mode,
      effective: 'darwin',
      promotionAllowed: true,
      baselineRef,
      safetyEnvelope: input.safetyEnvelope,
      seed: input.seed,
      candidates: result.candidates,
      completed: true,
    });
  } catch (error) {
    if (input.mode === 'darwin') {
      if (error instanceof DarwinUnavailableError) throw error;
      throw new DarwinUnavailableError(`Darwin failed closed: ${(error as Error).message}`);
    }
    return runLocal(`darwin-error:${(error as Error).message}`);
  }
}
