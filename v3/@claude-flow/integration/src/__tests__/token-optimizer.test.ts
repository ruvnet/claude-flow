/**
 * Token Optimizer Integration Tests
 * Validates agentic-flow Agent Booster integration
 */

import { describe, it, expect, beforeAll } from 'vitest';
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

    it('should detect agentic-flow availability', async () => {
      const stats = optimizer.getStats();
      // agentic-flow loadability depends on onnx native bindings, which
      // pnpm doesn't postinstall by default in CI. The optimizer's
      // detection is honest either way; this assertion checks the
      // *detection*, not the *availability*.
      const expected = await canLoadAgenticFlow();
      expect(stats.agenticFlowAvailable).toBe(expected);
    });

    async function canLoadAgenticFlow(): Promise<boolean> {
      for (const subpath of ['agentic-flow/reasoningbank', 'agentic-flow/agent-booster']) {
        try { await import(subpath); return true; }
        catch { /* try the next one */ }
      }
      return false;
    }
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

  describe('getCompactContext savings baseline (#3289)', () => {
    // The compact prompt is what is RETRIEVED; the baseline is what it
    // REPLACED. Those are different numbers and only the caller has the
    // second one, which is the whole reason the old comparison -- against the
    // query string -- could not be a measurement.
    //
    // The retrieval is stubbed rather than left to whatever ReasoningBank this
    // machine has: with agentic-flow absent the real bank returns an empty
    // prompt, and every assertion below about `baseline - compactTokens`
    // would hold for the trivial reason that compactTokens is 0.
    const PROMPT_CHARS = 400; // -> 100 tokens at the module's 4-chars heuristic
    const COMPACT_TOKENS = PROMPT_CHARS / 4;

    async function optimizerWithRetrieval(): Promise<TokenOptimizer> {
      const fresh = new TokenOptimizer();
      await fresh.initialize();
      (fresh as unknown as { reasoningBank: unknown }).reasoningBank = {
        retrieveMemories: async () => [{ content: 'memory', score: 0.9 }],
        formatMemoriesForPrompt: () => 'x'.repeat(PROMPT_CHARS),
      };
      return fresh;
    }

    it('reports unmeasured rather than zero when no baseline is given', async () => {
      const fresh = await optimizerWithRetrieval();

      const ctx = await fresh.getCompactContext('authentication patterns');

      expect(ctx.tokensSaved).toBeNull();
      expect(fresh.getStats().contextsMeasured).toBe(0);
    });

    it('does not move the running total on an unmeasured call', async () => {
      const fresh = await optimizerWithRetrieval();

      const before = fresh.getStats().totalTokensSaved;
      // A long query is the shape that used to manufacture a saving: it beat
      // the retrieved prompt on length with no replaced context behind it.
      await fresh.getCompactContext('authentication patterns '.repeat(200));

      expect(fresh.getStats().totalTokensSaved).toBe(before);
    });

    it('measures against the baseline the caller supplies', async () => {
      const fresh = await optimizerWithRetrieval();

      const ctx = await fresh.getCompactContext('authentication patterns', {
        baselineTokens: 8000,
      });

      expect(ctx.tokensSaved).toBe(8000 - COMPACT_TOKENS);
      expect(fresh.getStats().totalTokensSaved).toBe(8000 - COMPACT_TOKENS);
      expect(fresh.getStats().contextsMeasured).toBe(1);
    });

    it('floors at zero when the compact prompt outgrows the baseline', async () => {
      const fresh = await optimizerWithRetrieval();

      const ctx = await fresh.getCompactContext('authentication patterns', {
        baselineTokens: 10,
      });

      // 10 replaced tokens against a 100-token prompt is not a saving of -90.
      // It is also not a missing measurement: 10 is a baseline, so the call
      // counts as measured.
      expect(ctx.tokensSaved).toBe(0);
      expect(fresh.getStats().contextsMeasured).toBe(1);
    });

    it('rejects a baseline that is not a usable count', async () => {
      const fresh = await optimizerWithRetrieval();

      for (const baselineTokens of [NaN, Infinity, -1]) {
        const ctx = await fresh.getCompactContext('authentication patterns', {
          baselineTokens,
        });
        expect(ctx.tokensSaved).toBeNull();
      }
      expect(fresh.getStats().contextsMeasured).toBe(0);
    });

    it('the query length is no longer part of the answer', async () => {
      // Same baseline, same retrieval, queries of wildly different lengths:
      // the reported saving must not move. This is exactly the property the
      // old implementation violated.
      const short = await optimizerWithRetrieval();
      const long = await optimizerWithRetrieval();

      const a = await short.getCompactContext('auth', { baselineTokens: 5000 });
      const b = await long.getCompactContext('auth '.repeat(500), {
        baselineTokens: 5000,
      });

      expect(a.tokensSaved).toBe(b.tokensSaved);
    });

    it('a run with no ReasoningBank at all is unmeasured, not a zero saving', async () => {
      const fresh = new TokenOptimizer();
      await fresh.initialize();
      (fresh as unknown as { reasoningBank: unknown }).reasoningBank = null;

      const ctx = await fresh.getCompactContext('authentication patterns', {
        baselineTokens: 8000,
      });

      expect(ctx.tokensSaved).toBeNull();
      expect(fresh.getStats().contextsMeasured).toBe(0);
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

    it('should handle large agent counts', () => {
      const config = optimizer.getOptimalConfig(15);

      expect(config.topology).toBe('hierarchical');
      expect(config.batchSize).toBeLessThanOrEqual(5);
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
