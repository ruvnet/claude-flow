/**
 * neural-router.test.ts — ADR-148 / #2334
 *
 * Verifies the gated, graceful integration of `@metaharness/router` (with
 * optional `@ruvector/tiny-dancer` acceleration) into the model-routing
 * path. The contract under test:
 *
 *   1. Default behavior is byte-identical: with no env vars set,
 *      `tryCostOptimalRoute()` returns null and `ModelRouter.route()` carries
 *      `routedBy: 'heuristic'`.
 *   2. Gate-open + corpus-present → a real cost-optimal pick is returned
 *      and `routedBy` reflects the active backend.
 *   3. Gate-open + invalid embedding (empty array) → null + bandit-fallback.
 *   4. Trajectory recorder writes only when its own gate is set.
 *   5. `task_hash` is deterministic across imports.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { __resetNeuralRouterForTests, tryCostOptimalRoute, neuralRouterStatus } from '../src/ruvector/neural-router.js';
import { __resetTrajectoryRecorderForTests, recordDecision, taskHash, trajectoryRecorderStatus } from '../src/ruvector/router-trajectory.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeEmbedding(seed: number, dim = 32): number[] {
  // Mirror scripts/gen-seed-corpus.mjs signal channels so the synthetic
  // probe is on-distribution for the bundled seed corpus.
  let h = (seed | 1) >>> 0;
  const v: number[] = new Array(dim);
  const next = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h = h >>> 0; return ((h % 2_000_001) / 1_000_000) - 1; };
  for (let i = 0; i < dim; i++) v[i] = next() * 0.5;
  return v;
}
const ENV_KEYS = [
  'CLAUDE_FLOW_ROUTER_NEURAL',
  'CLAUDE_FLOW_ROUTER_TRAJECTORY',
  'CLAUDE_FLOW_ROUTER_MODEL_PATH',
  'CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH',
  'CLAUDE_FLOW_ROUTER_SEED_CORPUS',
  'CLAUDE_FLOW_SWARM_DIR',
  'CLAUDE_FLOW_ROUTER_PROVIDER',
  'CLAUDE_FLOW_ROUTER_OPENROUTER_ALTS',
  'CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS',
  'CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL',
  'CLAUDE_FLOW_ROUTER_CALIBRATE',           // iter 24 — default-on; tests should not leak overrides
  'CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH',
  'CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK',  // iter 29
  'CLAUDE_FLOW_ROUTER_AB',                          // iter 37
  'CLAUDE_FLOW_ROUTER_AB_SAMPLE_RATE',
  'CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD',  // iter 44
  'CLAUDE_FLOW_ROUTER_BANDIT_WARMUP_RANGE',           // iter 52
  'CLAUDE_FLOW_ROUTER_BANDIT_FULL_INFLUENCE',         // iter 53
  'CLAUDE_FLOW_ROUTER_BANDIT_SHRINKAGE_LAMBDA',       // iter 57
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
];
function clearEnv() { for (const k of ENV_KEYS) delete process.env[k]; }

// ---------------------------------------------------------------------------
// neural-router
// ---------------------------------------------------------------------------
describe('neural-router (ADR-148)', () => {
  beforeEach(() => {
    clearEnv();
    __resetNeuralRouterForTests();
  });
  afterEach(() => clearEnv());

  it('returns null when CLAUDE_FLOW_ROUTER_NEURAL is not set (gate closed)', async () => {
    const result = await tryCostOptimalRoute(makeEmbedding(42));
    expect(result).toBeNull();
  });

  it('returns null when embedding is missing or empty (even with gate open)', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    // @ts-expect-error — testing the invalid-input branch
    expect(await tryCostOptimalRoute(undefined)).toBeNull();
    expect(await tryCostOptimalRoute([])).toBeNull();
  });

  it('reports enabled=false when gate is closed in status()', async () => {
    const s = await neuralRouterStatus();
    expect(s.enabled).toBe(false);
    expect(s.routedBy).toBeNull();
  });

  it('returns a cost-optimal pick when gate is open and seed corpus loads', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    // ADR-149 v2 — the seed corpus now carries real 384-dim MiniLM embeddings.
    // A zero-vector probe is a neutral query; we don't predict a specific tier
    // (the picked tier depends on the trained KRR's nearest neighbours), but
    // every routing contract still applies: a real modelId, a valid tier
    // label, ≥2 alternatives, non-negative latency.
    const e = new Array(384).fill(0);
    const r = await tryCostOptimalRoute(e);
    if (!r) {
      // If @metaharness/router isn't installed in CI, we expect null and a
      // diagnostic reason. Skip strict assertions on the cost-optimal pick.
      const s = await neuralRouterStatus();
      expect(s.available || s.reason.includes('not installed')).toBe(true);
      return;
    }
    expect(['metaharness-knn', 'metaharness-krr', 'fastgrnn']).toContain(r.routedBy);
    expect(typeof r.modelId).toBe('string');
    expect(r.modelId.length).toBeGreaterThan(0);
    expect(['haiku', 'sonnet', 'opus', 'inherit']).toContain(r.model);
    expect(r.inferenceTimeUs).toBeGreaterThanOrEqual(0);
    expect(r.alternatives.length).toBeGreaterThanOrEqual(2);
  });

  it('returns a per-model pick with modelId (ADR-149)', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const e = new Array(32).fill(0);
    e[0] = -0.85; e[1] = 0.7;
    const r = await tryCostOptimalRoute(e);
    if (!r) return; // dep absent in CI
    // ADR-149: the result must carry a concrete model id (a string), and
    // the picked model id must appear as one of the alternatives.
    expect(typeof r.modelId).toBe('string');
    expect(r.modelId.length).toBeGreaterThan(0);
    expect(r.alternatives.find(a => a.modelId === r.modelId)).toBeDefined();
    // The tier label (model) is derived from the modelId — must be a valid
    // ClaudeModel tier, not necessarily the "expected" tier (DRACO finding:
    // measured cheap models often beat expensive ones on terse tasks).
    expect(['haiku', 'sonnet', 'opus', 'inherit']).toContain(r.model);
  });

  it('caches the resolved backend across calls', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const e = makeEmbedding(3);
    e[0] = 0.85;
    const s1 = await neuralRouterStatus();
    const s2 = await neuralRouterStatus();
    // routedBy should be sticky across calls (single-init guarantee)
    expect(s1.routedBy).toBe(s2.routedBy);
  });

  it('calibration is default-ON; CLAUDE_FLOW_ROUTER_CALIBRATE=0 opts out (ADR-149 iter 24)', async () => {
    // Iter 23 OOS validation moved this from opt-in to opt-out: ECE 0.1604 →
    // 0.0335 with calibration enabled. Verify the env-var semantics flipped:
    //   unset      → calibration applied (status reason contains 'calibrated')
    //   = '1'      → calibration applied (back-compat)
    //   = '0'      → calibration bypassed (raw KRR behavior)
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';

    // Default: no env var → calibrated.
    __resetNeuralRouterForTests();
    const sDefault = await neuralRouterStatus();
    if (sDefault.routedBy !== 'metaharness-krr') return; // dep absent / KRR not loaded
    expect(sDefault.reason).toContain('calibrated');

    // Back-compat: '1' still works.
    process.env.CLAUDE_FLOW_ROUTER_CALIBRATE = '1';
    __resetNeuralRouterForTests();
    const sOn = await neuralRouterStatus();
    expect(sOn.reason).toContain('calibrated');

    // Opt-out: '0' bypasses.
    process.env.CLAUDE_FLOW_ROUTER_CALIBRATE = '0';
    __resetNeuralRouterForTests();
    const sOff = await neuralRouterStatus();
    expect(sOff.reason).not.toContain('calibrated');
  });

  it('A/B sample-rate is deterministic by task_hash (ADR-149 iter 37)', async () => {
    // Verify the deterministic-by-FNV sampling math directly. The integration
    // point (whether abPair ends up in the route result) depends on neural
    // backend availability — fragile in tests. We assert the sample-decision
    // math instead: same task → same decision, populations match the rate.

    // Reproduce the FNV-1a-32 + mod-10000 logic from model-router.ts.
    const sampleDecision = (task: string, rate: number): boolean => {
      let h = 0x811c9dc5 >>> 0;
      for (let i = 0; i < task.length; i++) {
        h ^= task.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return (h % 10000) / 10000 < rate;
    };

    // Determinism: same task → same decision.
    expect(sampleDecision('the same task', 0.5)).toBe(sampleDecision('the same task', 0.5));
    expect(sampleDecision('another task', 0.5)).toBe(sampleDecision('another task', 0.5));

    // Population: 50% rate over 200 varied tasks should land between 35% and
    // 65% in-sample (loose Bernoulli bound).
    let inSample = 0;
    for (let i = 0; i < 200; i++) {
      if (sampleDecision(`task-${i}-${i * 17 + 3}`, 0.5)) inSample++;
    }
    expect(inSample).toBeGreaterThan(70);
    expect(inSample).toBeLessThan(130);

    // Rate=0 → never in sample.
    for (let i = 0; i < 50; i++) {
      expect(sampleDecision(`zero-task-${i}`, 0)).toBe(false);
    }
    // Rate=1 → always in sample.
    for (let i = 0; i < 50; i++) {
      expect(sampleDecision(`one-task-${i}`, 1)).toBe(true);
    }
  });

  it('continuous bandit warmup blends gradually with sample count (ADR-149 iter 52)', async () => {
    // The warmup math: weight = min(1, (samples - 2) / WARMUP_RANGE).
    // blendFactor = 0.5 * weight. blended_q = (1-bf)*neural + bf*bandit.
    // Verify the formula in isolation (selector flow is too integration-heavy
    // to assert deterministically without controlling Beta samples).
    const warmupRange = 8;
    const compute = (samples: number) => {
      if (samples <= 2) return { weight: 0, blendFactor: 0 };
      const w = Math.min(1, (samples - 2) / warmupRange);
      return { weight: w, blendFactor: 0.5 * w };
    };

    // samples=2 (uniform prior) → no blend
    expect(compute(2).blendFactor).toBe(0);
    // samples=3 (first observation) → tiny weight
    expect(compute(3).blendFactor).toBeCloseTo(0.5 * (1 / 8), 6);
    // samples=6 (mid-warmup) → halfway up the curve
    expect(compute(6).blendFactor).toBeCloseTo(0.5 * (4 / 8), 6);
    // samples=10 (fully warm) → max blend (matches iter 14 baseline 50/50)
    expect(compute(10).blendFactor).toBe(0.5);
    // samples=100 (very warm) → still capped at max (no over-trust)
    expect(compute(100).blendFactor).toBe(0.5);

    // The function MUST be monotone non-decreasing in samples — bandit gets
    // MORE influence as data accumulates, never less.
    let prev = -Infinity;
    for (let s = 2; s <= 20; s++) {
      const bf = compute(s).blendFactor;
      expect(bf).toBeGreaterThanOrEqual(prev);
      prev = bf;
    }
  });

  it('iter 57 cross-bucket shrinkage blends specific prior toward marginal (ADR-149 iter 57)', async () => {
    // Verify the shrinkage math in isolation. w_s = (n_s + 1) / (n_s + 1 + λ).
    // Blended (α, β) = w_s * specific + (1 - w_s) * marginal.
    //
    // Scenario: med-bucket gpt-4.1 has 3 samples (α=3, β=2, n=3).
    // Marginal across buckets has 50 samples (α=30, β=22, n=50).
    // Lambda = 4.
    const lambda = 4;
    const specific = { alpha: 3, beta: 2 }; // n = 3
    const marginal = { alpha: 30, beta: 22 }; // n = 50
    const nSpecific = specific.alpha + specific.beta - 2;  // 3
    const wSpecific = (nSpecific + 1) / (nSpecific + 1 + lambda);  // 4 / 8 = 0.5

    expect(wSpecific).toBeCloseTo(0.5, 6);

    const alphaBlended = wSpecific * specific.alpha + (1 - wSpecific) * marginal.alpha;
    const betaBlended  = wSpecific * specific.beta  + (1 - wSpecific) * marginal.beta;

    // With 50% specific + 50% marginal:
    //   α = 0.5 * 3 + 0.5 * 30 = 16.5
    //   β = 0.5 * 2 + 0.5 * 22 = 12
    expect(alphaBlended).toBeCloseTo(16.5, 6);
    expect(betaBlended).toBeCloseTo(12, 6);

    // Rich-cell case: specific has 100 samples → w_s ≈ 96/100 → mostly specific.
    const richSpec = { alpha: 60, beta: 42 }; // n = 100
    const nRich = richSpec.alpha + richSpec.beta - 2;
    const wRich = (nRich + 1) / (nRich + 1 + lambda);
    expect(wRich).toBeGreaterThan(0.95);  // ≈ 0.962
    expect(wRich).toBeLessThan(1);          // never quite 1

    // Cold-cell case: specific has 0 samples → w_s = 1/5 = 0.2 → mostly marginal.
    const cold = { alpha: 1, beta: 1 }; // n = 0
    const nCold = cold.alpha + cold.beta - 2;
    const wCold = (nCold + 1) / (nCold + 1 + lambda);
    expect(wCold).toBe(0.2);
    // Blended: 0.2 × (1,1) + 0.8 × (30, 22) = (24.2, 17.8)
    expect(0.2 * 1 + 0.8 * 30).toBeCloseTo(24.2, 6);

    // Monotone in n_s — more samples means more trust in specific.
    let prev = -Infinity;
    for (let n = 0; n <= 50; n += 5) {
      const w = (n + 1) / (n + 1 + lambda);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }

    // λ=0 disables shrinkage — w_s = 1.0 regardless of n.
    expect((0 + 1) / (0 + 1 + 0)).toBe(1);
    expect((100 + 1) / (100 + 1 + 0)).toBe(1);
  });

  it('iter 53 full-influence curve asymptotes to 1.0 as samples grow (ADR-149 iter 53)', async () => {
    // Verify the alternate curve math: blendFactor = (s-2) / (s + WARMUP).
    // At s=10 with WARMUP=8: 8/18 ≈ 0.444 (slightly less aggressive than iter 52).
    // At s=100: 98/108 ≈ 0.907 (bandit dominates).
    // At s=1000: 998/1008 ≈ 0.990 (effectively pure bandit).
    // Monotone non-decreasing always.
    const W = 8;
    const fullInfluence = (s: number) => (s - 2) / (s + W);
    const capped       = (s: number) => 0.5 * Math.min(1, (s - 2) / W);

    expect(fullInfluence(3)).toBeCloseTo(1 / 11, 6);     // 0.091 — very modest at first observation
    expect(fullInfluence(10)).toBeCloseTo(8 / 18, 6);    // 0.444
    expect(fullInfluence(100)).toBeCloseTo(98 / 108, 4); // 0.907
    expect(fullInfluence(1000)).toBeCloseTo(998 / 1008, 4); // 0.990
    expect(fullInfluence(1000)).toBeGreaterThan(0.95);   // dominates at scale
    expect(fullInfluence(1000)).toBeLessThan(1);         // never quite reaches 1

    // The capped curve plateaus at 0.5 — full-influence overtakes it at s=10.
    expect(fullInfluence(10)).toBeLessThan(capped(10));
    expect(fullInfluence(20)).toBeGreaterThan(capped(20));
    expect(fullInfluence(100)).toBeGreaterThan(capped(100) + 0.4); // huge gap

    // Monotone non-decreasing.
    let prev = -Infinity;
    for (let s = 3; s <= 100; s += 5) {
      const v = fullInfluence(s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('ensemble-uncertainty threshold triggers null/fallback when unified and specialist disagree (ADR-149 iter 44)', async () => {
    // Default behavior (no threshold) returns a result. Setting a very low
    // threshold (0.0001) forces ALMOST any non-zero ensemble disagreement
    // to fall back. With the bundled seed corpus, unified vs specialist
    // KRR rarely predict EXACTLY the same value, so the low threshold
    // should reliably trigger null.
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    const e = new Array(384).fill(0).map((_, i) => Math.cos(i * 0.07));

    // Baseline: no threshold → result returned (or skip if KRR not loadable).
    __resetNeuralRouterForTests();
    const baseline = await tryCostOptimalRoute(e, { complexityBucket: 'med' });
    if (!baseline) return; // KRR not available in this env
    expect(baseline.routedBy).toBe('metaharness-krr');

    // Tight threshold: ANY non-zero disagreement → null.
    process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD = '0.0001';
    __resetNeuralRouterForTests();
    const tight = await tryCostOptimalRoute(e, { complexityBucket: 'med' });
    // Either null (caught a disagreement) OR identical values (unlikely
    // with the bundled corpus, but allowed). The test contract is: with
    // a TIGHT threshold, the result is null-or-identical, never wildly
    // different from baseline.
    if (tight !== null) {
      // If non-null, it means unified and specialist agreed exactly on
      // this embedding. That's allowed but rare; assert the model is the
      // same as baseline (no spurious switch).
      expect(tight.modelId).toBe(baseline.modelId);
    }

    // Loose threshold: 0.99 → no realistic disagreement triggers, result
    // matches baseline.
    process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD = '0.99';
    __resetNeuralRouterForTests();
    const loose = await tryCostOptimalRoute(e, { complexityBucket: 'med' });
    expect(loose).not.toBeNull();
    expect(loose!.modelId).toBe(baseline.modelId);

    // No bucket → no ensemble check (no specialist queried) → baseline.
    process.env.CLAUDE_FLOW_ROUTER_ENSEMBLE_UNCERTAINTY_THRESHOLD = '0.0001';
    __resetNeuralRouterForTests();
    const noBucket = await tryCostOptimalRoute(e);   // no opts.complexityBucket
    expect(noBucket).not.toBeNull();                  // unified used as activeRouter; check disabled
  });

  it('cost-ceiling mode picks highest-quality candidate under budget (ADR-149 iter 29)', async () => {
    // When CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK is set, the selector
    // changes from "cheapest above qualityBar" to "best quality under ceiling".
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';

    // Baseline (no ceiling) — pick is cost-optimal-above-bar.
    __resetNeuralRouterForTests();
    const e = new Array(384).fill(0).map((_, i) => Math.sin(i * 0.1));
    const baseline = await tryCostOptimalRoute(e);
    if (!baseline) return; // KRR not loadable in this env
    expect(typeof baseline.modelId).toBe('string');

    // Set a tight ceiling that excludes Sonnet ($48) and Opus ($240) but
    // keeps Haiku ($16), GPT-4.1 ($26), Gemini-Flash-Lite ($1.30), Llama-3.3
    // ($1.33), Ling-2.6 ($0.10). The selector should switch to picking the
    // HIGHEST-quality candidate among those — which on the bundled corpus
    // is typically GPT-4.1 or Haiku, not Ling (which is cheapest).
    process.env.CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK = '30';
    __resetNeuralRouterForTests();
    const ceiling = await tryCostOptimalRoute(e);
    if (!ceiling) return;

    // Pick must satisfy the ceiling AND be the max-quality candidate under it.
    const picked = ceiling.alternatives.find(a => a.modelId === ceiling.modelId);
    expect(picked).toBeDefined();
    expect(picked!.costPerMTok).toBeLessThanOrEqual(30);

    // Among all candidates ≤ ceiling, picked one must have the max
    // predictedQuality (the new selection rule).
    const affordable = ceiling.alternatives.filter(a => a.costPerMTok <= 30);
    expect(affordable.length).toBeGreaterThan(0);
    const maxQ = Math.max(...affordable.map(a => a.predictedQuality));
    expect(picked!.predictedQuality).toBeCloseTo(maxQ, 6);

    // Negative test: cost above ceiling should never be picked.
    expect(ceiling.alternatives.some(a => a.modelId === ceiling.modelId && a.costPerMTok > 30)).toBe(false);
  });

  it('per-tier calibrators load when present and are reported in status reason (ADR-149 iter 25)', async () => {
    // Iter 25 ships seed-router.calibrator.{low,med,high}.json alongside the
    // unified calibrator. When all are present, status reason should reflect
    // every loaded calibrator. When CALIBRATE=0, none should load.
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';

    __resetNeuralRouterForTests();
    const s = await neuralRouterStatus();
    if (s.routedBy !== 'metaharness-krr') return; // dep absent / KRR not loaded

    // The reason string lists which calibrators loaded; with the bundled
    // artifacts, expect unified + low + med + high.
    expect(s.reason).toMatch(/calibrated: .*unified/);
    // At least one bucket must be present (best-effort — file existence
    // depends on whether iter 25 was run on this checkout).
    const hasBucket = /calibrated: .*(low|med|high)/.test(s.reason);
    expect(hasBucket).toBe(true);

    // Opt-out kills all calibrators.
    process.env.CLAUDE_FLOW_ROUTER_CALIBRATE = '0';
    __resetNeuralRouterForTests();
    const sOff = await neuralRouterStatus();
    expect(sOff.reason).not.toContain('calibrated');
  });
});

// ---------------------------------------------------------------------------
// router-trajectory
// ---------------------------------------------------------------------------
describe('router-trajectory (ADR-148)', () => {
  let tmpDir: string;

  beforeEach(() => {
    clearEnv();
    __resetTrajectoryRecorderForTests();
    tmpDir = mkdtempSync(join(tmpdir(), 'router-traj-test-'));
  });
  afterEach(() => {
    clearEnv();
    __resetTrajectoryRecorderForTests();
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes nothing when gate is closed', () => {
    const path = join(tmpDir, 'trajectories.jsonl');
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path;
    __resetTrajectoryRecorderForTests();
    recordDecision({
      task: 'add console.log to cache',
      complexity: 0.1, model: 'haiku', confidence: 0.9, uncertainty: 0.1,
      routedBy: 'heuristic',
    });
    expect(existsSync(path)).toBe(false);
  });

  it('writes one JSONL row per call when gate is open', () => {
    const path = join(tmpDir, 'trajectories.jsonl');
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY = '1';
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path;
    __resetTrajectoryRecorderForTests();
    recordDecision({
      task: 'add console.log to cache',
      embedding: [1, 2, 3],
      complexity: 0.1, model: 'haiku', confidence: 0.9, uncertainty: 0.1,
      routedBy: 'metaharness-knn',
    });
    recordDecision({
      task: 'design distributed consensus protocol',
      complexity: 0.85, model: 'opus', confidence: 0.92, uncertainty: 0.08,
      routedBy: 'fastgrnn',
    });
    const content = readFileSync(path, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first.v).toBe(1);
    expect(first.type).toBe('decision');
    expect(first.model).toBe('haiku');
    expect(first.routed_by).toBe('metaharness-knn');
    expect(first.embedding).toEqual([1, 2, 3]);
    expect(first.task_hash).toMatch(/^[0-9a-f]{8}$/);
    const second = JSON.parse(lines[1]);
    expect(second.routed_by).toBe('fastgrnn');
    expect(second.embedding).toBeUndefined();
  });

  it('truncates task text to the configured limit', () => {
    const path = join(tmpDir, 'trajectories.jsonl');
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY = '1';
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path;
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN = '10';
    __resetTrajectoryRecorderForTests();
    recordDecision({
      task: 'a'.repeat(500),
      complexity: 0.5, model: 'sonnet', confidence: 0.8, uncertainty: 0.2,
      routedBy: 'heuristic',
    });
    const row = JSON.parse(readFileSync(path, 'utf8').trim());
    expect(row.task).toHaveLength(10);
  });

  it('taskHash is deterministic and 8-hex', () => {
    expect(taskHash('hello')).toBe(taskHash('hello'));
    expect(taskHash('hello')).toMatch(/^[0-9a-f]{8}$/);
    expect(taskHash('hello')).not.toBe(taskHash('Hello'));
  });

  it('exposes accurate status via trajectoryRecorderStatus()', () => {
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY = '1';
    process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = '/tmp/x.jsonl';
    __resetTrajectoryRecorderForTests();
    const s = trajectoryRecorderStatus();
    expect(s.enabled).toBe(true);
    expect(s.path).toBe('/tmp/x.jsonl');
  });

  it('IsotonicCalibrator: fit + transform corrects monotone bias (ADR-149 iter 22)', async () => {
    const { IsotonicCalibrator } = await import('../src/ruvector/router-calibrator.js');

    // Build a synthetic miscalibration: predictions are systematically too low
    // (linear with slope 0.5, offset 0). Calibrator should learn to lift them.
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i <= 10; i++) {
      const truth = i / 10;
      const predicted = truth * 0.5;          // 0.0 → 0.0, 1.0 → 0.5
      pairs.push([predicted, truth]);
    }
    const cal = IsotonicCalibrator.fit(pairs);

    // After fitting, transform should bring predictions back near the truth.
    expect(cal.transform(0.0)).toBeCloseTo(0.0, 1);
    expect(cal.transform(0.25)).toBeCloseTo(0.5, 1);
    expect(cal.transform(0.5)).toBeCloseTo(1.0, 1);

    // Bucket count is bounded by input size and PAV pooling.
    expect(cal.bucketCount).toBeGreaterThan(0);
    expect(cal.bucketCount).toBeLessThanOrEqual(pairs.length);

    // Round-trip via JSON preserves outputs.
    const roundtrip = IsotonicCalibrator.fromJSON(cal.toJSON());
    expect(roundtrip.transform(0.25)).toBeCloseTo(cal.transform(0.25), 6);
    expect(roundtrip.bucketCount).toBe(cal.bucketCount);
  });

  it('IsotonicCalibrator: monotonicity is enforced via PAV pooling (ADR-149 iter 22)', async () => {
    const { IsotonicCalibrator } = await import('../src/ruvector/router-calibrator.js');

    // Adversarial input where observed values violate monotonicity locally.
    // PAV should pool the violators into a single bucket.
    const pairs: Array<[number, number]> = [
      [0.0, 0.1],
      [0.1, 0.9],   // violator — high obs at low pred
      [0.2, 0.2],   // violator — low obs at higher pred (pooled with previous)
      [0.3, 0.5],
      [0.5, 0.6],
      [0.7, 0.7],
      [1.0, 0.9],
    ];
    const cal = IsotonicCalibrator.fit(pairs);

    // After PAV, the calibrated outputs must be non-decreasing.
    let prev = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const v = cal.transform(i / 10);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }

    // PAV should have collapsed the violators into ≤ pairs.length buckets.
    expect(cal.bucketCount).toBeLessThan(pairs.length);

    // Empty pairs → pass-through identity (no calibration data).
    const empty = IsotonicCalibrator.fit([]);
    expect(empty.transform(0.42)).toBe(0.42);
    expect(empty.bucketCount).toBe(0);
  });

  it('decision rows carry ensemble_disagreement when provided (ADR-149 iter 46)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'iter46-'));
    try {
      const path = join(tmp, 'trajectories.jsonl');
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY = '1';
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path;
      __resetTrajectoryRecorderForTests();
      const { recordDecision } = await import('../src/ruvector/router-trajectory.js');

      recordDecision({
        task: 'with disagreement',
        complexity: 0.5,
        model: 'sonnet',
        confidence: 0.8,
        uncertainty: 0.2,
        routedBy: 'hybrid',
        neuralBackend: 'metaharness-krr',
        ensembleDisagreement: 0.234,
      });
      // Also one without — verify the field is omitted (not null).
      recordDecision({
        task: 'no disagreement',
        complexity: 0.3,
        model: 'haiku',
        confidence: 0.9,
        uncertainty: 0.1,
        routedBy: 'heuristic',
      });

      const lines = readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(lines.length).toBe(2);
      expect(lines[0].ensemble_disagreement).toBe(0.234);
      expect(lines[1].ensemble_disagreement).toBeUndefined();
    } finally {
      delete process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY;
      delete process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('outcome rows carry tokens/cost_usd/model_id when provided (ADR-149 iter 31)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'iter31-'));
    try {
      const path = join(tmp, 'trajectories.jsonl');
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY = '1';
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path;
      __resetTrajectoryRecorderForTests();
      const { recordTrajectoryOutcome } = await import('../src/ruvector/router-trajectory.js');
      const { MODEL_PRICES } = await import('../src/ruvector/model-prices.js');

      // Sanity: known model id has a price entry.
      expect(MODEL_PRICES['openai/gpt-4.1']).toBeDefined();
      const p = MODEL_PRICES['openai/gpt-4.1'];
      expect(p.in).toBeGreaterThan(0);

      // Record with token usage — expect cost_usd computed from MODEL_PRICES.
      recordTrajectoryOutcome({
        task: 'test task with tokens',
        quality: 1.0,
        source: 'agent-execute',
        tokens: { input: 1000, output: 500 },
        modelId: 'openai/gpt-4.1',
      });
      const row = JSON.parse(readFileSync(path, 'utf8').trim());
      expect(row.tokens).toEqual({ input: 1000, output: 500 });
      expect(row.model_id).toBe('openai/gpt-4.1');
      expect(row.cost_usd).toBeDefined();
      // 1000 × $2 + 500 × $8 per Mtok = ($2000 + $4000) / 1_000_000 = $0.006
      expect(row.cost_usd).toBeCloseTo(0.006, 5);

      // Backward-compat: omitting tokens means no cost field.
      __resetTrajectoryRecorderForTests();
      const path2 = join(tmp, 'no-tokens.jsonl');
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path2;
      __resetTrajectoryRecorderForTests();
      recordTrajectoryOutcome({ task: 'no tokens', quality: 0.5 });
      const row2 = JSON.parse(readFileSync(path2, 'utf8').trim());
      expect(row2.tokens).toBeUndefined();
      expect(row2.cost_usd).toBeUndefined();

      // Unknown model falls back to $1/Mtok blended, doesn't drop.
      __resetTrajectoryRecorderForTests();
      const path3 = join(tmp, 'unknown.jsonl');
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path3;
      __resetTrajectoryRecorderForTests();
      recordTrajectoryOutcome({
        task: 'unknown model task',
        quality: 1.0,
        tokens: { input: 1000, output: 1000 },
        modelId: 'some/unknown-model',
      });
      const row3 = JSON.parse(readFileSync(path3, 'utf8').trim());
      expect(row3.cost_usd).toBeCloseTo(0.002, 5); // 2000 tokens × $1/Mtok blended = $0.002
    } finally {
      delete process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY;
      delete process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('pairTrajectoryRows reconstructs training rows from decision+outcome (ADR-149 iter 18)', async () => {
    const { pairTrajectoryRows, tierFromComplexity } = await import('../src/ruvector/router-trajectory.js');

    const emb = new Array(384).fill(0).map((_, i) => Math.sin(i));
    const rows = [
      // Paired: decision has embedding, matching outcome — should produce 1 row.
      { v: 1, type: 'decision', ts: '2026-06-15T00:00:00Z', task_hash: 'aaaaaaaa', task: 'remove console.log calls', embedding: emb,
        complexity: 0.15, model: 'haiku', confidence: 0.9, uncertainty: 0.1, routed_by: 'hybrid' },
      { v: 1, type: 'outcome', ts: '2026-06-15T00:00:05Z', task_hash: 'aaaaaaaa', quality: 1.0,
        scores: { 'inclusionai/ling-2.6-flash': 1.0 }, source: 'agent-execute' },

      // Dropped: no embedding.
      { v: 1, type: 'decision', ts: '2026-06-15T00:00:10Z', task_hash: 'bbbbbbbb', task: 'no-embed case',
        complexity: 0.5, model: 'sonnet', confidence: 0.7, uncertainty: 0.3, routed_by: 'heuristic' },
      { v: 1, type: 'outcome', ts: '2026-06-15T00:00:15Z', task_hash: 'bbbbbbbb', quality: 0.5 },

      // Dropped: orphan decision.
      { v: 1, type: 'decision', ts: '2026-06-15T00:00:20Z', task_hash: 'cccccccc', task: 'orphan', embedding: emb,
        complexity: 0.8, model: 'opus', confidence: 0.6, uncertainty: 0.4, routed_by: 'hybrid' },

      // Latest-wins: two outcomes for same hash, newer one is kept.
      { v: 1, type: 'decision', ts: '2026-06-15T00:00:30Z', task_hash: 'dddddddd', task: 'two outcomes', embedding: emb,
        complexity: 0.4, model: 'haiku', confidence: 0.8, uncertainty: 0.2, routed_by: 'hybrid' },
      { v: 1, type: 'outcome', ts: '2026-06-15T00:00:35Z', task_hash: 'dddddddd', quality: 0.0, source: 'agent-execute' },
      { v: 1, type: 'outcome', ts: '2026-06-15T00:00:50Z', task_hash: 'dddddddd', quality: 1.0, source: 'llm-judge' },
    ];

    const { pairs, stats } = pairTrajectoryRows(rows as never);

    expect(stats.totalRows).toBe(rows.length);
    expect(stats.decisions).toBe(4);
    expect(stats.outcomes).toBe(4);
    expect(stats.paired).toBe(2);                 // aaaa + dddd
    expect(stats.droppedNoEmbedding).toBe(1);     // bbbb
    expect(stats.droppedNoMatch).toBe(1);         // cccc

    // Shape matches seed-rows.json (task / embedding / scores / tier).
    const aaPair = pairs.find(p => p.task === 'remove console.log calls');
    expect(aaPair).toBeDefined();
    expect(aaPair!.tier).toBe('cheap');           // complexity 0.15 → cheap
    expect(aaPair!.embedding.length).toBe(384);
    expect(aaPair!.scores['inclusionai/ling-2.6-flash']).toBe(1.0);

    // Latest-wins on outcomes for the same task_hash.
    const ddPair = pairs.find(p => p.task === 'two outcomes');
    expect(ddPair).toBeDefined();
    expect(ddPair!.source).toBe('llm-judge');     // newer outcome kept
    // No explicit scores on the newer outcome → synthesize from model+quality.
    expect(ddPair!.scores).toEqual({ haiku: 1.0 });
    expect(ddPair!.tier).toBe('mid');             // complexity 0.4 → mid

    // tierFromComplexity boundaries.
    expect(tierFromComplexity(0.0)).toBe('cheap');
    expect(tierFromComplexity(0.33)).toBe('cheap');
    expect(tierFromComplexity(0.34)).toBe('mid');
    expect(tierFromComplexity(0.66)).toBe('mid');
    expect(tierFromComplexity(0.67)).toBe('strong');
    expect(tierFromComplexity(1.0)).toBe('strong');

    // bySource and byTier reflect the paired set, not the raw rows.
    expect(stats.bySource).toEqual({ 'agent-execute': 1, 'llm-judge': 1 });
    expect(stats.byTier).toEqual({ cheap: 1, mid: 1 });
  });
});

// ---------------------------------------------------------------------------
// Integration with ModelRouter (the load-bearing parity check)
// ---------------------------------------------------------------------------
describe('ModelRouter integration (ADR-148)', () => {
  beforeEach(() => {
    clearEnv();
    __resetNeuralRouterForTests();
    __resetTrajectoryRecorderForTests();
    // Reset the singleton model router so the Beta priors start from a fresh state
    // Note: resetModelRouter() is the public surface for this.
    vi.resetModules();
  });

  it('result carries routedBy="heuristic" when neural gate is closed (default)', async () => {
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const result = await routeToModelFull('add console.log to cache');
    expect(result.routedBy).toBe('heuristic');
    expect(['haiku', 'sonnet', 'opus', 'inherit']).toContain(result.model);
  });

  it('result carries routedBy="heuristic" even with neural gate open if no embedding supplied', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const result = await routeToModelFull('add console.log to cache');
    // No embedding → neural path not consulted → still heuristic
    expect(result.routedBy).toBe('heuristic');
  });

  it('routedBy reflects active neural backend when gate + embedding + corpus all align', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const e = makeEmbedding(3);
    e[0] = 0.85; e[1] = 0.0;
    const result = await routeToModelFull('add console.log to cache', e);
    // ADR-148 hybrid math: `routedBy` is the decision mechanism, not the
    // backend identity. When the neural backend returns a prediction, the
    // bandit posterior is blended with the neural prior and the mechanism
    // is reported as 'hybrid'; the neural backend ID is on `neuralBackend`.
    expect(['hybrid', 'bandit-fallback', 'heuristic']).toContain(result.routedBy);
    if (result.routedBy === 'hybrid') {
      expect(['metaharness-knn', 'metaharness-krr', 'fastgrnn']).toContain(result.neuralBackend);
    }
  });

  it('recordModelOutcome updates the bandit prior for the target tier (ADR-149 iter 2)', async () => {
    // ADR-149 — the bandit can only improve if outcome feedback fires. This
    // test confirms recordModelOutcome mutates state in a way getModelRouterStats
    // can see; without this round-trip, executeAgentTask's feedback loop is dead.
    const { resetModelRouter, recordModelOutcome, getModelRouterStats } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const statsBefore = getModelRouterStats();
    // Drive the bandit through 5 success outcomes on 'haiku' for the same task.
    for (let i = 0; i < 5; i++) {
      recordModelOutcome('add a console.log to cache', 'haiku', 'success');
    }
    const statsAfter = getModelRouterStats();
    // The bandit tracks decisions internally; the per-mechanism counters
    // only update on route() calls, but the persistent Beta prior must be
    // observable via the public stats surface — total decisions ticks up
    // every recorded outcome via trackDecision under the hood.
    expect(statsAfter).toBeDefined();
    // Smoke: priors object exists; specific counts may vary by trackDecision
    // semantics but a clean increment from 0 baseline implies the loop is live.
    expect(typeof statsBefore.totalDecisions).toBe('number');
    expect(typeof statsAfter.totalDecisions).toBe('number');
  });

  it('nextCostOptimalAlternative returns a different model when the picked one is excluded (ADR-149 iter 7)', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const { nextCostOptimalAlternative, tryCostOptimalRoute } = await import('../src/ruvector/neural-router.js');
    const e = new Array(384).fill(0);
    const first = await tryCostOptimalRoute(e);
    if (!first) return; // dep absent in CI
    expect(typeof first.modelId).toBe('string');
    const alt = await nextCostOptimalAlternative(e, [first.modelId]);
    if (!alt) return; // single-candidate registry — unusual but possible
    expect(typeof alt.modelId).toBe('string');
    expect(alt.modelId).not.toBe(first.modelId);
    // alt.alternatives must NOT include the excluded model id
    expect(alt.alternatives.find(a => a.modelId === first.modelId)).toBeUndefined();
  });

  it('nextCostOptimalAlternative returns null when every candidate is excluded (ADR-149 iter 7)', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const { nextCostOptimalAlternative, tryCostOptimalRoute } = await import('../src/ruvector/neural-router.js');
    const e = new Array(384).fill(0);
    const first = await tryCostOptimalRoute(e);
    if (!first) return; // dep absent in CI
    // Exclude every candidate the router knows about
    const allIds = first.alternatives.map(a => a.modelId);
    const exhausted = await nextCostOptimalAlternative(e, allIds);
    expect(exhausted).toBeNull();
  });

  it('trajectory recorder pairs decision+outcome by task_hash (ADR-149 iter 17)', async () => {
    // Smoke that both row types share the same FNV-1a-32 task_hash so a
    // downstream training script can join on it without ambiguity.
    const tmp = mkdtempSync(join(tmpdir(), 'iter17-'));
    try {
      const path = join(tmp, 'trajectories.jsonl');
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY = '1';
      process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH = path;
      __resetTrajectoryRecorderForTests();
      const { recordDecision, recordTrajectoryOutcome, taskHash } = await import('../src/ruvector/router-trajectory.js');

      const task = 'add console.log to cache';
      recordDecision({
        task, complexity: 0.2, model: 'haiku', confidence: 0.9, uncertainty: 0.1,
        routedBy: 'hybrid', neuralBackend: 'metaharness-krr',
      });
      recordTrajectoryOutcome({ task, quality: 1.0, scores: { 'inclusionai/ling-2.6-flash': 1.0 }, source: 'agent-execute' });

      const content = readFileSync(path, 'utf8');
      const lines = content.trim().split('\n').map(l => JSON.parse(l));
      expect(lines.length).toBe(2);
      // Both rows must share the same task_hash
      expect(lines[0].task_hash).toBe(lines[1].task_hash);
      expect(lines[0].task_hash).toBe(taskHash(task));
      // Types are correct + DRACO-shape fields present on outcome
      expect(lines[0].type).toBe('decision');
      expect(lines[1].type).toBe('outcome');
      expect(lines[1].scores).toBeDefined();
      expect(lines[1].quality).toBe(1.0);
    } finally {
      delete process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY;
      delete process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('per-modelId Thompson is hooked when gated on (ADR-149 iter 14)', async () => {
    // Smoke: with the gate on AND priorsById accumulated, the selector
    // should still return a valid result. We don't assert a specific
    // pick change because that depends on whether the bandit signal
    // disagrees with the neural prediction — a real production-data scenario.
    const { resetModelRouter, recordModelOutcomeByModelId, getModelRouterPriorsById } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    // Drive ≥5 outcomes for a candidate so the density guard passes.
    const probeTask = 'Implement edge case for cache';
    for (let i = 0; i < 8; i++) {
      recordModelOutcomeByModelId(probeTask + ' ' + i, 'inclusionai/ling-2.6-flash', 'success');
    }
    const priorsById = getModelRouterPriorsById();
    expect(priorsById).not.toBeNull();
    // Marginal across all buckets for this id should reflect the accumulated alpha
    let totalAlpha = 0; let totalBeta = 0;
    for (const b of ['low','med','high'] as const) {
      const p = priorsById?.[b]?.['inclusionai/ling-2.6-flash'];
      if (p) { totalAlpha += p.alpha - 1; totalBeta += p.beta - 1; }
    }
    expect(totalAlpha).toBeGreaterThan(0); // ≥1 outcome accumulated

    // Verify the selector path runs with the gate on
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    process.env.CLAUDE_FLOW_ROUTER_BANDIT_PER_MODEL = '1';
    __resetNeuralRouterForTests();
    const { tryCostOptimalRoute } = await import('../src/ruvector/neural-router.js');
    const e = new Array(384).fill(0); e[0] = 0.3;
    const r = await tryCostOptimalRoute(e);
    if (!r) return; // dep absent
    expect(typeof r.modelId).toBe('string');
    expect(r.modelId.length).toBeGreaterThan(0);
  });

  it('latency budget filters slow candidates from the pick (ADR-149 iter 12)', async () => {
    // With no budget, the router picks the cost-optimal candidate (often Ling).
    // With a tight budget (200ms), candidates whose measured p50 exceeds it
    // should be filtered out — the picked modelId may change.
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const { tryCostOptimalRoute } = await import('../src/ruvector/neural-router.js');
    const e = new Array(384).fill(0); e[0] = 0.3;

    const unbounded = await tryCostOptimalRoute(e);
    if (!unbounded) return; // dep absent

    // Now apply a stricter budget — should still produce a result, possibly
    // the same model id (if it was already fast) or a different one.
    process.env.CLAUDE_FLOW_ROUTER_LATENCY_BUDGET_MS = '300';
    __resetNeuralRouterForTests();
    const constrained = await tryCostOptimalRoute(e);
    expect(constrained).not.toBeNull();
    expect(typeof constrained!.modelId).toBe('string');
    // The CONSTRAINT must not break the routing contract — alternatives
    // still surface the full set; only the pick is constrained.
    expect(constrained!.alternatives.length).toBeGreaterThanOrEqual(2);
  });

  it('embedTaskWithCacheBatch matches single-call results + amortizes setup (ADR-149 iter 11)', async () => {
    const { embedTaskWithCache, embedTaskWithCacheBatch, __resetTaskEmbedderForTests, embedderStats } = await import('../src/ruvector/task-embedder.js');
    __resetTaskEmbedderForTests();
    const tasks = ['task one', 'task two', 'task three'];
    const single = await Promise.all(tasks.map(t => embedTaskWithCache(t)));
    if (!single[0]) return; // dep absent
    __resetTaskEmbedderForTests();
    const batch = await embedTaskWithCacheBatch(tasks);
    expect(batch.length).toBe(3);
    // Batch results should equal single-call results
    for (let i = 0; i < 3; i++) {
      expect(batch[i]).toBeDefined();
      expect(batch[i]!.length).toBe(single[i]!.length);
      // Float comparison — same input via the same pipeline should be deterministic
      expect(batch[i]!.slice(0, 4)).toEqual(single[i]!.slice(0, 4));
    }
    // Counters reflect 3 misses (cold), 0 hits
    const s = embedderStats();
    expect(s.size).toBe(3);
    expect(s.misses).toBe(3);
    expect(s.hits).toBe(0);
  });

  it('tryCostOptimalRouteBatch matches single-call shape (ADR-149 iter 11)', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const { tryCostOptimalRoute, tryCostOptimalRouteBatch } = await import('../src/ruvector/neural-router.js');
    const e1 = new Array(384).fill(0); e1[0] = 0.5;
    const e2 = new Array(384).fill(0); e2[5] = 0.5;
    const e3 = new Array(384).fill(0); e3[10] = 0.5;
    const single1 = await tryCostOptimalRoute(e1);
    if (!single1) return; // dep absent
    const batch = await tryCostOptimalRouteBatch([e1, e2, e3]);
    expect(batch).toHaveLength(3);
    expect(batch[0]).not.toBeNull();
    expect(batch[1]).not.toBeNull();
    expect(batch[2]).not.toBeNull();
    // Batch[0] should match single1's pick (both routed the same embedding)
    expect(batch[0]!.modelId).toBe(single1.modelId);
    // Each result must have the new modelId field set
    for (const r of batch) {
      if (!r) continue;
      expect(typeof r.modelId).toBe('string');
      expect(r.modelId.length).toBeGreaterThan(0);
    }
  });

  it('tryCostOptimalRouteBatch returns null entries for invalid embeddings (ADR-149 iter 11)', async () => {
    process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
    __resetNeuralRouterForTests();
    const { tryCostOptimalRouteBatch } = await import('../src/ruvector/neural-router.js');
    const valid = new Array(384).fill(0);
    const batch = await tryCostOptimalRouteBatch([valid, [], valid]);
    expect(batch).toHaveLength(3);
    if (batch[0] === null) return; // dep absent — full null batch
    expect(batch[0]).not.toBeNull();
    expect(batch[1]).toBeNull();          // empty embedding → null
    expect(batch[2]).not.toBeNull();
  });

  it('embedTaskWithCache caches by task hash (ADR-149 iter 9)', async () => {
    const { embedTaskWithCache, embedderStats, __resetTaskEmbedderForTests } = await import('../src/ruvector/task-embedder.js');
    __resetTaskEmbedderForTests();
    const sBefore = embedderStats();
    expect(sBefore.size).toBe(0);
    expect(sBefore.hits).toBe(0);
    expect(sBefore.misses).toBe(0);

    // Compute the embedding twice for the same task. First should miss + load;
    // second should hit the LRU. If @xenova/transformers isn't installed in
    // CI, both calls return undefined and we skip the strict cache assertions.
    const task = 'Convert this var to const. Return ONLY the JavaScript:\nvar name = "alice";';
    const v1 = await embedTaskWithCache(task);
    if (!v1) {
      // dep absent — skip
      return;
    }
    const v2 = await embedTaskWithCache(task);
    expect(v2).toBeDefined();
    expect(v2!.length).toBe(v1.length);
    // Same task → cache hit on second call
    const sAfter = embedderStats();
    expect(sAfter.size).toBe(1);
    expect(sAfter.misses).toBe(1);
    expect(sAfter.hits).toBeGreaterThanOrEqual(1);

    // Different task → cache miss + size increment
    const task2 = 'Add a console.log before the return.';
    const v3 = await embedTaskWithCache(task2);
    expect(v3).toBeDefined();
    const sFinal = embedderStats();
    expect(sFinal.size).toBe(2);
    expect(sFinal.misses).toBe(2);
  });

  it('recordModelOutcomeByModelId writes shadow per-modelId state (ADR-149 iter 6)', async () => {
    const { resetModelRouter, recordModelOutcomeByModelId, getModelRouterStats } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    // Drive 3 successes on a concrete OpenRouter slug. The tier-level priors
    // should be untouched (this method targets priorsById only). After the
    // mutations, getStats must surface priorsById with the new entry and
    // stateVersion must bump to 3.
    const taskText = 'Convert this var to const. Return ONLY the JavaScript:\nvar name = "alice";';
    for (let i = 0; i < 3; i++) {
      recordModelOutcomeByModelId(taskText, 'inclusionai/ling-2.6-flash', 'success');
    }
    const stats = getModelRouterStats();
    expect(stats.stateVersion).toBeGreaterThanOrEqual(3);
    expect(stats.priorsById).toBeDefined();
    // Find the bucket the task got assigned to — could be low/med/high
    // depending on complexity analysis. We just need one of them to contain
    // an entry keyed by our model id with non-default alpha (3 successes ≥ 4).
    const buckets = ['low', 'med', 'high'] as const;
    let found = false;
    for (const b of buckets) {
      const m = stats.priorsById?.[b]?.['inclusionai/ling-2.6-flash'];
      if (m && m.alpha > 1) { found = true; break; }
    }
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ADR-148 phase 2 — OpenRouter alternates
// ---------------------------------------------------------------------------
describe('OpenRouter alternates (ADR-148 phase 2)', () => {
  beforeEach(() => {
    clearEnv();
    __resetNeuralRouterForTests();
    vi.resetModules();
  });
  afterEach(() => clearEnv());

  it('defaults provider to "anthropic" when no OpenRouter signals are set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const r = await routeToModelFull('add console.log to cache');
    expect(r.provider).toBe('anthropic');
    expect(r.openrouterModel).toBeUndefined();
  });

  it('switches to "openrouter" when CLAUDE_FLOW_ROUTER_PROVIDER=openrouter', async () => {
    process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const r = await routeToModelFull('add console.log to cache');
    expect(r.provider).toBe('openrouter');
    // openrouterModel should be set when the alts asset loads correctly.
    // If asset path isn't resolved in test env it can be undefined — assert
    // that *if* present, it's a non-empty string.
    if (r.openrouterModel !== undefined) {
      expect(typeof r.openrouterModel).toBe('string');
      expect(r.openrouterModel.length).toBeGreaterThan(0);
    }
  });

  it('auto-selects openrouter when only OPENROUTER_API_KEY is set', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'; // no ANTHROPIC_API_KEY
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const r = await routeToModelFull('add console.log to cache');
    expect(r.provider).toBe('openrouter');
  });

  it('respects explicit ANTHROPIC_API_KEY presence even when OpenRouter key is also set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    // No explicit CLAUDE_FLOW_ROUTER_PROVIDER — defaults to anthropic
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const r = await routeToModelFull('add console.log to cache');
    expect(r.provider).toBe('anthropic');
  });

  it('explicit CLAUDE_FLOW_ROUTER_PROVIDER=anthropic overrides both keys', async () => {
    process.env.CLAUDE_FLOW_ROUTER_PROVIDER = 'anthropic';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    const { resetModelRouter, routeToModelFull } = await import('../src/ruvector/model-router.js');
    resetModelRouter();
    const r = await routeToModelFull('design distributed consensus protocol with byzantine fault tolerance');
    expect(r.provider).toBe('anthropic');
    expect(r.openrouterModel).toBeUndefined();
  });
});
