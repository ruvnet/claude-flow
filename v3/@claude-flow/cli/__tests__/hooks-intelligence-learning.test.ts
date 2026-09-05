/**
 * Hooks Intelligence Learning — Audit Fix Smoke Tests
 *
 * AUDIT FINDINGS #4 & #5:
 *  (A) hooks_intelligence_trajectory-end must feed the EWC consolidator a
 *      gradient derived from the trajectory's REAL embedding (via
 *      generateEmbedding) — NOT a synthetic sine wave. If no real embedding is
 *      available, it must SKIP the EWC update rather than inject noise.
 *  (B) hooks_intelligence_learn must actually TRIGGER a real learning/
 *      consolidation cycle (distillLearning), not merely echo stats.
 *
 * These tests isolate the handlers with mocks so no real DB/ONNX is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks (must be declared before importing the module under test) ---

// Capture the gradient passed to EWC so we can assert it is the real embedding.
const recordGradient = vi.fn();
const getConsolidationStats = vi.fn(() => ({
  avgPenalty: 0.42,
  consolidationCount: 1,
  highImportancePatterns: 0,
  totalPatterns: 1,
}));

vi.mock('../src/memory/ewc-consolidation.js', () => ({
  getEWCConsolidator: vi.fn(async () => ({
    recordGradient,
    getConsolidationStats,
  })),
}));

// SONA optimizer present and "learns" so the success branch runs.
vi.mock('../src/memory/sona-optimizer.js', () => ({
  getSONAOptimizer: vi.fn(async () => ({
    processTrajectoryOutcome: vi.fn(() => ({
      learned: true,
      patternKey: 'pattern-x',
      confidence: 0.9,
    })),
    getStats: vi.fn(() => ({
      totalPatterns: 3,
      successfulRoutings: 2,
      failedRoutings: 1,
      trajectoriesProcessed: 3,
      avgConfidence: 0.7,
    })),
  })),
}));

// REAL embedding signal — a distinctive vector that is clearly NOT a sine wave.
const REAL_EMBEDDING = new Array(384).fill(0).map((_, i) => (i % 2 === 0 ? 0.5 : 0.25));
vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: vi.fn(async () => ({
    embedding: REAL_EMBEDDING,
    dimensions: REAL_EMBEDDING.length,
    model: 'mock-onnx',
  })),
  // storeEntry must succeed so the success/learning branch (which contains the
  // EWC update) is reached in trajectory-end.
  storeEntry: vi.fn(async () => ({ success: true, id: 'mock-trajectory-id' })),
}));

// Intelligence layer — distillLearning is the real DISTILL+CONSOLIDATE path.
const distillLearning = vi.fn(async () => ({ patternsDistilled: 5, ewcPenalty: 0.13 }));
const runBackgroundLearning = vi.fn(async () => {});
vi.mock('../src/memory/intelligence.js', () => ({
  distillLearning,
  runBackgroundLearning,
}));

// graph-edge-writer is fire-and-forget; stub it.
vi.mock('../src/memory/graph-edge-writer.js', () => ({
  insertGraphEdge: vi.fn(async () => {}),
}));

import {
  hooksTrajectoryStart,
  hooksTrajectoryStep,
  hooksTrajectoryEnd,
  hooksIntelligenceLearn,
} from '../src/mcp-tools/hooks-tools.js';
import { generateEmbedding } from '../src/memory/memory-initializer.js';

describe('AUDIT FIX #4 — trajectory-end feeds REAL embedding gradient to EWC', () => {
  beforeEach(() => {
    recordGradient.mockClear();
    (generateEmbedding as ReturnType<typeof vi.fn>).mockClear();
  });

  it('records a gradient equal to the real trajectory embedding, not a sine wave', async () => {
    const started = (await hooksTrajectoryStart.handler({ task: 'do work', agent: 'coder' })) as any;
    const trajectoryId = started.trajectoryId as string;

    await hooksTrajectoryStep.handler({ trajectoryId, action: 'edit-file', result: 'ok', quality: 0.9 });

    const ended = (await hooksTrajectoryEnd.handler({ trajectoryId, success: true })) as any;

    // generateEmbedding was used to derive the gradient (mirrors DISTILL path)
    expect(generateEmbedding).toHaveBeenCalledTimes(1);

    // EWC received the REAL embedding, not synthetic noise
    expect(recordGradient).toHaveBeenCalledTimes(1);
    const passedGradient = recordGradient.mock.calls[0][1] as number[];
    expect(passedGradient).toEqual(REAL_EMBEDDING);

    // Guard: the OLD synthetic gradient was sin(i*0.01)*(steps/10). With 1 step
    // that produced values like sin(0)=0, sin(0.01)*0.1 ~= 0.001 — confirm the
    // gradient is NOT that degenerate sine sequence.
    expect(passedGradient[0]).not.toBeCloseTo(Math.sin(0) * (1 / 10), 6);
    expect(passedGradient[1]).not.toBeCloseTo(Math.sin(0.01) * (1 / 10), 6);

    expect(ended.learning.ewcConsolidation).toBe(true);
  });

  it('SKIPS the EWC update (no synthetic gradient) when no real embedding is available', async () => {
    (generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      embedding: [],
      dimensions: 0,
      model: 'none',
    });

    const started = (await hooksTrajectoryStart.handler({ task: 'task2', agent: 'coder' })) as any;
    const trajectoryId = started.trajectoryId as string;
    await hooksTrajectoryStep.handler({ trajectoryId, action: 'a', result: 'ok' });

    const ended = (await hooksTrajectoryEnd.handler({ trajectoryId, success: true })) as any;

    // No gradient recorded — we skip rather than inject noise.
    expect(recordGradient).not.toHaveBeenCalled();
    expect(ended.learning.ewcConsolidation).toBe(false);
  });
});

describe('AUDIT FIX #5 — hooks_intelligence_learn actually triggers a learning cycle', () => {
  beforeEach(() => {
    distillLearning.mockClear();
    runBackgroundLearning.mockClear();
  });

  it('calls the real distillLearning (DISTILL+CONSOLIDATE) path, not just stats echo', async () => {
    const result = (await hooksIntelligenceLearn.handler({ consolidate: true })) as any;

    expect(distillLearning).toHaveBeenCalledTimes(1);
    expect(result.cycleTriggered).toBe(true);
    expect(result.patternsDistilled).toBe(5);
    expect(result.implementation).toBe('real-distill-consolidate');
    expect(result.learned).toBe(true);
  });
});
