/**
 * router-parallel-recorder.ts — Opt-in SelfEvolvingRouter parallel-logging
 * recorder (ADR-150 Phase 2).
 *
 * Writes one JSON-line per PAIR of routing decisions (Thompson bandit pick
 * + SelfEvolvingRouter pick + measured outcome) to a shared
 * `.swarm/router-parallel.jsonl`. Designed to be matched by
 * `plugins/ruflo-metaharness/scripts/router-parallel-analyze.mjs` which
 * computes the 3-criteria AND-gate from ADR-150 review-round-1:
 *
 *   (a) qualityScore improvement > 2%
 *   (b) usdPerDecision increase   < 1%
 *   (c) p95 routing-decision latency increase < 5%
 *
 * ARCHITECTURAL CONSTRAINTS (ADR-150)
 * -----------------------------------
 * 1. REMOVABLE — `@metaharness/kernel` (which provides SelfEvolvingRouter)
 *    is in optionalDependencies. This module's exports are pure-shape; the
 *    `SerPick` carries pre-computed prediction fields. The caller is
 *    responsible for dynamic-importing the kernel and computing the SER
 *    pick — this module ONLY records the pair.
 * 2. OPTIONAL — every write goes through the `CLAUDE_FLOW_ROUTER_PARALLEL_LOG=1`
 *    env gate. When unset (default), `recordPair()` is a no-op.
 * 3. GRACEFUL DEGRADATION — every fs operation is try/caught at the
 *    appendFileSync boundary. A failed write logs to stderr (gated by
 *    DEBUG) but never throws — the routing decision continues.
 * 4. CI GATE — the analyzer + recorder are both exercised by smoke
 *    fixtures; no production data required for the contract to hold.
 *
 * SCHEMA (versioned, additive)
 * ----------------------------
 * One JSONL row per paired decision:
 *   {
 *     v: 1,
 *     ts: ISO-8601,
 *     task_hash: <FNV-1a-32 of task text>,
 *     task?: <truncated to 500 chars when CLAUDE_FLOW_ROUTER_PARALLEL_LOG_TASK=1>,
 *     bandit: { pick, predictedQuality, predictedCostUsd, ... },
 *     ser:    { pick, predictedQuality, predictedCostUsd, ... },
 *     outcome?: { actualModel, actualQuality, actualUsd, actualLatencyMs }
 *   }
 *
 * Outcomes can be filled in a separate `recordPairOutcome()` call (matched
 * by task_hash) so the routing path doesn't have to wait for execution.
 *
 * @module router-parallel-recorder
 */

import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import type { ClaudeModel } from './model-router.js';
import { taskHash } from './router-trajectory.js';

// ============================================================================
// Schema (versioned, additive)
// ============================================================================

/** Per-arm prediction for one routing decision. */
export interface ArmPick {
  pick: ClaudeModel;
  predictedQuality: number;        // 0..1 (model's own predicted quality on this task)
  predictedCostUsd: number;        // $/decision at the picked model
  /** Optional: backend identifier (bandit | metaharness-knn | metaharness-krr | self-evolving). */
  backend?: string;
}

/** Optional outcome — filled in after execution via recordPairOutcome(). */
export interface PairOutcome {
  /** Whichever model actually executed (typically the bandit's pick). */
  actualModel: ClaudeModel;
  /** Measured quality score from the verdict ladder (0..1). */
  actualQuality: number;
  /** Measured spend at actualModel's prices. */
  actualUsd: number;
  /** Wall-clock latency from route() to response complete (ms). */
  actualLatencyMs: number;
}

/** Discriminator for JSONL rows. */
export type RowType = 'pair' | 'pair-outcome';

/** One paired-decision row. */
export interface PairRow {
  v: 1;
  type: RowType;
  ts: string;
  task_hash: string;
  task?: string;                   // only present when explicit env opt-in
  bandit: ArmPick;
  ser: ArmPick;
  outcome?: PairOutcome;
}

// ============================================================================
// Config + rotation
// ============================================================================

interface RecorderConfig {
  enabled: boolean;
  path: string;
  /** Include the task text in rows (PII/retention concern; default off). */
  includeTaskText: boolean;
  /** Truncate task to this many chars when includeTaskText is on. */
  taskCharLimit: number;
  /** Rotate when file exceeds this size. */
  maxBytes: number;
}

let _cfg: RecorderConfig | null = null;

function getConfig(): RecorderConfig {
  if (_cfg !== null) return _cfg;
  _cfg = {
    enabled: process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG === '1',
    path: process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG_PATH
      ? resolvePath(process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG_PATH)
      : resolvePath('.swarm', 'router-parallel.jsonl'),
    includeTaskText: process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG_TASK === '1',
    taskCharLimit: parseInt(process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG_TASK_LIMIT || '500', 10),
    maxBytes: parseInt(process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG_MAX_BYTES || String(10 * 1024 * 1024), 10),
  };
  return _cfg;
}

function rotate(cfg: RecorderConfig): void {
  try {
    const backup = `${cfg.path}.1`;
    if (existsSync(backup)) unlinkSync(backup);
    renameSync(cfg.path, backup);
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('router-parallel: rotate failed:', (e as Error).message);
    }
  }
}

function appendRow(row: PairRow): void {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  try {
    const dir = dirname(cfg.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(cfg.path)) {
      try {
        const st = statSync(cfg.path);
        if (st.size >= cfg.maxBytes) rotate(cfg);
      } catch { /* stat race is fine */ }
    }
    appendFileSync(cfg.path, JSON.stringify(row) + '\n');
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('router-parallel: appendRow failed:', (e as Error).message);
    }
    // ADR-150 rule #3 — never throw, never block the routing path.
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Record one paired routing decision. Cheap — single appendFileSync of a
 * JSONL row. No-op when CLAUDE_FLOW_ROUTER_PARALLEL_LOG is unset (the
 * default). Never throws.
 *
 * The caller dynamic-imports `@metaharness/kernel` (or any alternative
 * predictor) and computes the SER pick BEFORE calling this. The recorder
 * deliberately knows nothing about how either pick was computed — it just
 * writes the pair.
 */
export function recordPair(args: {
  task: string;
  bandit: ArmPick;
  ser: ArmPick;
}): { recorded: boolean; taskHash: string } {
  const cfg = getConfig();
  const hash = taskHash(args.task);
  if (!cfg.enabled) return { recorded: false, taskHash: hash };

  const row: PairRow = {
    v: 1,
    type: 'pair',
    ts: new Date().toISOString(),
    task_hash: hash,
    bandit: args.bandit,
    ser: args.ser,
  };
  if (cfg.includeTaskText) {
    row.task = args.task.length > cfg.taskCharLimit
      ? args.task.slice(0, cfg.taskCharLimit) + '…'
      : args.task;
  }
  appendRow(row);
  return { recorded: true, taskHash: hash };
}

/**
 * Record the outcome of a previously-paired decision. Matched to its
 * pair row by task_hash. Writes a separate JSONL row of type 'outcome'
 * which the analyzer joins client-side (same pattern as the existing
 * router-trajectory recorder).
 *
 * Returns the task_hash that was matched (caller can verify against
 * what recordPair() returned).
 */
export function recordPairOutcome(args: {
  task: string;
  outcome: PairOutcome;
}): { recorded: boolean; taskHash: string } {
  const cfg = getConfig();
  const hash = taskHash(args.task);
  if (!cfg.enabled) return { recorded: false, taskHash: hash };
  const row: PairRow = {
    v: 1,
    type: 'pair-outcome',
    ts: new Date().toISOString(),
    task_hash: hash,
    bandit: { pick: args.outcome.actualModel, predictedQuality: 0, predictedCostUsd: 0 },
    ser: { pick: args.outcome.actualModel, predictedQuality: 0, predictedCostUsd: 0 },
    outcome: args.outcome,
  };
  appendRow(row);
  return { recorded: true, taskHash: hash };
}

/**
 * Status helper for diagnostics / smoke tests.
 */
export function parallelRecorderStatus(): {
  enabled: boolean;
  path: string;
  includeTaskText: boolean;
  taskCharLimit: number;
  maxBytes: number;
} {
  const cfg = getConfig();
  return {
    enabled: cfg.enabled,
    path: cfg.path,
    includeTaskText: cfg.includeTaskText,
    taskCharLimit: cfg.taskCharLimit,
    maxBytes: cfg.maxBytes,
  };
}

/** @internal — test helper. */
export function __resetParallelRecorderForTests(): void {
  _cfg = null;
}
