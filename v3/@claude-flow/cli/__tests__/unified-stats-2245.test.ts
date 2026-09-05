// Cross-store consistency tests for the unified learning-stats aggregator
// (ADR-075, #2245 follow-up to ADR-074).
//
// Drives each learning path and asserts the corresponding counter shows up
// where it should in the unified view. Also asserts the `consistency` block
// either reports drift OR confirms agreement — no silent disagreement.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRATCH = mkdtempSync(join(tmpdir(), 'unified-2245-'));
let originalCwd: string;

beforeAll(async () => {
  originalCwd = process.cwd();
  process.chdir(SCRATCH);
  const intel = await import('../src/memory/intelligence.js');
  intel.clearIntelligence();
});

afterAll(() => {
  try { process.chdir(originalCwd); } catch { /* */ }
  try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* */ }
});

describe('UnifiedLearningStats shape (ADR-075)', () => {
  it('returns all four sub-views with their source paths', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const stats = await intel.getUnifiedLearningStats();

    expect(stats.global.source).toMatch(/globalStats|stats\.json/);
    expect(stats.sona.source).toMatch(/sonaCoordinator/);
    expect(stats.memoryBridge.source).toMatch(/memory-bridge/);
    expect(stats.neuralPatterns.source).toMatch(/neural/);

    expect(typeof stats.global.patternsLearned).toBe('number');
    expect(typeof stats.global.trajectoriesRecorded).toBe('number');
    expect(typeof stats.global.signalsProcessed).toBe('number');
    expect(typeof stats.sona.trajectoriesTotal).toBe('number');
    expect(typeof stats.memoryBridge.totalEntries).toBe('number');
    expect(typeof stats.neuralPatterns.patternCount).toBe('number');

    expect(stats.consistency).toBeDefined();
    expect(Array.isArray(stats.consistency.notes)).toBe(true);
    expect(typeof stats.consistency.sonaTracksGlobal).toBe('boolean');
    expect(typeof stats.generatedAt).toBe('string');
  });
});

describe('Driving each path moves the right counter in the unified view (#2245)', () => {
  it('recordSignalProcessed → global.signalsProcessed up', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const before = (await intel.getUnifiedLearningStats()).global.signalsProcessed;
    intel.recordSignalProcessed();
    intel.recordSignalProcessed();
    intel.flushIntelligenceStats();
    const after = (await intel.getUnifiedLearningStats()).global.signalsProcessed;
    expect(after).toBe(before + 2);
  });

  it('storeNeuralPatterns → neuralPatterns.patternCount up', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const neural = await import('../src/mcp-tools/neural-tools.js');
    const before = (await intel.getUnifiedLearningStats()).neuralPatterns.patternCount;
    await neural.storeNeuralPatterns([
      { name: 'unified-test-1', type: 'unified-test', content: 'pattern A' },
      { name: 'unified-test-2', type: 'unified-test', content: 'pattern B' },
    ]);
    const after = await intel.getUnifiedLearningStats();
    expect(after.neuralPatterns.patternCount).toBe(before + 2);
    expect(after.neuralPatterns.byType['unified-test']).toBeGreaterThanOrEqual(2);
  });

  it('hooks_task-completed {trainPatterns:true} → global.trajectoriesRecorded up', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const { hooksTools } = await import('../src/mcp-tools/hooks-tools.js');
    const tool = hooksTools.find((t) => t.name === 'hooks_task-completed')!;
    const before = (await intel.getUnifiedLearningStats()).global.trajectoriesRecorded;
    await tool.handler({
      taskId: 'unified-t-1', success: true, quality: 0.9, trainPatterns: true,
      content: 'unified consistency test trajectory',
    });
    const after = (await intel.getUnifiedLearningStats()).global.trajectoriesRecorded;
    expect(after).toBeGreaterThan(before);
  }, 30_000);
});

describe('Consistency block flags drift, not silence (#2245 "contradictory sources")', () => {
  it('reports memory-bridge unreachable explicitly when it is', async () => {
    const intel = await import('../src/memory/intelligence.js');
    const stats = await intel.getUnifiedLearningStats();
    // In a fresh scratch CWD the bridge may or may not be reachable;
    // either way, the response declares its state — never silently 0.
    expect(typeof stats.memoryBridge.reachable).toBe('boolean');
    if (!stats.memoryBridge.reachable) {
      expect(stats.consistency.notes.some((n) => /memory-bridge/i.test(n))).toBe(true);
    }
  });

  it('flags the "patternsLearned > 0 but neural store empty" pattern when it occurs', async () => {
    // We already drove a task-completed earlier in this file, which moves
    // global.patternsLearned. If neural store is still empty, the
    // consistency note MUST mention it. If neural store has patterns,
    // the note MUST NOT spuriously flag.
    const intel = await import('../src/memory/intelligence.js');
    const stats = await intel.getUnifiedLearningStats();
    if (stats.global.patternsLearned > 0 && stats.neuralPatterns.patternCount === 0) {
      expect(stats.consistency.notes.some((n) => /neural_patterns store is empty/i.test(n))).toBe(true);
    } else if (stats.global.patternsLearned === 0 || stats.neuralPatterns.patternCount > 0) {
      expect(stats.consistency.notes.every((n) => !/neural_patterns store is empty/i.test(n))).toBe(true);
    }
  });
});

describe('MCP tool exposes the unified view (#2245 → ADR-075)', () => {
  it('hooks_intelligence_unified-stats is registered and returns the unified shape', async () => {
    const { hooksTools } = await import('../src/mcp-tools/hooks-tools.js');
    const tool = hooksTools.find((t) => t.name === 'hooks_intelligence_unified-stats');
    expect(tool).toBeDefined();
    const r = (await tool!.handler({})) as Record<string, unknown>;
    expect(r.global).toBeDefined();
    expect(r.sona).toBeDefined();
    expect(r.memoryBridge).toBeDefined();
    expect(r.neuralPatterns).toBeDefined();
    expect(r.consistency).toBeDefined();
  });
});
