/**
 * Tests for LearningBridge
 *
 * TDD London School (mock-first) tests for the bridge that connects
 * AutoMemoryBridge insights to the NeuralLearningSystem.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IMemoryBackend, MemoryEntry, MemoryEntryUpdate } from './types.js';
import type { MemoryInsight } from './auto-memory-bridge.js';
import { LearningBridge } from './learning-bridge.js';
import type {
  LearningBridgeConfig,
  LearningStats,
  ConsolidateResult,
  PatternMatch,
  NeuralLoader,
} from './learning-bridge.js';

// ===== Mock Neural System =====

function createMockNeuralSystem() {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    beginTask: vi.fn().mockReturnValue('traj-1'),
    recordStep: vi.fn(),
    completeTask: vi.fn().mockResolvedValue(undefined),
    findPatterns: vi.fn().mockResolvedValue([]),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

function createNeuralLoader(neural: ReturnType<typeof createMockNeuralSystem>): NeuralLoader {
  return async () => neural;
}

function createFailingNeuralLoader(): NeuralLoader {
  return async () => { throw new Error('Module not found'); };
}

// ===== Mock Backend =====

function createMockBackend(): IMemoryBackend & { storedEntries: MemoryEntry[] } {
  const storedEntries: MemoryEntry[] = [];

  return {
    storedEntries,
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockImplementation(async (entry: MemoryEntry) => {
      storedEntries.push(entry);
    }),
    get: vi.fn().mockResolvedValue(null),
    // Mirrors the real backend's keyIndex lookup (agentdb-backend.ts) so tests
    // that store() a full entry and then look it up by its `key` (as
    // AutoMemoryBridge does — see resolveConsolidationReward's id/key note)
    // exercise the real distinction between `entry.id` and `entry.key`.
    getByKey: vi.fn().mockImplementation(async (namespace: string, key: string) => {
      return storedEntries.find((e) => e.namespace === namespace && e.key === key) ?? null;
    }),
    update: vi.fn().mockImplementation(async (id: string, upd: MemoryEntryUpdate) => {
      const entry = storedEntries.find(e => e.id === id);
      if (!entry) return null;
      if (upd.metadata) entry.metadata = { ...entry.metadata, ...upd.metadata };
      return entry;
    }),
    delete: vi.fn().mockResolvedValue(true),
    query: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    bulkInsert: vi.fn().mockResolvedValue(undefined),
    bulkDelete: vi.fn().mockResolvedValue(0),
    count: vi.fn().mockResolvedValue(0),
    listNamespaces: vi.fn().mockResolvedValue([]),
    clearNamespace: vi.fn().mockResolvedValue(0),
    getStats: vi.fn().mockResolvedValue({
      totalEntries: 0, entriesByNamespace: {}, entriesByType: {},
      memoryUsage: 0, avgQueryTime: 0, avgSearchTime: 0,
    }),
    healthCheck: vi.fn().mockResolvedValue({
      status: 'healthy',
      components: {
        storage: { status: 'healthy', latency: 0 },
        index: { status: 'healthy', latency: 0 },
        cache: { status: 'healthy', latency: 0 },
      },
      timestamp: Date.now(), issues: [], recommendations: [],
    }),
  };
}

// ===== Test Fixtures =====

function createTestInsight(overrides: Partial<MemoryInsight> = {}): MemoryInsight {
  return {
    category: 'debugging',
    summary: 'HNSW index requires initialization before search',
    source: 'agent:tester',
    confidence: 0.95,
    ...overrides,
  };
}

function createTestEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  const now = Date.now();
  return {
    id: 'entry-1',
    key: 'insight:debugging:12345:0',
    content: 'HNSW index requires initialization',
    type: 'semantic',
    namespace: 'learnings',
    tags: ['insight', 'debugging'],
    metadata: { confidence: 0.8, category: 'debugging' },
    accessLevel: 'private',
    createdAt: now,
    updatedAt: now,
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: now,
    ...overrides,
  };
}

// ===== Tests =====

describe('LearningBridge', () => {
  let bridge: LearningBridge;
  let backend: ReturnType<typeof createMockBackend>;
  let neural: ReturnType<typeof createMockNeuralSystem>;

  beforeEach(() => {
    backend = createMockBackend();
    neural = createMockNeuralSystem();
    bridge = new LearningBridge(backend, { neuralLoader: createNeuralLoader(neural) });
  });

  afterEach(() => {
    bridge.destroy();
  });

  // ===== constructor =====

  describe('constructor', () => {
    it('should create with default config', () => {
      const b = new LearningBridge(backend);
      const stats = b.getStats();
      expect(stats.totalTrajectories).toBe(0);
      expect(stats.neuralAvailable).toBe(false);
      b.destroy();
    });

    it('should create with custom config', () => {
      const custom = new LearningBridge(backend, {
        sonaMode: 'research',
        confidenceDecayRate: 0.01,
        accessBoostAmount: 0.05,
        maxConfidence: 0.9,
        minConfidence: 0.2,
        ewcLambda: 5000,
        consolidationThreshold: 20,
      });
      expect(custom.getStats().totalTrajectories).toBe(0);
      custom.destroy();
    });

    it('should respect enabled=false', async () => {
      const disabled = new LearningBridge(backend, {
        enabled: false,
        neuralLoader: createNeuralLoader(neural),
      });
      await disabled.onInsightRecorded(createTestInsight(), 'entry-1');
      expect(neural.beginTask).not.toHaveBeenCalled();
      disabled.destroy();
    });
  });

  // ===== onInsightRecorded =====

  describe('onInsightRecorded', () => {
    it('should store trajectory when neural available', async () => {
      const insight = createTestInsight();
      await bridge.onInsightRecorded(insight, 'entry-1');

      expect(neural.beginTask).toHaveBeenCalledWith(insight.summary, 'general');
      expect(neural.recordStep).toHaveBeenCalledWith('traj-1', expect.objectContaining({
        action: 'record:debugging',
        reward: 0.95,
      }));
      expect(bridge.getStats().totalTrajectories).toBe(1);
    });

    it('should emit insight:learning-started event', async () => {
      const handler = vi.fn();
      bridge.on('insight:learning-started', handler);
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      expect(handler).toHaveBeenCalledWith({ entryId: 'entry-1', category: 'debugging' });
    });

    it('should no-op when disabled', async () => {
      const disabled = new LearningBridge(backend, {
        enabled: false,
        neuralLoader: createNeuralLoader(neural),
      });
      await disabled.onInsightRecorded(createTestInsight(), 'entry-1');
      expect(neural.beginTask).not.toHaveBeenCalled();
      disabled.destroy();
    });

    it('should no-op when destroyed', async () => {
      bridge.destroy();
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      expect(neural.beginTask).not.toHaveBeenCalled();
    });

    it('should handle neural unavailable gracefully', async () => {
      const safeBridge = new LearningBridge(backend, {
        neuralLoader: createFailingNeuralLoader(),
      });
      const handler = vi.fn();
      safeBridge.on('insight:learning-started', handler);

      await safeBridge.onInsightRecorded(createTestInsight(), 'entry-1');

      expect(handler).toHaveBeenCalled();
      expect(safeBridge.getStats().neuralAvailable).toBe(false);
      safeBridge.destroy();
    });

    it('should pass hash embedding as stateEmbedding', async () => {
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');

      const stepArg = neural.recordStep.mock.calls[0][1];
      expect(stepArg.stateEmbedding).toBeInstanceOf(Float32Array);
      expect(stepArg.stateEmbedding.length).toBe(768);
    });

    it('should create unique trajectory per entry', async () => {
      neural.beginTask.mockReturnValueOnce('traj-1').mockReturnValueOnce('traj-2');

      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      await bridge.onInsightRecorded(
        createTestInsight({ summary: 'Second insight' }),
        'entry-2',
      );

      expect(bridge.getStats().totalTrajectories).toBe(2);
      expect(bridge.getStats().activeTrajectories).toBe(2);
    });

    it('should survive beginTask throwing', async () => {
      neural.beginTask.mockImplementationOnce(() => { throw new Error('fail'); });
      const handler = vi.fn();
      bridge.on('insight:learning-started', handler);

      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');

      expect(handler).toHaveBeenCalled();
    });
  });

  // ===== onInsightAccessed =====

  describe('onInsightAccessed', () => {
    it('should boost confidence by accessBoostAmount', async () => {
      const entry = createTestEntry({ metadata: { confidence: 0.5 } });
      (backend.get as any).mockResolvedValueOnce(entry);

      await bridge.onInsightAccessed('entry-1');

      expect(backend.update).toHaveBeenCalledWith('entry-1', {
        metadata: expect.objectContaining({ confidence: 0.53 }),
      });
    });

    it('should cap confidence at maxConfidence', async () => {
      const entry = createTestEntry({ metadata: { confidence: 0.99 } });
      (backend.get as any).mockResolvedValueOnce(entry);

      await bridge.onInsightAccessed('entry-1');

      const updateCall = (backend.update as any).mock.calls[0];
      expect(updateCall[1].metadata.confidence).toBeLessThanOrEqual(1.0);
    });

    it('should handle missing entry gracefully', async () => {
      (backend.get as any).mockResolvedValueOnce(null);
      await bridge.onInsightAccessed('nonexistent');
      expect(backend.update).not.toHaveBeenCalled();
    });

    it('should emit insight:accessed event', async () => {
      const entry = createTestEntry({ metadata: { confidence: 0.7 } });
      (backend.get as any).mockResolvedValueOnce(entry);
      const handler = vi.fn();
      bridge.on('insight:accessed', handler);

      await bridge.onInsightAccessed('entry-1');

      expect(handler).toHaveBeenCalledWith({
        entryId: 'entry-1',
        newConfidence: expect.any(Number),
      });
    });

    it('should update entry metadata in backend preserving existing fields', async () => {
      const entry = createTestEntry({
        metadata: { confidence: 0.6, category: 'debugging', extra: 'preserved' },
      });
      (backend.get as any).mockResolvedValueOnce(entry);

      await bridge.onInsightAccessed('entry-1');

      const updateCall = (backend.update as any).mock.calls[0][1];
      expect(updateCall.metadata.category).toBe('debugging');
      expect(updateCall.metadata.extra).toBe('preserved');
      expect(updateCall.metadata.confidence).toBeCloseTo(0.63, 5);
    });

    it('should record neural step when trajectory exists', async () => {
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      vi.clearAllMocks();

      const entry = createTestEntry();
      (backend.get as any).mockResolvedValueOnce(entry);

      await bridge.onInsightAccessed('entry-1');

      expect(neural.recordStep).toHaveBeenCalledWith('traj-1', {
        action: 'access',
        reward: 0.03,
      });
    });

    it('should not record neural step without trajectory', async () => {
      const entry = createTestEntry();
      (backend.get as any).mockResolvedValueOnce(entry);

      await bridge.onInsightAccessed('entry-1');

      expect(neural.recordStep).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'access' }),
      );
    });

    it('should use default 0.5 when metadata lacks confidence', async () => {
      const entry = createTestEntry({ metadata: {} });
      (backend.get as any).mockResolvedValueOnce(entry);

      await bridge.onInsightAccessed('entry-1');

      const updateCall = (backend.update as any).mock.calls[0][1];
      expect(updateCall.metadata.confidence).toBeCloseTo(0.53, 5);
    });

    it('should no-op when disabled', async () => {
      const disabled = new LearningBridge(backend, { enabled: false });
      await disabled.onInsightAccessed('entry-1');
      expect(backend.get).not.toHaveBeenCalled();
      disabled.destroy();
    });

    it('should track boost stats', async () => {
      const entry = createTestEntry({ metadata: { confidence: 0.5 } });
      (backend.get as any).mockResolvedValue(entry);

      await bridge.onInsightAccessed('entry-1');
      await bridge.onInsightAccessed('entry-1');

      expect(bridge.getStats().avgConfidenceBoost).toBeCloseTo(0.03, 5);
    });
  });

  // ===== consolidate =====

  describe('consolidate', () => {
    async function seedTrajectories(count: number) {
      for (let i = 0; i < count; i++) {
        neural.beginTask.mockReturnValueOnce(`traj-${i}`);
        await bridge.onInsightRecorded(
          createTestInsight({ summary: `Insight ${i}` }),
          `entry-${i}`,
        );
      }
    }

    it('should complete active trajectories', async () => {
      await seedTrajectories(10);
      const result = await bridge.consolidate();
      expect(result.trajectoriesCompleted).toBe(10);
      expect(result.patternsLearned).toBe(10);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should return early when below threshold', async () => {
      await seedTrajectories(2);
      const result = await bridge.consolidate();
      expect(result.trajectoriesCompleted).toBe(0);
      expect(neural.completeTask).not.toHaveBeenCalled();
    });

    it('should return early when neural unavailable', async () => {
      const safeBridge = new LearningBridge(backend, {
        neuralLoader: createFailingNeuralLoader(),
      });
      const result = await safeBridge.consolidate();
      expect(result.trajectoriesCompleted).toBe(0);
      safeBridge.destroy();
    });

    it('should clear completed trajectories', async () => {
      await seedTrajectories(10);
      expect(bridge.getStats().activeTrajectories).toBe(10);
      await bridge.consolidate();
      expect(bridge.getStats().activeTrajectories).toBe(0);
    });

    it('should emit consolidation:completed event', async () => {
      await seedTrajectories(10);
      const handler = vi.fn();
      bridge.on('consolidation:completed', handler);

      await bridge.consolidate();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        trajectoriesCompleted: 10,
        patternsLearned: 10,
      }));
    });

    it('should track stats correctly', async () => {
      await seedTrajectories(10);
      await bridge.consolidate();
      const stats = bridge.getStats();
      expect(stats.completedTrajectories).toBe(10);
      expect(stats.totalConsolidations).toBe(1);
    });

    it('should handle completeTask failure for individual trajectories', async () => {
      await seedTrajectories(10);
      let callCount = 0;
      neural.completeTask.mockImplementation(async () => {
        callCount++;
        if (callCount === 3) throw new Error('Neural failure');
      });

      const result = await bridge.consolidate();
      expect(result.trajectoriesCompleted).toBe(9);
    });

    function createLowThresholdBridge(threshold = 1) {
      return new LearningBridge(backend, {
        consolidationThreshold: threshold,
        neuralLoader: createNeuralLoader(neural),
      });
    }

    // These reproduce the real AutoMemoryBridge flow: the backend entry's
    // internal `id` (a UUID) is DIFFERENT from the human-readable `key` it
    // was stored under, and it is the `key` — not the `id` — that flows
    // into onInsightRecorded/activeTrajectories/consolidate as "entryId".
    // Storing via backend.store() and looking up via the real getByKey
    // mock (keyed by namespace+key, not id) proves the fix resolves reward
    // through the correct index rather than merely satisfying a mock that
    // doesn't distinguish id from key.
    it('should pass the entry\'s current confidence as the completion reward, looked up by key (not id)', async () => {
      const lowThresholdBridge = createLowThresholdBridge();
      const entry = createTestEntry({
        id: 'uuid-independent-of-key',
        key: 'insight:debugging:1:0',
        metadata: { confidence: 0.42 },
      });
      await backend.store(entry);
      neural.beginTask.mockReturnValueOnce('traj-0');
      await lowThresholdBridge.onInsightRecorded(createTestInsight(), entry.key);

      await lowThresholdBridge.consolidate();

      expect(backend.getByKey).toHaveBeenCalledWith('learnings', entry.key);
      expect(neural.completeTask).toHaveBeenCalledWith('traj-0', 0.42);
      lowThresholdBridge.destroy();
    });

    it('should differentiate reward per trajectory based on each entry\'s confidence', async () => {
      const lowThresholdBridge = createLowThresholdBridge(2);
      const entryA = createTestEntry({ id: 'uuid-a', key: 'insight:a:1:0', metadata: { confidence: 0.9 } });
      const entryB = createTestEntry({ id: 'uuid-b', key: 'insight:b:2:1', metadata: { confidence: 0.2 } });
      await backend.store(entryA);
      await backend.store(entryB);
      neural.beginTask.mockReturnValueOnce('traj-0').mockReturnValueOnce('traj-1');
      await lowThresholdBridge.onInsightRecorded(createTestInsight(), entryA.key);
      await lowThresholdBridge.onInsightRecorded(createTestInsight({ summary: 'S2' }), entryB.key);

      await lowThresholdBridge.consolidate();

      expect(neural.completeTask).toHaveBeenCalledWith('traj-0', 0.9);
      expect(neural.completeTask).toHaveBeenCalledWith('traj-1', 0.2);
      lowThresholdBridge.destroy();
    });

    it('should fall back to reward=1.0 when no entry was ever stored under that key (unchanged prior behavior)', async () => {
      const lowThresholdBridge = createLowThresholdBridge();
      neural.beginTask.mockReturnValueOnce('traj-0');
      await lowThresholdBridge.onInsightRecorded(createTestInsight(), 'insight:never-stored:1:0');

      const result = await lowThresholdBridge.consolidate();

      expect(neural.completeTask).toHaveBeenCalledWith('traj-0', 1.0);
      expect(result.trajectoriesCompleted).toBe(1);
      expect(result.patternsLearned).toBe(1);
      lowThresholdBridge.destroy();
    });

    it('should fall back to reward=1.0 when the stored entry lacks numeric confidence', async () => {
      const lowThresholdBridge = createLowThresholdBridge();
      const entry = createTestEntry({ id: 'uuid-c', key: 'insight:c:1:0', metadata: {} });
      await backend.store(entry);
      neural.beginTask.mockReturnValueOnce('traj-0');
      await lowThresholdBridge.onInsightRecorded(createTestInsight(), entry.key);

      await lowThresholdBridge.consolidate();

      expect(neural.completeTask).toHaveBeenCalledWith('traj-0', 1.0);
      lowThresholdBridge.destroy();
    });

    it('should fall back to reward=1.0 when the backend lookup throws', async () => {
      const lowThresholdBridge = createLowThresholdBridge();
      neural.beginTask.mockReturnValueOnce('traj-0');
      await lowThresholdBridge.onInsightRecorded(createTestInsight(), 'insight:d:1:0');
      (backend.getByKey as any).mockRejectedValueOnce(new Error('DB unavailable'));

      const result = await lowThresholdBridge.consolidate();

      expect(neural.completeTask).toHaveBeenCalledWith('traj-0', 1.0);
      expect(result.trajectoriesCompleted).toBe(1);
      lowThresholdBridge.destroy();
    });

    it('should respect a custom insightNamespace when resolving reward', async () => {
      const customNsBridge = new LearningBridge(backend, {
        consolidationThreshold: 1,
        insightNamespace: 'custom-ns',
        neuralLoader: createNeuralLoader(neural),
      });
      const entry = createTestEntry({
        id: 'uuid-e', key: 'insight:e:1:0', namespace: 'custom-ns', metadata: { confidence: 0.77 },
      });
      await backend.store(entry);
      neural.beginTask.mockReturnValueOnce('traj-0');
      await customNsBridge.onInsightRecorded(createTestInsight(), entry.key);

      await customNsBridge.consolidate();

      expect(backend.getByKey).toHaveBeenCalledWith('custom-ns', entry.key);
      expect(neural.completeTask).toHaveBeenCalledWith('traj-0', 0.77);
      customNsBridge.destroy();
    });

    it('should respect custom consolidationThreshold', async () => {
      const customBridge = new LearningBridge(backend, {
        consolidationThreshold: 2,
        neuralLoader: createNeuralLoader(neural),
      });
      neural.beginTask.mockReturnValueOnce('traj-1').mockReturnValueOnce('traj-2');
      await customBridge.onInsightRecorded(createTestInsight(), 'e-1');
      await customBridge.onInsightRecorded(createTestInsight({ summary: 'S2' }), 'e-2');

      const result = await customBridge.consolidate();
      expect(result.trajectoriesCompleted).toBe(2);
      customBridge.destroy();
    });
  });

  // ===== decayConfidences =====

  describe('decayConfidences', () => {
    it('should decay entries older than 1 hour', async () => {
      const twoHoursAgo = Date.now() - 2 * 3_600_000;
      const entry = createTestEntry({
        id: 'old-entry', updatedAt: twoHoursAgo, metadata: { confidence: 0.9 },
      });
      (backend.query as any).mockResolvedValueOnce([entry]);

      const count = await bridge.decayConfidences('learnings');

      expect(count).toBe(1);
      const newConf = (backend.update as any).mock.calls[0][1].metadata.confidence;
      expect(newConf).toBeCloseTo(0.89, 2);
    });

    it('should respect minConfidence floor', async () => {
      const longAgo = Date.now() - 200 * 3_600_000;
      const entry = createTestEntry({
        id: 'ancient', updatedAt: longAgo, metadata: { confidence: 0.5 },
      });
      (backend.query as any).mockResolvedValueOnce([entry]);

      await bridge.decayConfidences('learnings');

      const newConf = (backend.update as any).mock.calls[0][1].metadata.confidence;
      expect(newConf).toBeGreaterThanOrEqual(0.1);
    });

    it('should skip recent entries', async () => {
      const entry = createTestEntry({
        id: 'recent', updatedAt: Date.now() - 30 * 60_000, metadata: { confidence: 0.8 },
      });
      (backend.query as any).mockResolvedValueOnce([entry]);

      const count = await bridge.decayConfidences('learnings');
      expect(count).toBe(0);
      expect(backend.update).not.toHaveBeenCalled();
    });

    it('should return count of decayed entries', async () => {
      const old = Date.now() - 2 * 3_600_000;
      const entries = [
        createTestEntry({ id: 'e1', updatedAt: old, metadata: { confidence: 0.9 } }),
        createTestEntry({ id: 'e2', updatedAt: old, metadata: { confidence: 0.7 } }),
        createTestEntry({ id: 'e3', updatedAt: Date.now(), metadata: { confidence: 0.5 } }),
      ];
      (backend.query as any).mockResolvedValueOnce(entries);

      const count = await bridge.decayConfidences('learnings');
      expect(count).toBe(2);
    });

    it('should handle empty namespace', async () => {
      (backend.query as any).mockResolvedValueOnce([]);
      const count = await bridge.decayConfidences('empty-ns');
      expect(count).toBe(0);
    });

    it('should handle query failure gracefully', async () => {
      (backend.query as any).mockRejectedValueOnce(new Error('DB error'));
      const count = await bridge.decayConfidences('broken');
      expect(count).toBe(0);
    });

    it('should track total decays in stats', async () => {
      const old = Date.now() - 5 * 3_600_000;
      (backend.query as any).mockResolvedValueOnce([
        createTestEntry({ id: 'e1', updatedAt: old, metadata: { confidence: 0.9 } }),
      ]);

      await bridge.decayConfidences('learnings');
      expect(bridge.getStats().totalDecays).toBe(1);
    });
  });

  // ===== findSimilarPatterns =====

  describe('findSimilarPatterns', () => {
    it('should return patterns when neural available', async () => {
      neural.findPatterns.mockResolvedValueOnce([
        { content: 'Pattern A', similarity: 0.9, category: 'debugging', confidence: 0.8 },
        { content: 'Pattern B', similarity: 0.7, category: 'performance', confidence: 0.6 },
      ]);

      const patterns = await bridge.findSimilarPatterns('test query');

      expect(patterns).toHaveLength(2);
      expect(patterns[0].content).toBe('Pattern A');
      expect(patterns[0].similarity).toBe(0.9);
      expect(patterns[1].category).toBe('performance');
    });

    it('should return empty when neural unavailable', async () => {
      const safeBridge = new LearningBridge(backend, {
        neuralLoader: createFailingNeuralLoader(),
      });
      const patterns = await safeBridge.findSimilarPatterns('test');
      expect(patterns).toHaveLength(0);
      safeBridge.destroy();
    });

    it('should map results to PatternMatch format', async () => {
      neural.findPatterns.mockResolvedValueOnce([
        { data: 'Raw data', score: 0.85, reward: 0.7 },
      ]);

      const patterns = await bridge.findSimilarPatterns('test');

      expect(patterns).toHaveLength(1);
      expect(patterns[0].content).toBe('Raw data');
      expect(patterns[0].similarity).toBe(0.85);
      expect(patterns[0].confidence).toBe(0.7);
      expect(patterns[0].category).toBe('unknown');
    });

    it('should pass k parameter to neural', async () => {
      await bridge.findSimilarPatterns('test', 3);

      expect(neural.findPatterns).toHaveBeenCalledWith(expect.any(Float32Array), 3);
    });

    it('should handle findPatterns throwing', async () => {
      neural.findPatterns.mockRejectedValueOnce(new Error('Neural error'));
      const patterns = await bridge.findSimilarPatterns('test');
      expect(patterns).toHaveLength(0);
    });

    it('should handle non-array result from findPatterns', async () => {
      neural.findPatterns.mockResolvedValueOnce(null);
      const patterns = await bridge.findSimilarPatterns('test');
      expect(patterns).toHaveLength(0);
    });
  });

  // ===== getStats =====

  describe('getStats', () => {
    it('should return correct initial stats', () => {
      const stats = bridge.getStats();
      expect(stats.totalTrajectories).toBe(0);
      expect(stats.completedTrajectories).toBe(0);
      expect(stats.activeTrajectories).toBe(0);
      expect(stats.totalConsolidations).toBe(0);
      expect(stats.totalDecays).toBe(0);
      expect(stats.avgConfidenceBoost).toBe(0);
    });

    it('should reflect operations in stats', async () => {
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');

      let stats = bridge.getStats();
      expect(stats.totalTrajectories).toBe(1);
      expect(stats.activeTrajectories).toBe(1);
      expect(stats.neuralAvailable).toBe(true);

      const entry = createTestEntry({ metadata: { confidence: 0.5 } });
      (backend.get as any).mockResolvedValueOnce(entry);
      await bridge.onInsightAccessed('entry-1');

      stats = bridge.getStats();
      expect(stats.avgConfidenceBoost).toBeCloseTo(0.03, 5);
    });

    it('should show neuralAvailable=false before init', () => {
      const fresh = new LearningBridge(backend);
      expect(fresh.getStats().neuralAvailable).toBe(false);
      fresh.destroy();
    });
  });

  // ===== destroy =====

  describe('destroy', () => {
    it('should set destroyed state', async () => {
      bridge.destroy();
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      expect(neural.beginTask).not.toHaveBeenCalled();
    });

    it('should clear trajectories', async () => {
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      expect(bridge.getStats().activeTrajectories).toBe(1);
      bridge.destroy();
      expect(bridge.getStats().activeTrajectories).toBe(0);
    });

    it('should make subsequent onInsightRecorded no-op', async () => {
      bridge.destroy();
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      expect(bridge.getStats().totalTrajectories).toBe(0);
    });

    it('should make subsequent onInsightAccessed no-op', async () => {
      bridge.destroy();
      await bridge.onInsightAccessed('entry-1');
      expect(backend.get).not.toHaveBeenCalled();
    });

    it('should make subsequent consolidate no-op', async () => {
      bridge.destroy();
      const result = await bridge.consolidate();
      expect(result.trajectoriesCompleted).toBe(0);
    });

    it('should make subsequent decayConfidences no-op', async () => {
      bridge.destroy();
      const count = await bridge.decayConfidences('learnings');
      expect(count).toBe(0);
    });

    it('should make subsequent findSimilarPatterns no-op', async () => {
      bridge.destroy();
      const patterns = await bridge.findSimilarPatterns('test');
      expect(patterns).toHaveLength(0);
    });

    it('should call neural cleanup if available', async () => {
      // Trigger neural init
      await bridge.onInsightRecorded(createTestInsight(), 'entry-1');
      vi.clearAllMocks();

      bridge.destroy();

      expect(neural.cleanup).toHaveBeenCalled();
    });

    it('should remove all event listeners', () => {
      bridge.on('insight:learning-started', () => {});
      bridge.on('consolidation:completed', () => {});
      bridge.destroy();
      expect(bridge.listenerCount('insight:learning-started')).toBe(0);
      expect(bridge.listenerCount('consolidation:completed')).toBe(0);
    });
  });

  // ===== Neural init caching =====

  describe('neural initialization', () => {
    it('should only attempt neural load once', async () => {
      const loaderFn = vi.fn().mockResolvedValue(neural);
      const b = new LearningBridge(backend, { neuralLoader: loaderFn });

      await b.onInsightRecorded(createTestInsight(), 'entry-1');
      await b.onInsightRecorded(createTestInsight({ summary: 'Second' }), 'entry-2');

      expect(loaderFn).toHaveBeenCalledTimes(1);
      b.destroy();
    });

    it('should cache failed init and not retry', async () => {
      const loaderFn = vi.fn().mockRejectedValue(new Error('fail'));
      const b = new LearningBridge(backend, { neuralLoader: loaderFn });

      await b.onInsightRecorded(createTestInsight(), 'entry-1');
      await b.onInsightRecorded(createTestInsight(), 'entry-2');

      expect(loaderFn).toHaveBeenCalledTimes(1);
      expect(b.getStats().neuralAvailable).toBe(false);
      b.destroy();
    });
  });
});
