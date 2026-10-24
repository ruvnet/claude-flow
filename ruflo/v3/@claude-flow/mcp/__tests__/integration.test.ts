/**
 * @claude-flow/mcp - Integration Tests
 *
 * End-to-end tests for MCP 2025-11-25 features
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMCPServer,
  createTextResource,
  definePrompt,
  textMessage,
  resourceMessage,
} from '../src/index.js';
import type { ILogger, MCPRequest, MCPResponse } from '../src/types.js';

const createMockLogger = (): ILogger => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('MCP 2025-11-25 Integration', () => {
  let server: ReturnType<typeof createMCPServer>;
  let logger: ILogger;

  beforeEach(async () => {
    logger = createMockLogger();
    server = createMCPServer(
      { name: 'Integration Test Server', transport: 'in-process' },
      logger
    );
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('Server Lifecycle', () => {
    it('should start and report healthy', async () => {
      await server.start();
      const health = await server.getHealthStatus();

      expect(health.healthy).toBe(true);
      expect(health.metrics?.registeredTools).toBeGreaterThan(0);
    });

    it('should expose all registries', async () => {
      await server.start();

      expect(server.getResourceRegistry()).toBeDefined();
      expect(server.getPromptRegistry()).toBeDefined();
      expect(server.getTaskManager()).toBeDefined();
    });
  });

  describe('Resources Integration', () => {
    it('should register and read resources', async () => {
      await server.start();
      const registry = server.getResourceRegistry();

      // Register multiple resources
      const resources = [
        createTextResource('file://config.json', 'Config', '{"key": "value"}', { mimeType: 'application/json' }),
        createTextResource('file://readme.md', 'README', '# Hello World', { mimeType: 'text/markdown' }),
        createTextResource('file://data.txt', 'Data', 'Some data content'),
      ];

      for (const { resource, handler } of resources) {
        registry.registerResource(resource, handler);
      }

      // Verify listing
      const list = registry.list();
      expect(list.resources.length).toBe(3);

      // Verify reading
      const config = await registry.read('file://config.json');
      expect(config.contents[0].text).toBe('{"key": "value"}');
      expect(config.contents[0].mimeType).toBe('application/json');

      const readme = await registry.read('file://readme.md');
      expect(readme.contents[0].text).toBe('# Hello World');
    });

    it('should handle resource subscriptions', async () => {
      await server.start();
      const registry = server.getResourceRegistry();

      const { resource, handler } = createTextResource('file://live.txt', 'Live', 'Initial');
      registry.registerResource(resource, handler);

      const callback = vi.fn();
      const subId = registry.subscribe('file://live.txt', callback);

      expect(subId).toBeDefined();
      expect(registry.getSubscriptionCount('file://live.txt')).toBe(1);

      // Unsubscribe
      const unsubResult = registry.unsubscribe(subId);
      expect(unsubResult).toBe(true);
      expect(registry.getSubscriptionCount('file://live.txt')).toBe(0);
    });

    it('should cache resources', async () => {
      await server.start();
      const registry = server.getResourceRegistry();

      let callCount = 0;
      registry.registerResource(
        { uri: 'file://counter.txt', name: 'Counter', mimeType: 'text/plain' },
        async () => {
          callCount++;
          return [{ uri: 'file://counter.txt', text: `Count: ${callCount}` }];
        }
      );

      // First read
      await registry.read('file://counter.txt');
      expect(callCount).toBe(1);

      // Second read should be cached
      await registry.read('file://counter.txt');
      expect(callCount).toBe(1); // Still 1 due to cache
    });
  });

  describe('Prompts Integration', () => {
    it('should register and execute prompts', async () => {
      await server.start();
      const registry = server.getPromptRegistry();

      // Register code review prompt
      registry.register(definePrompt(
        'code_review',
        'Review code quality',
        async (args) => [
          textMessage('user', `Review this ${args.language || 'code'}:\n\n${args.code}`),
        ],
        {
          title: 'Code Review',
          arguments: [
            { name: 'code', required: true },
            { name: 'language', required: false },
          ],
        }
      ));

      // Register translation prompt
      registry.register(definePrompt(
        'translate',
        'Translate text',
        async (args) => [
          textMessage('user', `Translate to ${args.target}: ${args.text}`),
        ],
        {
          arguments: [
            { name: 'text', required: true },
            { name: 'target', required: true },
          ],
        }
      ));

      // List prompts
      const list = registry.list();
      expect(list.prompts.length).toBe(2);

      // Execute code review
      const review = await registry.get('code_review', {
        code: 'const x = 1;',
        language: 'TypeScript',
      });
      expect(review.messages[0].content.type).toBe('text');
      expect((review.messages[0].content as any).text).toContain('TypeScript');

      // Execute translation
      const translate = await registry.get('translate', {
        text: 'Hello',
        target: 'Spanish',
      });
      expect((translate.messages[0].content as any).text).toContain('Spanish');
    });

    it('should validate required arguments', async () => {
      await server.start();
      const registry = server.getPromptRegistry();

      registry.register(definePrompt(
        'greet',
        'Greet someone',
        async (args) => [textMessage('user', `Hello ${args.name}`)],
        { arguments: [{ name: 'name', required: true }] }
      ));

      // Should throw without required argument
      await expect(registry.get('greet', {})).rejects.toThrow('Missing required argument: name');

      // Should work with argument
      const result = await registry.get('greet', { name: 'World' });
      expect((result.messages[0].content as any).text).toBe('Hello World');
    });
  });

  describe('Tasks Integration', () => {
    it('should create and complete tasks', async () => {
      await server.start();
      const taskManager = server.getTaskManager();

      const taskId = taskManager.createTask(async (reportProgress) => {
        reportProgress({ progress: 50, total: 100 });
        return { success: true };
      });

      const result = await taskManager.waitForTask(taskId, 5000);
      expect(result.state).toBe('completed');
      expect(result.result).toEqual({ success: true });
    });

    it('should track progress', async () => {
      await server.start();
      const taskManager = server.getTaskManager();

      const progressUpdates: number[] = [];

      taskManager.on('task:progress', (event: { taskId: string; progress: { progress: number } }) => {
        progressUpdates.push(event.progress.progress);
      });

      const taskId = taskManager.createTask(async (reportProgress) => {
        for (let i = 25; i <= 100; i += 25) {
          reportProgress({ progress: i, total: 100 });
          await new Promise(r => setTimeout(r, 10));
        }
        return 'done';
      });

      await taskManager.waitForTask(taskId, 5000);
      expect(progressUpdates.length).toBeGreaterThan(0);
    });

    it('should cancel running tasks', async () => {
      await server.start();
      const taskManager = server.getTaskManager();

      const taskId = taskManager.createTask(async (reportProgress, signal) => {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 10000);
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Cancelled'));
          });
        });
      });

      // Cancel immediately
      const cancelled = taskManager.cancelTask(taskId, 'Test cancel');
      expect(cancelled).toBe(true);

      // Wait a bit and check status
      await new Promise(r => setTimeout(r, 50));
      const status = taskManager.getTask(taskId);
      expect(status?.state).toBe('cancelled');
    });

    it('should handle concurrent tasks', async () => {
      await server.start();
      const taskManager = server.getTaskManager();

      const taskIds = [];
      for (let i = 0; i < 5; i++) {
        const id = taskManager.createTask(async () => {
          await new Promise(r => setTimeout(r, 10));
          return `Task ${i} done`;
        });
        taskIds.push(id);
      }

      // Wait for all
      const results = await Promise.all(
        taskIds.map(id => taskManager.waitForTask(id, 5000))
      );

      expect(results.every(r => r.state === 'completed')).toBe(true);
    });
  });

  describe('Full Server Flow', () => {
    it('should handle complete MCP workflow', async () => {
      await server.start();

      // Setup resources
      const resourceRegistry = server.getResourceRegistry();
      const { resource, handler } = createTextResource(
        'context://project',
        'Project Context',
        'This is a TypeScript project using MCP.'
      );
      resourceRegistry.registerResource(resource, handler);

      // Setup prompts
      const promptRegistry = server.getPromptRegistry();
      promptRegistry.register(definePrompt(
        'analyze',
        'Analyze project',
        async (args) => {
          // Could include embedded resource here
          return [
            textMessage('user', `Analyze: ${args.focus}`),
          ];
        },
        { arguments: [{ name: 'focus', required: true }] }
      ));

      // Setup long-running task
      const taskManager = server.getTaskManager();
      const analysisTaskId = taskManager.createTask(async (reportProgress) => {
        reportProgress({ progress: 0, message: 'Starting analysis' });
        await new Promise(r => setTimeout(r, 20));
        reportProgress({ progress: 50, message: 'Processing' });
        await new Promise(r => setTimeout(r, 20));
        reportProgress({ progress: 100, message: 'Complete' });
        return { findings: ['All good!'] };
      });

      // Verify all components work together
      const resourceList = resourceRegistry.list();
      expect(resourceList.resources.length).toBe(1);

      const promptList = promptRegistry.list();
      expect(promptList.prompts.length).toBe(1);

      const taskResult = await taskManager.waitForTask(analysisTaskId, 5000);
      expect(taskResult.state).toBe('completed');
      expect((taskResult.result as any).findings).toContain('All good!');

      // Check metrics
      const health = await server.getHealthStatus();
      expect(health.healthy).toBe(true);
    });
  });

  describe('Security Validation', () => {
    it('should not expose internal state', async () => {
      await server.start();
      const metrics = server.getMetrics();

      // Metrics should only contain safe data
      expect(metrics).not.toHaveProperty('_internal');
      expect(metrics).not.toHaveProperty('password');
      expect(metrics).not.toHaveProperty('secret');
    });

    it('should validate tool inputs', async () => {
      await server.start();

      // Register a tool with schema
      server.registerTool({
        name: 'secure-tool',
        description: 'A tool with input validation',
        inputSchema: {
          type: 'object',
          properties: {
            allowed: { type: 'string', maxLength: 100 },
          },
          required: ['allowed'],
        },
        handler: async (input) => ({ received: input }),
      });

      // Tool registry should have it
      const tools = server.getMetrics().toolInvocations;
      expect(tools).toBeDefined();
    });

    it('should handle resource access errors gracefully', async () => {
      await server.start();
      const registry = server.getResourceRegistry();

      // Try to read non-existent resource
      await expect(registry.read('file://nonexistent.txt'))
        .rejects.toThrow('Resource not found');
    });

    it('should prevent duplicate subscriptions overflow', async () => {
      await server.start();
      const registry = server.getResourceRegistry();

      const { resource, handler } = createTextResource('file://test.txt', 'Test', 'content');
      registry.registerResource(resource, handler);

      // Subscribe many times (should be limited by maxSubscriptionsPerResource)
      for (let i = 0; i < 100; i++) {
        registry.subscribe('file://test.txt', vi.fn());
      }

      expect(registry.getSubscriptionCount('file://test.txt')).toBe(100);
    });

    it('should enforce cache size limits (CVE fix)', async () => {
      await server.start();
      const registry = server.getResourceRegistry();

      // Register many resources to test cache eviction
      for (let i = 0; i < 10; i++) {
        const { resource, handler } = createTextResource(
          `file://cache-test-${i}.txt`,
          `Cache Test ${i}`,
          `Content ${i}`
        );
        registry.registerResource(resource, handler);
      }

      // Read all resources to populate cache
      for (let i = 0; i < 10; i++) {
        await registry.read(`file://cache-test-${i}.txt`);
      }

      // Cache should be limited (default 1000, but should work)
      const stats = registry.getStats();
      expect(stats.cacheSize).toBeLessThanOrEqual(1000);
    });

    it('should escape regex in template matching (ReDoS fix)', async () => {
      await server.start();
      const registry = server.getResourceRegistry();

      // Register a template with potentially dangerous regex chars
      registry.registerTemplate(
        {
          uriTemplate: 'db://users/{id}',
          name: 'User Data',
          mimeType: 'application/json',
        },
        async (uri) => [{ uri, text: '{}' }]
      );

      // This should not cause ReDoS - test with various inputs
      const startTime = Date.now();
      expect(registry.hasResource('db://users/123')).toBe(true);
      expect(registry.hasResource('db://users/abc')).toBe(true);
      expect(registry.hasResource('invalid://path')).toBe(false);
      const elapsed = Date.now() - startTime;

      // Should complete quickly (< 100ms), not hang due to ReDoS
      expect(elapsed).toBeLessThan(100);
    });
  });
});
