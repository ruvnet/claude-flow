import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandParser } from '../src/parser.js';
import type { CommandContext } from '../src/types.js';

const mocks = vi.hoisted(() => ({
  callMCPTool: vi.fn(),
}));

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: mocks.callMCPTool,
  MCPClientError: class MCPClientError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'MCPClientError';
    }
  },
}));

vi.mock('../src/output.js', () => ({
  output: {
    bold: (value: string) => value,
    highlight: (value: string) => value,
    printError: vi.fn(),
    printInfo: vi.fn(),
    printJson: vi.fn(),
    printSuccess: vi.fn(),
    printTable: vi.fn(),
    writeln: vi.fn(),
  },
}));

const { hooksCommand } = await import('../src/commands/hooks.js');
const postTaskCommand = hooksCommand.subcommands?.find((command) => command.name === 'post-task');

if (!postTaskCommand) {
  throw new Error('post-task command not found');
}

function context(flags: Record<string, unknown>): CommandContext {
  return {
    args: [],
    flags: { _: [], ...flags },
    cwd: process.cwd(),
    interactive: false,
  };
}

beforeEach(() => {
  mocks.callMCPTool.mockReset();
  mocks.callMCPTool.mockResolvedValue({
    taskId: 'task-2785',
    success: true,
    duration: 10,
    learningUpdates: {
      patternsUpdated: 1,
      newPatterns: 1,
      trajectoryId: 'trajectory-2785',
    },
  });
});

describe('hooks post-task command', () => {
  it('declares the task description option with its published short alias', () => {
    const taskOption = postTaskCommand.options?.find((option) => option.name === 'task');

    expect(taskOption).toEqual(expect.objectContaining({
      name: 'task',
      short: 't',
      type: 'string',
      required: false,
    }));
  });

  it('declares store-results as an optional long-only boolean', () => {
    const storeResultsOption = postTaskCommand.options?.find(
      (option) => option.name === 'store-results',
    );

    expect(storeResultsOption).toEqual(expect.objectContaining({
      name: 'store-results',
      type: 'boolean',
      required: false,
    }));
    expect(storeResultsOption?.short).toBeUndefined();
  });

  it('parses -t and normalizes --store-results for command dispatch', () => {
    const parser = new CommandParser({ allowUnknownFlags: true });
    parser.registerCommand(hooksCommand);

    const parsed = parser.parse([
      'hooks',
      'post-task',
      '-t',
      '  test routing outcome  ',
      '--store-results',
    ]);

    expect(parsed.command).toEqual(['hooks', 'post-task']);
    expect(parsed.flags.task).toBe('  test routing outcome  ');
    expect(parsed.flags.storeResults).toBe(true);
  });

  it('forwards routing flags and lineage to hooks_post-task unchanged', async () => {
    const result = await postTaskCommand.action!(context({
      taskId: 'task-2785',
      task: '  test routing outcome  ',
      storeResults: true,
      success: true,
      agent: 'tester',
      quality: 0.9,
      parentAgentId: 'parent-abc-123',
      depth: 0,
    }));

    expect(result.success).toBe(true);
    expect(mocks.callMCPTool).toHaveBeenCalledTimes(1);
    expect(mocks.callMCPTool).toHaveBeenCalledWith(
      'hooks_post-task',
      expect.objectContaining({
        taskId: 'task-2785',
        task: '  test routing outcome  ',
        storeDecisions: true,
        success: true,
        agent: 'tester',
        quality: 0.9,
        parentAgentId: 'parent-abc-123',
        depth: 0,
        timestamp: expect.any(Number),
      }),
    );
  });

  it('keeps routing and lineage flags optional for existing callers', async () => {
    const result = await postTaskCommand.action!(context({
      taskId: 'task-legacy',
      success: true,
    }));

    expect(result.success).toBe(true);
    expect(mocks.callMCPTool).toHaveBeenCalledWith(
      'hooks_post-task',
      expect.objectContaining({
        taskId: 'task-legacy',
        task: undefined,
        storeDecisions: undefined,
        parentAgentId: undefined,
        depth: undefined,
      }),
    );
  });
});
