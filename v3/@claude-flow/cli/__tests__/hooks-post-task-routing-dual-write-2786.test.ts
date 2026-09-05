/**
 * Regression guard for #2786 fix-2 — `hooks_post-task --store-results`
 * dual-writes routing decisions into `.claude-flow/memory/store.json` so
 * the sync reader `getIntelligenceStatsFromMemory()` (which powers the
 * "Pattern Learning" / "Agent Routing" numbers in `hooks_metrics`)
 * actually sees the writes.
 *
 * Before this fix, the CLI wrote routing outcomes only to AgentDB
 * (namespace `patterns`, keys `routing-decision:*`), but the reader
 * only reads `.claude-flow/memory/store.json`. Result: counters stuck
 * at zero for the life of the install.
 *
 * The test runs `hooksPostTask.handler` in a temp cwd, then reads the
 * resulting store.json off disk and asserts the shape the reader
 * filters for (`key.includes('routing') || metadata.type === 'routing-decision'`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Bridge is mocked so the AgentDB path is a no-op — we only care about
// the JSON dual-write here. The bridge's real behavior is covered elsewhere.
const bridgeRecordFeedback = vi.fn(async () => ({ success: true, controller: 'mock', updated: 1 }));
const bridgeRecordCausalEdge = vi.fn(async () => ({ success: true, controller: 'mock' }));
const bridgeStoreEntry = vi.fn(async () => ({ success: true, controller: 'mock' }));

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeRecordFeedback,
  bridgeRecordCausalEdge,
  bridgeStoreEntry,
}));

vi.mock('../src/memory/intelligence.js', () => ({
  recordTrajectory: vi.fn(async () => undefined),
}));
vi.mock('../src/memory/graph-edge-writer.js', () => ({
  insertGraphEdge: vi.fn(async () => undefined),
}));

const { hooksPostTask } = await import('../src/mcp-tools/hooks-tools.js');

let origCwd: string;
let workdir: string;

beforeEach(() => {
  origCwd = process.cwd();
  workdir = mkdtempSync(join(tmpdir(), 'ruflo-2786-'));
  process.chdir(workdir);
  bridgeRecordFeedback.mockClear();
  bridgeStoreEntry.mockClear();
});

afterEach(() => {
  process.chdir(origCwd);
  try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#2786 fix-2 — hooks_post-task JSON dual-write for metrics reader', () => {
  it('writes a routing-decision entry into .claude-flow/memory/store.json when storeDecisions=true', async () => {
    await hooksPostTask.handler({
      taskId: 'task-2786-dual-write',
      task: 'implement auth token refresh',
      agent: 'coder',
      success: true,
      quality: 0.9,
      storeDecisions: true,
    });

    const storePath = join(workdir, '.claude-flow', 'memory', 'store.json');
    expect(existsSync(storePath)).toBe(true);

    const store = JSON.parse(readFileSync(storePath, 'utf-8')) as { entries: Record<string, any> };
    const routingKey = 'routing-decision:task-2786-dual-write';
    expect(store.entries[routingKey]).toBeDefined();

    const entry = store.entries[routingKey];
    // The reader's filter matches on key containing 'routing' OR metadata.type === 'routing-decision'
    expect(entry.key.includes('routing')).toBe(true);
    expect(entry.metadata?.type).toBe('routing-decision');
    // The confidence field is read to compute avgConfidence — quality maps to confidence.
    expect(entry.metadata?.confidence).toBe(0.9);
    // Namespace matches the AgentDB write (patterns) for parity.
    expect(entry.namespace).toBe('patterns');
    expect(bridgeRecordFeedback).toHaveBeenCalledWith(expect.objectContaining({
      task: 'implement auth token refresh',
    }));
  });

  it('does NOT write to store.json when storeDecisions is omitted (backwards compatible)', async () => {
    await hooksPostTask.handler({
      taskId: 'task-2786-no-store',
      task: 'implement auth token refresh',
      agent: 'coder',
      success: true,
      quality: 0.9,
      // storeDecisions omitted
    });

    const storePath = join(workdir, '.claude-flow', 'memory', 'store.json');
    // File may or may not exist depending on other write paths, but if it
    // does, the routing-decision key should NOT be there.
    if (existsSync(storePath)) {
      const store = JSON.parse(readFileSync(storePath, 'utf-8')) as { entries: Record<string, any> };
      expect(store.entries['routing-decision:task-2786-no-store']).toBeUndefined();
    }
  });
});
