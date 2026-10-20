import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Drive the `workflow` CLI subcommands against the real workflow MCP tools so a
// drift between what the tool returns and what the command reads shows up here.
const state = vi.hoisted(() => ({ cwd: '', tools: [] as any[], success: vi.fn(), error: vi.fn(), table: vi.fn(), info: vi.fn() }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-client.js', () => ({
  MCPClientError: class extends Error {},
  callMCPTool: (name: string, input: object) => state.tools.find(t => t.name === name).handler(input),
}));
vi.mock('../src/output.js', () => ({
  output: new Proxy({}, {
    get: (_t, prop) =>
      prop === 'printSuccess' ? state.success
        : prop === 'printError' ? state.error
        : prop === 'printTable' ? state.table
        : prop === 'printInfo' ? state.info
        : prop === 'createSpinner' ? () => ({ start() {}, succeed() {}, fail() {}, stop() {} })
        : (value: unknown) => value,
  }),
}));
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
import { workflowCommand } from '../src/commands/workflow.js';

state.tools = workflowTools;
const tool = (name: string, input: object) => workflowTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const sub = (name: string) => workflowCommand.subcommands!.find(c => c.name === name)!;
const run = (name: string, args: string[] = [], flags: Record<string, unknown> = {}) =>
  sub(name).action!({ args, flags, interactive: false } as any);
const start = async () => (await tool('workflow_run', { template: 'bugfix', task: 'fix it' })).workflowId as string;

beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-workflow-cli-'));
  for (const m of [state.success, state.error, state.table, state.info]) m.mockReset();
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));

describe('workflow run', () => {
  it('reports a rejected template as an error instead of crashing on the missing summary', async () => {
    const result = await run('run', [], { template: 'bad template!' });
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(state.error).not.toHaveBeenCalledWith(expect.stringContaining('TypeError'));
  });
});

describe('workflow list', () => {
  it('lists existing workflows when no status filter is given', async () => {
    const workflowId = await start();
    const result = await run('list');
    expect(result).toMatchObject({ success: true });
    expect(state.info).not.toHaveBeenCalledWith('No workflows found');
    const rows = state.table.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: workflowId, status: 'running' });
  });
});

describe('workflow status', () => {
  it('shows a stored workflow instead of crashing on a missing metrics block', async () => {
    const workflowId = await start();
    const result = await run('status', [workflowId]);
    expect(result).toMatchObject({ success: true });
    expect(state.error).not.toHaveBeenCalled();
  });

  it('reports a missing workflow as an error', async () => {
    const result = await run('status', ['workflow-nope']);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Workflow not found'));
    expect(state.error).not.toHaveBeenCalledWith(expect.stringContaining('TypeError'));
  });
});

describe('workflow stop', () => {
  it('stops a running workflow', async () => {
    const workflowId = await start();
    const result = await run('stop', [workflowId], { force: true });
    expect(result).toMatchObject({ success: true });
    expect(state.success).toHaveBeenCalledWith(`Workflow ${workflowId} stopped`);
    expect((await tool('workflow_status', { workflowId })).status).toBe('failed');
  });

  it('does not claim a missing workflow was stopped', async () => {
    const result = await run('stop', ['workflow-nope'], { force: true });
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Workflow not found'));
  });

  it('does not claim an already finished workflow was stopped', async () => {
    const workflowId = await start();
    await run('stop', [workflowId], { force: true });
    state.success.mockReset();
    const result = await run('stop', [workflowId], { force: true });
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(state.success).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('already finished'));
  });
});
