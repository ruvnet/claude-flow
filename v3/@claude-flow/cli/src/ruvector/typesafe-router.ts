/**
 * typesafe-router.ts — opt-in `@ruvector/typesafe` augmentation for `hooks_route`.
 *
 * Mirrors ADR-150's MetaHarness rules for optional integrations:
 *   1. Removable — the package is loaded with a dynamic import only; any load,
 *      construction or decide error falls back to the existing router.
 *   2. Opt-in    — does nothing unless `CLAUDE_FLOW_ROUTER_TYPESAFE=1`. With the
 *      flag unset the package is never imported and the legacy result is
 *      returned unchanged (same object, no added fields).
 *   3. Optional  — declared as an optional peer of `@claude-flow/cli`.
 *   4. Honest    — the result carries `routedBy`, typesafe's confidence, abstain
 *      mass and `calibrated` flag verbatim. The default `hash` embedder is
 *      uncalibrated, so its confidence is reported as `confidenceCalibrated:
 *      false` and is never copied into `estimatedMetrics.successProbability`.
 *
 * Gate: typesafe's answer is used only when all hold —
 *   - `abstain <= maxAbstain` (default 0.30)
 *   - lift = top-1 probability × option count >= `minLift` (default 1.2, i.e.
 *     20% above chance). Lift, not raw confidence, because confidence scales
 *     with the option count (~0.1 for ten agents) and differs per embedder.
 *   - top-1 beats the runner-up by >= `minMargin` (default 0.005); a uniform
 *     distribution — text that matches nothing — has margin 0.
 * Otherwise the legacy route is kept and `typesafe.reason` says which gate failed.
 *
 * @module typesafe-router
 */

/** Keyword/agent table shape shared with hooks-tools' TASK_PATTERNS. */
export interface RoutingPatternLike { keywords: string[]; agents: string[] }

/** One `choice` option in typesafe's `{ what, not_for, examples }` form. */
export interface TypesafeCriterion { what: string; not_for?: string; examples?: string[] }

/** The subset of a typesafe choice answer this adapter reads. */
export interface TypesafeChoiceAnswer {
  choice: string; probabilities: Record<string, number>;
  confidence: number; abstain: number; calibrated: boolean; head?: string; model?: string;
}

/** The subset of `@ruvector/typesafe`'s module surface this adapter uses. */
export interface TypesafeModuleLike {
  createTypesafe(opts?: Record<string, unknown>): {
    readonly backend?: string;
    decide(state: string, questions: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  choice?(criteria: Record<string, TypesafeCriterion>): unknown;
}

export interface TypesafeRouterConfig {
  enabled: boolean;
  minLift: number;
  maxAbstain: number;
  minMargin: number;
  /** `'hash'` (default, uncalibrated) or an ONNX model dir + manifest. */
  embedder: 'hash' | { kind: 'onnx'; modelDir: string; manifest: string };
}

export interface TypesafeRouteOutcome {
  used: boolean;
  reason: string;
  answer?: TypesafeChoiceAnswer;
  backend?: string;
  embedder?: string;
  /** top-1 probability × option count (1.0 = chance). */
  lift?: number;
  thresholds: Pick<TypesafeRouterConfig, 'minLift' | 'maxAbstain' | 'minMargin'>;
}

/** Injectable deps (tests). `loadModule` defaults to a dynamic import of the package. */
export interface TypesafeRouterDeps { env?: NodeJS.ProcessEnv; loadModule?: () => Promise<unknown>; debug?: (msg: string) => void }

const MODULE_ID = '@ruvector/typesafe';

/**
 * Default loader. The variable specifier keeps tsc/bundlers off the optional peer;
 * `require` (the package is CJS) covers hosts that rewrite dynamic import (vite-node).
 * An absent package still surfaces as MODULE_NOT_FOUND → "not installed".
 */
async function loadTypesafeModule(): Promise<unknown> {
  try {
    return await import(/* @vite-ignore */ MODULE_ID as string);
  } catch (importErr) {
    try {
      const { createRequire } = await import('node:module');
      return createRequire(import.meta.url)(MODULE_ID);
    } catch (requireErr) {
      throw (requireErr as { code?: string })?.code === 'MODULE_NOT_FOUND' ? requireErr : importErr;
    }
  }
}

/** Agent descriptions + `not_for` hints that separate neighbouring roles. */
const AGENT_PROFILES: Record<string, TypesafeCriterion> = {
  tester: { what: 'write and run unit tests, integration tests, e2e tests, test coverage and specs', not_for: 'reviewing code, researching issues or reading the latest news' },
  reviewer: { what: 'review code quality, pull requests, diffs and best practices', not_for: 'writing tests, implementing features or researching background information' },
  researcher: { what: 'research, investigate, explore, read and summarize issues, docs, discussions and prior art', not_for: 'writing code, writing tests or reviewing a diff' },
  coder: { what: 'implement features, write code, fix bugs and build functionality', not_for: 'research, review or test-only work' },
  architect: { what: 'design system architecture, module boundaries, APIs, schemas and refactoring plans', not_for: 'running tests or small bug fixes' },
  'security-architect': { what: 'security, authentication, authorization, encryption, vulnerabilities, CVEs and audits', not_for: 'general feature work or performance tuning' },
  'performance-engineer': { what: 'performance optimization, profiling, benchmarks, latency and bottlenecks', not_for: 'security review or writing documentation' },
  devops: { what: 'deployment, CI/CD pipelines, docker, kubernetes and infrastructure', not_for: 'application feature code or unit tests' },
  'memory-specialist': { what: 'memory systems, caches, vector stores, embeddings and persistence', not_for: 'UI work or deployment pipelines' },
  'swarm-specialist': { what: 'multi-agent swarms, coordinators, hive-mind, mesh topology and agent orchestration', not_for: 'single-file code edits' },
};

/**
 * Build choice options from the router's pattern table: every primary agent of
 * a pattern, plus the profiled roles (researcher/reviewer) the table only lists
 * as alternates. Each pattern's keywords are appended to its primary agent's
 * `what`, so the options track TASK_PATTERNS rather than a parallel list.
 */
export function buildAgentCriteria(patterns: Record<string, RoutingPatternLike>): Record<string, TypesafeCriterion> {
  const keywordsByAgent = new Map<string, Set<string>>();
  for (const { agents, keywords } of Object.values(patterns)) {
    const primary = agents[0];
    if (!primary) continue;
    const set = keywordsByAgent.get(primary) ?? new Set<string>();
    keywords.forEach(k => set.add(k));
    keywordsByAgent.set(primary, set);
  }
  for (const agent of ['researcher', 'reviewer', 'tester', 'coder']) {
    if (!keywordsByAgent.has(agent)) keywordsByAgent.set(agent, new Set());
  }
  const criteria: Record<string, TypesafeCriterion> = {};
  for (const [agent, kws] of keywordsByAgent) {
    const profile = AGENT_PROFILES[agent] ?? { what: `${agent.replace(/-/g, ' ')} tasks` };
    const kw = [...kws].join(', ');
    criteria[agent] = {
      what: kw ? `${profile.what}; keywords: ${kw}` : profile.what,
      ...(profile.not_for ? { not_for: profile.not_for } : {}),
    };
  }
  return criteria;
}

function num(raw: string | undefined, dflt: number, max = 1): number {
  const n = raw === undefined || raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : dflt;
}

/** Read config from env. Invalid numeric values fall back to the defaults. */
export function readTypesafeConfig(env: NodeJS.ProcessEnv = process.env): TypesafeRouterConfig {
  const modelDir = env.CLAUDE_FLOW_ROUTER_TYPESAFE_MODEL_DIR;
  const manifest = env.CLAUDE_FLOW_ROUTER_TYPESAFE_MANIFEST;
  return {
    enabled: env.CLAUDE_FLOW_ROUTER_TYPESAFE === '1',
    minLift: num(env.CLAUDE_FLOW_ROUTER_TYPESAFE_MIN_LIFT, 1.2, 255),
    maxAbstain: num(env.CLAUDE_FLOW_ROUTER_TYPESAFE_MAX_ABSTAIN, 0.3),
    minMargin: num(env.CLAUDE_FLOW_ROUTER_TYPESAFE_MIN_MARGIN, 0.005),
    embedder: modelDir && manifest ? { kind: 'onnx', modelDir, manifest } : 'hash',
  };
}

type Engine = ReturnType<TypesafeModuleLike['createTypesafe']>;

/**
 * Stateful router: loads the module and builds one engine on first use, caches
 * a load failure so a missing package costs one import attempt per process.
 */
export class TypesafeRouter {
  private engine: Engine | null = null;
  private mod: TypesafeModuleLike | null = null;
  private loadError: string | null = null;
  private readonly env: NodeJS.ProcessEnv;
  private readonly loadModule: () => Promise<unknown>;
  private readonly debug: (msg: string) => void;

  constructor(deps: TypesafeRouterDeps = {}) {
    this.env = deps.env ?? process.env;
    this.loadModule = deps.loadModule ?? loadTypesafeModule;
    this.debug = deps.debug ?? ((m) => { if (this.env.CLAUDE_FLOW_LOG_LEVEL === 'debug') console.error(`[typesafe-router] ${m}`); });
  }

  isEnabled(): boolean { return readTypesafeConfig(this.env).enabled; }

  private async ensureEngine(cfg: TypesafeRouterConfig): Promise<Engine | null> {
    if (this.engine || this.loadError) return this.engine;
    try {
      const raw = (await this.loadModule()) as Record<string, unknown>;
      const mod = (typeof raw.createTypesafe === 'function' ? raw : raw.default) as TypesafeModuleLike | undefined;
      if (!mod || typeof mod.createTypesafe !== 'function') throw new Error('module has no createTypesafe export');
      this.mod = mod;
      this.engine = mod.createTypesafe({ embedder: cfg.embedder });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      this.loadError = e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND'
        ? `${MODULE_ID} not installed`
        : `${MODULE_ID} failed to load: ${e?.message ?? String(err)}`;
      this.debug(this.loadError);
    }
    return this.engine;
  }

  /** Ask typesafe for an agent. Never throws; `used: false` means keep the legacy route. */
  async route(task: string, patterns: Record<string, RoutingPatternLike>): Promise<TypesafeRouteOutcome> {
    const cfg = readTypesafeConfig(this.env);
    const thresholds = { minLift: cfg.minLift, maxAbstain: cfg.maxAbstain, minMargin: cfg.minMargin };
    const embedder = cfg.embedder === 'hash' ? 'hash' : 'onnx';
    if (!cfg.enabled) return { used: false, reason: 'CLAUDE_FLOW_ROUTER_TYPESAFE is not 1', thresholds };
    const engine = await this.ensureEngine(cfg);
    if (!engine) return { used: false, reason: this.loadError ?? 'typesafe unavailable', thresholds, embedder };
    let answer: TypesafeChoiceAnswer;
    try {
      const criteria = buildAgentCriteria(patterns);
      const question = this.mod?.choice ? this.mod.choice(criteria) : { type: 'choice', criteria };
      const res = await engine.decide(task, { agent: question });
      answer = res.agent as TypesafeChoiceAnswer;
      if (!answer || typeof answer.choice !== 'string') throw new Error('no choice in answer');
    } catch (err) {
      const reason = `typesafe decide failed: ${(err as Error)?.message ?? String(err)}`;
      this.debug(reason);
      return { used: false, reason, thresholds, embedder, backend: engine.backend };
    }
    const probs = Object.values(answer.probabilities ?? {}).sort((a, b) => b - a);
    const margin = (probs[0] ?? 0) - (probs[1] ?? 0);
    const lift = (probs[0] ?? 0) * probs.length;
    const base = { answer, lift, thresholds, embedder, backend: engine.backend };
    const f = (n: number) => n.toFixed(2);
    if (answer.abstain > cfg.maxAbstain) {
      return { ...base, used: false, reason: `typesafe abstain ${f(answer.abstain)} > max ${f(cfg.maxAbstain)}; kept existing router` };
    }
    if (lift < cfg.minLift) {
      return { ...base, used: false, reason: `typesafe lift ${f(lift)} (top-1 × ${probs.length} options) < min ${f(cfg.minLift)}; kept existing router` };
    }
    if (margin < cfg.minMargin) {
      return { ...base, used: false, reason: `typesafe top-1 margin ${margin.toFixed(3)} < min ${cfg.minMargin.toFixed(3)} (no clear winner); kept existing router` };
    }
    return { ...base, used: true, reason: `typesafe choice "${answer.choice}" (confidence ${f(answer.confidence)}, lift ${f(lift)}, abstain ${f(answer.abstain)}, ${answer.calibrated ? 'calibrated' : 'UNCALIBRATED'} ${embedder} embedder)` };
  }
}

type RouteResult = Record<string, unknown>;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Merge a typesafe outcome into a legacy `hooks_route` result. Disabled or
 * error results (`success: false`) pass through untouched.
 */
export async function applyTypesafeRouting(
  params: Record<string, unknown>,
  legacy: RouteResult,
  patterns: Record<string, RoutingPatternLike>,
  router: TypesafeRouter,
): Promise<RouteResult> {
  if (!router.isEnabled() || !legacy || legacy.success === false || typeof params.task !== 'string') return legacy;
  const text = typeof params.context === 'string' && params.context ? `${params.task} ${params.context}` : params.task;
  const outcome = await router.route(text, patterns);
  const legacyRouting = (legacy.routing ?? {}) as Record<string, unknown>;
  const legacyPrimary = (legacy.primaryAgent ?? {}) as Record<string, unknown>;
  const a = outcome.answer;
  const typesafe = {
    used: outcome.used,
    reason: outcome.reason,
    ...(a ? {
      choice: a.choice,
      confidence: round2(a.confidence),
      abstain: round2(a.abstain),
      lift: outcome.lift === undefined ? undefined : round2(outcome.lift),
      calibrated: a.calibrated,
      head: a.head,
      model: a.model,
      probabilities: Object.fromEntries(Object.entries(a.probabilities).map(([k, v]) => [k, round2(v)])),
    } : {}),
    backend: outcome.backend,
    embedder: outcome.embedder,
    thresholds: outcome.thresholds,
  };
  if (!outcome.used || !a) {
    return { ...legacy, routedBy: String(legacyRouting.method ?? 'legacy'), typesafe };
  }
  const alternatives = Object.entries(a.probabilities)
    .filter(([k]) => k !== a.choice)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .map(([type, p]) => ({ type, confidence: round2(p), reason: 'typesafe runner-up (probability share)' }));
  return {
    ...legacy,
    routing: { ...legacyRouting, method: 'typesafe', backend: `@ruvector/typesafe (${outcome.backend ?? 'unknown'}, ${outcome.embedder} embedder)` },
    routedBy: 'typesafe',
    matchedPattern: `typesafe:${a.choice}`,
    primaryAgent: {
      type: a.choice,
      confidence: round2(a.confidence),
      confidenceCalibrated: a.calibrated,
      reason: outcome.reason,
    },
    alternativeAgents: alternatives,
    fallbackRoute: { agent: legacyPrimary.type, confidence: legacyPrimary.confidence, method: legacyRouting.method },
    typesafe,
  };
}

let sharedRouter: TypesafeRouter | null = null;
/** Process-wide router used by hooks_route. */
export function getTypesafeRouter(): TypesafeRouter {
  return (sharedRouter ??= new TypesafeRouter());
}
