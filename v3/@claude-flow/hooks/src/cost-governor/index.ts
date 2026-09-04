/**
 * cost-governor/index.ts — ADR-179 Dynamic Harness Cost Governor.
 *
 * New module (hooks package) implementing the five DHCG sub-features. All
 * off by default — see docs/harness-cost-governor.md for the user-facing
 * flag contract and v3/docs/adr/ADR-179-dynamic-harness-cost-governor.md
 * for the design.
 *
 * @module @claude-flow/hooks/cost-governor
 */

import { HookEvent, HookPriority } from '../types.js';
import { defaultRegistry, HookRegistry } from '../registry/index.js';
import { defaultTurnCounter, TurnCounter } from './turn-counter.js';
import { isBatchableTool, ToolBatchQueue, type ToolDispatcher } from './batch.js';
import type { CostGovernorConfig } from './types.js';

export * from './types.js';
export * from './turn-counter.js';
export * from './trim.js';
export * from './batch.js';
export * from './events.js';
export * from './moe-feedback.js';
export * from './diversity.js';

/**
 * Register the pre-task turn-boundary hook (sub-feature 1: context trim).
 * No native "turn" boundary hook exists in HookContext/types.ts today, so
 * this reuses the existing pre-task hook (fires once per agent task) as
 * the turn boundary proxy, incrementing a per-`session_id` TurnCounter
 * that `trim.ts` reads when filtering retrieval candidates.
 */
export function registerContextTrimHook(
  registry: HookRegistry = defaultRegistry,
  turnCounter: TurnCounter = defaultTurnCounter,
): string {
  return registry.register(
    HookEvent.PreTask,
    (context) => {
      const sessionId = context.session?.id ?? 'default';
      const turn = turnCounter.increment(sessionId);
      return { success: true, data: { costGovernorTurn: turn } };
    },
    HookPriority.Background,
    {
      name: 'cost-governor:context-trim-turn-counter',
      description: 'ADR-179 sub-feature 1 — increments the per-session turn counter used by context trim',
      enabled: true,
    },
  );
}

// ADR-179 sub-feature 2 (tool batching) — one queue per batching scope
// (agent, falling back to session). Module-scoped since the hook handler
// itself is stateless between invocations.
const toolBatchQueues = new Map<string, ToolBatchQueue>();

/**
 * Register the tool-batching hook (sub-feature 2). Enforcement point is the
 * existing PreToolUse hook family — no new interception seam needed. The
 * caller supplies `dispatch`, the real tool-execution callback (this
 * package does not own tool dispatch); batchable calls are queued and
 * flushed per `cfg.windowMs`/`cfg.maxBatchSize`, non-batchable calls flush
 * the pending batch first, preserving order, then fire immediately.
 */
export function registerToolBatchHook(
  cfg: CostGovernorConfig['toolBatch'],
  dispatch: ToolDispatcher,
  registry: HookRegistry = defaultRegistry,
): string {
  return registry.register(
    HookEvent.PreToolUse,
    async (context) => {
      if (!cfg.enabled) return { success: true };

      const toolName = context.tool?.name;
      if (!toolName) return { success: true };

      const scopeKey = context.agent?.id ?? context.session?.id ?? 'default';
      let queue = toolBatchQueues.get(scopeKey);
      if (!queue) {
        queue = new ToolBatchQueue(cfg, dispatch);
        toolBatchQueues.set(scopeKey, queue);
      }

      if (!isBatchableTool(toolName)) {
        await queue.flushPending();
        return { success: true };
      }

      void queue.enqueue({
        callId: `${scopeKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        tool: toolName,
        args: context.tool?.parameters,
        enqueuedAt: Date.now(),
      });

      return { success: true, data: { costGovernorBatched: true } };
    },
    HookPriority.High,
    {
      name: 'cost-governor:tool-batch',
      description: 'ADR-179 sub-feature 2 — coalesces sequential read-only tool calls into a single round-trip',
      enabled: true,
    },
  );
}

/**
 * Drain the batched-call count for a scope (agent/session id) accumulated
 * since the last drain. Consumed by sub-feature 3's per-completion
 * CostEvent accumulator to populate `batched_calls`.
 */
export function drainBatchedCallCount(scopeKey: string): number {
  return toolBatchQueues.get(scopeKey)?.drainFlushedCallCount() ?? 0;
}
