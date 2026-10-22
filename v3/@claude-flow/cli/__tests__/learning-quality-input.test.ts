import { beforeEach, describe, expect, it, vi } from 'vitest';
const feedback = vi.fn(async () => ({ success: true, controller: 'test', updated: 1 }));
const edge = vi.fn();
vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeRecordFeedback: feedback, bridgeRecordCausalEdge: edge, bridgeStoreEntry: vi.fn() }));
vi.mock('../src/memory/intelligence.js', () => ({ recordTrajectory: vi.fn(async () => false) }));
vi.mock('../src/memory/graph-edge-writer.js', () => ({ insertGraphEdge: edge }));
vi.mock('../src/memory/memory-initializer.js', () => ({ storeEntry: vi.fn(async () => ({ success: true, id: 'pending' })) }));
vi.mock('../src/ruvector/trajectory-tree.js', () => ({ getTrajectoryTree: () => ({ openTrajectory() {}, appendStep() {} }) }));
const { hooksPostTask, hooksTrajectoryStart, hooksTrajectoryStep } = await import('../src/mcp-tools/hooks-tools.js');
beforeEach(() => { feedback.mockClear(); edge.mockClear(); });

describe('learning quality input', () => {
  it('preserves explicit zero task quality in feedback and causal writes', async () => {
    await hooksPostTask.handler({ taskId: 'quality-zero', quality: 0 });
    expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ quality: 0 }));
    expect(edge).toHaveBeenCalledWith(expect.objectContaining({ weight: 0 }));
  });
  it('preserves zero quality in recorded trajectory steps', async () => {
    const start = await hooksTrajectoryStart.handler({ task: 'quality zero' }) as any;
    expect(await hooksTrajectoryStep.handler({ trajectoryId: start.trajectoryId, action: 'failed step', quality: 0 })).toMatchObject({ recorded: true, quality: 0 });
  });
  for (const quality of [-1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, '0.5', null]) {
    it(`rejects invalid quality ${String(quality)} before writes`, async () => {
      expect(await hooksPostTask.handler({ taskId: 'invalid-quality', quality })).toMatchObject({ success: false, error: expect.any(String) });
      expect(await hooksTrajectoryStep.handler({ trajectoryId: 'trajectory', action: 'step', quality })).toMatchObject({ success: false, error: expect.any(String) });
      expect(feedback).not.toHaveBeenCalled();
      expect(edge).not.toHaveBeenCalled();
    });
  }
  it.each([[true, 0.85], [false, 0.3]])('retains the omitted-quality default for success=%s', async (success, quality) => {
    await hooksPostTask.handler({ taskId: 'default-quality', success });
    expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ quality }));
  });
});
