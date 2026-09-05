/**
 * Browser Intent MCP Tools — ADR-175 page-agent integration.
 *
 * Adds a natural-language INTENT layer on top of the low-level selector-based
 * `browser_*` tools (browser-tools.ts, driven by the `agent-browser` CLI).
 * `browser_act({ task })` lets a caller say "Click the login button" instead
 * of chaining browser_snapshot + browser_click.
 *
 * Backing library: `page-agent` (npm, MIT, https://github.com/alibaba/page-agent)
 * — in-page injected JS that turns the DOM into text and lets an LLM execute
 * natural-language intents via `agent.execute('Click login')`.
 *
 * ============================================================================
 * VERIFIED API (recorded 2026-07-04 against page-agent@1.11.0 — `npm view
 * page-agent`, the published README, and the actual npm tarball contents).
 * Deviations from the original integration brief are called out inline.
 * ============================================================================
 *
 * - Package layout changed since the brief was written: `page-agent` is now a
 *   thin composition of `@page-agent/core` + `@page-agent/llms` +
 *   `@page-agent/page-controller` + `@page-agent/ui`. The npm package is
 *   ESM-only (`"type":"module"`) and ships two builds:
 *     - `dist/esm/page-agent.js` — the Node/bundler ESM entry.
 *     - `dist/iife/page-agent.demo.js` — a self-contained browser IIFE that
 *       sets `window.PageAgent = <class>` (this is what we inject).
 *
 * - DEVIATION #1 (load-bearing): `await import('page-agent')` is NOT a safe
 *   availability probe in Node. Empirically, importing the ESM entry throws
 *   `ReferenceError: window is not defined` — even when the package IS
 *   correctly installed — because `@page-agent/core`'s module graph touches
 *   DOM globals at import time (it's designed to run in a browser, not Node).
 *   This differs from the agenticow-loader.ts pattern used elsewhere in this
 *   repo (dynamic `import()` + catch `ERR_MODULE_NOT_FOUND`), which only
 *   works for pure-Node optional deps. Instead we detect availability via
 *   `require.resolve('page-agent')` — path resolution only, never executes
 *   module code — the same technique `browser-session-tools.ts` already uses
 *   to resolve the local `ruvector` CLI bin without invoking it.
 *
 * - DEVIATION #2: the IIFE bundle unconditionally (also) auto-constructs a
 *   DEMO `PageAgent` instance via `setTimeout`, pointed at Alibaba's public
 *   sandbox endpoint (`model: 'qwen3.5-plus'`, a `page-ag-testing-*.run`
 *   baseURL, `apiKey: 'NA'`) UNLESS the bundle is loaded via a real
 *   `<script src="...?autoInit=false">` tag — the guard reads
 *   `document.currentScript.src`, which is `null` when the bundle runs via
 *   `eval`/CDP (our only injection path through the `agent-browser`
 *   primitive set). Left alone, every `browser_act` call would leak page
 *   content to Alibaba's test endpoint using a placeholder key. We strip the
 *   demo auto-init tail (`stripDemoAutoInit`) before injecting rather than
 *   relying on the query-param guard.
 *
 * - Constructor: `new PageAgent({ model, baseURL, apiKey, language })` —
 *   `apiKey` is OPTIONAL on the type (`LLMConfig.apiKey?: string`), confirmed
 *   in `@page-agent/llms`' `LLMConfig` interface.
 *
 * - `execute(task: string): Promise<ExecutionResult>` where
 *   `ExecutionResult = { success: boolean; data: string; history: HistoricalEvent[] }`
 *   — DEVIATION #3: NOT `{ success, result, steps }` as sketched in the
 *   original brief. We map `data` → `result` and `history.length` → `steps`
 *   in the tool's own return shape, and also pass `history` through for
 *   callers that want the full step trace.
 *
 * - LLM transport: confirmed via `@page-agent/llms`' `OpenAIClient` — a
 *   single non-streaming `POST ${baseURL}/chat/completions` with
 *   `Authorization: Bearer ${apiKey}` and OpenAI tool-calling JSON. This is
 *   why a bare `ANTHROPIC_API_KEY` cannot be handed to page-agent directly:
 *   Anthropic's native API is a different shape (`/v1/messages`, different
 *   tool-call format). We require an OpenAI-*compatible* endpoint — reusing
 *   this CLI's own Tier-3 fallback ladder from `agent-execute-core.ts`
 *   (OpenRouter, then Ollama Cloud), or an explicit override.
 *
 * ARCHITECTURAL CONSTRAINT (mirrors metaharness-tools.ts / agenticow-tools.ts)
 * `page-agent` lives in `optionalDependencies`. Every code path degrades to
 * `{ degraded: true }` — never throws — when the package or an LLM provider
 * isn't available.
 *
 * KEY-SAFETY CONSTRAINT (load-bearing): page-agent's LLM calls happen FROM
 * the browser page context (it's client-side injected JS), so its `apiKey`
 * config field is necessarily visible to whatever we inject into the page.
 * To avoid ever placing a real provider key into a page-context string, we
 * start a short-lived local HTTP proxy (`startLocalLLMProxy`) bound to
 * 127.0.0.1 that holds the REAL key server-side and injects the real
 * `Authorization` header itself; the page only ever sees the proxy's
 * loopback URL plus a constant placeholder string (`PLACEHOLDER_API_KEY`).
 *
 * @module @claude-flow/cli/mcp-tools/browser-intent
 */

import { createRequire } from 'node:module';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MCPTool, MCPToolResult } from './types.js';
import { validateText, validateIdentifier } from './validate-input.js';
import { execBrowserCommand } from './browser-tools.js';
import { storeEntry } from '../memory/memory-initializer.js';

// ============================================================================
// page-agent availability (Node-safe: never `import()`s the package — see
// DEVIATION #1 above)
// ============================================================================

export interface PageAgentBundle {
  /** Package root directory (contains package.json). */
  root: string;
  /** Absolute path to the browser-injectable IIFE bundle. */
  iifePath: string;
  version: string;
}

/**
 * Locate the installed `page-agent` package's browser bundle without ever
 * executing its module code. `resolvePkg` is injectable for tests (DI over
 * module mocking, since `vi.mock('page-agent', ...)` cannot simulate absence
 * for a package we deliberately never `import()`).
 */
export function locatePageAgentBundle(
  resolvePkg: (id: string) => string = (id) => createRequire(import.meta.url).resolve(id),
): PageAgentBundle | null {
  let entry: string;
  try {
    entry = resolvePkg('page-agent');
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (
      e?.code === 'MODULE_NOT_FOUND' ||
      e?.code === 'ERR_MODULE_NOT_FOUND' ||
      /Cannot find (module|package)/i.test(String(e?.message))
    ) {
      return null;
    }
    throw err;
  }

  // entry resolves to <root>/dist/esm/page-agent.js — walk up looking for the
  // package's own package.json (mirrors resolveLocalRuvectorCli's technique
  // in browser-session-tools.ts).
  let dir = dirname(entry);
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === 'page-agent') {
        const iifePath = join(dir, 'dist', 'iife', 'page-agent.demo.js');
        if (!existsSync(iifePath)) return null;
        return { root: dir, iifePath, version: pkg.version ?? 'unknown' };
      }
    } catch {
      // no package.json at this level — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ============================================================================
// LLM provider resolution — reuses this CLI's own Tier-3 fallback ladder
// (agent-execute-core.ts): OpenRouter, then Ollama Cloud — both already
// OpenAI-compatible. ANTHROPIC_API_KEY alone is intentionally NOT accepted
// here (see DEVIATION notes above — page-agent needs a /chat/completions
// shaped endpoint).
// ============================================================================

export interface ResolvedLLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  source: 'explicit' | 'openrouter' | 'ollama';
}

export function resolvePageAgentLLMConfig(env: NodeJS.ProcessEnv = process.env): ResolvedLLMConfig | null {
  // 1. Explicit override — a caller-configured OpenAI-compatible endpoint
  //    dedicated to page-agent (private proxy, Azure OpenAI, vLLM, etc).
  if (env.CLAUDE_FLOW_PAGE_AGENT_BASE_URL && env.CLAUDE_FLOW_PAGE_AGENT_API_KEY) {
    return {
      baseURL: env.CLAUDE_FLOW_PAGE_AGENT_BASE_URL,
      apiKey: env.CLAUDE_FLOW_PAGE_AGENT_API_KEY,
      model: env.CLAUDE_FLOW_PAGE_AGENT_MODEL || 'gpt-4o-mini',
      source: 'explicit',
    };
  }
  // 2. OpenRouter — this CLI's own Tier-3 OpenAI-compatible fallback.
  if (env.OPENROUTER_API_KEY) {
    const base = (env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api').replace(/\/+$/, '');
    return {
      baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_DEFAULT_MODEL || 'anthropic/claude-sonnet-4-6',
      source: 'openrouter',
    };
  }
  // 3. Ollama Cloud — OpenAI-compatible per #1725.
  if (env.OLLAMA_API_KEY) {
    const base = (env.OLLAMA_BASE_URL || 'https://ollama.com').replace(/\/+$/, '');
    return {
      baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
      apiKey: env.OLLAMA_API_KEY,
      model: env.CLAUDE_FLOW_PAGE_AGENT_OLLAMA_MODEL || 'qwen2.5-coder:32b-cloud',
      source: 'ollama',
    };
  }
  return null;
}

// ============================================================================
// Local loopback LLM proxy — keeps the real provider key server-side. Only
// the proxy's 127.0.0.1 URL + a placeholder string ever reach page context.
// ============================================================================

export const PLACEHOLDER_API_KEY = 'ruflo-proxied-key';

export interface LLMProxyHandle {
  url: string;
  close: () => void;
}

export function startLocalLLMProxy(real: { baseURL: string; apiKey: string }): Promise<LLMProxyHandle> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const target = `${real.baseURL.replace(/\/+$/, '')}${req.url ?? ''}`;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        fetch(target, {
          method: req.method,
          headers: {
            'content-type': 'application/json',
            // The real key is injected here, server-side, and nowhere else —
            // whatever Authorization header the page-context request carried
            // (the placeholder) is discarded.
            authorization: `Bearer ${real.apiKey}`,
          },
          body: body.length > 0 ? body : undefined,
        })
          .then(async (upstream) => {
            const text = await upstream.text();
            res.writeHead(upstream.status, {
              'content-type': upstream.headers.get('content-type') || 'application/json',
            });
            res.end(text);
          })
          .catch((err: unknown) => {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { message: String(err instanceof Error ? err.message : err) } }));
          });
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => {
          try { server.close(); } catch { /* best-effort */ }
        },
      });
    });
  });
}

// ============================================================================
// Injection script assembly
// ============================================================================

/** Marker at which the demo bundle's always-on auto-init tail begins (see DEVIATION #2). */
const DEMO_TAIL_MARKER = 'var DEMO_MODEL=';

/**
 * Fail-CLOSED firewall signatures. page-agent's shipped IIFE (`page-agent.demo.js`)
 * auto-POSTs page content to Alibaba's public sandbox on inject
 * (`https://page-ag-testing-*.<region>.fcapp.run`, model `DEMO_MODEL`). We strip
 * that tail, but the strip is only best-effort text matching. These signatures
 * are the load-bearing guarantee: if ANY survive the strip, we REFUSE to inject.
 * Version-independent — an upstream bundle change that moves/renames the marker
 * can never silently re-enable the leak (the previous strip fell OPEN and
 * injected as-is when the marker moved; this cannot).
 */
const DEMO_LEAK_SIGNATURES: RegExp[] = [
  /page-ag-testing/i, // the demo endpoint subdomain prefix
  /\.fcapp\.run/i,    // Alibaba Function Compute host (the demo backend)
  /\bDEMO_MODEL\b/,   // the demo auto-init marker/model
];

/** Thrown when a bundle still contains a demo/sandbox endpoint after stripping. */
export class DemoLeakError extends Error {
  constructor(public readonly signature: string) {
    super(
      `page-agent bundle still contains a demo/sandbox endpoint (matched /${signature}/) ` +
      'after stripping — refusing to inject to avoid leaking page content to Alibaba\'s sandbox',
    );
    this.name = 'DemoLeakError';
  }
}

/** Returns the first demo-leak signature found in `source`, or null if clean. */
export function findDemoLeak(source: string): string | null {
  for (const re of DEMO_LEAK_SIGNATURES) {
    if (re.test(source)) return re.source;
  }
  return null;
}

/**
 * Strip the demo bundle's auto-init tail so injecting it via eval doesn't spin
 * up a second `window.pageAgent` pointed at Alibaba's sandbox endpoint. This is
 * best-effort at the text level; the real guarantee is the fail-closed
 * `findDemoLeak` firewall enforced in `buildPageAgentInjection`, NOT this strip.
 */
export function stripDemoAutoInit(iifeSource: string): string {
  const idx = iifeSource.indexOf(DEMO_TAIL_MARKER);
  return idx === -1 ? iifeSource : iifeSource.slice(0, idx);
}

export const BROWSER_ACT_RESULT_GLOBAL = '__ruflo_browser_act_result__';

export interface PageAgentPageConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  language?: string;
}

/**
 * Build the full script to hand to `browser_eval` / `agent-browser eval`:
 * the (demo-stripped) IIFE bundle, followed by our own controlled
 * construction + `execute()` call whose settled result lands on a window
 * global we can poll for.
 *
 * KEY-SAFETY: `pageConfig.apiKey` MUST be `PLACEHOLDER_API_KEY` (or another
 * non-secret placeholder) — callers are responsible for routing the real key
 * through `startLocalLLMProxy` first. This function only assembles strings;
 * it does not itself guarantee key safety, so callers MUST NOT pass a real
 * key here (see `browserIntentTools` handler for the enforced call site).
 */
export function buildPageAgentInjection(
  iifeSource: string,
  pageConfig: PageAgentPageConfig,
  task: string,
): string {
  const safeIife = stripDemoAutoInit(iifeSource);
  // Fail-closed: never inject a bundle that still carries the demo endpoint.
  const leak = findDemoLeak(safeIife);
  if (leak) throw new DemoLeakError(leak);
  const cfgJson = JSON.stringify(pageConfig);
  const taskJson = JSON.stringify(task);
  return `${safeIife}
;(function(){
  window.${BROWSER_ACT_RESULT_GLOBAL} = null;
  try {
    if (!window.PageAgent) {
      window.${BROWSER_ACT_RESULT_GLOBAL} = { success: false, error: 'PageAgent not defined after injection' };
      return;
    }
    var agent = new window.PageAgent(${cfgJson});
    window.__ruflo_pageAgent__ = agent;
    agent.execute(${taskJson}).then(function(r){
      window.${BROWSER_ACT_RESULT_GLOBAL} = { success: true, result: r };
    }).catch(function(e){
      window.${BROWSER_ACT_RESULT_GLOBAL} = { success: false, error: String((e && e.message) || e) };
    });
  } catch (e) {
    window.${BROWSER_ACT_RESULT_GLOBAL} = { success: false, error: String((e && e.message) || e) };
  }
})();
'ruflo-browser-act-injected'`;
}

// ============================================================================
// AIDefence content gate (best-effort — @claude-flow/aidefence is itself an
// optional dep; mirrors the lazy-load pattern in security-tools.ts)
// ============================================================================

async function gateWithAIDefence(text: string): Promise<{ text: string; flagged: boolean; gated: boolean }> {
  if (!text) return { text, flagged: false, gated: false };
  try {
    const mod = await import('@claude-flow/aidefence');
    const defender = mod.createAIDefence({ enableLearning: false });
    let flagged = false;
    try {
      const quick = defender.quickScan(text);
      flagged = !!quick?.threat;
    } catch { /* quickScan unavailable on this build */ }
    try {
      if (!flagged && defender.hasPII(text)) flagged = true;
    } catch { /* hasPII unavailable */ }
    if (flagged) {
      return { text: '[content redacted by AIDefence — threat or PII detected]', flagged: true, gated: true };
    }
    return { text, flagged: false, gated: true };
  } catch {
    // @claude-flow/aidefence is itself optional — pass through rather than
    // block the caller when it isn't installed.
    return { text, flagged: false, gated: false };
  }
}

// ============================================================================
// ADR-174 distillation — best-effort trajectory recording into the `browser`
// memory namespace. Never fatal.
// ============================================================================

export async function recordBrowserTrajectory(entry: {
  task: string;
  url?: string;
  success: boolean;
  dataPreview: string;
  steps: number;
  source: string;
}): Promise<boolean> {
  try {
    const slug = entry.task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
    const key = `browser-act-${Date.now()}-${slug}`;
    const result = await storeEntry({
      key,
      namespace: 'browser',
      value: JSON.stringify(entry),
      generateEmbeddingFlag: true,
    });
    return !!result?.success;
  } catch {
    return false;
  }
}

// ============================================================================
// Result polling — `agent-browser eval` doesn't itself await in-page
// promises, so we kick off `execute()` in a fire-and-forget IIFE and poll a
// window global for the settled result.
// ============================================================================

async function pollForResult(session: string, timeoutMs: number): Promise<{ success: boolean; result?: unknown; error?: string } | null> {
  const start = Date.now();
  const pollScript = `JSON.stringify(window.${BROWSER_ACT_RESULT_GLOBAL} || null)`;
  while (Date.now() - start < timeoutMs) {
    const r = await execBrowserCommand(['eval', pollScript], session);
    const text = r.content[0]?.text;
    if (text) {
      let outer: unknown;
      try { outer = JSON.parse(text); } catch { outer = null; }
      const raw = outer && typeof outer === 'object' ? ((outer as Record<string, unknown>).result ?? (outer as Record<string, unknown>).data ?? outer) : outer;
      let parsed: unknown = null;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { parsed = null; }
      } else {
        parsed = raw;
      }
      if (parsed && parsed !== 'null') return parsed as { success: boolean; result?: unknown; error?: string };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  return null;
}

function fail(error: string, extra: Record<string, unknown> = {}): MCPToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, error, ...extra }, null, 2) }],
    isError: true,
  };
}

function ok(payload: Record<string, unknown>): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }, null, 2) }] };
}

function degraded(reason: string, hint: string): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, degraded: true, reason, hint }, null, 2) }] };
}

// ============================================================================
// Tool definition
// ============================================================================

export const browserIntentTools: MCPTool[] = [
  {
    name: 'browser_act',
    description:
      'Use when a target element is easier to describe than to select, or when an intent spans several steps: executes a natural-language instruction on the current page via page-agent (e.g. "Click the login button", "Fill the search box with cats and submit"). ' +
      'Prefer this over chaining browser_snapshot + browser_click/fill for such multi-step intents; pair with browser_open/browser_screenshot for navigation and visual verification (page-agent is text-DOM only, so it is blind to canvas/visual-only UIs — keep the selector + screenshot tools for those). ' +
      'Falls back to {degraded:true} when page-agent is not installed or no OpenAI-compatible LLM provider is configured ' +
      '(set OPENROUTER_API_KEY or OLLAMA_API_KEY; a bare ANTHROPIC_API_KEY is not sufficient — page-agent requires a /chat/completions-shaped endpoint).',
    category: 'browser',
    tags: ['browser', 'intent', 'nl', 'page-agent'],
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Natural-language instruction, e.g. "Click the login button"' },
        session: { type: 'string', description: 'Session ID (default: "default")' },
        url: { type: 'string', description: 'Optional URL to navigate to before executing the intent' },
        timeoutMs: { type: 'number', description: 'Max time to wait for execute() to settle (default 120000)' },
      },
      required: ['task'],
    },
    handler: async (input): Promise<MCPToolResult> => {
      const vTask = validateText(input.task, 'task');
      if (!vTask.valid) return fail(vTask.error || 'invalid task');
      if (input.session) {
        const vS = validateIdentifier(input.session, 'session');
        if (!vS.valid) return fail(vS.error || 'invalid session');
      }
      if (input.url) {
        const vU = validateText(input.url, 'url');
        if (!vU.valid) return fail(vU.error || 'invalid url');
      }

      const task = input.task as string;
      const session = (input.session as string | undefined) || 'default';
      const url = input.url as string | undefined;
      const timeoutMs = typeof input.timeoutMs === 'number' && input.timeoutMs > 0 ? input.timeoutMs : 120_000;

      // 1. page-agent must be installed.
      const bundle = locatePageAgentBundle();
      if (!bundle) {
        return degraded('page-agent not installed', 'npm i page-agent');
      }

      // 2. An OpenAI-compatible LLM provider must be configured.
      const llmConfig = resolvePageAgentLLMConfig();
      if (!llmConfig) {
        return degraded(
          'no OpenAI-compatible LLM provider configured',
          'Set OPENROUTER_API_KEY or OLLAMA_API_KEY (both OpenAI-compatible), or CLAUDE_FLOW_PAGE_AGENT_BASE_URL + CLAUDE_FLOW_PAGE_AGENT_API_KEY for a custom endpoint. ANTHROPIC_API_KEY alone is not sufficient.',
        );
      }

      let iifeSource: string;
      try {
        iifeSource = readFileSync(bundle.iifePath, 'utf-8');
      } catch (err) {
        return degraded('page-agent bundle unreadable', String(err instanceof Error ? err.message : err));
      }

      // 3. Start the loopback proxy — the real key stays server-side.
      let proxy: LLMProxyHandle;
      try {
        proxy = await startLocalLLMProxy({ baseURL: llmConfig.baseURL, apiKey: llmConfig.apiKey });
      } catch (err) {
        return degraded('local LLM proxy failed to start', String(err instanceof Error ? err.message : err));
      }

      try {
        // 4. Navigate first, if requested.
        if (url) {
          const nav = await execBrowserCommand(['open', url], session);
          if (nav.isError) return fail('browser open failed', { detail: nav.content[0]?.text });
        }

        // 5. Inject the (demo-stripped) bundle + our controlled execute() call.
        //    apiKey here is ALWAYS the placeholder — the real key lives only
        //    in `llmConfig`, used above to start the proxy.
        const pageConfig: PageAgentPageConfig = {
          baseURL: proxy.url,
          apiKey: PLACEHOLDER_API_KEY,
          model: llmConfig.model,
          language: 'en-US',
        };
        let script: string;
        try {
          script = buildPageAgentInjection(iifeSource, pageConfig, task);
        } catch (err) {
          if (err instanceof DemoLeakError) {
            // Refuse to inject rather than leak page content to Alibaba's sandbox.
            return degraded('page-agent bundle contains a demo endpoint we could not neutralize', err.message);
          }
          throw err;
        }
        const inject = await execBrowserCommand(['eval', script], session);
        if (inject.isError) return fail('page-agent injection failed', { detail: inject.content[0]?.text });

        // 6. Poll for the settled execute() result.
        const settled = await pollForResult(session, timeoutMs);
        if (!settled) {
          return fail('timed out waiting for page-agent execution', { timeoutMs });
        }
        if (!settled.success) {
          return fail(settled.error || 'page-agent execution failed', { task, url });
        }

        const execResult = settled.result as { success: boolean; data: string; history: unknown[] } | undefined;
        const rawData = execResult?.data ?? '';
        const gate = await gateWithAIDefence(String(rawData));

        // 7. Best-effort ADR-174 trajectory recording.
        await recordBrowserTrajectory({
          task,
          url,
          success: !!execResult?.success,
          dataPreview: gate.text.slice(0, 500),
          steps: execResult?.history?.length ?? 0,
          source: llmConfig.source,
        });

        return ok({
          result: gate.text,
          steps: execResult?.history?.length ?? 0,
          history: execResult?.history ?? [],
          contentFlagged: gate.flagged,
          pageAgentVersion: bundle.version,
          llmSource: llmConfig.source,
        });
      } finally {
        proxy.close();
      }
    },
  },
];

export default browserIntentTools;
