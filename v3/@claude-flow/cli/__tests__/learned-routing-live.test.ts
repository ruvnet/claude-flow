/**
 * End-to-end regression for #2819: a long-lived MCP process must observe
 * labelled outcomes immediately, without a process restart.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let projectRoot: string;
let originalCwd: string;
let originalDisableBridge: string | undefined;
let originalDisableNativeRouter: string | undefined;

beforeAll(() => {
  originalCwd = process.cwd();
  originalDisableBridge = process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  originalDisableNativeRouter = process.env.CLAUDE_FLOW_DISABLE_NATIVE_ROUTER;
  projectRoot = mkdtempSync(path.join(tmpdir(), 'ruflo-routing-live-'));
  mkdirSync(path.join(projectRoot, '.claude-flow'), { recursive: true });
  process.chdir(projectRoot);
  process.env.CLAUDE_FLOW_DISABLE_BRIDGE = '1';
  process.env.CLAUDE_FLOW_DISABLE_NATIVE_ROUTER = '1';
  vi.resetModules();
  vi.doMock('../src/memory/memory-bridge.js', () => ({
    bridgeRouteTask: vi.fn(async () => null),
    bridgeRecordFeedback: vi.fn(async () => ({ success: true, controller: 'test', updated: 1 })),
    bridgeRecordCausalEdge: vi.fn(async () => ({ success: true })),
  }));
  vi.doMock('../src/memory/intelligence.js', () => ({
    recordTrajectory: vi.fn(async () => ({ success: true })),
  }));
  vi.doMock('../src/memory/graph-edge-writer.js', () => ({
    insertGraphEdge: vi.fn(async () => undefined),
  }));
});

afterAll(() => {
  process.chdir(originalCwd);
  vi.doUnmock('../src/memory/memory-bridge.js');
  vi.doUnmock('../src/memory/intelligence.js');
  vi.doUnmock('../src/memory/graph-edge-writer.js');
  if (originalDisableBridge === undefined) delete process.env.CLAUDE_FLOW_DISABLE_BRIDGE;
  else process.env.CLAUDE_FLOW_DISABLE_BRIDGE = originalDisableBridge;
  if (originalDisableNativeRouter === undefined) delete process.env.CLAUDE_FLOW_DISABLE_NATIVE_ROUTER;
  else process.env.CLAUDE_FLOW_DISABLE_NATIVE_ROUTER = originalDisableNativeRouter;
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('live learned routing (#2819)', () => {
  it('invalidates the in-process router and uses newly supported evidence', async () => {
    const { hooksPostTask, hooksRoute } = await import('../src/mcp-tools/hooks-tools.js');
    const task = 'zephyrometer quuxology';

    // Warm the singleton before learning; this is the state that used to stay
    // unchanged until the MCP server restarted.
    const before = await hooksRoute.handler({ task }) as Record<string, unknown>;

    for (const taskId of ['learn-live-1', 'learn-live-2']) {
      const recorded = await hooksPostTask.handler({
        taskId,
        task,
        agent: 'researcher',
        agentRole: 'researcher',
        success: true,
        quality: 0.98,
        storeDecisions: false,
      }) as { success?: boolean };
      expect(recorded.success).not.toBe(false);
    }

    const after = await hooksRoute.handler({ task }) as {
      selectedAgent?: string;
      recommendedAgent?: string;
      matchedPattern?: string;
      primaryAgent?: { type?: string };
    };
    expect(after.matchedPattern).toBe('learned-researcher');
    expect(after.selectedAgent ?? after.recommendedAgent ?? after.primaryAgent?.type).toBe('researcher');
    expect(after).not.toEqual(before);
  }, 30_000);
});
