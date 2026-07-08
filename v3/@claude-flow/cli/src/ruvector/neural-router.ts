/**
 * neural-router.ts — Optional cost-optimal neural routing path (ADR-148).
 *
 * Wires `@metaharness/router` (pure-TS k-NN/KRR + optional FastGRNN via
 * `@ruvector/tiny-dancer`) into the model-routing path as a graceful, gated
 * addition. The shipped heuristic + Thompson bandit stays as the default;
 * this module only contributes a decision when:
 *
 *   1. `CLAUDE_FLOW_ROUTER_NEURAL=1` is set
 *   2. Either a trained artifact path resolves (`CLAUDE_FLOW_ROUTER_MODEL_PATH`)
 *      OR the bundled seed corpus loads
 *   3. The dynamic `import('@metaharness/router')` succeeds
 *
 * Otherwise `tryCostOptimalRoute(...)` returns `null` and the caller falls
 * back to the bandit path with `routedBy: 'bandit-fallback'`.
 *
 * Observability — `routedBy` is returned on every result and must never be
 * inferred from "did the import resolve?" (ADR-074, ADR-086). It carries
 * exactly one of:
 *   - 'metaharness-knn'  pure-TS k-NN, no training (uses raw seed examples)
 *   - 'metaharness-krr'  pure-TS KRR with LOO-CV λ (TrainedRouter JSON)
 *   - 'fastgrnn'         native FastGRNN via tiny-dancer (NativeRouter)
 *
 * Performance — module-level caches resolve the backend, seed corpus and
 * router once per process. Hot path is a single `route(embedding)` call.
 *
 * @module neural-router
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

import type { ClaudeModel } from './model-router.js';

// ============================================================================
// Public API
// ============================================================================

/** Backend identifier carried on every result (never inferred). */
export type NeuralRoutedBy = 'metaharness-knn' | 'metaharness-krr' | 'fastgrnn';

/** Cost-optimal route decision. */
export interface NeuralRouteResult {
  /** Chosen Claude tier label (back-compat). Derived from `modelId`. */
  model: ClaudeModel;
  /**
   * Concrete picked model id — ADR-149. May be an Anthropic SDK id or an
   * OpenRouter slug. Always a string; the closest tier label is in `model`
   * for back-compat with consumers that still expect ClaudeModel.
   */
  modelId: string;
  /** Predicted quality the chosen candidate is expected to achieve (0..1). */
  predictedQuality: number;
  /** Did the predicted quality clear the configured `qualityBar`? */
  metBar: boolean;
  /** Per-candidate predicted qualities, ordered cheapest-first. */
  alternatives: Array<{ model: ClaudeModel; modelId: string; predictedQuality: number; costPerMTok: number }>;
  /** Backend that produced the decision. */
  routedBy: NeuralRoutedBy;
  /** Inference latency in microseconds. */
  inferenceTimeUs: number;
  /**
   * ADR-149 iter 45 — ensemble disagreement diagnostic. Absolute difference
   * in predicted quality for the PICKED model between the unified KRR and
   * the bucket specialist (iter 16). Set only when both are loaded AND a
   * complexityBucket was supplied. Operators tuning iter 44's
   * `CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD` need to observe
   * realistic disagreement values to pick a sensible cutoff.
   */
  ensembleDisagreement?: number;
}

/** Module-level configuration. Read once at first call from env. */
interface NeuralRouterConfig {
  enabled: boolean;
  modelPath?: string;
  /** Bundled fallback artifact (KRR JSON). Used when `modelPath` is unset. */
  bundledKrrPath: string;
  qualityBar: number;
  seedCorpusPath: string;
  /** k for k-NN backend (default 5). */
  k: number;
  /**
   * ADR-149 iter 12 — optional latency budget in ms. When > 0, candidates
   * whose measured p50 latency exceeds the budget are filtered OUT before
   * the cost-optimal selector runs. Default 0 (unbounded, cost-only).
   * For interactive flows that need sub-second responses, set 1000.
   */
  latencyBudgetMs: number;
  /**
   * ADR-149 iter 22+24 — post-hoc isotonic calibration. When the bundled
   * calibrator JSON is present, KRR predict() outputs are piped through
   * IsotonicCalibrator.transform() before cost-optimal selection.
   *
   * DEFAULT ON (iter 24, ADR-149). Iter 23's out-of-sample LOO validation
   * showed ECE drops from 0.1604 (POORLY-CALIBRATED) to 0.0335
   * (WELL-CALIBRATED) — a 79% reduction with only a 0.0144 train/test gap,
   * confirming the calibrator generalizes. Set
   * `CLAUDE_FLOW_ROUTER_CALIBRATE=0` to opt out and recover iter 0-21 raw
   * KRR behavior.
   */
  calibrateEnabled: boolean;
  /** Path to the bundled calibrator JSON (iter 22). */
  calibratorPath: string;
  /**
   * ADR-149 iter 29 — orthogonal selector mode: when > 0, filter candidates
   * by blended price ≤ ceiling, then pick the HIGHEST predicted quality
   * (not cheapest-above-bar). Lets ops with a hard budget cap ask "best
   * model under $X" instead of "cheapest above quality threshold". Default
   * 0 (disabled) preserves iter 0-28 cost-optimal-above-bar semantics.
   */
  costCeilingPerMTok: number;
  /**
   * ADR-149 iter 44 — ensemble-uncertainty-aware fallback. When > 0, the
   * selector queries BOTH the unified KRR and the bucket specialist for
   * the same query, then computes |unified_q - specialist_q| for the
   * picked model. If the disagreement exceeds this threshold, returns null
   * so the caller falls back to the bandit — same path as a 429/5xx API
   * error today, but triggered by prediction uncertainty instead.
   *
   * Typical values: 0.10 (mild — only the most uncertain predictions
   * fall back), 0.20 (aggressive — any meaningful ensemble disagreement
   * triggers fallback). 0 disables (default — preserves iter 0-43 behavior).
   */
  ensembleUncertaintyThreshold: number;
}

// ============================================================================
// Internal state (lazy, single-init)
// ============================================================================

type PureRouter = { route: (e: number[]) => { id: string; predictedQuality: number; costPerMTok: number; metBar: boolean }; predictAll: (e: number[]) => Array<{ id: string; predictedQuality: number; costPerMTok: number }> };

interface ResolvedBackend {
  /** True if `@metaharness/router` was importable. */
  available: boolean;
  /** Unified-corpus router (fallback). null when no corpus / artifact was loadable. */
  router: PureRouter | null;
  /**
   * ADR-149 iter 16 — per-bucket specialist KRR routers. When the caller
   * supplies a complexity bucket AND the matching artifact is present,
   * the specialist is preferred over the unified `router`. Each specialist
   * was trained only on rows from its tier so it predicts more accurately
   * for queries in that band.
   */
  routerByBucket?: Partial<Record<'low' | 'med' | 'high', PureRouter>>;
  /**
   * For the FastGRNN/native path: the loaded `NativeRouter` instance and the
   * pre-built per-candidate embeddings. Loaded ONCE at resolve time and
   * reused on every route() call — avoids the load/build overhead per call.
   */
  native?: {
    router: { route: (e: number[], cands: Array<{ id: string; embedding: number[]; costPerMTok?: number; successRate?: number }>) => Promise<{ id: string; confidence: number; uncertainty: number; useLightweight: boolean; costPerMTok?: number; inferenceTimeUs: number }> };
    candidates: Array<{ id: string; embedding: number[]; costPerMTok: number }>;
  };
  /** Which backend the router represents. */
  routedBy: NeuralRoutedBy | null;
  /** Reason string for diagnostics. */
  reason: string;
}

let _config: NeuralRouterConfig | null = null;
let _backend: ResolvedBackend | null = null;
let _initPromise: Promise<ResolvedBackend> | null = null;

const PRICES: Record<ClaudeModel, number> = {
  haiku: 1, sonnet: 3, opus: 15, inherit: 3,
};

// ADR-149 iter 12 — lazy load measured per-model latency (mean ms) from the
// most-recent FULL seed-corpus measurement file. Cached per-process.
// Returns an empty map if no measurement is available.
let _latencyMapPromise: Promise<Record<string, number>> | null = null;
function loadLatencyMap(): Promise<Record<string, number>> {
  if (_latencyMapPromise !== null) return _latencyMapPromise;
  _latencyMapPromise = (async () => {
    const result: Record<string, number> = {};
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const benchDir = path.resolve(process.cwd(), 'docs', 'benchmarks', 'runs');
      if (!fs.existsSync(benchDir)) return result;
      const files = fs.readdirSync(benchDir)
        .filter(f => f.startsWith('seed-corpus-') && f.endsWith('.json'))
        .sort().reverse();
      // Prefer a file with all three tiers populated (full measurement run);
      // fall back to newest if none qualify.
      let chosen: { perCandidate?: Array<{ id: string; latency_mean_ms?: number | null; cheap_avg_score?: number | null; mid_avg_score?: number | null; strong_avg_score?: number | null }> } | null = null;
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(benchDir, f), 'utf8'));
          const sample = data.perCandidate?.[0];
          if (sample && sample.cheap_avg_score != null && sample.mid_avg_score != null && sample.strong_avg_score != null) {
            chosen = data; break;
          }
          if (!chosen) chosen = data;
        } catch { /* skip */ }
      }
      for (const r of chosen?.perCandidate ?? []) {
        if (typeof r.latency_mean_ms === 'number' && r.latency_mean_ms > 0) {
          result[r.id] = r.latency_mean_ms;
        }
      }
    } catch { /* best-effort */ }
    return result;
  })();
  return _latencyMapPromise;
}

/**
 * ADR-149 — map a concrete OpenRouter / Anthropic model id back to the
 * closest ClaudeModel tier label for back-compat. Used to populate the
 * `model: ClaudeModel` field when the actual picked `modelId` is e.g.
 * `openai/gpt-4.1` or `inclusionai/ling-2.6-flash`.
 *
 * Mapping rule: substring-based. Anthropic ids carry the tier name;
 * other providers map to the tier whose role they play (cheap, mid, strong).
 * The map is intentionally non-exhaustive — unknown ids default to 'sonnet'
 * (the safest middle ground for an unrecognised candidate).
 */
function tierLabelForModelId(modelId: string): ClaudeModel {
  const id = modelId.toLowerCase();
  if (id.includes('haiku') || id.includes('ling-') || id.includes('flash-lite')
    || id.includes('nemotron-nano') || id.includes('ministral')
    || id.includes('llama-3.2-3b') || id.includes('llama-3.1-8b')) {
    return 'haiku';
  }
  if (id.includes('opus')) return 'opus';
  // Mid-tier: sonnet, gpt-4.1, gemini-flash, llama-70b, nemotron-super, etc.
  return 'sonnet';
}

// ============================================================================
// Config resolution
// ============================================================================

function getConfig(): NeuralRouterConfig {
  if (_config !== null) return _config;
  // Default seed-corpus path: bundled with the package. We resolve relative to
  // this file's location so it works both in src (tsc dev) and in the dist.
  // dist layout:  dist/src/ruvector/neural-router.js → assets at dist/assets/...
  // src layout:   src/ruvector/neural-router.ts     → assets at assets/...
  // We probe both candidate locations.
  let assetsDir: string;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolvePath(here, '..', '..', 'assets', 'model-router'),       // src/ruvector → src/assets/...
      resolvePath(here, '..', '..', '..', 'assets', 'model-router'), // dist/src/ruvector → dist/assets/...
      resolvePath(here, '..', '..', '..', '..', 'assets', 'model-router'), // safety net
    ];
    assetsDir = candidates.find(existsSync) ?? candidates[0];
  } catch {
    assetsDir = resolvePath(process.cwd(), 'v3', '@claude-flow', 'cli', 'assets', 'model-router');
  }

  _config = {
    enabled: process.env.CLAUDE_FLOW_ROUTER_NEURAL === '1',
    modelPath: process.env.CLAUDE_FLOW_ROUTER_MODEL_PATH || undefined,
    bundledKrrPath: join(assetsDir, 'seed-router.krr.json'),
    // ADR-149 v2 — measured against the richer code-context corpus
    // (gen-seed-corpus-v2.mjs). On that corpus, cheap models (Ling 2.6
    // Flash) deliver 75-93% on cheap/mid tasks and ~54% on strong tasks;
    // expensive models deliver 56-89% across tiers. Bar=0.50 lets cheap
    // models win cheap+mid (cost-optimal) but escalates to capable models
    // on strong queries where cheap predictions fall below the bar.
    // Override per-installation; 0.25 = always-cheapest, 0.70 = quality-strict.
    qualityBar: parseFloat(process.env.CLAUDE_FLOW_ROUTER_QUALITY_BAR ?? '0.50') || 0.50,
    seedCorpusPath: process.env.CLAUDE_FLOW_ROUTER_SEED_CORPUS
      ?? join(assetsDir, 'seed-rows.json'),
    k: parseInt(process.env.CLAUDE_FLOW_ROUTER_KNN_K ?? '5', 10) || 5,
    latencyBudgetMs: Math.max(0, parseInt(process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS ?? '0', 10) || 0),
    // ADR-149 iter 24 — DEFAULT ON. Opt out with `=0`. Iter 23 OOS
    // validation: ECE 0.1604 → 0.0335 (-79%), well-calibrated.
    calibrateEnabled: process.env.CLAUDE_FLOW_ROUTER_CALIBRATE !== '0',
    // ADR-149 iter 29 — orthogonal selector mode. Blended $/Mtok ceiling;
    // 0 disables (preserves cost-optimal-above-bar). Typical values:
    //   $5    → cheap+mid tier only (Ling 2.6, Gemini Flash Lite, Llama 3.3, GPT-4.1)
    //   $20   → exclude Sonnet ($48 blended) and Opus ($240)
    //   $50   → exclude Opus only
    costCeilingPerMTok: Math.max(0, parseFloat(process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK ?? '0') || 0),
    // iter 44 — ensemble disagreement threshold; 0 disables.
    ensembleUncertaintyThreshold: Math.max(0, parseFloat(process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD ?? '0') || 0),
    calibratorPath: process.env.CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH
      ?? join(assetsDir, 'seed-router.calibrator.json'),
  };
  return _config;
}

// ============================================================================
// Backend resolution (single-init, lazy)
// ============================================================================

/** DRACO row — the shape both pure-TS and FastGRNN backends consume. */
interface DracoRow {
  embedding: number[];
  scores: Record<string, number>;
}

function loadSeedCorpus(path: string): DracoRow[] | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    // Light-touch validation: each row must have a numeric-array embedding and
    // a non-empty scores map. We do not coerce types — bad data should be
    // visible as a config bug, not silently routed around.
    for (const row of data) {
      if (!row || !Array.isArray(row.embedding) || row.embedding.length === 0) return null;
      if (!row.scores || typeof row.scores !== 'object') return null;
    }
    return data as DracoRow[];
  } catch {
    return null;
  }
}

async function resolveBackend(cfg: NeuralRouterConfig): Promise<ResolvedBackend> {
  // 1. Optional dep present? Indirect the specifier through a string variable
  //    so tsc doesn't statically resolve `@metaharness/router` at build time
  //    (TS2307 when the optional dep isn't installed — #2586 pattern).
  const metaharnessRouterPkg: string = '@metaharness/router';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- optional dep; surface is fluid across upstream versions
  let mh: any;
  try {
    mh = await import(metaharnessRouterPkg);
  } catch {
    return { available: false, router: null, routedBy: null, reason: '@metaharness/router not installed' };
  }

  // 2. If a trained-model path is set AND tiny-dancer is loadable, prefer FastGRNN.
  //    Load the NativeRouter ONCE here; reuse on every route() call.
  if (cfg.modelPath && existsSync(cfg.modelPath)) {
    const backend = await mh.resolveRouterBackend('auto');
    if (backend === 'native') {
      try {
        const nativeRouter = await mh.NativeRouter.load({ modelPath: cfg.modelPath });
        // Build per-candidate embeddings once. NativeRouter requires non-empty
        // candidate embeddings; we use a one-hot signature so the three tiers
        // are distinct in the FastGRNN's feature engineering. Dim is probed
        // from the seed corpus or falls back to 384 (MiniLM default).
        const seed = loadSeedCorpus(cfg.seedCorpusPath);
        const dim = seed?.[0]?.embedding.length ?? 384;
        const candidates = (['haiku', 'sonnet', 'opus'] as const).map((id, i) => {
          const v = new Array(dim).fill(0);
          v[i % dim] = 1;
          return { id, embedding: v, costPerMTok: PRICES[id] };
        });
        return {
          available: true,
          router: null, // The native path uses the `native` field below, not `router`.
          native: { router: nativeRouter, candidates },
          routedBy: 'fastgrnn',
          reason: `native router loaded from ${cfg.modelPath}`,
        };
      } catch (e) {
        // Fall through to pure-TS paths
      }
    }
  }

  // 3. Trained KRR JSON artifact path?
  if (cfg.modelPath && existsSync(cfg.modelPath) && cfg.modelPath.endsWith('.json')) {
    try {
      const json = JSON.parse(readFileSync(cfg.modelPath, 'utf8'));
      const trained = mh.TrainedRouter.fromJSON(json);
      // Pre-extract candidate ids+costs for predictAll
      const cands = json.candidates.map((c: { id: string; costPerMTok: number }) => ({ id: c.id, costPerMTok: c.costPerMTok }));
      return {
        available: true,
        router: {
          route: (e: number[]) => {
            const r = trained.route(e);
            return { id: r.id, predictedQuality: r.predictedQuality, costPerMTok: r.costPerMTok, metBar: r.metBar };
          },
          predictAll: (e: number[]) => cands.map((c: { id: string; costPerMTok: number }) => ({
            id: c.id, predictedQuality: trained.predict(c.id, e), costPerMTok: c.costPerMTok,
          })).sort((a: { costPerMTok: number }, b: { costPerMTok: number }) => a.costPerMTok - b.costPerMTok),
        },
        routedBy: 'metaharness-krr',
        reason: `KRR artifact loaded from ${cfg.modelPath}`,
      };
    } catch {
      // Fall through to k-NN
    }
  }

  // 3.5. No user artifact → try the bundled pre-trained KRR (~96kB, ~0.020 ms/route).
  if (existsSync(cfg.bundledKrrPath)) {
    try {
      // ADR-149 iter 22+24+25 — load isotonic calibrator(s) if the gate
      // isn't explicitly closed. Calibration is ON by default (iter 24);
      // iter 23's out-of-sample LOO validation showed ECE drops 79% with
      // calibration enabled. Iter 25 adds per-tier calibrators: when a
      // matching `seed-router.calibrator.{low,med,high}.json` exists,
      // bucket-specialist KRR routers are wrapped with the bucket-matched
      // calibrator (closes mid-tier residual ECE; mid in-sample MAE drops
      // 0.36 → 0.17 with tier-specific fit). Set
      // `CLAUDE_FLOW_ROUTER_CALIBRATE=0` to opt out of all calibration.
      type Cal = { transform: (x: number) => number };
      let unifiedCalibrator: Cal | null = null;
      const calibratorByBucket: Partial<Record<'low' | 'med' | 'high', Cal>> = {};
      const loadedCalibrators: string[] = [];
      if (cfg.calibrateEnabled) {
        const { IsotonicCalibrator } = await import('./router-calibrator.js');
        const loadCal = (path: string): Cal | null => {
          if (!existsSync(path)) return null;
          try {
            return IsotonicCalibrator.fromJSON(JSON.parse(readFileSync(path, 'utf8')));
          } catch { return null; }
        };
        unifiedCalibrator = loadCal(cfg.calibratorPath);
        if (unifiedCalibrator) loadedCalibrators.push('unified');
        // Per-tier — paths follow the iter 16 KRR specialist convention.
        const calDir = cfg.calibratorPath.replace(/seed-router\.calibrator\.json$/, '');
        for (const bucket of ['low', 'med', 'high'] as const) {
          const c = loadCal(`${calDir}seed-router.calibrator.${bucket}.json`);
          if (c) {
            calibratorByBucket[bucket] = c;
            loadedCalibrators.push(bucket);
          }
        }
      }
      const wrapWithCalibrator = (r: PureRouter, cal: Cal | null): PureRouter => {
        if (!cal) return r;
        return {
          route: (e) => {
            const result = r.route(e);
            return { ...result, predictedQuality: cal.transform(result.predictedQuality) };
          },
          predictAll: (e) => r.predictAll(e).map(c => ({ ...c, predictedQuality: cal.transform(c.predictedQuality) })),
        };
      };

      // Helper: load a TrainedRouter from a path and wrap it as a PureRouter.
      const loadKrr = (path: string): PureRouter | null => {
        if (!existsSync(path)) return null;
        try {
          const json = JSON.parse(readFileSync(path, 'utf8'));
          const trained = mh.TrainedRouter.fromJSON(json);
          const cands = json.candidates.map((c: { id: string; costPerMTok: number }) => ({ id: c.id, costPerMTok: c.costPerMTok }));
          return {
            route: (e: number[]) => {
              const r = trained.route(e);
              return { id: r.id, predictedQuality: r.predictedQuality, costPerMTok: r.costPerMTok, metBar: r.metBar };
            },
            predictAll: (e: number[]) => cands.map((c: { id: string; costPerMTok: number }) => ({
              id: c.id, predictedQuality: trained.predict(c.id, e), costPerMTok: c.costPerMTok,
            })).sort((a: { costPerMTok: number }, b: { costPerMTok: number }) => a.costPerMTok - b.costPerMTok),
          };
        } catch { return null; }
      };

      const unifiedRaw = loadKrr(cfg.bundledKrrPath);
      if (!unifiedRaw) throw new Error('failed to load unified KRR');
      const unified = wrapWithCalibrator(unifiedRaw, unifiedCalibrator);

      // ADR-149 iter 16 — load per-bucket specialists if present. Each is a
      // KRR fit only to its tier's rows (cheap → low.json, mid → med.json,
      // strong → high.json). When tryCostOptimalRoute is called with a
      // complexityBucket, the matching specialist is preferred over the
      // unified router.
      const bucketDir = cfg.bundledKrrPath.replace(/seed-router\.krr\.json$/, '');
      const routerByBucket: Partial<Record<'low' | 'med' | 'high', PureRouter>> = {};
      const loadedBuckets: string[] = [];
      for (const bucket of ['low', 'med', 'high'] as const) {
        const r = loadKrr(`${bucketDir}seed-router.krr.${bucket}.json`);
        if (r) {
          // iter 25 — prefer tier-specific calibrator for this bucket;
          // fall back to the unified calibrator when no specialist exists.
          routerByBucket[bucket] = wrapWithCalibrator(r, calibratorByBucket[bucket] ?? unifiedCalibrator);
          loadedBuckets.push(bucket);
        }
      }
      const calibratedNote = loadedCalibrators.length > 0
        ? ` (calibrated: ${loadedCalibrators.join('+')})`
        : '';
      const reason = loadedBuckets.length > 0
        ? `bundled KRR loaded from ${cfg.bundledKrrPath} + ${loadedBuckets.length} bucket specialist(s): ${loadedBuckets.join(', ')}${calibratedNote}`
        : `bundled KRR artifact loaded from ${cfg.bundledKrrPath}${calibratedNote}`;
      return {
        available: true,
        router: unified,
        ...(loadedBuckets.length > 0 ? { routerByBucket } : {}),
        routedBy: 'metaharness-krr',
        reason,
      };
    } catch {
      // Fall through to k-NN
    }
  }

  // 4. Pure-TS k-NN over the bundled seed corpus.
  const seed = loadSeedCorpus(cfg.seedCorpusPath);
  if (!seed || seed.length === 0) {
    return { available: true, router: null, routedBy: null, reason: `seed corpus missing or invalid at ${cfg.seedCorpusPath}` };
  }
  const router = mh.Router.fromExamples(seed, PRICES, { qualityBar: cfg.qualityBar, k: cfg.k });
  // Pre-build per-candidate views ONCE so predictAll() doesn't re-allocate
  // O(seed.length) objects per call. Sort by cost so the result is already in
  // cheapest-first order.
  const candIds = Object.keys(PRICES).filter(id => id !== 'inherit');
  const candidateViews = candIds
    .map(id => ({
      id,
      costPerMTok: PRICES[id as ClaudeModel],
      examples: seed.map(r => ({ embedding: r.embedding, quality: r.scores[id] ?? 0 })),
    }))
    .sort((a, b) => a.costPerMTok - b.costPerMTok);
  return {
    available: true,
    router: {
      route: (e: number[]) => {
        const r = router.route(e);
        return { id: r.id, predictedQuality: r.predictedQuality, costPerMTok: r.costPerMTok, metBar: r.metBar };
      },
      predictAll: (e: number[]) => candidateViews.map(c => ({
        id: c.id, predictedQuality: router.predict(c, e), costPerMTok: c.costPerMTok,
      })),
    },
    routedBy: 'metaharness-knn',
    reason: `k-NN over ${seed.length} seed rows`,
  };
}

async function getBackend(): Promise<ResolvedBackend> {
  if (_backend !== null) return _backend;
  if (_initPromise !== null) return _initPromise;
  const cfg = getConfig();
  _initPromise = resolveBackend(cfg).then(b => { _backend = b; return b; });
  return _initPromise;
}

// ============================================================================
// Public function
// ============================================================================

/**
 * Cost-optimal route via the optional neural backend. Returns `null` when the
 * neural path is disabled (gate closed), unavailable (deps missing), or
 * unconfigured (no corpus / artifact). Callers must fall back to the
 * heuristic+bandit path on null and tag the result `routedBy: 'bandit-fallback'`.
 *
 * @param embedding 384-dim (or matching corpus dim) query embedding
 * @returns NeuralRouteResult on success, or `null` when the path is inactive
 */
export async function tryCostOptimalRoute(
  embedding: number[],
  opts?: { complexityBucket?: 'low' | 'med' | 'high' }
): Promise<NeuralRouteResult | null> {
  const cfg = getConfig();
  if (!cfg.enabled) return null;
  if (!Array.isArray(embedding) || embedding.length === 0) return null;

  const backend = await getBackend();
  if (!backend.available || backend.routedBy === null) return null;

  const t0 = Number(process.hrtime.bigint() / 1000n); // microseconds
  try {
    if (backend.routedBy === 'fastgrnn') {
      // Native path: NativeRouter was loaded once at resolveBackend time;
      // candidates were precomputed. Hot path is one .route() call.
      if (!backend.native) return null;
      const res = await backend.native.router.route(embedding, backend.native.candidates);
      const modelId = res.id;
      const t1 = Number(process.hrtime.bigint() / 1000n);
      return {
        model: tierLabelForModelId(modelId),
        modelId,
        predictedQuality: 1 - res.uncertainty, // FastGRNN reports uncertainty, not quality directly
        metBar: !res.useLightweight && res.confidence >= cfg.qualityBar,
        alternatives: backend.native.candidates.map(c => ({
          model: tierLabelForModelId(c.id),
          modelId: c.id,
          predictedQuality: c.id === modelId ? res.confidence : 0,
          costPerMTok: c.costPerMTok,
        })),
        routedBy: 'fastgrnn',
        inferenceTimeUs: t1 - t0,
      };
    }

    // Pure-TS paths (k-NN or KRR) — ADR-149: ids are arbitrary strings,
    // not ClaudeModel tier names. `tierLabelForModelId` derives the
    // back-compat tier; `modelId` carries the concrete pick.
    //
    // ADR-149 iter 16 — when the caller supplies a complexity bucket AND a
    // per-bucket specialist KRR was loaded at backend resolution, prefer
    // the specialist over the unified router. Each specialist is trained
    // only on its tier's rows (looQuality 0.94 for cheap vs 0.71 unified)
    // so its predictions are sharper for queries in that band.
    const activeRouter = (opts?.complexityBucket && backend.routerByBucket?.[opts.complexityBucket])
      ?? backend.router;
    if (!activeRouter) return null;
    const allRaw = activeRouter.predictAll(embedding);

    // ADR-149 iter 14 — per-modelId Thompson sampling. When
    // CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL=1, perturb each candidate's
    // predicted quality by a Beta sample from its persisted per-modelId
    // prior. Lets the bandit learn "Ling outperforms Haiku-4.5 within
    // the cheap tier" without changing the neural backend's prediction.
    //
    // Density guard: only apply the perturbation when (α+β) > 4 for that
    // modelId (≥2 outcomes accumulated; cold-start Beta(1,1) gives α+β=2).
    // Otherwise the bandit's signal is uninformative noise and we'd
    // sabotage the well-trained neural prediction.
    let all = allRaw;
    if (process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL === '1') {
      try {
        const { getModelRouterPriorsById, sampleBeta } = await import('./model-router.js');
        const priorsById = getModelRouterPriorsById();
        const bucket = opts?.complexityBucket;   // ADR-149 iter 15
        if (priorsById) {
          // Cross-bucket shrinkage configuration (iter 57). When λ > 0,
          // bucket-specific priors with few samples blend toward the
          // marginal-across-buckets prior. Classic James-Stein-style
          // shrinkage: rich cells trust themselves, thin cells borrow
          // strength from neighbors. Default λ = 4 (set =0 to disable).
          const shrinkageLambda = Math.max(0, parseFloat(process.env.CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA ?? '4') || 0);
          all = allRaw.map(a => {
            // Compute marginal-across-buckets prior for this modelId ONCE
            // (used either as the primary prior OR as the shrinkage anchor).
            let alphaMarginal = 1, betaMarginal = 1;
            let marginalFound = false;
            for (const b of ['low', 'med', 'high'] as const) {
              const p = priorsById[b]?.[a.id];
              if (p) {
                alphaMarginal += p.alpha - 1;
                betaMarginal += p.beta - 1;
                marginalFound = true;
              }
            }

            let alpha: number, beta: number;
            if (bucket && priorsById[bucket]?.[a.id]) {
              // Bucket-specific prior exists — use it as the primary signal
              // (iter 15 sharpness). Iter 57: when shrinkage is enabled,
              // blend toward the marginal anchor based on specific-cell
              // sample richness. w_s = (n_s + 1) / (n_s + 1 + λ). At n_s=0
              // → mostly marginal; at n_s=large → mostly specific.
              const p = priorsById[bucket][a.id];
              const nSpecific = p.alpha + p.beta - 2;
              if (shrinkageLambda > 0 && marginalFound) {
                const wSpecific = (nSpecific + 1) / (nSpecific + 1 + shrinkageLambda);
                alpha = wSpecific * p.alpha + (1 - wSpecific) * alphaMarginal;
                beta  = wSpecific * p.beta  + (1 - wSpecific) * betaMarginal;
              } else {
                alpha = p.alpha;
                beta = p.beta;
              }
            } else if (marginalFound) {
              // Marginal fallback (iter 14) — no bucket-specific prior at all.
              alpha = alphaMarginal;
              beta = betaMarginal;
            } else {
              return a;
            }
            const samples = alpha + beta;
            if (samples <= 2) return a;  // hard floor — uniform prior has no signal
            // iter 52 — continuous warmup curve. Replaces iter 14's binary
            // density guard. Two curves available:
            //   default (iter 52):  blendFactor = 0.5 * min(1, (s-2)/WARMUP)
            //                       Capped at 0.5 → matches iter 14's
            //                       50/50 baseline at saturation.
            //   iter 53 opt-in:     blendFactor = (s-2) / (s + WARMUP)
            //                       Asymptotes to 1.0 as samples → ∞.
            //                       At s=1000 → bandit ~99% influence.
            //                       Use when you have lots of bandit data
            //                       and want it to dominate the neural prior.
            //                       Gate: CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE=1.
            const warmupRange = Math.max(1, parseFloat(process.env.CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE ?? '8') || 8);
            const fullInfluence = process.env.CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE === '1';
            const banditScore = sampleBeta(alpha, beta);
            const blendFactor = fullInfluence
              ? (samples - 2) / (samples + warmupRange)
              : 0.5 * Math.min(1, (samples - 2) / warmupRange);
            return { ...a, predictedQuality: (1 - blendFactor) * a.predictedQuality + blendFactor * banditScore };
          });
        }
      } catch { /* best-effort */ }
    }

    // ADR-149 iter 12 — latency-aware filtering. When CLAUDE_FLOW_ROUTER_
    // LATENCY_BUDGET_MS is set, drop candidates whose measured latency
    // exceeds the budget BEFORE the cost-optimal pick. The unfiltered
    // alternatives stay on the result for observability — only the chosen
    // `modelId` is constrained.
    let main = activeRouter.route(embedding);
    // Re-derive `main` from the post-Thompson `all` list when per-modelId
    // is on (otherwise the bandit adjustment is invisible to the selector).
    if (process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL === '1') {
      const clearing = all.filter(a => a.predictedQuality >= cfg.qualityBar)
        .sort((a, b) => a.costPerMTok - b.costPerMTok);
      const pick = clearing[0] ?? [...all].sort((a, b) => b.predictedQuality - a.predictedQuality)[0];
      if (pick) {
        main = { id: pick.id, predictedQuality: pick.predictedQuality, costPerMTok: pick.costPerMTok, metBar: pick.predictedQuality >= cfg.qualityBar };
      }
    }
    if (cfg.latencyBudgetMs > 0) {
      const latency = await loadLatencyMap();
      const eligible = all.filter(a => {
        const lat = latency[a.id];
        return lat === undefined || lat <= cfg.latencyBudgetMs;
      });
      if (eligible.length > 0) {
        // Re-pick cheapest-clearing-bar among eligible
        const clearing = eligible.filter(a => a.predictedQuality >= cfg.qualityBar)
          .sort((a, b) => a.costPerMTok - b.costPerMTok);
        const pick = clearing[0] ?? [...eligible].sort((a, b) => b.predictedQuality - a.predictedQuality)[0];
        main = { id: pick.id, predictedQuality: pick.predictedQuality, costPerMTok: pick.costPerMTok, metBar: pick.predictedQuality >= cfg.qualityBar };
      }
      // else: every candidate exceeds the budget → fall back to the original pick
      //   (better to return a slow answer than no answer)
    }

    // ADR-149 iter 29 — quality-best-under-budget mode. When the cost
    // ceiling is set, OVERRIDE the cost-optimal-above-bar pick:
    //   1. filter candidates by costPerMTok ≤ ceiling
    //   2. sort by predictedQuality DESC
    //   3. pick the top one
    // qualityBar still informs `metBar` on the result for observability,
    // but does NOT filter the selection — the operator's hard constraint
    // is cost, and they want the best quality they can get under it.
    // If no candidate fits the ceiling, fall through to the existing pick
    // (better to return something than nothing — same policy as the
    // latency-budget fallback above).
    if (cfg.costCeilingPerMTok > 0) {
      const affordable = all.filter(a => a.costPerMTok <= cfg.costCeilingPerMTok);
      if (affordable.length > 0) {
        const pick = [...affordable].sort((a, b) => b.predictedQuality - a.predictedQuality)[0];
        main = {
          id: pick.id,
          predictedQuality: pick.predictedQuality,
          costPerMTok: pick.costPerMTok,
          metBar: pick.predictedQuality >= cfg.qualityBar,
        };
      }
    }

    // ADR-149 iter 44+45 — ensemble disagreement diagnostic + uncertainty-
    // aware fallback. When both the unified router and a bucket specialist
    // are loaded AND a bucket was supplied, compute the picked model's
    // prediction disagreement across both backends. ALWAYS surface it on
    // the result (iter 45 — observable signal for tuning the threshold).
    // If iter 44's threshold is > 0 AND the disagreement exceeds it, return
    // null so the caller falls back to the pure bandit path (same as 429/5xx
    // — uncertainty is a kind of soft failure).
    let ensembleDisagreement: number | undefined;
    if (
      opts?.complexityBucket
      && backend.routerByBucket?.[opts.complexityBucket]
      && backend.router
      && activeRouter !== backend.router            // we used the specialist; cross-check vs unified
    ) {
      const unifiedAlts = backend.router.predictAll(embedding);
      const specialistQ = main.predictedQuality;
      const unifiedQ = unifiedAlts.find(a => a.id === main.id)?.predictedQuality ?? specialistQ;
      ensembleDisagreement = Math.abs(unifiedQ - specialistQ);
      if (cfg.ensembleUncertaintyThreshold > 0 && ensembleDisagreement > cfg.ensembleUncertaintyThreshold) {
        return null;
      }
    }

    const t1 = Number(process.hrtime.bigint() / 1000n);
    return {
      model: tierLabelForModelId(main.id),
      modelId: main.id,
      predictedQuality: main.predictedQuality,
      metBar: main.metBar,
      alternatives: all.map(a => ({
        model: tierLabelForModelId(a.id),
        modelId: a.id,
        predictedQuality: a.predictedQuality,
        costPerMTok: a.costPerMTok,
      })),
      routedBy: backend.routedBy,
      inferenceTimeUs: t1 - t0,
      ...(ensembleDisagreement !== undefined ? { ensembleDisagreement } : {}),
    };
  } catch {
    // Any runtime failure is silently swallowed → caller's bandit-fallback engages.
    return null;
  }
}

/**
 * Batch counterpart to `tryCostOptimalRoute`. Routes a list of embeddings
 * in one go, sharing backend resolution + (for the pure-TS paths)
 * candidate-view setup across the batch. The native FastGRNN path still
 * dispatches per-call (xenova's worker doesn't support array inputs for
 * tiny-dancer's Router.route).
 *
 * Order of the output array matches the input order. Each slot is either
 * a NeuralRouteResult or null (gate closed, backend unavailable, etc. —
 * mirrors the single-call contract).
 *
 * For harness-style callers (batch evals, GAIA runs, parallel agent
 * dispatch) this amortizes backend init across N queries — first-call
 * cold-load (~10 ms) becomes a fixed cost regardless of batch size.
 */
export async function tryCostOptimalRouteBatch(embeddings: number[][]): Promise<Array<NeuralRouteResult | null>> {
  const out: Array<NeuralRouteResult | null> = new Array(embeddings.length).fill(null);
  const cfg = getConfig();
  if (!cfg.enabled) return out;
  const backend = await getBackend();
  if (!backend.available || backend.routedBy === null) return out;

  // FastGRNN path: per-call native dispatch. The native router doesn't
  // expose a batch entry point. We still share the loaded NativeRouter
  // instance + candidate embeddings, which is most of the per-call cost.
  if (backend.routedBy === 'fastgrnn') {
    if (!backend.native) return out;
    const native = backend.native;
    const tasks = embeddings.map(async (e, i) => {
      if (!Array.isArray(e) || e.length === 0) return null;
      try {
        const t0 = Number(process.hrtime.bigint() / 1000n);
        const res = await native.router.route(e, native.candidates);
        const modelId = res.id;
        const t1 = Number(process.hrtime.bigint() / 1000n);
        const result: NeuralRouteResult = {
          model: tierLabelForModelId(modelId),
          modelId,
          predictedQuality: 1 - res.uncertainty,
          metBar: !res.useLightweight && res.confidence >= cfg.qualityBar,
          alternatives: native.candidates.map(c => ({
            model: tierLabelForModelId(c.id),
            modelId: c.id,
            predictedQuality: c.id === modelId ? res.confidence : 0,
            costPerMTok: c.costPerMTok,
          })),
          routedBy: 'fastgrnn',
          inferenceTimeUs: t1 - t0,
        };
        out[i] = result;
      } catch {
        out[i] = null;
      }
      return null;
    });
    await Promise.all(tasks);
    return out;
  }

  // Pure-TS path (k-NN or KRR): same shared router + candidate views,
  // tight loop. predictAll is cheap (already-pre-built per-candidate
  // examples) so we avoid re-allocating per call.
  if (!backend.router) return out;
  for (let i = 0; i < embeddings.length; i++) {
    const e = embeddings[i];
    if (!Array.isArray(e) || e.length === 0) { out[i] = null; continue; }
    try {
      const t0 = Number(process.hrtime.bigint() / 1000n);
      const main = backend.router.route(e);
      const all = backend.router.predictAll(e);
      const t1 = Number(process.hrtime.bigint() / 1000n);
      out[i] = {
        model: tierLabelForModelId(main.id),
        modelId: main.id,
        predictedQuality: main.predictedQuality,
        metBar: main.metBar,
        alternatives: all.map(a => ({
          model: tierLabelForModelId(a.id),
          modelId: a.id,
          predictedQuality: a.predictedQuality,
          costPerMTok: a.costPerMTok,
        })),
        routedBy: backend.routedBy,
        inferenceTimeUs: t1 - t0,
      };
    } catch {
      out[i] = null;
    }
  }
  return out;
}

/**
 * Diagnostic surface — returns the active backend without performing a route.
 * Used by the bench and by `claude-flow neural router status` (future CLI).
 */
export async function neuralRouterStatus(): Promise<{ enabled: boolean; available: boolean; routedBy: NeuralRoutedBy | null; reason: string; config: NeuralRouterConfig }> {
  const cfg = getConfig();
  if (!cfg.enabled) return { enabled: false, available: false, routedBy: null, reason: 'CLAUDE_FLOW_ROUTER_NEURAL!=1', config: cfg };
  const backend = await getBackend();
  return { enabled: true, available: backend.available, routedBy: backend.routedBy, reason: backend.reason, config: cfg };
}

/**
 * ADR-149 iter 7 — fallback selector for retry-on-failure. Returns the
 * cheapest candidate predicted to clear the quality bar (or the best-
 * predicted if none do) that is NOT in `excludeModelIds`. Used by
 * `executeAgentTask` to retry with a different model after a 429/5xx.
 *
 * Returns `null` when:
 *   - the gate is closed (mirrors tryCostOptimalRoute)
 *   - the embedding is missing or empty
 *   - the backend isn't loadable
 *   - every candidate is excluded (all retries exhausted)
 *
 * Selection is per-candidate via predictAll, then filter by exclude,
 * then cheapest-clearing-bar (falling back to best-predicted).
 */
export async function nextCostOptimalAlternative(
  embedding: number[],
  excludeModelIds: Iterable<string>
): Promise<NeuralRouteResult | null> {
  const cfg = getConfig();
  if (!cfg.enabled) return null;
  if (!Array.isArray(embedding) || embedding.length === 0) return null;
  const backend = await getBackend();
  if (!backend.available || backend.router === null || backend.routedBy === null) return null;

  const exclude = new Set<string>(excludeModelIds);
  const t0 = Number(process.hrtime.bigint() / 1000n);

  // Pure-TS path only — fallback retries are too rare to be worth threading
  // through the FastGRNN candidate-embedding rebuild dance.
  try {
    const all = backend.router.predictAll(embedding);
    const remaining = all.filter(a => !exclude.has(a.id));
    if (remaining.length === 0) return null;

    // Cheapest predicted to clear qualityBar, else best-predicted among
    // remaining. Mirrors @metaharness/router's qualityBar semantics.
    const clearing = remaining.filter(a => a.predictedQuality >= cfg.qualityBar)
      .sort((a, b) => a.costPerMTok - b.costPerMTok);
    const pick = clearing[0] ?? [...remaining].sort((a, b) => b.predictedQuality - a.predictedQuality)[0];
    const t1 = Number(process.hrtime.bigint() / 1000n);

    return {
      model: tierLabelForModelId(pick.id),
      modelId: pick.id,
      predictedQuality: pick.predictedQuality,
      metBar: pick.predictedQuality >= cfg.qualityBar,
      alternatives: remaining.map(a => ({
        model: tierLabelForModelId(a.id),
        modelId: a.id,
        predictedQuality: a.predictedQuality,
        costPerMTok: a.costPerMTok,
      })),
      routedBy: backend.routedBy,
      inferenceTimeUs: t1 - t0,
    };
  } catch {
    return null;
  }
}

/**
 * Test seam — reset module-level caches so unit tests can simulate cold init.
 * Not exported from the package's barrel.
 */
export function __resetNeuralRouterForTests(): void {
  _config = null;
  _backend = null;
  _initPromise = null;
  _latencyMapPromise = null;
}
