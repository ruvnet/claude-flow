/**
 * cost-governor/events.ts — ADR-179 sub-feature 3 (cost tracking,
 * `harness:cost-event`).
 *
 * One `CostEvent` is emitted per model completion (not per token — the
 * issue's literal "per token" wording would emit 10k+ events/task for no
 * additional information over per-completion granularity carrying token
 * counts). Reuses the exact ADR-150 `router-parallel-recorder.ts` pattern:
 * opt-in env-gated JSONL append, try/caught at the write boundary (never
 * throws, DEBUG-gated stderr log on failure), size-based rotation.
 *
 * Package-boundary note: `@claude-flow/hooks` has no runtime dependency on
 * `@claude-flow/cli`. `cost_usd` is computed via an INJECTED `costUsd`
 * callback (the caller passes `model-prices.ts`'s `costUsd()`) rather than
 * reinventing pricing logic here.
 *
 * @module @claude-flow/hooks/cost-governor/events
 */

import { appendFileSync, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CostEvent, CostGovernorConfig } from './types.js';

/** Matches model-prices.ts's costUsd() signature — never returns undefined. */
export type CostUsdFn = (
  modelId: string | undefined,
  tokensIn: number | undefined,
  tokensOut: number | undefined,
) => number;

export type EmitCostEventArgs = Omit<CostEvent, 'v' | 'ts' | 'cost_usd'>;

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const RING_BUFFER_SIZE = 500;

/** Bounded in-memory ring buffer backing live statusline/status queries. */
let ringBuffer: CostEvent[] = [];

function rotate(path: string): void {
  try {
    const backup = `${path}.1`;
    if (existsSync(backup)) unlinkSync(backup);
    renameSync(path, backup);
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('cost-governor: rotate failed:', (e as Error).message);
    }
  }
}

function appendRow(path: string, event: CostEvent): void {
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
    appendFileSync(path, JSON.stringify(event) + '\n');
  } catch (e) {
    if (process.env.DEBUG) {
      // eslint-disable-next-line no-console
      console.error('cost-governor: appendRow failed:', (e as Error).message);
    }
    // never throw — the execution path this event describes continues regardless
  }
}

/**
 * Emit one CostEvent for a completed model call. No-op (returns null) when
 * `cfg.enabled` is false — the default. `trimmed_entries`/`batched_calls`/
 * `diversity_score` are supplied by the caller when sub-features 1/2/5 are
 * active for the same completion (shared correlation_id/task_id).
 */
export function emitCostEvent(
  args: EmitCostEventArgs,
  cfg: CostGovernorConfig['costEvents'],
  costUsd: CostUsdFn,
): CostEvent | null {
  if (!cfg.enabled) return null;

  const event: CostEvent = {
    v: 1,
    ts: new Date().toISOString(),
    cost_usd: costUsd(args.model, args.tokens_in, args.tokens_out),
    ...args,
  };

  ringBuffer.push(event);
  if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer = ringBuffer.slice(-RING_BUFFER_SIZE);

  appendRow(cfg.path, event);
  return event;
}

/** Live in-process ring buffer (bounded, most-recent `limit`) for status queries. */
export function getRecentCostEvents(limit: number = RING_BUFFER_SIZE): CostEvent[] {
  return ringBuffer.slice(-limit);
}

/** @internal test helper — clears the module-scoped ring buffer between tests. */
export function __resetCostEventRingBufferForTests(): void {
  ringBuffer = [];
}
