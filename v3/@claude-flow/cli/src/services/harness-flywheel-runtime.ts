/**
 * Flywheel runtime wiring (ADR-176) — binds runFlywheelTick to the LIVE neural
 * store + retrieval so the daemon can self-optimize on real data. Opt-in
 * (RUFLO_HARNESS_LOOP) and bounded; lazily imports neural-tools so the daemon
 * pays the ONNX cost only when actually running a tick. Never throws.
 */
import { harnessLoopOptedIn } from './harness-worker.js';
import {
  DEFAULT_CONFIG,
  retrievalPolicyNeighbors,
  runFlywheelTick,
  type FlywheelDeps,
  type FlywheelResult,
  type RetrievalConfig,
} from './harness-flywheel.js';
import { runFlywheelGeneration, checkServedChampionDrift, type GenerationResult, type GenerationDeps } from './harness-flywheel-generations.js';
import { loadEffectiveFlywheelAnchor } from './harness-project-anchor.js';
import {
  proposeFlywheelCandidates,
  type DarwinInvoker,
  type ProposerMode,
  type SafetyEnvelope,
} from './flywheel-proposer.js';
import { sha256Ref } from './flywheel-receipt.js';
import { evaluatePolicyRequest } from './policy-runtime.js';

/**
 * The ADR-322 retrieval safety envelope.
 *
 * It MUST describe the policy surface the proposer actually emits —
 * `RetrievalConfig`. The v1 envelope allowed `topK`/`rerank`, which are
 * `neural_patterns` search-call arguments not representable in
 * `RetrievalConfig`, while omitting the three weight axes that
 * `retrievalPolicyNeighbors` does mutate. Because `validateCandidate` checks
 * EVERY key of a candidate policy (candidates are full snapshots, not deltas),
 * that drift made every locally-proposed candidate inadmissible and the local
 * evaluation path unreachable — no receipt, therefore no promotion, ever.
 *
 * Every axis carries a finite bound: an allowed key WITHOUT bounds is an
 * unbounded key, because `validateCandidate` applies bounds only when present.
 * A Darwin proposer could otherwise submit arbitrary weights on the three axes.
 *
 * Exported so tests can bind the REAL envelope to the REAL proposer; the drift
 * survived review precisely because no test wired those two together.
 */
export function retrievalSafetyEnvelope(ref?: string): SafetyEnvelope {
  const allowedPolicyKeys = ['alpha', 'subjectWeight', 'mmrLambda', 'bodyWeight', 'typePenaltyFactor'];
  const numericBounds = {
    alpha: { min: 0.1, max: 0.9 },
    subjectWeight: { min: 0.1, max: 10 },
    mmrLambda: { min: 0.3, max: 0.9 },
    bodyWeight: { min: 0.1, max: 10 },
    typePenaltyFactor: { min: 0.1, max: 10 },
  };
  return {
    ref: ref ?? sha256Ref(JSON.stringify({
      schema: 'ruflo.retrieval-safety-envelope/v2',
      allowedPolicyKeys,
      numericBounds,
    })),
    allowedPolicyKeys,
    numericBounds,
    // Retrieval evaluations are local and report zero provider spend today;
    // finite ceilings make any future resource evidence fail closed.
    maxP95LatencyMicros: 5_000_000,
    maxCostMicrosPerTask: 10_000,
    maxTokensPerTask: 100_000,
    maxFailureRate: 0.01,
    maxEvaluationCostMicros: 1_000_000,
  };
}

/**
 * Run one live flywheel tick against `projectRoot`. Opt-in + $0 default: with
 * RUFLO_HARNESS_LOOP unset it is a no-op. Best-effort; never throws.
 */
export async function runFlywheelWorker(
  projectRoot: string,
  opts: {
    sample?: number;
    optInOverride?: boolean;
    now?: number;
    receiptPrivateKeyPem?: string;
    receiptPublicKeyPem?: string;
    lineageId?: string;
    evaluationRunId?: string;
    safetyEnvelopeRef?: string;
    proposer?: ProposerMode;
    darwinInvoker?: DarwinInvoker;
    allowSubstitutionPromotion?: boolean;
    maxConcurrency?: number;
    evaluationTimeoutMs?: number;
    anchorPath?: string;
    anchorHash?: string;
    anchorManifestPath?: string;
  } = {},
): Promise<FlywheelResult> {
  try {
    if (!(opts.optInOverride ?? harnessLoopOptedIn())) return { ran: false, reason: 'opt-in required (RUFLO_HARNESS_LOOP=1)' };
    const policy = await evaluatePolicyRequest({
      identity: { id: process.env.CLAUDE_FLOW_PRINCIPAL_ID ?? 'metaharness-local', type: 'agent', roles: ['optimizer'] },
      action: {
        type: 'metaharness.flywheel.run',
        resource: projectRoot,
        environment: 'development',
        concurrency: opts.maxConcurrency ?? 2,
      },
    }, projectRoot);
    if (policy.enforcedOutcome !== 'allowed') {
      return { ran: false, reason: `policy-${policy.enforcedOutcome}:${policy.reason}; receipt=${policy.receiptId}` };
    }
    const neural = await import('../mcp-tools/neural-tools.js');
    const applier = await import('../config/harness-feedback-applier.js');
    const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
    if (!tool) return { ran: false, reason: 'neural_patterns tool unavailable' };

    const baseline: RetrievalConfig = {
      ...DEFAULT_CONFIG,
      ...((applier.activeChampion(projectRoot)?.params as Partial<RetrievalConfig>) ?? {}),
    };
    const safetyEnvelope = retrievalSafetyEnvelope(opts.safetyEnvelopeRef);
    const anchor = loadEffectiveFlywheelAnchor(projectRoot, {
      anchorPath: opts.anchorPath ?? process.env.RUFLO_FLYWHEEL_ANCHOR_PATH,
      anchorHash: opts.anchorHash ?? process.env.RUFLO_FLYWHEEL_ANCHOR_HASH,
      manifestPath: opts.anchorManifestPath ?? process.env.RUFLO_FLYWHEEL_ANCHOR_MANIFEST,
    });
    // CLI flag opts.proposer takes precedence over RUFLO_FLYWHEEL_PROPOSER.
    const proposerMode = opts.proposer
      ?? ((process.env.RUFLO_FLYWHEEL_PROPOSER as ProposerMode | undefined) ?? 'auto');
    if (!['auto', 'local', 'darwin'].includes(proposerMode)) {
      return { ran: false, reason: `invalid proposer mode: ${proposerMode}` };
    }
    const archive = await proposeFlywheelCandidates({
      mode: proposerMode,
      baselinePolicy: baseline as unknown as Record<string, unknown>,
      safetyEnvelope,
      seed: opts.now ?? Date.now(),
      localProposer: () => retrievalPolicyNeighbors(baseline).map((policy) => ({
        policy: policy as unknown as Record<string, unknown>,
        resources: {
          p95LatencyMicros: 0,
          costMicrosPerTask: 0,
          tokensPerTask: 0,
          failureRate: 0,
          evaluationCostMicros: 0,
        },
      })),
      darwinInvoker: opts.darwinInvoker,
      allowSubstitutionPromotion: opts.allowSubstitutionPromotion,
      maxConcurrency: Math.max(1, Math.min(opts.maxConcurrency ?? 2, 8)),
      maxWallTimeMs: opts.evaluationTimeoutMs ?? 120_000,
    });
    const candidatePolicies = archive.paretoCandidates.map((candidate) => candidate.policy as unknown as RetrievalConfig);
    if (!candidatePolicies.length) return { ran: false, reason: 'proposer archive contained no admissible candidates' };

    const deps: FlywheelDeps = {
      getPatterns: () => neural.getStorePatterns(),
      search: async (query, cfg: RetrievalConfig) => {
        const r = await tool.handler({ action: 'search', query, mode: 'hybrid', limit: 5, rerank: false, ...cfg }) as { results?: Array<{ id?: string; name?: string }> };
        return (r.results || []).slice(0, 5).map((m) => ({ id: m?.id ?? '', name: m?.name ?? '' }));
      },
      anchorTasks: anchor.tasks,
      anchorRef: anchor.anchorRef,
      activeParams: () => baseline,
      sample: opts.sample ?? 40,
      now: opts.now,
      receiptPrivateKeyPem: opts.receiptPrivateKeyPem,
      receiptPublicKeyPem: opts.receiptPublicKeyPem,
      lineageId: opts.lineageId,
      evaluationRunId: opts.evaluationRunId,
      safetyEnvelopeRef: safetyEnvelope.ref,
      requestedProposer: archive.requestedProposer,
      effectiveProposer: archive.effectiveProposer,
      proposerSubstitution: archive.proposerSubstitution,
      candidatePolicies,
      maxConcurrency: Math.max(1, Math.min(opts.maxConcurrency ?? 2, 8)),
      evaluationTimeoutMs: opts.evaluationTimeoutMs,
    };
    return await runFlywheelTick(projectRoot, deps);
  } catch (e) {
    return { ran: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}

/**
 * Run ONE live COMPOUNDING generation against the persisted lineage (ADR-176
 * A-P3b — the autonomy loop). Reads the current champion as baseline, evaluates
 * a constrained candidate on the frozen self-supervised held-out with the human
 * anchor guard, and — on a verified promotion — advances the champion so the
 * NEXT daemon tick compounds on it. Shadow-first (serve lags one tick). Opt-in,
 * $0 default; never throws.
 */
export async function runFlywheelGenerationWorker(
  projectRoot: string,
  opts: {
    sample?: number;
    optInOverride?: boolean;
    now?: number;
    anchorPath?: string;
    anchorHash?: string;
    anchorManifestPath?: string;
  } = {},
): Promise<GenerationResult> {
  try {
    if (!(opts.optInOverride ?? harnessLoopOptedIn())) return { ran: false, reason: 'opt-in required (RUFLO_HARNESS_LOOP=1)', generation: 0 };
    const neural = await import('../mcp-tools/neural-tools.js');
    const tool = neural.neuralTools.find((t) => t.name === 'neural_patterns');
    if (!tool) return { ran: false, reason: 'neural_patterns tool unavailable', generation: 0 };
    const anchor = loadEffectiveFlywheelAnchor(projectRoot, {
      anchorPath: opts.anchorPath ?? process.env.RUFLO_FLYWHEEL_ANCHOR_PATH,
      anchorHash: opts.anchorHash ?? process.env.RUFLO_FLYWHEEL_ANCHOR_HASH,
      manifestPath: opts.anchorManifestPath ?? process.env.RUFLO_FLYWHEEL_ANCHOR_MANIFEST,
    });
    const deps: GenerationDeps = {
      getPatterns: () => neural.getStorePatterns(),
      search: async (query, cfg: RetrievalConfig) => {
        const r = await tool.handler({ action: 'search', query, mode: 'hybrid', limit: 5, rerank: false, ...cfg }) as { results?: Array<{ id?: string; name?: string }> };
        return (r.results || []).slice(0, 5).map((m) => ({ id: m?.id ?? '', name: m?.name ?? '' }));
      },
      anchorTasks: anchor.tasks.map((task) => ({
        id: task.id,
        q: task.input.q,
        labels: task.expected,
      })),
      humanEvalHash: anchor.anchorRef,
      sample: opts.sample ?? 120,
      now: opts.now ?? Date.now(),
    };
    // Deployment-safety canary first: roll back the served champion if the real
    // store has drifted since it was promoted. Then run the next generation.
    await checkServedChampionDrift(projectRoot, deps);
    return await runFlywheelGeneration(projectRoot, deps);
  } catch (e) {
    return { ran: false, reason: `error: ${(e as Error)?.message ?? e}`, generation: 0 };
  }
}
