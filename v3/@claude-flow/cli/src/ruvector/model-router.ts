/**
 * Intelligent Model Router — lexical complexity heuristic + Thompson bandit
 *
 * Dynamically routes requests to the optimal Claude model (haiku/sonnet/opus)
 * based on task complexity, uncertainty, and online-learned routing outcomes.
 *
 * Mechanism (shipped):
 * - Complexity score = blend of lexical, semantic-depth, task-scope, and
 *   uncertainty heuristics (see `computeLexicalComplexity` and friends).
 *   Pure JS arithmetic — no model load, no tensor math.
 * - Model selection = Thompson-sampling Beta-Bernoulli bandit with
 *   complexity-bucketed Beta(α,β) priors, persisted to
 *   `.swarm/model-router-state.json` and updated by `recordOutcome` after
 *   each routing decision.
 * - Uncertainty quantification + a circuit breaker drive escalation when
 *   the bandit's confidence is low or downstream failures are observed.
 *
 * Routing Strategy:
 * - Haiku: high confidence, low complexity (fast, cheap)
 * - Sonnet: medium confidence, moderate complexity (balanced)
 * - Opus: low confidence, high complexity (most capable)
 *
 * Note (#2329): An earlier design (ADR-026 + this file's previous header)
 * described a Tiny-Dancer / FastGRNN neural router with embedding-based
 * complexity scoring. That path was never wired in directly.
 *
 * Note (ADR-148, #2334): The cost-optimal neural router is now wired as an
 * optional, gated addition via `./neural-router.ts` (which uses
 * `@metaharness/router`, optionally accelerated by `@ruvector/tiny-dancer`).
 * It is double-gated on `CLAUDE_FLOW_ROUTER_NEURAL=1` + an embedding being
 * supplied + a corpus/artifact being loadable. When any gate is closed the
 * shipped heuristic + bandit path runs unchanged and the result carries
 * `routedBy: 'heuristic'` (default) or `'bandit-fallback'` (neural enabled
 * but declined). When all gates are open and a backend resolves, the result
 * carries `routedBy: 'metaharness-knn' | 'metaharness-krr' | 'fastgrnn'`.
 *
 * @module model-router
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

// ----------------------------------------------------------------------------
// Lazy module loaders — initialised once per process. The dynamic-import calls
// keep these modules off the critical-path-cold-start, but we want subsequent
// route() calls to pay only a Map lookup, not a new Promise per call.
// ----------------------------------------------------------------------------
let _neuralRouterMod: Promise<typeof import('./neural-router.js')> | null = null;
function loadNeuralRouter(): Promise<typeof import('./neural-router.js')> {
  if (_neuralRouterMod === null) _neuralRouterMod = import('./neural-router.js');
  return _neuralRouterMod;
}
let _trajectoryMod: Promise<typeof import('./router-trajectory.js')> | null = null;
function loadTrajectoryRecorder(): Promise<typeof import('./router-trajectory.js')> {
  if (_trajectoryMod === null) _trajectoryMod = import('./router-trajectory.js');
  return _trajectoryMod;
}
// ADR-150 iter 11–12 — parallel-decision recorder for the SelfEvolvingRouter
// promotion gate. Dynamic-imported lazily so the routing hot path never
// pays the load cost when CLAUDE_FLOW_ROUTER_PARALLEL_LOG is unset.
let _parallelRecorderMod: Promise<typeof import('./router-parallel-recorder.js')> | null = null;
function loadParallelRecorder(): Promise<typeof import('./router-parallel-recorder.js')> {
  if (_parallelRecorderMod === null) _parallelRecorderMod = import('./router-parallel-recorder.js');
  return _parallelRecorderMod;
}

// ----------------------------------------------------------------------------
// ADR-148 phase 2 — per-tier OpenRouter alternates. Loaded once per process
// from `assets/model-router/openrouter-alts.json` (override path via env).
// ----------------------------------------------------------------------------
interface OpenRouterAlts {
  tiers: Partial<Record<string, {
    anthropic_default: string;
    openrouter_alt: string;
    cost_per_m_tok_in: number;
    cost_per_m_tok_out: number;
    rationale?: string;
  }>>;
}
let _altsCache: OpenRouterAlts | null = null;
let _altsProbeDone = false;
function loadOpenRouterAlts(): OpenRouterAlts | null {
  if (_altsProbeDone) return _altsCache;
  _altsProbeDone = true;
  try {
    // Probe candidate paths: explicit env override, then asset locations
    // relative to this file (src dev) and the dist build.
    const explicit = process.env.CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS;
    const candidates: string[] = [];
    if (explicit) candidates.push(explicit);
    // Probe asset dirs without using import.meta.url so this stays compatible
    // with both CJS and ESM consumers of the compiled .js.
    candidates.push(join(process.cwd(), 'v3', '@claude-flow', 'cli', 'assets', 'model-router', 'openrouter-alts.json'));
    candidates.push(join(process.cwd(), 'assets', 'model-router', 'openrouter-alts.json'));
    for (const p of candidates) {
      if (existsSync(p)) {
        _altsCache = JSON.parse(readFileSync(p, 'utf8')) as OpenRouterAlts;
        return _altsCache;
      }
    }
  } catch {
    // Silent — alts are optional.
  }
  return null;
}

/** Return the resolved provider + OpenRouter model for the picked tier. */
function resolveExecutionProvider(model: ClaudeModel): { provider: 'anthropic' | 'openrouter'; openrouterModel?: string } {
  const explicit = process.env.CLAUDE_FLOW_ROUTER_PROVIDER?.toLowerCase();
  // Default: anthropic unless explicitly set to openrouter, or OPENROUTER_API_KEY
  // is the only credential present (matches agent-execute-core's selection).
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const wantOR =
    explicit === 'openrouter' ||
    (!hasAnthropic && hasOpenRouter && explicit !== 'anthropic');
  if (!wantOR) return { provider: 'anthropic' };
  const alts = loadOpenRouterAlts();
  if (!alts) return { provider: 'openrouter' }; // OR provider but no alt slug
  const entry = alts.tiers[model];
  if (!entry?.openrouter_alt) return { provider: 'openrouter' };
  return { provider: 'openrouter', openrouterModel: entry.openrouter_alt };
}

// ============================================================================
// Types & Constants
// ============================================================================

/**
 * Available Claude models for routing
 */
export type ClaudeModel = 'haiku' | 'sonnet' | 'opus' | 'inherit';

/**
 * Model capabilities and characteristics
 */
export const MODEL_CAPABILITIES: Record<ClaudeModel, {
  maxComplexity: number;
  costMultiplier: number;
  speedMultiplier: number;
  description: string;
}> = {
  haiku: {
    maxComplexity: 0.4,
    costMultiplier: 0.04,  // ~25x cheaper than Opus
    speedMultiplier: 3.0,   // ~3x faster than Sonnet
    description: 'Fast, cost-effective for simple tasks',
  },
  sonnet: {
    maxComplexity: 0.7,
    costMultiplier: 0.2,    // ~5x cheaper than Opus
    speedMultiplier: 1.5,   // ~1.5x faster than Opus
    description: 'Balanced capability and cost',
  },
  opus: {
    maxComplexity: 1.0,
    costMultiplier: 1.0,    // Baseline
    speedMultiplier: 1.0,   // Baseline
    description: 'Most capable for complex reasoning',
  },
  inherit: {
    maxComplexity: 1.0,
    costMultiplier: 1.0,
    speedMultiplier: 1.0,
    description: 'Use parent model selection',
  },
};

/**
 * Complexity indicators for task classification
 */
export const COMPLEXITY_INDICATORS = {
  high: [
    'architect', 'design', 'refactor', 'optimize', 'security', 'audit',
    'complex', 'analyze', 'investigate', 'debug', 'performance', 'scale',
    'distributed', 'concurrent', 'algorithm', 'system', 'integration',
  ],
  medium: [
    'implement', 'feature', 'add', 'update', 'modify', 'fix', 'test',
    'review', 'validate', 'check', 'improve', 'enhance', 'extend',
  ],
  low: [
    'simple', 'typo', 'comment', 'format', 'rename', 'move', 'copy',
    'delete', 'documentation', 'readme', 'config', 'version', 'bump',
  ],
};

/**
 * Model router configuration
 */
export interface ModelRouterConfig {
  /** Confidence threshold for model selection (default: 0.85) */
  confidenceThreshold: number;
  /** Maximum uncertainty before escalating (default: 0.15) */
  maxUncertainty: number;
  /** Enable circuit breaker (default: true) */
  enableCircuitBreaker: boolean;
  /** Failures before circuit opens (default: 5) */
  circuitBreakerThreshold: number;
  /** Path for router state persistence */
  statePath: string;
  /** Auto-save interval in decisions (default: 20) */
  autoSaveInterval: number;
  /** Enable cost optimization (default: true) */
  enableCostOptimization: boolean;
  /** Prefer faster models when confidence is high (default: true) */
  preferSpeed: boolean;
  /**
   * Discounted Thompson sampling factor applied to every bucket/model's
   * α/β on each recordOutcome call, BEFORE that call's own reward is added
   * (Discounted TS — arXiv 2305.10718): `α ← γα`, `β ← γβ`. Range (0, 1];
   * 1 = disabled (default — fully backward compatible with persisted
   * `.swarm/model-router-state.json` state). γ<1 makes old routing history
   * decay geometrically so the bandit recovers faster after a sustained
   * shift in a model's real-world quality, instead of unbounded accumulated
   * history permanently dominating the posterior. Mirrors the epsilon decay
   * `q-learning-router.ts` already applies to its own exploration rate.
   */
  priorDecay: number;
}

/**
 * Routing decision result
 */
export interface ModelRoutingResult {
  /** Selected model */
  model: ClaudeModel;
  /** Confidence in the decision (0-1) */
  confidence: number;
  /** Uncertainty estimate (0-1) */
  uncertainty: number;
  /** Computed complexity score (0-1) */
  complexity: number;
  /** Reasoning for the selection */
  reasoning: string;
  /** Alternative models considered */
  alternatives: Array<{ model: ClaudeModel; score: number }>;
  /** Inference time in microseconds */
  inferenceTimeUs: number;
  /** Estimated cost multiplier */
  costMultiplier: number;
  /**
   * Which decision mechanism produced this result (ADR-148 / ADR-074 —
   * observable, not inferred). Always one of:
   *   'heuristic'        — neural disabled (default). Pure Thompson bandit.
   *   'bandit-fallback'  — neural enabled but returned no decision (load fail).
   *   'hybrid'           — neural enabled AND returned predictions; the
   *                        bandit's Beta(α,β) priors were perturbed by the
   *                        neural's predicted quality before sampling.
   */
  routedBy: 'hybrid' | 'bandit-fallback' | 'heuristic';
  /**
   * The neural backend that contributed to a `hybrid` decision, if any.
   * Absent on `heuristic` and `bandit-fallback`. Tracked separately from
   * `routedBy` so the decision mechanism and the model identity remain
   * distinct observable surfaces.
   */
  neuralBackend?: 'metaharness-knn' | 'metaharness-krr' | 'fastgrnn';
  /**
   * Execution provider hint (ADR-148 phase 2). 'anthropic' = default
   * Anthropic API path (MODEL_MAP). 'openrouter' = call through
   * OpenRouter using `openrouterModel`. Resolved per-call from
   * `CLAUDE_FLOW_ROUTER_PROVIDER` / `OPENROUTER_API_KEY`.
   */
  provider?: 'anthropic' | 'openrouter';
  /**
   * Concrete OpenRouter model slug for this tier when `provider==='openrouter'`,
   * loaded from `assets/model-router/openrouter-alts.json` (overridable via
   * `CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS=<path>`). Downstream consumers can
   * use this to override the default MODEL_MAP-derived Anthropic slug.
   */
  openrouterModel?: string;
  /**
   * ADR-149 — concrete picked model id (e.g. `openai/gpt-4.1`,
   * `inclusionai/ling-2.6-flash`, `anthropic/claude-sonnet-4-6`). Set when
   * the neural backend returned a per-model pick. The `model` field above
   * remains the tier label for back-compat with Anthropic-API consumers
   * that map tier → MODEL_MAP id.
   */
  modelId?: string;
}

/**
 * Complexity analysis result
 */
export interface ComplexityAnalysis {
  /** Overall complexity score (0-1) */
  score: number;
  /** Indicators found */
  indicators: {
    high: string[];
    medium: string[];
    low: string[];
  };
  /** Feature breakdown */
  features: {
    lexicalComplexity: number;
    semanticDepth: number;
    taskScope: number;
    uncertaintyLevel: number;
  };
}

/**
 * Beta(α, β) prior for Thompson sampling. Each model carries one of these;
 * outcomes update α (successes) and β (failures) so the router auto-balances
 * cost/quality without manual threshold tuning. See ADR-101.
 */
export interface BetaPrior {
  alpha: number;
  beta: number;
}

/**
 * Cost-adjusted Bernoulli rewards for Thompson sampling updates. Higher
 * reward when the right tier is chosen — Haiku-success > Sonnet-success >
 * Opus-success because Opus-success on a simple task is wasteful even when
 * the answer is correct. Escalations get partial credit at best (Sonnet) or
 * zero (Haiku/Opus) since they signal the initial choice was wrong.
 */
const BANDIT_REWARDS: Record<ClaudeModel, Record<'success' | 'failure' | 'escalated', number>> = {
  haiku:   { success: 1.0, failure: 0.0, escalated: 0.0 },
  sonnet:  { success: 0.7, failure: 0.0, escalated: 0.1 },
  opus:    { success: 0.4, failure: 0.0, escalated: 0.0 },
  inherit: { success: 0.5, failure: 0.0, escalated: 0.0 },
};

/**
 * Router state for persistence
 */
/**
 * Complexity bucket for per-task bandit priors. Bands mirror
 * MODEL_CAPABILITIES.maxComplexity (haiku 0.4, sonnet 0.7) so the taxonomy
 * isn't arbitrary. Keying priors by bucket fixes the global-bandit defect where
 * failures on one task type suppressed a model for ALL task types (audit
 * docs/reviews/intelligence-system-audit-2026-05-29.md; see ADR-142).
 */
export type ComplexityBucket = 'low' | 'med' | 'high';

function complexityBucket(score: number): ComplexityBucket {
  if (score < 0.4) return 'low';   // haiku territory
  if (score < 0.7) return 'med';   // sonnet territory
  return 'high';                    // opus territory
}

type BucketedPriors = Record<ComplexityBucket, Record<ClaudeModel, BetaPrior>>;
/**
 * ADR-149 — per-modelId Beta priors, keyed by complexity bucket. Shadow
 * state that accumulates from recordOutcomeByModelId() so the bandit can
 * distinguish e.g. `inclusionai/ling-2.6-flash` from
 * `anthropic/claude-haiku-4-5-20251001` even though both collapse to the
 * `haiku` tier in BucketedPriors. Selection still uses BucketedPriors;
 * a future refactor switches to BucketedPriorsById when it has enough
 * data to be trustworthy.
 */
type BucketedPriorsById = Record<ComplexityBucket, Record<string, BetaPrior>>;

interface RouterState {
  totalDecisions: number;
  modelDistribution: Record<ClaudeModel, number>;
  avgComplexity: number;
  avgConfidence: number;
  circuitBreakerTrips: number;
  lastUpdated: string;
  learningHistory: Array<{
    task: string;
    model: ClaudeModel;
    complexity: number;
    outcome: 'success' | 'failure' | 'escalated';
    timestamp: string;
  }>;
  /** Persisted-schema version. v2 = per-bucket tier priors (ADR-142). v3 = adds priorsById (ADR-149). */
  version?: number;
  /**
   * Beta(α, β) priors per complexity bucket per tier — populated by
   * recordOutcome via Thompson sampling. Defaults to {alpha:1,beta:1}
   * (uniform). Keyed by bucket so e.g. haiku failures on hard tasks don't
   * suppress haiku for easy tasks. Old flat per-model files migrate forward
   * (see migratePriors).
   */
  priors?: BucketedPriors;
  /**
   * ADR-149 v3 — per-modelId Beta priors. Additive shadow state populated
   * by recordOutcomeByModelId() with the concrete model id from the
   * cost-optimal neural pick (e.g. 'inclusionai/ling-2.6-flash'). Lets the
   * bandit learn that different models within the same tier perform
   * differently. NOT yet consumed by selectModel() — that switch lands in
   * a follow-up once enough per-modelId data has accumulated.
   */
  priorsById?: BucketedPriorsById;
}

// ============================================================================
// Beta Sampling for Thompson Sampling Bandit
// ============================================================================

/**
 * Standard normal sample via Box-Muller. Used by Marsaglia-Tsang Gamma.
 * Module-local so the bandit doesn't pull in a heavy stats dep.
 */
function sampleStandardNormal(): number {
  const u1 = Math.random() || 1e-12; // avoid log(0)
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Sample from Gamma(shape α, scale=1). Marsaglia & Tsang (2000), with the
 * standard "boost α<1 by α+1 then scale by U^(1/α)" trick for shape parameters
 * smaller than 1. O(1) expected, no rejection-loop pathology in practice.
 */
function sampleGamma(alpha: number): number {
  if (alpha < 1) {
    const u = Math.random() || 1e-12;
    return sampleGamma(alpha + 1) * Math.pow(u, 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = sampleStandardNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    const xx = x * x;
    if (u < 1 - 0.0331 * xx * xx) return d * v;
    if (Math.log(u) < 0.5 * xx + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Sample θ ~ Beta(α, β) via the identity Beta(α,β) = X / (X+Y) where
 * X ~ Gamma(α), Y ~ Gamma(β). Returns the mean for degenerate α+β=0
 * (shouldn't happen in practice but defensive).
 */
export function sampleBeta(alpha: number, beta: number): number {
  if (alpha <= 0 || beta <= 0) return 0.5;
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  const denom = x + y;
  return denom > 0 ? x / denom : 0.5;
}

/**
 * Default uniform priors (no prior knowledge). Beta(1,1) is the standard
 * Bayesian-Bernoulli starting point — uniform over [0,1].
 */
function defaultBanditPriors(): Record<ClaudeModel, BetaPrior> {
  return {
    haiku:   { alpha: 1, beta: 1 },
    sonnet:  { alpha: 1, beta: 1 },
    opus:    { alpha: 1, beta: 1 },
    inherit: { alpha: 1, beta: 1 },
  };
}

/** Uniform priors for every complexity bucket (cold start). */
function defaultBucketedPriors(): BucketedPriors {
  return { low: defaultBanditPriors(), med: defaultBanditPriors(), high: defaultBanditPriors() };
}

/** ADR-149 — empty per-modelId shadow priors. Each bucket starts as `{}`; entries
 *  populate on first `recordOutcomeByModelId(task, modelId, outcome)` call. */
function defaultBucketedPriorsById(): BucketedPriorsById {
  return { low: {}, med: {}, high: {} };
}

function clonePriors(p: Record<ClaudeModel, BetaPrior>): Record<ClaudeModel, BetaPrior> {
  return { haiku: { ...p.haiku }, sonnet: { ...p.sonnet }, opus: { ...p.opus }, inherit: { ...p.inherit } };
}

/**
 * Forward-migrate a persisted `priors` field of any layout to the bucketed
 * shape, never throwing (ADR-142):
 *  - missing/garbage → fresh uniform buckets
 *  - already bucketed (has `low.haiku`) → kept, backfilling any missing bucket
 *  - flat per-model (v1 bandit) → seed ALL buckets from it (lossless: prior
 *    learning becomes a shared starting point that then diverges per bucket)
 */
function migratePriors(p: unknown): BucketedPriors {
  if (!p || typeof p !== 'object') return defaultBucketedPriors();
  const obj = p as Record<string, any>;
  if (obj.low && typeof obj.low === 'object' && obj.low.haiku) {
    return {
      low: obj.low,
      med: obj.med ?? clonePriors(obj.low),
      high: obj.high ?? clonePriors(obj.low),
    };
  }
  if (obj.haiku && typeof obj.haiku.alpha === 'number') {
    const flat = obj as Record<ClaudeModel, BetaPrior>;
    return { low: clonePriors(flat), med: clonePriors(flat), high: clonePriors(flat) };
  }
  return defaultBucketedPriors();
}

// ============================================================================
// Default Configuration
// ============================================================================

// #2250 — env override for maxUncertainty so callers can suppress the
// escalation without recompiling. Parsed once at module load; invalid /
// out-of-range values fall through to the default below.
function envMaxUncertainty(): number | undefined {
  const raw = process.env.CLAUDE_FLOW_MAX_UNCERTAINTY;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return n;
}

const DEFAULT_CONFIG: ModelRouterConfig = {
  confidenceThreshold: 0.85,
  maxUncertainty: envMaxUncertainty() ?? 0.15,
  enableCircuitBreaker: true,
  circuitBreakerThreshold: 5,
  statePath: '.swarm/model-router-state.json',
  autoSaveInterval: 1, // Save after every decision for CLI persistence
  enableCostOptimization: true,
  preferSpeed: true,
  priorDecay: 1,
};

// Beta shape parameters must stay well clear of 0 for sampleGamma/sampleBeta
// to remain numerically stable across a persisted, long-running state file —
// see priorDecay's doc comment. Geometric decay alone (no reward added back)
// would otherwise shrink an unused bucket/model's α,β toward 0 forever.
const PRIOR_DECAY_FLOOR = 0.05;

// Posterior mean of a Beta(α,β) prior — used by the #2250 escalation guard
// to detect when the bandit has *learned* the escalation target is worse.
function priorMean(p: { alpha: number; beta: number }): number {
  return p.alpha / (p.alpha + p.beta);
}

// ============================================================================
// Model Router Implementation
// ============================================================================

/**
 * Intelligent Model Router using complexity-based routing
 */
export class ModelRouter {
  private config: ModelRouterConfig;
  private state: RouterState;
  private decisionCount = 0;
  private consecutiveFailures: Record<ClaudeModel, number> = {
    haiku: 0,
    sonnet: 0,
    opus: 0,
    inherit: 0,
  };
  /**
   * ADR-148 — in-memory counters surfaced via `getStats()` and read by the
   * `hooks_intelligence_stats` MCP tool. Process-local, not persisted (these
   * are operational metrics, not authoritative state — see ADR-074/086).
   */
  private routedByCounts: Record<ModelRoutingResult['routedBy'], number> = {
    heuristic: 0,
    'bandit-fallback': 0,
    hybrid: 0,
  };
  private neuralBackendCounts: Record<NonNullable<ModelRoutingResult['neuralBackend']>, number> = {
    'metaharness-knn': 0,
    'metaharness-krr': 0,
    fastgrnn: 0,
  };
  private abDisagreements = 0;
  private abComparisons = 0;

  constructor(config: Partial<ModelRouterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    // priorDecay multiplies directly into persisted α/β (recordOutcome). An
    // out-of-range value (NaN, <=0, >1 — e.g. a bad env/config parse) would
    // silently poison `.swarm/model-router-state.json` forever: Math.max's
    // NaN-poisoning bypasses sampleBeta's own alpha<=0||beta<=0 fallback, and
    // a negative value pins every prior at PRIOR_DECAY_FLOOR on the very
    // first call. Fall through to the safe default (1 = disabled) instead of
    // throwing, matching this file's existing malformed-config idiom (see
    // envMaxUncertainty above).
    if (!Number.isFinite(this.config.priorDecay) || this.config.priorDecay <= 0 || this.config.priorDecay > 1) {
      this.config.priorDecay = 1;
    }
    this.state = this.loadState();
  }

  /**
   * Route a task to the optimal model.
   *
   * When `embedding` is supplied and `CLAUDE_FLOW_ROUTER_NEURAL=1` is set,
   * the cost-optimal neural backend (ADR-148) is consulted first; its
   * decision is used when its `metBar` clears the configured quality bar
   * and `routedBy` reflects which backend produced the decision. Otherwise
   * the shipped heuristic + Thompson bandit path runs (byte-identical to
   * the pre-ADR-148 behavior) and the result carries `routedBy:
   * 'bandit-fallback'` (neural was enabled but declined) or
   * `'heuristic'` (neural was disabled).
   */
  async route(task: string, embedding?: number[]): Promise<ModelRoutingResult> {
    const startTime = performance.now();

    // Analyze task complexity
    const complexity = this.analyzeComplexity(task, embedding);

    // ADR-148 — optional neural cost-optimal path (gated, opt-in).
    //
    // Hybrid math: we use the neural's per-candidate predicted quality as a
    // weighted prior on the bandit's Beta(α,β) posterior, rather than
    // overriding the bandit's pick. With weight=w (env-tunable, default 5)
    // each candidate's Beta becomes Beta(α + q*w, β + (1-q)*w). Cold start
    // → neural dominates (α+β ≈ 2 + w); many real outcomes → bandit
    // dominates (α+β >> w). The persistent bandit state is unchanged.
    //
    // `bandit-fallback` is reserved for the case where neural was enabled
    // but the backend returned no decision at all (artifact load failed,
    // dim mismatch, etc.). In that case we route via pure bandit.
    let neuralPrior: { qualities: Partial<Record<ClaudeModel, number>>; weight: number } | null = null;
    let neuralBackend: ModelRoutingResult['neuralBackend'] | undefined = undefined;
    let neuralModelId: string | undefined = undefined;
    let neuralDeclined = false;
    // iter 46 — capture iter 45's ensemble-disagreement diagnostic so we can
    // persist it to the trajectory below; downstream tuners (future) can
    // analyze the distribution to recommend an iter 44 threshold.
    let neuralEnsembleDisagreement: number | undefined = undefined;
    if (embedding && embedding.length > 0 && process.env.CLAUDE_FLOW_ROUTER_NEURAL === '1') {
      try {
        const { tryCostOptimalRoute } = await loadNeuralRouter();
        // ADR-149 iter 15 — pass the task's complexity bucket through so
        // the neural-router's per-modelId Thompson (when gated on) can
        // use the bucket-specific prior instead of marginalising.
        const nr = await tryCostOptimalRoute(embedding, { complexityBucket: complexityBucket(complexity.score) });
        if (nr) {
          // ADR-149: capture the concrete picked model id (the cost-optimal
          // pick across all candidates, not just within a tier).
          neuralModelId = nr.modelId;
          neuralEnsembleDisagreement = nr.ensembleDisagreement;
          // Build per-tier quality map for the bandit prior. The neural
          // backend returns per-model alternatives (e.g. 7 distinct slugs);
          // for the Beta-prior bump we collapse to tier by taking the MAX
          // predicted quality within each tier — the tier whose best
          // candidate is best overall is the tier the bandit should favor.
          // Then we apply rank-based scaling [1.0, 0.5, 0.2] across the
          // three tiers so the Beta bumps are well-separated (raw KRR
          // outputs are typically in a narrow band — see ADR-148 phase 1).
          const sorted = [...nr.alternatives].sort((a, b) => b.predictedQuality - a.predictedQuality);
          if (!sorted.find(s => s.model === nr.model)) {
            sorted.unshift({ model: nr.model, modelId: nr.modelId, predictedQuality: nr.predictedQuality, costPerMTok: 0 });
          }
          // Collapse per-model alternatives → per-tier MAX quality, preserving
          // first-occurrence order (which is best-quality first thanks to the sort).
          const tierMaxQ: Partial<Record<ClaudeModel, number>> = {};
          const tierOrder: ClaudeModel[] = [];
          for (const a of sorted) {
            if (tierMaxQ[a.model] === undefined) {
              tierMaxQ[a.model] = a.predictedQuality;
              tierOrder.push(a.model);
            } else if (a.predictedQuality > (tierMaxQ[a.model] ?? 0)) {
              tierMaxQ[a.model] = a.predictedQuality;
            }
          }
          const rankQ = [1.0, 0.5, 0.2];
          const qualities: Partial<Record<ClaudeModel, number>> = {};
          for (let i = 0; i < tierOrder.length && i < rankQ.length; i++) {
            qualities[tierOrder[i]] = rankQ[i];
          }
          const weight = parseFloat(process.env.CLAUDE_FLOW_ROUTER_NEURAL_WEIGHT ?? '5') || 5;
          neuralPrior = { qualities, weight };
          neuralBackend = nr.routedBy;
        } else {
          neuralDeclined = true;
        }
      } catch {
        // Silent — neural path is best-effort.
      }
    }

    const scores = this.computeModelScores(complexity);
    const adjustedScores = this.applyCircuitBreaker(scores);

    // A/B mode: compute the pure-bandit pick alongside the hybrid pick so
    // we can log disagreement. Both samples are drawn from the same Beta
    // posteriors but with/without the neural prior bump — useful for
    // measuring real lift before flipping defaults.
    //
    // iter 37 — TWO knobs:
    //   CLAUDE_FLOW_ROUTER_AB=1                    → A/B on every call (orig)
    //   CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE=<0..1>   → A/B on a sampled subset,
    //     keyed deterministically by task_hash so the same task always falls
    //     in or out of the sample. Lets production accumulate ab_pair data
    //     passively at low overhead (e.g. 0.05 = 5% of decisions).
    //   Both set → SAMPLE_RATE wins (more specific).
    const rateRaw = process.env.CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE;
    const rate = rateRaw ? Math.max(0, Math.min(1, parseFloat(rateRaw) || 0)) : 0;
    const allOn = process.env.CLAUDE_FLOW_ROUTER_AB === '1';
    let inSample = false;
    if (rate > 0) {
      // Deterministic sample by FNV-1a-32 of the task text. Same task always
      // gets the same A/B decision across re-runs (reproducible tests, stable
      // population over time). Inlined to avoid the async router-trajectory
      // import on the hot path.
      let h = 0x811c9dc5 >>> 0;
      for (let i = 0; i < task.length; i++) {
        h ^= task.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      inSample = (h % 10000) / 10000 < rate;
    }
    const abEnabled = (rate > 0 ? inSample : allOn) && neuralPrior !== null;
    let abPair: { bandit_pick: ClaudeModel; hybrid_pick: ClaudeModel; disagree: boolean } | undefined;
    if (abEnabled) {
      // Pre-compute the bandit-only pick. Single extra Thompson sample per
      // call — independent draws are noisy but cheap (~3 Beta samples ≈
      // <10 μs). For a per-call disagreement signal one draw is fine; over
      // N decisions the rate stabilises.
      const banditOnly = this.selectModel(adjustedScores, complexity.score, undefined);
      const picked = this.selectModel(adjustedScores, complexity.score, neuralPrior ?? undefined);
      abPair = {
        bandit_pick: banditOnly.model,
        hybrid_pick: picked.model,
        disagree: banditOnly.model !== picked.model,
      };
      this.abComparisons++;
      if (abPair.disagree) this.abDisagreements++;

      // ADR-150 iter 12 — opt-in parallel-decision recorder. No-op when
      // CLAUDE_FLOW_ROUTER_PARALLEL_LOG is unset (the default), so this
      // adds zero overhead to the default routing path. Fire-and-forget
      // dynamic-import + recordPair; never blocks the route() return.
      if (process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG === '1') {
        loadParallelRecorder().then((mod) => {
          try {
            mod.recordPair({
              task,
              bandit: {
                pick: banditOnly.model,
                predictedQuality: banditOnly.confidence,
                predictedCostUsd: 0,            // bandit doesn't price; analyzer uses outcome
                backend: 'thompson-bandit',
              },
              ser: {
                pick: picked.model,
                predictedQuality: picked.confidence,
                predictedCostUsd: 0,
                backend: neuralPrior ? 'metaharness-router-hybrid' : 'bandit-only',
              },
            });
          } catch {
            // ADR-150 rule #3 — never throw from the routing path.
          }
        }).catch(() => { /* graceful degradation */ });
      }

      var pickedForResult = picked;  // eslint-disable-line no-var
    } else {
      var pickedForResult = this.selectModel(adjustedScores, complexity.score, neuralPrior ?? undefined); // eslint-disable-line no-var
    }

    const model = pickedForResult.model;
    const confidence = pickedForResult.confidence;
    const uncertainty = pickedForResult.uncertainty;
    const routedBy: ModelRoutingResult['routedBy'] = neuralPrior
      ? 'hybrid'
      : neuralDeclined ? 'bandit-fallback' : 'heuristic';

    const inferenceTimeUs = (performance.now() - startTime) * 1000;

    // ADR-148 phase 2 — resolve OpenRouter alt for the picked tier when the
    // execution provider is OpenRouter. Free of side effects on the bandit;
    // purely advisory metadata for downstream agent-execute-core.
    //
    // ADR-149 — when the neural backend returned a concrete `modelId` that
    // is NOT an Anthropic slug, we override the provider to 'openrouter'
    // and use the modelId as the openrouterModel. Otherwise consumers
    // dispatching on `model` would call the Anthropic SDK for a model id
    // the SDK can't reach (e.g. 'inclusionai/ling-2.6-flash'), losing the
    // cost-optimal pick. When the neural picked an Anthropic id we keep
    // the standard provider resolution since the Anthropic SDK can serve it.
    let exec = resolveExecutionProvider(model);
    if (neuralModelId && !neuralModelId.startsWith('anthropic/')) {
      exec = { provider: 'openrouter', openrouterModel: neuralModelId };
    }

    // Build result
    const result: ModelRoutingResult = {
      model,
      confidence,
      uncertainty,
      complexity: complexity.score,
      reasoning: this.buildReasoning(model, complexity, confidence),
      alternatives: Object.entries(adjustedScores)
        .filter(([m]) => m !== model)
        .map(([m, score]) => ({ model: m as ClaudeModel, score }))
        .sort((a, b) => b.score - a.score),
      inferenceTimeUs,
      costMultiplier: MODEL_CAPABILITIES[model].costMultiplier,
      routedBy,
      ...(neuralBackend ? { neuralBackend } : {}),
      provider: exec.provider,
      ...(exec.openrouterModel ? { openrouterModel: exec.openrouterModel } : {}),
      // ADR-149: surface the concrete neural pick when present. Prefer the
      // explicit OpenRouter alt (resolveExecutionProvider) for execution,
      // but expose the model id the neural backend chose so observers and
      // consumers can see the cost-optimal decision.
      ...(neuralModelId ? { modelId: neuralModelId } : {}),
    };

    // Track decision (in-memory bandit state)
    this.trackDecision(task, result);

    // ADR-148 — opt-in DRACO-shaped trajectory collection
    if (process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY === '1') {
      try {
        const { recordDecision } = await loadTrajectoryRecorder();
        recordDecision({
          task, embedding, complexity: complexity.score,
          model, confidence, uncertainty, routedBy,
          neuralBackend, abPair,
          provider: exec.provider,
          openrouterModel: exec.openrouterModel,
          ensembleDisagreement: neuralEnsembleDisagreement,
        });
      } catch {
        // Silent — trajectory recording must never break routing.
      }
    }

    return result;
  }

  /**
   * Analyze task complexity
   */
  analyzeComplexity(task: string, embedding?: number[]): ComplexityAnalysis {
    const taskLower = task.toLowerCase();
    const words = taskLower.split(/\s+/);

    // Find complexity indicators
    const indicators = {
      high: COMPLEXITY_INDICATORS.high.filter(ind => taskLower.includes(ind)),
      medium: COMPLEXITY_INDICATORS.medium.filter(ind => taskLower.includes(ind)),
      low: COMPLEXITY_INDICATORS.low.filter(ind => taskLower.includes(ind)),
    };

    // Compute feature scores
    const lexicalComplexity = this.computeLexicalComplexity(task);
    const semanticDepth = this.computeSemanticDepth(indicators, embedding);
    const taskScope = this.computeTaskScope(task, words);
    const uncertaintyLevel = this.computeUncertaintyLevel(task);

    // Weighted combination
    const score = Math.min(1, Math.max(0,
      lexicalComplexity * 0.2 +
      semanticDepth * 0.35 +
      taskScope * 0.25 +
      uncertaintyLevel * 0.2
    ));

    return {
      score,
      indicators,
      features: {
        lexicalComplexity,
        semanticDepth,
        taskScope,
        uncertaintyLevel,
      },
    };
  }

  /**
   * Compute lexical complexity from text features
   */
  private computeLexicalComplexity(task: string): number {
    const words = task.split(/\s+/);
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / Math.max(1, words.length);
    const sentenceLength = words.length;

    // Normalize: longer sentences with longer words = more complex
    const lengthScore = Math.min(1, sentenceLength / 50);
    const wordScore = Math.min(1, (avgWordLength - 3) / 7); // 3-10 char words

    return lengthScore * 0.4 + wordScore * 0.6;
  }

  /**
   * Compute semantic depth from indicators and embedding
   */
  private computeSemanticDepth(
    indicators: { high: string[]; medium: string[]; low: string[] },
    embedding?: number[]
  ): number {
    // Weight by indicator presence
    const highWeight = indicators.high.length * 0.3;
    const mediumWeight = indicators.medium.length * 0.15;
    const lowWeight = indicators.low.length * -0.1;

    let baseScore = Math.min(1, Math.max(0, 0.3 + highWeight + mediumWeight + lowWeight));

    // Boost with embedding variance if available
    if (embedding && embedding.length > 0) {
      const mean = embedding.reduce((a, b) => a + b, 0) / embedding.length;
      const variance = embedding.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / embedding.length;
      // Higher variance suggests more nuanced semantics
      baseScore = baseScore * 0.7 + Math.min(1, variance * 10) * 0.3;
    }

    return baseScore;
  }

  /**
   * Compute task scope from content analysis
   */
  private computeTaskScope(task: string, words: string[]): number {
    // Multi-file indicators
    const multiFilePatterns = [
      /multiple files?/i, /across.*modules?/i, /refactor.*codebase/i,
      /all.*files/i, /entire.*project/i, /system.*wide/i,
    ];
    const hasMultiFile = multiFilePatterns.some(p => p.test(task)) ? 0.4 : 0;

    // Code generation indicators
    const codeGenPatterns = [
      /implement/i, /create.*feature/i, /build.*system/i,
      /design.*api/i, /write.*tests/i, /add.*functionality/i,
    ];
    const hasCodeGen = codeGenPatterns.some(p => p.test(task)) ? 0.3 : 0;

    // Word count contribution
    const wordCountScore = Math.min(0.3, words.length / 100);

    return hasMultiFile + hasCodeGen + wordCountScore;
  }

  /**
   * Compute uncertainty level from task phrasing
   */
  private computeUncertaintyLevel(task: string): number {
    const uncertainPatterns = [
      /not sure/i, /might/i, /maybe/i, /possibly/i, /investigate/i,
      /figure out/i, /unclear/i, /unknown/i, /debug/i, /strange/i,
      /weird/i, /issue/i, /problem/i, /error/i, /bug/i,
    ];

    const matchCount = uncertainPatterns.filter(p => p.test(task)).length;
    return Math.min(1, matchCount * 0.2);
  }

  /**
   * Compute scores for each model
   */
  private computeModelScores(complexity: ComplexityAnalysis): Record<ClaudeModel, number> {
    const { score } = complexity;

    // Base scoring: inverse relationship with complexity
    // Low complexity → haiku scores high
    // High complexity → opus scores high
    return {
      haiku: Math.max(0, 1 - score * 2), // Drops off quickly as complexity rises
      sonnet: 1 - Math.abs(score - 0.5) * 2, // Peaks at medium complexity
      opus: Math.min(1, score * 1.5), // Rises with complexity
      inherit: 0.1, // Low baseline unless explicitly needed
    };
  }

  /**
   * Apply circuit breaker adjustments
   */
  private applyCircuitBreaker(scores: Record<ClaudeModel, number>): Record<ClaudeModel, number> {
    if (!this.config.enableCircuitBreaker) {
      return scores;
    }

    const adjusted = { ...scores };
    for (const model of Object.keys(adjusted) as ClaudeModel[]) {
      if (this.consecutiveFailures[model] >= this.config.circuitBreakerThreshold) {
        // Circuit is open - heavily penalize this model
        adjusted[model] *= 0.1;
      } else if (this.consecutiveFailures[model] > 0) {
        // Partial penalty for recent failures
        adjusted[model] *= 1 - (this.consecutiveFailures[model] / this.config.circuitBreakerThreshold) * 0.5;
      }
    }
    return adjusted;
  }

  /**
   * Select the best model from scores. Uses Thompson sampling (#1772):
   * each model's deterministic complexity score is multiplied by a draw
   * θ_m ~ Beta(α_m, β_m) from its bandit prior. Models with strong empirical
   * track records get sampled higher; models with poor outcomes get sampled
   * lower; the system auto-corrects against tier overuse without manual
   * threshold tuning. Beta(1,1) = uniform on cold start so behavior matches
   * the prior deterministic router until outcomes accumulate.
   */
  private selectModel(
    scores: Record<ClaudeModel, number>,
    complexityScore: number,
    /**
     * Optional neural prior (ADR-148 hybrid math). When supplied, each
     * candidate's Beta(α, β) prior is perturbed by `weight` pseudo-counts of
     * the neural's predicted quality before sampling. Cold start → neural
     * dominates; many real outcomes → bandit dominates. The persistent
     * bandit state is NOT modified — this is a per-call posterior bump only.
     */
    neuralPrior?: { qualities: Partial<Record<ClaudeModel, number>>; weight: number }
  ): { model: ClaudeModel; confidence: number; uncertainty: number } {
    // Thompson sampling: combine deterministic score with bandit posterior,
    // keyed by complexity bucket (ADR-142) so learning is task-type-local.
    const bucketed = this.state.priors ?? defaultBucketedPriors();
    const priors = bucketed[complexityBucket(complexityScore)] ?? defaultBanditPriors();

    // Apply the optional neural prior: Beta(α + q*w, β + (1-q)*w). Per-call,
    // does not persist. Clamp `q` into [0, 1] so a bogus backend reading
    // cannot push the prior into invalid territory.
    const bump = (a: number, b: number, q: number | undefined, w: number): { alpha: number; beta: number } => {
      if (q === undefined || w <= 0) return { alpha: a, beta: b };
      const clamped = Math.min(1, Math.max(0, q));
      return { alpha: a + clamped * w, beta: b + (1 - clamped) * w };
    };
    const w = neuralPrior?.weight ?? 0;
    const ph = bump(priors.haiku.alpha,  priors.haiku.beta,  neuralPrior?.qualities.haiku,  w);
    const ps = bump(priors.sonnet.alpha, priors.sonnet.beta, neuralPrior?.qualities.sonnet, w);
    const po = bump(priors.opus.alpha,   priors.opus.beta,   neuralPrior?.qualities.opus,   w);

    const sampledScores: Record<ClaudeModel, number> = {
      haiku:   scores.haiku   * sampleBeta(ph.alpha, ph.beta),
      sonnet:  scores.sonnet  * sampleBeta(ps.alpha, ps.beta),
      opus:    scores.opus    * sampleBeta(po.alpha, po.beta),
      inherit: scores.inherit, // not bandit-controlled
    };

    // Get sorted models by sampled score (drops 'inherit' from selection)
    const sorted = (Object.entries(sampledScores) as [ClaudeModel, number][])
      .filter(([m]) => m !== 'inherit')
      .sort((a, b) => b[1] - a[1]);

    const [bestModel, bestScore] = sorted[0];
    const [, secondScore] = sorted[1] || ['sonnet' as ClaudeModel, 0];

    // Confidence is how much better the best is vs second
    const confidence = bestScore > 0 ? Math.min(1, bestScore / (bestScore + secondScore + 0.01)) : 0.5;

    // Uncertainty based on score spread and complexity
    const scoreSpread = bestScore - secondScore;
    const uncertainty = Math.max(0, 1 - scoreSpread - confidence * 0.5);

    // Escalate if uncertainty is too high.
    //
    // #2250 — `uncertainty` here is structurally ~0.6-0.7 for low-complexity
    // tasks (formula: `1 - scoreSpread - confidence*0.5`, where `scoreSpread`
    // is a raw 0-1 difference between bandit-sampled scores that rarely
    // exceeds 0.1). With `maxUncertainty = 0.15` the gate fires on
    // ~every trivial route, promoting `sonnet→opus` and `haiku→sonnet`
    // even when the Thompson sampler has *already* suppressed the higher
    // tier (e.g. opus `Beta(3.8, 17.2)`, mean ≈ 0.18). The learned
    // suppression is computed and then discarded one line later.
    //
    // Guard: skip the escalation when EITHER (a) the bandit has confidently
    // learned the escalation target performs WORSE than the selected model,
    // OR (b) the bandit has a confident, decent posterior on the selected
    // model — i.e. the Thompson sampler picked this tier on real evidence,
    // not a coin flip. Cold-start priors (Beta(1,1), α+β=2, mean=0.5) fail
    // both checks, so unlearned routers still escalate as before.
    let model = bestModel;
    if (uncertainty > this.config.maxUncertainty && bestModel !== 'opus') {
      const escalateTo: ClaudeModel = bestModel === 'haiku' ? 'sonnet' : 'opus';
      const selectedMean = priorMean(priors[bestModel]);
      const targetMean = priorMean(priors[escalateTo]);
      const targetWorse = targetMean < selectedMean - 0.10;
      // Treat the selected model as trusted once the bandit has accumulated
      // ~5 effective observations AND its mean is at least 0.45 (neutral-or-
      // better). Both thresholds chosen to keep cold-start behavior identical
      // while honoring any non-trivial learning.
      const selectedSamples = priors[bestModel].alpha + priors[bestModel].beta;
      const selectedTrusted = selectedSamples >= 5 && selectedMean >= 0.45;
      // ADR-148 — additional trust path: when the neural prior agrees with
      // the bandit's pick (i.e. neuralPrior.qualities[bestModel] is the
      // highest), the neural backend's signal is treated as a vote of
      // confidence that lets us skip escalation. Without this, cold-start
      // installations stay stuck in the structurally-high-uncertainty
      // regime (#2250) and the neural's clear preference never reaches
      // the final pick. The neural prior's top is computed as the max
      // quality over the supplied candidates.
      let neuralEndorsesPick = false;
      if (neuralPrior) {
        let bestNeuralQ = -1;
        let neuralTop: ClaudeModel | null = null;
        for (const [m, q] of Object.entries(neuralPrior.qualities) as [ClaudeModel, number][]) {
          if (q > bestNeuralQ) { bestNeuralQ = q; neuralTop = m; }
        }
        if (neuralTop === bestModel) neuralEndorsesPick = true;
      }
      if (!targetWorse && !selectedTrusted && !neuralEndorsesPick) {
        model = escalateTo;
      }
    }

    return { model, confidence, uncertainty };
  }

  /**
   * Build human-readable reasoning
   */
  private buildReasoning(
    model: ClaudeModel,
    complexity: ComplexityAnalysis,
    confidence: number
  ): string {
    const parts: string[] = [];

    parts.push(`Complexity: ${(complexity.score * 100).toFixed(0)}%`);

    if (complexity.indicators.high.length > 0) {
      parts.push(`High-complexity indicators: ${complexity.indicators.high.join(', ')}`);
    }

    parts.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);
    parts.push(`Model: ${model} - ${MODEL_CAPABILITIES[model].description}`);

    if (this.config.enableCostOptimization) {
      parts.push(`Cost: ${MODEL_CAPABILITIES[model].costMultiplier}x baseline`);
    }

    return parts.join(' | ');
  }

  /**
   * Track routing decision for learning
   */
  private trackDecision(task: string, result: ModelRoutingResult): void {
    this.decisionCount++;
    this.state.totalDecisions++;
    this.state.modelDistribution[result.model] =
      (this.state.modelDistribution[result.model] || 0) + 1;
    // ADR-148 — operational counters for hooks_intelligence_stats.
    this.routedByCounts[result.routedBy]++;
    if (result.neuralBackend) this.neuralBackendCounts[result.neuralBackend]++;

    // Update running averages
    const n = this.state.totalDecisions;
    this.state.avgComplexity =
      (this.state.avgComplexity * (n - 1) + result.complexity) / n;
    this.state.avgConfidence =
      (this.state.avgConfidence * (n - 1) + result.confidence) / n;

    // Auto-save periodically
    if (this.decisionCount % this.config.autoSaveInterval === 0) {
      this.saveState();
    }
  }

  /**
   * Record outcome for learning
   */
  recordOutcome(
    task: string,
    model: ClaudeModel,
    outcome: 'success' | 'failure' | 'escalated'
  ): void {
    // Update circuit breaker state
    if (outcome === 'failure') {
      this.consecutiveFailures[model]++;
    } else {
      this.consecutiveFailures[model] = 0;
    }

    // Re-derive this task's complexity bucket from the task string (the MCP
    // outcome payload carries no complexity), using the SAME analyzeComplexity
    // path route() uses so record-time and select-time buckets match.
    const taskScore = this.analyzeComplexity(task).score;
    const bucket = complexityBucket(taskScore);

    // Track in history (record THIS task's score, not the running average)
    this.state.learningHistory.push({
      task: task.slice(0, 100),
      model,
      complexity: taskScore,
      outcome,
      timestamp: new Date().toISOString(),
    });

    // Keep history bounded
    if (this.state.learningHistory.length > 100) {
      this.state.learningHistory = this.state.learningHistory.slice(-100);
    }

    if (outcome === 'failure') {
      this.state.circuitBreakerTrips++;
    }

    // Thompson sampling update (#1772): cost-adjusted Bernoulli reward.
    // Haiku-success > Sonnet-success > Opus-success (Opus on simple tasks
    // is wasteful even when correct). Failure/escalation always β++.
    if (!this.state.priors) this.state.priors = defaultBucketedPriors();

    // Discounted Thompson sampling (priorDecay < 1): decay ALL bucket/model
    // priors once per recordOutcome call, before this call's own reward is
    // added — every routing decision is one discrete "time step" for every
    // arm, not just the one that got pulled, matching the arXiv 2305.10718
    // formulation. No-op when priorDecay is the default of 1.
    if (this.config.priorDecay < 1) {
      for (const bk of Object.keys(this.state.priors) as ComplexityBucket[]) {
        const bucketPriors = this.state.priors[bk];
        for (const m of Object.keys(bucketPriors) as ClaudeModel[]) {
          const p = bucketPriors[m];
          p.alpha = Math.max(PRIOR_DECAY_FLOOR, p.alpha * this.config.priorDecay);
          p.beta = Math.max(PRIOR_DECAY_FLOOR, p.beta * this.config.priorDecay);
        }
      }
    }

    const bp = this.state.priors[bucket] ?? (this.state.priors[bucket] = defaultBanditPriors());
    const reward = BANDIT_REWARDS[model]?.[outcome] ?? 0.5;
    bp[model].alpha += reward;
    bp[model].beta += 1 - reward;

    this.saveState();
  }

  /**
   * ADR-149 — record an outcome keyed by the CONCRETE model id (e.g.
   * 'inclusionai/ling-2.6-flash') rather than the tier label. Updates the
   * shadow `priorsById` state without affecting `priors` (tier priors).
   *
   * This is the per-model learning signal the bandit needs to eventually
   * distinguish GPT-4.1 from Sonnet within the 'sonnet' tier. Selection
   * currently still uses tier priors; this state accumulates so a future
   * refactor can switch the selector over once there's enough data.
   *
   * Cost-adjusted reward semantics: cheap models get the highest reward on
   * success (their successes are most cost-efficient). We map modelId to
   * its closest tier for the reward table — the routing math doesn't have
   * a per-modelId reward configuration yet.
   */
  recordOutcomeByModelId(
    task: string,
    modelId: string,
    outcome: 'success' | 'failure' | 'escalated'
  ): void {
    if (!modelId || typeof modelId !== 'string') return;
    const taskScore = this.analyzeComplexity(task).score;
    const bucket = complexityBucket(taskScore);
    if (!this.state.priorsById) this.state.priorsById = defaultBucketedPriorsById();
    let perBucket = this.state.priorsById[bucket];
    if (!perBucket) {
      perBucket = {};
      this.state.priorsById[bucket] = perBucket;
    }
    if (!perBucket[modelId]) perBucket[modelId] = { alpha: 1, beta: 1 };

    // Reward proxy: derive a tier-equivalent for cost weighting. Substring
    // match keeps it cheap and accurate for the candidates in the registry.
    const id = modelId.toLowerCase();
    const tierProxy: ClaudeModel =
      id.includes('haiku') || id.includes('ling-') || id.includes('flash-lite')
        || id.includes('nemotron-nano') || id.includes('ministral')
        || id.includes('llama-3.2-3b') || id.includes('llama-3.1-8b')
        ? 'haiku'
        : id.includes('opus') ? 'opus' : 'sonnet';
    const reward = BANDIT_REWARDS[tierProxy]?.[outcome] ?? 0.5;
    perBucket[modelId].alpha += reward;
    perBucket[modelId].beta += 1 - reward;

    // Bump the schema version on first per-modelId write so downstream
    // tooling can see v3 was reached (the version field stays at 3 once set).
    if ((this.state.version ?? 0) < 3) this.state.version = 3;

    this.saveState();
  }

  /**
   * Get router statistics
   */
  getStats(): {
    totalDecisions: number;
    modelDistribution: Record<ClaudeModel, number>;
    avgComplexity: number;
    avgConfidence: number;
    circuitBreakerTrips: number;
    consecutiveFailures: Record<ClaudeModel, number>;
    /** ADR-148: per-decision-mechanism counts (process-local, not persisted). */
    routedByCounts: Record<ModelRoutingResult['routedBy'], number>;
    /** ADR-148: per-neural-backend counts (process-local). */
    neuralBackendCounts: Record<NonNullable<ModelRoutingResult['neuralBackend']>, number>;
    /** ADR-148: A/B mode disagreement rate over the active process. */
    ab: { comparisons: number; disagreements: number; disagreementRate: number };
    /**
     * ADR-149: state schema version. 2 = bucketed tier priors only; 3 = also
     * carries `priorsById` shadow state. Bumps on first recordOutcomeByModelId().
     */
    stateVersion: number;
    /**
     * ADR-149: per-modelId Beta priors per complexity bucket. Empty until
     * recordOutcomeByModelId() fires. NOT consumed by selectModel() yet; this
     * is shadow state for a future selection-by-modelId refactor.
     */
    priorsById?: BucketedPriorsById;
  } {
    return {
      totalDecisions: this.state.totalDecisions,
      modelDistribution: { ...this.state.modelDistribution },
      avgComplexity: this.state.avgComplexity,
      avgConfidence: this.state.avgConfidence,
      circuitBreakerTrips: this.state.circuitBreakerTrips,
      consecutiveFailures: { ...this.consecutiveFailures },
      routedByCounts: { ...this.routedByCounts },
      neuralBackendCounts: { ...this.neuralBackendCounts },
      ab: {
        comparisons: this.abComparisons,
        disagreements: this.abDisagreements,
        disagreementRate: this.abComparisons > 0 ? this.abDisagreements / this.abComparisons : 0,
      },
      stateVersion: this.state.version ?? 2,
      ...(this.state.priorsById ? { priorsById: this.state.priorsById } : {}),
    };
  }

  /**
   * Load state from disk
   */
  private loadState(): RouterState {
    const defaultState: RouterState = {
      totalDecisions: 0,
      modelDistribution: { haiku: 0, sonnet: 0, opus: 0, inherit: 0 },
      avgComplexity: 0.5,
      avgConfidence: 0.8,
      circuitBreakerTrips: 0,
      lastUpdated: new Date().toISOString(),
      learningHistory: [],
      version: 2,
      priors: defaultBucketedPriors(),
    };

    try {
      const fullPath = join(process.cwd(), this.config.statePath);
      if (existsSync(fullPath)) {
        const data = readFileSync(fullPath, 'utf-8');
        const loaded = JSON.parse(data) as Partial<RouterState> & { priors?: unknown };
        // ADR-142: forward-migrate priors of ANY layout (missing / flat v1 /
        // already-bucketed) to the bucketed shape without data loss or throwing.
        loaded.priors = migratePriors(loaded.priors);
        loaded.version = 2;
        return { ...defaultState, ...(loaded as Partial<RouterState>) };
      }
    } catch {
      // Ignore load errors
    }

    return defaultState;
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    try {
      const fullPath = join(process.cwd(), this.config.statePath);
      const dir = dirname(fullPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.state.lastUpdated = new Date().toISOString();
      writeFileSync(fullPath, JSON.stringify(this.state, null, 2));
    } catch {
      // Ignore save errors in non-critical scenarios
    }
  }

  /**
   * Reset router state
   */
  reset(): void {
    this.state = {
      totalDecisions: 0,
      modelDistribution: { haiku: 0, sonnet: 0, opus: 0, inherit: 0 },
      avgComplexity: 0.5,
      avgConfidence: 0.8,
      circuitBreakerTrips: 0,
      lastUpdated: new Date().toISOString(),
      learningHistory: [],
      version: 2,
      priors: defaultBucketedPriors(),
    };
    this.consecutiveFailures = { haiku: 0, sonnet: 0, opus: 0, inherit: 0 };
    this.decisionCount = 0;
    this.saveState();
  }

  /**
   * Public read-only accessor for the bandit priors. Useful for tests,
   * dashboards, and the pending hooks_intelligence_stats integration that
   * surfaces convergence in the dashboard. Returns a copy.
   */
  getBanditPriors(bucket: ComplexityBucket = 'med'): Record<ClaudeModel, BetaPrior> {
    const bucketed = this.state.priors ?? defaultBucketedPriors();
    const p = bucketed[bucket] ?? defaultBanditPriors();
    return {
      haiku:   { ...p.haiku },
      sonnet:  { ...p.sonnet },
      opus:    { ...p.opus },
      inherit: { ...p.inherit },
    };
  }

  /** All bucketed priors (copy) — for dashboards/tests. */
  getBucketedPriors(): BucketedPriors {
    const b = this.state.priors ?? defaultBucketedPriors();
    return {
      low: clonePriors(b.low ?? defaultBanditPriors()),
      med: clonePriors(b.med ?? defaultBanditPriors()),
      high: clonePriors(b.high ?? defaultBanditPriors()),
    };
  }
}

// ============================================================================
// Singleton & Factory Functions
// ============================================================================

let modelRouterInstance: ModelRouter | null = null;

/**
 * Get or create the singleton ModelRouter instance
 */
export function getModelRouter(config?: Partial<ModelRouterConfig>): ModelRouter {
  if (!modelRouterInstance) {
    modelRouterInstance = new ModelRouter(config);
  }
  return modelRouterInstance;
}

/**
 * Reset the singleton instance
 */
export function resetModelRouter(): void {
  modelRouterInstance = null;
}

/**
 * Create a new ModelRouter instance (non-singleton)
 */
export function createModelRouter(config?: Partial<ModelRouterConfig>): ModelRouter {
  return new ModelRouter(config);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick route function for common use case
 */
export async function routeToModel(task: string): Promise<ClaudeModel> {
  const router = getModelRouter();
  const result = await router.route(task);
  return result.model;
}

/**
 * Route with full result
 */
export async function routeToModelFull(
  task: string,
  embedding?: number[]
): Promise<ModelRoutingResult> {
  const router = getModelRouter();
  return router.route(task, embedding);
}

/**
 * Analyze task complexity without routing
 */
export function analyzeTaskComplexity(task: string): ComplexityAnalysis {
  const router = getModelRouter();
  return router.analyzeComplexity(task, undefined);
}

/**
 * Get model router statistics
 */
export function getModelRouterStats(): ReturnType<ModelRouter['getStats']> {
  const router = getModelRouter();
  return router.getStats();
}

/**
 * Record routing outcome for learning
 */
export function recordModelOutcome(
  task: string,
  model: ClaudeModel,
  outcome: 'success' | 'failure' | 'escalated'
): void {
  const router = getModelRouter();
  router.recordOutcome(task, model, outcome);
}

/**
 * ADR-149 — record an outcome keyed by the concrete model id rather than
 * the tier label. Updates the shadow `priorsById` state. Selection logic
 * still uses tier priors; this data accumulates for a future per-modelId
 * selector refactor.
 *
 * Safe to call alongside `recordModelOutcome` — they update independent
 * state slices so double-counting is impossible.
 */
export function recordModelOutcomeByModelId(
  task: string,
  modelId: string,
  outcome: 'success' | 'failure' | 'escalated'
): void {
  const router = getModelRouter();
  router.recordOutcomeByModelId(task, modelId, outcome);
}

/**
 * ADR-149 iter 14 — read-only access to the per-modelId Beta priors. The
 * neural-router consumes this to apply per-model Thompson sampling on top
 * of its predicted-quality vector when CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL=1.
 * Returns the legacy bucketed priors (`priorsById[bucket][modelId]`) when
 * present, else null.
 */
export function getModelRouterPriorsById(): Record<ComplexityBucket, Record<string, BetaPrior>> | null {
  const router = getModelRouter();
  const stats = router.getStats();
  return stats.priorsById ?? null;
}

/**
 * Re-export the complexity-bucket helper so the neural-router (which gets
 * the task text via the route() call) can map a complexity score to the
 * matching bandit bucket.
 */
export { complexityBucket };
