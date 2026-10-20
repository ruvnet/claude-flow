/**
 * `agent list --all` and `agent list --type <t>`.
 *
 * --all sent `status: 'all'`, which agent_list treats as a literal status, so
 * it filtered every agent out and printed "No agents found". --type sent
 * `agentType`, which agent_list never read, so it listed every type.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { agentCommand } from '../src/commands/agent.js';
import type { CommandContext } from '../src/types.js';

const tool = (name: string) => {
  const t = agentTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

const listCommand = agentCommand.subcommands!.find(c => c.name === 'list')!;

async function runList(flags: Record<string, unknown>): Promise<Array<{ agentId: string; agentType: string; status: string }>> {
  const ctx = { args: [], flags: { format: 'json', ...flags }, cwd: process.cwd(), interactive: false } as unknown as CommandContext;
  const result = await listCommand.action!(ctx);
  expect(result?.success).toBe(true);
  return (result!.data as { agents: Array<{ agentId: string; agentType: string; status: string }> }).agents;
}

describe('agent list filters', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let coder: string;
  let tester: string;
  let stopped: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-agent-list-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;

    const spawn = tool('agent_spawn').handler;
    coder = (await spawn({ agentType: 'coder' }) as { agentId: string }).agentId;
    tester = (await spawn({ agentType: 'tester' }) as { agentId: string }).agentId;
    stopped = (await spawn({ agentType: 'coder' }) as { agentId: string }).agentId;
    await tool('agent_terminate').handler({ agentId: stopped });
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('agent_list filters by agentType', async () => {
    const result = await tool('agent_list').handler({ agentType: 'tester' }) as { agents: Array<{ agentId: string }> };
    expect(result.agents.map(a => a.agentId)).toEqual([tester]);
  });

  it('agent list without flags hides terminated agents', async () => {
    const ids = (await runList({})).map(a => a.agentId).sort();
    expect(ids).toEqual([coder, tester].sort());
  });

  it('agent list --all includes terminated agents', async () => {
    const ids = (await runList({ all: true })).map(a => a.agentId).sort();
    expect(ids).toEqual([coder, tester, stopped].sort());
  });

  it('agent list --type only lists that type', async () => {
    const agents = await runList({ type: 'coder' });
    expect(agents.map(a => a.agentId)).toEqual([coder]);
    const all = await runList({ type: 'coder', all: true });
    expect(all.map(a => a.agentId).sort()).toEqual([coder, stopped].sort());
  });
});
