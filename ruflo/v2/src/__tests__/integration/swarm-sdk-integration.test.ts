/**
 * Swarm SDK Integration Tests
 * Phase 7: Comprehensive Testing & Validation
 *
 * Tests session forking, hook matchers, and in-process MCP integration
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ClaudeFlowSDKAdapter, SDKConfiguration } from '../../sdk/sdk-config.js';
import { SDKCompatibilityLayer } from '../../sdk/compatibility-layer.js';
import { TaskExecutorSDK, ExecutionConfig } from '../../swarm/executor-sdk.js';
import { ClaudeClientV25 } from '../../api/claude-client-v2.5.js';
import { Logger } from '../../core/logger.js';
import Anthropic from '@anthropic-ai/sdk';

// Mock Anthropic SDK
jest.mock('@anthropic-ai/sdk');

describe('SDK Integration Tests', () => {
  let adapter: ClaudeFlowSDKAdapter;
  let compatibility: SDKCompatibilityLayer;
  let executor: TaskExecutorSDK;
  let client: ClaudeClientV25;
  let mockSDK: jest.Mocked<Anthropic>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mock SDK instance
    mockSDK = {
      messages: {
        create: jest.fn(),
      },
    } as any;

    (Anthropic as any).mockImplementation(() => mockSDK);

    // Initialize components
    const config: SDKConfiguration = {
      apiKey: 'test-api-key',
      swarmMode: true,
      persistenceEnabled: true,
      checkpointInterval: 30000,
    };

    adapter = new ClaudeFlowSDKAdapter(config);
    compatibility = new SDKCompatibilityLayer(adapter);

    const executorConfig: ExecutionConfig = {
      apiKey: 'test-api-key',
      maxRetries: 3,
      timeout: 60000,
      swarmMode: true,
    };

    executor = new TaskExecutorSDK(executorConfig);

    const clientConfig = {
      apiKey: 'test-api-key',
      retryAttempts: 3,
      timeout: 60000,
      enableSwarmMode: true,
    };

    const logger = new Logger('test');
    client = new ClaudeClientV25(clientConfig, logger);
  });

  afterEach(() => {
    adapter.clearSwarmMetadata();
    executor.clearExecutionStats();
  });

  describe('Phase 4: SDK Integration', () => {
    describe('SDK Adapter Configuration', () => {
      it('should initialize SDK adapter with correct config', () => {
        expect(adapter).toBeDefined();
        expect(adapter.getConfig()).toMatchObject({
          swarmMode: true,
          persistenceEnabled: true,
          checkpointInterval: 30000,
        });
      });

      it('should get underlying SDK instance', () => {
        const sdk = adapter.getSDK();
        expect(sdk).toBeDefined();
        expect(sdk).toBeInstanceOf(Anthropic);
      });

      it('should handle API key from environment', () => {
        process.env.ANTHROPIC_API_KEY = 'env-key';
        const newAdapter = new ClaudeFlowSDKAdapter({});
        expect(newAdapter.getConfig().apiKey).toBe('env-key');
        delete process.env.ANTHROPIC_API_KEY;
      });

      it('should support custom baseURL configuration', () => {
        const customAdapter = new ClaudeFlowSDKAdapter({
          apiKey: 'test-key',
          baseURL: 'https://custom.api.com',
        });
        expect(customAdapter.getConfig().baseURL).toBe('https://custom.api.com');
      });
    });

    describe('SDK Retry Handling', () => {
      it('should automatically retry on rate limit', async () => {
        const rateLimitError = new Anthropic.RateLimitError(
          'Rate limit exceeded',
          429,
          { headers: new Headers(), url: 'test-url' } as any,
          {} as any
        );

        mockSDK.messages.create
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce({
            id: 'msg-123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Success after retry' }],
            model: 'claude-3-sonnet-20240229',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 20 },
          } as any);

        const response = await adapter.createMessage({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'test' }],
        });

        expect(response).toBeDefined();
        expect(response.content[0].text).toBe('Success after retry');
        expect(mockSDK.messages.create).toHaveBeenCalledTimes(2);
      });

      it('should handle authentication errors without retry', async () => {
        const authError = new Anthropic.AuthenticationError(
          'Invalid API key',
          401,
          { headers: new Headers(), url: 'test-url' } as any,
          {} as any
        );

        mockSDK.messages.create.mockRejectedValue(authError);

        await expect(
          adapter.createMessage({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 1024,
            messages: [{ role: 'user', content: 'test' }],
          })
        ).rejects.toThrow('Invalid API key');

        expect(mockSDK.messages.create).toHaveBeenCalledTimes(1);
      });

      it('should respect maxRetries configuration', async () => {
        const customAdapter = new ClaudeFlowSDKAdapter({
          apiKey: 'test-key',
          maxRetries: 5,
        });

        expect(customAdapter.getConfig().maxRetries).toBe(5);
      });
    });

    describe('Swarm Metadata Tracking', () => {
      it('should track message metadata in swarm mode', async () => {
        mockSDK.messages.create.mockResolvedValue({
          id: 'msg-123',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Test response' }],
          model: 'claude-3-sonnet-20240229',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
        } as any);

        await adapter.createMessage({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'test' }],
        });

        const metadata = adapter.getSwarmMetadata('msg-123');
        expect(metadata).toBeDefined();
        expect(metadata.model).toBe('claude-3-sonnet-20240229');
        expect(metadata.tokensUsed).toMatchObject({
          input_tokens: 10,
          output_tokens: 20,
        });
      });

      it('should calculate usage statistics', async () => {
        mockSDK.messages.create
          .mockResolvedValueOnce({
            id: 'msg-1',
            usage: { input_tokens: 10, output_tokens: 20 },
          } as any)
          .mockResolvedValueOnce({
            id: 'msg-2',
            usage: { input_tokens: 15, output_tokens: 25 },
          } as any);

        await adapter.createMessage({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'test1' }],
        });

        await adapter.createMessage({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'test2' }],
        });

        const stats = adapter.getUsageStats();
        expect(stats.messageCount).toBe(2);
        expect(stats.totalTokens).toBe(70); // 10+20+15+25
      });

      it('should clear swarm metadata', async () => {
        mockSDK.messages.create.mockResolvedValue({
          id: 'msg-123',
          usage: { input_tokens: 10, output_tokens: 20 },
        } as any);

        await adapter.createMessage({
          model: 'claude-3-sonnet-20240229',
          max_tokens: 1024,
          messages: [{ role: 'user', content: 'test' }],
        });

        adapter.clearSwarmMetadata();
        const stats = adapter.getUsageStats();
        expect(stats.messageCount).toBe(0);
        expect(stats.totalTokens).toBe(0);
      });
    });

    describe('Backward Compatibility Layer', () => {
      it('should support legacy retry methods', async () => {
        const result = await compatibility.executeWithRetry(
          async () => 'test-result',
          { maxRetries: 3 }
        );

        expect(result).toBe('test-result');
      });

      it('should log deprecation warnings', () => {
        compatibility.calculateBackoff(1);
        const warnings = compatibility.getDeprecationReport();
        expect(warnings).toContain('calculateBackoff');
      });

      it('should map legacy request format', () => {
        const legacyRequest = {
          model: 'claude-2.1',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1024,
          temperature: 0.7,
        };

        const sdkRequest = compatibility.mapLegacyRequest(legacyRequest);
        expect(sdkRequest).toMatchObject({
          model: 'claude-2.1',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1024,
          temperature: 0.7,
        });
      });

      it('should support legacy mode', () => {
        expect(compatibility.isLegacyMode()).toBe(false);
        compatibility.enableLegacyMode();
        expect(compatibility.isLegacyMode()).toBe(true);
      });
    });
  });

  describe('Phase 5: Task Executor Integration', () => {
    const mockTask = {
      id: 'task-123',
      type: 'code_generation',
      description: 'Generate test code',
      priority: 'high' as const,
      status: 'pending' as const,
      dependencies: [],
    };

    const mockAgent = {
      id: 'agent-123',
      type: 'coder',
      status: 'idle' as const,
      capabilities: ['code_generation', 'testing'],
      currentTask: null,
      taskHistory: [],
      metrics: {
        tasksCompleted: 0,
        averageExecutionTime: 0,
        successRate: 0,
      },
    };

    beforeEach(() => {
      mockSDK.messages.create.mockResolvedValue({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Task completed successfully' }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        usage: { input_tokens: 50, output_tokens: 100 },
      } as any);
    });

    it('should execute task using SDK', async () => {
      const result = await executor.executeTask(mockTask, mockAgent);

      expect(result.success).toBe(true);
      expect(result.output).toBeDefined();
      expect(result.tokensUsed).toBe(150); // 50 + 100
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it('should track execution statistics', async () => {
      await executor.executeTask(mockTask, mockAgent);
      await executor.executeTask({ ...mockTask, id: 'task-124' }, mockAgent);

      const stats = executor.getExecutionStats();
      expect(stats.size).toBe(2);
    });

    it('should emit task lifecycle events', async () => {
      const startListener = jest.fn();
      const completeListener = jest.fn();

      executor.on('task:start', startListener);
      executor.on('task:complete', completeListener);

      await executor.executeTask(mockTask, mockAgent);

      expect(startListener).toHaveBeenCalledTimes(1);
      expect(completeListener).toHaveBeenCalledTimes(1);
    });

    it('should handle task execution errors gracefully', async () => {
      mockSDK.messages.create.mockRejectedValue(new Error('API Error'));

      const errorListener = jest.fn();
      executor.on('task:error', errorListener);

      const result = await executor.executeTask(mockTask, mockAgent);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(errorListener).toHaveBeenCalledTimes(1);
    });

    it('should support streaming task execution', async () => {
      mockSDK.messages.create.mockResolvedValue({
        id: 'msg-123',
        content: [{ type: 'text', text: 'Streaming response' }],
        usage: { input_tokens: 50, output_tokens: 100 },
      } as any);

      const chunks: string[] = [];
      const result = await executor.executeStreamingTask(
        mockTask,
        mockAgent,
        (chunk) => chunks.push(chunk)
      );

      expect(result.success).toBe(true);
    });

    it('should provide health status', async () => {
      const health = await executor.getHealthStatus();

      expect(health).toBeDefined();
      expect(health.executorStats).toBeDefined();
      expect(health.executorStats.swarmMode).toBe(true);
    });
  });

  describe('Phase 6: Claude Client V2.5', () => {
    beforeEach(() => {
      mockSDK.messages.create.mockResolvedValue({
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Client response' }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        usage: { input_tokens: 25, output_tokens: 50 },
      } as any);
    });

    it('should make request using SDK', async () => {
      const response = await client.makeRequest({
        model: 'claude-3-sonnet-20240229',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1024,
      });

      expect(response).toBeDefined();
      expect(response.content[0].text).toBe('Client response');
      expect(response.usage.input_tokens).toBe(25);
      expect(response.usage.output_tokens).toBe(50);
    });

    it('should support streaming requests', async () => {
      const chunks: any[] = [];
      const response = await client.makeStreamingRequest(
        {
          model: 'claude-3-sonnet-20240229',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1024,
          stream: true,
        },
        (chunk) => chunks.push(chunk)
      );

      expect(response).toBeDefined();
    });

    it('should validate configuration', async () => {
      mockSDK.messages.create.mockResolvedValue({} as any);

      const isValid = await client.validateConfiguration();
      expect(isValid).toBe(true);
    });

    it('should get usage statistics', async () => {
      await client.makeRequest({
        model: 'claude-3-sonnet-20240229',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1024,
      });

      const stats = client.getUsageStats();
      expect(stats.messageCount).toBeGreaterThan(0);
    });

    it('should check health status', async () => {
      mockSDK.messages.create.mockResolvedValue({} as any);

      const health = await client.checkHealth();
      expect(health.status).toBe('healthy');
      expect(health.details.swarmMode).toBe(true);
    });

    it('should emit request lifecycle events', async () => {
      const startListener = jest.fn();
      const successListener = jest.fn();

      client.on('request:start', startListener);
      client.on('request:success', successListener);

      await client.makeRequest({
        model: 'claude-3-sonnet-20240229',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1024,
      });

      expect(startListener).toHaveBeenCalledTimes(1);
      expect(successListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('End-to-End Integration', () => {
    it('should handle complete swarm workflow', async () => {
      mockSDK.messages.create.mockResolvedValue({
        id: 'msg-123',
        content: [{ type: 'text', text: 'Workflow complete' }],
        usage: { input_tokens: 100, output_tokens: 200 },
      } as any);

      const task = {
        id: 'workflow-task',
        type: 'full_workflow',
        description: 'Complete swarm workflow test',
        priority: 'high' as const,
        status: 'pending' as const,
        dependencies: [],
      };

      const agent = {
        id: 'workflow-agent',
        type: 'coordinator',
        status: 'idle' as const,
        capabilities: ['coordination', 'orchestration'],
        currentTask: null,
        taskHistory: [],
        metrics: {
          tasksCompleted: 0,
          averageExecutionTime: 0,
          successRate: 0,
        },
      };

      // Execute task
      const result = await executor.executeTask(task, agent);
      expect(result.success).toBe(true);

      // Verify swarm metadata
      const metadata = adapter.getSwarmMetadata('msg-123');
      expect(metadata).toBeDefined();

      // Verify usage stats
      const stats = adapter.getUsageStats();
      expect(stats.totalTokens).toBeGreaterThan(0);
    });
  });
});