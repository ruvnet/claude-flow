/**
 * MCP 2025-11 Core Components Test Suite
 *
 * Tests core MCP 2025-11 components without SDK dependencies:
 * - Version negotiation
 * - Async job management
 * - Schema validation
 * - Backward compatibility
 */

// Set environment to prevent logger initialization error
process.env.CLAUDE_FLOW_ENV = '';

import { describe, it, expect, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { VersionNegotiator, BackwardCompatibilityAdapter } from '../../src/mcp/protocol/version-negotiation.js';
import { MCPAsyncJobManager } from '../../src/mcp/async/job-manager-mcp25.js';
import { SchemaValidator, upgradeToolSchema } from '../../src/mcp/validation/schema-validator-2025.js';
import { MCPServerFactory } from '../../src/mcp/server-factory.js';
import { logger } from '../../src/core/logger.js';

describe('MCP 2025-11 Core Components', () => {
  describe('Version Negotiation', () => {
    let negotiator: VersionNegotiator;

    beforeEach(() => {
      negotiator = new VersionNegotiator(logger);
    });

    it('should accept MCP 2025-11 version format', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2025-11' as const,
        capabilities: ['async', 'code_exec'],
      };

      const result = await negotiator.negotiate(clientHandshake);

      expect(result.success).toBe(true);
      expect(result.agreed_version).toBe('2025-11');
      expect(result.agreed_capabilities).toContain('async');
    });

    it('should accept compatible versions within 1 cycle', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2025-10' as const,
        capabilities: ['async'],
      };

      const result = await negotiator.negotiate(clientHandshake);

      expect(result.success).toBe(true);
    });

    it('should reject incompatible versions', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2024-09' as const,
        capabilities: [],
      };

      const result = await negotiator.negotiate(clientHandshake);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should negotiate common capabilities', async () => {
      const clientHandshake = {
        client_id: 'test-client',
        mcp_version: '2025-11' as const,
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
      const jobs = await jobManager.listJobs({});
      for (const job of jobs.jobs) {
        try {
          await jobManager.cancelJob(job.job_id);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should submit async job and return job handle', async () => {
      const request = {
        request_id: 'req-123',
        tool_id: 'test/tool',
        arguments: { test: 'data' },
        mode: 'async' as const,
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
        mode: 'async' as const,
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
        mode: 'async' as const,
      };

      const executor = async (args: any) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { processed: args.input };
      };

      const handle = await jobManager.submitJob(request, executor);
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
        mode: 'async' as const,
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

      await jobManager.submitJob(request, executor);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates).toContain(100);
    });

    it('should list jobs', async () => {
      const request1 = {
        request_id: 'req-list-1',
        tool_id: 'test/tool',
        arguments: {},
        mode: 'async' as const,
      };

      await jobManager.submitJob(request1, async () => ({ done: true }));

      const list = await jobManager.listJobs({ limit: 10 });

      expect(list.jobs.length).toBeGreaterThanOrEqual(1);
      expect(list.total).toBeGreaterThanOrEqual(1);
    });

    it('should cancel running job', async () => {
      const request = {
        request_id: 'req-cancel',
        tool_id: 'test/long-running',
        arguments: {},
        mode: 'async' as const,
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

    it('should validate input with JSON Schema', () => {
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

      validator.validateInput(schema, { test: 'value1' });
      validator.validateInput(schema, { test: 'value2' });

      const stats = validator.getCacheStats();

      expect(stats.size).toBeGreaterThan(0);
    });
  });

  describe('Server Factory Configuration', () => {
    it('should detect optimal configuration', () => {
      const config = { transport: 'stdio' as const };
      const optimal = MCPServerFactory.detectOptimalConfig(config);

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

    it('should detect configuration warnings', () => {
      const config = {
        transport: 'stdio' as const,
        features: {
          enableMCP2025: true,
          enableRegistryIntegration: true,
        },
        mcp2025: {
          registry: {
            enabled: true,
            url: 'https://test.example.com',
            // No API key provided
          },
        },
      };

      const validation = MCPServerFactory.validateConfig(config);

      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0);
    });
  });
});
