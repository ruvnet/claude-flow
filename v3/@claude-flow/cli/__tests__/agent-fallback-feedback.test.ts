import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAgentTask } from '../src/mcp-tools/agent-execute-core.js';
const mocks = vi.hoisted(() => ({ next: vi.fn(), tier: vi.fn(), model: vi.fn() }));
vi.mock('../src/ruvector/neural-router.js', () => ({ nextCostOptimalAlternative: mocks.next }));
vi.mock('../src/ruvector/task-embedder.js', () => ({ embedTaskWithCache: async () => [1, 0] }));
vi.mock('../src/ruvector/model-router.js', () => ({ recordModelOutcome: mocks.tier, recordModelOutcomeByModelId: mocks.model }));
const failed = {ok: false, status: 503, text: async () => 'unavailable'};
const success = {ok: true, json: async () => ({model: 'openai/winner', choices: [{message: {content: 'done'}}]})};

describe('fallback execution learning attribution', () => {
  let dir: string;
  let storePath: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'ruflo-fallback-feedback-'));
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OLLAMA_API_KEY', 'OLLAMA_BASE_URL', 'RUFLO_PROVIDER', 'OPENROUTER_BASE_URL', 'CLAUDE_FLOW_ROUTER_TRAJECTORY', 'CLAUDE_FLOW_RUN_TRANSCRIPTS']) vi.stubEnv(key, '');
    vi.stubEnv('OPENROUTER_API_KEY', 'test'); vi.stubEnv('CLAUDE_FLOW_CWD', dir);
    vi.stubEnv('CLAUDE_FLOW_ROUTER_FALLBACK_MAX_RETRIES', '2');
    const agents = join(dir, '.claude-flow', 'agents'); mkdirSync(agents, {recursive: true}); storePath = join(agents, 'store.json');
    writeFileSync(storePath, JSON.stringify({version: '3.0.0', agents: {test: {
      agentId: 'test', agentType: 'coder', status: 'idle', health: 100, taskCount: 0, config: {}, model: 'opus-4.7', modelId: 'openai/first',
    }}}));
    mocks.next.mockResolvedValueOnce({modelId: 'openai/second', model: 'sonnet'}).mockResolvedValueOnce({modelId: 'openai/winner', model: 'haiku'});
    fetchMock = vi.fn().mockResolvedValue(failed);
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, {recursive: true, force: true}); });

  it('credits the successful fallback tier and keeps both failed-model outcomes', async () => {
    fetchMock.mockResolvedValueOnce(failed).mockResolvedValueOnce(failed).mockResolvedValueOnce(success);
    const result = await executeAgentTask({agentId: 'test', prompt: 'task'});
    expect(result.success).toBe(true);
    expect(mocks.tier.mock.calls).toEqual([['task', 'opus', 'failure'], ['task', 'sonnet', 'failure'], ['task', 'haiku', 'success']]);
    expect(mocks.model.mock.calls).toEqual([['task', 'openai/first', 'failure'], ['task', 'openai/second', 'failure'], ['task', 'openai/winner', 'success']]);
    expect(JSON.parse(readFileSync(storePath, 'utf8')).agents.test).toMatchObject({model: 'haiku', modelId: 'openai/winner'});
  });

  it('records each failed attempted model exactly once when the retry budget is exhausted', async () => {
    expect((await executeAgentTask({agentId: 'test', prompt: 'task'})).success).toBe(false);
    expect(mocks.tier.mock.calls).toEqual([['task', 'opus', 'failure'], ['task', 'sonnet', 'failure'], ['task', 'haiku', 'failure']]);
    expect(mocks.model.mock.calls).toEqual([['task', 'openai/first', 'failure'], ['task', 'openai/second', 'failure'], ['task', 'openai/winner', 'failure']]);
  });

  it('does not invent a second outcome when no alternative can be executed', async () => {
    mocks.next.mockReset().mockResolvedValue(null);
    await executeAgentTask({agentId: 'test', prompt: 'task'});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.tier.mock.calls).toEqual([['task', 'opus', 'failure']]);
    expect(mocks.model.mock.calls).toEqual([['task', 'openai/first', 'failure']]);
  });
});
