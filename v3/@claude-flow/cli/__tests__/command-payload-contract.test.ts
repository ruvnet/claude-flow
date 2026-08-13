/**
 * Command ↔ tool payload contract regressions.
 *
 * `callMCPTool` resolves for a refused operation — "session not found",
 * "workflow not found", an assignment to an agent that does not exist — and
 * reports it in the payload. Commands that treat every resolved call as a
 * success either print `[OK]` for work that never happened or die on a field
 * the refusal payload does not carry. Each test here pins one such command to
 * the shape its tool actually returns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command, CommandContext } from '../src/types.js';
import { CommandParser } from '../src/parser.js';
import { taskTools } from '../src/mcp-tools/task-tools.js';
import { statusCommand } from '../src/commands/status.js';
import { sessionCommand } from '../src/commands/session.js';
import { taskCommand } from '../src/commands/task.js';
import { workflowCommand } from '../src/commands/workflow.js';
import { callMCPTool } from '../src/mcp-client.js';

vi.mock('../src/mcp-client.js', () => ({
  callMCPTool: vi.fn(),
  MCPClientError: class MCPClientError extends Error {},
}));

const mockCall = vi.mocked(callMCPTool);

function ctx(args: string[] = [], flags: Record<string, unknown> = {}): CommandContext {
  return {
    args,
    flags: { _: [], ...flags },
    cwd: '/test',
    interactive: false,
  } as CommandContext;
}

function sub(command: Command, name: string): Command {
  const found = command.subcommands?.find(c => c.name === name);
  if (!found) throw new Error(`subcommand not found: ${command.name} ${name}`);
  return found;
}

beforeEach(() => {
  mockCall.mockReset();
});

describe('option validation across command layers', () => {
  it('validates --format against the subcommand definition, not the global one', () => {
    const parser = new CommandParser();
    // `process monitor` narrows --format to its own renderers; the global
    // option offers text/json/table. Validating both made the subcommand's
    // own default unusable ("Invalid value for --format: dashboard").
    const monitor: Command = {
      name: 'monitor',
      description: 'test',
      options: [
        { name: 'format', description: 'Output format', type: 'string', default: 'dashboard', choices: ['dashboard', 'compact', 'json'] },
      ],
      action: async () => ({ success: true }),
    };

    expect(parser.validateFlags({ _: [], format: 'dashboard' }, monitor)).toEqual([]);
    expect(parser.validateFlags({ _: [], format: 'compact' }, monitor)).toEqual([]);

    const rejected = parser.validateFlags({ _: [], format: 'bogus' }, monitor);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toContain('dashboard, compact, json');
  });

  it('still validates a global option no command redefines', () => {
    const parser = new CommandParser();
    const plain: Command = { name: 'plain', description: 'test', action: async () => ({ success: true }) };
    expect(parser.validateFlags({ _: [], format: 'table' }, plain)).toEqual([]);
    expect(parser.validateFlags({ _: [], format: 'dashboard' }, plain)).toHaveLength(1);
  });
});

describe('task_assign agent existence', () => {
  let dir: string;
  let previousCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cf-task-assign-'));
    previousCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    mkdirSync(join(dir, '.claude-flow', 'tasks'), { recursive: true });
    mkdirSync(join(dir, '.claude-flow', 'agents'), { recursive: true });
    writeFileSync(
      join(dir, '.claude-flow', 'tasks', 'store.json'),
      JSON.stringify({
        version: '3.0.0',
        tasks: {
          'task-1': {
            taskId: 'task-1', type: 'research', description: 'x', priority: 'normal',
            status: 'pending', progress: 0, assignedTo: [], tags: [],
            createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
          },
        },
      }),
    );
    writeFileSync(
      join(dir, '.claude-flow', 'agents', 'store.json'),
      JSON.stringify({ version: '3.0.0', agents: { 'agent-real': { agentId: 'agent-real', status: 'idle' } } }),
    );
  });

  afterEach(() => {
    if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = previousCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  const assign = () => {
    const tool = taskTools.find(t => t.name === 'task_assign');
    if (!tool) throw new Error('task_assign tool missing');
    return tool;
  };

  it('refuses an agent id that matches no agent and leaves the task untouched', async () => {
    const result = await assign().handler({ taskId: 'task-1', agentIds: ['ghost'] }) as Record<string, unknown>;

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('ghost');

    const after = await assign().handler({ taskId: 'task-1', agentIds: ['agent-real'] }) as Record<string, unknown>;
    // The refused call must not have assigned, nor moved the task to in_progress.
    expect(after.previouslyAssigned).toEqual([]);
  });

  it('assigns an agent that exists', async () => {
    const result = await assign().handler({ taskId: 'task-1', agentIds: ['agent-real'] }) as Record<string, unknown>;
    expect(result.assignedTo).toEqual(['agent-real']);
    expect(result.status).toBe('in_progress');
  });

  it('accepts a hive-mind worker, which lives in a different store', async () => {
    writeFileSync(
      join(dir, '.claude-flow', 'agents.json'),
      JSON.stringify({ agents: { 'worker-hive': { agentId: 'worker-hive', status: 'active' } } }),
    );
    const result = await assign().handler({ taskId: 'task-1', agentIds: ['worker-hive'] }) as Record<string, unknown>;
    expect(result.assignedTo).toEqual(['worker-hive']);
  });
});

describe('refusal payloads are reported as failures', () => {
  it('session restore: "not found" exits non-zero instead of crashing on stats', async () => {
    mockCall.mockResolvedValue({ sessionId: 'session-trunc', restored: false, error: 'Session not found' });

    const result = await sub(sessionCommand, 'restore').action!(ctx(['session-trunc'], { force: true }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('session restore: a real snapshot renders its saved counts', async () => {
    mockCall.mockResolvedValue({
      sessionId: 'session-1', restored: true, restoredAt: new Date().toISOString(),
      stats: { tasks: 3, agents: 1, memoryEntries: 7, totalSize: 100 },
    });

    const result = await sub(sessionCommand, 'restore').action!(ctx(['session-1'], { force: true }));

    expect(result.success).toBe(true);
  });

  it('session delete: a no-op delete is not reported as deleted', async () => {
    mockCall.mockResolvedValue({ sessionId: 'session-trunc', deleted: false, error: 'Session not found' });

    const result = await sub(sessionCommand, 'delete').action!(ctx(['session-trunc'], { force: true }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('task assign: a refused assignment exits non-zero', async () => {
    mockCall.mockResolvedValue({ taskId: 'task-1', success: false, error: 'Unknown agent: ghost' });

    const result = await sub(taskCommand, 'assign').action!(ctx(['task-1'], { agent: 'ghost' }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('workflow status: an unknown workflow exits non-zero', async () => {
    mockCall.mockResolvedValue({ workflowId: 'wf-nope', error: 'Workflow not found' });

    const result = await sub(workflowCommand, 'status').action!(ctx(['wf-nope']));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe('commands read the fields their tools emit', () => {
  it('status memory survives a stats payload without v3Gains', async () => {
    mockCall.mockResolvedValue({
      backend: 'sql.js', entries: 5, size: 1024, namespaces: [],
      performance: { avgSearchTime: 0, avgWriteTime: 0, cacheHitRate: 0, hnswEnabled: true },
    });

    const result = await sub(statusCommand, 'memory').action!(ctx());

    expect(result.success).toBe(true);
  });

  it('workflow status reads workflowId/steps, not id/metrics', async () => {
    mockCall.mockResolvedValue({
      workflowId: 'wf-1', name: 'demo', status: 'ready', progress: 0,
      totalSteps: 1, completedSteps: 0, createdAt: new Date().toISOString(),
      startedAt: null, completedAt: null,
      steps: [{ stepId: 's1', name: 's1', type: 'task', status: 'pending' }],
    });

    const result = await sub(workflowCommand, 'status').action!(ctx(['wf-1']));

    expect(result.success).toBe(true);
  });

  it('workflow list asks for every workflow instead of status "all"', async () => {
    mockCall.mockResolvedValue({ workflows: [], total: 0 });

    await sub(workflowCommand, 'list').action!(ctx([], { limit: 10 }));

    const input = mockCall.mock.calls[0][1] as Record<string, unknown>;
    expect(input.status).toBeUndefined();
  });

  it('task list --all sends no status filter, and --agent filters by assignedTo', async () => {
    mockCall.mockResolvedValue({ tasks: [], total: 0 });

    await sub(taskCommand, 'list').action!(ctx([], { all: true, limit: 20, agent: 'agent-real' }));

    const input = mockCall.mock.calls[0][1] as Record<string, unknown>;
    expect(input.status).toBeUndefined();
    expect(input.assignedTo).toBe('agent-real');
  });

  it('task list renders the taskId the tool returns', async () => {
    mockCall.mockResolvedValue({
      tasks: [{ taskId: 'task-42', type: 'research', description: 'x', priority: 'normal', status: 'pending', progress: 0, createdAt: '' }],
      total: 1,
    });

    const result = await sub(taskCommand, 'list').action!(ctx([], { limit: 20 })) as { data?: { tasks: Array<{ taskId: string }> } };

    expect(result.data?.tasks[0].taskId).toBe('task-42');
  });
});
