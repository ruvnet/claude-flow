/**
 * `status tasks` sends `status: 'all'` to task_list, which treated it as a
 * literal status, filtered every task out and printed "No tasks". It also
 * read `id` / `agent`, while task_list returns `taskId` / `assignedTo`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskTools } from '../src/mcp-tools/task-tools.js';
import { statusCommand } from '../src/commands/status.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

const tool = (name: string) => {
  const t = taskTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

const tasksCommand = statusCommand.subcommands!.find(c => c.name === 'tasks')!;

describe('status tasks', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let pending: string;
  let done: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-status-tasks-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;

    const create = tool('task_create').handler;
    pending = (await create({ type: 'feature', description: 'still open' }) as { taskId: string }).taskId;
    done = (await create({ type: 'bugfix', description: 'finished' }) as { taskId: string }).taskId;
    await tool('task_complete').handler({ taskId: done });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it("task_list treats status 'all' as no status filter", async () => {
    const result = await tool('task_list').handler({ status: 'all' }) as { tasks: Array<{ taskId: string }> };
    expect(result.tasks.map(t => t.taskId).sort()).toEqual([pending, done].sort());
  });

  it('task_list still filters by a real status', async () => {
    const result = await tool('task_list').handler({ status: 'completed' }) as { tasks: Array<{ taskId: string }> };
    expect(result.tasks.map(t => t.taskId)).toEqual([done]);
  });

  it('status tasks lists every task', async () => {
    const ctx = { args: [], flags: { format: 'json' }, cwd: dir, interactive: false } as unknown as CommandContext;
    const result = await tasksCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const tasks = (result!.data as { tasks: Array<{ taskId: string }> }).tasks;
    expect(tasks.map(t => t.taskId).sort()).toEqual([pending, done].sort());
  });

  it('status tasks shows the task id and assigned agents in the table', async () => {
    await tool('task_assign').handler({ taskId: pending, agentIds: ['agent-a', 'agent-b'] });
    const printTable = vi.spyOn(output, 'printTable').mockImplementation(() => {});
    vi.spyOn(output, 'writeln').mockImplementation(() => {});
    const ctx = { args: [], flags: {}, cwd: dir, interactive: false } as unknown as CommandContext;
    const result = await tasksCommand.action!(ctx);
    expect(result?.success).toBe(true);
    const rows = printTable.mock.calls[0][0].data as Array<{ id: string; agent: string }>;
    const row = rows.find(r => r.id === pending);
    expect(row?.agent).toBe('agent-a, agent-b');
    expect(rows.map(r => r.id).sort()).toEqual([pending, done].sort());
  });
});
