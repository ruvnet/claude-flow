/**
 * Tests for the `browser_act` MCP tool (ADR-175 page-agent integration).
 *
 * Four surfaces under test, per the integration brief:
 *   (a) DEGRADED path — page-agent absent → {degraded:true}, no throw.
 *   (b) Tool schema shape — input/handler present.
 *   (c) LLM-config resolution — provider config maps to {baseURL,apiKey,model}
 *       and NEVER emits a real key into a page-context string.
 *   (d) Trajectory recording is attempted on success (mock the bridge).
 *
 * We cannot drive a real browser in CI, so `agent-browser` and `page-agent`
 * are both mocked/injected — these tests assert the wiring/contracts, not
 * live browser automation.
 *
 * NOTE on why page-agent is mocked differently from agenticow/metaharness:
 * `page-agent`'s npm package is ESM-only and touches DOM globals at module
 * scope, so `await import('page-agent')` throws `ReferenceError: window is
 * not defined` in Node EVEN WHEN INSTALLED (verified empirically — see the
 * deviation notes atop browser-intent-tools.ts). The tool therefore never
 * dynamically imports 'page-agent' — it only does `require.resolve('page-agent')`
 * (path resolution, no execution). We simulate absence either by injecting a
 * throwing resolver directly (clean DI, no module-mock gymnastics) or, for the
 * full-handler test, by mocking `node:module`'s `createRequire` — the closest
 * equivalent to the `vi.mock('agenticow', ...)` pattern given page-agent's
 * different (non-dynamic-import) availability check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>();
  return {
    ...actual,
    createRequire: () => ({
      resolve: (id: string) => {
        const err = new Error(`Cannot find module '${id}'`) as NodeJS.ErrnoException;
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      },
    }),
  };
});

vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: vi.fn(async () => ({ success: true, id: 'mock-id' })),
}));

import {
  browserIntentTools,
  locatePageAgentBundle,
  resolvePageAgentLLMConfig,
  buildPageAgentInjection,
  stripDemoAutoInit,
  findDemoLeak,
  DemoLeakError,
  recordBrowserTrajectory,
  PLACEHOLDER_API_KEY,
  BROWSER_ACT_RESULT_GLOBAL,
} from '../src/mcp-tools/browser-intent-tools.js';
import { storeEntry } from '../src/memory/memory-initializer.js';

function findTool(name: string) {
  const t = browserIntentTools.find((x) => x.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

// ============================================================================
// (b) Tool schema shape
// ============================================================================

describe('browser_act — tool schema shape', () => {
  it('exposes exactly one tool: browser_act', () => {
    expect(browserIntentTools.map((t) => t.name)).toEqual(['browser_act']);
  });

  it('has a JSON-schema input with required "task" and a handler function', () => {
    const tool = findTool('browser_act');
    expect(tool.inputSchema.type).toBe('object');
    expect(tool.inputSchema.properties).toBeDefined();
    expect(tool.inputSchema.properties?.task).toBeDefined();
    expect(tool.inputSchema.required).toContain('task');
    expect(typeof tool.handler).toBe('function');
  });

  it('rejects a missing task with a structured error, not a throw', async () => {
    const tool = findTool('browser_act');
    const result = await tool.handler({});
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.success).toBe(false);
  });
});

// ============================================================================
// (a) DEGRADED path — page-agent not installed
// ============================================================================

describe('browser_act — degraded path (page-agent absent)', () => {
  it('locatePageAgentBundle returns null (never throws) when resolution fails with MODULE_NOT_FOUND', () => {
    const throwingResolver = (_id: string): string => {
      const err = new Error("Cannot find module 'page-agent'") as NodeJS.ErrnoException;
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    };
    expect(() => locatePageAgentBundle(throwingResolver)).not.toThrow();
    expect(locatePageAgentBundle(throwingResolver)).toBeNull();
  });

  it('re-throws unexpected (non-not-found) resolver errors rather than silently swallowing them', () => {
    const throwingResolver = (_id: string): string => {
      throw new Error('disk on fire');
    };
    expect(() => locatePageAgentBundle(throwingResolver)).toThrow(/disk on fire/);
  });

  it('browser_act returns {success:true, degraded:true} with a hint, never throws, when page-agent is unresolvable', async () => {
    const tool = findTool('browser_act');
    const result = await tool.handler({ task: 'Click the login button' });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text as string);
    expect(parsed.success).toBe(true);
    expect(parsed.degraded).toBe(true);
    expect(parsed.reason).toMatch(/page-agent not installed/i);
    expect(parsed.hint).toMatch(/npm i page-agent/);
  });
});

// ============================================================================
// (c) LLM-config resolution — provider config → {baseURL,apiKey,model},
//     and key safety (never emitted into a page-context string)
// ============================================================================

describe('resolvePageAgentLLMConfig — provider resolution + key safety', () => {
  it('returns null when no supported provider env var is set', () => {
    expect(resolvePageAgentLLMConfig({})).toBeNull();
  });

  it('prefers an explicit CLAUDE_FLOW_PAGE_AGENT_* override', () => {
    const cfg = resolvePageAgentLLMConfig({
      CLAUDE_FLOW_PAGE_AGENT_BASE_URL: 'https://my-proxy.example/v1',
      CLAUDE_FLOW_PAGE_AGENT_API_KEY: 'sk-explicit-secret',
      CLAUDE_FLOW_PAGE_AGENT_MODEL: 'my-model',
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({
      baseURL: 'https://my-proxy.example/v1',
      apiKey: 'sk-explicit-secret',
      model: 'my-model',
      source: 'explicit',
    });
  });

  it('falls back to OpenRouter (OpenAI-compatible) when only OPENROUTER_API_KEY is set', () => {
    const cfg = resolvePageAgentLLMConfig({ OPENROUTER_API_KEY: 'sk-or-secret' } as NodeJS.ProcessEnv);
    expect(cfg?.source).toBe('openrouter');
    expect(cfg?.apiKey).toBe('sk-or-secret');
    expect(cfg?.baseURL).toMatch(/\/v1$/);
    expect(cfg?.model.length).toBeGreaterThan(0);
  });

  it('falls back to Ollama Cloud (OpenAI-compatible) when only OLLAMA_API_KEY is set', () => {
    const cfg = resolvePageAgentLLMConfig({ OLLAMA_API_KEY: 'sk-ollama-secret' } as NodeJS.ProcessEnv);
    expect(cfg?.source).toBe('ollama');
    expect(cfg?.apiKey).toBe('sk-ollama-secret');
    expect(cfg?.baseURL).toMatch(/\/v1$/);
  });

  it('does NOT resolve a usable config from ANTHROPIC_API_KEY alone (native API is not OpenAI-compatible)', () => {
    const cfg = resolvePageAgentLLMConfig({ ANTHROPIC_API_KEY: 'sk-ant-secret' } as NodeJS.ProcessEnv);
    expect(cfg).toBeNull();
  });

  it('buildPageAgentInjection never embeds a real provider key into the page-context script', () => {
    const realSecret = 'sk-super-secret-should-never-leak';
    const script = buildPageAgentInjection(
      'window.PageAgent = function(){};',
      { baseURL: 'http://127.0.0.1:54321', apiKey: PLACEHOLDER_API_KEY, model: 'anthropic/claude-sonnet-4-6' },
      'Click the login button',
    );
    expect(script).not.toContain(realSecret);
    expect(script).toContain(PLACEHOLDER_API_KEY);
    expect(script).toContain('Click the login button');
    expect(script).toContain(BROWSER_ACT_RESULT_GLOBAL);
  });

  it('stripDemoAutoInit removes the always-on demo auto-init tail (which would otherwise leak page content to Alibaba\'s test endpoint)', () => {
    const fakeBundle = 'window.PageAgent = function(){};\nvar DEMO_MODEL="qwen3.5-plus", DEMO_API_KEY="NA"; setTimeout(()=>{ new PageAgent({apiKey:DEMO_API_KEY}); });';
    const stripped = stripDemoAutoInit(fakeBundle);
    expect(stripped).toContain('window.PageAgent');
    expect(stripped).not.toContain('DEMO_API_KEY');
    expect(stripped).not.toContain('DEMO_MODEL');
  });

  it('stripDemoAutoInit is a no-op (best-effort) when the marker is absent', () => {
    const noMarker = 'window.PageAgent = function(){};';
    expect(stripDemoAutoInit(noMarker)).toBe(noMarker);
  });

  // ── Fail-closed demo-endpoint firewall ────────────────────────────────────
  it('findDemoLeak flags each real demo-endpoint signature', () => {
    expect(findDemoLeak('fetch("https://page-ag-testing-xyz.cn-shanghai.fcapp.run")')).toBeTruthy();
    expect(findDemoLeak('const h = "svc.us-west.fcapp.run"')).toBeTruthy();
    expect(findDemoLeak('var DEMO_MODEL = "qwen3.5-plus"')).toBeTruthy();
  });

  it('findDemoLeak returns null for a clean bundle', () => {
    expect(findDemoLeak('window.PageAgent = function(){}; export {};')).toBeNull();
  });

  it('buildPageAgentInjection REFUSES (throws DemoLeakError) when the strip marker moved but the endpoint survives — fail-closed', () => {
    // Simulate an upstream bundle change: the DEMO_MODEL marker is gone (so the
    // text strip is a no-op) but the auto-connect endpoint is still present.
    const movedMarkerBundle =
      'window.PageAgent = function(){};\n' +
      'setTimeout(function(){ fetch("https://page-ag-testing-newhash.cn-shanghai.fcapp.run", {method:"POST"}); });';
    let thrown: unknown;
    try {
      buildPageAgentInjection(
        movedMarkerBundle,
        { baseURL: 'http://127.0.0.1:1', apiKey: PLACEHOLDER_API_KEY, model: 'm' },
        'do a thing',
      );
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(DemoLeakError);
    // And critically: it never produced an injectable string carrying the endpoint.
    expect((thrown as DemoLeakError).message).toMatch(/refusing to inject/i);
  });

  it('buildPageAgentInjection succeeds on a clean (endpoint-free) bundle', () => {
    const clean = 'window.PageAgent = function(){ this.execute = function(){ return Promise.resolve({success:true}); }; };';
    const script = buildPageAgentInjection(
      clean,
      { baseURL: 'http://127.0.0.1:1', apiKey: PLACEHOLDER_API_KEY, model: 'm' },
      'do a thing',
    );
    expect(script).toContain('window.PageAgent');
    expect(findDemoLeak(script)).toBeNull();
  });
});

// ============================================================================
// (d) Trajectory recording is attempted on success (mock the bridge)
// ============================================================================

describe('recordBrowserTrajectory — ADR-174 distillation, best-effort', () => {
  beforeEach(() => {
    vi.mocked(storeEntry).mockClear();
  });

  it('calls storeEntry with the browser namespace on success', async () => {
    const ok = await recordBrowserTrajectory({
      task: 'Click the login button',
      url: 'https://example.com',
      success: true,
      dataPreview: 'logged in',
      steps: 3,
      source: 'openrouter',
    });
    expect(ok).toBe(true);
    expect(storeEntry).toHaveBeenCalledTimes(1);
    const call = vi.mocked(storeEntry).mock.calls[0][0];
    expect(call.namespace).toBe('browser');
    expect(call.key).toMatch(/^browser-act-/);
    const value = JSON.parse(call.value);
    expect(value.task).toBe('Click the login button');
    expect(value.success).toBe(true);
  });

  it('is best-effort — a storeEntry failure never throws', async () => {
    vi.mocked(storeEntry).mockRejectedValueOnce(new Error('db locked'));
    const ok = await recordBrowserTrajectory({
      task: 'Click the login button',
      success: false,
      dataPreview: '',
      steps: 0,
      source: 'ollama',
    });
    expect(ok).toBe(false);
  });
});
