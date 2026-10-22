/**
 * Two CLI error paths that reported nonsense instead of an error:
 * - `agent status <unknown>` / `task status <unknown>`: the MCP tool answers
 *   { status: 'not_found' }, which was rendered as "Agent: undefined",
 *   "Invalid Date", "undefined%" and exited 0.
 * - A value-taking option with no value (`hooks route --task`) parsed as boolean
 *   `true`, and commands then crashed on it ("task.trim is not a function").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(async (tool: string, input: Record<string, unknown>) => {
    if (tool === 'agent_status') return { agentId: input.agentId, status: 'not_found' };
    if (tool === 'task_status') return { taskId: input.taskId, status: 'not_found' };
    throw new Error(`unexpected tool ${tool}`);
  }),
  MCPClientError: class extends Error {},
}));

import { agentCommand } from '../src/commands/agent.js';
import { taskCommand } from '../src/commands/task.js';
import { CommandParser } from '../src/parser.js';
import type { Command, CommandContext } from '../src/types.js';

const ctxFor = (id: string): CommandContext =>
  ({ args: [id], flags: { _: [] }, cwd: '/test', interactive: false }) as unknown as CommandContext;

describe('status of an unknown id', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('agent status reports not found and exits 1', async () => {
    const status = agentCommand.subcommands!.find((c) => c.name === 'status')!;
    const result = await status.action!(ctxFor('doesnotexist'));
    expect(result).toMatchObject({ success: false, exitCode: 1 });
  });

  it('task status reports not found and exits 1', async () => {
    const status = taskCommand.subcommands!.find((c) => c.name === 'status')!;
    const result = await status.action!(ctxFor('nope'));
    expect(result).toMatchObject({ success: false, exitCode: 1 });
  });
});

describe('value-taking option given without a value', () => {
  const cmd: Command = {
    name: 'route', description: 'r',
    options: [
      { name: 'task', short: 't', type: 'string', description: 'Task' },
      { name: 'top', type: 'number', description: 'Top K' },
      { name: 'explore', type: 'boolean', description: 'Explore' },
    ],
  };
  const parser = new CommandParser({ allowUnknownFlags: true });
  parser.registerCommand(cmd);

  it.each([[['route', '--task']], [['route', '-t']], [['route', '--task', '--explore']], [['route', '--top']]])(
    'rejects %j with a clear message',
    (argv) => {
      const parsed = parser.parse(argv as string[]);
      const errors = parser.validateFlags(parsed.flags, cmd);
      expect(errors.some((e) => /needs a value/.test(e))).toBe(true);
    },
  );

  it('still accepts real values and bare booleans', () => {
    for (const argv of [['route', '--task', 'fix bug'], ['route', '--task=x', '--explore'], ['route', '--top', '3']]) {
      const parsed = parser.parse(argv);
      expect(parser.validateFlags(parsed.flags, cmd)).toEqual([]);
    }
  });
});
