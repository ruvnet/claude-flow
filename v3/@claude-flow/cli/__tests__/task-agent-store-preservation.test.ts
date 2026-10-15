import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state=vi.hoisted(()=>({cwd:''}));
vi.mock('../src/mcp-tools/types.js',()=>({getProjectCwd:()=>state.cwd}));
vi.mock('../src/mcp-tools/agent-execute-core.js',()=>({executeAgentTask:vi.fn()}));
vi.mock('../src/mcp-tools/swarm-tools.js',()=>({pheromoneAgentEligibility:vi.fn()}));
import {taskTools} from '../src/mcp-tools/task-tools.js';
import {agentTools} from '../src/mcp-tools/agent-tools.js';
const task=(name:string,input:any):Promise<any>=>taskTools.find(t=>t.name===name)!.handler(input) as Promise<any>;
const path=(kind:string)=>join(state.cwd,'.claude-flow',kind,'store.json');
beforeEach(()=>{state.cwd=mkdtempSync(join(tmpdir(),'ruflo-preserve-'));for(const k of ['tasks','agents'])mkdirSync(join(state.cwd,'.claude-flow',k),{recursive:true});});
afterEach(()=>rmSync(state.cwd,{recursive:true,force:true}));
it.each(['{ "preserve":', 'null', '[]', '{"tasks":[],"agents":[]}'])('refuses to replace existing invalid stores: %s',async original=>{
 for(const kind of ['tasks','agents'])writeFileSync(path(kind),original);
 await expect(task('task_create',{type:'test',description:'new'})).rejects.toThrow();
 await expect(agentTools.find(t=>t.name==='agent_pool')!.handler({action:'scale',targetSize:1})).rejects.toThrow();
 for(const kind of ['tasks','agents'])expect(readFileSync(path(kind),'utf8')).toBe(original);
});
it('does not overwrite an unreadable agent store during assignment',async()=>{
 const created=await task('task_create',{type:'test',description:'new'});
 writeFileSync(path('agents'),'{ preserve');
 await expect(task('task_assign',{taskId:created.taskId,agentIds:['worker']})).rejects.toThrow();
 expect(readFileSync(path('agents'),'utf8')).toBe('{ preserve');
 expect((await task('task_status',{taskId:created.taskId})).assignedTo).toEqual([]);
});
it('initializes a genuinely missing store',async()=>{
 expect(await task('task_create',{type:'test',description:'new'})).toHaveProperty('taskId');
 expect(await agentTools.find(t=>t.name==='agent_pool')!.handler({action:'scale',targetSize:1})).toMatchObject({action:'scale'});
});
