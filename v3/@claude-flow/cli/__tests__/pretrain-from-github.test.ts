// Pretrain-from-history regression guard (ADR-077).
//
// We don't shell out to git or gh here — instead we drive the same code paths
// the script uses (distillAndSerialise → recordTrajectory + storeNeuralPatterns)
// with an embedded fixture. This keeps the test deterministic, offline, and
// fast. If the wiring regresses (#2245 again), this test fails.
//
// What we assert:
//   1. Every fixture item produces a distilled 4-field representation.
//   2. recordTrajectory bumps globalStats.{trajectoriesRecorded, patternsLearned}.
//   3. storeNeuralPatterns adds to the neural store and the count is readable
//      via getNeuralStoreStats().
//   4. getUnifiedLearningStats() returns a coherent view across all four stores.
//   5. learningPath signal — recordTrajectory returns success without throwing,
//      proving the trajectory pipeline (not just memory-bridge) ran.

import { describe, it, expect, beforeAll } from 'vitest';
import { distillAndSerialise } from '../src/memory/structured-distill.js';
import {
  recordTrajectory,
  getUnifiedLearningStats,
  flushIntelligenceStats,
} from '../src/memory/intelligence.js';
import {
  storeNeuralPatterns,
  getNeuralStoreStats,
  neuralTools,
} from '../src/mcp-tools/neural-tools.js';

// Fixture — a tiny mock "history" shaped like real ruflo commits + issues.
// Intentionally small so this stays fast. The shape (subject + body + verdict)
// matches what pretrain-from-github.mjs builds from git log + gh issue list.
const FIXTURE = [
  {
    source: 'commit', id: 'commit-aaa1', verdict: 'success' as const,
    subject: 'fix(intelligence): wire hooks_task-completed to recordTrajectory',
    body: 'Fixes #2245. The MCP tool now calls recordTrajectory() instead of just bumping a stub counter. Updated src/mcp-tools/hooks-tools.ts:142.',
  },
  {
    source: 'commit', id: 'commit-aaa2', verdict: 'success' as const,
    subject: 'feat(memory): unified learning-stats aggregator (ADR-075)',
    body: 'Adds getUnifiedLearningStats() in src/memory/intelligence.ts that returns a coherent view across all 4 stores with a consistency block.',
  },
  {
    source: 'commit', id: 'commit-aaa3', verdict: 'success' as const,
    subject: 'feat(intelligence): structured distillation (ADR-076)',
    body: '4-field schema: summary, detail, labels, paths. Per arXiv:2603.13017. Serialiser leads with labels.',
  },
  {
    source: 'issue', id: 'issue-2245', verdict: 'success' as const,
    subject: 'Self-learning reports success but persists nothing',
    body: 'signalsProcessed never moves. hooks_task-completed returns success but downstream counters stay at zero.',
  },
  {
    source: 'issue', id: 'issue-2241', verdict: 'partial' as const,
    subject: 'Dream Cycle 2026-05-30 performance scan',
    body: 'MV-HNSW 14x gap. LAMaS 38-46% latency. Security and hive-mind scans incoming.',
  },
];

describe('pretrain-from-github wiring guard (#2245 regression)', () => {
  let before: Awaited<ReturnType<typeof getUnifiedLearningStats>>;
  let afterStats: Awaited<ReturnType<typeof getUnifiedLearningStats>>;
  let neuralBefore: Awaited<ReturnType<typeof getNeuralStoreStats>>;
  let neuralAfter: Awaited<ReturnType<typeof getNeuralStoreStats>>;
  let trainedCount = 0;

  beforeAll(async () => {
    before = await getUnifiedLearningStats();
    neuralBefore = await getNeuralStoreStats();

    for (const item of FIXTURE) {
      const distilled = distillAndSerialise(`${item.subject}\n\n${item.body}`);
      // Distillation must be non-empty for every item.
      expect(distilled.length).toBeGreaterThan(10);

      await recordTrajectory(
        [{
          type: 'result',
          content: distilled,
          metadata: { source: item.source, id: item.id, subject: item.subject.slice(0, 200) },
          timestamp: Date.now(),
        }],
        item.verdict,
      );
      trainedCount++;
    }

    await storeNeuralPatterns(
      FIXTURE.map((item) => ({
        name: item.subject.slice(0, 200),
        type: item.source === 'commit' ? 'history-commit' : 'history-issue',
        content: distillAndSerialise(`${item.subject}\n\n${item.body}`),
        metadata: { source: item.source, id: item.id, verdict: item.verdict },
      })),
    );

    flushIntelligenceStats();
    afterStats = await getUnifiedLearningStats();
    neuralAfter = await getNeuralStoreStats();
  });

  it('feeds every fixture item through recordTrajectory without errors', () => {
    expect(trainedCount).toBe(FIXTURE.length);
  });

  it('bumps globalStats.trajectoriesRecorded by at least the fixture size', () => {
    expect(afterStats.global.trajectoriesRecorded - before.global.trajectoriesRecorded)
      .toBeGreaterThanOrEqual(FIXTURE.length);
  });

  it('bumps globalStats.patternsLearned (Round B/C wiring still alive)', () => {
    expect(afterStats.global.patternsLearned - before.global.patternsLearned)
      .toBeGreaterThan(0);
  });

  it('populates the neural store (closes #2245 "neural_patterns stays empty" gap)', () => {
    expect(neuralAfter.patternCount - neuralBefore.patternCount)
      .toBeGreaterThanOrEqual(FIXTURE.length);
  });

  it('getUnifiedLearningStats returns the 4 documented sub-views', () => {
    expect(afterStats.global).toBeDefined();
    expect(afterStats.sona).toBeDefined();
    expect(afterStats.memoryBridge).toBeDefined();
    expect(afterStats.neuralPatterns).toBeDefined();
    expect(afterStats.consistency).toBeDefined();
    expect(Array.isArray(afterStats.consistency.notes)).toBe(true);
  });

  it('distillation captures issue/commit identifiers in the embedded form', () => {
    // The fixture intentionally includes recognisable tokens. The distilled
    // form should preserve them so downstream retrieval can match.
    const item = FIXTURE[3]; // issue-2245
    const distilled = distillAndSerialise(`${item.subject}\n\n${item.body}`);
    expect(distilled).toMatch(/2245|self-learning|persists/i);
  });

  // ADR-078 — hybrid retrieval should be at least as discriminative as cosine
  // alone on an exact-keyword query. We don't require a strict inequality
  // because on a 5-item fixture both modes can return the same top-1.
  it('hybrid search returns a non-empty result and respects mode parameter', async () => {
    const tool = neuralTools.find((t) => t.name === 'neural_patterns');
    expect(tool).toBeDefined();

    const hybrid = await tool!.handler({
      action: 'search',
      query: 'structured distillation 4-field schema',
      mode: 'hybrid',
      limit: 3,
    });
    expect(hybrid.mode).toBe('hybrid');
    expect(Array.isArray(hybrid.results)).toBe(true);
    expect(hybrid.results.length).toBeGreaterThan(0);
    // Top-1 of a query targeting commit-aaa3 (Structured Distillation, ADR-076)
    // should mention either 'structured', 'distillation', or 'ADR-076'.
    const top1Name = String(hybrid.results[0].name).toLowerCase();
    expect(top1Name).toMatch(/structured|distillation|adr-076|076/);
    // Hybrid path returns the extra ADR-078 fields.
    expect(hybrid.results[0]).toHaveProperty('hybridScore');
    expect(hybrid.results[0]).toHaveProperty('cosineScore');
    expect(hybrid.results[0]).toHaveProperty('bm25Score');

    const cosine = await tool!.handler({
      action: 'search',
      query: 'structured distillation 4-field schema',
      mode: 'cosine',
      limit: 3,
    });
    expect(cosine.mode).toBe('cosine');
    expect(Array.isArray(cosine.results)).toBe(true);
    // Cosine path does NOT include the hybrid breakdown.
    expect(cosine.results[0]).not.toHaveProperty('hybridScore');
  });
});
