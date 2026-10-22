import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
import { sessionTools } from '../src/mcp-tools/session-tools.js';
const call = (name: string, input: object) => sessionTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const importData = (data: unknown) => { const inputPath = join(state.cwd, 'input.json'); writeFileSync(inputPath, JSON.stringify(data)); return call('session_import', { inputPath }); };
beforeEach(() => { state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-import-')); });
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));
it.each([null, [], 7, {}, {name:{bad:true},data:{}}, {name:[],data:{}}, {name:'bad',data:[]}, {name:'bad',data:{tasks:{tasks:[]}}}, {name:'bad',data:{agents:{agents:{a:null}}}}, {name:'bad',data:{memory:{entries:'wrong'}}}].map(data => [data]))('rejects invalid session %j before registration', async data => {
  const result = await importData(data);
  expect(result.error).toMatch(/invalid session/i);
  const dir = join(state.cwd, '.claude-flow/sessions');
  expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
});
it.each([undefined, {tasks:999,agents:999,memoryEntries:999,totalSize:999}])('derives counts from imported data instead of claimed stats %j', async stats => {
  const data = {tasks:{tasks:{t:{taskId:'t'}}},agents:{agents:{a:{agentId:'a'}}},memory:{entries:{m:{key:'m',value:'v'}}}};
  const result = await importData({name:'legacy',stats,data});
  expect(result.stats).toEqual({tasksImported:1,agentsImported:1,memoryEntriesImported:1});
  const session = JSON.parse(readFileSync(join(state.cwd,'.claude-flow/sessions',result.sessionId+'.json'),'utf8'));
  expect(session.data).toEqual(data);
  expect(session.stats.totalSize).toBeGreaterThan(0);
});
it('accepts older metadata-only snapshots and recomputes empty counts', async () => {
  expect(await importData({name:'metadata',sessionId:'old'})).toMatchObject({name:'metadata',stats:{tasksImported:0,agentsImported:0,memoryEntriesImported:0}});
});

it.each([{name:'bad',data:{tasks:{tasks:[]}}}, {name:'bad',data:{memory:{entries:{a:null}}}}])('rejects malformed inline snapshot %j before registration', async data => {
  const result = await call('session_import', {data});
  expect(result.error).toMatch(/invalid session/i);
  const dir = join(state.cwd, '.claude-flow/sessions');
  expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
});
