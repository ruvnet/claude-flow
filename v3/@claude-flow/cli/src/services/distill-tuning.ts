/**
 * distill-tuning.ts — Milestone 4 self-optimization harness (ADR-174
 * "Self-optimization (ruflo tuning ruflo)").
 *
 * Finds the memory-distillation config (batchSize, dedupDistance,
 * promoteThreshold) that maximises MEASURED retrieval quality — not a
 * marketing claim — via grid search over ISOLATED copies of a source DB,
 * scored on a held-out split. $0, offline, no LLM.
 *
 * ── M1 is frozen ────────────────────────────────────────────────────────────
 * `runDistillation` (memory-distillation.ts) is Milestone 1 and DONE. This
 * module only imports and calls it; it never changes its behaviour.
 * `promoteThreshold` is NOT an M1 parameter, so the two grid values are
 * implemented here as a post-processing pass over the copy's
 * `reasoning_patterns.metadata` after M1 has run (see
 * `applyCorroboratedPromotion`) — 'execution-only' leaves M1's own promote
 * gate untouched (only `oracle:test-exec` promotes, per ADR-171);
 * 'execution+corroborated' additionally promotes `proxy:structural` patterns
 * that multiple near-duplicate entries corroborated (`uses >=
 * CORROBORATION_MIN_USES`), widening the promoted-recall pool.
 *
 * ── Isolation (load-bearing) ─────────────────────────────────────────────
 * The source DB at `options.dbPath` is NEVER opened with a database
 * connection anywhere in this module — only `fs.copyFileSync` (byte copy)
 * and a whole-file sha256 checksum (`fs.readFileSync`) ever touch it. Every
 * grid candidate, and the read-only split/query-set pass, runs against its
 * OWN temp copy. The checksum is asserted equal before and after the whole
 * run.
 *
 * ── Held-out discipline (ADR-174 §Self-optimization) ─────────────────────
 * Earliest ~80% of `memory_entries` (by rowid — a monotonic proxy for
 * insertion time) = TRAIN, most-recent ~20% = HELD-OUT. HELD-OUT is scored
 * exactly ONCE, for the winning config only, AFTER the winner has already
 * been chosen using an INNER 80/20 split of TRAIN itself (so grid search
 * never peeks at the true held-out set — tuning isn't circular).
 *
 * @module services/distill-tuning
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

import { runDistillation, type DistillOptions } from './memory-distillation.js';
import { distillTrajectoryContent } from '../memory/structured-distill.js';
import { cosineSim } from '../memory/hybrid-retrieval.js';

// ── Public types ─────────────────────────────────────────────────────────

export type PromoteThreshold = 'execution-only' | 'execution+corroborated';

export interface TuningConfig {
  batchSize: number;
  dedupDistance: number;
  promoteThreshold: PromoteThreshold;
}

export interface ParamGrid {
  batchSize?: number[];
  dedupDistance?: number[];
  promoteThreshold?: PromoteThreshold[];
}

export interface TuningCandidate {
  config: TuningConfig;
  /** MRR@10 on the inner train-query split (never the true held-out set). */
  trainScore: number;
  trainRecallAt10: number;
  trainQueryCount: number;
  patternCount: number;
  promotedCount: number;
  distillMs: number;
  /** Present iff M1 itself skipped this run (corrupt DB, missing tables, ...). */
  skipped?: string;
}

export interface HeldOutScore {
  mrrAt10: number;
  recallAt10: number;
  queryCount: number;
  /** Same held-out query set scored against raw (undistilled) train entries. */
  baselineMrrAt10: number;
  baselineRecallAt10: number;
}

export interface TuningProvenance {
  gridSize: number;
  corpusSize: number;
  trainSize: number;
  heldOutSize: number;
  metric: 'mrr@10';
  /** Stamped from `options.now` (or the orchestrator's own Date.now() at the
   *  I/O boundary) — never read from inside pure scoring logic. */
  tunedAt: number;
  sourceDbPath: string;
  sourceChecksumSha256: string;
}

export interface TuningReport {
  candidates: TuningCandidate[];
  winner: TuningCandidate;
  heldOut: HeldOutScore;
  /** True when held-out MRR@10 is >20% worse (relative) than the winner's train score. */
  overfit: boolean;
  provenance: TuningProvenance;
}

export interface TuneDistillationOptions {
  /** Source DB — read (copied + hashed) only; NEVER opened with a DB connection. */
  dbPath: string;
  grid?: ParamGrid;
  /** Namespaces to distill / include in the raw baseline pool (default: all). */
  namespaces?: string[];
  /** Outer train/held-out split fraction (default 0.8). */
  trainFraction?: number;
  /** Namespaces the query set is drawn from (default: feedback + commands). */
  queryNamespaces?: string[];
  topK?: number;
  /** Timestamp stamped into `provenance.tunedAt`. Caller-supplied so the core
   *  logic stays a pure function of its inputs; defaults to `Date.now()` at
   *  this I/O boundary if omitted. */
  now?: number;
  tmpDir?: string;
  verbose?: boolean;
}

export interface TimeSplit {
  totalRows: number;
  trainBoundaryRowid: number;
  trainRowids: number[];
  heldOutRowids: number[];
}

export interface TunedConfigFile {
  batchSize: number;
  dedupDistance: number;
  promoteThreshold: PromoteThreshold;
  provenance: TuningProvenance & {
    winnerTrainScore: number;
    heldOutScore: number;
    baselineHeldOutScore: number;
    overfit: boolean;
  };
}

// ── Grid defaults (requirement 1) ───────────────────────────────────────

export const DEFAULT_GRID_BATCH_SIZE = [100, 200, 500];
export const DEFAULT_GRID_DEDUP_DISTANCE = [0.05, 0.1, 0.15, 0.2, 0.3];
export const DEFAULT_GRID_PROMOTE_THRESHOLD: PromoteThreshold[] = [
  'execution-only',
  'execution+corroborated',
];
const DEFAULT_TOP_K = 10;
const DEFAULT_TRAIN_FRACTION = 0.8;
const DEFAULT_QUERY_NAMESPACES = ['feedback', 'commands'];
/** Minimum corroborating uses for a proxy:structural pattern to promote under
 *  'execution+corroborated' — multiple near-duplicate entries clustering into
 *  one pattern is treated as weak corroboration (still not oracle ground
 *  truth; ADR-171 discipline is preserved by keeping this a distinct,
 *  visibly-named policy rather than silently loosening the default gate). */
const CORROBORATION_MIN_USES = 2;
/** Caps the raw-baseline candidate pool so scoring stays fast on large corpora. */
const MAX_BASELINE_INDEX_SIZE = 3000;

// ── Internal shapes ─────────────────────────────────────────────────────

interface QueryEntry {
  id: string;
  namespace: string;
  embedding: number[];
  labels: string[];
  paths: string[];
}

interface PatternIndexEntry {
  id: number;
  embedding: number[];
  labels: string[];
  paths: string[];
}

interface CandidateEvalResult {
  mrrAtK: number;
  recallAtK: number;
  queryCount: number;
  patternCount: number;
  promotedCount: number;
  distillMs: number;
  skipped?: string;
}

// ── Public entry point ───────────────────────────────────────────────────

/**
 * Grid-search the distillation config against isolated copies of `dbPath`,
 * scored on a held-out split. See module header for the full methodology.
 */
export async function tuneDistillation(options: TuneDistillationOptions): Promise<TuningReport> {
  const {
    dbPath,
    grid = {},
    namespaces,
    trainFraction = DEFAULT_TRAIN_FRACTION,
    queryNamespaces = DEFAULT_QUERY_NAMESPACES,
    topK = DEFAULT_TOP_K,
    now,
    tmpDir = os.tmpdir(),
    verbose = false,
  } = options;

  if (!dbPath || !fs.existsSync(dbPath)) {
    throw new Error(`tuneDistillation: source db not found at ${dbPath}`);
  }

  const Database = await loadBetterSqlite3();
  if (!Database) {
    throw new Error('tuneDistillation: better-sqlite3 unavailable — cannot run the tuning harness');
  }

  const sourceChecksumBefore = sha256File(dbPath);

  const batchSizes = grid.batchSize ?? DEFAULT_GRID_BATCH_SIZE;
  const dedupDistances = grid.dedupDistance ?? DEFAULT_GRID_DEDUP_DISTANCE;
  const promoteThresholds = grid.promoteThreshold ?? DEFAULT_GRID_PROMOTE_THRESHOLD;
  const configs: TuningConfig[] = [];
  for (const batchSize of batchSizes) {
    for (const dedupDistance of dedupDistances) {
      for (const promoteThreshold of promoteThresholds) {
        configs.push({ batchSize, dedupDistance, promoteThreshold });
      }
    }
  }
  if (configs.length === 0) {
    throw new Error('tuneDistillation: empty grid — supply at least one value per grid axis');
  }

  // ── Splits + query sets: a dedicated read-only copy, never the source itself ──
  const readCopy = copyToTemp(dbPath, tmpDir, 'split-read');
  let outerSplit: TimeSplit;
  let innerSplit: TimeSplit;
  let trainQuerySet: QueryEntry[];
  let heldOutQuerySet: QueryEntry[];
  let heldOutBaselineIndex: PatternIndexEntry[];
  try {
    const readDb = new Database(readCopy, { readonly: true });
    try {
      outerSplit = computeTimeSplit(readDb, trainFraction);
      assertDisjoint(outerSplit.trainRowids, outerSplit.heldOutRowids);

      innerSplit = computeTimeSplit(readDb, trainFraction, {
        extraWhere: `rowid <= ${outerSplit.trainBoundaryRowid}`,
      });
      assertDisjoint(innerSplit.trainRowids, innerSplit.heldOutRowids);

      trainQuerySet = buildQuerySet(readDb, {
        loRowid: innerSplit.trainBoundaryRowid,
        hiRowid: outerSplit.trainBoundaryRowid,
        namespaces: queryNamespaces,
      });
      heldOutQuerySet = buildQuerySet(readDb, {
        loRowid: outerSplit.trainBoundaryRowid,
        hiRowid: Infinity,
        namespaces: queryNamespaces,
      });
      heldOutBaselineIndex = buildRawIndex(readDb, {
        loRowid: 0,
        hiRowid: outerSplit.trainBoundaryRowid,
        namespaces,
      });
    } finally {
      readDb.close();
    }
  } finally {
    safeUnlink(readCopy);
  }

  // ── Grid search: TRAIN-internal scoring only — never touches heldOutQuerySet ──
  const candidates: TuningCandidate[] = [];
  for (const config of configs) {
    if (verbose) console.log(`tuneDistillation: evaluating ${JSON.stringify(config)}`);
    const result = await evaluateCandidate({
      Database,
      sourceDbPath: dbPath,
      tmpDir,
      config,
      fitBoundaryRowid: innerSplit.trainBoundaryRowid,
      namespaces,
      querySet: trainQuerySet,
      topK,
    });
    candidates.push({
      config,
      trainScore: result.mrrAtK,
      trainRecallAt10: result.recallAtK,
      trainQueryCount: result.queryCount,
      patternCount: result.patternCount,
      promotedCount: result.promotedCount,
      distillMs: result.distillMs,
      ...(result.skipped ? { skipped: result.skipped } : {}),
    });
  }

  const scored = candidates.filter((c) => !c.skipped);
  if (scored.length === 0) {
    throw new Error('tuneDistillation: every grid candidate was skipped — see candidates[].skipped');
  }
  const winner = scored.reduce((best, c) => (c.trainScore > best.trainScore ? c : best), scored[0]);

  // ── Held-out: score the winner ONCE, refit on the FULL outer train partition ──
  const winnerFull = await evaluateCandidate({
    Database,
    sourceDbPath: dbPath,
    tmpDir,
    config: winner.config,
    fitBoundaryRowid: outerSplit.trainBoundaryRowid,
    namespaces,
    querySet: heldOutQuerySet,
    topK,
  });
  const baseline = scoreQuerySet(heldOutBaselineIndex, heldOutQuerySet, topK);

  const heldOut: HeldOutScore = {
    mrrAt10: winnerFull.mrrAtK,
    recallAt10: winnerFull.recallAtK,
    queryCount: winnerFull.queryCount,
    baselineMrrAt10: baseline.mrrAtK,
    baselineRecallAt10: baseline.recallAtK,
  };
  // Overfit: held-out MRR is more than 20% (relative) worse than the winner's
  // own train score. Guard divide-by-zero — a zero train score can't overfit.
  const overfit = winner.trainScore > 0 && heldOut.mrrAt10 < winner.trainScore * 0.8;

  const sourceChecksumAfter = sha256File(dbPath);
  if (sourceChecksumAfter !== sourceChecksumBefore) {
    // This must be structurally impossible (dbPath is never opened with a DB
    // connection anywhere above) — a mismatch means an invariant was broken.
    throw new Error('tuneDistillation: source DB checksum changed during tuning — refusing to report a result');
  }

  return {
    candidates,
    winner,
    heldOut,
    overfit,
    provenance: {
      gridSize: configs.length,
      corpusSize: outerSplit.totalRows,
      trainSize: outerSplit.trainRowids.length,
      heldOutSize: outerSplit.heldOutRowids.length,
      metric: 'mrr@10',
      tunedAt: now ?? Date.now(),
      sourceDbPath: dbPath,
      sourceChecksumSha256: sourceChecksumAfter,
    },
  };
}

// ── Persisted config artifact (requirement 6) ────────────────────────────

/** Shape the winning config + provenance for persistence. Pure — no I/O. */
export function buildTunedConfigFile(report: TuningReport): TunedConfigFile {
  return {
    batchSize: report.winner.config.batchSize,
    dedupDistance: report.winner.config.dedupDistance,
    promoteThreshold: report.winner.config.promoteThreshold,
    provenance: {
      ...report.provenance,
      winnerTrainScore: report.winner.trainScore,
      heldOutScore: report.heldOut.mrrAt10,
      baselineHeldOutScore: report.heldOut.baselineMrrAt10,
      overfit: report.overfit,
    },
  };
}

/** Write the winning config to disk. Caller decides whether/where to call this. */
export function writeTunedConfigFile(report: TuningReport, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(buildTunedConfigFile(report), null, 2));
}

/** Where the tuned config lives by default, for daemon/CLI callers. */
export function defaultTunedConfigPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.claude-flow', 'distill-tuned.json');
}

// ── Time-based split ─────────────────────────────────────────────────────

/**
 * Split a table's rows by rowid (a monotonic proxy for insertion time) into
 * an earliest `trainFraction` chunk and a most-recent remainder. Pure given a
 * fixed db snapshot. `table`/`extraWhere` are only ever called with internal
 * literal strings (never external input) — not a SQL-injection surface.
 */
export function computeTimeSplit(
  db: unknown,
  trainFraction: number,
  opts: { table?: string; extraWhere?: string } = {},
): TimeSplit {
  const table = opts.table ?? 'memory_entries';
  const whereParts = ['embedding IS NOT NULL'];
  if (opts.extraWhere) whereParts.push(`(${opts.extraWhere})`);
  const where = `WHERE ${whereParts.join(' AND ')}`;
  const rows = (db as any)
    .prepare(`SELECT rowid AS rowid FROM ${table} ${where} ORDER BY rowid`)
    .all() as Array<{ rowid: number }>;
  const total = rows.length;
  if (total === 0) return { totalRows: 0, trainBoundaryRowid: 0, trainRowids: [], heldOutRowids: [] };

  const trainCount = Math.min(total, Math.max(1, Math.floor(total * trainFraction)));
  const trainBoundaryRowid = rows[trainCount - 1].rowid;
  const trainRowids: number[] = [];
  const heldOutRowids: number[] = [];
  for (const r of rows) {
    if (r.rowid <= trainBoundaryRowid) trainRowids.push(r.rowid);
    else heldOutRowids.push(r.rowid);
  }
  return { totalRows: total, trainBoundaryRowid, trainRowids, heldOutRowids };
}

function assertDisjoint(a: number[], b: number[]): void {
  const setA = new Set(a);
  for (const x of b) {
    if (setA.has(x)) {
      throw new Error(`tuneDistillation: train/held-out partitions are not disjoint (rowid ${x} in both)`);
    }
  }
}

// ── Query set + baseline index construction ─────────────────────────────

function buildQuerySet(
  db: any,
  opts: { loRowid: number; hiRowid: number; namespaces: string[] },
): QueryEntry[] {
  const { loRowid, hiRowid, namespaces } = opts;
  if (namespaces.length === 0) return [];
  const placeholders = namespaces.map(() => '?').join(',');
  const hiFinite = Number.isFinite(hiRowid);
  const sql = `SELECT rowid, id, namespace, content, embedding FROM memory_entries
    WHERE rowid > ? ${hiFinite ? 'AND rowid <= ?' : ''} AND embedding IS NOT NULL
      AND COALESCE(namespace,'default') IN (${placeholders})
    ORDER BY rowid`;
  const args = hiFinite ? [loRowid, hiRowid, ...namespaces] : [loRowid, ...namespaces];
  const rows = db.prepare(sql).all(...args) as Array<{
    rowid: number; id: string; namespace: string; content: string; embedding: string;
  }>;
  const out: QueryEntry[] = [];
  for (const r of rows) {
    const embedding = parseEmbeddingJson(r.embedding);
    if (!embedding) continue;
    const distilled = distillTrajectoryContent(String(r.content ?? ''));
    out.push({ id: r.id, namespace: r.namespace, embedding, labels: distilled.labels, paths: distilled.paths });
  }
  return out;
}

function buildRawIndex(
  db: any,
  opts: { loRowid: number; hiRowid: number; namespaces?: string[] },
): PatternIndexEntry[] {
  const { loRowid, hiRowid, namespaces } = opts;
  let sql = 'SELECT rowid, content, embedding FROM memory_entries WHERE rowid > ? AND rowid <= ? AND embedding IS NOT NULL';
  const args: unknown[] = [loRowid, hiRowid];
  if (namespaces && namespaces.length) {
    sql += ` AND COALESCE(namespace,'default') IN (${namespaces.map(() => '?').join(',')})`;
    args.push(...namespaces);
  }
  sql += ' ORDER BY rowid';
  const rows = db.prepare(sql).all(...args) as Array<{ rowid: number; content: string; embedding: string }>;
  const sampled = sampleCap(rows, MAX_BASELINE_INDEX_SIZE);
  const out: PatternIndexEntry[] = [];
  for (const r of sampled) {
    const embedding = parseEmbeddingJson(r.embedding);
    if (!embedding) continue;
    const distilled = distillTrajectoryContent(String(r.content ?? ''));
    out.push({ id: -1, embedding, labels: distilled.labels, paths: distilled.paths });
  }
  return out;
}

/** Evenly-spaced sample so large corpora stay fast without biasing toward one end. */
function sampleCap<T>(rows: T[], cap: number): T[] {
  if (rows.length <= cap) return rows;
  const stride = rows.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i++) out.push(rows[Math.floor(i * stride)]);
  return out;
}

function parseEmbeddingJson(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// ── Candidate evaluation (one isolated temp copy per call) ──────────────

async function evaluateCandidate(params: {
  Database: any;
  sourceDbPath: string;
  tmpDir: string;
  config: TuningConfig;
  /** Rows with rowid <= this are visible to distillation on the copy. */
  fitBoundaryRowid: number;
  namespaces?: string[];
  querySet: QueryEntry[];
  topK: number;
}): Promise<CandidateEvalResult> {
  const { Database, sourceDbPath, tmpDir, config, fitBoundaryRowid, namespaces, querySet, topK } = params;
  const label = `cand-${config.batchSize}-${config.dedupDistance}-${config.promoteThreshold.replace(/\W+/g, '_')}`;
  const tmpCopy = copyToTemp(sourceDbPath, tmpDir, label);
  try {
    // Reset any pre-existing distilled state on the COPY (the real
    // .swarm/memory.db already carries real reasoning_patterns/episodes/
    // distill_state from M1's own runs — without this reset every candidate's
    // cursor would already be at the tail and "process" zero rows, silently
    // scoring the CURRENT production config instead of the candidate's own).
    // Then trim to the fit partition. Both on the isolated copy only.
    const prep = new Database(tmpCopy);
    try {
      resetDistillationState(prep);
      prep.prepare('DELETE FROM memory_entries WHERE rowid > ?').run(fitBoundaryRowid);
    } finally {
      prep.close();
    }

    const t0 = Date.now();
    const distillOpts: DistillOptions = {
      dbPath: tmpCopy,
      namespaces,
      batchSize: config.batchSize,
      dedupDistance: config.dedupDistance,
      dryRun: false,
      judge: 'structural',
    };
    const report = await runDistillation(distillOpts);
    const distillMs = Date.now() - t0;
    if (report.skipped) {
      return { mrrAtK: 0, recallAtK: 0, queryCount: querySet.length, patternCount: 0, promotedCount: 0, distillMs, skipped: report.skipped };
    }

    const scoreDb = new Database(tmpCopy);
    let index: PatternIndexEntry[];
    let patternCount: number;
    try {
      if (config.promoteThreshold === 'execution+corroborated') {
        applyCorroboratedPromotion(scoreDb);
      }
      index = loadPromotedPatternIndex(scoreDb);
      patternCount = (scoreDb.prepare('SELECT COUNT(*) AS c FROM reasoning_patterns').get() as { c: number }).c;
    } finally {
      scoreDb.close();
    }

    const { mrrAtK, recallAtK } = scoreQuerySet(index, querySet, topK);
    return { mrrAtK, recallAtK, queryCount: querySet.length, patternCount, promotedCount: index.length, distillMs };
  } finally {
    safeUnlink(tmpCopy);
  }
}

function resetDistillationState(db: any): void {
  const tableExists = (name: string): boolean =>
    ((db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(name) as { c: number } | undefined)?.c ?? 0) > 0;
  for (const t of ['distill_state', 'causal_edges', 'pattern_embeddings', 'reasoning_patterns', 'episodes']) {
    if (tableExists(t)) db.exec(`DELETE FROM ${t}`);
  }
}

function applyCorroboratedPromotion(db: any): void {
  db.prepare(
    `UPDATE reasoning_patterns SET metadata = json_set(metadata, '$.promoted', 1)
     WHERE json_extract(metadata, '$.provenance') = 'proxy:structural' AND uses >= ?`,
  ).run(CORROBORATION_MIN_USES);
}

// ── Scoring (MRR@K / recall@K, shared by candidate + baseline paths) ────

function scoreQuerySet(
  index: PatternIndexEntry[],
  queries: QueryEntry[],
  topK: number,
): { mrrAtK: number; recallAtK: number } {
  if (queries.length === 0 || index.length === 0) return { mrrAtK: 0, recallAtK: 0 };
  let mrrSum = 0;
  let recallHits = 0;
  for (const q of queries) {
    const ranked = index
      .map((p) => ({ p, sim: cosineSim(q.embedding, p.embedding) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, topK);
    let firstCorrectRank = -1;
    for (let i = 0; i < ranked.length; i++) {
      if (isTopicallyCorrect(q, ranked[i].p)) {
        firstCorrectRank = i + 1;
        break;
      }
    }
    if (firstCorrectRank > 0) {
      mrrSum += 1 / firstCorrectRank;
      recallHits += 1;
    }
  }
  return { mrrAtK: mrrSum / queries.length, recallAtK: recallHits / queries.length };
}

/** Proxy for "topically correct": shares at least one label or path with the query. */
function isTopicallyCorrect(q: QueryEntry, p: { labels: string[]; paths: string[] }): boolean {
  if (p.labels.some((l) => q.labels.includes(l))) return true;
  if (p.paths.some((pp) => q.paths.includes(pp))) return true;
  return false;
}

// ── pattern_embeddings BLOB → number[] ───────────────────────────────────

function loadPromotedPatternIndex(db: any): PatternIndexEntry[] {
  const rows = db
    .prepare(
      `SELECT rp.id AS id, rp.tags AS tags, rp.metadata AS metadata, pe.embedding AS embedding
       FROM reasoning_patterns rp
       JOIN pattern_embeddings pe ON pe.pattern_id = rp.id
       WHERE json_extract(rp.metadata, '$.promoted') = 1`,
    )
    .all() as Array<{ id: number; tags: string; metadata: string; embedding: Buffer }>;
  return rows.map((r) => {
    let labels: string[] = [];
    try {
      const t = JSON.parse(r.tags ?? '[]');
      if (Array.isArray(t)) labels = t;
    } catch {
      /* not JSON — no labels */
    }
    let paths: string[] = [];
    try {
      const m = JSON.parse(r.metadata ?? '{}');
      if (Array.isArray(m.paths)) paths = m.paths;
    } catch {
      /* not JSON — no paths */
    }
    return { id: r.id, embedding: bufferToFloat32Array(r.embedding), labels, paths };
  });
}

/**
 * Copy a BLOB Buffer's bytes into a fresh, 4-byte-aligned ArrayBuffer before
 * viewing it as Float32Array — better-sqlite3 BLOB buffers aren't guaranteed
 * to start at a 4-byte-aligned offset within their backing ArrayBuffer, and
 * the Float32Array constructor throws on misaligned views.
 */
function bufferToFloat32Array(buf: Buffer): number[] {
  const floatCount = Math.floor(buf.byteLength / 4);
  const aligned = new ArrayBuffer(floatCount * 4);
  new Uint8Array(aligned).set(buf.subarray(0, floatCount * 4));
  return Array.from(new Float32Array(aligned));
}

// ── fs / hashing / better-sqlite3 loading helpers ────────────────────────

function sha256File(p: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function copyToTemp(sourcePath: string, tmpDir: string, label: string): string {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const unique = crypto.randomBytes(6).toString('hex');
  const dest = path.join(tmpDir, `distill-tune-${label}-${unique}.db`);
  fs.copyFileSync(sourcePath, dest);
  return dest;
}

function safeUnlink(p: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.unlinkSync(p + suffix);
    } catch {
      /* already gone / never created */
    }
  }
}

async function loadBetterSqlite3(): Promise<any | null> {
  try {
    const mod: string = 'better-sqlite3';
    return (await import(mod)).default;
  } catch {
    return null;
  }
}
