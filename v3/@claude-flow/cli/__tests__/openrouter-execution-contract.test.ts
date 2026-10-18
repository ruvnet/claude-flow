import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {callAnthropicMessages, executeAgentTask} from '../src/mcp-tools/agent-execute-core.js';

const fixture = vi.hoisted(() => ({
  store: '',
  providers: [] as unknown[],
  unexpectedFs: [] as string[],
  requests: [] as Array<{url: string; model: string; authorization: string | null}>,
  firstStatus: 200,
  failAll: false,
  mutate: '' as '' | 'endpoint' | 'credential',
}));
const registryPath = '/synthetic/provider-contract/.claude-flow/agents/store.json';
vi.mock('../src/mcp-tools/types.js', () => ({getProjectCwd: () => '/synthetic/provider-contract'}));
vi.mock('../src/services/config-file-manager.js', () => ({configManager: {get: () => fixture.providers}}));
vi.mock('../src/mcp-tools/agent-health-metrics.js', () => ({
  appendAgentExecution: (history: unknown[] = [], sample: unknown) => [...history, sample],
  summarizeAgentExecutions: () => ({health: null}),
}));
vi.mock('../src/ruvector/model-router.js', () => ({recordModelOutcome: vi.fn(), recordModelOutcomeByModelId: vi.fn()}));
vi.mock('../src/ruvector/task-embedder.js', () => ({embedTaskWithCache: async () => [1, 0]}));
vi.mock('../src/ruvector/neural-router.js', () => ({
  nextCostOptimalAlternative: async () => ({modelId: 'fixture/alternative', model: 'sonnet'}),
}));
vi.mock('node:fs', () => {
  function check(path: unknown): string {
    const value = String(path);
    if (![registryPath, '/synthetic/provider-contract/.claude-flow/agents'].includes(value)) {
      fixture.unexpectedFs.push(value);
      throw new Error('Unexpected fixture file access');
    }
    return value;
  }
  return {
    existsSync: (path: unknown) => {check(path); return true;},
    mkdirSync: (path: unknown) => {check(path);},
    readFileSync: (path: unknown) => {expect(check(path)).toBe(registryPath); return fixture.store;},
    writeFileSync: (path: unknown, value: string) => {expect(check(path)).toBe(registryPath); fixture.store = value;},
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['RUFLO_PROVIDER','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL',
    'OPENROUTER_API_KEY','OPENROUTER_BASE_URL','OPENROUTER_DEFAULT_MODEL','OLLAMA_API_KEY',
    'OLLAMA_CLOUD_API_KEY','CLAUDE_FLOW_ROUTER_TRAJECTORY','CLAUDE_FLOW_RUN_TRANSCRIPTS']) vi.stubEnv(key, '');
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-initial');
  vi.stubEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api');
  vi.stubEnv('CLAUDE_FLOW_ROUTER_FALLBACK_MAX_RETRIES', '1');
  fixture.providers = [{name:'openrouter', enabled:true}];
  fixture.requests = []; fixture.unexpectedFs = []; fixture.firstStatus = 200; fixture.failAll = false; fixture.mutate = '';
  fixture.store = JSON.stringify({version:'3.0.0',agents:{fixture:{
    agentId:'fixture',agentType:'researcher',status:'idle',health:100,taskCount:0,config:{},
    createdAt:'synthetic',model:'sonnet',modelId:'fixture/initial',provider:'openrouter',
  }}});
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {model:string};
    fixture.requests.push({url:String(url),model:body.model,authorization:new Headers(init?.headers).get('authorization')});
    if ((fixture.requests.length === 1 || fixture.failAll) && fixture.firstStatus !== 200) {
      if (fixture.mutate === 'endpoint') vi.stubEnv('OPENROUTER_BASE_URL','https://changed.example.invalid/api');
      if (fixture.mutate === 'credential') vi.stubEnv('OPENROUTER_API_KEY','synthetic-changed');
      return new Response('synthetic-echo-private-marker', {status:fixture.firstStatus});
    }
    return Response.json({model:body.model,choices:[{message:{content:'OK'}}],content:[{type:'text',text:'OK'}]});
  }));
});
afterEach(() => {
  try { expect(fixture.unexpectedFs).toEqual([]); }
  finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
const call = (model = 'fixture/exact') => callAnthropicMessages({provider:'openrouter',model,prompt:'synthetic'});
const execute = () => executeAgentTask({agentId:'fixture',prompt:'synthetic'});

describe('OpenRouter execution contract', () => {
  it.each(['https://openrouter.ai/api','https://gateway.example.invalid/custom'])('normalizes roots for %s', async prefix => {
    for (const suffix of ['', '/', '/v1', '/v1/']) {
      vi.stubEnv('OPENROUTER_BASE_URL',prefix+suffix);
      expect((await call()).success).toBe(true);
      expect(fixture.requests.at(-1)?.url).toBe(prefix+'/v1/chat/completions');
    }
  });
  it.each(['haiku','sonnet','opus'])('uses configured %s mapping with env credential', async tier => {
    fixture.providers=[{name:'openrouter',enabled:true,models:{[tier]:'vendor/configured-model'}}];
    expect((await call(tier)).success).toBe(true);
    expect(fixture.requests[0].model).toBe('vendor/configured-model');
  });
  it('preserves a full native model ID through agent execution', async () => {
    const store=JSON.parse(fixture.store);
    store.agents.fixture.modelId='anthropic/claude-sonnet-5.5';fixture.store=JSON.stringify(store);
    expect((await execute()).success).toBe(true);
    expect(fixture.requests[0].model).toBe('anthropic/claude-sonnet-5.5');
  });
  it('inherit uses the environment default ahead of configured values', async () => {
    fixture.providers=[{name:'openrouter',enabled:true,model:'vendor/persisted',models:{default:'vendor/mapped'}}];
    vi.stubEnv('OPENROUTER_DEFAULT_MODEL','vendor/environment');
    await call('inherit');expect(fixture.requests[0].model).toBe('vendor/environment');
  });
  it('inherit uses the persisted model when no higher default exists', async () => {
    fixture.providers=[{name:'openrouter',enabled:true,model:'vendor/persisted'}];
    await call('inherit');expect(fixture.requests[0].model).toBe('vendor/persisted');
  });
  it.each([null, [], {sonnet:''}, {sonnet:true}, {sonnet:{}}])('rejects malformed mappings before transport: %j', async models => {
    fixture.providers=[{name:'openrouter',enabled:true,models}];
    expect((await call('sonnet')).success).toBe(false);expect(fixture.requests).toHaveLength(0);
  });
  it.each(['provider','endpoint','credential'] as const)('pins %s across retry', async kind => {
    fixture.firstStatus=503;
    if(kind==='provider') vi.stubEnv('ANTHROPIC_API_KEY','synthetic-competing');
    else {vi.stubEnv('RUFLO_PROVIDER','openrouter');fixture.mutate=kind;}
    expect((await execute()).success).toBe(true);
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1].url).toBe(fixture.requests[0].url);
    // Keep even synthetic credential values out of assertion diffs.
    expect(fixture.requests[1].authorization===fixture.requests[0].authorization).toBe(true);
  });
  it.each([401,503])('persists the latest failure instead of a stale success for HTTP %s', async status => {
    const store=JSON.parse(fixture.store);
    store.agents.fixture.lastResult={success:true,output:'prior success'};
    fixture.store=JSON.stringify(store);fixture.firstStatus=status;
    vi.stubEnv('CLAUDE_FLOW_ROUTER_FALLBACK_MAX_RETRIES','0');
    const result=await execute();
    expect(result.success).toBe(false);
    const saved=JSON.parse(fixture.store).agents.fixture;
    expect(result.error).toContain('synthetic-echo-private-marker');
    expect(saved.lastResult.success).toBe(false);
    expect(saved.lastResult.error).toBe(`agent_execute failed (HTTP ${status})`);
    expect(fixture.store).not.toContain('synthetic-echo-private-marker');
    expect(saved.taskCount).toBe(1);
    expect(saved.executionHistory.at(-1).success).toBe(false);
  });
  it('sanitizes persisted error history even when the fallback succeeds', async () => {
    fixture.firstStatus=503;
    const result=await execute();expect(result.success).toBe(true);
    expect(result.fallbackHistory?.[0].error).toContain('synthetic-echo-private-marker');
    const saved=JSON.parse(fixture.store).agents.fixture.lastResult;
    expect(saved.success).toBe(true);expect(saved.output).toBe('OK');
    expect(saved.fallbackHistory[0].error).toBe('agent_execute failed (HTTP 503)');
    expect(fixture.store).not.toContain('synthetic-echo-private-marker');
  });
  it('sanitizes failure history after the allowed fallback also fails', async () => {
    fixture.firstStatus=503;fixture.failAll=true;
    const result=await execute();
    expect(result.success).toBe(false);expect(fixture.requests).toHaveLength(2);
    expect(result.fallbackHistory).toHaveLength(1);
    expect(result.fallbackHistory?.[0].error).toContain('synthetic-echo-private-marker');
    const saved=JSON.parse(fixture.store).agents.fixture.lastResult;
    expect(saved.fallbackHistory).toHaveLength(1);
    expect(saved.fallbackHistory[0].error).toBe('agent_execute failed (HTTP 503)');
    expect(saved.fallbackHistory[0].modelId).toBe('fixture/initial');
    expect(fixture.store).not.toContain('synthetic-echo-private-marker');
  });
  it('honors zero retry budget', async () => {
    fixture.firstStatus=503;vi.stubEnv('CLAUDE_FLOW_ROUTER_FALLBACK_MAX_RETRIES','0');
    expect((await execute()).success).toBe(false);expect(fixture.requests).toHaveLength(1);
  });
  it('does not retry non-retryable failures', async () => {
    fixture.firstStatus=400;expect((await execute()).success).toBe(false);expect(fixture.requests).toHaveLength(1);
  });
  it('fails missing OpenRouter credentials without switching provider', async () => {
    vi.stubEnv('OPENROUTER_API_KEY','');vi.stubEnv('ANTHROPIC_API_KEY','synthetic-competing');
    expect((await call()).success).toBe(false);expect(fixture.requests).toHaveLength(0);
  });
});
