import { describe, expect, it, vi } from 'vitest';
const feedback = vi.fn(async () => ({ success: true, controller: 'test', updated: 1 }));
vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeRecordFeedback: feedback, bridgeRecordCausalEdge: vi.fn(), bridgeStoreEntry: vi.fn() }));
vi.mock('../src/memory/intelligence.js', () => ({ recordTrajectory: vi.fn(async () => false) }));
vi.mock('../src/memory/graph-edge-writer.js', () => ({ insertGraphEdge: vi.fn() }));
const { hooksPostTask } = await import('../src/mcp-tools/hooks-tools.js');
const { agentdbFeedback } = await import('../src/mcp-tools/agentdb-tools.js');

describe('feedback pattern inputs (#3445)', () => {
  for (const tool of [hooksPostTask, agentdbFeedback]) {
    it(`${tool.name} advertises and forwards learned patterns`, async () => {
      expect(tool.inputSchema.properties?.patterns).toMatchObject({ type: 'array', items: { type: 'string' } });
      feedback.mockClear();
      await tool.handler({ taskId: 'task-3445', success: true, quality: 0.95, patterns: ['validate first'] });
      expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ patterns: ['validate first'] }));
    });
    it.each([{ patterns: 'bad' }, { patterns: [42] }, { patterns: [' '] }, { patterns: ['x'.repeat(10001)] }])(`${tool.name} rejects malformed patterns before feedback`, async ({ patterns }) => {
      feedback.mockClear();
      expect(await tool.handler({ taskId: 'task-3445', patterns })).toMatchObject({ success: false });
      expect(feedback).not.toHaveBeenCalled();
    });
  }
});
