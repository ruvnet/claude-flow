/**
 * workflow_list computed `total` after applying `limit`, so `workflow list`
 * printed "Total: 20 workflows" even when more workflows were stored.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';

const tool = (name: string) => {
  const t = workflowTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

type ListResult = { workflows: Array<{ workflowId: string }>; total: number };

describe('workflow_list total', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-workflow-list-total-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    const create = tool('workflow_create').handler;
    for (let i = 0; i < 3; i++) {
      await create({ name: `workflow ${i}` });
    }
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports every stored workflow in total, not just the returned page', async () => {
    const result = await tool('workflow_list').handler({ limit: 2 }) as ListResult;
    expect(result.workflows).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it('counts the matches for the CLI default status filter', async () => {
    const result = await tool('workflow_list').handler({ status: 'all', limit: 1 }) as ListResult;
    expect(result.workflows).toHaveLength(1);
    expect(result.total).toBe(3);
  });

  it('total equals the number of workflows when under the limit', async () => {
    const result = await tool('workflow_list').handler({}) as ListResult;
    expect(result.workflows).toHaveLength(3);
    expect(result.total).toBe(3);
  });
});
