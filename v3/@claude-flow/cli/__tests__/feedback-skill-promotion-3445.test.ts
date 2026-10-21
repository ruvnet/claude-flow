import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/memory/intelligence.js', () => ({ recordTrajectory: vi.fn(async () => false) }));
import { __setMemoryBridgeRegistryForTests, bridgeRecordFeedback } from '../src/memory/memory-bridge.js';

const createSkill = vi.fn(async () => 1);
beforeEach(() => {
  createSkill.mockClear();
  __setMemoryBridgeRegistryForTests({ getAgentDB: () => null, get: (name: string) => name === 'skills' ? { createSkill } : null });
});
afterEach(() => __setMemoryBridgeRegistryForTests(null));
const feedback = { taskId: 'task-3445', success: true, quality: 0.95, agent: 'coder', patterns: ['Validate input before storing it'] };

describe('feedback skill promotion (#3445)', () => {
  it('creates a SkillLibrary skill with the observed reward and full pattern', async () => {
    const result = await bridgeRecordFeedback(feedback);
    expect(createSkill).toHaveBeenCalledWith(expect.objectContaining({
      description: feedback.patterns[0], successRate: 1, avgReward: 0.95,
      metadata: expect.objectContaining({ taskId: feedback.taskId, agent: 'coder' }),
    }));
    expect(result?.controller).toContain('skills');
    expect(result?.updated).toBe(1);
  });
  it.each([{ success: false, quality: 0.95 }, { success: true, quality: 0.89 }])('does not promote ineligible outcomes %j', async (outcome) => {
    await bridgeRecordFeedback({ ...feedback, ...outcome });
    expect(createSkill).not.toHaveBeenCalled();
  });
  it('does not claim skill updates when the controller rejects a write', async () => {
    createSkill.mockRejectedValueOnce(new Error('write failed'));
    const result = await bridgeRecordFeedback(feedback);
    expect(createSkill).toHaveBeenCalledOnce();
    expect(result?.controller).not.toContain('skills');
    expect(result?.updated).toBe(0);
  });
});
