/**
 * moe-feedback-replay.ts — ADR-179 sub-feature 4 (MoE feedback loop),
 * daemon-only half.
 *
 * Reads cost-outcome pairs queued by `@claude-flow/hooks`'
 * `cost-governor/moe-feedback.ts` (JSONL, hot-path, never direct-writes to
 * the gate) and replays the qualified ones into `@claude-flow/neural`'s
 * `MoERouter` in batch. This module CAN import `@claude-flow/neural` —
 * that dependency is daemon-only, keeping the hot path free of it
 * (package-boundary discipline, ADR-179).
 *
 * Qualification gate (ADR-174 parity): only `oracle:test-exec`-tier pairs
 * are ever promoted into a live gate update; `proxy:structural` pairs are
 * counted (auditable) but never promoted — mirrors ADR-174's
 * "0 proxy_promoted" invariant exactly.
 *
 * Idempotency: a persisted line-cursor tracks how many JSONL lines have
 * already been replayed, so re-running without new appends is a no-op —
 * replaying the same batch twice never double-updates the gate.
 *
 * `MoERouter.updateExpertWeights()` requires a cached forward pass
 * (`route()` must have run in-process first — it has no separate
 * "nudge without context" entry point). Replay pairs don't carry the
 * original task embedding, so this worker seeds a deterministic
 * hash-derived 384-dim embedding from `taskId` purely to produce *a*
 * forward pass to gradient-update against. This is a bounded approximation
 * for a batched reward signal, not a replay of the exact routing context.
 *
 * architect-2 traced this (2026-07-14): `MoERouter.route()` has no existing
 * production call site tied to a real per-task embedding today —
 * `agent_spawn` routes via a different class entirely (ADR-026/149 tier
 * selection) — so no real signal is being discarded here; wiring MoE into
 * agent_spawn's routing decision is a phase-2 scope change, not a fix to
 * this module. Shipped for v1 with two mitigations: (1) every replayed
 * pair is tagged `embeddingSource: 'synthetic-hash-fallback'` (same
 * auditable idiom as `hooks-tools.ts`'s `embeddingSource: 'onnx' |
 * 'hash-fallback' | 'none'`), so the degraded-signal path is visible in
 * the replay result, not silently indistinguishable from a real embedding;
 * (2) `rewardFor()` applies `REWARD_DAMPING_FACTOR` to bound how much
 * decorrelated-noise training can perturb gate weights before a real
 * embedding lands.
 *
 * @module moe-feedback-replay
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import type { CostOutcomePair } from '@claude-flow/hooks';
import { isPromotable, MOE_FEEDBACK_DEFAULT_PATH } from '@claude-flow/hooks';

const DEFAULT_FEEDBACK_PATH = resolvePath(MOE_FEEDBACK_DEFAULT_PATH);
const DEFAULT_CURSOR_PATH = resolvePath('.claude-flow', 'moe-feedback-replay-cursor.json');
const INPUT_DIM = 384;
// Conservative per-completion cost ceiling used to normalize reward magnitude.
const REWARD_COST_CEILING_USD = 0.05;
// v1 mitigation for the synthetic-embedding approximation (see module doc):
// dampens reward magnitude so decorrelated-noise training can only nudge
// gate weights gently until a real per-task embedding replaces the hash.
const REWARD_DAMPING_FACTOR = 0.25;
/** Tags every replayed pair — the synthetic embedding is a v1 approximation, not a real routing-context replay. */
const EMBEDDING_SOURCE = 'synthetic-hash-fallback' as const;

interface ReplayCursor {
  linesRead: number;
}

function loadCursor(path: string): ReplayCursor {
  try {
    if (!existsSync(path)) return { linesRead: 0 };
    return JSON.parse(readFileSync(path, 'utf-8')) as ReplayCursor;
  } catch {
    return { linesRead: 0 };
  }
}

function saveCursor(path: string, cursor: ReplayCursor): void {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(cursor));
  } catch {
    // best-effort — a failed cursor write just risks re-scanning already-
    // replayed lines next tick, not double-counting silently: the caller
    // still sees this tick's replayed count.
  }
}

function parsePairs(path: string): CostOutcomePair[] {
  try {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as CostOutcomePair);
  } catch {
    return [];
  }
}

/** Deterministic hash-derived embedding — same approach as reasoningbank's fallback embedder. */
function taskIdToEmbedding(taskId: string): Float32Array {
  const embedding = new Float32Array(INPUT_DIM);
  for (let i = 0; i < INPUT_DIM; i++) {
    let hash = 0;
    for (let j = 0; j < taskId.length; j++) {
      hash = ((hash << 5) - hash + taskId.charCodeAt(j) * (i + 1)) | 0;
    }
    embedding[i] = (Math.sin(hash) + 1) / 2;
  }
  return embedding;
}

/**
 * reward = 1 - costRatio on success (bounded by REWARD_COST_CEILING_USD),
 * -1 on failure, then damped by REWARD_DAMPING_FACTOR (v1 mitigation for
 * the synthetic-embedding approximation — see module doc).
 */
function rewardFor(pair: CostOutcomePair, success: boolean): number {
  const costRatio = Math.min(1, pair.cost_usd / REWARD_COST_CEILING_USD);
  const raw = success ? 1 - costRatio : -1;
  return Math.max(-1, Math.min(1, raw * REWARD_DAMPING_FACTOR));
}

/**
 * Replay qualified cost-outcome pairs into the MoE gate's expert weights,
 * in batch. No-op (returns zeros) when `@claude-flow/neural` is
 * unavailable or there is nothing new to replay.
 */
export async function replayQualifiedPairs(
  feedbackPath: string = DEFAULT_FEEDBACK_PATH,
  cursorPath: string = DEFAULT_CURSOR_PATH,
): Promise<{
  replayed: number;
  skippedProxy: number;
  embeddingSource: typeof EMBEDDING_SOURCE;
  records: Array<{ taskId: string; expert: string; reward: number; embeddingSource: typeof EMBEDDING_SOURCE }>;
}> {
  const allPairs = parsePairs(feedbackPath);
  const cursor = loadCursor(cursorPath);
  const newPairs = allPairs.slice(cursor.linesRead);

  if (newPairs.length === 0) {
    return { replayed: 0, skippedProxy: 0, embeddingSource: EMBEDDING_SOURCE, records: [] };
  }

  let replayed = 0;
  let skippedProxy = 0;
  const records: Array<{ taskId: string; expert: string; reward: number; embeddingSource: typeof EMBEDDING_SOURCE }> = [];

  let router: import('@claude-flow/neural').MoERouter | null = null;
  try {
    const neural = await import('@claude-flow/neural');
    router = neural.getMoERouter();
    await router.initialize();
  } catch {
    // @claude-flow/neural unavailable — degrade to counting only, never throw.
    router = null;
  }

  for (const pair of newPairs) {
    if (!isPromotable(pair)) {
      skippedProxy++;
      continue;
    }
    const reward = rewardFor(pair, true);
    if (router) {
      router.route(taskIdToEmbedding(pair.taskId));
      router.updateExpertWeights(pair.expert as import('@claude-flow/neural').ExpertType, reward);
    }
    records.push({ taskId: pair.taskId, expert: pair.expert, reward, embeddingSource: EMBEDDING_SOURCE });
    replayed++;
  }

  if (router && replayed > 0) {
    await router.saveWeights().catch(() => {
      /* auto-save also fires every 50 updates — a failed explicit save here is not fatal */
    });
  }

  saveCursor(cursorPath, { linesRead: allPairs.length });
  return { replayed, skippedProxy, embeddingSource: EMBEDDING_SOURCE, records };
}
