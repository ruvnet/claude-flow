/**
 * @claude-flow/mcp - MCP 2026-07-28 Specification Tests (ADR-179)
 *
 * Covers: protocol version negotiation, opt-in stateless mode, MRTR
 * (InputRequiredResult + continuations), error-code standardization,
 * transport-header helpers, deprecations, and OAuth hardening (RFC 9207).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMCPServer,
  createContinuationManager,
  inputRequired,
  isPendingInputRequest,
  negotiateProtocolVersion,
  isStatelessProtocol,
  supportsMrtr,
  extractMcpName,
  PROTOCOL_2025_11_25,
  PROTOCOL_2026_07_28,
  SUPPORTED_PROTOCOL_VERSIONS,
  DEPRECATED_METHODS_2026_07_28,
  ErrorCodes,
  createOAuthManager,
} from '../src/index.js';
import type { ILogger, MCPRequest, MCPResponse } from '../src/types.js';
import type { InputRequiredResult } from '../src/mrtr.js';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const initializeRequest = (protocolVersion: string): MCPRequest => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  },
});

describe('MCP 2026-07-28 specification', () => {
  describe('protocol negotiation', () => {
    it('supports both revisions, newest first', () => {
      expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual([PROTOCOL_2026_07_28, PROTOCOL_2025_11_25]);
    });

    it('echoes a supported requested version', () => {
      expect(negotiateProtocolVersion(PROTOCOL_2026_07_28)).toBe(PROTOCOL_2026_07_28);
      expect(negotiateProtocolVersion(PROTOCOL_2025_11_25)).toBe(PROTOCOL_2025_11_25);
    });

    it('falls back to 2025-11-25 for unknown or missing versions', () => {
      expect(negotiateProtocolVersion('2025-06-18')).toBe(PROTOCOL_2025_11_25);
      expect(negotiateProtocolVersion(undefined)).toBe(PROTOCOL_2025_11_25);
    });

    it('classifies stateless and MRTR support by revision', () => {
      expect(isStatelessProtocol(PROTOCOL_2026_07_28)).toBe(true);
      expect(isStatelessProtocol(PROTOCOL_2025_11_25)).toBe(false);
      expect(supportsMrtr(PROTOCOL_2026_07_28)).toBe(true);
      expect(supportsMrtr(PROTOCOL_2025_11_25)).toBe(false);
    });

    it('marks roots, sampling, and logging deprecated', () => {
      expect(DEPRECATED_METHODS_2026_07_28.has('sampling/createMessage')).toBe(true);
      expect(DEPRECATED_METHODS_2026_07_28.has('logging/setLevel')).toBe(true);
      expect(DEPRECATED_METHODS_2026_07_28.has('roots/list')).toBe(true);
      expect(DEPRECATED_METHODS_2026_07_28.has('tools/call')).toBe(false);
    });
  });

  describe('standard error codes', () => {
    it('no longer conflates authorization failure with SERVER_NOT_INITIALIZED', () => {
      expect(ErrorCodes.SERVER_NOT_INITIALIZED).toBe(-32002);
      expect(ErrorCodes.AUTHORIZATION_FAILED).toBe(-32003);
      expect(ErrorCodes.AUTHORIZATION_FAILED).not.toBe(ErrorCodes.SERVER_NOT_INITIALIZED);
    });
  });

  describe('transport header helpers', () => {
    it('derives Mcp-Name for tool, prompt, and resource requests', () => {
      expect(extractMcpName({ method: 'tools/call', params: { name: 'my-tool' } })).toBe('my-tool');
      expect(extractMcpName({ method: 'prompts/get', params: { name: 'my-prompt' } })).toBe('my-prompt');
      expect(extractMcpName({ method: 'resources/read', params: { uri: 'file:///x' } })).toBe('file:///x');
      expect(extractMcpName({ method: 'tools/list', params: {} })).toBeUndefined();
    });
  });

  describe('server version negotiation', () => {
    let server: ReturnType<typeof createMCPServer>;

    beforeEach(() => {
      server = createMCPServer({ name: 'Test', transport: 'in-process' }, createMockLogger());
    });

    afterEach(async () => {
      await server.stop();
    });

    it('echoes 2026-07-28 when requested and omits deprecated capabilities', async () => {
      const response = await server.processRequest(initializeRequest(PROTOCOL_2026_07_28));
      const result = response.result as { protocolVersion: string; capabilities: Record<string, unknown> };

      expect(result.protocolVersion).toBe(PROTOCOL_2026_07_28);
      expect(result.capabilities.tools).toBeDefined();
      expect(result.capabilities.resources).toBeDefined();
      expect(result.capabilities.prompts).toBeDefined();
      expect(result.capabilities.sampling).toBeUndefined();
      expect(result.capabilities.logging).toBeUndefined();
    });

    it('keeps 2025-11-25 sessions unchanged, including sampling capability', async () => {
      const response = await server.processRequest(initializeRequest(PROTOCOL_2025_11_25));
      const result = response.result as { protocolVersion: string; capabilities: Record<string, unknown> };

      expect(result.protocolVersion).toBe(PROTOCOL_2025_11_25);
      expect(result.capabilities.sampling).toBeDefined();
      expect(result.capabilities.logging).toBeDefined();
    });

    it('falls back to 2025-11-25 for pre-2026 clients', async () => {
      const response = await server.processRequest(initializeRequest('2025-06-18'));
      const result = response.result as { protocolVersion: string };
      expect(result.protocolVersion).toBe(PROTOCOL_2025_11_25);
    });
  });

  describe('stateless mode', () => {
    afterEach(vi.restoreAllMocks);

    it('rejects uninitialized requests when stateful (legacy behavior preserved)', async () => {
      const server = createMCPServer({ name: 'Test', transport: 'in-process' }, createMockLogger());
      const response = await server.processRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });
      expect(response.error?.code).toBe(ErrorCodes.SERVER_NOT_INITIALIZED);
      await server.stop();
    });

    it('serves requests without initialize when statelessMode is enabled', async () => {
      const server = createMCPServer(
        { name: 'Test', transport: 'in-process', statelessMode: true },
        createMockLogger()
      );
      const response = await server.processRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'ping',
      });
      expect(response.error).toBeUndefined();
      expect((response.result as { pong: boolean }).pong).toBe(true);
      await server.stop();
    });

    it('serves requests statelessly when the transport saw a 2026-07-28 protocol header', async () => {
      const server = createMCPServer({ name: 'Test', transport: 'in-process' }, createMockLogger());
      server.registerTool({
        name: 'echo',
        description: 'Echo input',
        inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
        handler: async (input: unknown) => input,
      });

      const response = await server.processRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'echo', arguments: { value: 'hi' } },
        meta: { protocolVersion: PROTOCOL_2026_07_28, transport: 'http', clientKey: '127.0.0.1' },
      });

      expect(response.error).toBeUndefined();
      const result = response.result as { isError: boolean; content: Array<{ text?: string }> };
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain('hi');
      await server.stop();
    });
  });

  describe('MRTR (multi round-trip requests)', () => {
    const registerConfirmTool = (server: ReturnType<typeof createMCPServer>) => {
      server.registerTool({
        name: 'confirm-delete',
        description: 'Deletes records after confirmation',
        inputSchema: { type: 'object', properties: {} },
        handler: async () =>
          inputRequired(
            'Confirm deletion of 42 records',
            async (answer) => (answer === 'yes' ? 'deleted 42 records' : 'aborted'),
            { type: 'string', enum: ['yes', 'no'] }
          ),
      });
    };

    it('pauses and resumes a tool across two round trips on 2026-07-28', async () => {
      const server = createMCPServer(
        { name: 'Test', transport: 'in-process', statelessMode: true },
        createMockLogger()
      );
      registerConfirmTool(server);

      const first = await server.processRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'confirm-delete', arguments: {} },
        meta: { protocolVersion: PROTOCOL_2026_07_28 },
      });

      const paused = first.result as InputRequiredResult;
      expect(paused.type).toBe('input_required');
      expect(paused.message).toContain('Confirm deletion');
      expect(paused.continuationToken).toBeTruthy();
      expect(paused.inputSchema?.enum).toEqual(['yes', 'no']);
      expect(server.getContinuationManager().getPendingCount()).toBe(1);

      const second = await server.processRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { continuationToken: paused.continuationToken, input: 'yes' },
        meta: { protocolVersion: PROTOCOL_2026_07_28 },
      });

      const final = second.result as { isError: boolean; content: Array<{ text?: string }> };
      expect(final.isError).toBe(false);
      expect(final.content[0].text).toContain('deleted 42 records');
      expect(server.getContinuationManager().getPendingCount()).toBe(0);
      await server.stop();
    });

    it('rejects unknown continuation tokens', async () => {
      const server = createMCPServer(
        { name: 'Test', transport: 'in-process', statelessMode: true },
        createMockLogger()
      );
      const response = await server.processRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { continuationToken: 'bogus', input: 'yes' },
      });
      expect(response.error?.code).toBe(ErrorCodes.INVALID_PARAMS);
      await server.stop();
    });

    it('downgrades input_required to a terminal error for 2025-11-25 sessions', async () => {
      const server = createMCPServer({ name: 'Test', transport: 'in-process' }, createMockLogger());
      registerConfirmTool(server);

      await server.processRequest(initializeRequest(PROTOCOL_2025_11_25));
      const response = await server.processRequest({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'confirm-delete', arguments: {} },
      });

      const result = response.result as { isError: boolean; content: Array<{ text?: string }> };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('2026-07-28');
      expect(server.getContinuationManager().getPendingCount()).toBe(0);
      await server.stop();
    });

    it('identifies pending input requests created by the helper', () => {
      const pending = inputRequired('need input', async () => 'ok');
      expect(isPendingInputRequest(pending)).toBe(true);
      expect(isPendingInputRequest({ message: 'need input' })).toBe(false);
      expect(isPendingInputRequest(null)).toBe(false);
    });

    it('expires continuations after their TTL', async () => {
      const manager = createContinuationManager(createMockLogger(), { ttl: -1 });
      const wire = manager.register(inputRequired('x', async () => 'y'), 'tool');
      await expect(manager.resume(wire.continuationToken, 'input')).rejects.toThrow(/expired/i);
      manager.destroy();
    });

    it('supports chained round trips (resume returns another input_required)', async () => {
      const server = createMCPServer(
        { name: 'Test', transport: 'in-process', statelessMode: true },
        createMockLogger()
      );
      server.registerTool({
        name: 'two-step',
        description: 'Requires two inputs',
        inputSchema: { type: 'object', properties: {} },
        handler: async () =>
          inputRequired('first?', async (a) =>
            inputRequired('second?', async (b) => `${a}+${b}`)
          ),
      });

      const meta = { protocolVersion: PROTOCOL_2026_07_28 };
      const r1 = await server.processRequest({
        jsonrpc: '2.0', id: 9, method: 'tools/call',
        params: { name: 'two-step', arguments: {} }, meta,
      });
      const p1 = r1.result as InputRequiredResult;
      expect(p1.type).toBe('input_required');

      const r2 = await server.processRequest({
        jsonrpc: '2.0', id: 10, method: 'tools/call',
        params: { continuationToken: p1.continuationToken, input: 'a' }, meta,
      });
      const p2 = r2.result as InputRequiredResult;
      expect(p2.type).toBe('input_required');
      expect(p2.message).toBe('second?');

      const r3 = await server.processRequest({
        jsonrpc: '2.0', id: 11, method: 'tools/call',
        params: { continuationToken: p2.continuationToken, input: 'b' }, meta,
      });
      const final = r3.result as { content: Array<{ text?: string }> };
      expect(final.content[0].text).toContain('a+b');
      await server.stop();
    });
  });

  describe('deprecated methods stay functional', () => {
    it('still routes logging/setLevel for 2026-07-28 clients, with a warning', async () => {
      const logger = createMockLogger();
      const server = createMCPServer(
        { name: 'Test', transport: 'in-process', statelessMode: true },
        logger
      );
      const response = await server.processRequest({
        jsonrpc: '2.0',
        id: 12,
        method: 'logging/setLevel',
        params: { level: 'debug' },
        meta: { protocolVersion: PROTOCOL_2026_07_28 },
      });
      expect((response.result as { success: boolean }).success).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Deprecated'),
        expect.objectContaining({ method: 'logging/setLevel' })
      );
      await server.stop();
    });
  });

  describe('OAuth hardening (RFC 9207 / MCP 2026-07-28)', () => {
    const oauthConfig = {
      clientId: 'client-1',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      redirectUri: 'https://app.example.com/callback',
      issuer: 'https://auth.example.com',
    };

    afterEach(vi.restoreAllMocks);

    it('rejects a code exchange when iss is missing', async () => {
      const manager = createOAuthManager(createMockLogger(), oauthConfig);
      const { state } = manager.createAuthorizationRequest();
      await expect(manager.exchangeCode('code', state)).rejects.toThrow(/iss.*RFC 9207/);
      manager.destroy();
    });

    it('rejects a code exchange when iss does not match the configured issuer', async () => {
      const manager = createOAuthManager(createMockLogger(), oauthConfig);
      const { state } = manager.createAuthorizationRequest();
      await expect(
        manager.exchangeCode('code', state, { iss: 'https://evil.example.com' })
      ).rejects.toThrow(/does not match/);
      manager.destroy();
    });

    it('accepts a matching iss and binds tokens to the issuer', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: 'at', token_type: 'Bearer', expires_in: 3600 }),
      })) as unknown as typeof fetch);

      const manager = createOAuthManager(createMockLogger(), oauthConfig);
      const { state } = manager.createAuthorizationRequest();
      const tokens = await manager.exchangeCode('code', state, { iss: oauthConfig.issuer });

      expect(tokens.accessToken).toBe('at');
      expect(tokens.issuer).toBe(oauthConfig.issuer);
      expect(await manager.getAccessToken()).toBe('at');
      manager.destroy();
      vi.unstubAllGlobals();
    });

    it('refuses to present tokens bound to a different issuer', async () => {
      const logger = createMockLogger();
      const manager = createOAuthManager(logger, oauthConfig);
      // Simulate storage carrying tokens minted by another server
      await (manager as unknown as { tokenStorage: { save: (k: string, t: unknown) => Promise<void> } })
        .tokenStorage.save('default', {
          accessToken: 'foreign',
          tokenType: 'Bearer',
          issuer: 'https://other.example.com',
        });

      expect(await manager.getAccessToken()).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
      manager.destroy();
    });
  });
});
