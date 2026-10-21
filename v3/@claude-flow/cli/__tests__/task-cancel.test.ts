/**
 * task_cancel overwrote a finished task's result and completedAt, never
 * returned the previous status the CLI prints, and `task cancel` treated the
 * tool's `success: false` answer as a successful cancel (exit 0).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskTools } from '../src/mcp-tools/task-tools.js';
import { taskCommand } from '../src/commands/task.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

const tool = (name: string) => {
  const t = taskTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

const cancelCommand = taskCommand.subcommands!.find(c => c.name === 'cancel')!;

type CancelResult = { success: boolean; status?: string; previousStatus?: string; error?: string };
type StatusResult = { status: string; result: unknown; completedAt: string | null };

describe('task cancel', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-task-cancel-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    vi.spyOn(output, 'writeln').mockImplementation(() => {});
    vi.spyOn(output, 'printSuccess').mockImplementation(() => {});
    vi.spyOn(output, 'printInfo').mockImplementation(() => {});
    vi.spyOn(output, 'printJson').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  const create = async () =>
    (await tool('task_create').handler({ type: 'feature', description: 'work' }) as { taskId: string }).taskId;

  it('task_cancel returns the status the task had before it was cancelled', async () => {
    const taskId = await create();
    const result = await tool('task_cancel').handler({ taskId }) as CancelResult;
    expect(result.success).toBe(true);
    expect(result.status).toBe('cancelled');
    expect(result.previousStatus).toBe('pending');
  });

  it('task_cancel leaves a completed task and its result alone', async () => {
    const taskId = await create();
    await tool('task_complete').handler({ taskId, result: { answer: 42 } });
    const before = await tool('task_status').handler({ taskId }) as StatusResult;

    const result = await tool('task_cancel').handler({ taskId }) as CancelResult;
    expect(result.success).toBe(false);
    expect(result.previousStatus).toBe('completed');
    expect(result.error).toContain('already completed');

    const after = await tool('task_status').handler({ taskId }) as StatusResult;
    expect(after.status).toBe('completed');
    expect(after.result).toEqual({ answer: 42 });
    expect(after.completedAt).toBe(before.completedAt);
  });

  it('task cancel prints the previous status', async () => {
    const taskId = await create();
    const printInfo = vi.mocked(output.printInfo);
    const ctx = { args: [taskId], flags: { force: true }, cwd: dir, interactive: false } as unknown as CommandContext;
    const result = await cancelCommand.action!(ctx);
    expect(result?.success).toBe(true);
    expect(printInfo).toHaveBeenCalledWith('Previous status: pending');
  });

  it('task cancel exits 1 for an unknown task id', async () => {
    const printError = vi.spyOn(output, 'printError').mockImplementation(() => {});
    const ctx = { args: ['task-missing'], flags: { force: true }, cwd: dir, interactive: false } as unknown as CommandContext;
    const result = await cancelCommand.action!(ctx);
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
    expect(printError).toHaveBeenCalledWith('Failed to cancel task task-missing: Task not found');
    expect(output.printSuccess).not.toHaveBeenCalled();
  });

  it('task cancel exits 1 for a task that already finished', async () => {
    const taskId = await create();
    await tool('task_complete').handler({ taskId });
    vi.spyOn(output, 'printError').mockImplementation(() => {});
    const ctx = { args: [taskId], flags: { force: true }, cwd: dir, interactive: false } as unknown as CommandContext;
    const result = await cancelCommand.action!(ctx);
    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
  });
});
