import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '', execute: vi.fn() }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: state.execute }));
import { workflowTools } from '../src/mcp-tools/workflow-tools.js';
const call = (name: string, input: object) => workflowTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const store = () => JSON.parse(readFileSync(join(state.cwd,'.claude-flow/workflows/store.json'),'utf8'));
const create = () => call('workflow_create',{name:'running',steps:[{type:'task',config:{agentId:'a',prompt:'one'}},{type:'task',config:{agentId:'a',prompt:'two'}}]});
let finish: () => void;
beforeEach(() => { state.cwd=mkdtempSync(join(tmpdir(),'ruflo-progress-'));state.execute.mockReset();state.execute.mockImplementationOnce(()=>new Promise(resolve=>finish=()=>resolve({success:true,output:'one'}))).mockResolvedValue({success:true,output:'two'}); });
afterEach(() => rmSync(state.cwd,{recursive:true,force:true}));
it('honors a pause received during an awaited step and saves its continuation index', async () => {
  const {workflowId}=await create();const execution=call('workflow_execute',{workflowId});
  await call('workflow_pause',{workflowId});finish();
  expect(await execution).toMatchObject({status:'paused'});
  expect(state.execute).toHaveBeenCalledTimes(1);
  expect(store().workflows[workflowId]).toMatchObject({status:'paused',currentStep:1});
});
it.each(['workflow_cancel','workflow_stop'])('preserves %s during an awaited step and never dispatches its successor', async action => {
  const {workflowId}=await create();const execution=call('workflow_execute',{workflowId});
  await call(action,{workflowId,reason:'operator cancelled'});finish();
  expect(await execution).toMatchObject({status:'failed'});
  expect(state.execute).toHaveBeenCalledTimes(1);
  expect(store().workflows[workflowId]).toMatchObject({status:'failed',error:action==='workflow_cancel'?'operator cancelled':'Stopped by user'});
  expect(store().workflows[workflowId].steps[1].status).toBe('skipped');
});
it('retains sibling workflows and templates created while a step is pending', async () => {
  const {workflowId}=await create();const execution=call('workflow_execute',{workflowId});
  const sibling=await call('workflow_create',{name:'sibling'});
  const template=await call('workflow_template',{action:'save',workflowId:sibling.workflowId});
  finish();await execution;
  expect(store().workflows[sibling.workflowId].name).toBe('sibling');
  expect(store().templates[template.templateId]).toBeDefined();
});
it('does not recreate a paused workflow deleted while its current step finishes', async () => {
  const {workflowId}=await create();const execution=call('workflow_execute',{workflowId});
  await call('workflow_pause',{workflowId});await call('workflow_delete',{workflowId});finish();await execution;
  expect(store().workflows[workflowId]).toBeUndefined();
  expect(state.execute).toHaveBeenCalledTimes(1);
});
it('pause then resume before completion does not replay or overlap the in-flight step', async () => {
  const {workflowId}=await create();const execution=call('workflow_execute',{workflowId});
  await call('workflow_pause',{workflowId});const resumed=call('workflow_resume',{workflowId});
  expect(state.execute).toHaveBeenCalledTimes(1);finish();await execution;await resumed;
  expect(state.execute.mock.calls.map(([input])=>input.prompt)).toEqual(['one','two']);
  expect(store().workflows[workflowId].status).toBe('completed');
});

it('still permits an explicit retry of a previously failed workflow', async () => {
  state.execute.mockReset().mockResolvedValueOnce({success:false,error:'provider failure'}).mockResolvedValue({success:true,output:'retried'});
  const {workflowId}=await create();expect(await call('workflow_execute',{workflowId})).toMatchObject({status:'failed'});
  let finishRetry!: () => void;
  state.execute.mockImplementationOnce(() => new Promise(resolve => finishRetry = () => resolve({success:true,output:'retried'})));
  const retry = call('workflow_execute',{workflowId});
  expect(store().workflows[workflowId].error).toBeUndefined();
  expect(store().workflows[workflowId].completedAt).toBeUndefined();
  finishRetry();
  const result = await retry;
  expect(result).toMatchObject({status:'completed'});
  expect(result.error).toBeUndefined();
  expect(store().workflows[workflowId].error).toBeUndefined();
});
