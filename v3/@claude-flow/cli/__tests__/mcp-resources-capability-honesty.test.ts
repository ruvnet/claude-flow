import { describe, expect, it, vi } from 'vitest';

// ADR-490 e2e finding: `ruflo mcp start` advertised `resources: { subscribe, listChanged }` in `initialize` but answered every resources/*
// request with -32601. Codex 0.162.0 offers the model a list_mcp_resources tool for any MCP server, the model called it first, got
// "Method not found: resources/list", and gave up before reaching the ruflo tools. A server that declares a capability must serve its methods.
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: vi.fn(), hasTool: () => false, listMCPTools: () => [] }));
vi.mock('../src/mcp-tools/request-tracker.js', () => ({ trackRequest: vi.fn() }));
vi.mock('../src/mcp-tools/policy-enforcer.js', () => ({ isPolicyEnforcementEnabled: () => false }));

const { MCPServerManager } = await import('../src/mcp-server.js');
const manager = new MCPServerManager({ transport: 'stdio' });
const send = (method: string, params: unknown = {}) =>
  (manager as any).handleMCPMessage({ jsonrpc: '2.0', id: 1, method, params }, 'test-session');

describe('MCP resources capability is honest', () => {
  it('serves resources/list and resources/templates/list (empty, but answered) as long as it advertises resources', async () => {
    const init = await send('initialize');
    const advertised = Boolean(init.result.capabilities.resources);
    const list = await send('resources/list');
    const templates = await send('resources/templates/list');
    if (advertised) {
      expect(list.error).toBeUndefined();
      expect(list.result).toEqual({ resources: [] });
      expect(templates.error).toBeUndefined();
      expect(templates.result).toEqual({ resourceTemplates: [] });
    }
    // either way, never advertise something the switch cannot serve
    expect(advertised ? list.error : undefined).toBeUndefined();
  });

  it('does not claim subscribe/listChanged for resources it never emits or accepts', async () => {
    const init = await send('initialize');
    const caps = init.result.capabilities.resources ?? {};
    expect(caps.subscribe).not.toBe(true);
    expect(caps.listChanged).not.toBe(true);
  });

  it('answers resources/read for an unknown uri with the spec "resource not found" error, not method-not-found', async () => {
    const read = await send('resources/read', { uri: 'ruflo://nope' });
    expect(read.error.code).toBe(-32002);
  });
});
