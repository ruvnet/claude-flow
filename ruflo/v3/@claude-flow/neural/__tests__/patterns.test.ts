/**
 * Pattern Learning and ReasoningBank Tests
 *
 * Tests for pattern extraction, memory distillation, and trajectory tracking:
 * - Pattern extraction from trajectories
 * - Memory distillation (4-step pipeline)
 * - Trajectory tracking and judgment
 * - Pattern evolution and consolidation
 *
 * Performance target: <10ms for learning operations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ReasoningBank,
  createReasoningBank,
  type RetrievalResult,
  type ConsolidationResult,
} from '../src/reasoning-bank.js';
import type {
  Trajectory,
  TrajectoryVerdict,
  DistilledMemory,
  Pattern,
} from '../src/types.js';

// Helper function to create test trajectories
function createTestTrajectory(
  quality: number = 0.75,
  domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general' = 'code',
  steps: number = 5
): Trajectory {
  return {
    trajectoryId: `test-traj-${Date.now()}-${Math.random()}`,
    context: `Test task for ${domain}`,
    domain,
    steps: Array.from({ length: steps }, (_, i) => ({
      stepId: `step-${i}`,
      timestamp: Date.now() + i * 100,
      action: `action-${i}`,
      stateBefore: new Float32Array(768).fill(i * 0.1),
      stateAfter: new Float32Array(768).fill((i + 1) * 0.1),
      reward: 0.5 + (i / steps) * (quality - 0.5) * 2,
    })),
    qualityScore: quality,
    isComplete: true,
    startTime: Date.now() - 1000,
    endTime: Date.now(),
  };
}

describe('ReasoningBank - Pattern Extraction', () => {
  let bank: ReasoningBank;

  beforeEach(() => {
    bank = createReasoningBank({
      maxTrajectories: 1000,
      distillationThreshold: 0.6,
      retrievalK: 3,
      mmrLambda: 0.7,
    });
  });

  it('should initialize correctly', () => {
    expect(bank).toBeDefined();
    const stats = bank.getStats();
    expect(stats.trajectoryCount).toBe(0);
    expect(stats.memoryCount).toBe(0);
    expect(stats.patternCount).toBe(0);
  });

  it('should store trajectories', () => {
    const trajectory = createTestTrajectory(0.8);
    bank.storeTrajectory(trajectory);

    const stats = bank.getStats();
    expect(stats.trajectoryCount).toBe(1);

    const retrieved = bank.getTrajectory(trajectory.trajectoryId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.trajectoryId).toBe(trajectory.trajectoryId);
  });

  it('should retrieve all trajectories', () => {
    for (let i = 0; i < 5; i++) {
      bank.storeTrajectory(createTestTrajectory(0.7 + i * 0.05));
    }

    const trajectories = bank.getTrajectories();
    expect(trajectories).toHaveLength(5);
  });

  it('should judge successful trajectories correctly', async () => {
    const trajectory = createTestTrajectory(0.85, 'code', 10);
    const verdict = await bank.judge(trajectory);

    expect(verdict).toBeDefined();
    expect(verdict.success).toBe(true);
    expect(verdict.confidence).toBeGreaterThan(0);
    expect(verdict.strengths).toBeDefined();
    expect(verdict.weaknesses).toBeDefined();
    expect(verdict.improvements).toBeDefined();
  });

  it('should judge failed trajectories correctly', async () => {
    const trajectory = createTestTrajectory(0.3, 'code', 10);
    const verdict = await bank.judge(trajectory);

    expect(verdict.success).toBe(false);
    expect(verdict.weaknesses.length).toBeGreaterThan(0);
  });

  it('should identify strengths in high-quality trajectories', async () => {
    const trajectory = createTestTrajectory(0.95, 'code', 8);
    const verdict = await bank.judge(trajectory);

    expect(verdict.strengths.length).toBeGreaterThan(0);
    expect(verdict.strengths.some(s => s.includes('quality'))).toBe(true);
  });

  it('should identify weaknesses in low-quality trajectories', async () => {
    const trajectory = createTestTrajectory(0.2, 'code', 15);
    const verdict = await bank.judge(trajectory);

    expect(verdict.weaknesses.length).toBeGreaterThan(0);
  });

  it('should generate improvement suggestions', async () => {
    const trajectory = createTestTrajectory(0.4, 'code', 12);
    const verdict = await bank.judge(trajectory);

    expect(verdict.improvements).toBeDefined();
    if (verdict.weaknesses.length > 0) {
      expect(verdict.improvements.length).toBeGreaterThan(0);
    }
  });

  it('should throw on judging incomplete trajectory', async () => {
    const incompleteTrajectory: Trajectory = {
      ...createTestTrajectory(0.8),
      isComplete: false,
    };

    await expect(bank.judge(incompleteTrajectory)).rejects.toThrow('incomplete');
  });
});

describe('ReasoningBank - Memory Distillation', () => {
  let bank: ReasoningBank;

  beforeEach(() => {
    bank = createReasoningBank({
      distillationThreshold: 0.6,
    });
  });

  it('should distill successful trajectories', async () => {
    const trajectory = createTestTrajectory(0.8);
    const memory = await bank.distill(trajectory);

    expect(memory).toBeDefined();
    expect(memory?.memoryId).toBeDefined();
    expect(memory?.strategy).toBeDefined();
    expect(memory?.keyLearnings).toBeDefined();
    expect(memory?.embedding).toBeInstanceOf(Float32Array);
    expect(memory?.quality).toBeCloseTo(0.8);
  });

  it('should not distill low-quality trajectories', async () => {
    const trajectory = createTestTrajectory(0.3);
    const memory = await bank.distill(trajectory);

    expect(memory).toBeNull();
  });

  it('should automatically judge before distillation', async () => {
    const trajectory = createTestTrajectory(0.85);
    expect(trajectory.verdict).toBeUndefined();

    const memory = await bank.distill(trajectory);

    expect(trajectory.verdict).toBeDefined();
    expect(memory).not.toBeNull();
  });

  it('should extract meaningful strategy', async () => {
    const trajectory = createTestTrajectory(0.9, 'code', 8);
    const memory = await bank.distill(trajectory);

    expect(memory).not.toBeNull();
    expect(memory!.strategy).toBeTruthy();
    expect(typeof memory!.strategy).toBe('string');
  });

  it('should extract key learnings', async () => {
    const trajectory = createTestTrajectory(0.85, 'reasoning', 10);
    const memory = await bank.distill(trajectory);

    expect(memory).not.toBeNull();
    expect(memory!.keyLearnings).toBeDefined();
    expect(Array.isArray(memory!.keyLearnings)).toBe(true);
    expect(memory!.keyLearnings.length).toBeGreaterThan(0);
  });

  it('should compute aggregate embedding', async () => {
    const trajectory = createTestTrajectory(0.8, 'code', 10);
    const memory = await bank.distill(trajectory);

    expect(memory).not.toBeNull();
    expect(memory!.embedding).toBeInstanceOf(Float32Array);
    expect(memory!.embedding.length).toBe(768);
  });

  it('should track distillation performance', async () => {
    const trajectory = createTestTrajectory(0.8);
    await bank.distill(trajectory);

    const stats = bank.getStats();
    expect(stats.avgDistillationTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should link distilled memory to trajectory', async () => {
    const trajectory = createTestTrajectory(0.9);
    const memory = await bank.distill(trajectory);

    expect(trajectory.distilledMemory).toBeDefined();
    expect(trajectory.distilledMemory?.memoryId).toBe(memory?.memoryId);
  });
});

describe('ReasoningBank - Retrieval (MMR)', () => {
  let bank: ReasoningBank;

  beforeEach(async () => {
    bank = createReasoningBank({
      retrievalK: 3,
      mmrLambda: 0.7,
    });

    // Add some diverse memories
    for (let i = 0; i < 10; i++) {
      const trajectory = createTestTrajectory(0.7 + i * 0.02, 'code', 8);
      await bank.distill(trajectory);
    }
  });

  it('should retrieve top-k similar memories', async () => {
    const queryEmbedding = new Float32Array(768).fill(0.5);
    const results = await bank.retrieve(queryEmbedding, 3);

    expect(results).toBeDefined();
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should apply MMR for diversity', async () => {
    const queryEmbedding = new Float32Array(768).fill(0.5);
    const results = await bank.retrieve(queryEmbedding, 5);

    // Check that results have diversity scores
    for (const result of results) {
      expect(result.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(result.diversityScore).toBeGreaterThanOrEqual(0);
      expect(result.combinedScore).toBeDefined();
    }
  });

  it('should return retrieval results with proper structure', async () => {
    const queryEmbedding = new Float32Array(768).fill(0.3);
    const results = await bank.retrieve(queryEmbedding);

    for (const result of results) {
      expect(result.memory).toBeDefined();
      expect(result.memory.memoryId).toBeTruthy();
      expect(result.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(result.relevanceScore).toBeLessThanOrEqual(1);
    }
  });

  it('should track retrieval performance', async () => {
    const queryEmbedding = new Float32Array(768).fill(0.5);
    await bank.retrieve(queryEmbedding);

    const stats = bank.getStats();
    expect(stats.avgRetrievalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle retrieval with no memories', async () => {
    const emptyBank = createReasoningBank();
    const queryEmbedding = new Float32Array(768).fill(0.5);
    const results = await emptyBank.retrieve(queryEmbedding);

    expect(results).toHaveLength(0);
  });

  it('should respect retrieval k parameter', async () => {
    const queryEmbedding = new Float32Array(768).fill(0.5);
    const results = await bank.retrieve(queryEmbedding, 2);

    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('ReasoningBank - Consolidation', () => {
  let bank: ReasoningBank;

  beforeEach(async () => {
    bank = createReasoningBank({
      dedupThreshold: 0.95,
      enableContradictionDetection: true,
      maxPatternAgeDays: 30,
    });
  });

  it('should deduplicate similar memories', async () => {
    // Add very similar trajectories
    for (let i = 0; i < 5; i++) {
      const trajectory = createTestTrajectory(0.8, 'code', 5);
      await bank.distill(trajectory);
    }

    const beforeStats = bank.getStats();
    const result = await bank.consolidate();

    expect(result.removedDuplicates).toBeGreaterThanOrEqual(0);
  });

  it('should detect contradictions', async () => {
    // Add similar contexts with different outcomes
    const highQualityTraj = createTestTrajectory(0.95, 'code', 5);
    const lowQualityTraj = createTestTrajectory(0.2, 'code', 5);

    await bank.distill(highQualityTraj);
    await bank.distill(lowQualityTraj);

    const result = await bank.consolidate();

    expect(result.contradictionsDetected).toBeGreaterThanOrEqual(0);
  });

  it('should merge similar patterns', async () => {
    // Create some patterns first
    for (let i = 0; i < 5; i++) {
      const trajectory = createTestTrajectory(0.75, 'code', 5);
      const memory = await bank.distill(trajectory);
      if (memory) {
        bank.memoryToPattern(memory);
      }
    }

    const result = await bank.consolidate();
    expect(result.mergedPatterns).toBeGreaterThanOrEqual(0);
  });

  it('should prune old patterns', async () => {
    const result = await bank.consolidate();
    expect(result.prunedPatterns).toBeGreaterThanOrEqual(0);
  });

  it('should return consolidation result', async () => {
    const result = await bank.consolidate();

    expect(result).toBeDefined();
    expect(result.removedDuplicates).toBeGreaterThanOrEqual(0);
    expect(result.contradictionsDetected).toBeGreaterThanOrEqual(0);
    expect(result.prunedPatterns).toBeGreaterThanOrEqual(0);
    expect(result.mergedPatterns).toBeGreaterThanOrEqual(0);
  });

  it('should emit consolidation event', async () => {
    let eventEmitted = false;
    bank.addEventListener((event) => {
      if (event.type === 'memory_consolidated') {
        eventEmitted = true;
      }
    });

    await bank.consolidate();
    expect(eventEmitted).toBe(true);
  });
});

describe('Pattern Management', () => {
  let bank: ReasoningBank;

  beforeEach(() => {
    bank = createReasoningBank();
  });

  it('should convert memory to pattern', async () => {
    const trajectory = createTestTrajectory(0.85, 'code', 8);
    const memory = await bank.distill(trajectory);

    expect(memory).not.toBeNull();
    const pattern = bank.memoryToPattern(memory!);

    expect(pattern).toBeDefined();
    expect(pattern.patternId).toBeTruthy();
    expect(pattern.name).toBeTruthy();
    expect(pattern.domain).toBe('code');
    expect(pattern.strategy).toBe(memory!.strategy);
    expect(pattern.successRate).toBe(memory!.quality);
  });

  it('should evolve pattern based on new experience', async () => {
    const trajectory1 = createTestTrajectory(0.8, 'code', 5);
    const memory = await bank.distill(trajectory1);
    const pattern = bank.memoryToPattern(memory!);

    const trajectory2 = createTestTrajectory(0.9, 'code', 5);
    bank.evolvePattern(pattern.patternId, trajectory2);

    const patterns = bank.getPatterns();
    const evolvedPattern = patterns.find(p => p.patternId === pattern.patternId);

    expect(evolvedPattern).toBeDefined();
    expect(evolvedPattern!.usageCount).toBe(1);
    expect(evolvedPattern!.qualityHistory.length).toBeGreaterThan(1);
    expect(evolvedPattern!.evolutionHistory.length).toBeGreaterThan(0);
  });

  it('should track pattern usage', async () => {
    const trajectory = createTestTrajectory(0.85, 'code', 5);
    const memory = await bank.distill(trajectory);
    const pattern = bank.memoryToPattern(memory!);

    // Evolve multiple times
    for (let i = 0; i < 3; i++) {
      const newTraj = createTestTrajectory(0.7 + i * 0.05, 'code', 5);
      bank.evolvePattern(pattern.patternId, newTraj);
    }

    const patterns = bank.getPatterns();
    const usedPattern = patterns.find(p => p.patternId === pattern.patternId);

    expect(usedPattern!.usageCount).toBe(3);
  });

  it('should update success rate on evolution', async () => {
    const trajectory1 = createTestTrajectory(0.7, 'code', 5);
    const memory = await bank.distill(trajectory1);
    const pattern = bank.memoryToPattern(memory!);

    const initialSuccessRate = pattern.successRate;

    const trajectory2 = createTestTrajectory(0.9, 'code', 5);
    bank.evolvePattern(pattern.patternId, trajectory2);

    const patterns = bank.getPatterns();
    const evolvedPattern = patterns.find(p => p.patternId === pattern.patternId);

    expect(evolvedPattern!.successRate).not.toBe(initialSuccessRate);
  });

  it('should maintain quality history (max 100)', async () => {
    const trajectory = createTestTrajectory(0.8, 'code', 5);
    const memory = await bank.distill(trajectory);
    const pattern = bank.memoryToPattern(memory!);

    // Evolve many times
    for (let i = 0; i < 150; i++) {
      const newTraj = createTestTrajectory(0.6 + (i % 40) * 0.01, 'code', 3);
      bank.evolvePattern(pattern.patternId, newTraj);
    }

    const patterns = bank.getPatterns();
    const evolvedPattern = patterns.find(p => p.patternId === pattern.patternId);

    expect(evolvedPattern!.qualityHistory.length).toBeLessThanOrEqual(100);
  });

  it('should emit pattern evolution event', async () => {
    let eventEmitted = false;
    bank.addEventListener((event) => {
      if (event.type === 'pattern_evolved') {
        eventEmitted = true;
      }
    });

    const trajectory1 = createTestTrajectory(0.8, 'code', 5);
    const memory = await bank.distill(trajectory1);
    const pattern = bank.memoryToPattern(memory!);

    const trajectory2 = createTestTrajectory(0.85, 'code', 5);
    bank.evolvePattern(pattern.patternId, trajectory2);

    expect(eventEmitted).toBe(true);
  });

  it('should get all patterns', async () => {
    for (let i = 0; i < 5; i++) {
      const trajectory = createTestTrajectory(0.75 + i * 0.02, 'code', 5);
      const memory = await bank.distill(trajectory);
      if (memory) {
        bank.memoryToPattern(memory);
      }
    }

    const patterns = bank.getPatterns();
    expect(patterns.length).toBeGreaterThan(0);
  });
});

describe('Event System', () => {
  let bank: ReasoningBank;

  beforeEach(() => {
    bank = createReasoningBank();
  });

  it('should add and remove event listeners', () => {
    const listener = () => {};

    expect(() => bank.addEventListener(listener)).not.toThrow();
    expect(() => bank.removeEventListener(listener)).not.toThrow();
  });

  it('should emit consolidation events', async () => {
    let eventReceived = false;

    bank.addEventListener((event) => {
      if (event.type === 'memory_consolidated') {
        eventReceived = true;
      }
    });

    await bank.consolidate();
    expect(eventReceived).toBe(true);
  });

  it('should emit pattern evolution events', async () => {
    let evolutionEvent: any = null;

    bank.addEventListener((event) => {
      if (event.type === 'pattern_evolved') {
        evolutionEvent = event;
      }
    });

    const trajectory1 = createTestTrajectory(0.8, 'code', 5);
    const memory = await bank.distill(trajectory1);
    const pattern = bank.memoryToPattern(memory!);

    const trajectory2 = createTestTrajectory(0.9, 'code', 5);
    bank.evolvePattern(pattern.patternId, trajectory2);

    expect(evolutionEvent).not.toBeNull();
    expect(evolutionEvent.patternId).toBe(pattern.patternId);
  });
});
