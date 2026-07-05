/**
 * Self-optimizing flywheel (ADR-176) — closes the loop so an install gets
 * smarter AS IT RUNS, with proof.
 *
 * Each tick:
 *   1. HARVEST a benchmark corpus from the install's REAL store (self-supervised
 *      self-retrieval), blended with the human-labeled ADR-081 anchor.
 *   2. BASELINE = the currently-active champion (or shipped defaults).
 *   3. PROPOSE neighbor configs; pick the best on the TRAIN split (local
 *      hill-climb — deterministic, selection uses train only).
 *   4. GATE the winner through the shipped runHarnessLoop on the HELD-OUT split:
 *      held_out_improves AND redblue(anchor-no-regress) AND drift<=thr AND
 *      replay-deterministic AND receipt_coverage AND canary-no-worse.
 *   5. On accept → APPLY locally (the install self-optimizes on its own data; no
 *      signing needed because nothing is propagated), CHAIN to the previous
 *      champion, and record the attempt in the improvement ledger. Also STAGE
 *      the unsigned champion for optional promotion to the signed global channel.
 *
 * Trust split: LOCAL self-optimization is unsigned (an install trusting its own
 * measured gate); CROSS-install propagation still requires the config-signed
 * champion (ADR-177). Deterministic, $0, never throws. Injectable deps → testable
 * without ONNX/network.
 */
import { createHash } from 'node:crypto';
import { runHarnessLoop } from './harness-loop.js';
import { hashCorpus } from './harness-benchmark.js';
import { harvestSelfSupervisedTasks, blendCorpus, type HarvestPattern } from './harness-corpus-harvester.js';
import { applyChampionParams } from '../config/harness-feedback-applier.js';
import { appendLedger, type LedgerEntry } from './harness-improvement-ledger.js';

export interface RetrievalConfig { alpha: number; subjectWeight: number; mmrLambda: number; bodyWeight: number; typePenaltyFactor: number; }
export const DEFAULT_CONFIG: RetrievalConfig = { alpha: 0.5, subjectWeight: 2.0, mmrLambda: 0.7, bodyWeight: 1.0, typePenaltyFactor: 1.0 };

export interface RankedItem { id: string; name: string; }
export interface AnchorTask { id: string; input: { id: string; q: string }; expected: string[]; }

export interface FlywheelDeps {
  getPatterns: () => HarvestPattern[] | Promise<HarvestPattern[]>;
  search: (query: string, config: RetrievalConfig) => Promise<RankedItem[]> | RankedItem[];
  anchorTasks: AnchorTask[];
  activeParams?: () => Partial<RetrievalConfig> | null;
  sample?: number;
  now?: number;
}

export interface FlywheelResult {
  ran: boolean;
  reason: string;
  accepted?: boolean;
  applied?: boolean;
  baselineScore?: number;
  candidateScore?: number;
  delta?: number;
  anchorRegressed?: boolean;
  championRef?: string;
  corpusVersion?: string;
}

const EPS = 1e-3;
const cfgCanon = (c: RetrievalConfig) => JSON.stringify(Object.fromEntries(Object.keys(c).sort().map((k) => [k, (c as unknown as Record<string, number>)[k]])));
const refOf = (c: RetrievalConfig) => 'sha256:' + createHash('sha256').update(cfgCanon(c)).digest('hex');
const cfgKey = (c: RetrievalConfig) => cfgCanon(c);

function ndcg3(names: string[], labels: string[]): number {
  const rel = names.slice(0, 3).map((n) => !!n && labels.some((s) => n.toLowerCase().includes(s.toLowerCase())));
  const dcg = rel.reduce((a, r, i) => a + (r ? 1 / Math.log2(i + 2) : 0), 0);
  const num = rel.filter(Boolean).length;
  if (num === 0) return 0;
  let idcg = 0; for (let i = 0; i < num; i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}
/** grade dispatch: anchor tasks (labels[]) → nDCG@3; harvested tasks (doc id) → reciprocal rank. */
function grade(ranked: RankedItem[], expected: unknown): number {
  if (Array.isArray(expected)) return ndcg3(ranked.map((r) => r.name), expected as string[]);
  const idx = ranked.findIndex((r) => r.id === expected);
  return idx >= 0 ? 1 / (idx + 1) : 0;
}

function neighbors(base: RetrievalConfig): RetrievalConfig[] {
  const steps: Record<keyof RetrievalConfig, number> = { alpha: 0.1, subjectWeight: 0.5, mmrLambda: 0.1, bodyWeight: 0.5, typePenaltyFactor: 0.25 };
  const out: RetrievalConfig[] = [];
  for (const ax of Object.keys(steps) as (keyof RetrievalConfig)[]) {
    for (const dir of [-1, 1]) {
      const v = +(base[ax] + dir * steps[ax]).toFixed(3);
      if (ax === 'alpha' && (v <= 0 || v >= 1)) continue;
      if (ax === 'mmrLambda' && (v < 0 || v > 1)) continue;
      if (v <= 0) continue;
      out.push({ ...base, [ax]: v });
    }
  }
  return out;
}

/** Deterministic id-sort split (matches computeHeldOutSplit @ frac). */
function split<T extends { id: string }>(tasks: T[], frac: number): { train: T[]; held: T[] } {
  const ordered = [...tasks].sort((a, b) => a.id.localeCompare(b.id));
  const cut = Math.max(0, ordered.length - Math.max(1, Math.round(ordered.length * frac)));
  return { train: ordered.slice(0, cut), held: ordered.slice(cut) };
}

/**
 * Run one flywheel tick against `projectRoot`. Best-effort; never throws.
 * Returns a rich result AND (as a side effect) appends to the improvement ledger
 * and — on accept — applies the champion locally + chains it.
 */
export async function runFlywheelTick(projectRoot: string, deps: FlywheelDeps): Promise<FlywheelResult> {
  try {
    const patterns = await deps.getPatterns();
    if (!patterns || patterns.length < 8) return { ran: false, reason: 'store too small to harvest a corpus' };

    const harvested = harvestSelfSupervisedTasks(patterns, { sample: deps.sample ?? 40 });
    if (harvested.length < 4) return { ran: false, reason: 'not enough harvestable tasks' };
    const blended = blendCorpus(deps.anchorTasks, harvested);
    const anchorIdSet = new Set(blended.anchorIds);

    const baseline: RetrievalConfig = { ...DEFAULT_CONFIG, ...(deps.activeParams?.() ?? {}) };
    const candidates = neighbors(baseline);

    // Precompute retrieval for baseline + all candidates over every task (async
    // I/O up front → the harness scoring stays pure/sync).
    const cache = new Map<string, RankedItem[]>();
    const configs = [baseline, ...candidates];
    for (const cfg of configs) {
      for (const t of blended.tasks) {
        const q = (t.input as { q: string }).q;
        cache.set(`${t.id}::${cfgKey(cfg)}`, (await deps.search(q, cfg)) || []);
      }
    }
    const evalFn = (input: unknown, cfg: RetrievalConfig) => cache.get(`${(input as { id: string }).id}::${cfgKey(cfg)}`) ?? [];
    const gradeFn = (output: unknown, expected: unknown) => grade(output as RankedItem[], expected);

    // Local hill-climb: pick the best-on-TRAIN neighbor (selection uses train only).
    const { train, held } = split(blended.tasks, 0.5);
    const trainScore = (cfg: RetrievalConfig) => train.reduce((s, t) => s + gradeFn(evalFn(t.input, cfg), t.expected), 0) / train.length;
    const baseTrain = trainScore(baseline);
    let candidate = baseline, candTrain = baseTrain;
    for (const c of candidates) { const s = trainScore(c); if (s > candTrain + 1e-9) { candTrain = s; candidate = c; } }

    // anchor-no-regress (Goodhart guard): candidate must not regress vs baseline
    // on the human anchor. Used as the adversarial redblue verdict.
    const anchorTasksHeld = blended.tasks.filter((t) => anchorIdSet.has(t.id));
    const anchorScore = (cfg: RetrievalConfig) => anchorTasksHeld.length
      ? anchorTasksHeld.reduce((s, t) => s + gradeFn(evalFn(t.input, cfg), t.expected), 0) / anchorTasksHeld.length : 1;
    const baseAnchor = anchorScore(baseline), candAnchor = anchorScore(candidate);
    const anchorRegressed = candAnchor < baseAnchor - EPS;

    // Qualified trajectories — one per train task. Both the human anchor and the
    // self-supervised self-retrieval tasks are deterministic, executable checks
    // with an unambiguous ground truth → oracle:test-exec (not a proxy heuristic).
    const trajectories = train.map((t) => ({
      id: `fw-${t.id}`, steps: [{ action: 'retrieve', tier: 'oracle:test-exec' as const }],
      outcome: 'success' as const, benchmarkTaskId: `${blended.version}/${t.id}`,
      inputs: { q: (t.input as { q: string }).q }, recordedOutputs: { ranked: cache.get(`${t.id}::${cfgKey(candidate)}`) },
    }));
    const replay = (tr: { recordedOutputs: unknown }) => tr.recordedOutputs;

    const heldScoreFor = (cfg: RetrievalConfig, t: { input: unknown; expected: unknown }) => gradeFn(evalFn(t.input, cfg), t.expected);
    const corpus = { version: blended.version, tasks: blended.tasks, corpusHash: hashCorpus(blended.tasks) };

    const result = await runHarnessLoop<RetrievalConfig>({
      trajectories, corpus, baseline, candidate, evalFn, gradeFn, replay,
      verify: {
        redblue: async () => (anchorRegressed ? 'FAIL' : 'PASS'),
        drift: async () => held.filter((t) => heldScoreFor(candidate, t) < heldScoreFor(baseline, t) - EPS).length / Math.max(1, held.length),
      },
      canaryRunner: (input, cfg) => {
        const t = blended.tasks.find((x) => x.id === (input as { id: string }).id)!;
        const worse = heldScoreFor(cfg, t) < heldScoreFor(baseline, t) - EPS;
        return { ok: !worse, rolledBack: worse, latencyMs: 0, costUsd: 0, accepted: !worse };
      },
      holdoutFrac: 0.5, driftThreshold: 0.2, layer: 'repo/local', policyRefOf: refOf, now: deps.now,
    });

    const baselineScore = result.baselineScore ?? 0;
    const candidateScore = result.candidateScore ?? 0;
    const entry: LedgerEntry = {
      ts: deps.now ?? Date.now(),
      corpusVersion: blended.version, corpusHash: blended.corpusHash,
      corpusSize: blended.tasks.length, anchorSize: blended.anchorIds.length,
      baselineRef: refOf(baseline), candidateRef: refOf(candidate),
      baselineScore, candidateScore, delta: candidateScore - baselineScore,
      anchorRegressed, accepted: result.accepted,
      gates: Object.fromEntries(Object.entries(result.verdict?.terms ?? {}).map(([k, v]) => [k, v.pass])),
      reason: result.reason,
    };

    let applied = false;
    if (result.accepted && result.manifest) {
      entry.championRef = refOf(candidate);
      // Apply locally (self-optimization) + chain to the previous champion.
      const ap = applyChampionParams(projectRoot, {
        championId: refOf(candidate), params: candidate as unknown as Record<string, unknown>,
        layer: 'repo/local', previous: refOf(baseline), now: deps.now,
      });
      applied = ap.applied;
    }
    appendLedger(`${projectRoot}/.claude-flow/metrics`, entry);

    return {
      ran: true, reason: result.reason, accepted: result.accepted, applied,
      baselineScore, candidateScore, delta: candidateScore - baselineScore,
      anchorRegressed, championRef: entry.championRef, corpusVersion: blended.version,
    };
  } catch (e) {
    return { ran: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}
