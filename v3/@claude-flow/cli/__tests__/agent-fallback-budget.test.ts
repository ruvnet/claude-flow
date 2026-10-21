import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAgentTask } from '../src/mcp-tools/agent-execute-core.js';
const mocks = vi.hoisted(() => ({ next: vi.fn(), embed: vi.fn() }));
vi.mock('../src/ruvector/neural-router.js', () => ({ nextCostOptimalAlternative: mocks.next }));
vi.mock('../src/ruvector/task-embedder.js', () => ({ embedTaskWithCache: mocks.embed }));
vi.mock('../src/ruvector/model-router.js', () => ({ recordModelOutcome: vi.fn(), recordModelOutcomeByModelId: vi.fn() }));

describe('agent execution fallback request budget', () => {
  let dir: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'ruflo-fallback-budget-'));
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OLLAMA_API_KEY', 'OLLAMA_BASE_URL', 'RUFLO_PROVIDER', 'OPENROUTER_BASE_URL', 'CLAUDE_FLOW_ROUTER_TRAJECTORY', 'CLAUDE_FLOW_RUN_TRANSCRIPTS']) vi.stubEnv(key, '');
    vi.stubEnv('OPENROUTER_API_KEY', 'test');
    vi.stubEnv('CLAUDE_FLOW_CWD', dir);
    const agents = join(dir, '.claude-flow', 'agents'); mkdirSync(agents, {recursive: true});
    writeFileSync(join(agents, 'store.json'), JSON.stringify({version: '3.0.0', agents: {test: {
      agentId: 'test', agentType: 'coder', status: 'idle', health: 100, taskCount: 0, config: {}, model: 'sonnet', modelId: 'openai/first',
    }}}));
    mocks.embed.mockResolvedValue(new Float32Array([1, 0]));
    mocks.next.mockImplementation(async (_embedding, excluded: string[]) => ({modelId: `openai/retry-${excluded.length}`, tier: 'haiku'}));
    fetchMock = vi.fn().mockResolvedValue({ok: false, status: 503, text: async () => 'unavailable'});
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, {recursive: true, force: true}); });

  it.each([['0', 1], ['-1', 1], ['2', 3], ['invalid', 2]])('limits retries for %s to %i total requests', async (budget, requests) => {
    vi.stubEnv('CLAUDE_FLOW_ROUTER_FALLBACK_MAX_RETRIES', budget);
    const result = await executeAgentTask({agentId: 'test', prompt: 'test'});
    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(requests);
    if (requests === 1) { expect(mocks.embed).not.toHaveBeenCalled(); expect(mocks.next).not.toHaveBeenCalled(); }
  });
});
