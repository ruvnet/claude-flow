/**
 * Stateful flywheel — close the autonomy loop (ADR-176 A-P3b).
 *
 * The milestone was demonstrated by a one-shot script. This makes it the daemon's
 * ACTUAL behavior: each tick runs ONE generation, reads the persisted lineage to
 * find the current champion, uses it as the baseline, and — on a verified
 * promotion — advances the champion so the NEXT tick compounds on it. Winners
 * accumulate into a persisted, replayable lineage instead of being rediscovered.
 *
 * Same honest gate as the milestone run: a large frozen self-supervised held-out
 * (significance achievable), the human anchor as a no-regression guard, a
 * SEPARATE canary slice, and constrained (Pareto) multi-axis selection.
 *
 * Shadow-first / no auto-serve: a promoted champion is registered but NOT served;
 * it is applied to the active policy only at the START of a LATER tick, once it
 * has been the operating baseline for a full generation (a 1-tick shadow delay).
 *
 * Pure-ish + $0: deps (store patterns + search) are injected → testable without
 * ONNX. Never throws.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  runRealEvolveRound, reconstructLineage, detectPlateau, mutationEffectiveness,
  type EvolveReceiptBundle, type LineageTelemetry, type PlateauReport, type MutationStat,
} from './evolve-proof.js';
import { harvestSelfSupervisedTasks, type HarvestPattern } from './harness-corpus-harvester.js';
import { applyChampionParams, rollbackActivePolicy } from '../config/harness-feedback-applier.js';
import { DEFAULT_CONFIG, type RetrievalConfig, type RankedItem } from './harness-flywheel.js';

export const FLYWHEEL_DIR = ['.claude-flow', 'flywheel'];
export const FROZEN_CORPUS = 'harvested-selfsup-frozen-v1';
const SERVED_FILE = 'served.json';
const ATTEMPTS_FILE = 'attempts.jsonl';
const ANCHOR_TOL = 0.02;
const CANARY_CATASTROPHE = 0.5;

export interface AnchorTask { id: string; q: string; labels: string[]; }
export interface GenerationDeps {
  getPatterns: () => HarvestPattern[] | Promise<HarvestPattern[]>;
  search: (q: string, cfg: RetrievalConfig) => Promise<RankedItem[]> | RankedItem[];
  anchorTasks: AnchorTask[];
  sample?: number;
  now: number;
  applyFn?: (cfg: Record<string, number>, hash: string, generation: number) => void;
}

export interface GenerationResult {
  ran: boolean;
  reason: string;
  generation: number;
  promoted?: boolean;
  delta?: number;
  significant?: boolean;
  championConfig?: Record<string, number>;
  servedChampion?: string | null;
  anchorRegressed?: boolean;
}

// ── Lineage store ─────────────────────────────────────────────────────────────
function dir(root: string): string { return path.join(root, ...FLYWHEEL_DIR); }
function readJson<T>(p: string): T | null { try { return JSON.parse(fs.readFileSync(p, 'utf-8')) as T; } catch { return null; } }

/** Promotions only — the champion chain (generation-N.json), sorted by generation. */
export function loadPromotions(root: string): EvolveReceiptBundle[] {
  try {
    const d = dir(root);
    return fs.readdirSync(d).filter((f) => /^generation-\d+\.json$/.test(f))
      .map((f) => readJson<EvolveReceiptBundle>(path.join(d, f))).filter((b): b is EvolveReceiptBundle => !!b)
      .sort((a, b) => a.generation - b.generation);
  } catch { return []; }
}
/** Every attempt (promoted + rejected) — for telemetry + mutation-effectiveness. */
export function loadAttempts(root: string): EvolveReceiptBundle[] {
  try {
    return fs.readFileSync(path.join(dir(root), ATTEMPTS_FILE), 'utf-8').split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as EvolveReceiptBundle);
  } catch { return []; }
}
function appendAttempt(root: string, b: EvolveReceiptBundle): void {
  try { fs.mkdirSync(dir(root), { recursive: true }); fs.appendFileSync(path.join(dir(root), ATTEMPTS_FILE), JSON.stringify(b) + '\n', 'utf-8'); } catch { /* */ }
}
function appendPromotion(root: string, b: EvolveReceiptBundle): void {
  try { fs.mkdirSync(dir(root), { recursive: true }); fs.writeFileSync(path.join(dir(root), `generation-${b.generation}.json`), JSON.stringify(b, null, 2) + '\n', 'utf-8'); } catch { /* */ }
}

/** The current operating champion (last promotion's config), or defaults. */
export function currentChampion(root: string): { config: Record<string, number>; hash: string | null; generation: number } {
  const p = loadPromotions(root);
  if (!p.length) return { config: { ...DEFAULT_CONFIG }, hash: null, generation: 0 };
  const last = p[p.length - 1];
  return { config: (last.candidateManifest.policy.value ?? { ...DEFAULT_CONFIG }) as Record<string, number>, hash: last.candidateManifestHash, generation: p.length };
}

export interface ServedState { championHash: string | null; config: Record<string, number> | null; servedAt: number | null; fromGeneration: number | null; }
export function servedChampion(root: string): ServedState {
  return readJson<ServedState>(path.join(dir(root), SERVED_FILE)) ?? { championHash: null, config: null, servedAt: null, fromGeneration: null };
}

/**
 * Shadow→serve gate: apply the latest promoted champion to the ACTIVE policy iff
 * it is newer than what is currently served. Called at tick START, so a champion
 * promoted last tick is served this tick (a 1-generation shadow delay) — never
 * auto-served the instant it is promoted.
 */
export function serveCurrentChampionIfPending(root: string, now: number, applyFn?: GenerationDeps['applyFn']): string | null {
  const champ = currentChampion(root);
  if (!champ.hash) return null;
  const served = servedChampion(root);
  if (served.championHash === champ.hash) return served.championHash;
  const apply = applyFn ?? ((cfg, hash) => applyChampionParams(root, { championId: hash, params: cfg, layer: 'repo/local', previous: served.championHash, now }));
  try { apply(champ.config, champ.hash, champ.generation - 1); } catch { /* */ }
  try { fs.mkdirSync(dir(root), { recursive: true }); fs.writeFileSync(path.join(dir(root), SERVED_FILE), JSON.stringify({ championHash: champ.hash, config: champ.config, servedAt: now, fromGeneration: champ.generation - 1 }, null, 2), 'utf-8'); } catch { /* */ }
  return champ.hash;
}

// ── Grading + candidate generation ────────────────────────────────────────────
const key = (c: RetrievalConfig) => `a${c.alpha}_sw${c.subjectWeight}_mmr${c.mmrLambda}_bw${c.bodyWeight}_tp${c.typePenaltyFactor}`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function ndcg3(names: string[], labels: string[]): number {
  const rel = names.slice(0, 3).map((n) => !!n && labels.some((s) => n.toLowerCase().includes(s.toLowerCase())));
  const dcg = rel.reduce((a, r, i) => a + (r ? 1 / Math.log2(i + 2) : 0), 0);
  const num = rel.filter(Boolean).length; if (!num) return 0;
  let idcg = 0; for (let i = 0; i < num; i++) idcg += 1 / Math.log2(i + 2);
  return dcg / idcg;
}
const rr = (items: RankedItem[], targetId: string) => { const i = items.findIndex((x) => x.id === targetId); return i >= 0 ? 1 / (i + 1) : 0; };

function coarseGrid(): RetrievalConfig[] {
  const g: RetrievalConfig[] = [];
  for (const alpha of [0.3, 0.5, 0.7]) for (const subjectWeight of [1, 2, 3])
    for (const mmrLambda of [0.5, 0.7, 0.9]) for (const bodyWeight of [1, 1.5]) for (const typePenaltyFactor of [1, 0.5])
      g.push({ alpha, subjectWeight, mmrLambda, bodyWeight, typePenaltyFactor });
  return g;
}
// ── Evidence-grounded meta-learning: bias the search by axis payoff ───────────
const AXES: (keyof RetrievalConfig)[] = ['alpha', 'subjectWeight', 'mmrLambda', 'bodyWeight', 'typePenaltyFactor'];
const STEP: Record<keyof RetrievalConfig, number> = { alpha: 0.1, subjectWeight: 0.5, mmrLambda: 0.1, bodyWeight: 0.5, typePenaltyFactor: 0.25 };
function clampAxis(a: keyof RetrievalConfig, v: number): number | null {
  const r = +v.toFixed(3);
  if (a === 'alpha') return r > 0 && r < 1 ? r : null;
  if (a === 'mmrLambda') return r >= 0 && r <= 1 ? r : null;
  return r > 0 ? r : null;
}

export interface AxisStat { axis: string; promotions: number; meanDelta: number; }
/**
 * Which policy AXES have historically paid off — attribute each promotion's
 * held-out Δ to the axes that changed in it. Turns the lineage into a
 * knowledge base the optimizer can act on (not just audit).
 */
export function axisEffectiveness(promotions: EvolveReceiptBundle[]): AxisStat[] {
  const by = new Map<string, number[]>();
  for (const b of promotions) {
    const base = (b.baselineManifest.policy.value ?? {}) as Record<string, number>;
    const cand = (b.candidateManifest.policy.value ?? {}) as Record<string, number>;
    for (const a of AXES) if (base[a] !== cand[a]) { const d = by.get(a) ?? []; d.push(b.deltas.benchmark); by.set(a, d); }
  }
  return AXES.map((a) => ({ axis: a, promotions: (by.get(a) ?? []).length, meanDelta: mean(by.get(a) ?? []) }))
    .sort((x, y) => y.meanDelta - x.meanDelta);
}

/**
 * Candidate set biased by measured axis payoff (meta-learning). Every axis keeps
 * a ±1 exploration floor (never abandon a dimension), but axes with a positive
 * historical Δ get EXPANDED range (±2, ±3) and PAIRWISE joint moves with other
 * productive axes — so compute concentrates on the dimensions that have actually
 * produced gains, instead of a uniform grid. Deterministic; bounded.
 */
export function biasedGrid(c: RetrievalConfig, ranking: AxisStat[]): RetrievalConfig[] {
  const productive = ranking.filter((r) => r.meanDelta > 1e-9).map((r) => r.axis as keyof RetrievalConfig);
  const out: RetrievalConfig[] = [], seen = new Set<string>();
  const add = (cfg: RetrievalConfig) => { const k = key(cfg); if (!seen.has(k)) { seen.add(k); out.push(cfg); } };
  // exploration floor — single-axis ±1 for every axis
  for (const a of AXES) for (const dir of [-1, 1]) { const v = clampAxis(a, c[a] + dir * STEP[a]); if (v != null) add({ ...c, [a]: v }); }
  // exploitation — productive axes get wider range
  for (const a of productive) for (const m of [2, 3]) for (const dir of [-1, 1]) { const v = clampAxis(a, c[a] + dir * m * STEP[a]); if (v != null) add({ ...c, [a]: v }); }
  // exploitation — joint moves among productive axis pairs
  for (let i = 0; i < productive.length; i++) for (let j = i + 1; j < productive.length; j++) {
    const a = productive[i], b = productive[j];
    for (const da of [-1, 1]) for (const db of [-1, 1]) {
      const va = clampAxis(a, c[a] + da * STEP[a]), vb = clampAxis(b, c[b] + db * STEP[b]);
      if (va != null && vb != null) add({ ...c, [a]: va, [b]: vb });
    }
  }
  return out;
}

/**
 * Run ONE generation against `root`, compounding on the persisted champion.
 * Serves the prior champion first (shadow delay), then evaluates a new candidate.
 */
export async function runFlywheelGeneration(root: string, deps: GenerationDeps): Promise<GenerationResult> {
  try {
    // shadow→serve the prior champion (1-tick delay); never serve the just-promoted one.
    const served = serveCurrentChampionIfPending(root, deps.now, deps.applyFn);

    const patterns = await deps.getPatterns();
    if (!patterns || patterns.length < 12) return { ran: false, reason: 'store too small', generation: 0, servedChampion: served };
    const harvested = harvestSelfSupervisedTasks(patterns, { sample: deps.sample ?? 120 });
    const nT = Math.floor(harvested.length * 0.4), nH = Math.floor(harvested.length * 0.4);
    const TRAIN = harvested.slice(0, nT), HELD = harvested.slice(nT, nT + nH), CANARY = harvested.slice(nT + nH);
    if (HELD.length < 20) return { ran: false, reason: 'held-out too small for significance', generation: 0, servedChampion: served };

    const champ = currentChampion(root);
    const baseline = champ.config as unknown as RetrievalConfig;
    const parent = champ.hash;
    const generation = champ.generation;

    const cache = new Map<string, RankedItem[]>();
    const ranked = async (id: string, q: string, cfg: RetrievalConfig) => {
      const ck = `${id}::${key(cfg)}`;
      if (!cache.has(ck)) cache.set(ck, (await deps.search(q, cfg)) || []);
      return cache.get(ck)!;
    };
    const selfRR = async (t: { id: string; input: { q: string }; expected: string }, cfg: RetrievalConfig) => rr(await ranked(t.id, t.input.q, cfg), t.expected);
    const meanRR = async (tasks: typeof TRAIN, cfg: RetrievalConfig) => { let s = 0; for (const t of tasks) s += await selfRR(t, cfg); return s / tasks.length; };
    const anchorMean = async (cfg: RetrievalConfig) => { let s = 0; for (const a of deps.anchorTasks) s += ndcg3((await ranked(a.id, a.q, cfg)).map((x) => x.name), a.labels); return s / deps.anchorTasks.length; };

    const baseAnchor = await anchorMean(baseline);
    // Meta-learning: after gen 0, bias the search toward axes that have
    // historically paid off (a uniform coarse grid only for the first generation).
    const grid = generation === 0 ? coarseGrid() : biasedGrid(baseline, axisEffectiveness(loadPromotions(root)));
    // constrained (Pareto) selection: best self-retrieval on TRAIN subject to no anchor regression.
    let cand = baseline, candTrain = await meanRR(TRAIN, baseline);
    for (const c of grid) {
      if (key(c) === key(baseline)) continue;
      if ((await anchorMean(c)) < baseAnchor - ANCHOR_TOL) continue;
      const s = await meanRR(TRAIN, c);
      if (s > candTrain + 1e-9) { candTrain = s; cand = c; }
    }

    const holdout: Array<{ taskId: string; baselineScore: number; candidateScore: number }> = [];
    for (const t of HELD) holdout.push({ taskId: t.id, baselineScore: await selfRR(t, baseline), candidateScore: await selfRR(t, cand) });
    let cRoll = 0; for (const t of CANARY) if ((await selfRR(t, cand)) < (await selfRR(t, baseline)) - CANARY_CATASTROPHE) cRoll++;
    const canaryRollbackRate = CANARY.length ? cRoll / CANARY.length : 0;
    const candAnchor = await anchorMean(cand);
    const redblue: 'PASS' | 'FAIL' = candAnchor >= baseAnchor - ANCHOR_TOL ? 'PASS' : 'FAIL';

    const bundle = runRealEvolveRound({ baseline: baseline as unknown as Record<string, number>, candidate: cand as unknown as Record<string, number>, holdout, generation, parent, branch: 'main', now: deps.now, redblue, canaryRollbackRate, corpus: FROZEN_CORPUS });
    appendAttempt(root, bundle);
    if (bundle.decisionReceipt.promoted) appendPromotion(root, bundle);

    return {
      ran: true, reason: bundle.decisionReceipt.reason, generation, promoted: bundle.decisionReceipt.promoted,
      delta: bundle.deltas.benchmark, significant: bundle.decisionReceipt.significant,
      championConfig: (bundle.decisionReceipt.promoted ? cand : baseline) as unknown as Record<string, number>,
      servedChampion: served, anchorRegressed: redblue === 'FAIL',
    };
  } catch (e) {
    return { ran: false, reason: `error: ${(e as Error)?.message ?? e}`, generation: 0 };
  }
}

// ── Deployment-safety canary: drift detection on the REAL evolving store ──────
const DRIFT_TOL = 0.02;

export interface DriftCheck { checked: boolean; rolledBack: boolean; reason: string; servedScore?: number; predecessorScore?: number; }

/**
 * A real deployment-safety check on real (not fabricated) data: the store keeps
 * changing as ruflo is used, so a champion benchmarked at promotion time can
 * DRIFT. Each tick, re-score the currently-SERVED champion against its
 * predecessor on a FRESH harvest of the current store; if it now regresses
 * (self-retrieval OR the human anchor), automatically ROLL BACK the active policy
 * to the predecessor. This is the honest analogue of a live-traffic canary —
 * genuine ongoing measurement + genuine rollback — without fabricating traffic.
 * $0; never throws.
 */
export async function checkServedChampionDrift(root: string, deps: GenerationDeps): Promise<DriftCheck> {
  try {
    const served = servedChampion(root);
    if (!served.championHash || served.fromGeneration == null || !served.config) return { checked: false, rolledBack: false, reason: 'nothing served' };
    const bundle = readJson<EvolveReceiptBundle>(path.join(dir(root), `generation-${served.fromGeneration}.json`));
    if (!bundle) return { checked: false, rolledBack: false, reason: 'served bundle missing' };
    const predecessor = (bundle.baselineManifest.policy.value ?? {}) as unknown as RetrievalConfig;
    const servedCfg = served.config as unknown as RetrievalConfig;

    const patterns = await deps.getPatterns();
    if (!patterns || patterns.length < 12) return { checked: false, rolledBack: false, reason: 'store too small' };
    const harvested = harvestSelfSupervisedTasks(patterns, { sample: deps.sample ?? 120 });
    const nT = Math.floor(harvested.length * 0.4), nH = Math.floor(harvested.length * 0.4);
    const FRESH = harvested.slice(nT, nT + nH); // fresh held slice from the CURRENT store
    if (FRESH.length < 12) return { checked: false, rolledBack: false, reason: 'fresh slice too small' };

    const cache = new Map<string, RankedItem[]>();
    const ranked = async (id: string, q: string, cfg: RetrievalConfig) => { const ck = `${id}::${key(cfg)}`; if (!cache.has(ck)) cache.set(ck, (await deps.search(q, cfg)) || []); return cache.get(ck)!; };
    const meanRR = async (cfg: RetrievalConfig) => { let s = 0; for (const t of FRESH) s += rr(await ranked(t.id, t.input.q, cfg), t.expected); return s / FRESH.length; };
    const anchorMean = async (cfg: RetrievalConfig) => { let s = 0; for (const a of deps.anchorTasks) s += ndcg3((await ranked(a.id, a.q, cfg)).map((x) => x.name), a.labels); return s / deps.anchorTasks.length; };

    const servedScore = await meanRR(servedCfg), predScore = await meanRR(predecessor);
    const servedAnchor = await anchorMean(servedCfg), predAnchor = await anchorMean(predecessor);
    const drifted = servedScore < predScore - DRIFT_TOL || servedAnchor < predAnchor - DRIFT_TOL;
    if (drifted) {
      rollbackActivePolicy(root, { now: deps.now });
      try { fs.writeFileSync(path.join(dir(root), SERVED_FILE), JSON.stringify({ championHash: null, config: null, servedAt: deps.now, fromGeneration: null }, null, 2), 'utf-8'); } catch { /* */ }
    }
    return { checked: true, rolledBack: drifted, reason: drifted ? `drift → rolled back (served ${servedScore.toFixed(3)} < predecessor ${predScore.toFixed(3)})` : 'stable', servedScore, predecessorScore: predScore };
  } catch (e) {
    return { checked: false, rolledBack: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}

// ── Status surface ────────────────────────────────────────────────────────────
export interface FlywheelStatus {
  generations: number;               // promotions in the chain
  attempts: number;
  lineage: LineageTelemetry;
  plateau: PlateauReport;
  mutation: MutationStat[];
  axisEffectiveness: AxisStat[];      // per-dimension payoff driving the meta-learning bias
  served: ServedState;
  champion: { config: Record<string, number>; hash: string | null };
}

/** Reconstruct the persisted lineage + telemetry for a status endpoint / CLI. */
export function flywheelStatus(root: string): FlywheelStatus {
  const promotions = loadPromotions(root);
  const attempts = loadAttempts(root);
  const champ = currentChampion(root);
  return {
    generations: promotions.length,
    attempts: attempts.length,
    lineage: reconstructLineage(promotions),
    plateau: detectPlateau(attempts.length ? attempts : promotions, { window: 5 }),
    mutation: mutationEffectiveness(attempts.length ? attempts : promotions),
    axisEffectiveness: axisEffectiveness(promotions),
    served: servedChampion(root),
    champion: { config: champ.config, hash: champ.hash },
  };
}
