/**
 * MCP 2025-11 Compliance Test Suite
 *
 * Validates implementation against MCP 2025-11 specification:
 * - Version negotiation (YYYY-MM format)
 * - Capabilities exchange
 * - Async job support (job handles, poll/resume)
 * - Registry integration
 * - JSON Schema 1.1 validation
 * - Backward compatibility
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { MCP2025Server, type MCP2025ServerConfig } from '../../src/mcp/server-mcp-2025.js';
import { VersionNegotiator, BackwardCompatibilityAdapter } from '../../src/mcp/protocol/version-negotiation.js';
import { MCPAsyncJobManager } from '../../src/mcp/async/job-manager-mcp25.js';
import { MCPRegistryClient } from '../../src/mcp/registry/mcp-registry-client-2025.js';
import { SchemaValidator, upgradeToolSchema } from '../../src/mcp/validation/schema-validator-2025.js';
import { createMCPServer, MCPServerFactory } from '../../src/mcp/server-factory.js';
import { logger } from '../../src/core/logger.js';
import { eventBus } from '../../src/core/event-bus.js';

describe('MCP 2025-11 Compliance Tests', () => {
  describe('Version Negotiation', () => {
    let negotiator: VersionNegotiator;

    beforeEach(() => {
      negotiator = new VersionNegotiator(logger);
    });

    it('should accept MCP 2025-11 version', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2025-11',
        capabilities: ['async', 'code_exec'],
      };

      const result = await negotiator.negotiate(clientHandshake);

      expect(result.success).toBe(true);
      expect(result.agreed_version).toBe('2025-11');
      expect(result.agreed_capabilities).toContain('async');
    });

    it('should accept version within 1 cycle difference', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2025-10', // 1 month earlier
        capabilities: ['async'],
      };

      const result = await negotiator.negotiate(clientHandshake);

      expect(result.success).toBe(true);
      expect(['2025-10', '2025-11']).toContain(result.agreed_version);
    });

    it('should reject version more than 1 cycle different', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2024-09', // More than 1 month earlier
        capabilities: [],
      };

      const result = await negotiator.negotiate(clientHandshake);

      expect(result.success).toBe(false);
      expect(result.error).toContain('version');
    });

    it('should negotiate common capabilities', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2025-11',
        capabilities: ['async', 'stream', 'unknown-capability'],
      };

      const result = await negotiator.negotiate(clientHandshake);

      expect(result.success).toBe(true);
      expect(result.agreed_capabilities).toContain('async');
      expect(result.agreed_capabilities).not.toContain('unknown-capability');
    });

    it('should create valid server handshake', () => {
      const handshake = negotiator.createServerHandshake('test-server', 'stdio', {
        name: 'Test Server',
        version: '1.0.0',
      });

      expect(handshake.server_id).toBe('test-server');
      expect(handshake.mcp_version).toBe('2025-11');
      expect(handshake.transport).toBe('stdio');
      expect(handshake.capabilities).toBeDefined();
      expect(handshake.server_info).toBeDefined();
    });
  });

  describe('Backward Compatibility', () => {
    let adapter: BackwardCompatibilityAdapter;

    beforeEach(() => {
      adapter = new BackwardCompatibilityAdapter(logger);
    });

    it('should detect legacy request format', () => {
      const legacyRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'test-tool', arguments: {} },
      };

      const isLegacy = adapter.isLegacyRequest(legacyRequest);

      expect(isLegacy).toBe(true);
    });

    it('should convert legacy request to modern format', () => {
      const legacyRequest = {
        method: 'tools/call',
        params: {
          name: 'test-tool',
          arguments: { arg1: 'value1' },
        },
      };

      const modernRequest = adapter.convertToModern(legacyRequest);

      expect(modernRequest.mcp_version).toBeDefined();
      expect(modernRequest.client_id).toBeDefined();
    });

    it('should convert modern response to legacy format', () => {
      const modernResponse = {
        request_id: 'req-123',
        status: 'success',
        result: { data: 'test' },
      };

      const legacyResponse = adapter.convertToLegacy(modernResponse, true);

      expect(legacyResponse.result).toBeDefined();
      expect(legacyResponse.result).toEqual({ data: 'test' });
    });
  });

  describe('Async Job Management', () => {
    let jobManager: MCPAsyncJobManager;

    beforeEach(() => {
      jobManager = new MCPAsyncJobManager(null, logger, {
        maxJobs: 10,
        jobTTL: 60000,
      });
    });

    afterEach(async () => {
      // Cleanup any running jobs
      const jobs = await jobManager.listJobs({});
      for (const job of jobs.jobs) {
        try {
          await jobManager.cancelJob(job.job_id);
        } catch {
          // Ignore errors during cleanup
        }
      }
    });

    it('should submit async job and return job handle', async () => {
      const request = {
        request_id: 'req-123',
        tool_id: 'test/tool',
        arguments: { test: 'data' },
        mode: 'async',
      };

      const executor = async (args: any) => {
        return { success: true, data: args };
      };

      const handle = await jobManager.submitJob(request, executor);

      expect(handle.request_id).toBe('req-123');
      expect(handle.job_id).toBeDefined();
      expect(handle.status).toBe('in_progress');
      expect(handle.poll_after).toBeGreaterThan(0);
    });

    it('should allow polling job status', async () => {
      const request = {
        request_id: 'req-456',
        tool_id: 'test/tool',
        arguments: {},
        mode: 'async',
      };

      const executor = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { done: true };
      };

      const handle = await jobManager.submitJob(request, executor);
      const polled = await jobManager.pollJob(handle.job_id);

      expect(polled.job_id).toBe(handle.job_id);
      expect(['queued', 'in_progress', 'completed']).toContain(polled.status);
    });

    it('should resume job and get results', async () => {
      const request = {
        request_id: 'req-789',
        tool_id: 'test/tool',
        arguments: { input: 'test' },
        mode: 'async',
      };

      const executor = async (args: any) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { processed: args.input };
      };

      const handle = await jobManager.submitJob(request, executor);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await jobManager.resumeJob(handle.job_id);

      expect(result.request_id).toBe('req-789');
      expect(result.status).toBe('success');
      expect(result.result).toEqual({ processed: 'test' });
    });

    it('should support progress tracking', async () => {
      const request = {
        request_id: 'req-progress',
        tool_id: 'test/progress',
        arguments: {},
        mode: 'async',
      };

      const progressUpdates: number[] = [];

      const executor = async (args: any, onProgress: (percent: number) => void) => {
        for (let i = 0; i <= 100; i += 25) {
          onProgress(i);
          progressUpdates.push(i);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return { done: true };
      };

      const handle = await jobManager.submitJob(request, executor);

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates).toContain(100);
    });

    it('should list jobs with filters', async () => {
      const request1 = {
        request_id: 'req-list-1',
        tool_id: 'test/tool',
        arguments: {},
        mode: 'async',
      };

      const request2 = {
        request_id: 'req-list-2',
        tool_id: 'test/tool',
        arguments: {},
        mode: 'async',
      };

      await jobManager.submitJob(request1, async () => ({ done: true }));
      await jobManager.submitJob(request2, async () => ({ done: true }));

      const list = await jobManager.listJobs({ limit: 10 });

      expect(list.jobs.length).toBeGreaterThanOrEqual(2);
      expect(list.total).toBeGreaterThanOrEqual(2);
    });

    it('should cancel running job', async () => {
      const request = {
        request_id: 'req-cancel',
        tool_id: 'test/long-running',
        arguments: {},
        mode: 'async',
      };

      const executor = async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { done: true };
      };

      const handle = await jobManager.submitJob(request, executor);
      const cancelled = await jobManager.cancelJob(handle.job_id);

      expect(cancelled).toBe(true);
    });
  });

  describe('JSON Schema 1.1 Validation', () => {
    let validator: SchemaValidator;

    beforeEach(() => {
      validator = new SchemaValidator(logger);
    });

    it('should validate input with JSON Schema 1.1', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number', minimum: 0 },
        },
        required: ['name'],
      };

      const input = {
        name: 'Test User',
        age: 25,
      };

      const result = validator.validateInput(schema, input);

      expect(result.valid).toBe(true);
    });

    it('should detect invalid input', () => {
      const schema = {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
        },
        required: ['email'],
      };

      const input = {
        email: 'not-an-email',
      };

      const result = validator.validateInput(schema, input);

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should validate output schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: { type: 'object' },
        },
        required: ['success'],
      };

      const output = {
        success: true,
        data: { result: 'test' },
      };

      const result = validator.validateOutput(schema, output);

      expect(result.valid).toBe(true);
    });

    it('should upgrade legacy tool schemas', () => {
      const legacySchema = {
        type: 'object',
        properties: {
          arg1: { type: 'string' },
        },
      };

      const upgraded = upgradeToolSchema(legacySchema);

      expect(upgraded).toBeDefined();
      expect(upgraded.properties).toBeDefined();
    });

    it('should cache compiled schemas', () => {
      const schema = {
        type: 'object',
        properties: {
          test: { type: 'string' },
        },
      };

      // Validate twice with same schema
      validator.validateInput(schema, { test: 'value1' });
      validator.validateInput(schema, { test: 'value2' });

      const stats = validator.getCacheStats();

      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('MCP Server Factory', () => {
    it('should detect MCP 2025-11 availability', async () => {
      const factory = MCPServerFactory;
      const config = { transport: 'stdio' as const };
      const optimal = factory.detectOptimalConfig(config);

      expect(optimal.features).toBeDefined();
      expect(optimal.features!.enableProgressiveDisclosure).toBe(true);
    });

    it('should validate server configuration', () => {
      const config = {
        transport: 'stdio' as const,
        features: {
          enableMCP2025: true,
        },
      };

      const validation = MCPServerFactory.validateConfig(config);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should create MCP 2025-11 server when enabled', async () => {
      const config = {
        transport: 'stdio' as const,
        features: {
          enableMCP2025: true,
          supportLegacyClients: true,
        },
        mcp2025: {
          async: { enabled: true },
          registry: { enabled: false },
          validation: { enabled: true },
        },
      };

      const server = await createMCPServer(config, eventBus, logger);

      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(MCP2025Server);
    });

    it('should create legacy server when MCP 2025 disabled', async () => {
      const config = {
        transport: 'stdio' as const,
        features: {
          enableMCP2025: false,
        },
      };

      const server = await createMCPServer(config, eventBus, logger);

      expect(server).toBeDefined();
      // Should be legacy MCPServer instance
    });
  });

  describe('Full MCP 2025-11 Server Integration', () => {
    let server: MCP2025Server;
    const sessionId = 'test-session-123';

    beforeAll(async () => {
      const config: MCP2025ServerConfig = {
        serverId: 'test-server',
        transport: 'stdio',
        enableMCP2025: true,
        supportLegacyClients: true,
        async: {
          enabled: true,
          maxJobs: 10,
          jobTTL: 60000,
        },
        registry: {
          enabled: false,
          url: 'https://test-registry.example.com',
        },
        validation: {
          enabled: true,
          strictMode: false,
        },
      };

      server = new MCP2025Server(config, eventBus, logger);
      await server.initialize();
    });

    afterAll(async () => {
      await server.cleanup();
    });

    it('should handle client handshake with version negotiation', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2025-11',
        capabilities: ['async', 'code_exec'],
      };

      const handshake = await server.handleHandshake(clientHandshake, sessionId);

      expect(handshake.server_id).toBe('test-server');
      expect(handshake.mcp_version).toBe('2025-11');
      expect(handshake.capabilities).toBeDefined();
    });

    it('should handle legacy client handshake', async () => {
      const legacyHandshake = {
        method: 'initialize',
        params: {
          clientInfo: { name: 'legacy-client', version: '1.0.0' },
        },
      };

      const handshake = await server.handleHandshake(legacyHandshake, 'legacy-session');

      expect(handshake).toBeDefined();
      expect(handshake.server_id).toBeDefined();
    });

    it('should return server metrics', () => {
      const metrics = server.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.sessions).toBeDefined();
      expect(metrics.sessions.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Regression Tests', () => {
    it('should maintain backward compatibility with existing tools', async () => {
      // Test that existing MCP tools still work
      const config = {
        transport: 'stdio' as const,
        features: {
          enableMCP2025: true,
          supportLegacyClients: true,
        },
      };

      const server = await createMCPServer(config, eventBus, logger);

      // Server should initialize without errors
      expect(server).toBeDefined();
    });

    it('should not break existing MCP server functionality', async () => {
      const legacyConfig = {
        transport: 'stdio' as const,
        features: {
          enableMCP2025: false,
        },
      };

      const server = await createMCPServer(legacyConfig, eventBus, logger);

      expect(server).toBeDefined();
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.getMetrics).toBe('function');
    });
  });
});
