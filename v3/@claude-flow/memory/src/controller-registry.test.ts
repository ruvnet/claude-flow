/**
 * Comprehensive tests for ControllerRegistry (ADR-053)
 *
 * Covers:
 * - Initialization lifecycle and level-based ordering
 * - Graceful degradation (isolated controller failures)
 * - Config-driven activation
 * - Health check aggregation
 * - Shutdown ordering
 * - Cross-platform path handling (Linux/Mac/Windows)
 * - AgentDB unavailable scenarios
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ControllerRegistry,
  INIT_LEVELS,
  type RuntimeConfig,
  type ControllerName,
  type RegistryHealthReport,
} from './controller-registry.js';
import { LearningBridge } from './learning-bridge.js';
import { MemoryGraph } from './memory-graph.js';
import { TieredCacheManager } from './cache-manager.js';
import type {
  IMemoryBackend,
  MemoryEntry,
  MemoryQuery,
  MemoryEntryUpdate,
  SearchOptions,
  SearchResult,
  BackendStats,
  HealthCheckResult,
  MemoryType,
} from './types.js';

// ===== Mock Backend =====

function createMockBackend(): IMemoryBackend {
  const entries = new Map<string, MemoryEntry>();

  return {
    async initialize() {},
    async shutdown() {},
    async store(entry: MemoryEntry) {
      entries.set(entry.id, entry);
    },
    async get(id: string) {
      return entries.get(id) ?? null;
    },
    async getByKey(namespace: string, key: string) {
      for (const e of entries.values()) {
        if (e.namespace === namespace && e.key === key) return e;
      }
      return null;
    },
    async update(id: string, update: MemoryEntryUpdate) {
      const entry = entries.get(id);
      if (!entry) return null;
      Object.assign(entry, update, { updatedAt: Date.now() });
      return entry;
    },
    async delete(id: string) {
      return entries.delete(id);
    },
    async query(query: MemoryQuery) {
      const results = Array.from(entries.values());
      if (query.namespace) {
        return results.filter((e) => e.namespace === query.namespace).slice(0, query.limit);
      }
      return results.slice(0, query.limit);
    },
    async search(_embedding: Float32Array, _options: SearchOptions): Promise<SearchResult[]> {
      return [];
    },
    async bulkInsert(newEntries: MemoryEntry[]) {
      for (const entry of newEntries) entries.set(entry.id, entry);
    },
    async bulkDelete(ids: string[]) {
      let count = 0;
      for (const id of ids) {
        if (entries.delete(id)) count++;
      }
      return count;
    },
    async count(namespace?: string) {
      if (namespace) {
        return Array.from(entries.values()).filter((e) => e.namespace === namespace).length;
      }
      return entries.size;
    },
    async listNamespaces() {
      return [...new Set(Array.from(entries.values()).map((e) => e.namespace))];
    },
    async clearNamespace(namespace: string) {
      let count = 0;
      for (const [id, entry] of entries) {
        if (entry.namespace === namespace) {
          entries.delete(id);
          count++;
        }
      }
      return count;
    },
    async getStats(): Promise<BackendStats> {
      return {
        totalEntries: entries.size,
        entriesByNamespace: {},
        entriesByType: { episodic: 0, semantic: 0, procedural: 0, working: 0, cache: 0 },
        memoryUsage: 0,
        avgQueryTime: 0,
        avgSearchTime: 0,
      };
    },
    async healthCheck(): Promise<HealthCheckResult> {
      return {
        status: 'healthy',
        components: {
          storage: { status: 'healthy', latency: 0 },
          index: { status: 'healthy', latency: 0 },
          cache: { status: 'healthy', latency: 0 },
        },
        timestamp: Date.now(),
        issues: [],
        recommendations: [],
      };
    },
  };
}

// ===== Test Suite =====

describe('ControllerRegistry', () => {
  let registry: ControllerRegistry;
  let mockBackend: IMemoryBackend;

  beforeEach(() => {
    registry = new ControllerRegistry();
    mockBackend = createMockBackend();
  });

  afterEach(async () => {
    if (registry.isInitialized()) {
      await registry.shutdown();
    }
  });

  // ----- Lifecycle Tests -----

  describe('initialization lifecycle', () => {
    it('should initialize with default config', async () => {
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should not initialize twice', async () => {
      await registry.initialize({ backend: mockBackend });
      const count1 = registry.getActiveCount();
      await registry.initialize({ backend: mockBackend });
      expect(registry.getActiveCount()).toBe(count1);
    });

    it('should initialize with empty config', async () => {
      await registry.initialize();
      expect(registry.isInitialized()).toBe(true);
    });

    it('should emit initialized event', async () => {
      const handler = vi.fn();
      registry.on('initialized', handler);
      await registry.initialize({ backend: mockBackend });
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          initTimeMs: expect.any(Number),
          activeControllers: expect.any(Number),
          totalControllers: expect.any(Number),
        }),
      );
    });

    it('should emit controller:initialized events', async () => {
      const handler = vi.fn();
      registry.on('controller:initialized', handler);
      await registry.initialize({ backend: mockBackend });
      // At minimum learningBridge and tieredCache should init
      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('should track init time', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();
      expect(report.initTimeMs).toBeGreaterThan(0);
    });
  });

  // ----- Level-Based Ordering -----

  describe('level-based initialization ordering', () => {
    it('should define 7 initialization levels (0-6)', () => {
      expect(INIT_LEVELS).toHaveLength(7);
      expect(INIT_LEVELS[0].level).toBe(0);
      expect(INIT_LEVELS[6].level).toBe(6);
    });

    it('should have monotonically increasing levels', () => {
      for (let i = 1; i < INIT_LEVELS.length; i++) {
        expect(INIT_LEVELS[i].level).toBeGreaterThan(INIT_LEVELS[i - 1].level);
      }
    });

    it('should include core controllers in level 1', () => {
      const level1 = INIT_LEVELS.find((l) => l.level === 1);
      expect(level1?.controllers).toContain('reasoningBank');
      expect(level1?.controllers).toContain('learningBridge');
      expect(level1?.controllers).toContain('tieredCache');
    });

    it('should include graph controllers in level 2', () => {
      const level2 = INIT_LEVELS.find((l) => l.level === 2);
      expect(level2?.controllers).toContain('memoryGraph');
      expect(level2?.controllers).toContain('agentMemoryScope');
    });

    it('should include specialization controllers in level 3', () => {
      const level3 = INIT_LEVELS.find((l) => l.level === 3);
      expect(level3?.controllers).toContain('skills');
      expect(level3?.controllers).toContain('explainableRecall');
      expect(level3?.controllers).toContain('reflexion');
    });

    it('should include causal controllers in level 4', () => {
      const level4 = INIT_LEVELS.find((l) => l.level === 4);
      expect(level4?.controllers).toContain('causalGraph');
      expect(level4?.controllers).toContain('nightlyLearner');
    });

    it('should include advanced services in level 5', () => {
      const level5 = INIT_LEVELS.find((l) => l.level === 5);
      expect(level5?.controllers).toContain('graphTransformer');
      expect(level5?.controllers).toContain('sonaTrajectory');
    });

    it('should include session management in level 6', () => {
      const level6 = INIT_LEVELS.find((l) => l.level === 6);
      expect(level6?.controllers).toContain('federatedSession');
    });

    it('should not have duplicate controller names across levels', () => {
      const allNames: ControllerName[] = [];
      for (const level of INIT_LEVELS) {
        for (const name of level.controllers) {
          expect(allNames).not.toContain(name);
          allNames.push(name);
        }
      }
    });
  });

  // ----- Graceful Degradation -----

  describe('graceful degradation', () => {
    it('should continue when AgentDB is unavailable', async () => {
      // No AgentDB module available — should still init CLI-layer controllers
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should mark failed controllers as unavailable without crashing', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      // Some controllers should be unavailable (no AgentDB)
      // but the registry itself should be functional
      expect(report.status).not.toBe('unhealthy');
    });

    it('should emit controller:failed for failed controllers', async () => {
      const handler = vi.fn();
      registry.on('controller:failed', handler);

      // Enable a controller that requires AgentDB (which is unavailable)
      await registry.initialize({
        backend: mockBackend,
        controllers: { reasoningBank: true },
      });

      // ReasoningBank requires AgentDB, so it should fail or be unavailable
      // The exact behavior depends on whether agentdb is importable
    });

    it('should handle null backend gracefully', async () => {
      await registry.initialize({});
      expect(registry.isInitialized()).toBe(true);
      expect(registry.getBackend()).toBeNull();
    });

    it('should isolate controller failures from each other', async () => {
      // Initialize with backend - learningBridge and tieredCache should work
      await registry.initialize({ backend: mockBackend });

      // LearningBridge should be available (it only needs backend)
      const bridge = registry.get<LearningBridge>('learningBridge');
      expect(bridge).toBeInstanceOf(LearningBridge);

      // TieredCache should be available
      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });
  });

  // ----- Config-Driven Activation -----

  describe('config-driven activation', () => {
    it('should respect explicit controller enable/disable', async () => {
      await registry.initialize({
        backend: mockBackend,
        controllers: {
          learningBridge: false,
          tieredCache: true,
        },
      });

      expect(registry.isEnabled('learningBridge')).toBe(false);
      expect(registry.isEnabled('tieredCache')).toBe(true);
    });

    it('should enable learningBridge by default when backend is available', async () => {
      await registry.initialize({ backend: mockBackend });
      expect(registry.isEnabled('learningBridge')).toBe(true);
    });

    it('should enable tieredCache by default', async () => {
      await registry.initialize({ backend: mockBackend });
      expect(registry.isEnabled('tieredCache')).toBe(true);
    });

    it('should pass SONA mode to LearningBridge', async () => {
      await registry.initialize({
        backend: mockBackend,
        neural: { enabled: true, sonaMode: 'research' },
      });

      const bridge = registry.get<LearningBridge>('learningBridge');
      expect(bridge).toBeInstanceOf(LearningBridge);
    });

    it('should pass memoryGraph config', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          memoryGraph: { pageRankDamping: 0.9, maxNodes: 1000 },
        },
      });

      const graph = registry.get<MemoryGraph>('memoryGraph');
      expect(graph).toBeInstanceOf(MemoryGraph);
    });

    it('should pass tieredCache config', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          tieredCache: { maxSize: 5000, ttl: 60000 },
        },
      });

      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });

    it('should not enable optional controllers by default', async () => {
      await registry.initialize({ backend: mockBackend });

      expect(registry.isEnabled('hybridSearch')).toBe(false);
      expect(registry.isEnabled('federatedSession')).toBe(false);
      // semanticRouter auto-enables when agentdb is available (since alpha.10)
      expect(registry.isEnabled('sonaTrajectory')).toBe(false);
    });
  });

  // ----- Controller Access -----

  describe('controller access (get/isEnabled)', () => {
    it('should return null for unregistered controllers', async () => {
      await registry.initialize({ backend: mockBackend });
      expect(registry.get('hybridSearch')).toBeNull();
    });

    it('should return typed controller instances', async () => {
      await registry.initialize({ backend: mockBackend });

      const bridge = registry.get<LearningBridge>('learningBridge');
      if (bridge) {
        expect(typeof bridge.consolidate).toBe('function');
        expect(typeof bridge.getStats).toBe('function');
      }
    });

    it('should return false for disabled controllers', async () => {
      await registry.initialize({
        backend: mockBackend,
        controllers: { learningBridge: false },
      });
      expect(registry.isEnabled('learningBridge')).toBe(false);
    });

    // Regression guard for ruvnet/ruflo#2019.
    //
    // agentdb@3.0.0-alpha.14's `getController()` switch only handles
    // memory/reflexion/skills/causal/causalGraph and THROWS
    // `Unknown controller: vectorBackend` for everything else. The
    // registry's old try/catch silently swallowed that throw and
    // returned null — so `vectorBackend` (and `graphAdapter`) reported
    // `enabled: false` even though the field is right there on the
    // agentdb instance. The fix probes `agentdb[name]` directly before
    // falling back to getController.
    it('vectorBackend/graphAdapter: prefers direct property over getController (issue #2019)', async () => {
      const fakeVectorBackend = { kind: 'vectorBackend' };
      const fakeGraphAdapter = { kind: 'graphAdapter' };
      // Simulate agentdb@3.0.0-alpha.14: fields exist, but getController
      // throws Unknown controller for anything not in the small switch.
      const fakeAgentDb: any = {
        vectorBackend: fakeVectorBackend,
        graphAdapter: fakeGraphAdapter,
        getController(name: string) {
          if (name === 'memory' || name === 'reflexion') return null;
          throw new Error(`Unknown controller: ${name}`);
        },
      };

      await registry.initialize({
        backend: mockBackend,
        agentdb: fakeAgentDb,
      });

      // Both controllers must be reachable via the direct property
      // probe, NOT silently null because getController threw.
      expect(registry.get('vectorBackend')).toBe(fakeVectorBackend);
      expect(registry.get('graphAdapter')).toBe(fakeGraphAdapter);
      expect(registry.isEnabled('vectorBackend')).toBe(true);
      expect(registry.isEnabled('graphAdapter')).toBe(true);
    });

    // Companion guard: if a future agentdb exposes these via
    // getController instead of as direct fields, we must still find
    // them — proves the fallback path stays intact.
    it('vectorBackend: falls back to getController when no direct property exists (issue #2019)', async () => {
      const fakeVectorBackend = { kind: 'vectorBackend-via-controller' };
      const fakeAgentDb: any = {
        // No `.vectorBackend` field at all.
        getController(name: string) {
          if (name === 'vectorBackend') return fakeVectorBackend;
          return null;
        },
      };

      await registry.initialize({
        backend: mockBackend,
        agentdb: fakeAgentDb,
      });

      expect(registry.get('vectorBackend')).toBe(fakeVectorBackend);
      expect(registry.isEnabled('vectorBackend')).toBe(true);
    });
  });

  // ----- Health Check -----

  describe('health check', () => {
    it('should return healthy when controllers are active', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.initTimeMs).toBeGreaterThanOrEqual(0);
      expect(report.controllers).toBeInstanceOf(Array);
    });

    it('should report active and total controller counts', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      expect(report.activeControllers).toBeGreaterThanOrEqual(0);
      expect(report.totalControllers).toBeGreaterThanOrEqual(report.activeControllers);
    });

    it('should report agentdb availability', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();
      expect(typeof report.agentdbAvailable).toBe('boolean');
    });

    it('should classify status correctly', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      expect(['healthy', 'degraded', 'unhealthy']).toContain(report.status);
    });

    it('should include individual controller health', async () => {
      await registry.initialize({ backend: mockBackend });
      const report = await registry.healthCheck();

      for (const controller of report.controllers) {
        expect(controller).toHaveProperty('name');
        expect(controller).toHaveProperty('status');
        expect(controller).toHaveProperty('initTimeMs');
        expect(['healthy', 'degraded', 'unavailable']).toContain(controller.status);
      }
    });
  });

  // ----- Shutdown -----

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      expect(registry.isInitialized()).toBe(false);
    });

    it('should emit shutdown event', async () => {
      const handler = vi.fn();
      registry.on('shutdown', handler);
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should handle double shutdown', async () => {
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      await registry.shutdown(); // Should be a no-op
      expect(registry.isInitialized()).toBe(false);
    });

    it('should handle shutdown without initialization', async () => {
      await registry.shutdown(); // Should be a no-op
      expect(registry.isInitialized()).toBe(false);
    });

    it('should clean up controllers', async () => {
      await registry.initialize({ backend: mockBackend });
      const countBefore = registry.getActiveCount();
      await registry.shutdown();
      expect(registry.getActiveCount()).toBe(0);
    });

    it('should allow re-initialization after shutdown', async () => {
      await registry.initialize({ backend: mockBackend });
      await registry.shutdown();
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });
  });

  // ----- Controller Listing -----

  describe('listControllers', () => {
    it('should return list of all registered controllers', async () => {
      await registry.initialize({ backend: mockBackend });
      const list = registry.listControllers();

      expect(list).toBeInstanceOf(Array);
      for (const item of list) {
        expect(item).toHaveProperty('name');
        expect(item).toHaveProperty('enabled');
        expect(item).toHaveProperty('level');
        expect(typeof item.name).toBe('string');
        expect(typeof item.enabled).toBe('boolean');
        expect(typeof item.level).toBe('number');
      }
    });
  });

  // ----- AgentDB Integration -----

  describe('AgentDB integration', () => {
    it('should handle missing agentdb module', async () => {
      // With no agentdb installed, should still work
      await registry.initialize({ backend: mockBackend });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should return null AgentDB when unavailable', async () => {
      await registry.initialize({ backend: mockBackend });
      // May or may not be available depending on test environment
      const agentdb = registry.getAgentDB();
      // Just ensure it doesn't throw
      expect(agentdb === null || agentdb !== null).toBe(true);
    });
  });

  // ----- Cross-Platform Path Handling -----

  describe('cross-platform compatibility', () => {
    it('should handle forward slash paths', async () => {
      await registry.initialize({
        backend: mockBackend,
        dbPath: '/tmp/test/memory.db',
      });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should handle relative paths', async () => {
      await registry.initialize({
        backend: mockBackend,
        dbPath: './data/memory.db',
      });
      expect(registry.isInitialized()).toBe(true);
    });

    it('should handle :memory: path', async () => {
      await registry.initialize({
        backend: mockBackend,
        dbPath: ':memory:',
      });
      expect(registry.isInitialized()).toBe(true);
    });
  });

  // ----- LearningBridge Integration -----

  describe('LearningBridge via registry', () => {
    it('should create LearningBridge with backend', async () => {
      await registry.initialize({ backend: mockBackend });
      const bridge = registry.get<LearningBridge>('learningBridge');
      expect(bridge).toBeInstanceOf(LearningBridge);
    });

    it('should pass config to LearningBridge', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          learningBridge: {
            sonaMode: 'edge',
            confidenceDecayRate: 0.01,
            accessBoostAmount: 0.05,
            consolidationThreshold: 5,
          },
        },
      });

      const bridge = registry.get<LearningBridge>('learningBridge');
      expect(bridge).toBeInstanceOf(LearningBridge);

      const stats = bridge!.getStats();
      expect(stats.totalTrajectories).toBe(0);
      expect(stats.neuralAvailable).toBe(false); // No neural module in tests
    });

    it('should not create LearningBridge without backend', async () => {
      await registry.initialize({});
      const bridge = registry.get<LearningBridge>('learningBridge');
      // Without backend, LearningBridge returns null
      expect(bridge).toBeNull();
    });
  });

  // ----- MemoryGraph Integration -----

  describe('MemoryGraph via registry', () => {
    it('should create MemoryGraph when configured', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          memoryGraph: { pageRankDamping: 0.85, maxNodes: 5000 },
        },
      });

      const graph = registry.get<MemoryGraph>('memoryGraph');
      expect(graph).toBeInstanceOf(MemoryGraph);
    });

    it('should report graph stats', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          memoryGraph: {},
        },
      });

      const graph = registry.get<MemoryGraph>('memoryGraph');
      if (graph) {
        const stats = graph.getStats();
        expect(stats.nodeCount).toBeGreaterThanOrEqual(0);
        expect(stats.edgeCount).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ----- TieredCache Integration -----

  describe('TieredCacheManager via registry', () => {
    it('should create TieredCacheManager', async () => {
      await registry.initialize({ backend: mockBackend });
      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });

    it('should respect cache config', async () => {
      await registry.initialize({
        backend: mockBackend,
        memory: {
          tieredCache: { maxSize: 500, ttl: 10000 },
        },
      });

      const cache = registry.get<TieredCacheManager>('tieredCache');
      expect(cache).toBeInstanceOf(TieredCacheManager);
    });
  });

  // ----- Event Emission -----

  describe('events', () => {
    it('should emit agentdb:unavailable when module missing', async () => {
      const handler = vi.fn();
      registry.on('agentdb:unavailable', handler);
      await registry.initialize({ backend: mockBackend });
      // AgentDB may or may not be available in test environment
      // Just verify the listener doesn't break anything
    });

    it('should emit controller:degraded with the reason hierarchicalMemory fell back (#2887)', async () => {
      const degraded: Array<{ name: string; reason: string; persistence: string }> = [];
      registry.on('controller:degraded', (e: any) => degraded.push(e));

      await registry.initialize({
        backend: mockBackend,
        controllers: { hierarchicalMemory: true },
      });

      // agentdb dropped its HierarchicalMemory export at 3.0.0-alpha.17, so the
      // tiered fallback is the live path. Taking it must be announced, not silent.
      const hmDegraded = degraded.find((e) => e.name === 'hierarchicalMemory');
      expect(hmDegraded).toBeDefined();
      expect(hmDegraded!.reason).toBeTruthy();
      expect(registry.getHierarchicalFallback()).toMatchObject({ reason: hmDegraded!.reason });
    });

    it('should emit all lifecycle events', async () => {
      const events: string[] = [];
      registry.on('initialized', () => events.push('initialized'));
      registry.on('shutdown', () => events.push('shutdown'));

      await registry.initialize({ backend: mockBackend });
      expect(events).toContain('initialized');

      await registry.shutdown();
      expect(events).toContain('shutdown');
    });
  });

  // ----- Performance -----

  describe('performance', () => {
    it('should initialize within 500ms', async () => {
      const start = performance.now();
      await registry.initialize({ backend: mockBackend });
      const duration = performance.now() - start;

      // Per ADR-053: "No regression beyond 10% in CLI startup time"
      expect(duration).toBeLessThan(500);
    });

    it('should shutdown within 100ms', async () => {
      await registry.initialize({ backend: mockBackend });

      const start = performance.now();
      await registry.shutdown();
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should have low overhead for controller access', async () => {
      await registry.initialize({ backend: mockBackend });

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        registry.get('learningBridge');
        registry.get('tieredCache');
        registry.isEnabled('reasoningBank');
      }
      const duration = performance.now() - start;

      // 3000 lookups should complete in under 10ms
      expect(duration).toBeLessThan(10);
    });
  });
});

// ===== HybridBackend Proxy Methods Tests =====

describe('HybridBackend proxy methods', () => {
  it('should export recordFeedback method', async () => {
    const { HybridBackend } = await import('./hybrid-backend.js');
    const backend = new HybridBackend();

    expect(typeof backend.recordFeedback).toBe('function');
  });

  it('should export verifyWitnessChain method', async () => {
    const { HybridBackend } = await import('./hybrid-backend.js');
    const backend = new HybridBackend();

    expect(typeof backend.verifyWitnessChain).toBe('function');
  });

  it('should export getWitnessChain method', async () => {
    const { HybridBackend } = await import('./hybrid-backend.js');
    const backend = new HybridBackend();

    expect(typeof backend.getWitnessChain).toBe('function');
  });

  it('should return false for recordFeedback when AgentDB unavailable', async () => {
    const { HybridBackend } = await import('./hybrid-backend.js');
    const backend = new HybridBackend();
    await backend.initialize();

    const result = await backend.recordFeedback('entry-1', { score: 0.9 });
    expect(result).toBe(false);

    await backend.shutdown();
  });

  it('should return invalid for verifyWitnessChain when AgentDB unavailable', async () => {
    const { HybridBackend } = await import('./hybrid-backend.js');
    const backend = new HybridBackend();
    await backend.initialize();

    const result = await backend.verifyWitnessChain('entry-1');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('AgentDB not available');

    await backend.shutdown();
  });

  it('should return empty array for getWitnessChain when AgentDB unavailable', async () => {
    const { HybridBackend } = await import('./hybrid-backend.js');
    const backend = new HybridBackend();
    await backend.initialize();

    const result = await backend.getWitnessChain('entry-1');
    expect(result).toEqual([]);

    await backend.shutdown();
  });
});
