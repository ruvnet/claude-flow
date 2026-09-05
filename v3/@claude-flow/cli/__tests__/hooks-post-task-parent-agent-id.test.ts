/**
 * ADR-147 P2 — Nested-subagent spawn-tree capture in post-task hook.
 *
 * Verifies that `hooks_post-task` MCP tool accepts the optional
 * `parentAgentId` and `depth` fields (sourced from Claude Code's
 * `parent_agent_id` OTel span tag / `x-claude-code-parent-agent-id`
 * header) and propagates them through to `bridgeRecordFeedback`.
 *
 * Why this is testable today without nested spawning being live:
 * the OTel tag the binary emits already exists for FLAT depth-1
 * spawns. The same code path that captures parent_agent_id for
 * a flat spawn will capture it for a depth-5 chain once the
 * Task-tool denylist (documented in ADR-147) is lifted upstream.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the bridge call so we can assert on what it receives.
const bridgeRecordFeedback = vi.fn(async () => ({ success: true, controller: 'mock', updated: 1 }));
const bridgeRecordCausalEdge = vi.fn(async () => ({ success: true, controller: 'mock' }));
const bridgeStoreEntry = vi.fn(async () => ({ success: true, controller: 'mock' }));

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeRecordFeedback,
  bridgeRecordCausalEdge,
  bridgeStoreEntry,
}));

// Stub intelligence/trajectory + graph-edge-writer so the handler runs cleanly.
vi.mock('../src/memory/intelligence.js', () => ({
  recordTrajectory: vi.fn(async () => undefined),
}));
vi.mock('../src/memory/graph-edge-writer.js', () => ({
  insertGraphEdge: vi.fn(async () => undefined),
}));

// Import after mocks are declared.
const { hooksPostTask } = await import('../src/mcp-tools/hooks-tools.js');

beforeEach(() => {
  bridgeRecordFeedback.mockClear();
  bridgeRecordCausalEdge.mockClear();
  bridgeStoreEntry.mockClear();
});

describe('ADR-147 P2 — post-task parentAgentId + depth propagation', () => {
  it('propagates parentAgentId and depth to the bridge when supplied', async () => {
    await hooksPostTask.handler({
      taskId: 'task-with-lineage',
      success: true,
      agent: 'coder',
      quality: 0.9,
      parentAgentId: 'parent-abc-123',
      depth: 2,
    });

    expect(bridgeRecordFeedback).toHaveBeenCalledTimes(1);
    const call = bridgeRecordFeedback.mock.calls[0][0] as Record<string, unknown>;
    expect(call.taskId).toBe('task-with-lineage');
    expect(call.parentAgentId).toBe('parent-abc-123');
    expect(call.depth).toBe(2);
  });

  it('omits parentAgentId and depth from the bridge call when caller does not supply them (top-level lead)', async () => {
    await hooksPostTask.handler({
      taskId: 'task-no-lineage',
      success: true,
      agent: 'coder',
      quality: 0.9,
    });

    expect(bridgeRecordFeedback).toHaveBeenCalledTimes(1);
    const call = bridgeRecordFeedback.mock.calls[0][0] as Record<string, unknown>;
    expect(call.parentAgentId).toBeUndefined();
    expect(call.depth).toBeUndefined();
  });

  it('accepts depth=0 (lead session) — boundary case must propagate, not be coerced to undefined', async () => {
    await hooksPostTask.handler({
      taskId: 'task-lead',
      success: true,
      agent: 'lead',
      quality: 1.0,
      parentAgentId: 'root',
      depth: 0,
    });

    expect(bridgeRecordFeedback).toHaveBeenCalledTimes(1);
    const call = bridgeRecordFeedback.mock.calls[0][0] as Record<string, unknown>;
    expect(call.depth).toBe(0);
  });

  it('rejects parentAgentId that fails identifier validation', async () => {
    const result = await hooksPostTask.handler({
      taskId: 'task-bad-parent',
      success: true,
      agent: 'coder',
      parentAgentId: 'has spaces and; semicolons',
    });

    expect((result as { success: boolean }).success).toBe(false);
    expect(bridgeRecordFeedback).not.toHaveBeenCalled();
  });

  it('rejects negative depth', async () => {
    const result = await hooksPostTask.handler({
      taskId: 'task-neg-depth',
      success: true,
      agent: 'coder',
      depth: -1,
    });

    expect((result as { success: boolean }).success).toBe(false);
    expect((result as { error: string }).error).toMatch(/depth must be a non-negative integer/);
    expect(bridgeRecordFeedback).not.toHaveBeenCalled();
  });

  it('rejects non-integer depth', async () => {
    const result = await hooksPostTask.handler({
      taskId: 'task-frac-depth',
      success: true,
      agent: 'coder',
      depth: 1.5,
    });

    expect((result as { success: boolean }).success).toBe(false);
    expect(bridgeRecordFeedback).not.toHaveBeenCalled();
  });

  it('rejects depth > 32 (defensive upper bound)', async () => {
    const result = await hooksPostTask.handler({
      taskId: 'task-deep-depth',
      success: true,
      agent: 'coder',
      depth: 33,
    });

    expect((result as { success: boolean }).success).toBe(false);
    expect(bridgeRecordFeedback).not.toHaveBeenCalled();
  });
});
