/**
 * #4426: daa_agent_adapt used `(input.performanceScore as number) || 0.8`, so a
 * failing score of 0, and a missing score, were averaged into successRate and
 * sent to AgentDB as a 0.8 success. Out-of-range scores were accepted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { bridgeRecordFeedback } = vi.hoisted(() => ({ bridgeRecordFeedback: vi.fn(async () => undefined) }));
vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeRecordFeedback }));

const originalProjectCwd = process.env.CLAUDE_FLOW_CWD;

async function tools() {
  const { daaTools } = await import('../src/mcp-tools/daa-tools.js');
  const get = (name: string) => daaTools.find((t) => t.name === name)!;
  return {
    create: (id: string) => get('daa_agent_create').handler({ id }) as Promise<Record<string, any>>,
    adapt: (input: Record<string, unknown>) => get('daa_agent_adapt').handler(input) as Promise<Record<string, any>>,
  };
}

beforeEach(() => {
  process.env.CLAUDE_FLOW_CWD = mkdtempSync(join(tmpdir(), 'ruflo-4426-'));
  bridgeRecordFeedback.mockClear();
});
afterEach(() => {
  if (originalProjectCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
  else process.env.CLAUDE_FLOW_CWD = originalProjectCwd;
});

describe('daa_agent_adapt performanceScore (#4426)', () => {
  it('records a score of 0 as a failure, not a 0.8 success', async () => {
    const t = await tools();
    await t.create('a0');
    const r = await t.adapt({ agentId: 'a0', performanceScore: 0 });
    // Baseline: performanceScore 0.8, newSuccessRate 0.9, feedback { success: true, quality: 0.8 }.
    expect(r.success).toBe(true);
    expect(r.adaptation).toMatchObject({ performanceScore: 0, newSuccessRate: 0.5 });
    expect(bridgeRecordFeedback).toHaveBeenCalledWith(expect.objectContaining({ success: false, quality: 0 }));
  });

  it('records no score and no outcome when performanceScore is omitted', async () => {
    const t = await tools();
    await t.create('a1');
    const r = await t.adapt({ agentId: 'a1', feedback: 'tighter prompts' });
    expect(r.success).toBe(true);
    expect(r.adaptation).toMatchObject({ performanceScore: null, adaptations: 1, newSuccessRate: 1 });
    expect(bridgeRecordFeedback).not.toHaveBeenCalled();
  });

  it.each([5, -1, Number.NaN, '0.9'])('rejects out-of-range or non-numeric score %s without changing the agent', async (score) => {
    const t = await tools();
    await t.create('a2');
    const r = await t.adapt({ agentId: 'a2', performanceScore: score });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/between 0 and 1/);
    const ok = await t.adapt({ agentId: 'a2', performanceScore: 1 });
    expect(ok.adaptation).toMatchObject({ adaptations: 1, newSuccessRate: 1 });
  });

  it('still records a valid score (control)', async () => {
    const t = await tools();
    await t.create('a3');
    const r = await t.adapt({ agentId: 'a3', performanceScore: 0.6 });
    expect(r.adaptation).toMatchObject({ performanceScore: 0.6, newSuccessRate: 0.8 });
    expect(bridgeRecordFeedback).toHaveBeenCalledWith(expect.objectContaining({ success: true, quality: 0.6 }));
  });
});
