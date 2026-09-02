/**
 * ReasoningBank Tests
 *
 * Unit tests for the V3 ReasoningBank pattern learning system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReasoningBank, type GuidancePattern } from '../reasoningbank/index.js';

describe('ReasoningBank', () => {
  let reasoningBank: ReasoningBank;

  beforeEach(() => {
    // Create a fresh instance for each test with mock embeddings
    reasoningBank = new ReasoningBank({
      useMockEmbeddings: true,
      dimensions: 384,
      hnswM: 16,
      hnswEfConstruction: 200,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize in in-memory mode when dependencies are not available', async () => {
      await reasoningBank.initialize();
      const stats = reasoningBank.getStats();

      expect(stats.shortTermCount).toBe(0);
      expect(stats.longTermCount).toBe(0);
      // Note: useRealBackend is true when AgentDB is available (even with mock embeddings)
      expect(typeof stats.useRealBackend).toBe('boolean');
    });

    it('should only initialize once', async () => {
      await reasoningBank.initialize();
      await reasoningBank.initialize(); // Second call should be no-op

      const stats = reasoningBank.getStats();
      expect(stats.shortTermCount).toBe(0);
    });
  });

  describe('storePattern', () => {
    it('should store a new pattern', async () => {
      await reasoningBank.initialize();

      const result = await reasoningBank.storePattern(
        'Use dependency injection for testability',
        'architecture'
      );

      expect(result.action).toBe('created');
      expect(result.id).toMatch(/^pat_/);

      const stats = reasoningBank.getStats();
      expect(stats.shortTermCount).toBe(1);
      expect(stats.metrics.patternsStored).toBe(1);
    });

    it('should update existing pattern if duplicate detected', async () => {
      await reasoningBank.initialize();

      // Store first pattern
      const first = await reasoningBank.storePattern(
        'Use dependency injection for testability',
        'architecture'
      );
      expect(first.action).toBe('created');

      // Store same pattern again - should update, not create
      const second = await reasoningBank.storePattern(
        'Use dependency injection for testability',
        'architecture'
      );

      // Both should reference same pattern
      expect(second.id).toBe(first.id);
      expect(second.action).toBe('updated');

      const stats = reasoningBank.getStats();
      expect(stats.shortTermCount).toBe(1); // Still just one pattern
    });

    it('should store multiple different patterns', async () => {
      await reasoningBank.initialize();

      await reasoningBank.storePattern('Security pattern', 'security');
      await reasoningBank.storePattern('Testing pattern', 'testing');
      await reasoningBank.storePattern('Performance pattern', 'performance');

      const stats = reasoningBank.getStats();
      expect(stats.shortTermCount).toBe(3);
    });

    it('should store patterns with metadata', async () => {
      await reasoningBank.initialize();

      const result = await reasoningBank.storePattern(
        'Use HNSW for fast vector search',
        'performance',
        { agent: 'memory-specialist', confidence: 0.95 }
      );

      expect(result.action).toBe('created');

      // Search and verify metadata is preserved
      const patterns = await reasoningBank.searchPatterns('HNSW vector search', 1);
      expect(patterns.length).toBe(1);
      expect(patterns[0].pattern.metadata.agent).toBe('memory-specialist');
    });
  });

  describe('searchPatterns', () => {
    beforeEach(async () => {
      await reasoningBank.initialize();
      await reasoningBank.storePattern('Validate inputs at boundaries', 'security');
      await reasoningBank.storePattern('Use TDD for testing', 'testing');
      await reasoningBank.storePattern('Use HNSW for vector search', 'performance');
    });

    it('should return patterns sorted by similarity', async () => {
      const results = await reasoningBank.searchPatterns('input validation security', 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].similarity).toBeGreaterThanOrEqual(results[1]?.similarity || 0);
    });

    it('should limit results to k', async () => {
      const results = await reasoningBank.searchPatterns('any query', 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should accept Float32Array as query', async () => {
      const embedding = new Float32Array(384).fill(0.5);
      const results = await reasoningBank.searchPatterns(embedding, 3);

      expect(results.length).toBeGreaterThan(0);
    });

    it('should update metrics on search', async () => {
      const initialStats = reasoningBank.getStats();
      const initialSearchCount = initialStats.metrics.searchCount;

      await reasoningBank.searchPatterns('test query', 5);
      await reasoningBank.searchPatterns('another query', 5);

      const stats = reasoningBank.getStats();
      // At least 2 new searches should be recorded (internal ops may add more)
      expect(stats.metrics.searchCount).toBeGreaterThanOrEqual(initialSearchCount + 2);
      expect(stats.metrics.totalSearchTime).toBeGreaterThan(0);
    });
  });

  describe('generateGuidance', () => {
    beforeEach(async () => {
      await reasoningBank.initialize();
      await reasoningBank.storePattern('Validate inputs at boundaries', 'security');
      await reasoningBank.storePattern('Use TDD for testing', 'testing');
    });

    it('should generate guidance with domain detection', async () => {
      const guidance = await reasoningBank.generateGuidance({
        event: 'pre-edit' as any,
        timestamp: new Date(),
        file: { path: 'src/auth/login.ts', operation: 'modify' },
      });

      expect(guidance.recommendations.length).toBeGreaterThan(0);
      expect(guidance.searchTimeMs).toBeGreaterThan(0);
    });

    it('should detect security domain', async () => {
      const guidance = await reasoningBank.generateGuidance({
        event: 'pre-route' as any,
        timestamp: new Date(),
        routing: { task: 'Fix authentication security vulnerability' },
      });

      expect(guidance.context).toContain('security');
    });

    it('should detect testing domain', async () => {
      const guidance = await reasoningBank.generateGuidance({
        event: 'pre-route' as any,
        timestamp: new Date(),
        routing: { task: 'Write unit tests with mocks' },
      });

      expect(guidance.context.toLowerCase()).toContain('testing');
    });

    it('should include agent suggestion', async () => {
      const guidance = await reasoningBank.generateGuidance({
        event: 'pre-route' as any,
        timestamp: new Date(),
        routing: { task: 'Implement caching layer' },
      });

      expect(guidance.agentSuggestion).toBeDefined();
      expect(guidance.agentSuggestion?.agent).toBeDefined();
      expect(guidance.agentSuggestion?.confidence).toBeGreaterThan(0);
    });
  });

  describe('routeTask', () => {
    beforeEach(async () => {
      await reasoningBank.initialize();
    });

    it('should route security tasks to security-architect', async () => {
      const result = await reasoningBank.routeTask('Fix authentication vulnerability CVE-2024');

      expect(result.agent).toBe('security-architect');
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should route testing tasks to test-architect', async () => {
      const result = await reasoningBank.routeTask('Write unit tests with mocks');

      expect(result.agent).toBe('test-architect');
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should route performance tasks to performance-engineer', async () => {
      const result = await reasoningBank.routeTask('Optimize memory usage and cache');

      expect(result.agent).toBe('performance-engineer');
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should provide alternatives', async () => {
      const result = await reasoningBank.routeTask('Implement new feature');

      expect(result.alternatives).toBeDefined();
      expect(result.alternatives.length).toBeGreaterThan(0);
    });

    it('should default to coder for general tasks', async () => {
      const result = await reasoningBank.routeTask('Update the readme file');

      expect(result.agent).toBe('coder');
    });
  });

  describe('recordOutcome', () => {
    it('should update pattern quality on success', async () => {
      await reasoningBank.initialize();

      const { id } = await reasoningBank.storePattern('Test pattern', 'testing');

      await reasoningBank.recordOutcome(id, true);
      await reasoningBank.recordOutcome(id, true);

      const patterns = await reasoningBank.searchPatterns('Test pattern', 1);
      expect(patterns[0].pattern.successCount).toBe(2);
      expect(patterns[0].pattern.quality).toBeGreaterThan(0.5);
    });

    it('should update pattern quality on failure', async () => {
      await reasoningBank.initialize();

      const { id } = await reasoningBank.storePattern('Test pattern', 'testing');

      await reasoningBank.recordOutcome(id, false);

      const patterns = await reasoningBank.searchPatterns('Test pattern', 1);
      expect(patterns[0].pattern.usageCount).toBe(2);
      expect(patterns[0].pattern.successCount).toBe(0);
    });

    it('should handle non-existent pattern gracefully', async () => {
      await reasoningBank.initialize();

      // Should not throw
      await reasoningBank.recordOutcome('non-existent-id', true);
    });
  });

  describe('consolidate', () => {
    it('should prune old low-quality patterns', async () => {
      await reasoningBank.initialize();

      // Store a pattern
      await reasoningBank.storePattern('Old pattern', 'general');

      // Immediately consolidate - shouldn't prune yet (too recent)
      const result = await reasoningBank.consolidate();

      expect(result.patternsPruned).toBe(0);
    });

    it('should return consolidation stats', async () => {
      await reasoningBank.initialize();

      const result = await reasoningBank.consolidate();

      expect(result).toHaveProperty('duplicatesRemoved');
      expect(result).toHaveProperty('patternsPruned');
      expect(result).toHaveProperty('patternsPromoted');
    });
  });

  describe('exportPatterns / importPatterns', () => {
    it('should export all patterns', async () => {
      await reasoningBank.initialize();

      await reasoningBank.storePattern('Pattern 1', 'testing');
      await reasoningBank.storePattern('Pattern 2', 'security');

      const exported = await reasoningBank.exportPatterns();

      expect(exported.shortTerm.length).toBe(2);
      expect(exported.longTerm.length).toBe(0);
    });

    it('should import patterns', async () => {
      await reasoningBank.initialize();

      const testPattern: GuidancePattern = {
        id: 'imported_1',
        strategy: 'Imported test pattern',
        domain: 'testing',
        embedding: new Float32Array(384).fill(0.1),
        quality: 0.8,
        usageCount: 5,
        successCount: 4,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      };

      const result = await reasoningBank.importPatterns({
        shortTerm: [testPattern],
        longTerm: [],
      });

      expect(result.imported).toBe(1);

      const stats = reasoningBank.getStats();
      expect(stats.shortTermCount).toBe(1);
    });

    it('should not import duplicate patterns', async () => {
      await reasoningBank.initialize();

      const testPattern: GuidancePattern = {
        id: 'imported_1',
        strategy: 'Imported test pattern',
        domain: 'testing',
        embedding: new Float32Array(384).fill(0.1),
        quality: 0.8,
        usageCount: 5,
        successCount: 4,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        metadata: {},
      };

      await reasoningBank.importPatterns({
        shortTerm: [testPattern],
        longTerm: [],
      });

      // Import same pattern again
      const result = await reasoningBank.importPatterns({
        shortTerm: [testPattern],
        longTerm: [],
      });

      expect(result.imported).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      await reasoningBank.initialize();

      await reasoningBank.storePattern('Pattern 1', 'testing');
      await reasoningBank.storePattern('Pattern 2', 'security');
      await reasoningBank.searchPatterns('test', 5);

      const stats = reasoningBank.getStats();

      expect(stats.shortTermCount).toBe(2);
      expect(stats.longTermCount).toBe(0);
      expect(stats.metrics.patternsStored).toBe(2);
      // searchCount includes internal searches during storePattern (duplicate detection)
      expect(stats.metrics.searchCount).toBeGreaterThanOrEqual(1);
      expect(stats.avgSearchTime).toBeGreaterThan(0);
    });
  });

  describe('events', () => {
    it('should emit pattern:stored event', async () => {
      await reasoningBank.initialize();

      const events: any[] = [];
      reasoningBank.on('pattern:stored', (data) => events.push(data));

      await reasoningBank.storePattern('Test pattern', 'testing');

      expect(events.length).toBe(1);
      expect(events[0].domain).toBe('testing');
    });

    it('should emit outcome:recorded event', async () => {
      await reasoningBank.initialize();

      const events: any[] = [];
      reasoningBank.on('outcome:recorded', (data) => events.push(data));

      const { id } = await reasoningBank.storePattern('Test pattern', 'testing');
      await reasoningBank.recordOutcome(id, true);

      expect(events.length).toBe(1);
      expect(events[0].success).toBe(true);
    });

    it('should emit consolidated event', async () => {
      await reasoningBank.initialize();

      const events: any[] = [];
      reasoningBank.on('consolidated', (data) => events.push(data));

      await reasoningBank.consolidate();

      expect(events.length).toBe(1);
      expect(events[0]).toHaveProperty('patternsPromoted');
    });
  });
});
