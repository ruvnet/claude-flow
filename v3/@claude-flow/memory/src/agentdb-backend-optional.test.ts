import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEntry } from './types.js';

const optional = vi.hoisted(() => ({ mode: 'missing-export' }));
vi.mock('agentdb', async (importOriginal) => {
  if (optional.mode === 'missing-package') throw new Error('agentdb is not installed');
  const actual = await importOriginal<typeof import('agentdb')>();
  return {
    ...actual,
    HNSWIndex: optional.mode === 'missing-export' ? undefined : actual.HNSWIndex,
    isHnswlibAvailable: async () => false,
  };
});

describe('AgentDBBackend optional native capability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('AGENTDB_DISABLE_TRANSFORMERS', '1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  for (const mode of ['missing-export', 'unavailable-addon', 'missing-package']) {
    it(`returns exact neighbors with ${mode} rather than empty results or false HNSW stats`, async () => {
      optional.mode = mode;
      const { AgentDBBackend } = await import('./agentdb-backend.js');
      const backend = new AgentDBBackend({ dbPath: ':memory:', vectorDimension: 2 });
      try {
        await backend.initialize();
        const entry = {
          ...createDefaultEntry({ key: 'kept', content: 'kept' }),
          embedding: new Float32Array([1, 0]),
        };
        await backend.store(entry);
        const errors = vi.spyOn(console, 'error');
        expect((await backend.search(new Float32Array([1, 0]), { k: 1 }))[0]).toMatchObject({
          entry: { id: entry.id }, score: 1, distance: 0,
        });
        expect((await backend.getStats()).hnswStats).toBeUndefined();
        expect((await backend.healthCheck()).components.index.status).toBe('degraded');
        expect(errors.mock.calls.some(([message]) =>
          String(message).includes('HNSW search failed'),
        )).toBe(false);
      } finally {
        await backend.shutdown();
      }
    });
  }
});
