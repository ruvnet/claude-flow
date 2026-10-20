import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callAnthropicMessages } from '../src/mcp-tools/agent-execute-core.js';

describe('Anthropic-compatible gateway configuration (#3100)', () => {
  let server: Server;
  let base: string;
  let dir: string;
  const requests: Array<{url?: string; headers: Record<string, unknown>; body: unknown}> = [];
  beforeEach(async () => {
    requests.length = 0;
    dir = mkdtempSync(join(tmpdir(), 'ruflo-anthropic-gateway-'));
    vi.stubEnv('CLAUDE_FLOW_CWD', dir);
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENROUTER_API_KEY', 'OLLAMA_API_KEY', 'RUFLO_PROVIDER']) vi.stubEnv(key, '');
    server = createServer(async (req, res) => {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push({url: req.url, headers: req.headers, body: JSON.parse(body)});
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({id:'gateway-message', model:'test-model', content:[{type:'text',text:'gateway result'}], stop_reason:'end_turn', usage:{input_tokens:2,output_tokens:3}}));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
    // A failing baseline must never contact Anthropic or another real provider.
    const localFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      if (!url.startsWith(base + '/')) return Promise.resolve(new Response('unexpected external endpoint', {status:400}));
      return localFetch(url, init);
    }));
  });
  afterEach(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, {recursive:true,force:true});
  });

  it.each(['', '/proxy/'])('honors the configured gateway base and path prefix %s', async prefix => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-api-key');
    vi.stubEnv('ANTHROPIC_BASE_URL', base + prefix);
    const result = await callAnthropicMessages({prompt:'hello', model:'test-model'});
    expect(result).toMatchObject({success:true, output:'gateway result'});
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(prefix ? '/proxy/v1/messages' : '/v1/messages');
    expect(requests[0].headers['x-api-key']).toBe('test-api-key');
    expect(requests[0].headers.authorization).toBeUndefined();
  });

  it('accepts a bearer-only gateway configuration without an Anthropic API key', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-bearer');
    vi.stubEnv('ANTHROPIC_BASE_URL', base);
    const result = await callAnthropicMessages({prompt:'hello'});
    expect(result).toMatchObject({success:true, usage:{totalTokens:5}});
    expect(requests[0].headers.authorization).toBe('Bearer test-bearer');
    expect(requests[0].headers['x-api-key']).toBeUndefined();
  });

  it('does not infer another provider when an Anthropic bearer credential exists', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'test-bearer');
    vi.stubEnv('ANTHROPIC_BASE_URL', base);
    vi.stubEnv('OPENROUTER_API_KEY', 'other-provider');
    expect((await callAnthropicMessages({prompt:'hello'})).success).toBe(true);
    expect(requests).toHaveLength(1);
  });
});
