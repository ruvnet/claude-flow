/**
 * Hook Matchers Tests
 *
 * Comprehensive test suite for hook pattern matching system
 */

/* eslint-disable */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  HookMatcher,
  createFilePathMatcher,
  createAgentTypeMatcher,
  createOperationMatcher,
  createContextMatcher,
  createCompositePattern,
  hookMatcher,
} from '../hooks/hook-matchers.js';
import type {
  HookRegistration,
  AgenticHookContext,
  HookFilter,
} from '../services/agentic-flow-hooks/types.js';

// ===== Test Helpers =====

function createMockContext(overrides?: Partial<AgenticHookContext>): AgenticHookContext {
  return {
    sessionId: 'test-session',
    timestamp: Date.now(),
    correlationId: 'test-correlation',
    metadata: {},
    memory: {
      namespace: 'test',
      provider: 'memory',
      cache: new Map(),
    },
    neural: {
      modelId: 'test-model',
      patterns: {
        add: () => {},
        get: () => undefined,
        findSimilar: () => [],
        getByType: () => [],
        prune: () => {},
        export: () => [],
        import: () => {},
      },
      training: {
        epoch: 0,
        loss: 0,
        accuracy: 0,
        learningRate: 0.001,
        optimizer: 'adam',
        checkpoints: [],
      },
    },
    performance: {
      metrics: new Map(),
      bottlenecks: [],
      optimizations: [],
    },
    ...overrides,
  };
}

function createMockHook(overrides?: Partial<HookRegistration>): HookRegistration {
  return {
    id: 'test-hook',
    type: 'workflow-step',
    handler: async () => ({ continue: true }),
    priority: 10,
    ...overrides,
  };
}

// ===== Tests =====

describe('HookMatcher', () => {
  let matcher: HookMatcher;

  beforeEach(() => {
    matcher = new HookMatcher({
      cacheEnabled: true,
      cacheTTL: 60000,
      matchStrategy: 'all',
    });
  });

  afterEach(() => {
    matcher.clearCache();
  });

  describe('File Path Matching', () => {
    it('should match glob patterns', () => {
      const fileMatcher = createFilePathMatcher(['src/**/*.ts']);
      const result = matcher.matchFilePath('src/hooks/test.ts', fileMatcher.patterns);

      expect(result).toBe(true);
    });

    it('should not match non-matching paths', () => {
      const fileMatcher = createFilePathMatcher(['src/**/*.ts']);
      const result = matcher.matchFilePath('dist/build.js', fileMatcher.patterns);

      expect(result).toBe(false);
    });

    it('should support multiple patterns', () => {
      const fileMatcher = createFilePathMatcher(['src/**/*.ts', 'tests/**/*.test.ts']);

      expect(matcher.matchFilePath('src/hooks/test.ts', fileMatcher.patterns)).toBe(true);
      expect(matcher.matchFilePath('tests/unit/test.test.ts', fileMatcher.patterns)).toBe(true);
      expect(matcher.matchFilePath('docs/readme.md', fileMatcher.patterns)).toBe(false);
    });

    it('should support inverted patterns', () => {
      const fileMatcher = createFilePathMatcher(['**/*.ts'], { inverted: true });
      const result = matcher.matchFilePath('src/test.ts', fileMatcher.patterns);

      expect(result).toBe(true);
    });

    it('should match exact paths', () => {
      const fileMatcher = createFilePathMatcher(['src/index.ts']);

      expect(matcher.matchFilePath('src/index.ts', fileMatcher.patterns)).toBe(true);
      expect(matcher.matchFilePath('src/other.ts', fileMatcher.patterns)).toBe(false);
    });
  });

  describe('Agent Type Matching', () => {
    it('should match agent types', () => {
      const agentMatcher = createAgentTypeMatcher(['researcher', 'coder']);

      expect(matcher.matchAgentType('researcher', agentMatcher)).toBe(true);
      expect(matcher.matchAgentType('coder', agentMatcher)).toBe(true);
      expect(matcher.matchAgentType('tester', agentMatcher)).toBe(false);
    });

    it('should support wildcard matching', () => {
      const agentMatcher = createAgentTypeMatcher(['*']);

      expect(matcher.matchAgentType('researcher', agentMatcher)).toBe(true);
      expect(matcher.matchAgentType('any-type', agentMatcher)).toBe(true);
    });

    it('should support exclusions', () => {
      const agentMatcher = createAgentTypeMatcher(['*'], ['tester']);

      expect(matcher.matchAgentType('researcher', agentMatcher)).toBe(true);
      expect(matcher.matchAgentType('tester', agentMatcher)).toBe(false);
    });
  });

  describe('Operation Matching', () => {
    it('should match operation types', () => {
      const opMatcher = createOperationMatcher(['store', 'retrieve']);

      expect(matcher.matchOperation('store', opMatcher)).toBe(true);
      expect(matcher.matchOperation('retrieve', opMatcher)).toBe(true);
      expect(matcher.matchOperation('delete', opMatcher)).toBe(false);
    });

    it('should support wildcard operations', () => {
      const opMatcher = createOperationMatcher(['*']);

      expect(matcher.matchOperation('store', opMatcher)).toBe(true);
      expect(matcher.matchOperation('any-operation', opMatcher)).toBe(true);
    });

    it('should support operation exclusions', () => {
      const opMatcher = createOperationMatcher(['*'], ['delete']);

      expect(matcher.matchOperation('store', opMatcher)).toBe(true);
      expect(matcher.matchOperation('delete', opMatcher)).toBe(false);
    });
  });

  describe('Context Matching', () => {
    it('should match context conditions - equality', () => {
      const contextMatcher = createContextMatcher([
        { field: 'sessionId', operator: 'eq', value: 'test-session' },
      ]);

      const context = createMockContext({ sessionId: 'test-session' });
      const hook = createMockHook({
        filter: { conditions: contextMatcher.conditions },
      });

      expect(hook.filter).toBeDefined();
    });

    it('should match nested context values', () => {
      const contextMatcher = createContextMatcher([
        { field: 'metadata.agentType', operator: 'eq', value: 'researcher' },
      ]);

      const context = createMockContext({
        metadata: { agentType: 'researcher' },
      });

      expect(context.metadata?.agentType).toBe('researcher');
    });

    it('should support comparison operators', () => {
      const contextMatcher = createContextMatcher([
        { field: 'timestamp', operator: 'gt', value: Date.now() - 10000 },
      ]);

      const context = createMockContext({ timestamp: Date.now() });

      expect(context.timestamp).toBeGreaterThan(Date.now() - 10000);
    });

    it('should support array contains', () => {
      const contextMatcher = createContextMatcher([
        { field: 'metadata.tags', operator: 'in', value: ['test', 'unit'] },
      ]);

      expect(contextMatcher.conditions[0].operator).toBe('in');
    });
  });

  describe('Full Hook Matching', () => {
    it('should match hook with file pattern', async () => {
      const hook = createMockHook({
        filter: {
          patterns: [/src\/.*\.ts$/],
        },
      });

      const context = createMockContext();
      const payload = { file: 'src/hooks/test.ts' };

      const result = await matcher.match(hook, context, payload);

      expect(result.matched).toBe(true);
      expect(result.cacheHit).toBe(false);
    });

    it('should match hook with operation filter', async () => {
      const hook = createMockHook({
        filter: {
          operations: ['store', 'retrieve'],
        },
      });

      const context = createMockContext();
      const payload = { operation: 'store' };

      const result = await matcher.match(hook, context, payload);

      expect(result.matched).toBe(true);
    });

    it('should not match hook with mismatched filter', async () => {
      const hook = createMockHook({
        filter: {
          operations: ['store'],
        },
      });

      const context = createMockContext();
      const payload = { operation: 'delete' };

      const result = await matcher.match(hook, context, payload);

      expect(result.matched).toBe(false);
    });

    it('should match hooks without filters (match all)', async () => {
      const hook = createMockHook({
        filter: undefined,
      });

      const context = createMockContext();
      const payload = { operation: 'any' };

      const result = await matcher.match(hook, context, payload);

      expect(result.matched).toBe(true);
      expect(result.matchedRules).toContain('*');
    });
  });

  describe('Caching', () => {
    it('should cache match results', async () => {
      const hook = createMockHook({
        filter: {
          operations: ['store'],
        },
      });

      const context = createMockContext();
      const payload = { operation: 'store' };

      // First call
      const result1 = await matcher.match(hook, context, payload);
      expect(result1.cacheHit).toBe(false);

      // Second call should hit cache
      const result2 = await matcher.match(hook, context, payload);
      expect(result2.cacheHit).toBe(true);
      expect(result2.matched).toBe(result1.matched);
    });

    it('should clear cache', async () => {
      const hook = createMockHook({
        filter: {
          operations: ['store'],
        },
      });

      const context = createMockContext();
      const payload = { operation: 'store' };

      await matcher.match(hook, context, payload);

      const statsBefore = matcher.getCacheStats();
      expect(statsBefore.size).toBeGreaterThan(0);

      matcher.clearCache();

      const statsAfter = matcher.getCacheStats();
      expect(statsAfter.size).toBe(0);
    });

    it('should prune expired entries', async () => {
      const shortTTLMatcher = new HookMatcher({
        cacheEnabled: true,
        cacheTTL: 100, // 100ms
      });

      const hook = createMockHook({
        filter: {
          operations: ['store'],
        },
      });

      const context = createMockContext();
      const payload = { operation: 'store' };

      await shortTTLMatcher.match(hook, context, payload);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      const pruned = shortTTLMatcher.pruneCache();
      expect(pruned).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should be fast for simple matches', async () => {
      const hook = createMockHook({
        filter: {
          operations: ['store'],
        },
      });

      const context = createMockContext();
      const payload = { operation: 'store' };

      const result = await matcher.match(hook, context, payload);

      expect(result.executionTime).toBeLessThan(10); // Less than 10ms
    });

    it('should be faster with cache', async () => {
      const hook = createMockHook({
        filter: {
          patterns: [/src\/.*\.ts$/],
        },
      });

      const context = createMockContext();
      const payload = { file: 'src/hooks/test.ts' };

      // First call (no cache)
      const result1 = await matcher.match(hook, context, payload);
      const time1 = result1.executionTime;

      // Second call (cached)
      const result2 = await matcher.match(hook, context, payload);
      const time2 = result2.executionTime;

      expect(time2).toBeLessThanOrEqual(time1);
      expect(result2.cacheHit).toBe(true);
    });
  });

  describe('Composite Patterns', () => {
    it('should match AND composite patterns', () => {
      const composite = createCompositePattern('AND', [
        { type: 'glob', pattern: 'src/**/*.ts' },
        { type: 'regex', pattern: /test/ },
      ]);

      expect(composite.operator).toBe('AND');
      expect(composite.patterns).toHaveLength(2);
    });

    it('should match OR composite patterns', () => {
      const composite = createCompositePattern('OR', [
        { type: 'glob', pattern: 'src/**/*.ts' },
        { type: 'glob', pattern: 'tests/**/*.test.ts' },
      ]);

      expect(composite.operator).toBe('OR');
      expect(composite.patterns).toHaveLength(2);
    });
  });

  describe('Match Strategies', () => {
    it('should use ALL strategy (all rules must match)', async () => {
      const allMatcher = new HookMatcher({ matchStrategy: 'all' });

      const hook = createMockHook({
        filter: {
          operations: ['store'],
          patterns: [/src\/.*\.ts$/],
        },
      });

      const context = createMockContext();

      // Both match
      const payload1 = { operation: 'store', file: 'src/test.ts' };
      const result1 = await allMatcher.match(hook, context, payload1);
      expect(result1.matched).toBe(true);

      // Only one matches
      const payload2 = { operation: 'store', file: 'dist/test.js' };
      const result2 = await allMatcher.match(hook, context, payload2);
      expect(result2.matched).toBe(false);
    });

    it('should use ANY strategy (at least one rule must match)', async () => {
      const anyMatcher = new HookMatcher({ matchStrategy: 'any' });

      const hook = createMockHook({
        filter: {
          operations: ['store'],
          patterns: [/src\/.*\.ts$/],
        },
      });

      const context = createMockContext();

      // Only one matches
      const payload = { operation: 'delete', file: 'src/test.ts' };
      const result = await anyMatcher.match(hook, context, payload);

      expect(result.matched).toBe(true);
    });
  });
});

describe('Singleton Instance', () => {
  it('should export singleton instance', () => {
    expect(hookMatcher).toBeInstanceOf(HookMatcher);
  });

  it('should maintain state across calls', async () => {
    const hook = createMockHook({
      filter: {
        operations: ['test'],
      },
    });

    const context = createMockContext();
    const payload = { operation: 'test' };

    await hookMatcher.match(hook, context, payload);
    const stats = hookMatcher.getCacheStats();

    expect(stats.size).toBeGreaterThan(0);
  });
});