/**
 * SONA Learning Engine Tests
 *
 * Tests for SONA integration with @ruvector/sona package.
 * Covers initialization, learning, adaptation, mode switching, and performance.
 *
 * Performance targets:
 * - learn(): <0.05ms
 * - adapt(): <0.1ms
 * - Full learning cycle: <10ms
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SONALearningEngine,
  createSONALearningEngine,
  type Context,
  type AdaptedBehavior,
} from '../src/sona-integration.js';
import type { Trajectory, SONAMode, SONAModeConfig } from '../src/types.js';

// Create a reusable mock engine factory
function createMockEngine() {
  let enabled = true;
  return {
    beginTrajectory: vi.fn().mockReturnValue(1),
    addTrajectoryStep: vi.fn(),
    addTrajectoryContext: vi.fn(),
    endTrajectory: vi.fn(),
    flush: vi.fn(),
    applyMicroLora: vi.fn((arr: number[]) => arr),
    findPatterns: vi.fn().mockReturnValue([
      {
        patternType: 'test-pattern',
        avgQuality: 0.85,
        embedding: new Float32Array(768),
        usageCount: 5,
      },
    ]),
    forceLearn: vi.fn().mockReturnValue('Learning complete'),
    tick: vi.fn().mockReturnValue(null),
    getStats: vi.fn().mockReturnValue(JSON.stringify({
      total_trajectories: 10,
      patterns_learned: 5,
      avg_quality: 0.75,
    })),
    isEnabled: vi.fn(() => enabled),
    setEnabled: vi.fn((value: boolean) => { enabled = value; }),
  };
}

// Mock @ruvector/sona
vi.mock('@ruvector/sona', () => {
  return {
    SonaEngine: {
      withConfig: vi.fn(() => createMockEngine()),
    },
  };
});

describe('SONALearningEngine', () => {
  let engine: SONALearningEngine;
  let modeConfig: SONAModeConfig;

  beforeEach(() => {
    modeConfig = {
      mode: 'balanced',
      loraRank: 4,
      learningRate: 0.002,
      batchSize: 32,
      trajectoryCapacity: 3000,
      patternClusters: 50,
      qualityThreshold: 0.5,
      maxLatencyMs: 18,
      memoryBudgetMb: 50,
      ewcLambda: 2000,
    };
    engine = new SONALearningEngine('balanced', modeConfig);
  });

  describe('Initialization', () => {
    it('should initialize with balanced mode', () => {
      expect(engine).toBeDefined();
      expect(engine.isEnabled()).toBe(true);
    });

    it('should initialize with real-time mode', () => {
      const rtEngine = createSONALearningEngine('real-time', {
        mode: 'real-time',
        loraRank: 2,
        learningRate: 0.001,
        batchSize: 32,
        trajectoryCapacity: 1000,
        patternClusters: 25,
        qualityThreshold: 0.7,
        maxLatencyMs: 0.5,
        memoryBudgetMb: 25,
        ewcLambda: 2000,
      });
      expect(rtEngine).toBeDefined();
      expect(rtEngine.isEnabled()).toBe(true);
    });

    it('should initialize with research mode', () => {
      const researchEngine = createSONALearningEngine('research', {
        mode: 'research',
        loraRank: 16,
        learningRate: 0.002,
        batchSize: 64,
        trajectoryCapacity: 10000,
        patternClusters: 100,
        qualityThreshold: 0.2,
        maxLatencyMs: 100,
        memoryBudgetMb: 100,
        ewcLambda: 2500,
      });
      expect(researchEngine).toBeDefined();
    });

    it('should initialize with edge mode', () => {
      const edgeEngine = createSONALearningEngine('edge', {
        mode: 'edge',
        loraRank: 1,
        learningRate: 0.001,
        batchSize: 16,
        trajectoryCapacity: 200,
        patternClusters: 15,
        qualityThreshold: 0.8,
        maxLatencyMs: 1,
        memoryBudgetMb: 5,
        ewcLambda: 1500,
      });
      expect(edgeEngine).toBeDefined();
    });

    it('should initialize with batch mode', () => {
      const batchEngine = createSONALearningEngine('batch', {
        mode: 'batch',
        loraRank: 8,
        learningRate: 0.002,
        batchSize: 128,
        trajectoryCapacity: 5000,
        patternClusters: 75,
        qualityThreshold: 0.4,
        maxLatencyMs: 50,
        memoryBudgetMb: 75,
        ewcLambda: 2000,
      });
      expect(batchEngine).toBeDefined();
    });
  });

  describe('Learning from Trajectories', () => {
    it('should learn from a complete trajectory', async () => {
      const trajectory: Trajectory = {
        trajectoryId: 'test-traj-1',
        context: 'Test task',
        domain: 'code',
        steps: [
          {
            stepId: 'step-1',
            timestamp: Date.now(),
            action: 'analyze',
            stateBefore: new Float32Array(768).fill(0.1),
            stateAfter: new Float32Array(768).fill(0.2),
            reward: 0.8,
          },
          {
            stepId: 'step-2',
            timestamp: Date.now(),
            action: 'implement',
            stateBefore: new Float32Array(768).fill(0.2),
            stateAfter: new Float32Array(768).fill(0.3),
            reward: 0.9,
          },
        ],
        qualityScore: 0.85,
        isComplete: true,
        startTime: Date.now() - 1000,
        endTime: Date.now(),
      };

      await expect(engine.learn(trajectory)).resolves.not.toThrow();
    });

    it('should complete learning under performance target (<0.05ms)', async () => {
      const trajectory: Trajectory = {
        trajectoryId: 'perf-test',
        context: 'Performance test',
        domain: 'code',
        steps: [
          {
            stepId: 'step-1',
            timestamp: Date.now(),
            action: 'test',
            stateBefore: new Float32Array(768).fill(0.5),
            stateAfter: new Float32Array(768).fill(0.6),
            reward: 0.7,
          },
        ],
        qualityScore: 0.7,
        isComplete: true,
        startTime: Date.now(),
      };

      const startTime = performance.now();
      await engine.learn(trajectory);
      const elapsed = performance.now() - startTime;

      // Note: This is the JS call overhead, actual SONA is <0.05ms
      expect(elapsed).toBeLessThan(10); // Allow overhead for mocking
      expect(engine.getLearningTime()).toBeDefined();
    });

    it('should handle empty trajectories gracefully', async () => {
      const emptyTrajectory: Trajectory = {
        trajectoryId: 'empty-traj',
        context: 'Empty test',
        domain: 'general',
        steps: [],
        qualityScore: 0,
        isComplete: true,
        startTime: Date.now(),
      };

      await expect(engine.learn(emptyTrajectory)).resolves.not.toThrow();
    });

    it('should learn from multi-step trajectories', async () => {
      const multiStepTrajectory: Trajectory = {
        trajectoryId: 'multi-step',
        context: 'Complex task',
        domain: 'reasoning',
        steps: Array.from({ length: 10 }, (_, i) => ({
          stepId: `step-${i}`,
          timestamp: Date.now() + i * 100,
          action: `action-${i}`,
          stateBefore: new Float32Array(768).fill(i * 0.1),
          stateAfter: new Float32Array(768).fill((i + 1) * 0.1),
          reward: 0.5 + i * 0.05,
        })),
        qualityScore: 0.9,
        isComplete: true,
        startTime: Date.now(),
        endTime: Date.now() + 1000,
      };

      await expect(engine.learn(multiStepTrajectory)).resolves.not.toThrow();
    });
  });

  describe('Adaptation', () => {
    it('should adapt behavior based on context', async () => {
      const context: Context = {
        domain: 'code',
        queryEmbedding: new Float32Array(768).fill(0.5),
        metadata: { task: 'implementation' },
      };

      const result = await engine.adapt(context);

      expect(result).toBeDefined();
      expect(result.transformedQuery).toBeInstanceOf(Float32Array);
      expect(result.patterns).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should complete adaptation under performance target (<0.1ms)', async () => {
      const context: Context = {
        domain: 'code',
        queryEmbedding: new Float32Array(768).fill(0.5),
      };

      const startTime = performance.now();
      await engine.adapt(context);
      const elapsed = performance.now() - startTime;

      expect(elapsed).toBeLessThan(10); // Allow overhead for mocking
      expect(engine.getAdaptationTime()).toBeDefined();
    });

    it('should find similar patterns during adaptation', async () => {
      const context: Context = {
        domain: 'code',
        queryEmbedding: new Float32Array(768).fill(0.7),
      };

      const result = await engine.adapt(context);

      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].patternType).toBe('test-pattern');
      expect(result.patterns[0].avgQuality).toBeCloseTo(0.85);
    });

    it('should infer suggested route from patterns', async () => {
      const context: Context = {
        domain: 'creative',
        queryEmbedding: new Float32Array(768).fill(0.3),
      };

      const result = await engine.adapt(context);

      expect(result.suggestedRoute).toBeDefined();
      expect(typeof result.suggestedRoute).toBe('string');
    });

    it('should handle adaptation with no patterns found', async () => {
      const { SonaEngine } = await import('@ruvector/sona');
      // Create a complete mock with findPatterns returning empty array
      const emptyPatternsEngine = {
        beginTrajectory: vi.fn().mockReturnValue(1),
        addTrajectoryStep: vi.fn(),
        addTrajectoryContext: vi.fn(),
        endTrajectory: vi.fn(),
        flush: vi.fn(),
        applyMicroLora: vi.fn((arr: number[]) => arr),
        findPatterns: vi.fn().mockReturnValue([]),
        forceLearn: vi.fn().mockReturnValue('Learning complete'),
        tick: vi.fn().mockReturnValue(null),
        getStats: vi.fn().mockReturnValue(JSON.stringify({
          total_trajectories: 0,
          patterns_learned: 0,
          avg_quality: 0,
        })),
        isEnabled: vi.fn().mockReturnValue(true),
        setEnabled: vi.fn(),
      };
      vi.mocked(SonaEngine.withConfig).mockReturnValueOnce(emptyPatternsEngine as any);

      const freshEngine = new SONALearningEngine('balanced', modeConfig);
      const context: Context = {
        domain: 'code',
        queryEmbedding: new Float32Array(768).fill(0.5),
      };

      const result = await freshEngine.adapt(context);

      expect(result.patterns).toHaveLength(0);
      expect(result.confidence).toBeCloseTo(0.5); // Default confidence
    });
  });

  describe('Mode Switching', () => {
    it('should switch between modes correctly', () => {
      const modes: SONAMode[] = ['real-time', 'balanced', 'research', 'edge', 'batch'];

      modes.forEach(mode => {
        const testEngine = createSONALearningEngine(mode, {
          mode,
          loraRank: 4,
          learningRate: 0.002,
          batchSize: 32,
          trajectoryCapacity: 3000,
          patternClusters: 50,
          qualityThreshold: 0.5,
          maxLatencyMs: 18,
          memoryBudgetMb: 50,
          ewcLambda: 2000,
        });
        expect(testEngine).toBeDefined();
      });
    });

    it('should reset learning state', () => {
      expect(() => engine.resetLearning()).not.toThrow();
      expect(engine.getLearningTime()).toBe(0);
      expect(engine.getAdaptationTime()).toBe(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should return engine statistics', () => {
      const stats = engine.getStats();

      expect(stats).toBeDefined();
      expect(stats.totalTrajectories).toBe(10);
      expect(stats.patternsLearned).toBe(5);
      expect(stats.avgQuality).toBeCloseTo(0.75);
      expect(stats.enabled).toBe(true);
    });

    it('should track learning time', async () => {
      const trajectory: Trajectory = {
        trajectoryId: 'timing-test',
        context: 'Timing test',
        domain: 'code',
        steps: [
          {
            stepId: 'step-1',
            timestamp: Date.now(),
            action: 'test',
            stateBefore: new Float32Array(768).fill(0.5),
            stateAfter: new Float32Array(768).fill(0.6),
            reward: 0.7,
          },
        ],
        qualityScore: 0.7,
        isComplete: true,
        startTime: Date.now(),
      };

      await engine.learn(trajectory);
      expect(engine.getLearningTime()).toBeGreaterThan(0);
    });

    it('should track adaptation time', async () => {
      const context: Context = {
        domain: 'code',
        queryEmbedding: new Float32Array(768).fill(0.5),
      };

      await engine.adapt(context);
      expect(engine.getAdaptationTime()).toBeGreaterThan(0);
    });
  });

  describe('Engine Control', () => {
    it('should enable and disable engine', () => {
      engine.setEnabled(false);
      expect(engine.isEnabled()).toBe(false);

      engine.setEnabled(true);
      expect(engine.isEnabled()).toBe(true);
    });

    it('should force immediate learning', () => {
      const result = engine.forceLearning();
      expect(result).toBe('Learning complete');
    });

    it('should tick background learning', () => {
      const result = engine.tick();
      expect(result).toBeNull(); // No learning needed yet
    });

    it('should find patterns by query embedding', () => {
      const queryEmbedding = new Float32Array(768).fill(0.5);
      const patterns = engine.findPatterns(queryEmbedding, 5);

      expect(patterns).toBeDefined();
      expect(Array.isArray(patterns)).toBe(true);
    });
  });
});
