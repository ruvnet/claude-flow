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
import { applyChampionParams } from '../config/harness-feedback-applier.js';
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
function localGrid(c: RetrievalConfig): RetrievalConfig[] {
  const ax = {
    alpha: [c.alpha, +(c.alpha - 0.1).toFixed(2), +(c.alpha + 0.1).toFixed(2)].filter((v) => v > 0 && v < 1),
    subjectWeight: [...new Set([c.subjectWeight, Math.max(0.5, c.subjectWeight - 0.5), c.subjectWeight + 0.5])],
    mmrLambda: [c.mmrLambda, +(c.mmrLambda - 0.1).toFixed(2), +(c.mmrLambda + 0.1).toFixed(2)].filter((v) => v >= 0 && v <= 1),
    bodyWeight: [...new Set([c.bodyWeight, Math.max(0.5, c.bodyWeight - 0.5), c.bodyWeight + 0.5])],
    typePenaltyFactor: [...new Set([c.typePenaltyFactor, Math.max(0.25, c.typePenaltyFactor - 0.25), Math.min(1, c.typePenaltyFactor + 0.25)])],
  };
  const g: RetrievalConfig[] = [], u = new Set<string>();
  for (const alpha of ax.alpha) for (const subjectWeight of ax.subjectWeight) for (const mmrLambda of ax.mmrLambda)
    for (const bodyWeight of ax.bodyWeight) for (const typePenaltyFactor of ax.typePenaltyFactor) {
      const cfg = { alpha, subjectWeight, mmrLambda, bodyWeight, typePenaltyFactor };
      if (u.has(key(cfg))) continue; u.add(key(cfg)); g.push(cfg);
    }
  return g;
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
    const grid = generation === 0 ? coarseGrid() : localGrid(baseline);
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

// ── Status surface ────────────────────────────────────────────────────────────
export interface FlywheelStatus {
  generations: number;               // promotions in the chain
  attempts: number;
  lineage: LineageTelemetry;
  plateau: PlateauReport;
  mutation: MutationStat[];
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
    served: servedChampion(root),
    champion: { config: champ.config, hash: champ.hash },
  };
}
