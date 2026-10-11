// Regression test for #3662 (stepful part): `hooksTrajectoryEnd` only
// promoted non-empty `feedback` to the searchable `pattern` namespace when
// the trajectory had NO recorded steps (`#2351`'s `!hasSteps` gate). The
// common start -> step -> end path (the one real agents actually use)
// therefore recorded SONA state but left the feedback unindexed and
// unreachable through `hooks_intelligence_pattern-search`.
//
// This test drives the full public path end to end: trajectory-start,
// trajectory-step (so `hasSteps` is true), trajectory-end with feedback,
// then pattern-search for that feedback text. It fails on the pre-fix
// `!hasSteps` gate and passes once feedback is promoted regardless of
// whether steps were recorded.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A tiny in-memory store standing in for the real memory-initializer. It is
// deliberately simple (substring match) — just enough to prove the pattern
// namespace entry written by trajectory-end is the same one pattern-search
// reads back, mirroring what the real HNSW/SQLite search does semantically.
const durable = new Map<string, { value: string; namespace: string }>();

const storeEntry = vi.fn(async ({ key, value, namespace }: { key: string; value: string; namespace?: string }) => {
  durable.set(key, { value, namespace: namespace ?? 'default' });
  return { success: true, id: key };
});
const getEntry = vi.fn(async ({ key }: { key: string }) => ({
  success: true,
  found: durable.has(key),
  entry: { content: durable.get(key)?.value },
}));
const deleteEntry = vi.fn(async ({ key }: { key: string }) => ({ success: true, deleted: durable.delete(key) }));
const searchEntries = vi.fn(async ({ query, namespace }: { query: string; namespace?: string }) => {
  const results = Array.from(durable.entries())
    .filter(([, entry]) => (namespace ? entry.namespace === namespace : true))
    .filter(([, entry]) => entry.value.toLowerCase().includes(query.toLowerCase()))
    .map(([key, entry]) => ({
      id: key,
      key,
      content: entry.value,
      score: 0.9,
      namespace: entry.namespace,
    }));
  return { success: results.length > 0, results, searchTime: 0 };
});

vi.mock('../src/memory/memory-initializer.js', () => ({ storeEntry, getEntry, deleteEntry, searchEntries }));
// Force both the trajectory-end feedback promotion and pattern-search to
// fall through to the memory-initializer fallback above instead of a real
// ReasoningBank/AgentDB bridge, which isn't available under test.
vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeStorePattern: async () => null,
  bridgeSearchPatterns: async () => null,
}));
vi.mock('../src/memory/sona-optimizer.js', () => ({ getSONAOptimizer: async () => null }));
vi.mock('../src/memory/ewc-consolidation.js', () => ({ getEWCConsolidator: async () => null }));
vi.mock('../src/memory/intelligence.js', () => ({
  runBackgroundLearning: async () => {},
  getIntelligenceStats: () => ({ trajectoriesRecorded: 0 }),
  recordTrajectory: async () => {},
}));
vi.mock('../src/memory/graph-edge-writer.js', () => ({ insertGraphEdge: async () => {} }));
vi.mock('../src/ruvector/trajectory-tree.js', () => ({
  getTrajectoryTree: () => ({ openTrajectory() {}, appendStep() {}, closeTrajectory() {} }),
}));

const fresh = async () => { vi.resetModules(); return import('../src/mcp-tools/hooks-tools.js'); };

beforeEach(() => {
  durable.clear();
  storeEntry.mockClear();
  getEntry.mockClear();
  deleteEntry.mockClear();
  searchEntries.mockClear();
});

describe('stepful trajectory feedback indexing (#3662)', () => {
  it('promotes feedback to the pattern namespace even when steps were recorded, and it becomes searchable', async () => {
    const hooks = await fresh();

    const started = await hooks.hooksTrajectoryStart.handler({ task: 'ship the release notes', agent: 'coder' }) as any;

    // Record a step so `hasSteps` is true — this is the common path real
    // agents take, and the one #2351 did NOT cover.
    const stepResult = await hooks.hooksTrajectoryStep.handler({
      trajectoryId: started.trajectoryId,
      action: 'drafted notes',
      result: 'reviewed by lead',
    }) as any;
    expect(stepResult.recorded).toBe(true);
    expect(stepResult.totalSteps).toBe(1);

    const distilledFeedback = 'always double check the changelog version bump before tagging a release';
    const ended = await hooks.hooksTrajectoryEnd.handler({
      trajectoryId: started.trajectoryId,
      success: true,
      feedback: distilledFeedback,
    }) as any;

    // The trajectory had steps, so the pre-fix `!hasSteps` gate dropped the
    // feedback entirely: `feedbackDistilled` stayed undefined and
    // `patternsExtracted` only counted the one recorded step.
    expect(ended.trajectory.totalSteps).toBe(1);
    expect(ended.learning.feedbackDistilled).toBeDefined();
    expect(ended.learning.feedbackDistilled?.stored).not.toBe(false);
    expect(ended.learning.patternsExtracted).toBe(2); // 1 step + 1 distilled feedback pattern

    // The feedback must now be indexed in the 'pattern' namespace and
    // reachable through hooks_intelligence_pattern-search, the same way
    // step-less feedback already was after #2351.
    const search = await hooks.hooksPatternSearch.handler({ query: distilledFeedback }) as any;
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results.some((r: any) => String(r.pattern).includes(distilledFeedback))).toBe(true);
  });
});
