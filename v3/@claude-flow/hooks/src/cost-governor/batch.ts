/**
 * cost-governor/batch.ts — ADR-179 sub-feature 2 (tool batching).
 *
 * Coalesces sequential, read-only, side-effect-free tool calls arriving
 * within a sliding window into a single concurrent dispatch. The window is
 * anchored to the *first* queued call (not a resetting debounce, which can
 * starve indefinitely under continuous back-to-back calls): flush fires
 * when `now - firstQueuedAt >= windowMs`, OR `queue.length >= maxBatchSize`,
 * OR a non-batchable call arrives (pending batch flushes first, preserving
 * order, then the non-batchable call fires immediately).
 *
 * Mutating tools (`Bash`, `Edit`, `Write`, `NotebookEdit`, MCP write-tools)
 * are must-fire-immediately — deferring them risks masking
 * ordering-dependent side effects, a correctness hazard batching must never
 * introduce.
 *
 * @module @claude-flow/hooks/cost-governor/batch
 */

import type { CostGovernorConfig } from './types.js';

/** Read-only, side-effect-free tools eligible for coalescing. */
const BATCHABLE_TOOLS: ReadonlySet<string> = new Set(['Read', 'Grep', 'Glob']);

/**
 * True when `toolName` may be queued for batching: the built-in read-only
 * set, or an MCP tool explicitly tagged read-only via `readOnlyMcpTools`.
 */
export function isBatchableTool(toolName: string, readOnlyMcpTools: ReadonlySet<string> = new Set()): boolean {
  return BATCHABLE_TOOLS.has(toolName) || readOnlyMcpTools.has(toolName);
}

export interface QueuedCall {
  callId: string;
  tool: string;
  args: unknown;
  enqueuedAt: number;
}

/** Caller-injected dispatcher — this package does not own real tool execution. */
export type ToolDispatcher = (call: QueuedCall) => Promise<unknown>;

interface PendingCall extends QueuedCall {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Queue + sliding-window flush timer for one batching scope (e.g. one
 * agent's turn). Not a resetting debounce.
 */
export class ToolBatchQueue {
  private queue: PendingCall[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstQueuedAt = 0;
  private flushedCallCount = 0;

  constructor(
    private readonly cfg: CostGovernorConfig['toolBatch'],
    private readonly dispatch: ToolDispatcher,
  ) {}

  /**
   * Enqueue a batchable call. Resolves/rejects with that call's own result
   * once its batch flushes — batching is transparent to the caller below
   * the governor: results are tagged to the original call, never mixed up.
   */
  enqueue(call: QueuedCall): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.queue.length === 0) this.firstQueuedAt = call.enqueuedAt;
      this.queue.push({ ...call, resolve, reject });

      if (this.queue.length >= this.cfg.maxBatchSize) {
        void this.flushNow();
        return;
      }
      this.scheduleFlush();
    });
  }

  /** Force-flush any pending batch immediately (e.g. before a non-batchable call fires). */
  async flushPending(): Promise<void> {
    await this.flushNow();
  }

  /** Number of calls flushed through this queue since the last drain. Resets to 0. */
  drainFlushedCallCount(): number {
    const count = this.flushedCallCount;
    this.flushedCallCount = 0;
    return count;
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    const elapsed = Date.now() - this.firstQueuedAt;
    const remaining = Math.max(0, this.cfg.windowMs - elapsed);
    this.timer = setTimeout(() => {
      void this.flushNow();
    }, remaining);
  }

  private async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const batch = this.queue;
    this.queue = [];
    this.firstQueuedAt = 0;
    if (batch.length === 0) return;

    this.flushedCallCount += batch.length;

    // Promise.all-style concurrent dispatch, results tagged back to their
    // originating call via `resolve`/`reject` closures captured at enqueue
    // time — preserves the ordering the harness would observe serially.
    const settled = await Promise.allSettled(batch.map((c) => this.dispatch(c)));
    settled.forEach((outcome, i) => {
      const pending = batch[i];
      if (outcome.status === 'fulfilled') pending.resolve(outcome.value);
      else pending.reject(outcome.reason);
    });
  }
}
