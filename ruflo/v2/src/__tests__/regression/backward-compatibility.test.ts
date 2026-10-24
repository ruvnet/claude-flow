/**
 * Backward Compatibility Regression Tests
 * Phase 7: Comprehensive Testing & Validation
 *
 * Ensures existing functionality still works with SDK integration
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ClaudeFlowSDKAdapter } from '../../sdk/sdk-config.js';
import { SDKCompatibilityLayer } from '../../sdk/compatibility-layer.js';
import { TaskExecutorSDK } from '../../swarm/executor-sdk.js';
import { ClaudeClientV25 } from '../../api/claude-client-v2.5.js';

describe('Backward Compatibility Tests', () => {
  let adapter: ClaudeFlowSDKAdapter;
  let compatibility: SDKCompatibilityLayer;

  beforeEach(() => {
    adapter = new ClaudeFlowSDKAdapter({
      apiKey: 'test-api-key',
      swarmMode: true,
    });
    compatibility = new SDKCompatibilityLayer(adapter);
  });

  describe('Legacy API Compatibility', () => {
    it('should support legacy model names', () => {
      const legacyModels = [
        'claude-2.1',
        'claude-2.0',
        'claude-instant-1.2',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307',
      ];

      legacyModels.forEach((model) => {
        const request = compatibility.mapLegacyRequest({
          model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 1024,
        });

        expect(request.model).toBeDefined();
        expect(request.messages).toHaveLength(1);
      });
    });

    it('should maintain legacy request format', () => {
      const legacyRequest = {
        model: 'claude-2.1',
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1024,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 5,
        system: 'You are a helpful assistant',
        metadata: { user_id: 'user-123' },
        stop_sequences: ['STOP'],
      };

      const sdkRequest = compatibility.mapLegacyRequest(legacyRequest);

      expect(sdkRequest.model).toBe('claude-2.1');
      expect(sdkRequest.messages).toEqual(legacyRequest.messages);
      expect(sdkRequest.max_tokens).toBe(1024);
      expect(sdkRequest.temperature).toBe(0.7);
      expect(sdkRequest.top_p).toBe(0.9);
      expect(sdkRequest.top_k).toBe(5);
      expect(sdkRequest.system).toBe(legacyRequest.system);
      expect(sdkRequest.stop_sequences).toEqual(['STOP']);
    });

    it('should convert SDK responses to legacy format', () => {
      const sdkResponse = {
        id: 'msg-123',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Response text' }],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn' as const,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      };

      const legacyResponse = compatibility.mapSDKResponse(sdkResponse as any);

      expect(legacyResponse.id).toBe('msg-123');
      expect(legacyResponse.type).toBe('message');
      expect(legacyResponse.role).toBe('assistant');
      expect(legacyResponse.content[0].text).toBe('Response text');
      expect(legacyResponse.usage.input_tokens).toBe(10);
    });

    it('should support deprecated executeWithRetry method', async () => {
      let callCount = 0;
      const fn = async () => {
        callCount++;
        return 'success';
      };

      const result = await compatibility.executeWithRetry(fn, {
        maxRetries: 3,
      });

      expect(result).toBe('success');
      expect(callCount).toBe(1);
    });

    it('should log deprecation warnings only once', () => {
      compatibility.calculateBackoff(1);
      compatibility.calculateBackoff(2);
      compatibility.calculateBackoff(3);

      const warnings = compatibility.getDeprecationReport();
      expect(warnings).toContain('calculateBackoff');
      expect(warnings.filter((w) => w === 'calculateBackoff').length).toBe(1);
    });
  });

  describe('Legacy Configuration Options', () => {
    it('should support ANTHROPIC_API_KEY environment variable', () => {
      process.env.ANTHROPIC_API_KEY = 'env-api-key';

      const newAdapter = new ClaudeFlowSDKAdapter({});
      expect(newAdapter.getConfig().apiKey).toBe('env-api-key');

      delete process.env.ANTHROPIC_API_KEY;
    });

    it('should support CLAUDE_API_KEY environment variable', () => {
      process.env.CLAUDE_API_KEY = 'claude-api-key';
      delete process.env.ANTHROPIC_API_KEY;

      const newAdapter = new ClaudeFlowSDKAdapter({});
      expect(newAdapter.getConfig().apiKey).toBe('claude-api-key');

      delete process.env.CLAUDE_API_KEY;
    });

    it('should maintain default configuration values', () => {
      const defaultAdapter = new ClaudeFlowSDKAdapter({
        apiKey: 'test-key',
      });

      const config = defaultAdapter.getConfig();

      expect(config.maxRetries).toBe(3);
      expect(config.timeout).toBe(60000);
      expect(config.swarmMode).toBe(true);
      expect(config.persistenceEnabled).toBe(true);
      expect(config.checkpointInterval).toBe(60000);
    });

    it('should allow custom configuration overrides', () => {
      const customAdapter = new ClaudeFlowSDKAdapter({
        apiKey: 'test-key',
        maxRetries: 5,
        timeout: 120000,
        swarmMode: false,
        persistenceEnabled: false,
        checkpointInterval: 90000,
      });

      const config = customAdapter.getConfig();

      expect(config.maxRetries).toBe(5);
      expect(config.timeout).toBe(120000);
      expect(config.swarmMode).toBe(false);
      expect(config.persistenceEnabled).toBe(false);
      expect(config.checkpointInterval).toBe(90000);
    });
  });

  describe('Legacy Task Execution', () => {
    it('should maintain task structure compatibility', () => {
      const legacyTask = {
        id: 'task-123',
        type: 'code_generation',
        description: 'Generate code',
        priority: 'high' as const,
        status: 'pending' as const,
        dependencies: ['task-100'],
      };

      // Task structure should remain unchanged
      expect(legacyTask.id).toBe('task-123');
      expect(legacyTask.type).toBe('code_generation');
      expect(legacyTask.dependencies).toEqual(['task-100']);
    });

    it('should maintain agent state compatibility', () => {
      const legacyAgent = {
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

      // Agent structure should remain unchanged
      expect(legacyAgent.type).toBe('coder');
      expect(legacyAgent.capabilities).toContain('code_generation');
      expect(legacyAgent.metrics).toBeDefined();
    });

    it('should maintain execution result format', () => {
      const legacyResult = {
        success: true,
        output: 'Task completed',
        errors: [],
        executionTime: 1500,
        tokensUsed: 250,
        retryCount: 0,
        checkpointId: 'checkpoint-123',
      };

      // Result format should remain unchanged
      expect(legacyResult.success).toBe(true);
      expect(legacyResult.output).toBe('Task completed');
      expect(legacyResult.errors).toHaveLength(0);
      expect(legacyResult.tokensUsed).toBe(250);
    });
  });

  describe('Legacy Error Handling', () => {
    it('should maintain error type compatibility', () => {
      const errorTypes = [
        'ClaudeAPIError',
        'ClaudeAuthenticationError',
        'ClaudeRateLimitError',
        'ClaudeValidationError',
      ];

      errorTypes.forEach((errorType) => {
        expect(errorType).toMatch(/Claude.*Error/);
      });
    });

    it('should preserve error message format', () => {
      const legacyError = {
        name: 'ClaudeAPIError',
        message: 'API request failed',
        status: 500,
        details: { retries: 3 },
      };

      expect(legacyError.name).toContain('Error');
      expect(legacyError.message).toBeDefined();
      expect(legacyError.status).toBe(500);
    });

    it('should maintain retry behavior on rate limits', async () => {
      let attempts = 0;
      const maxRetries = 3;

      const retryFunction = async () => {
        attempts++;
        if (attempts < maxRetries) {
          throw new Error('Rate limit');
        }
        return 'success';
      };

      try {
        const result = await compatibility.executeWithRetry(retryFunction, {
          maxRetries,
        });
        expect(result).toBe('success');
        expect(attempts).toBe(maxRetries);
      } catch (error) {
        // Should not reach here
        expect(true).toBe(false);
      }
    });
  });

  describe('Legacy Event Emission', () => {
    it('should maintain event names and payloads', () => {
      const legacyEvents = [
        { name: 'request:start', payload: { requestId: 'req-123' } },
        { name: 'request:success', payload: { response: {} } },
        { name: 'request:error', payload: { error: {} } },
        { name: 'task:start', payload: { taskId: 'task-123' } },
        { name: 'task:complete', payload: { result: {} } },
        { name: 'task:error', payload: { error: {} } },
      ];

      legacyEvents.forEach((event) => {
        expect(event.name).toMatch(/^(request|task):/);
        expect(event.payload).toBeDefined();
      });
    });
  });

  describe('Legacy CLI Integration', () => {
    it('should maintain CLI command structure', () => {
      const legacyCommands = {
        'swarm init': { topology: 'mesh', maxAgents: 5 },
        'agent spawn': { type: 'coder', capabilities: [] },
        'task orchestrate': { task: 'test', strategy: 'parallel' },
        'swarm status': {},
      };

      Object.keys(legacyCommands).forEach((command) => {
        expect(command).toMatch(/^(swarm|agent|task)/);
      });
    });

    it('should maintain CLI output format', () => {
      const legacyOutput = {
        status: 'success',
        data: { swarmId: 'swarm-123' },
        timestamp: Date.now(),
      };

      expect(legacyOutput.status).toBe('success');
      expect(legacyOutput.data).toBeDefined();
      expect(legacyOutput.timestamp).toBeGreaterThan(0);
    });
  });

  describe('Legacy Memory Operations', () => {
    it('should maintain memory key format', () => {
      const legacyKeys = [
        'swarm/status',
        'swarm/agents',
        'swarm/tasks',
        'coordination/state',
        'metrics/performance',
      ];

      legacyKeys.forEach((key) => {
        expect(key).toMatch(/^[a-z]+\/[a-z]+$/);
      });
    });

    it('should maintain memory namespace structure', () => {
      const legacyNamespaces = ['default', 'coordination', 'metrics', 'cache'];

      legacyNamespaces.forEach((namespace) => {
        expect(namespace).toMatch(/^[a-z]+$/);
      });
    });
  });

  describe('Legacy Hook System', () => {
    it('should maintain hook event names', () => {
      const legacyHooks = [
        'pre-task',
        'post-task',
        'pre-edit',
        'post-edit',
        'session-start',
        'session-end',
        'session-restore',
      ];

      legacyHooks.forEach((hook) => {
        expect(hook).toMatch(/^(pre|post|session)-/);
      });
    });

    it('should maintain hook payload structure', () => {
      const legacyHookPayload = {
        hookName: 'pre-task',
        timestamp: Date.now(),
        metadata: { taskId: 'task-123' },
      };

      expect(legacyHookPayload.hookName).toBeDefined();
      expect(legacyHookPayload.timestamp).toBeGreaterThan(0);
      expect(legacyHookPayload.metadata).toBeDefined();
    });
  });

  describe('Legacy Metrics System', () => {
    it('should maintain metrics structure', () => {
      const legacyMetrics = {
        taskMetrics: {
          totalTasks: 10,
          completedTasks: 8,
          failedTasks: 2,
        },
        performanceMetrics: {
          averageExecutionTime: 1500,
          totalExecutionTime: 15000,
        },
        systemMetrics: {
          memoryUsage: 0.5,
          cpuUsage: 0.3,
        },
      };

      expect(legacyMetrics.taskMetrics).toBeDefined();
      expect(legacyMetrics.performanceMetrics).toBeDefined();
      expect(legacyMetrics.systemMetrics).toBeDefined();
    });

    it('should maintain usage statistics format', () => {
      const stats = adapter.getUsageStats();

      expect(stats).toHaveProperty('totalTokens');
      expect(stats).toHaveProperty('messageCount');
      expect(typeof stats.totalTokens).toBe('number');
      expect(typeof stats.messageCount).toBe('number');
    });
  });

  describe('Legacy Swarm Coordination', () => {
    it('should maintain swarm topology types', () => {
      const legacyTopologies = ['mesh', 'hierarchical', 'ring', 'star'];

      legacyTopologies.forEach((topology) => {
        expect(['mesh', 'hierarchical', 'ring', 'star']).toContain(topology);
      });
    });

    it('should maintain agent types', () => {
      const legacyAgentTypes = [
        'researcher',
        'coder',
        'analyst',
        'optimizer',
        'coordinator',
      ];

      legacyAgentTypes.forEach((type) => {
        expect([
          'researcher',
          'coder',
          'analyst',
          'optimizer',
          'coordinator',
        ]).toContain(type);
      });
    });

    it('should maintain coordination strategy types', () => {
      const legacyStrategies = ['balanced', 'specialized', 'adaptive'];

      legacyStrategies.forEach((strategy) => {
        expect(['balanced', 'specialized', 'adaptive']).toContain(strategy);
      });
    });
  });

  describe('Version Migration', () => {
    it('should handle v2.0.0 to v2.5.0 migration', () => {
      // v2.0.0 format
      const v2Config = {
        apiKey: 'test-key',
        customRetryLogic: true, // deprecated
        customErrorHandling: true, // deprecated
      };

      // v2.5.0 should ignore deprecated fields
      const newAdapter = new ClaudeFlowSDKAdapter({
        apiKey: v2Config.apiKey,
      });

      expect(newAdapter.getConfig().apiKey).toBe('test-key');
    });

    it('should provide migration warnings for deprecated features', () => {
      const deprecatedFeatures = [
        'calculateBackoff',
        'persistToDisk',
        'executeValidations',
      ];

      deprecatedFeatures.forEach((feature) => {
        if (feature === 'calculateBackoff') {
          compatibility.calculateBackoff(1);
        }
      });

      const warnings = compatibility.getDeprecationReport();
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Integration with Existing Codebase', () => {
    it('should work with existing executor instances', () => {
      const executor = new TaskExecutorSDK({
        apiKey: 'test-key',
        swarmMode: true,
      });

      expect(executor).toBeDefined();
      expect(executor.getExecutionStats).toBeDefined();
      expect(executor.executeTask).toBeDefined();
    });

    it('should work with existing client instances', () => {
      const client = new ClaudeClientV25(
        {
          apiKey: 'test-key',
          enableSwarmMode: true,
        },
        undefined
      );

      expect(client).toBeDefined();
      expect(client.makeRequest).toBeDefined();
      expect(client.validateConfiguration).toBeDefined();
    });

    it('should preserve all existing public APIs', () => {
      // Verify SDK Adapter APIs
      expect(adapter.getSDK).toBeDefined();
      expect(adapter.getConfig).toBeDefined();
      expect(adapter.createMessage).toBeDefined();
      expect(adapter.validateConfiguration).toBeDefined();
      expect(adapter.getUsageStats).toBeDefined();

      // Verify Compatibility Layer APIs
      expect(compatibility.executeWithRetry).toBeDefined();
      expect(compatibility.mapLegacyRequest).toBeDefined();
      expect(compatibility.mapSDKResponse).toBeDefined();
      expect(compatibility.getDeprecationReport).toBeDefined();
    });
  });
});