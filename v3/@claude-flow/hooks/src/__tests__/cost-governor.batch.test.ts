/**
 * ADR-179 sub-feature 2 (tool batching) — London-school mock-first tests.
 *
 * The dispatcher (real tool execution) is always MOCKED — this module does
 * not own execution. Timing is driven with vitest fake timers so the 500ms
 * coalesce window is deterministic (no wall-clock waits).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isBatchableTool,
  ToolBatchQueue,
  registerToolBatchHook,
  drainBatchedCallCount,
  type QueuedCall,
  type ToolDispatcher,
} from '../cost-governor/index.js';
import type { CostGovernorConfig } from '../cost-governor/types.js';
import { HookRegistry } from '../registry/index.js';
import { HookEvent, type HookContext } from '../types.js';

const BATCH_CFG: CostGovernorConfig['toolBatch'] = { enabled: true, windowMs: 500, maxBatchSize: 8 };

function qc(callId: string, tool = 'Read', enqueuedAt = Date.now()): QueuedCall {
  return { callId, tool, args: {}, enqueuedAt };
}

/** Dispatcher that echoes each call's own callId — lets us assert result-tagging. */
function echoDispatch(): ToolDispatcher & ReturnType<typeof vi.fn> {
  return vi.fn((call: QueuedCall) => Promise.resolve(call.callId)) as never;
}

// --- isBatchableTool: the must-fire-immediately boundary ------------------

describe('isBatchableTool', () => {
  it('batches the built-in read-only tools Read/Grep/Glob', () => {
    for (const t of ['Read', 'Grep', 'Glob']) expect(isBatchableTool(t)).toBe(true);
  });

  it('never batches side-effect-full tools regardless of config (no config arg exists)', () => {
    for (const t of ['Bash', 'Edit', 'Write', 'NotebookEdit']) expect(isBatchableTool(t)).toBe(false);
  });

  it('batches an MCP tool only when explicitly tagged read-only', () => {
    const readOnly = new Set(['mcp__x__search']);
    expect(isBatchableTool('mcp__x__search', readOnly)).toBe(true);
    expect(isBatchableTool('mcp__x__write', readOnly)).toBe(false);
  });

  it('does not batch an unknown tool by default', () => {
    expect(isBatchableTool('SomeRandomTool')).toBe(false);
  });
});

// --- ToolBatchQueue: sliding-window mechanics -----------------------------

describe('ToolBatchQueue (mock dispatcher, fake timers)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('coalesces sub-maxBatchSize calls and flushes exactly at windowMs', async () => {
    const dispatch = echoDispatch();
    const q = new ToolBatchQueue(BATCH_CFG, dispatch);
    q.enqueue(qc('a'));
    q.enqueue(qc('b'));

    await vi.advanceTimersByTimeAsync(499);
    expect(dispatch).not.toHaveBeenCalled(); // window not yet elapsed

    await vi.advanceTimersByTimeAsync(1); // now at 500ms
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('anchors the window to the FIRST queued call — not a resetting debounce', async () => {
    const dispatch = echoDispatch();
    const q = new ToolBatchQueue(BATCH_CFG, dispatch);
    q.enqueue(qc('first', 'Read', Date.now())); // t=0, timer armed for 500
    await vi.advanceTimersByTimeAsync(300); // t=300
    q.enqueue(qc('second', 'Read', Date.now())); // must NOT reschedule the timer

    await vi.advanceTimersByTimeAsync(199); // t=499 — a resetting debounce would fire at 800, not here
    expect(dispatch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1); // t=500 from the FIRST call
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('flushes immediately when queue reaches maxBatchSize (no timer wait)', async () => {
    const dispatch = echoDispatch();
    const q = new ToolBatchQueue({ ...BATCH_CFG, maxBatchSize: 3 }, dispatch);
    const p1 = q.enqueue(qc('1'));
    const p2 = q.enqueue(qc('2'));
    const p3 = q.enqueue(qc('3')); // 3rd hits maxBatchSize → immediate flush
    await Promise.all([p1, p2, p3]); // resolves without advancing any timer
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it('preserves order AND tags each result to its own call', async () => {
    const dispatch = echoDispatch();
    const q = new ToolBatchQueue(BATCH_CFG, dispatch);
    const pA = q.enqueue(qc('A'));
    const pB = q.enqueue(qc('B'));
    const pC = q.enqueue(qc('C'));
    await q.flushPending();

    await expect(pA).resolves.toBe('A');
    await expect(pB).resolves.toBe('B');
    await expect(pC).resolves.toBe('C');
    expect(dispatch.mock.calls.map((c) => (c[0] as QueuedCall).callId)).toEqual(['A', 'B', 'C']);
  });

  it('force-flushes a pending batch on flushPending even though windowMs has not elapsed', async () => {
    const dispatch = echoDispatch();
    const q = new ToolBatchQueue(BATCH_CFG, dispatch);
    q.enqueue(qc('x'));
    q.enqueue(qc('y'));
    await q.flushPending(); // turn-end force flush — never advanced the clock
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('routes a per-call rejection to that call only, leaving siblings resolved', async () => {
    const dispatch = vi.fn((call: QueuedCall) =>
      call.callId === 'bad' ? Promise.reject(new Error('boom')) : Promise.resolve(call.callId),
    ) as never as ToolDispatcher;
    const q = new ToolBatchQueue(BATCH_CFG, dispatch);
    const pGood = q.enqueue(qc('good'));
    const pBad = q.enqueue(qc('bad'));
    const pGood2 = q.enqueue(qc('good2'));
    await q.flushPending();

    await expect(pGood).resolves.toBe('good');
    await expect(pBad).rejects.toThrow('boom');
    await expect(pGood2).resolves.toBe('good2');
  });

  it('drainFlushedCallCount returns the flushed count then resets to 0', async () => {
    const dispatch = echoDispatch();
    const q = new ToolBatchQueue(BATCH_CFG, dispatch);
    q.enqueue(qc('a'));
    q.enqueue(qc('b'));
    await q.flushPending();
    expect(q.drainFlushedCallCount()).toBe(2);
    expect(q.drainFlushedCallCount()).toBe(0); // read-and-reset
  });

  it('flushPending on an empty queue is a no-op and never dispatches', async () => {
    const dispatch = echoDispatch();
    const q = new ToolBatchQueue(BATCH_CFG, dispatch);
    await expect(q.flushPending()).resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// --- registerToolBatchHook: PreToolUse handler contract -------------------

describe('registerToolBatchHook (handler contract)', () => {
  function ctx(toolName: string, scopeId: string): HookContext {
    return {
      event: HookEvent.PreToolUse,
      timestamp: new Date(),
      tool: { name: toolName, parameters: {} },
      agent: { id: scopeId, type: 'test' },
    };
  }

  it('queues a batchable tool (does not dispatch it yet) and tags the result costGovernorBatched', async () => {
    const dispatch = echoDispatch();
    const registry = new HookRegistry();
    const id = registerToolBatchHook(BATCH_CFG, dispatch, registry);
    const handler = registry.get(id)!.handler;

    const res = await handler(ctx('Read', 'scope-batchable'));
    expect(res).toMatchObject({ success: true, data: { costGovernorBatched: true } });
    expect(dispatch).not.toHaveBeenCalled(); // still in the coalesce window
    // Drain so the pending real timer is cleared and does not leak into other tests.
    const registryFlush = registry.get(id)!.handler;
    await registryFlush(ctx('Bash', 'scope-batchable'));
  });

  it('a non-batchable tool (Bash) flushes the pending batch first, in order, and is itself NOT batched', async () => {
    const dispatch = echoDispatch();
    const registry = new HookRegistry();
    const id = registerToolBatchHook(BATCH_CFG, dispatch, registry);
    const handler = registry.get(id)!.handler;

    await handler(ctx('Read', 'scope-mixed')); // queued
    const bashRes = await handler(ctx('Bash', 'scope-mixed')); // flushes the Read, does not queue Bash

    expect(bashRes).toMatchObject({ success: true });
    expect((bashRes as { data?: unknown }).data).toBeUndefined(); // Bash not tagged as batched
    expect(dispatch).toHaveBeenCalledTimes(1); // only the flushed Read — Bash dispatch is the host's job
    expect((dispatch.mock.calls[0][0] as QueuedCall).tool).toBe('Read');
    expect(drainBatchedCallCount('scope-mixed')).toBe(1); // one call flushed through this scope
  });

  it('opt-in gate: disabled cfg → handler returns immediately, no batching, no queue, no dispatch', async () => {
    // Matches sub-feature 1's in-function gating: the PreToolUse handler early-returns
    // {success:true} when cfg.enabled is false (fix landed after this gap was flagged),
    // so a batchable tool is neither queued nor tagged — "opt-in off → immediate dispatch".
    const dispatch = echoDispatch();
    const registry = new HookRegistry();
    const id = registerToolBatchHook({ ...BATCH_CFG, enabled: false }, dispatch, registry);
    const handler = registry.get(id)!.handler;

    const res = await handler(ctx('Read', 'scope-disabled'));
    expect(res).toEqual({ success: true }); // no costGovernorBatched tag
    expect((res as { data?: unknown }).data).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
    expect(drainBatchedCallCount('scope-disabled')).toBe(0); // no queue created for this scope
  });
});
