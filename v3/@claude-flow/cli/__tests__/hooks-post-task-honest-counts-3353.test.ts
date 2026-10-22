/**
 * #3353 — hooks_post-task must report observed learning counts, not
 * success-derived placeholders.
 *
 * Before: `patternsUpdated: feedbackResult?.updated || (success ? 2 : 1)`,
 * `newPatterns: success ? 1 : 0`, `trajectoryId: traj-${Date.now()}` — so a
 * run whose feedback controller was unavailable still claimed "2 patterns
 * updated, 1 new pattern", and an observed `updated: 0` was turned into 2 by
 * the `||` fallback. The direct trajectory result was awaited and discarded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Feedback = { success: boolean; controller: string; updated: number } | null;

const bridgeRecordFeedback = vi.fn(async (): Promise<Feedback> => null);
const recordTrajectory = vi.fn(async (): Promise<boolean> => true);

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeRecordFeedback,
  bridgeRecordCausalEdge: vi.fn(async () => ({ success: true, controller: 'mock' })),
  bridgeStoreEntry: vi.fn(async () => ({ success: true, controller: 'mock' })),
}));
vi.mock('../src/memory/intelligence.js', () => ({ recordTrajectory }));
vi.mock('../src/memory/graph-edge-writer.js', () => ({ insertGraphEdge: vi.fn(async () => undefined) }));

const { hooksPostTask } = await import('../src/mcp-tools/hooks-tools.js');

type PostTaskResult = {
  success: boolean;
  learningUpdates: {
    patternsUpdated: number;
    newPatterns: number | null;
    trajectoryId: string | null;
    controller: string;
    outcomePersisted: boolean;
    available: boolean;
    reason?: string;
  };
  trajectory: { recorded: boolean };
  feedback: { recorded: boolean; controller: string; updates: number };
};

const run = (success = true) =>
  hooksPostTask.handler({ taskId: 'post-task-3353', success, quality: 0.9 }) as Promise<PostTaskResult>;

beforeEach(() => {
  bridgeRecordFeedback.mockReset();
  recordTrajectory.mockReset();
});

describe('#3353 hooks_post-task reports observed learning counts', () => {
  it('feedback controller unavailable (null) + trajectory recorded: no fabricated counts', async () => {
    bridgeRecordFeedback.mockResolvedValue(null);
    recordTrajectory.mockResolvedValue(true);

    const r = await run(true);

    expect(r.success).toBe(true); // task outcome is still reported
    expect(r.learningUpdates.patternsUpdated).toBe(0);
    expect(r.learningUpdates.newPatterns).toBeNull();
    expect(r.learningUpdates.available).toBe(false);
    expect(r.learningUpdates.reason).toMatch(/feedback/i);
    expect(r.learningUpdates.controller).toBe('none');
    expect(r.trajectory.recorded).toBe(true);
    expect(r.feedback).toEqual({ recorded: false, controller: 'unavailable', updates: 0 });
  });

  it('observed updated:0 is not replaced by a || fallback', async () => {
    bridgeRecordFeedback.mockResolvedValue({ success: false, controller: 'learningSystem', updated: 0 });
    recordTrajectory.mockResolvedValue(true);

    const r = await run(true);

    expect(r.learningUpdates.patternsUpdated).toBe(0);
    expect(r.learningUpdates.newPatterns).toBeNull();
    expect(r.learningUpdates.available).toBe(false);
  });

  it('both learning paths fail: degraded, no counts, no trajectory id', async () => {
    bridgeRecordFeedback.mockRejectedValue(new Error('bridge down'));
    recordTrajectory.mockResolvedValue(false);

    const r = await run(false);

    expect(r.learningUpdates.patternsUpdated).toBe(0);
    expect(r.learningUpdates.newPatterns).toBeNull();
    expect(r.learningUpdates.trajectoryId).toBeNull();
    expect(r.learningUpdates.available).toBe(false);
    expect(r.trajectory.recorded).toBe(false);
  });

  it('a working controller reports its own observed count', async () => {
    bridgeRecordFeedback.mockResolvedValue({ success: true, controller: 'learningSystem', updated: 3 });
    recordTrajectory.mockResolvedValue(true);

    const r = await run(true);

    expect(r.learningUpdates.patternsUpdated).toBe(3);
    expect(r.learningUpdates.controller).toBe('learningSystem');
    expect(r.learningUpdates.available).toBe(true);
    expect(r.learningUpdates.reason).toBeUndefined();
    expect(r.feedback).toEqual({ recorded: true, controller: 'learningSystem', updates: 3 });
  });
});
