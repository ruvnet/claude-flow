import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { xFederationTools } from '../src/mcp-tools/x-federation-tools.js';
import { seraphinaTools } from '../src/mcp-tools/seraphina-tools.js';

const call = (name: string, args: Record<string, unknown> = {}) =>
  [...xFederationTools, ...seraphinaTools].find(t => t.name === name)!.handler(args, {} as any);
const writes = ['x_federation_publish', 'x_federation_invite_mint', 'x_federation_admit'];
const reads = ['x_federation_sync', 'x_federation_roster', 'x_federation_claims', 'x_federation_registry'];

describe('MCP service destinations are operator-controlled', () => {
  beforeEach(() => {
    vi.stubEnv('RUFLO_X_ADMIN_TOKEN', 'SYNTHETIC-ADMIN-CANARY');
    vi.stubEnv('SERAPHINA_METALLM_KEY', 'SYNTHETIC-LLM-CANARY');
    vi.stubEnv('RUFLO_X_GATEWAY_URL', 'https://trusted-gateway.example');
    vi.stubEnv('SERAPHINA_METALLM_URL', 'https://trusted-llm.example');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url.endsWith('/v1/messages')) return Response.json({ content: [{ text: '{"guidance":"safe","proposals":[],"risks":[]}' }] });
      const result = body.method === 'resources/read'
        ? { contents: [{ text: '{}' }] }
        : { content: [{ text: '{}' }] };
      return Response.json({ jsonrpc: '2.0', id: 1, result });
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each([...writes, ...reads])('%s rejects an attacker URL before any request', async name => {
    await expect(call(name, { gatewayUrl: 'https://attacker.example', msgType: 'Status', payload: {}, pubkey: 'a'.repeat(64) }))
      .rejects.toThrow(/configured/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['metaLlmUrl', 'gatewayUrl'])('Seraphina rejects %s before reading swarm data or sending its key', async field => {
    await expect(call('seraphina_guidance', { goal: 'test', [field]: 'https://attacker.example' })).rejects.toThrow(/configured/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['http://127.0.0.1:19999', 'http://169.254.169.254', 'file:///etc/passwd', 'https://trusted-gateway.example@attacker.example', 'https://trusted-gateway.example:444', 'https://trusted-gateway.example/other', 'https://trusted-gateway.example?x=1', 'https://trusted-gateway.example#x', {}, 0, false])('rejects hostile or malformed override %j', async gatewayUrl => {
    await expect(call('x_federation_publish', { gatewayUrl, msgType: 'Status', payload: {} })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(writes)('%s sends its canary only to the configured gateway and disables redirects', async name => {
    await call(name, { gatewayUrl: 'https://trusted-gateway.example/', msgType: 'Status', payload: {}, pubkey: 'a'.repeat(64) });
    expect(fetch).toHaveBeenCalledWith('https://trusted-gateway.example/mcp', expect.objectContaining({ redirect: 'error' }));
    const init = vi.mocked(fetch).mock.calls[0][1]!;
    expect(JSON.parse(String(init.body)).params.arguments.adminToken).toBe('SYNTHETIC-ADMIN-CANARY');
    expect(JSON.parse(String(init.body)).params.arguments.gatewayUrl).toBeUndefined();
  });
  it('Seraphina uses configured services, retains tier selection and disables redirects everywhere', async () => {
    await call('seraphina_guidance', { goal: 'test', tier: 'cognitum-high', metaLlmUrl: 'https://trusted-llm.example/', gatewayUrl: 'https://trusted-gateway.example' });
    expect(fetch).toHaveBeenCalledTimes(4);
    for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.redirect).toBe('error');
    expect(fetch).toHaveBeenLastCalledWith('https://trusted-llm.example/v1/messages', expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'SYNTHETIC-LLM-CANARY' }) }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body)).model).toBe('cognitum-high');
  });
  it.each(['http://public.example', 'http://localhost.attacker.example', 'http://127.0.0.1.nip.io', 'http://10.0.0.1', 'file:///tmp/test', 'https://user:pass@trusted.example', 'https://trusted.example?x=1', 'https://trusted.example#x'])('rejects unsafe operator configuration %s', async value => {
    vi.stubEnv('RUFLO_X_GATEWAY_URL', value);
    await expect(call('x_federation_sync')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([undefined, null, ''])('an absent override (%j) asserts nothing: the configured gateway is used', async gatewayUrl => {
    await call('x_federation_sync', { gatewayUrl });
    expect(fetch).toHaveBeenCalledWith('https://trusted-gateway.example/mcp', expect.objectContaining({ redirect: 'error' }));
  });
  it('operator config may name a loopback HTTP service; a matching assertion passes, another port does not', async () => {
    vi.stubEnv('RUFLO_X_GATEWAY_URL', 'http://localhost:8080');
    await call('x_federation_sync', { gatewayUrl: 'http://localhost:8080/' });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/mcp', expect.anything());
    vi.mocked(fetch).mockClear();
    await expect(call('x_federation_publish', { gatewayUrl: 'http://localhost:9999', msgType: 'Status', payload: {} })).rejects.toThrow(/must match/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('validates the LLM configuration before any gateway fetch', async () => {
    vi.stubEnv('SERAPHINA_METALLM_URL', 'http://public.example');
    await expect(call('seraphina_guidance', { goal: 'test' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
