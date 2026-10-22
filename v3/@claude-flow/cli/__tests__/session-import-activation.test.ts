import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state=vi.hoisted(()=>({cwd:'',storeEntry:vi.fn(async()=>({success:true}))}));
vi.mock('../src/mcp-tools/types.js',()=>({getProjectCwd:()=>state.cwd}));
vi.mock('../src/memory/memory-initializer.js',()=>({storeEntry:state.storeEntry}));
import {sessionTools} from '../src/mcp-tools/session-tools.js';
const call=(name:string,input:any):Promise<any>=>sessionTools.find(t=>t.name===name)!.handler(input) as Promise<any>;
const file=(kind:string)=>join(state.cwd,'.claude-flow',kind,'store.json');
beforeEach(()=>{
 state.cwd=mkdtempSync(join(tmpdir(),'ruflo-import-'));state.storeEntry.mockClear();
 for(const kind of ['tasks','agents','memory']){mkdirSync(join(state.cwd,'.claude-flow',kind),{recursive:true});writeFileSync(file(kind),JSON.stringify({live:kind}));}
 writeFileSync(join(state.cwd,'input.json'),JSON.stringify({name:'imported',stats:{tasks:1,agents:1,memoryEntries:1,totalSize:0},data:{tasks:{tasks:{saved:{description:'snapshot'}}},agents:{agents:{saved:{agentId:'saved'}}},memory:{entries:{saved:{key:'saved',value:'snapshot'}}}}}));
});
afterEach(()=>rmSync(state.cwd,{recursive:true,force:true}));
it('activates imported task, agent and memory state before reporting activated',async()=>{
 const result=await call('session_import',{inputPath:join(state.cwd,'input.json'),activate:true});
 expect(result.activated).toBe(true);
 expect(JSON.parse(readFileSync(file('tasks'),'utf8')).tasks.saved.description).toBe('snapshot');
 expect(JSON.parse(readFileSync(file('agents'),'utf8')).agents.saved.agentId).toBe('saved');
 expect(JSON.parse(readFileSync(file('memory'),'utf8')).entries.saved.value).toBe('snapshot');
 expect(state.storeEntry).toHaveBeenCalledWith(expect.objectContaining({key:'saved',value:'snapshot',upsert:true}));
});
it('imports without changing live stores when activation is omitted',async()=>{
 const result=await call('session_import',{inputPath:join(state.cwd,'input.json')});expect(result.activated).toBe(false);
 for(const kind of ['tasks','agents','memory'])expect(JSON.parse(readFileSync(file(kind),'utf8'))).toEqual({live:kind});
 expect(state.storeEntry).not.toHaveBeenCalled();
 expect(await call('session_info',{sessionId:result.sessionId})).toMatchObject({name:'imported'});
});
