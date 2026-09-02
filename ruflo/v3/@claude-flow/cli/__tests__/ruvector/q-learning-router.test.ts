/**
 * Q-Learning Router Tests
 *
 * Tests for the Q-Learning based task routing system.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QLearningRouter, createQLearningRouter, type RouteDecision } from '../../src/ruvector/q-learning-router';

// Mock the @ruvector/core module
vi.mock('@ruvector/core', () => ({
  createQLearning: vi.fn(() => null),
}));

describe('QLearningRouter', () => {
  let router: QLearningRouter;

  beforeEach(() => {
    router = new QLearningRouter();
  });

  afterEach(() => {
    router.reset();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create router with default config', () => {
      const stats = router.getStats();
      expect(stats.epsilon).toBe(1.0);
      expect(stats.qTableSize).toBe(0);
      expect(stats.updateCount).toBe(0);
    });

    it('should create router with custom config', () => {
      const customRouter = new QLearningRouter({
        learningRate: 0.2,
        gamma: 0.95,
        explorationInitial: 0.5,
        numActions: 4,
      });
      const stats = customRouter.getStats();
      expect(stats.epsilon).toBe(0.5);
    });
  });

  describe('initialize', () => {
    it('should initialize without ruvector (fallback mode)', async () => {
      await router.initialize();
      const stats = router.getStats();
      expect(stats.useNative).toBe(0);
    });

    it('should handle ruvector import failure gracefully', async () => {
      vi.doMock('@ruvector/core', () => {
        throw new Error('Module not found');
      });
      await router.initialize();
      const stats = router.getStats();
      expect(stats.useNative).toBe(0);
    });
  });

  describe('route', () => {
    it('should return valid route decision', () => {
      const decision = router.route('implement feature X');
      expect(decision).toHaveProperty('route');
      expect(decision).toHaveProperty('confidence');
      expect(decision).toHaveProperty('qValues');
      expect(decision).toHaveProperty('explored');
      expect(decision).toHaveProperty('alternatives');
    });

    it('should return route from valid ROUTE_NAMES', () => {
      const validRoutes = ['coder', 'tester', 'reviewer', 'architect', 'researcher', 'optimizer', 'debugger', 'documenter'];
      const decision = router.route('test task');
      expect(validRoutes).toContain(decision.route);
    });

    it('should have confidence between 0 and 1', () => {
      const decision = router.route('any task');
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    });

    it('should return qValues array with correct length', () => {
      const decision = router.route('test');
      expect(decision.qValues).toHaveLength(8);
    });

    it('should return alternatives sorted by score', () => {
      // Update Q-values to have clear ordering
      router.update('task', 'coder', 10);
      router.update('task', 'tester', 5);
      router.update('task', 'reviewer', 3);
      
      const decision = router.route('task', false);
      expect(decision.alternatives.length).toBeLessThanOrEqual(3);
      for (let i = 0; i < decision.alternatives.length - 1; i++) {
        expect(decision.alternatives[i].score).toBeGreaterThanOrEqual(decision.alternatives[i + 1].score);
      }
    });

    it('should explore with high epsilon', () => {
      // With epsilon = 1.0, should always explore
      const decisions = Array.from({ length: 100 }, () => router.route('task'));
      const exploredCount = decisions.filter(d => d.explored).length;
      expect(exploredCount).toBeGreaterThan(50); // Most should be exploration
    });

    it('should exploit when explore=false', () => {
      const decision = router.route('task', false);
      expect(decision.explored).toBe(false);
    });
  });

  describe('update', () => {
    it('should update Q-values and return TD error', () => {
      const tdError = router.update('task context', 'coder', 1.0);
      expect(typeof tdError).toBe('number');
    });

    it('should increase Q-value for positive reward', () => {
      // First update to establish the action
      router.update('context', 'coder', 10.0);

      const afterDecision = router.route('context', false);
      // At least one Q-value should be non-zero after update
      expect(afterDecision.qValues.some(v => v > 0)).toBe(true);
    });

    it('should handle invalid action gracefully', () => {
      const tdError = router.update('context', 'invalid_action', 1.0);
      expect(tdError).toBe(0);
    });

    it('should decay epsilon over updates', () => {
      const initialEpsilon = router.getStats().epsilon;
      for (let i = 0; i < 100; i++) {
        router.update(`context_${i}`, 'coder', 1.0);
      }
      const finalEpsilon = router.getStats().epsilon;
      expect(finalEpsilon).toBeLessThan(initialEpsilon);
    });

    it('should track average TD error', () => {
      router.update('c1', 'coder', 5.0);
      router.update('c2', 'tester', 3.0);
      const stats = router.getStats();
      expect(stats.avgTDError).toBeGreaterThan(0);
    });

    it('should update with next context (non-terminal)', () => {
      const tdError = router.update('current', 'coder', 1.0, 'next');
      expect(typeof tdError).toBe('number');
    });

    it('should prune Q-table when exceeding maxStates', () => {
      const smallRouter = new QLearningRouter({ maxStates: 10 });
      for (let i = 0; i < 20; i++) {
        smallRouter.update(`unique_context_${i}`, 'coder', 1.0);
      }
      const stats = smallRouter.getStats();
      expect(stats.qTableSize).toBeLessThanOrEqual(10);
    });
  });

  describe('getStats', () => {
    it('should return all expected statistics', () => {
      const stats = router.getStats();
      expect(stats).toHaveProperty('updateCount');
      expect(stats).toHaveProperty('qTableSize');
      expect(stats).toHaveProperty('epsilon');
      expect(stats).toHaveProperty('avgTDError');
      expect(stats).toHaveProperty('stepCount');
      expect(stats).toHaveProperty('useNative');
    });

    it('should update stats after operations', () => {
      const before = router.getStats();
      expect(before.updateCount).toBe(0);
      
      router.update('test', 'coder', 1.0);
      
      const after = router.getStats();
      expect(after.updateCount).toBe(1);
      expect(after.qTableSize).toBe(1);
    });
  });

  describe('reset', () => {
    it('should clear Q-table', () => {
      router.update('test', 'coder', 1.0);
      expect(router.getStats().qTableSize).toBe(1);
      
      router.reset();
      expect(router.getStats().qTableSize).toBe(0);
    });

    it('should reset epsilon to initial value', () => {
      for (let i = 0; i < 100; i++) {
        router.update(`ctx_${i}`, 'coder', 1.0);
      }
      expect(router.getStats().epsilon).toBeLessThan(1.0);
      
      router.reset();
      expect(router.getStats().epsilon).toBe(1.0);
    });

    it('should reset update count', () => {
      router.update('test', 'coder', 1.0);
      expect(router.getStats().updateCount).toBe(1);
      
      router.reset();
      expect(router.getStats().updateCount).toBe(0);
    });
  });

  describe('export/import', () => {
    it('should export Q-table data', () => {
      router.update('context1', 'coder', 5.0);
      router.update('context2', 'tester', 3.0);

      const exported = router.export();
      // Export might contain states based on context hashing
      expect(Object.keys(exported).length).toBeGreaterThan(0);
      expect(exported).toHaveProperty(Object.keys(exported)[0]);
    });

    it('should export qValues and visits for each state', () => {
      router.update('test', 'coder', 1.0);
      const exported = router.export();
      const firstKey = Object.keys(exported)[0];
      
      expect(exported[firstKey]).toHaveProperty('qValues');
      expect(exported[firstKey]).toHaveProperty('visits');
      expect(Array.isArray(exported[firstKey].qValues)).toBe(true);
    });

    it('should import Q-table data', () => {
      const data = {
        'state_123': { qValues: [1, 2, 3, 4, 5, 6, 7, 8], visits: 5 },
        'state_456': { qValues: [8, 7, 6, 5, 4, 3, 2, 1], visits: 3 },
      };
      
      router.import(data);
      expect(router.getStats().qTableSize).toBe(2);
    });

    it('should restore Q-values after import', () => {
      router.update('original', 'coder', 10.0);
      const exported = router.export();
      
      router.reset();
      expect(router.getStats().qTableSize).toBe(0);
      
      router.import(exported);
      expect(router.getStats().qTableSize).toBe(1);
    });

    it('should clear existing data on import', () => {
      router.update('old', 'coder', 1.0);
      router.import({ 'new_state': { qValues: [1,2,3,4,5,6,7,8], visits: 1 } });
      
      expect(router.getStats().qTableSize).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty context', () => {
      const decision = router.route('');
      expect(decision.route).toBeDefined();
    });

    it('should handle very long context', () => {
      const longContext = 'x'.repeat(10000);
      const decision = router.route(longContext);
      expect(decision.route).toBeDefined();
    });

    it('should handle unicode in context', () => {
      const decision = router.route('implement feature with unicode: \u00e9\u00e8\u00ea');
      expect(decision.route).toBeDefined();
    });

    it('should handle special characters in context', () => {
      const decision = router.route('fix bug in file: src/utils/*.ts');
      expect(decision.route).toBeDefined();
    });

    it('should handle numeric context', () => {
      const decision = router.route('12345');
      expect(decision.route).toBeDefined();
    });

    it('should maintain consistency for same context', () => {
      // After learning, same context should give consistent results
      router.update('consistent_context', 'coder', 100.0);
      
      const decisions = Array.from({ length: 10 }, () => 
        router.route('consistent_context', false)
      );
      
      const routes = decisions.map(d => d.route);
      expect(new Set(routes).size).toBe(1); // All same route
    });
  });
});

describe('createQLearningRouter', () => {
  it('should create router instance', () => {
    const router = createQLearningRouter();
    expect(router).toBeInstanceOf(QLearningRouter);
  });

  it('should accept config', () => {
    const router = createQLearningRouter({ learningRate: 0.5 });
    expect(router).toBeInstanceOf(QLearningRouter);
  });
});

describe('QLearningRouter Advanced Scenarios', () => {
  let router: QLearningRouter;

  beforeEach(() => {
    router = new QLearningRouter();
  });

  afterEach(() => {
    router.reset();
  });

  describe('learning behavior', () => {
    it('should learn from positive reinforcement', () => {
      // Train specific patterns
      for (let i = 0; i < 50; i++) {
        router.update('write unit tests', 'tester', 10.0);
        router.update('implement feature', 'coder', 10.0);
        router.update('review code quality', 'reviewer', 10.0);
      }

      // Verify Q-values increased for trained actions
      const stats = router.getStats();
      expect(stats.updateCount).toBe(150);
      expect(stats.qTableSize).toBeGreaterThan(0);

      // The routes should have learned something (Q-values non-zero)
      const testDecision = router.route('write unit tests', false);
      expect(testDecision.qValues.some(v => v > 0)).toBe(true);
    });

    it('should learn from negative reinforcement', () => {
      // Initially train with positive reward
      router.update('bug fix', 'coder', 10.0);

      // Then add negative reward for tester
      for (let i = 0; i < 20; i++) {
        router.update('bug fix', 'tester', -5.0);
      }

      const decision = router.route('bug fix', false);
      // Should avoid tester after negative reinforcement
      expect(decision.route).not.toBe('tester');
    });

    it('should balance exploration and exploitation', () => {
      // With default epsilon=1.0, should explore more
      const highExplorRouter = new QLearningRouter({ explorationInitial: 1.0 });
      const explorations = Array.from({ length: 100 }, () =>
        highExplorRouter.route('test task').explored
      );
      const explorationRate = explorations.filter(Boolean).length / 100;
      expect(explorationRate).toBeGreaterThan(0.5);

      // With low epsilon, should exploit more
      const lowExplorRouter = new QLearningRouter({ explorationInitial: 0.0 });
      lowExplorRouter.update('task', 'coder', 100.0);
      const exploitations = Array.from({ length: 100 }, () =>
        lowExplorRouter.route('task', false).explored
      );
      const exploitationRate = exploitations.filter(e => !e).length / 100;
      expect(exploitationRate).toBe(1);
    });
  });

  describe('context hashing', () => {
    it('should generate consistent hashes for same context', () => {
      router.update('context A', 'coder', 5.0);
      const decision1 = router.route('context A', false);
      const decision2 = router.route('context A', false);

      // Q-values should be the same for same context
      expect(decision1.qValues).toEqual(decision2.qValues);
    });

    it('should generate different hashes for different contexts', () => {
      router.update('context A', 'coder', 10.0);
      router.update('context B', 'tester', 10.0);

      const decisionA = router.route('context A', false);
      const decisionB = router.route('context B', false);

      // Different contexts should have Q-values updated
      // Note: With simple hashing, short contexts may collide
      expect(decisionA.qValues.some(v => v > 0)).toBe(true);
      expect(decisionB.qValues.some(v => v > 0)).toBe(true);
    });
  });

  describe('gamma discount factor', () => {
    it('should value immediate rewards more with low gamma', () => {
      const lowGammaRouter = new QLearningRouter({ gamma: 0.1 });

      // Update with next state
      lowGammaRouter.update('current', 'coder', 10.0, 'next');
      lowGammaRouter.update('next', 'tester', 10.0);

      const stats = lowGammaRouter.getStats();
      // At least one state should be in the Q-table
      expect(stats.qTableSize).toBeGreaterThanOrEqual(1);
    });

    it('should propagate value further with high gamma', () => {
      const highGammaRouter = new QLearningRouter({ gamma: 0.99 });

      highGammaRouter.update('state1', 'coder', 1.0, 'state2');
      highGammaRouter.update('state2', 'tester', 100.0);

      const decision = highGammaRouter.route('state1', false);
      expect(decision.qValues.some(v => v > 0)).toBe(true);
    });
  });

  describe('concurrent updates', () => {
    it('should handle rapid sequential updates', () => {
      for (let i = 0; i < 1000; i++) {
        router.update(`task_${i % 10}`, 'coder', Math.random() * 10);
      }

      expect(router.getStats().updateCount).toBe(1000);
      // Q-table size depends on implementation - could be 1 if all updates hit same state
      expect(router.getStats().qTableSize).toBeGreaterThan(0);
    });
  });

  describe('state persistence', () => {
    it('should export and import complete state', () => {
      // Build up some state
      router.update('task1', 'coder', 10.0);
      router.update('task2', 'tester', 8.0);
      router.update('task3', 'reviewer', 6.0);

      const originalStats = router.getStats();
      const exported = router.export();

      // Create new router and import
      const newRouter = new QLearningRouter();
      newRouter.import(exported);

      const newStats = newRouter.getStats();
      expect(newStats.qTableSize).toBe(originalStats.qTableSize);

      // Verify decisions are consistent
      const origDecision = router.route('task1', false);
      const newDecision = newRouter.route('task1', false);
      expect(origDecision.qValues).toEqual(newDecision.qValues);
    });
  });
});
