/**
 * task_list computed `total` after applying `limit`, so `task list` printed
 * "Showing 20 of 20 tasks" even when more tasks matched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskTools } from '../src/mcp-tools/task-tools.js';

const tool = (name: string) => {
  const t = taskTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type ListResult = { tasks: Array<{ taskId: string }>; total: number };

describe('task_list total', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-task-list-total-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    const create = tool('task_create').handler;
    for (let i = 0; i < 3; i++) {
      await create({ type: 'feature', description: `task ${i}` });
    }
    await create({ type: 'bugfix', description: 'other type' });
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports every matching task in total, not just the returned page', async () => {
    const result = await tool('task_list').handler({ limit: 2 }) as ListResult;
    expect(result.tasks).toHaveLength(2);
    expect(result.total).toBe(4);
  });

  it('counts only tasks that match the filters', async () => {
    const result = await tool('task_list').handler({ type: 'feature', limit: 1 }) as ListResult;
    expect(result.tasks).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it('total equals the number of tasks when under the limit', async () => {
    const result = await tool('task_list').handler({}) as ListResult;
    expect(result.tasks).toHaveLength(4);
    expect(result.total).toBe(4);
  });
});
