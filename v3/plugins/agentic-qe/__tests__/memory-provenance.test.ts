import { describe, expect, it, vi } from 'vitest';
import { QEMemoryBridge } from '../src/bridges/QEMemoryBridge.js';

function createHarness() {
  const store = vi.fn(async () => 'stored-id');
  const memory = {
    createNamespace: vi.fn(async () => undefined),
    store,
    search: vi.fn(async () => []),
    query: vi.fn(async () => []),
    delete: vi.fn(async () => true),
    clearNamespace: vi.fn(async () => 0),
    getStats: vi.fn(async () => ({
      totalEntries: 0,
      entriesByNamespace: {},
      memoryUsage: 0,
    })),
  };
  const embeddings = {
    embed: vi.fn(async () => ({ embedding: new Float32Array([0.1, 0.2, 0.3]) })),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const bridge = new QEMemoryBridge(memory as any, embeddings as any, logger as any);
  return { bridge, store };
}

describe('QEMemoryBridge provenance', () => {
  it('classifies every official QE memory write with canonical provenance', async () => {
    const { bridge, store } = createHarness();
    await bridge.initialize();

    await bridge.storeTestPattern({
      id: 'pattern-1',
      type: 'unit',
      description: 'A deterministic unit-test pattern',
      code: 'expect(value).toBe(true)',
      language: 'typescript',
      framework: 'vitest',
      effectiveness: 0.95,
      usageCount: 1,
      tags: ['unit'],
    } as any);

    await bridge.storeCoverageGap({
      id: 'gap-1',
      file: 'src/example.ts',
      type: 'branch',
      location: { startLine: 12, endLine: 18 },
      reason: 'Uncovered failure branch',
      riskScore: 0.8,
      priority: 'high',
    } as any);

    await bridge.storeTrajectory({
      id: 'trajectory-1',
      taskType: 'unit-test',
      agentId: 'qe-agent',
      success: true,
      reward: 1,
      verdict: 'pass',
      steps: [{ action: 'run focused tests' }],
      durationMs: 25,
    } as any);

    expect(store).toHaveBeenCalledTimes(3);
    expect(store.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      provenance_type: 'agent_output',
    }));
    expect(store.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      provenance_type: 'tool_result',
    }));
    expect(store.mock.calls[2]?.[0]).toEqual(expect.objectContaining({
      provenance_type: 'system_observation',
    }));
  });
});
