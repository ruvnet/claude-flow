import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '', storeEntry: vi.fn(async () => ({success:true})) }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/memory/memory-initializer.js', () => ({ storeEntry: state.storeEntry }));
import { sessionTools } from '../src/mcp-tools/session-tools.js';
const call = (name: string, input: any) => sessionTools.find(t=>t.name===name)!.handler(input);
const file = (kind: string) => join(state.cwd, '.claude-flow', kind, 'store.json');
beforeEach(() => {
  state.cwd=mkdtempSync(join(tmpdir(),'ruflo-restore-')); state.storeEntry.mockClear();
  for(const kind of ['tasks','agents','memory']) {
    mkdirSync(join(state.cwd,'.claude-flow',kind),{recursive:true});
    writeFileSync(file(kind),JSON.stringify({[kind==='memory'?'entries':kind]: { saved: {key:'saved',value:'snapshot'} }}));
  }
});
afterEach(()=>rmSync(state.cwd,{recursive:true,force:true}));
it.each(['Memory','Tasks','Agents'])('restores only selected %s data and preserves excluded live stores',async selected=>{
  const saved:any=await call('session_save',{name:'checkpoint',includeMemory:true,includeTasks:true,includeAgents:true});
  for(const kind of ['tasks','agents','memory'])writeFileSync(file(kind),JSON.stringify({live:kind}));
  const flags=Object.fromEntries(['Memory','Tasks','Agents'].map(kind=>['restore'+kind,kind===selected]));
  const result:any=await call('session_restore',{sessionId:saved.sessionId,...flags});
  expect(result.restored).toBe(true);
  for(const kind of ['tasks','agents','memory']) {
    const data=JSON.parse(readFileSync(file(kind),'utf8'));
    if(kind===selected.toLowerCase())expect(data[kind==='memory'?'entries':kind].saved.value).toBe('snapshot');
    else expect(data).toEqual({live:kind});
  }
  expect(state.storeEntry).toHaveBeenCalledTimes(selected==='Memory'?1:0);
});
it('keeps default restore-all behavior',async()=>{
  const saved:any=await call('session_save',{name:'checkpoint',includeMemory:true,includeTasks:true,includeAgents:true});
  for(const kind of ['tasks','agents','memory'])writeFileSync(file(kind),'{}');
  await call('session_restore',{sessionId:saved.sessionId});
  for(const kind of ['tasks','agents','memory'])expect(readFileSync(file(kind),'utf8')).toContain('snapshot');
});
