import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '', execute: vi.fn() }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: state.execute }));
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
const call = (name: string, input: object) => workflowTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const path = () => join(state.cwd,'.claude-flow/workflows/store.json');
const store = () => JSON.parse(readFileSync(path(),'utf8'));
const create = () => call('workflow_create',{name:'resume',steps:[{type:'task',config:{agentId:'a',prompt:'first'}},{type:'task',config:{agentId:'a',prompt:'Continue {{step-1.output}}'}}]});
async function pausedSnapshot() {
  const {workflowId}=await create();const data=store();const workflow=data.workflows[workflowId];
  workflow.status='paused';workflow.currentStep=1;workflow.steps[0].status='completed';workflow.variables['step-1.output']='saved result';
  writeFileSync(path(),JSON.stringify(data));return workflowId;
}
beforeEach(() => { state.cwd=mkdtempSync(join(tmpdir(),'ruflo-resume-'));state.execute.mockReset().mockResolvedValue({success:true,output:'finished'}); });
afterEach(() => rmSync(state.cwd,{recursive:true,force:true}));
it('dispatches only remaining steps from a persisted pause and preserves output bindings', async () => {
  const workflowId=await pausedSnapshot();const result=await call('workflow_resume',{workflowId});
  expect(result).toMatchObject({resumed:true,status:'completed'});
  expect(state.execute).toHaveBeenCalledTimes(1);
  expect(state.execute.mock.calls[0][0].prompt).toBe('Continue saved result');
  expect(store().workflows[workflowId]).toMatchObject({status:'completed',currentStep:2});
});
it('reports a resumed step failure instead of leaving the workflow running', async () => {
  state.execute.mockResolvedValue({success:false,error:'provider unavailable'});
  const workflowId=await pausedSnapshot();
  expect(await call('workflow_resume',{workflowId})).toMatchObject({status:'failed',error:'provider unavailable'});
  expect(store().workflows[workflowId].status).toBe('failed');
});
it('admits one continuation when resume is requested twice', async () => {
  const workflowId=await pausedSnapshot();
  const results=await Promise.all([call('workflow_resume',{workflowId}),call('workflow_resume',{workflowId})]);
  expect(results.filter(r=>r.status==='completed')).toHaveLength(1);
  expect(state.execute).toHaveBeenCalledTimes(1);
});
it('joins an in-flight execution when pause is immediately followed by resume', async () => {
  let finish!:()=>void;state.execute.mockImplementationOnce(()=>new Promise(resolve=>finish=()=>resolve({success:true,output:'first output'})));
  const {workflowId}=await create();const executing=call('workflow_execute',{workflowId});
  await call('workflow_pause',{workflowId});const resuming=call('workflow_resume',{workflowId});
  expect(state.execute).toHaveBeenCalledTimes(1);finish();await executing;
  expect(await resuming).toMatchObject({resumed:true,status:'completed'});
  expect(state.execute.mock.calls.map(([input])=>input.prompt)).toEqual(['first','Continue first output']);
});
it('rejects a second executor even while the active execution is paused', async () => {
  let finish!:()=>void;state.execute.mockImplementationOnce(()=>new Promise(resolve=>finish=()=>resolve({success:true,output:'first output'})));
  const {workflowId}=await create();const executing=call('workflow_execute',{workflowId});await call('workflow_pause',{workflowId});
  const duplicate=await call('workflow_execute',{workflowId});
  expect(duplicate.error).toMatch(/already.*execut/i);
  const resuming=call('workflow_resume',{workflowId});finish();await executing;await resuming;
  expect(state.execute).toHaveBeenCalledTimes(2);
});
it('retains missing and non-paused guards without dispatching', async () => {
  expect(await call('workflow_resume',{workflowId:'missing'})).toMatchObject({error:'Workflow not found'});
  const {workflowId}=await create();expect(await call('workflow_resume',{workflowId})).toMatchObject({error:'Workflow not paused'});
  expect(state.execute).not.toHaveBeenCalled();
});
