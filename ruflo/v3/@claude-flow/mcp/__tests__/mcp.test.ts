/**
 * @claude-flow/mcp - Test Suite
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMCPServer,
  createToolRegistry,
  createSessionManager,
  createConnectionPool,
  createResourceRegistry,
  createPromptRegistry,
  createTaskManager,
  defineTool,
  definePrompt,
  textMessage,
  createTextResource,
  interpolate,
  ErrorCodes,
  MCPServerError,
  VERSION,
  MODULE_NAME,
} from '../src/index.js';
import type { ILogger, MCPTool } from '../src/types.js';

// Mock logger
const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('@claude-flow/mcp', () => {
  describe('Module exports', () => {
    it('should export VERSION', () => {
      expect(VERSION).toBe('3.0.0');
    });

    it('should export MODULE_NAME', () => {
      expect(MODULE_NAME).toBe('@claude-flow/mcp');
    });

    it('should export ErrorCodes', () => {
      expect(ErrorCodes.PARSE_ERROR).toBe(-32700);
      expect(ErrorCodes.INVALID_REQUEST).toBe(-32600);
      expect(ErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
      expect(ErrorCodes.INTERNAL_ERROR).toBe(-32603);
    });
  });

  describe('MCPServerError', () => {
    it('should create error with code', () => {
      const error = new MCPServerError('Test error', ErrorCodes.INVALID_REQUEST);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe(ErrorCodes.INVALID_REQUEST);
      expect(error.name).toBe('MCPServerError');
    });

    it('should convert to MCP error format', () => {
      const error = new MCPServerError('Test error', ErrorCodes.PARSE_ERROR, { extra: 'data' });
      const mcpError = error.toMCPError();
      expect(mcpError.code).toBe(ErrorCodes.PARSE_ERROR);
      expect(mcpError.message).toBe('Test error');
      expect(mcpError.data).toEqual({ extra: 'data' });
    });
  });

  describe('ToolRegistry', () => {
    let registry: ReturnType<typeof createToolRegistry>;
    let logger: ILogger;

    beforeEach(() => {
      logger = createMockLogger();
      registry = createToolRegistry(logger);
    });

    it('should register a tool', () => {
      const tool: MCPTool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ result: 'success' }),
      };

      const result = registry.register(tool);
      expect(result).toBe(true);
      expect(registry.hasTool('test-tool')).toBe(true);
      expect(registry.getToolCount()).toBe(1);
    });

    it('should not register duplicate tools', () => {
      const tool: MCPTool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ result: 'success' }),
      };

      registry.register(tool);
      const result = registry.register(tool);
      expect(result).toBe(false);
      expect(registry.getToolCount()).toBe(1);
    });

    it('should override tool with option', () => {
      const tool1: MCPTool = {
        name: 'test-tool',
        description: 'First version',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ result: 'v1' }),
      };

      const tool2: MCPTool = {
        name: 'test-tool',
        description: 'Second version',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ result: 'v2' }),
      };

      registry.register(tool1);
      const result = registry.register(tool2, { override: true });
      expect(result).toBe(true);
      expect(registry.getTool('test-tool')?.description).toBe('Second version');
    });

    it('should unregister a tool', () => {
      const tool: MCPTool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => ({ result: 'success' }),
      };

      registry.register(tool);
      const result = registry.unregister('test-tool');
      expect(result).toBe(true);
      expect(registry.hasTool('test-tool')).toBe(false);
    });

    it('should execute a tool', async () => {
      const tool: MCPTool = {
        name: 'test-tool',
        description: 'A test tool',
        inputSchema: { type: 'object', properties: {} },
        handler: async (input: unknown) => ({ received: input }),
      };

      registry.register(tool);
      const result = await registry.execute('test-tool', { test: 'data' });
      expect(result.isError).toBe(false);
      expect(result.content[0].type).toBe('text');
    });

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('unknown-tool', {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Tool not found');
    });

    it('should filter by category', () => {
      registry.register({
        name: 'tool-a',
        description: 'Tool A',
        inputSchema: { type: 'object' },
        handler: async () => ({}),
        category: 'category-1',
      });

      registry.register({
        name: 'tool-b',
        description: 'Tool B',
        inputSchema: { type: 'object' },
        handler: async () => ({}),
        category: 'category-2',
      });

      const tools = registry.getByCategory('category-1');
      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('tool-a');
    });

    it('should get stats', () => {
      registry.register({
        name: 'tool-a',
        description: 'Tool A',
        inputSchema: { type: 'object' },
        handler: async () => ({}),
        category: 'cat',
        tags: ['tag1', 'tag2'],
      });

      const stats = registry.getStats();
      expect(stats.totalTools).toBe(1);
      expect(stats.totalCategories).toBe(1);
      expect(stats.totalTags).toBe(2);
    });
  });

  describe('defineTool', () => {
    it('should create a tool definition', () => {
      const tool = defineTool(
        'my-tool',
        'My tool description',
        { type: 'object', properties: { input: { type: 'string' } } },
        async (input) => ({ result: input }),
        { category: 'test', tags: ['tag1'] }
      );

      expect(tool.name).toBe('my-tool');
      expect(tool.description).toBe('My tool description');
      expect(tool.category).toBe('test');
      expect(tool.tags).toEqual(['tag1']);
    });
  });

  describe('SessionManager', () => {
    let manager: ReturnType<typeof createSessionManager>;
    let logger: ILogger;

    beforeEach(() => {
      logger = createMockLogger();
      manager = createSessionManager(logger, { sessionTimeout: 1000 });
    });

    afterEach(() => {
      manager.destroy();
    });

    it('should create a session', () => {
      const session = manager.createSession('stdio');
      expect(session.id).toBeDefined();
      expect(session.state).toBe('created');
      expect(session.transport).toBe('stdio');
      expect(session.isInitialized).toBe(false);
    });

    it('should initialize a session', () => {
      const session = manager.createSession('stdio');
      manager.initializeSession(session.id, {
        protocolVersion: { major: 2024, minor: 11, patch: 5 },
        capabilities: { tools: { listChanged: true } },
        clientInfo: { name: 'test-client', version: '1.0.0' },
      });

      const updated = manager.getSession(session.id);
      expect(updated?.isInitialized).toBe(true);
      expect(updated?.state).toBe('ready');
      expect(updated?.clientInfo?.name).toBe('test-client');
    });

    it('should close a session', () => {
      const session = manager.createSession('stdio');
      const result = manager.closeSession(session.id, 'test reason');
      expect(result).toBe(true);
      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it('should get session metrics', () => {
      manager.createSession('stdio');
      manager.createSession('http');

      const metrics = manager.getSessionMetrics();
      expect(metrics.total).toBe(2);
    });

    it('should update session activity', () => {
      const session = manager.createSession('stdio');
      const originalTime = session.lastActivityAt;

      // Small delay to ensure time difference
      const result = manager.updateActivity(session.id);
      expect(result).toBe(true);
    });
  });

  describe('ConnectionPool', () => {
    let pool: ReturnType<typeof createConnectionPool>;
    let logger: ILogger;

    beforeEach(() => {
      logger = createMockLogger();
      pool = createConnectionPool(
        { maxConnections: 5, minConnections: 0, idleTimeout: 100, evictionRunInterval: 60000 },
        logger,
        'in-process'
      );
    });

    afterEach(async () => {
      // Release all connections first to allow fast drain
      for (const conn of pool.getConnections()) {
        if (conn.state === 'busy') {
          pool.release(conn);
        }
      }
      await pool.clear();
    }, 5000);

    it('should acquire a connection', async () => {
      const connection = await pool.acquire();
      expect(connection.id).toBeDefined();
      expect(connection.state).toBe('busy');
    });

    it('should release a connection', async () => {
      const connection = await pool.acquire();
      pool.release(connection);

      const stats = pool.getStats();
      expect(stats.idleConnections).toBeGreaterThan(0);
    });

    it('should get stats', async () => {
      const connection = await pool.acquire();
      const stats = pool.getStats();

      expect(stats.totalConnections).toBeGreaterThan(0);
      expect(stats.totalAcquired).toBe(1);

      // Release for cleanup
      pool.release(connection);
    });

    it('should check health', () => {
      // Pool is healthy when not shutting down and has >= minConnections (0 in this test)
      expect(pool.isHealthy()).toBe(true);
    });
  });

  describe('MCPServer', () => {
    let server: ReturnType<typeof createMCPServer>;
    let logger: ILogger;

    beforeEach(() => {
      logger = createMockLogger();
      server = createMCPServer(
        { name: 'Test Server', transport: 'in-process' },
        logger
      );
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should create server with config', () => {
      expect(server).toBeDefined();
    });

    it('should register a tool', () => {
      const result = server.registerTool({
        name: 'test-tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        handler: async () => ({}),
      });
      expect(result).toBe(true);
    });

    it('should register multiple tools', () => {
      const result = server.registerTools([
        {
          name: 'tool-1',
          description: 'Tool 1',
          inputSchema: { type: 'object' },
          handler: async () => ({}),
        },
        {
          name: 'tool-2',
          description: 'Tool 2',
          inputSchema: { type: 'object' },
          handler: async () => ({}),
        },
      ]);
      expect(result.registered).toBe(2);
      expect(result.failed).toHaveLength(0);
    });

    it('should start and stop', async () => {
      await server.start();
      const health = await server.getHealthStatus();
      expect(health.healthy).toBe(true);

      await server.stop();
      const healthAfter = await server.getHealthStatus();
      expect(healthAfter.healthy).toBe(false);
    });

    it('should get metrics', async () => {
      await server.start();
      const metrics = server.getMetrics();

      expect(metrics.totalRequests).toBeDefined();
      expect(metrics.activeSessions).toBeDefined();
    });

    it('should expose resource registry', () => {
      const registry = server.getResourceRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.registerResource).toBe('function');
    });

    it('should expose prompt registry', () => {
      const registry = server.getPromptRegistry();
      expect(registry).toBeDefined();
      expect(typeof registry.register).toBe('function');
    });

    it('should expose task manager', () => {
      const taskManager = server.getTaskManager();
      expect(taskManager).toBeDefined();
      expect(typeof taskManager.createTask).toBe('function');
    });
  });

  // ============================================================================
  // MCP 2025-11-25 Features
  // ============================================================================

  describe('ResourceRegistry (MCP 2025-11-25)', () => {
    let registry: ReturnType<typeof createResourceRegistry>;
    let logger: ILogger;

    beforeEach(() => {
      logger = createMockLogger();
      registry = createResourceRegistry(logger);
    });

    it('should register a resource', () => {
      const { resource, handler } = createTextResource(
        'file://test.txt',
        'Test File',
        'Hello World'
      );

      const result = registry.registerResource(resource, handler);
      expect(result).toBe(true);
      expect(registry.hasResource('file://test.txt')).toBe(true);
    });

    it('should list resources with pagination', () => {
      for (let i = 0; i < 5; i++) {
        const { resource, handler } = createTextResource(
          `file://test${i}.txt`,
          `Test File ${i}`,
          `Content ${i}`
        );
        registry.registerResource(resource, handler);
      }

      const result = registry.list(undefined, 3);
      expect(result.resources.length).toBe(3);
      expect(result.nextCursor).toBeDefined();

      const nextResult = registry.list(result.nextCursor, 3);
      expect(nextResult.resources.length).toBe(2);
    });

    it('should read resource content', async () => {
      const { resource, handler } = createTextResource(
        'file://test.txt',
        'Test File',
        'Hello World'
      );
      registry.registerResource(resource, handler);

      const result = await registry.read('file://test.txt');
      expect(result.contents[0].text).toBe('Hello World');
    });

    it('should subscribe to resource updates', () => {
      const { resource, handler } = createTextResource(
        'file://test.txt',
        'Test File',
        'Hello World'
      );
      registry.registerResource(resource, handler);

      const callback = vi.fn();
      const subscriptionId = registry.subscribe('file://test.txt', callback);
      expect(subscriptionId).toBeDefined();
      expect(registry.getSubscriptionCount('file://test.txt')).toBe(1);
    });

    it('should get stats', () => {
      const { resource, handler } = createTextResource(
        'file://test.txt',
        'Test File',
        'Hello World'
      );
      registry.registerResource(resource, handler);

      const stats = registry.getStats();
      expect(stats.totalResources).toBe(1);
    });
  });

  describe('PromptRegistry (MCP 2025-11-25)', () => {
    let registry: ReturnType<typeof createPromptRegistry>;
    let logger: ILogger;

    beforeEach(() => {
      logger = createMockLogger();
      registry = createPromptRegistry(logger);
    });

    it('should register a prompt', () => {
      const prompt = definePrompt(
        'code_review',
        'Review code for quality',
        async (args) => [textMessage('user', `Review: ${args.code}`)],
        { arguments: [{ name: 'code', required: true }] }
      );

      const result = registry.register(prompt);
      expect(result).toBe(true);
      expect(registry.hasPrompt('code_review')).toBe(true);
    });

    it('should list prompts with pagination', () => {
      for (let i = 0; i < 5; i++) {
        const prompt = definePrompt(
          `prompt_${i}`,
          `Prompt ${i}`,
          async () => [textMessage('user', `Message ${i}`)]
        );
        registry.register(prompt);
      }

      const result = registry.list(undefined, 3);
      expect(result.prompts.length).toBe(3);
      expect(result.nextCursor).toBeDefined();
    });

    it('should get prompt with arguments', async () => {
      const prompt = definePrompt(
        'greeting',
        'Greet a user',
        async (args) => [textMessage('user', `Hello, ${args.name}!`)],
        { arguments: [{ name: 'name', required: true }] }
      );
      registry.register(prompt);

      const result = await registry.get('greeting', { name: 'World' });
      expect(result.messages[0].content.type).toBe('text');
      expect((result.messages[0].content as any).text).toBe('Hello, World!');
    });

    it('should validate required arguments', async () => {
      const prompt = definePrompt(
        'greeting',
        'Greet a user',
        async (args) => [textMessage('user', `Hello, ${args.name}!`)],
        { arguments: [{ name: 'name', required: true }] }
      );
      registry.register(prompt);

      await expect(registry.get('greeting', {})).rejects.toThrow('Missing required argument');
    });

    it('should interpolate template strings', () => {
      const template = 'Hello, {name}! Your score is {score}.';
      const result = interpolate(template, { name: 'Alice', score: '100' });
      expect(result).toBe('Hello, Alice! Your score is 100.');
    });
  });

  describe('TaskManager (MCP 2025-11-25)', () => {
    let taskManager: ReturnType<typeof createTaskManager>;
    let logger: ILogger;

    beforeEach(() => {
      logger = createMockLogger();
      taskManager = createTaskManager(logger, { cleanupInterval: 60000 });
    });

    afterEach(() => {
      taskManager.destroy();
    });

    it('should create a task', () => {
      const taskId = taskManager.createTask(async (reportProgress, signal) => {
        return { result: 'success' };
      });

      expect(taskId).toBeDefined();
      expect(taskId.startsWith('task-')).toBe(true);
    });

    it('should get task status', () => {
      const taskId = taskManager.createTask(async () => 'done');
      const status = taskManager.getTask(taskId);

      expect(status).toBeDefined();
      expect(status?.taskId).toBe(taskId);
    });

    it('should track task progress', async () => {
      const taskId = taskManager.createTask(async (reportProgress) => {
        reportProgress({ progress: 50, total: 100, message: 'Halfway' });
        return 'done';
      });

      // Wait for task to complete
      const result = await taskManager.waitForTask(taskId, 5000);
      expect(result.state).toBe('completed');
    });

    it('should cancel a task', () => {
      const taskId = taskManager.createTask(async (reportProgress, signal) => {
        // Long running task
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 10000);
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Cancelled'));
          });
        });
      });

      const cancelled = taskManager.cancelTask(taskId, 'User requested');
      expect(cancelled).toBe(true);
    });

    it('should get all tasks', () => {
      taskManager.createTask(async () => 'task1');
      taskManager.createTask(async () => 'task2');

      const tasks = taskManager.getAllTasks();
      expect(tasks.length).toBe(2);
    });

    it('should get stats', () => {
      taskManager.createTask(async () => 'done');

      const stats = taskManager.getStats();
      expect(stats.totalTasks).toBeGreaterThan(0);
    });
  });
});
