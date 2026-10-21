// #3979 item 4: the Learning page's "patterns learned" always equalled
// "trajectories": recordTrajectory() bumped globalStats.patternsLearned for
// every successful step, even when LocalReasoningBank.store() merged the step
// into an existing pattern (same content). The metric read as learning while it
// was really a step count. It must count only patterns that were actually added.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Steps carry their own embeddings, but keep any embedding the module does
// generate deterministic so this file does not depend on a model cache.
vi.mock('../src/memory/memory-bridge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/memory/memory-bridge.js')>();
  return { ...actual, bridgeGenerateEmbedding: vi.fn(async () => null) };
});
vi.mock('../src/memory/memory-initializer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/memory/memory-initializer.js')>();
  return {
    ...actual,
    generateEmbedding: vi.fn(async () => ({
      embedding: [1, 0, 0],
      dimensions: 3,
      model: 'mock-deterministic',
      backend: 'mock' as const,
    })),
  };
});

// Scope CWD to this file only (vitest shares the process across files).
const SCRATCH = mkdtempSync(join(tmpdir(), 'intel-3979-'));
let originalCwd: string;

beforeAll(() => {
  originalCwd = process.cwd();
  process.chdir(SCRATCH);
  mkdirSync(join(SCRATCH, '.claude-flow'), { recursive: true });
});

afterAll(() => {
  try { process.chdir(originalCwd); } catch { /* best-effort */ }
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* best-effort */ }
});

beforeEach(async () => {
  const intel = await import('../src/memory/intelligence.js');
  intel.clearIntelligence();
  try { rmSync(join(SCRATCH, '.claude-flow', 'neural'), { recursive: true, force: true }); } catch { /* none */ }
  await intel.initializeIntelligence();
});

function step(content: string, embedding: number[]) {
  return { type: 'action' as const, content, embedding, metadata: {}, timestamp: Date.now() };
}

describe('patterns learned counts new patterns, not successful steps (#3979 item 4)', () => {
  it('does not count a repeated identical step as a new pattern', async () => {
    const intel = await import('../src/memory/intelligence.js');

    await intel.recordTrajectory([step('run the unit tests', [1, 0, 0])], 'success');
    const afterFirst = intel.getIntelligenceStats().patternsLearned;
    // The metric is max(bank size, running counter). Repeat enough times that
    // an unconditional counter bump would overtake the bank size.
    for (let i = 0; i < 12; i++) {
      await intel.recordTrajectory([step('run the unit tests', [1, 0, 0])], 'success');
    }
    const afterRepeats = intel.getIntelligenceStats().patternsLearned;

    // Twelve identical successes merge into the existing pattern.
    expect(afterRepeats).toBe(afterFirst);
    // The bank holds one pattern for that content, not thirteen.
    const bank = intel.getReasoningBank()!;
    const hits = bank.findSimilar([1, 0, 0], { k: 50, threshold: 0 }).filter((p) => p.content === 'run the unit tests');
    expect(hits).toHaveLength(1);
  });

  it('still counts each genuinely different step', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const before = intel.getIntelligenceStats().patternsLearned;

    await intel.recordTrajectory([step('open the config file', [1, 0, 0])], 'success');
    await intel.recordTrajectory([step('commit the change', [0, 1, 0])], 'success');
    await intel.recordTrajectory([step('push the branch', [0, 0, 1])], 'success');

    expect(intel.getIntelligenceStats().patternsLearned - before).toBe(3);
  });

  it('does not count failed trajectories', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const before = intel.getIntelligenceStats().patternsLearned;
    await intel.recordTrajectory([step('a step that failed', [0, 1, 0])], 'failure');
    expect(intel.getIntelligenceStats().patternsLearned).toBe(before);
  });
});
