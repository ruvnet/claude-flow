import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '', route: vi.fn(), branch: vi.fn(), failNextWrite: false }));
vi.mock('node:fs', async original => { const fs = await original<typeof import('node:fs')>(); return { ...fs, writeFileSync: (...args: any[]) => { if (state.failNextWrite) { state.failNextWrite=false; throw new Error('fixture write failure'); } return (fs.writeFileSync as any)(...args); } }; });
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/ruvector/graph-backend.js', () => ({ addNode: vi.fn() }));
vi.mock('../src/ruvector/model-router.js', () => ({ recordModelOutcome: vi.fn(), recordModelOutcomeByModelId: vi.fn() }));
vi.mock('../src/mcp-tools/swarm-tools.js', () => ({ pheromoneAgentEligibility: () => ({ eligible: true }), loadSwarmStore: () => ({ swarms: {} }), saveSwarmStore: vi.fn() }));
vi.mock('../src/ruvector/enhanced-model-router.js', () => ({ getEnhancedModelRouter: () => ({route:state.route}) }));
vi.mock('../src/ruvector/task-embedder.js', () => ({ embedTaskWithCache: async () => undefined }));
vi.mock('../src/services/swarm-memory-branches.js', () => ({ SwarmMemoryBranches: class { branchForAgent = state.branch; } }));
import { agentTools } from '../src/mcp-tools/agent-tools.js';
const call = (name: string, input: object) => agentTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const spawn = (agentId: string) => call('agent_spawn', { agentType:'coder',agentId,model:'sonnet' });
const agents = () => JSON.parse(readFileSync(join(state.cwd,'.claude-flow/agents/store.json'),'utf8')).agents;
const deferred = <T = Response>() => { let resolve!: (r: T) => void; const promise = new Promise<T>(r => resolve=r); return {promise,resolve}; };
const response = (ok=true) => new Response(JSON.stringify(ok ? {id:'msg',model:'test',content:[{type:'text',text:'done'}],usage:{input_tokens:1,output_tokens:1}} : {error:'rejected'}), {status:ok?200:400});
beforeEach(() => { state.cwd=mkdtempSync(join(tmpdir(),'ruflo-registry-'));vi.stubEnv('ANTHROPIC_API_KEY','test-fixture');vi.stubEnv('CLAUDE_FLOW_ROUTER_TRAJECTORY','0');vi.stubEnv('CLAUDE_FLOW_RUN_TRANSCRIPTS','0'); });
afterEach(() => { vi.useRealTimers();state.failNextWrite=false;vi.unstubAllGlobals();vi.unstubAllEnvs();rmSync(state.cwd,{recursive:true,force:true}); });
it('retains simultaneous registrations after model-selection awaits', async () => {
  const routing=deferred<any>();state.route.mockReturnValueOnce(routing.promise);
  const first=call('agent_spawn',{agentType:'coder',agentId:'first',task:'route me'});
  await vi.waitFor(()=>expect(state.route).toHaveBeenCalled());
  await spawn('second');routing.resolve({model:'sonnet',tier:2});await first;
  expect(Object.keys(agents()).sort()).toEqual(['first','second']);
});
it('preserves sibling registrations and updated agent config after execution completes', async () => {
  await spawn('first');const pending=deferred();vi.stubGlobal('fetch',vi.fn(()=>pending.promise));
  const execution=call('agent_execute',{agentId:'first',prompt:'test'});
  await call('agent_update',{agentId:'first',config:{instructions:'new configuration'}});
  await spawn('second');pending.resolve(response());await execution;
  expect(Object.keys(agents()).sort()).toEqual(['first','second']);
  expect(agents().first.config.instructions).toBe('new configuration');
  expect(agents().first.lastResult.output).toBe('done');
});
it.each([true,false])('never resurrects an agent terminated during execution (provider success: %s)', async ok => {
  await spawn('first');const pending=deferred();vi.stubGlobal('fetch',vi.fn(()=>pending.promise));
  const execution=call('agent_execute',{agentId:'first',prompt:'test'});
  await call('agent_terminate',{agentId:'first'});pending.resolve(response(ok));await execution;
  expect(agents().first.status).toBe('terminated');
});
it('keeps one agent busy until its last overlapping request settles and retains both counts', async () => {
  await spawn('first');const a=deferred(),b=deferred();vi.stubGlobal('fetch',vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
  const first=call('agent_execute',{agentId:'first',prompt:'one'});const second=call('agent_execute',{agentId:'first',prompt:'two'});
  a.resolve(response());await first;expect(agents().first.status).toBe('busy');expect(agents().first.taskCount).toBe(2);
  b.resolve(response());await second;expect(agents().first.status).toBe('idle');expect(agents().first.taskCount).toBe(2);
});
it('does not reinsert an agent removed while provider work is pending', async () => {
  await spawn('first');const pending=deferred();vi.stubGlobal('fetch',vi.fn(()=>pending.promise));
  const execution=call('agent_execute',{agentId:'first',prompt:'test'});
  const path=join(state.cwd,'.claude-flow/agents/store.json');writeFileSync(path,JSON.stringify({agents:{},version:'3.0.0'}));
  pending.resolve(response());await execution;expect(agents()).toEqual({});
});

it('merges delayed COW metadata without discarding a sibling or newer config', async () => {
  const branch=deferred<any>();state.branch.mockReturnValueOnce(branch.promise);
  const first=call('agent_spawn',{agentType:'coder',agentId:'first',model:'sonnet',memoryBase:'fixture.rvf'});
  await vi.waitFor(()=>expect(state.branch).toHaveBeenCalled());
  await call('agent_update',{agentId:'first',config:{instructions:'new'}});await spawn('second');
  branch.resolve({branchPath:'fixture-branch.rvf',basePath:'fixture.rvf'});await first;
  expect(Object.keys(agents()).sort()).toEqual(['first','second']);
  expect(agents().first.config.instructions).toBe('new');
  expect(agents().first.memoryBranch).toBe('fixture-branch.rvf');
});

it('does not attach old results to a replacement with the same agent ID', async () => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  await spawn('first');const old=agents().first.createdAt;const pending=deferred();vi.stubGlobal('fetch',vi.fn(()=>pending.promise));
  const execution=call('agent_execute',{agentId:'first',prompt:'old incarnation'});
  writeFileSync(join(state.cwd,'.claude-flow/agents/store.json'),JSON.stringify({agents:{},version:'3.0.0'}));
  vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));await spawn('first');
  pending.resolve(response());await execution;
  expect(agents().first.createdAt).not.toBe(old);expect(agents().first.lastResult).toBeUndefined();expect(agents().first.taskCount).toBe(0);
});
it('releases execution accounting even if completion persistence throws', async () => {
  await spawn('first');const pending=deferred();const fetch=vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response());vi.stubGlobal('fetch',fetch);
  const execution=call('agent_execute',{agentId:'first',prompt:'failing write'});
  state.failNextWrite=true;pending.resolve(response());await expect(execution).rejects.toThrow('fixture write failure');
  await call('agent_execute',{agentId:'first',prompt:'next call'});expect(agents().first.status).toBe('idle');
});
