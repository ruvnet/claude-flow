import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callAnthropicMessages } from '../src/mcp-tools/agent-execute-core.js';

const providers = ['anthropic', 'openrouter', 'ollama'] as const;
describe('provider request lifetime', () => {
  let dir: string;
  let server: Server | undefined;
  let releaseBody: ReturnType<typeof setTimeout> | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-provider-deadline-'));
    vi.stubEnv('CLAUDE_FLOW_CWD', dir);
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENROUTER_API_KEY', 'OLLAMA_API_KEY', 'RUFLO_PROVIDER', 'OLLAMA_BASE_URL', 'OPENROUTER_BASE_URL']) vi.stubEnv(key, '');
  });
  afterEach(async () => {
    if (releaseBody) clearTimeout(releaseBody);
    releaseBody = undefined;
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
    server = undefined;
    vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
    rmSync(dir, {recursive: true, force: true});
  });

  it.each(providers)('keeps the %s deadline active after headers and cancels a stalled body', async provider => {
    vi.stubEnv(`${provider.toUpperCase()}_API_KEY`, 'test-credential');
    let cancelled = false;
    let headersSent = false;
    server = createServer((_req, res) => {
      res.on('close', () => { cancelled = !res.writableEnded; });
      res.writeHead(200, {'content-type':'application/json'}); res.flushHeaders(); headersSent = true;
      // Bounded even on the broken implementation: no hanging test/server.
      releaseBody = setTimeout(() => res.end(JSON.stringify({
        id:'late', model:'test-model', content:[{type:'text',text:'late result'}],
        choices:[{message:{content:'late result'},finish_reason:'stop'}],
        usage:{input_tokens:1,output_tokens:1}, stop_reason:'end_turn',
      })), 2000);
    });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const localFetch = globalThis.fetch;
    // Exercise real HTTP body cancellation, while preventing provider API spend.
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => localFetch(base + new URL(url).pathname, init));
    const result = await callAnthropicMessages({prompt:'test', provider, timeoutMs:500});
    expect(headersSent).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/abort|timeout/i);
    await vi.waitFor(() => expect(cancelled).toBe(true), {timeout:1000});
  });

  it.each(providers)('clears the %s timer when fetch rejects', async provider => {
    vi.stubEnv(`${provider.toUpperCase()}_API_KEY`, 'test-credential');
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection refused')));
    expect((await callAnthropicMessages({prompt:'test',provider,timeoutMs:10000})).success).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
