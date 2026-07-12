/**
 * Integration test for the stdio MCP transport unified onto @claude-flow/mcp
 * (ADR-179). Exercises the REAL ruflo tool registry through the same
 * buildBridgedMcpServer() that backs `ruflo mcp start`, driving
 * MCPServer.processRequest exactly as handleMCPMessage does — no child
 * process, so it runs anywhere the package is built.
 *
 * Closes the coverage gaps: real 300+ tool registration + dispatch, protocol
 * negotiation over the bridge, stateless 2026-07-28 requests, and MRTR.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { buildBridgedMcpServer } from '../src/mcp-server.js';
import { inputRequired } from '@claude-flow/mcp';
import type { MCPServer } from '@claude-flow/mcp/server';

type Frame = { jsonrpc: string; id?: string | number; result?: any; error?: { code: number; message: string } };

const initialize = (server: MCPServer, protocolVersion: string): Promise<Frame> =>
  server.processRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  }) as Promise<Frame>;

describe('stdio MCP bridge (ADR-179 unification)', () => {
  let server: MCPServer;

  beforeAll(async () => {
    server = await buildBridgedMcpServer('test-session');
  }, 60_000);

  describe('protocol negotiation', () => {
    it('negotiates a legacy 2024-11-05 client up to 2025-11-25 and keeps the ruflo identity', async () => {
      const res = await initialize(server, '2024-11-05');
      expect(res.result.protocolVersion).toBe('2025-11-25');
      expect(res.result.serverInfo).toEqual({ name: 'ruflo', version: '3.0.0' });
    });

    it('negotiates a 2026-07-28 client to 2026-07-28', async () => {
      const res = await initialize(server, '2026-07-28');
      expect(res.result.protocolVersion).toBe('2026-07-28');
    });
  });

  describe('real tool registry', () => {
    beforeAll(async () => { await initialize(server, '2025-11-25'); });

    it('registers the full ruflo tool registry through the bridge (none dropped)', async () => {
      const res = (await server.processRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' })) as Frame;
      const tools = res.result.tools as Array<{ name: string; inputSchema: unknown }>;
      // The registry is 300+ tools; assert a conservative floor so the test is
      // robust to additions but still catches a registration regression.
      expect(tools.length).toBeGreaterThan(300);
      // Real schemas are advertised (not the empty fallback)
      const agentList = tools.find((t) => t.name === 'agent_list');
      expect(agentList).toBeDefined();
      expect(agentList!.inputSchema).toBeTruthy();
    });

    it('dispatches a real read-only tool and returns its result', async () => {
      const res = (await server.processRequest({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'agent_list', arguments: {} },
      })) as Frame;
      expect(res.result.isError).toBe(false);
      const text = res.result.content[0].text as string;
      expect(text).toContain('agents');
    });

    it('dispatches swarm_status', async () => {
      const res = (await server.processRequest({
        jsonrpc: '2.0', id: 4, method: 'tools/call',
        params: { name: 'swarm_status', arguments: {} },
      })) as Frame;
      expect(res.result.isError).toBe(false);
    });

    it('returns an isError result for an unknown tool (not a crash)', async () => {
      const res = (await server.processRequest({
        jsonrpc: '2.0', id: 5, method: 'tools/call',
        params: { name: 'definitely_not_a_tool', arguments: {} },
      })) as Frame;
      expect(res.result.isError).toBe(true);
      expect(res.result.content[0].text).toMatch(/not found/i);
    });

    it('does not reject loose arguments (validateInput:false preserves raw stdio behavior)', async () => {
      // agent_list has an inputSchema but the bridge disables execute-time
      // validation, so an empty/loose call still reaches the handler.
      const res = (await server.processRequest({
        jsonrpc: '2.0', id: 6, method: 'tools/call',
        params: { name: 'agent_list', arguments: { bogus: 123 } },
      })) as Frame;
      expect(res.result.isError).toBe(false);
    });
  });

  describe('stateless 2026-07-28 requests over the bridge', () => {
    it('serves a tool call without initialize when the request carries the 2026-07-28 protocol header', async () => {
      // Fresh server so no prior initialize/session exists.
      const stateless = await buildBridgedMcpServer('stateless-session');
      const res = (await stateless.processRequest({
        jsonrpc: '2.0', id: 7, method: 'tools/call',
        params: { name: 'agent_list', arguments: {} },
        meta: { protocolVersion: '2026-07-28', transport: 'http', clientKey: '127.0.0.1' },
      } as any)) as Frame;
      expect(res.error).toBeUndefined();
      expect(res.result.isError).toBe(false);
    });
  });

  describe('MRTR over the bridge', () => {
    it('pauses and resumes a tool for a 2026-07-28 client', async () => {
      const s = await buildBridgedMcpServer('mrtr-session');
      // Register a synthetic MRTR tool alongside the real registry.
      s.registerTool({
        name: 'confirm_action',
        description: 'Requires confirmation',
        inputSchema: { type: 'object', properties: {} },
        handler: async () =>
          inputRequired('Confirm?', async (answer) => `confirmed:${answer}`, { type: 'string', enum: ['yes', 'no'] }),
      });
      const meta = { protocolVersion: '2026-07-28' };

      const paused = (await s.processRequest({
        jsonrpc: '2.0', id: 8, method: 'tools/call',
        params: { name: 'confirm_action', arguments: {} }, meta,
      } as any)) as Frame;
      expect(paused.result.type).toBe('input_required');
      expect(paused.result.continuationToken).toBeTruthy();

      const resumed = (await s.processRequest({
        jsonrpc: '2.0', id: 9, method: 'tools/call',
        params: { continuationToken: paused.result.continuationToken, input: 'yes' }, meta,
      } as any)) as Frame;
      expect(resumed.result.isError).toBe(false);
      expect(resumed.result.content[0].text).toContain('confirmed:yes');
    });
  });
});
