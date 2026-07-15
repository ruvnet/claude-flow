/**
 * cost-governor/moe-feedback.ts — ADR-179 sub-feature 4 (MoE feedback
 * loop), hot-path half.
 *
 * Cost-outcome pairs are queued (JSONL append, same recorder discipline as
 * `events.ts`/ADR-150), never direct-written to live MoE gate weights from
 * this hot path — keeps `@claude-flow/hooks` free of a runtime dependency
 * on `@claude-flow/neural`. A daemon worker (`moe-feedback-replay`, in
 * `@claude-flow/cli/src/services/moe-feedback-replay.ts`, which CAN import
 * `@claude-flow/neural`) periodically replays qualified pairs into
 * `MoERouter.updateExpertWeights()` in batch.
 *
 * ADR-174 integration point: only `oracle:test-exec`-tier pairs are ever
 * promoted; `proxy:structural` pairs are recorded (auditable) but never
 * promoted — `isPromotable()` is the single qualification predicate both
 * this module and the replay worker agree on.
 *
 * @module @claude-flow/hooks/cost-governor/moe-feedback
 */

import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CostEvent, CostGovernorConfig } from './types.js';
import { loadCostGovernorConfig } from './types.js';

/** Same oracle/proxy provenance ladder ADR-171/174 already define. */
export type ProvenanceTier = 'oracle:test-exec' | 'proxy:structural';

export interface CostOutcomePair {
  cost_usd: number;
  tier: CostEvent['tier'];
  expert: string;
  provenance: ProvenanceTier;
  taskId: string;
  ts: string;
}

const DEFAULT_PATH = '.swarm/moe-feedback.jsonl';
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

function rotate(path: string): void {
  try {
    const backup = `${path}.1`;
    if (existsSync(backup)) unlinkSync(backup);
    renameSync(path, backup);
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('cost-governor: moe-feedback rotate failed:', (e as Error).message);
    }
  }
}

function appendRow(path: string, pair: CostOutcomePair): void {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(path)) {
      try {
        const st = statSync(path);
        if (st.size >= DEFAULT_MAX_BYTES) rotate(path);
      } catch {
        /* stat race is fine */
      }
    }
    appendFileSync(path, JSON.stringify(pair) + '\n');
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('cost-governor: moe-feedback appendRow failed:', (e as Error).message);
    }
    // never throw — the hot path this pair describes continues regardless
  }
}

/**
 * The single qualification gate: a pair may only be promoted into a live
 * MoE gate update when it carries oracle-tier provenance. Mirrors ADR-174's
 * "0 proxy_promoted" invariant exactly — enforced here AND in the replay
 * worker so both sides agree on the same predicate.
 */
export function isPromotable(pair: Pick<CostOutcomePair, 'provenance'>): boolean {
  return pair.provenance === 'oracle:test-exec';
}

/**
 * Queue a cost-outcome pair for later batched replay. No-op when disabled
 * (the default). Never direct-writes to the MoE gate — see
 * `moe-feedback-replay.ts` (cli package, daemon-only) for the actual
 * weight-update path.
 */
export function queueCostOutcomePair(
  pair: CostOutcomePair,
  cfg: CostGovernorConfig['moeFeedback'] = loadCostGovernorConfig().moeFeedback,
  path: string = DEFAULT_PATH,
): void {
  if (!cfg.enabled) return;
  appendRow(path, pair);
}

export { DEFAULT_PATH as MOE_FEEDBACK_DEFAULT_PATH };
