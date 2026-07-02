import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = mkdtempSync(join(tmpdir(), 'orch-store-test-'));

vi.mock('../src/mcp-tools/types.js', () => ({
  getProjectCwd: () => testDir,
}));

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id as string || 'orch-1',
    task: (overrides.task as string) || 'test task',
    strategy: 'parallel' as const,
    agents: ['a1', 'a2'],
    status: (overrides.status as string) || 'running',
    scheduledAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('OrchestrationStore', () => {
  it('loadRecords returns empty array when no file exists', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    expect(store.loadRecords()).toEqual([]);
  });

  it('addRecord and loadRecords round-trips', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    const rec = makeRecord({ id: 'test-1' }) as Parameters<typeof store.addRecord>[0];
    store.addRecord(rec);
    const records = store.loadRecords();
    expect(records.length).toBe(1);
    expect(records[0].id).toBe('test-1');
  });

  it('updateRecord modifies existing record', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    store.addRecord(makeRecord({ id: 'upd-1' }) as Parameters<typeof store.addRecord>[0]);
    const updated = store.updateRecord('upd-1', { status: 'completed', completedAt: new Date().toISOString() });
    expect(updated).toBe(true);
    const records = store.loadRecords();
    expect(records[0].status).toBe('completed');
  });

  it('updateRecord returns false for unknown id', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    const result = store.updateRecord('nonexistent', { status: 'completed' });
    expect(result).toBe(false);
  });

  it('enforces 100 record retention', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    for (let i = 0; i < 110; i++) {
      store.addRecord(makeRecord({ id: `ret-${i}` }) as Parameters<typeof store.addRecord>[0]);
    }
    const records = store.loadRecords();
    expect(records.length).toBeLessThanOrEqual(100);
  });

  it('reconciles expired running records as failed', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    const oldStarted = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    store.addRecord(makeRecord({
      id: 'stale-1',
      status: 'running',
      startedAt: oldStarted,
    }) as Parameters<typeof store.addRecord>[0]);
    const store2 = new OrchestrationStore();
    const records = store2.loadRecords();
    const stale = records.find(r => r.id === 'stale-1');
    expect(stale).toBeDefined();
    expect(stale!.status).toBe('failed');
  });

  it('getCompletedRecords returns only completed/partial/failed with startedAt', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    store.addRecord(makeRecord({ id: 'r1', status: 'completed' }) as Parameters<typeof store.addRecord>[0]);
    store.addRecord(makeRecord({ id: 'r2', status: 'partial' }) as Parameters<typeof store.addRecord>[0]);
    store.addRecord(makeRecord({ id: 'r3', status: 'failed' }) as Parameters<typeof store.addRecord>[0]);
    const completed = store.getCompletedRecords();
    expect(completed.length).toBe(3);
  });

  it('getMetricsRecords excludes legacy scheduled-only records', async () => {
    const { OrchestrationStore } = await import('../src/orchestration/orchestration-store.js');
    const store = new OrchestrationStore();
    store.addRecord(makeRecord({ id: 'm1', status: 'completed', startedAt: new Date().toISOString() }) as Parameters<typeof store.addRecord>[0]);
    store.addRecord({
      id: 'legacy-1',
      task: 'old',
      strategy: 'parallel',
      agents: [],
      status: 'scheduled',
      scheduledAt: new Date().toISOString(),
    } as Parameters<typeof store.addRecord>[0]);
    const metrics = store.getMetricsRecords();
    expect(metrics.length).toBe(1);
    expect(metrics[0].id).toBe('m1');
  });
});
