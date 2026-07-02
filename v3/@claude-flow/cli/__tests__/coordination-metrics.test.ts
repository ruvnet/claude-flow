import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getProjectCwd } from '../src/mcp-tools/types.js';
import { mkdirSync } from 'node:fs';

const testDir = mkdtempSync(join(tmpdir(), 'coord-metrics-test-'));

vi.mock('../src/mcp-tools/types.js', () => ({
  getProjectCwd: () => testDir,
}));

vi.mock('../src/mcp-tools/validate-input.js', () => ({
  validateIdentifier: () => ({ valid: true }),
  validateText: (v: string) => ({ valid: v.length > 0, error: '' }),
}));

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function seedRecords(records: Array<Record<string, unknown>>) {
  const dir = join(testDir, '.claude-flow', 'coordination');
  mkdirSync(dir, { recursive: true });
  const existing = { orchestrations: records };
  writeFileSync(join(dir, 'store.json'), JSON.stringify(existing, null, 2), 'utf-8');
}

describe('coordination_metrics', () => {
  it('returns zeros when no records exist', async () => {
    const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
    const tool = coordinationTools.find(t => t.name === 'coordination_metrics')!;
    const result = await tool.handler({ metric: 'all' }) as Record<string, unknown>;
    expect(result.success).toBe(true);
    const metrics = result.metrics as Record<string, unknown>;
    const latency = metrics.latency as Record<string, unknown>;
    expect(latency.p50).toBeNull();
  });

  it('computes latency percentiles from completed records', async () => {
    seedRecords([
      { id: 'r1', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 100, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
      { id: 'r2', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 200, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
      { id: 'r3', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 300, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
      { id: 'r4', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 400, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
      { id: 'r5', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 500, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
    ]);
    const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
    const tool = coordinationTools.find(t => t.name === 'coordination_metrics')!;
    const result = await tool.handler({ metric: 'all' }) as Record<string, unknown>;
    const metrics = result.metrics as Record<string, unknown>;
    const latency = metrics.latency as Record<string, unknown>;
    expect(latency.p50).toBe(300);
    expect(latency.p95).toBe(500);
    expect(latency.p99).toBe(500);
  });

  it('reports throughput within time range', async () => {
    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const mins90 = new Date(now - 90 * 60 * 1000).toISOString();
    seedRecords([
      { id: 'r1', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: hourAgo, startedAt: hourAgo, completedAt: hourAgo, durationMs: 100, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
      { id: 'r2', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: mins90, startedAt: mins90, completedAt: mins90, durationMs: 200, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
    ]);
    const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
    const tool = coordinationTools.find(t => t.name === 'coordination_metrics')!;
    const result = await tool.handler({ metric: 'throughput', timeRange: '2h' }) as Record<string, unknown>;
    expect(result.data).toBeDefined();
    const data = result.data as Record<string, unknown>;
    expect(data.count).toBe(2);
    expect(data.unit).toBe('ops/h');
  });

  it('rejects invalid time range format', async () => {
    const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
    const tool = coordinationTools.find(t => t.name === 'coordination_metrics')!;
    const result = await tool.handler({ metric: 'throughput', timeRange: 'invalid' }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeRange');
  });

  it('reports success rate from completed records', async () => {
    seedRecords([
      { id: 'r1', status: 'completed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 100, aggregate: { completed: 1, failed: 0, skipped: 0, totalAgents: 1, totalTokens: 50 } },
      { id: 'r2', status: 'partial', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 200, aggregate: { completed: 1, failed: 1, skipped: 0, totalAgents: 2, totalTokens: 50 } },
      { id: 'r3', status: 'failed', strategy: 'parallel', agents: ['a1'], task: 't', scheduledAt: new Date().toISOString(), startedAt: new Date().toISOString(), durationMs: 300, aggregate: { completed: 0, failed: 1, skipped: 0, totalAgents: 1, totalTokens: 0 } },
    ]);
    const { coordinationTools } = await import('../src/mcp-tools/coordination-tools.js');
    const tool = coordinationTools.find(t => t.name === 'coordination_metrics')!;
    const result = await tool.handler({ metric: 'all' }) as Record<string, unknown>;
    const metrics = result.metrics as Record<string, unknown>;
    const availability = metrics.availability as Record<string, unknown>;
    expect(availability.totalOrchestrations).toBe(3);
    expect(availability.successRate).toBeCloseTo(33.33, 1);
  });
});
