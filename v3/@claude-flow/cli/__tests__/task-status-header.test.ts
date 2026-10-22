/**
 * `task status` titled its box with `result.id`, but task_status returns
 * `taskId`, so every task was shown as "Task: undefined".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskTools } from '../src/mcp-tools/task-tools.js';
import { taskCommand } from '../src/commands/task.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

const statusCommand = taskCommand.subcommands!.find(c => c.name === 'status')!;

describe('task status', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-task-status-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    vi.spyOn(output, 'writeln').mockImplementation(() => {});
    vi.spyOn(output, 'printTable').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('titles the status box with the task id', async () => {
    const create = taskTools.find(t => t.name === 'task_create')!.handler;
    const { taskId } = await create({ type: 'feature', description: 'work' }) as { taskId: string };
    const printBox = vi.spyOn(output, 'printBox').mockImplementation(() => {});

    const ctx = { args: [taskId], flags: {}, cwd: dir, interactive: false } as unknown as CommandContext;
    const result = await statusCommand.action!(ctx);

    expect(result?.success).toBe(true);
    expect(printBox).toHaveBeenCalledTimes(1);
    expect(printBox.mock.calls[0][1]).toBe(`Task: ${taskId}`);
  });
});
