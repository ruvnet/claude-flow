/**
 * router-trajectory.ts — Opt-in DRACO-shaped trajectory recorder for the
 * cost-optimal model router (ADR-148, phase 5).
 *
 * Writes one JSON-line per routing decision and one per outcome to a
 * shared `.swarm/model-router-trajectories.jsonl`. Outcome rows are
 * matched to their decision via `task_hash` (FNV-1a-32 of the task text).
 *
 * Gated behind `CLAUDE_FLOW_ROUTER_TRAJECTORY=1`. Default: **off** — rows
 * carry full task text + raw embeddings, which is a PII/retention surface
 * we do not enable without explicit consent.
 *
 * Schema is versioned (`"v": 1`). New required fields bump the version;
 * additive optional fields do not.
 *
 * COMPANION: run-transcript-recorder.ts (weight-eft capture path)
 * --------------------------------------------------------------
 * This recorder captures the routing DECISION only (task, embedding, scalar
 * quality, tokens, cost) — enough to retrain the router. It deliberately does
 * NOT carry the full message transcript, the produced patch, or a resolved
 * boolean. `@metaharness/weight-eft` needs those to build SFT/DPO training
 * rows, so a SEPARATE opt-in recorder — `run-transcript-recorder.ts` — captures
 * the full run transcript to `.swarm/run-transcripts.jsonl`. Both share the
 * `taskHash()` below as their join key, and both are off-by-default for the
 * same PII/retention reason. Use `unifiedRecorderStatus()` (bottom of this
 * file) to inspect both at once. Keeping them as two files keeps the routing
 * hot path free of the heavier transcript payload.
 *
 * @module router-trajectory
 */

import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';

import type { ClaudeModel } from './model-router.js';
import type { NeuralRoutedBy } from './neural-router.js';
import { costUsd } from './model-prices.js';

// ============================================================================
// Schema (versioned)
// ============================================================================

/** A single routing decision — written at `route()` time. */
export interface TrajectoryDecisionRow {
  v: 1;
  type: 'decision';
  ts: string;                                  // ISO-8601, no millisecond ambiguity
  task_hash: string;                           // FNV-1a-32 hex of task text
  task: string;                                // ≤500 chars (truncated)
  embedding?: number[];                        // only present when supplied to route()
  complexity: number;                          // 0..1 from the heuristic features
  model: ClaudeModel;
  confidence: number;                          // 0..1
  uncertainty: number;                         // 0..1
  routed_by: 'hybrid' | 'bandit-fallback' | 'heuristic';
  /** Underlying neural backend when routed_by='hybrid', else absent. */
  neural_backend?: 'metaharness-knn' | 'metaharness-krr' | 'fastgrnn';
  /**
   * A/B mode (CLAUDE_FLOW_ROUTER_AB=1) attaches both the bandit-only pick
   * and the hybrid pick so disagreement rate is measurable over time.
   */
  ab_pair?: {
    bandit_pick: ClaudeModel;
    hybrid_pick: ClaudeModel;
    disagree: boolean;
  };
  /** Execution provider hint (phase 2): 'anthropic' or 'openrouter'. */
  provider?: 'anthropic' | 'openrouter';
  /** Concrete OpenRouter model slug when provider=openrouter. */
  openrouter_model?: string;
  /**
   * iter 46 — ensemble-disagreement diagnostic from iter 45. Absolute
   * difference between unified KRR and bucket specialist predictions for
   * the picked model. Set when both backends were queried (bucket
   * specialist available + bucket supplied). Persisting per-decision lets
   * a future tuner analyze the distribution and recommend an iter 44
   * threshold.
   */
  ensemble_disagreement?: number;
}

/** A routing outcome — written later by the caller via `recordOutcome()`. */
export interface TrajectoryOutcomeRow {
  v: 1;
  type: 'outcome';
  ts: string;
  task_hash: string;
  /** 0..1 measured quality the chosen model achieved. */
  quality: number;
  /** Optional per-model quality if the same query was evaluated against alternates. */
  scores?: Record<string, number>;
  /** Free-form provenance note (e.g. "manual rating", "benchmark suite"). */
  source?: string;
  /**
   * iter 31 — token usage from the underlying API response. Optional and
   * additive: pre-iter-31 readers see undefined; iter-31+ consumers can
   * sum these for production cost accounting. `modelId` is repeated here
   * (also in the paired decision row) so cost computation needs only the
   * outcome row — no JOIN required for streaming aggregation.
   */
  tokens?: { input: number; output: number };
  /** USD spend for this call. Computed at write time from `tokens` + the
   *  shared price table (model-prices.ts) so consumers get a canonical
   *  number even if prices change between write and read. */
  cost_usd?: number;
  /** Concrete model id the call dispatched against (iter 13+ wired this
   *  through agent.modelId). May differ from the bandit's tier label. */
  model_id?: string;
}

export type TrajectoryRow = TrajectoryDecisionRow | TrajectoryOutcomeRow;

// ============================================================================
// FNV-1a-32 (matches scripts/gen-seed-corpus.mjs)
// ============================================================================

export function taskHash(task: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < task.length; i++) {
    h ^= task.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ============================================================================
// Recorder state
// ============================================================================

interface RecorderConfig {
  enabled: boolean;
  path: string;
  /** Max task chars to persist (default 500). */
  taskCharLimit: number;
  /** Max bytes before rotating (default 10 MB). 0 disables rotation. */
  maxSizeBytes: number;
  /** How many rotation backups to keep (default 3, named .1, .2, .3). */
  maxRotations: number;
}

let _cfg: RecorderConfig | null = null;
/** Cached size of the current file; updated incrementally on each append to
 *  avoid a `statSync` per write. -1 means "unknown, probe on next append". */
let _cachedSize = -1;

function getConfig(): RecorderConfig {
  if (_cfg !== null) return _cfg;
  const enabled = process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY === '1';
  const swarmDir = process.env.CLAUDE_FLOW_SWARM_DIR
    ?? resolvePath(process.cwd(), '.swarm');
  _cfg = {
    enabled,
    path: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? join(swarmDir, 'model-router-trajectories.jsonl'),
    taskCharLimit: parseInt(process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_TASKLEN ?? '500', 10) || 500,
    maxSizeBytes: parseInt(process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXSIZE ?? `${10 * 1024 * 1024}`, 10) | 0,
    maxRotations: Math.max(0, parseInt(process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_MAXROTATIONS ?? '3', 10) || 3),
  };
  return _cfg;
}

/** Rotate `path` → `path.1`, `path.1` → `path.2`, ..., dropping the oldest. */
function rotate(cfg: RecorderConfig): void {
  if (!existsSync(cfg.path)) return;
  try {
    // Walk from oldest to newest so each rename has a free target.
    if (cfg.maxRotations === 0) {
      // No history kept — just truncate by deleting.
      unlinkSync(cfg.path);
      return;
    }
    const oldest = `${cfg.path}.${cfg.maxRotations}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = cfg.maxRotations - 1; i >= 1; i--) {
      const src = `${cfg.path}.${i}`;
      if (existsSync(src)) renameSync(src, `${cfg.path}.${i + 1}`);
    }
    renameSync(cfg.path, `${cfg.path}.1`);
  } catch {
    // If rotation fails (permissions, race), drop back to overwriting the
    // active file by truncating its handle. Worst case we lose history.
    try { unlinkSync(cfg.path); } catch { /* */ }
  }
  _cachedSize = 0;
}

function appendRow(row: TrajectoryRow): void {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  try {
    const dir = dirname(cfg.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Probe size lazily on first call this process, then track incrementally.
    if (_cachedSize < 0) {
      _cachedSize = existsSync(cfg.path) ? statSync(cfg.path).size : 0;
    }

    // One JSON object per line, newline-terminated. No leading whitespace —
    // we want the file to be `jq -c`-friendly.
    const line = JSON.stringify(row) + '\n';
    const bytes = Buffer.byteLength(line, 'utf8');

    // Rotate BEFORE writing if this row would push us past the cap.
    if (cfg.maxSizeBytes > 0 && _cachedSize + bytes > cfg.maxSizeBytes) {
      rotate(cfg);
    }

    appendFileSync(cfg.path, line);
    _cachedSize += bytes;
  } catch {
    // Silent: trajectory collection must never break routing.
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Record one decision. Cheap — a single appendFileSync of a JSONL row. */
export function recordDecision(args: {
  task: string;
  embedding?: number[];
  complexity: number;
  model: ClaudeModel;
  confidence: number;
  uncertainty: number;
  routedBy: TrajectoryDecisionRow['routed_by'];
  neuralBackend?: TrajectoryDecisionRow['neural_backend'];
  abPair?: TrajectoryDecisionRow['ab_pair'];
  provider?: TrajectoryDecisionRow['provider'];
  openrouterModel?: TrajectoryDecisionRow['openrouter_model'];
  /** iter 46 — optional ensemble disagreement diagnostic (iter 45). */
  ensembleDisagreement?: number;
}): void {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const row: TrajectoryDecisionRow = {
    v: 1, type: 'decision',
    ts: new Date().toISOString(),
    task_hash: taskHash(args.task),
    task: args.task.length > cfg.taskCharLimit ? args.task.slice(0, cfg.taskCharLimit) : args.task,
    embedding: args.embedding,
    complexity: args.complexity,
    model: args.model,
    confidence: args.confidence,
    uncertainty: args.uncertainty,
    routed_by: args.routedBy,
    ...(args.neuralBackend ? { neural_backend: args.neuralBackend } : {}),
    ...(args.abPair ? { ab_pair: args.abPair } : {}),
    ...(args.provider ? { provider: args.provider } : {}),
    ...(args.openrouterModel ? { openrouter_model: args.openrouterModel } : {}),
    ...(args.ensembleDisagreement !== undefined ? { ensemble_disagreement: args.ensembleDisagreement } : {}),
  };
  appendRow(row);
}

/** Record one outcome. Join to a decision by `task_hash`. */
export function recordTrajectoryOutcome(args: {
  task: string;
  quality: number;
  scores?: Record<string, number>;
  source?: string;
  /** iter 31 — optional token usage from the underlying API call. */
  tokens?: { input: number; output: number };
  /** iter 31 — concrete model id for cost computation against MODEL_PRICES. */
  modelId?: string;
}): void {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  // iter 31 — compute USD spend at write time using the canonical price
  // table. Cost is a first-class field so consumers don't need to JOIN
  // against the decision row (which may live in a rotated file).
  const cost_usd = args.tokens && (args.tokens.input > 0 || args.tokens.output > 0)
    ? costUsd(args.modelId, args.tokens.input, args.tokens.output)
    : undefined;
  const row: TrajectoryOutcomeRow = {
    v: 1, type: 'outcome',
    ts: new Date().toISOString(),
    task_hash: taskHash(args.task),
    quality: args.quality,
    scores: args.scores,
    source: args.source,
    ...(args.tokens ? { tokens: args.tokens } : {}),
    ...(cost_usd != null ? { cost_usd } : {}),
    ...(args.modelId ? { model_id: args.modelId } : {}),
  };
  appendRow(row);
}

/** Diagnostic for status/CLI. */
export function trajectoryRecorderStatus(): { enabled: boolean; path: string; taskCharLimit: number } {
  return { ...getConfig() };
}

// ============================================================================
// Trajectory → Training-row pairing (iter 18 — consumer side of iter 17)
// ============================================================================

/** A training row reconstructed from one decision+outcome pair. Shape matches
 *  the bundled seed-corpus (`seed-rows.json`) so the same train-bundled-krr.mjs
 *  pipeline can consume it. */
export interface PairedTrainingRow {
  task: string;
  embedding: number[];
  scores: Record<string, number>;
  tier: 'cheap' | 'mid' | 'strong';
  /** Provenance — useful for filtering low-signal sources at training time. */
  source: string;
  /** ISO timestamp of the outcome row (newer rows can be weighted higher). */
  ts: string;
}

/** Map decision-side complexity ∈ [0,1] back to the corpus tier label. The
 *  buckets are deliberately the same boundaries the bandit uses so a pair
 *  drawn from production lands in the same KRR specialist that served it. */
export function tierFromComplexity(complexity: number): 'cheap' | 'mid' | 'strong' {
  if (complexity < 0.34) return 'cheap';
  if (complexity < 0.67) return 'mid';
  return 'strong';
}

/** Pair decision+outcome rows by task_hash. Returns the rebuilt training rows
 *  + diagnostics so the caller (script or test) can report what was dropped
 *  and why. */
export function pairTrajectoryRows(
  rows: TrajectoryRow[],
): {
  pairs: PairedTrainingRow[];
  stats: {
    totalRows: number;
    decisions: number;
    outcomes: number;
    paired: number;
    droppedNoEmbedding: number;
    droppedNoMatch: number;
    bySource: Record<string, number>;
    byTier: Record<string, number>;
  };
} {
  const decisions = new Map<string, TrajectoryDecisionRow>();
  const outcomes = new Map<string, TrajectoryOutcomeRow>();

  // Latest-wins per hash. Production may re-run the same task — using the most
  // recent outcome avoids polluting the corpus with stale judgments.
  let dCount = 0, oCount = 0;
  for (const row of rows) {
    if (row.type === 'decision') {
      dCount++;
      const prev = decisions.get(row.task_hash);
      if (!prev || row.ts > prev.ts) decisions.set(row.task_hash, row);
    } else if (row.type === 'outcome') {
      oCount++;
      const prev = outcomes.get(row.task_hash);
      if (!prev || row.ts > prev.ts) outcomes.set(row.task_hash, row);
    }
  }

  const pairs: PairedTrainingRow[] = [];
  const bySource: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  let droppedNoEmbedding = 0;
  let droppedNoMatch = 0;

  for (const [hash, dec] of decisions) {
    const out = outcomes.get(hash);
    if (!out) { droppedNoMatch++; continue; }
    if (!dec.embedding || dec.embedding.length === 0) { droppedNoEmbedding++; continue; }

    // scores map: prefer the outcome's full per-model map (set by callers who
    // ran multi-model comparisons); fall back to a single-model entry derived
    // from the model the decision actually dispatched.
    const scores: Record<string, number> = out.scores
      ?? { [dec.openrouter_model ?? dec.model]: out.quality };

    const tier = tierFromComplexity(dec.complexity);
    const source = out.source ?? 'unknown';

    pairs.push({
      task: dec.task,
      embedding: dec.embedding,
      scores,
      tier,
      source,
      ts: out.ts,
    });

    bySource[source] = (bySource[source] ?? 0) + 1;
    byTier[tier] = (byTier[tier] ?? 0) + 1;
  }

  return {
    pairs,
    stats: {
      totalRows: rows.length,
      decisions: dCount,
      outcomes: oCount,
      paired: pairs.length,
      droppedNoEmbedding,
      droppedNoMatch,
      bySource,
      byTier,
    },
  };
}

/** Test seam — reset cached config so unit tests can change env vars between cases. */
export function __resetTrajectoryRecorderForTests(): void {
  _cfg = null;
  _cachedSize = -1;
}

/**
 * Unified status for BOTH the routing-decision recorder (this module) and the
 * companion run-transcript recorder (the weight-eft capture path). The
 * run-transcript recorder is loaded dynamically so this module has no static
 * dependency on it (the reverse edge — run-transcript-recorder → taskHash —
 * is the only static link, keeping the import acyclic).
 */
export async function unifiedRecorderStatus(): Promise<{
  routerTrajectory: { enabled: boolean; path: string; taskCharLimit: number };
  runTranscripts: { enabled: boolean; path: string } | { unavailable: true };
}> {
  const routerTrajectory = trajectoryRecorderStatus();
  try {
    const mod = await import('./run-transcript-recorder.js');
    const s = mod.runTranscriptRecorderStatus();
    return { routerTrajectory, runTranscripts: { enabled: s.enabled, path: s.path } };
  } catch {
    return { routerTrajectory, runTranscripts: { unavailable: true } };
  }
}
