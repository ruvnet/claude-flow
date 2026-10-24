/**
 * Token Optimizer Integration Tests
 * Validates agentic-flow Agent Booster integration
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { TokenOptimizer, getTokenOptimizer } from '../token-optimizer.js';

describe('TokenOptimizer', () => {
  let optimizer: TokenOptimizer;

  beforeAll(async () => {
    optimizer = await getTokenOptimizer();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const newOptimizer = new TokenOptimizer();
      await newOptimizer.initialize();

      const stats = newOptimizer.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats.agenticFlowAvailable).toBe('boolean');
    });

    // Availability detection is tested against narrow mocks of the one external
    // package, not against whatever agentic-flow build happens to be installed:
    // the installed agentic-flow@2.0.0-alpha currently fails to import (its
    // agentdb dependency moved dist/controllers), which made this environment-
    // dependent. Both branches of the detection logic are asserted exactly.
    describe('agentic-flow availability detection', () => {
      // Re-import the optimizer after registering mocks so its dynamic
      // import('agentic-flow') resolves against them, not a cached module.
      const freshTokenOptimizer = async () => {
        vi.resetModules();
        return (await import('../token-optimizer.js')).TokenOptimizer;
      };

      afterEach(() => {
        vi.doUnmock('agentic-flow');
        vi.doUnmock('agentic-flow/reasoningbank');
        vi.doUnmock('agentic-flow/agent-booster');
      });

      it('should detect agentic-flow when the module imports', async () => {
        const agentBooster = { editCode: async () => ({ method: 'agent-booster' }) };
        // Vitest module mocks throw on access to undeclared exports, so the
        // optional configTuning export the optimizer probes is declared as absent.
        vi.doMock('agentic-flow', () => ({ default: {}, configTuning: undefined }));
        vi.doMock('agentic-flow/reasoningbank', () => ({
          retrieveMemories: async () => [],
          formatMemoriesForPrompt: () => '',
        }));
        vi.doMock('agentic-flow/agent-booster', () => ({ agentBooster }));
        const Fresh = await freshTokenOptimizer();

        const detected = new Fresh();
        let initEvent: Record<string, boolean> | undefined;
        detected.on('initialized', (e) => { initEvent = e; });
        await detected.initialize();

        expect(detected.getStats().agenticFlowAvailable).toBe(true);
        expect(initEvent).toEqual({
          agenticFlowAvailable: true,
          reasoningBank: true,
          agentBooster: true,
          configTuning: false,
        });
      });

      it('should report agentic-flow unavailable when the import throws', async () => {
        vi.doMock('agentic-flow', () => {
          throw new Error('Cannot find module agentic-flow');
        });
        const Fresh = await freshTokenOptimizer();

        const missing = new Fresh();
        let initEvent: Record<string, boolean> | undefined;
        missing.on('initialized', (e) => { initEvent = e; });
        await missing.initialize();

        expect(missing.getStats().agenticFlowAvailable).toBe(false);
        expect(initEvent).toEqual({
          agenticFlowAvailable: false,
          reasoningBank: false,
          agentBooster: false,
          configTuning: false,
        });
      });
    });
  });

  describe('getCompactContext', () => {
    it('should return context structure', async () => {
      const ctx = await optimizer.getCompactContext('authentication patterns');

      expect(ctx).toHaveProperty('query');
      expect(ctx).toHaveProperty('memories');
      expect(ctx).toHaveProperty('compactPrompt');
      expect(ctx).toHaveProperty('tokensSaved');
      expect(ctx.query).toBe('authentication patterns');
    });

    it('should track tokens saved', async () => {
      const before = optimizer.getStats().totalTokensSaved;
      await optimizer.getCompactContext('test query');
      const after = optimizer.getStats().totalTokensSaved;

      // Should increase (or stay same if no memories found)
      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('optimizedEdit', () => {
    it('should return edit optimization result', async () => {
      const result = await optimizer.optimizedEdit(
        '/test/file.ts',
        'const x = 1;',
        'const x = 2;',
        'typescript'
      );

      expect(result).toHaveProperty('speedupFactor');
      expect(result).toHaveProperty('executionMs');
      expect(result).toHaveProperty('method');
      expect(['agent-booster', 'traditional']).toContain(result.method);
    });

    it('should count each agent-booster edit exactly once', async () => {
      const methods = ['agent-booster', 'traditional', 'agent-booster'];
      const booster = new TokenOptimizer();
      // Inject the Agent Booster dependency directly (the real agentic-flow
      // build may not be importable); only the stats bookkeeping is under test.
      (booster as any).agentBooster = {
        editCode: async () => ({ method: methods.shift(), speedupFactor: 2, executionTimeMs: 1 }),
      };

      const first = await booster.optimizedEdit('/a.ts', 'a', 'b', 'typescript');
      expect(first).toEqual({ speedupFactor: 2, executionMs: 1, method: 'agent-booster' });
      expect(booster.getStats().editsOptimized).toBe(1);

      // An edit the booster handled the traditional way is not an optimized edit
      const fallback = await booster.optimizedEdit('/b.ts', 'a', 'b', 'typescript');
      expect(fallback.method).toBe('traditional');
      expect(booster.getStats().editsOptimized).toBe(1);

      await booster.optimizedEdit('/c.ts', 'a', 'b', 'typescript');
      expect(booster.getStats().editsOptimized).toBe(2);
    });

    it('should track edits optimized', async () => {
      const before = optimizer.getStats().editsOptimized;
      await optimizer.optimizedEdit('/test.ts', 'a', 'b', 'typescript');
      const after = optimizer.getStats().editsOptimized;

      expect(after).toBeGreaterThanOrEqual(before);
    });
  });

  describe('getOptimalConfig', () => {
    it('should return anti-drift config for small teams', () => {
      const config = optimizer.getOptimalConfig(4);

      expect(config.batchSize).toBeLessThanOrEqual(5);
      expect(config.cacheSizeMB).toBeGreaterThanOrEqual(10);
      expect(config.topology).toBe('hierarchical');
      expect(config.expectedSuccessRate).toBeGreaterThanOrEqual(0.9);
    });

    it('should recommend mesh for very small teams', () => {
      const config = optimizer.getOptimalConfig(3);
      // Anti-drift still prefers hierarchical
      expect(['mesh', 'hierarchical']).toContain(config.topology);
    });

    // Since #1514 (v3.5.53, commit 0752e5963) the fallback config scales with
    // agent count: <=6 hierarchical, <=12 hierarchical-mesh, above that mesh;
    // batch size 2 / 4 / 6 for <=4 / <=8 / more agents.
    it('should scale to hierarchical-mesh for medium teams', () => {
      const config = optimizer.getOptimalConfig(8);

      expect(config.topology).toBe('hierarchical-mesh');
      expect(config.batchSize).toBe(4);
    });

    it('should handle large agent counts', () => {
      const config = optimizer.getOptimalConfig(15);

      expect(config.topology).toBe('mesh');
      expect(config.batchSize).toBe(6);
    });
  });

  describe('cachedLookup', () => {
    it('should cache results', async () => {
      let callCount = 0;
      const generator = async () => {
        callCount++;
        return { data: 'test' };
      };

      // First call - cache miss
      await optimizer.cachedLookup('test-key-1', generator);
      expect(callCount).toBe(1);

      // Second call - cache hit
      await optimizer.cachedLookup('test-key-1', generator);
      expect(callCount).toBe(1); // Should not increment
    });

    it('should track cache hits and misses', async () => {
      const before = optimizer.getStats();
      const totalBefore = before.cacheHits + before.cacheMisses;

      await optimizer.cachedLookup('unique-key-' + Date.now(), async () => 'value');

      const after = optimizer.getStats();
      const totalAfter = after.cacheHits + after.cacheMisses;

      expect(totalAfter).toBe(totalBefore + 1);
    });
  });

  describe('getStats', () => {
    it('should return all statistics', () => {
      const stats = optimizer.getStats();

      expect(stats).toHaveProperty('totalTokensSaved');
      expect(stats).toHaveProperty('editsOptimized');
      expect(stats).toHaveProperty('cacheHits');
      expect(stats).toHaveProperty('cacheMisses');
      expect(stats).toHaveProperty('memoriesRetrieved');
      expect(stats).toHaveProperty('agenticFlowAvailable');
      expect(stats).toHaveProperty('cacheHitRate');
      expect(stats).toHaveProperty('estimatedMonthlySavings');
    });

    it('should calculate cache hit rate', () => {
      const stats = optimizer.getStats();
      expect(stats.cacheHitRate).toMatch(/^\d+(\.\d+)?%$/);
    });

    it('should estimate monthly savings', () => {
      const stats = optimizer.getStats();
      expect(stats.estimatedMonthlySavings).toMatch(/^\$\d+(\.\d+)?$/);
    });
  });

  describe('generateReport', () => {
    it('should generate markdown report', () => {
      const report = optimizer.generateReport();

      expect(report).toContain('Token Optimization Report');
      expect(report).toContain('Tokens Saved');
      expect(report).toContain('Edits Optimized');
      expect(report).toContain('Cache Hit Rate');
    });
  });

  describe('singleton', () => {
    it('should return same instance via getTokenOptimizer', async () => {
      const opt1 = await getTokenOptimizer();
      const opt2 = await getTokenOptimizer();

      expect(opt1).toBe(opt2);
    });
  });
});
