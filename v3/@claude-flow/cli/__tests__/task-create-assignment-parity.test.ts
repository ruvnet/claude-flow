import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-client.js', async () => {
  const { taskTools } = await import('../src/mcp-tools/task-tools.js');
  return { MCPClientError: class extends Error {}, callMCPTool: async (name: string, input: any) => taskTools.find(t => t.name === name)!.handler(input) };
});
import { taskCommand } from '../src/commands/task.js';
afterEach(() => { if (state.cwd) rmSync(state.cwd, { recursive: true, force: true }); });
describe('task create CLI/MCP assignment parity', () => {
  it.each(['agent-one', 'agent-one, agent-two', ''])('persists --assign %s', async (assign) => {
    state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-create-'));
    const action = taskCommand.subcommands!.find(c => c.name === 'create')!.action!;
    const result = await action({ args: [], flags: { _: [], type: 'implementation', description: 'Implement feature', assign }, cwd: state.cwd, interactive: false });
    expect(result.success).toBe(true);
    const store = JSON.parse(readFileSync(join(state.cwd, '.claude-flow/tasks/store.json'), 'utf8'));
    expect(Object.values(store.tasks)).toEqual([expect.objectContaining({ assignedTo: assign.split(',').map(s => s.trim()).filter(Boolean) })]);
  });
});

import { taskTools } from '../src/mcp-tools/task-tools.js';
it('lists all, running and agent-filtered tasks using the persisted handler contract', async () => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-task-list-'));
  const call = (name: string, input: any): Promise<any> => taskTools.find(t=>t.name===name)!.handler(input) as Promise<any>;
  const active=await call('task_create',{type:'test',description:'active',assignTo:['alice']});
  const done=await call('task_create',{type:'test',description:'done',assignTo:['bob']});
  await call('task_update',{taskId:active.taskId,status:'in_progress'});
  await call('task_complete',{taskId:done.taskId});
  const action=taskCommand.subcommands!.find(c=>c.name==='list')!.action!;
  const list=async(flags:any)=>{ const r=await action({args:[],flags:{_:[],format:'json',...flags},cwd:state.cwd,interactive:false});return (r.data as any).tasks; };
  expect(await list({})).toEqual([expect.objectContaining({taskId:active.taskId})]);
  expect(await list({status:'running'})).toHaveLength(1);
  expect(await list({all:true})).toHaveLength(2);
  expect(await list({all:true,agent:'bob'})).toEqual([expect.objectContaining({taskId:done.taskId})]);
});
