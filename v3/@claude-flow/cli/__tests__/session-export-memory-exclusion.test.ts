import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { sessionTools } from '../src/mcp-tools/session-tools.js';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';
const call = (name: string, input: any):Promise<any> => sessionTools.find(t=>t.name===name)!.handler(input) as Promise<any>;
beforeEach(() => {
  state.cwd=mkdtempSync(join(tmpdir(),'ruflo-export-'));
  // #3573: session_save now also captures the live memory DB; point it at an
  // empty root so only the legacy store.json below is in scope.
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', join(state.cwd, '.swarm'));
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  _resetMemoryRootCache();
  for(const kind of ['tasks','agents','memory']) {
    mkdirSync(join(state.cwd,'.claude-flow',kind),{recursive:true});
    writeFileSync(join(state.cwd,'.claude-flow',kind,'store.json'),JSON.stringify({[kind==='memory'?'entries':kind]: { saved: {value:kind==='memory'?'private-memory':'kept'} }}));
  }
});
afterEach(()=>{vi.unstubAllEnvs();_resetMemoryRootCache();rmSync(state.cwd,{recursive:true,force:true});});
it('excludes memory from returned and written exports while preserving the saved session',async()=>{
  const saved=await call('session_save',{name:'checkpoint',includeMemory:true,includeTasks:true,includeAgents:true});
  const outputPath=join(state.cwd,'export.json');
  const result=await call('session_export',{sessionId:saved.sessionId,includeMemory:false,outputPath});
  for(const exported of [result.data,JSON.parse(readFileSync(outputPath,'utf8'))]) {
    expect(exported.data).not.toHaveProperty('memory');
    expect(exported.data.tasks.tasks.saved.value).toBe('kept');
    expect(exported.data.agents.agents.saved.value).toBe('kept');
    expect(exported.stats.memoryEntries).toBe(0);
    expect(JSON.stringify(exported)).not.toContain('private-memory');
  }
  const full=await call('session_export',{sessionId:saved.sessionId});
  expect(full.data.data.memory.entries.saved.value).toBe('private-memory');
  expect(full.data.stats.memoryEntries).toBe(1);
});
