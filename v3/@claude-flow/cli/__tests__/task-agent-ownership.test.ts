import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { taskTools } from '../src/mcp-tools/task-tools.js';
const call = (name: string, input: any):Promise<any> => taskTools.find(t=>t.name===name)!.handler(input) as Promise<any>;
const agentsPath=()=>join(state.cwd,'.claude-flow/agents/store.json');
const agent=()=>JSON.parse(readFileSync(agentsPath(),'utf8')).agents.worker;
beforeEach(() => {
 state.cwd=mkdtempSync(join(tmpdir(),'ruflo-task-ownership-'));
 mkdirSync(join(state.cwd,'.claude-flow/agents'),{recursive:true});
 writeFileSync(agentsPath(),JSON.stringify({agents:{worker:{agentId:'worker',status:'idle',currentTask:null,taskCount:0}},version:'3.0.0'}));
});
afterEach(()=>rmSync(state.cwd,{recursive:true,force:true}));
const create=()=>call('task_create',{type:'test',description:'task'});
it.each(['task_complete','task_cancel','task_assign'])('%s for an old task does not erase a newer assignment',async name=>{
 const a=await create(),b=await create();
 await call('task_assign',{taskId:a.taskId,agentIds:['worker']});
 await call('task_assign',{taskId:b.taskId,agentIds:['worker']});
 await call(name,{taskId:a.taskId,unassign:true});
 expect(agent()).toMatchObject({status:'busy',currentTask:b.taskId});
});
it('cancelling the owned task releases the worker',async()=>{
 const a=await create();await call('task_assign',{taskId:a.taskId,agentIds:['worker']});
 await call('task_cancel',{taskId:a.taskId});
 expect(agent()).toMatchObject({status:'idle',currentTask:null});
});
it('repeated completion is idempotent and preserves result and completion time',async()=>{
 const a=await create();await call('task_assign',{taskId:a.taskId,agentIds:['worker']});
 const first=await call('task_complete',{taskId:a.taskId,result:{answer:42}});
 const repeated=await call('task_complete',{taskId:a.taskId});
 expect(agent()).toMatchObject({status:'idle',currentTask:null,taskCount:1});
 expect(repeated).toEqual(first);
});
