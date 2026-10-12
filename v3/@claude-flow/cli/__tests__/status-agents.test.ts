import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { callMCPTool, MCPClientError } from '../src/mcp-client.js';
import { output } from '../src/output.js';
import { statusCommand } from '../src/commands/status.js';

// Keep the real agent_list handler and file stores; bypass unrelated MCP tools.
vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(),
  MCPClientError: class MCPClientError extends Error {},
}));

const action = statusCommand.subcommands!.find(command => command.name === 'agents')!.action!;
const listAgents = agentTools.find(tool => tool.name === 'agent_list')!;
const agent = (agentId: string, status = 'idle') => ({
  agentId, agentType: 'coder', status, health: 0.85, taskCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z', config: {},
});

describe('status agents with the persisted agent registry', () => {
  let dir: string;
  const run = (format = 'text') => action({
    args: [], flags: { _: [], format }, cwd: dir, interactive: false,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-status-agents-'));
    vi.stubEnv('CLAUDE_FLOW_CWD', dir);
    mkdirSync(join(dir, '.claude-flow', 'agents'), { recursive: true });
    writeFileSync(join(dir, '.claude-flow', 'agents', 'store.json'), JSON.stringify({
      version: '3.0.0', agents: {
        idle: agent('idle-coder'), busy: agent('busy-coder', 'busy'),
        ended: agent('ended-coder', 'terminated'),
      },
    }));
    writeFileSync(join(dir, '.claude-flow', 'agents.json'), JSON.stringify({
      agents: { hive: { ...agent('hive-reviewer'), agentType: 'reviewer' } },
    }));
    vi.mocked(callMCPTool).mockImplementation(async (name, input) => {
      if (name !== 'agent_list') throw new Error(`Unexpected tool: ${name}`);
      return listAgents.handler(input ?? {});
    });
    vi.spyOn(output, 'writeln').mockImplementation(() => {});
    vi.spyOn(output, 'printTable').mockImplementation(() => {});
    vi.spyOn(output, 'printJson').mockImplementation(() => {});
    vi.spyOn(output, 'printInfo').mockImplementation(() => {});
    vi.spyOn(output, 'printError').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists idle, busy and hive agents in JSON, excluding terminated agents', async () => {
    const expected = await listAgents.handler({});
    expect(expected).toMatchObject({ total: 3 });
    expect(await run('json')).toEqual({ success: true, data: expected });
    expect(output.printJson).toHaveBeenCalledWith(expected);
  });

  it('renders IDs, types and recorded counts without requiring unavailable metrics', async () => {
    expect(await run()).toMatchObject({ success: true });
    expect(output.printTable).toHaveBeenCalledOnce();
    const table = vi.mocked(output.printTable).mock.calls[0][0];
    expect(table.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'idle-coder', type: 'coder', tasks: 3, health: 0.85 }),
      expect.objectContaining({ id: 'busy-coder', type: 'coder', status: expect.stringContaining('busy') }),
      expect.objectContaining({ id: 'hive-reviewer', type: 'reviewer' }),
    ]));
    expect(table.data).toHaveLength(3);
    expect(output.printError).not.toHaveBeenCalled();
  });

  it('reports an empty registry without a table', async () => {
    rmSync(join(dir, '.claude-flow'), { recursive: true });
    expect(await run()).toMatchObject({ success: true, data: { agents: [], total: 0 } });
    expect(output.printInfo).toHaveBeenCalledWith('No agents registered');
    expect(output.printTable).not.toHaveBeenCalled();
  });

  it('reports tool failures instead of claiming an empty registry', async () => {
    vi.mocked(callMCPTool).mockRejectedValueOnce(new MCPClientError('unavailable', 'agent_list'));
    expect(await run()).toEqual({ success: false, exitCode: 1 });
    expect(output.printError).toHaveBeenCalledWith('Failed to get agent status: unavailable');
    expect(output.printInfo).not.toHaveBeenCalled();
  });
});
