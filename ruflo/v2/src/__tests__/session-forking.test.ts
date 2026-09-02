/**
 * Session Forking Tests
 * Claude-Flow v2.5-alpha.130
 *
 * Tests for parallel agent execution and real-time query control
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ParallelSwarmExecutor, type ParallelAgentConfig } from '../sdk/session-forking.js';
import { RealTimeQueryController, type QueryControlCommand } from '../sdk/query-control.js';
import { query, type Query } from '@anthropic-ai/claude-code/sdk';

// Mock the SDK query function
vi.mock('@anthropic-ai/claude-code/sdk', () => ({
  query: vi.fn()
}));

describe('ParallelSwarmExecutor', () => {
  let executor: ParallelSwarmExecutor;

  beforeEach(() => {
    executor = new ParallelSwarmExecutor();
  });

  afterEach(() => {
    executor.removeAllListeners();
  });

  describe('spawnParallelAgents', () => {
    it('should spawn multiple agents in parallel', async () => {
      const configs: ParallelAgentConfig[] = [
        {
          agentId: 'agent-1',
          agentType: 'researcher',
          task: 'Research AI trends',
          priority: 'high'
        },
        {
          agentId: 'agent-2',
          agentType: 'coder',
          task: 'Write test code',
          priority: 'medium'
        },
        {
          agentId: 'agent-3',
          agentType: 'analyst',
          task: 'Analyze data',
          priority: 'high'
        }
      ];

      // Mock query responses
      const mockQuery = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            uuid: 'test-uuid',
            session_id: 'test-session',
            tools: [],
            model: 'claude-sonnet-4',
            mcp_servers: [],
            permissionMode: 'default',
            slash_commands: [],
            output_style: 'text',
            cwd: '/test',
            apiKeySource: 'user'
          };
          yield {
            type: 'assistant',
            uuid: 'test-uuid-2',
            session_id: 'test-session',
            parent_tool_use_id: null,
            message: {
              id: 'msg-1',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'Task completed successfully' }],
              model: 'claude-sonnet-4',
              stop_reason: 'end_turn',
              usage: { input_tokens: 100, output_tokens: 50 }
            }
          };
        },
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        supportedCommands: vi.fn(),
        supportedModels: vi.fn(),
        mcpServerStatus: vi.fn()
      } as any;

      vi.mocked(query).mockReturnValue(mockQuery);

      const result = await executor.spawnParallelAgents(configs, {
        maxParallelAgents: 5,
        timeout: 30000
      });

      expect(result.success).toBe(true);
      expect(result.successfulAgents).toHaveLength(3);
      expect(result.failedAgents).toHaveLength(0);
      expect(result.agentResults.size).toBe(3);
    });

    it('should respect priority ordering', async () => {
      const configs: ParallelAgentConfig[] = [
        { agentId: 'low', agentType: 'analyst', task: 'Low priority', priority: 'low' },
        { agentId: 'critical', agentType: 'researcher', task: 'Critical task', priority: 'critical' },
        { agentId: 'medium', agentType: 'coder', task: 'Medium task', priority: 'medium' },
        { agentId: 'high', agentType: 'optimizer', task: 'High priority', priority: 'high' }
      ];

      const executionOrder: string[] = [];

      executor.on('session:forked', (data) => {
        executionOrder.push(data.agentId);
      });

      const mockQuery = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            uuid: 'test-uuid',
            session_id: 'test-session',
            tools: [],
            model: 'claude-sonnet-4',
            mcp_servers: [],
            permissionMode: 'default',
            slash_commands: [],
            output_style: 'text',
            cwd: '/test',
            apiKeySource: 'user'
          };
        },
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        supportedCommands: vi.fn(),
        supportedModels: vi.fn(),
        mcpServerStatus: vi.fn()
      } as any;

      vi.mocked(query).mockReturnValue(mockQuery);

      await executor.spawnParallelAgents(configs, { maxParallelAgents: 2 });

      // Critical should be first, then high, medium, low
      expect(executionOrder[0]).toBe('critical');
      expect(executionOrder[1]).toBe('high');
    });

    it('should handle agent failures gracefully', async () => {
      const configs: ParallelAgentConfig[] = [
        { agentId: 'success', agentType: 'researcher', task: 'Will succeed' },
        { agentId: 'fail', agentType: 'coder', task: 'Will fail' }
      ];

      let callCount = 0;
      vi.mocked(query).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Simulated failure');
        }
        return {
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'system',
              subtype: 'init',
              uuid: 'test-uuid',
              session_id: 'test-session',
              tools: [],
              model: 'claude-sonnet-4',
              mcp_servers: [],
              permissionMode: 'default',
              slash_commands: [],
              output_style: 'text',
              cwd: '/test',
              apiKeySource: 'user'
            };
          },
          interrupt: vi.fn()
        } as any;
      });

      const result = await executor.spawnParallelAgents(configs);

      expect(result.success).toBe(false);
      expect(result.successfulAgents).toHaveLength(1);
      expect(result.failedAgents).toHaveLength(1);
      expect(result.failedAgents[0]).toBe('fail');
    });

    it('should batch agents when exceeding maxParallelAgents', async () => {
      const configs: ParallelAgentConfig[] = Array.from({ length: 15 }, (_, i) => ({
        agentId: `agent-${i}`,
        agentType: 'researcher',
        task: `Task ${i}`
      }));

      const mockQuery = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            uuid: 'test-uuid',
            session_id: 'test-session',
            tools: [],
            model: 'claude-sonnet-4',
            mcp_servers: [],
            permissionMode: 'default',
            slash_commands: [],
            output_style: 'text',
            cwd: '/test',
            apiKeySource: 'user'
          };
        },
        interrupt: vi.fn()
      } as any;

      vi.mocked(query).mockReturnValue(mockQuery);

      const result = await executor.spawnParallelAgents(configs, {
        maxParallelAgents: 5
      });

      expect(result.successfulAgents).toHaveLength(15);
      // Should execute in 3 batches (5, 5, 5)
    });
  });

  describe('Performance Metrics', () => {
    it('should track performance gain', async () => {
      const configs: ParallelAgentConfig[] = [
        { agentId: 'agent-1', agentType: 'researcher', task: 'Task 1' },
        { agentId: 'agent-2', agentType: 'coder', task: 'Task 2' },
        { agentId: 'agent-3', agentType: 'analyst', task: 'Task 3' }
      ];

      const mockQuery = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'system',
            subtype: 'init',
            uuid: 'test-uuid',
            session_id: 'test-session',
            tools: [],
            model: 'claude-sonnet-4',
            mcp_servers: [],
            permissionMode: 'default',
            slash_commands: [],
            output_style: 'text',
            cwd: '/test',
            apiKeySource: 'user'
          };
        },
        interrupt: vi.fn()
      } as any;

      vi.mocked(query).mockReturnValue(mockQuery);

      await executor.spawnParallelAgents(configs);

      const metrics = executor.getMetrics();
      expect(metrics.totalAgentsSpawned).toBe(3);
      expect(metrics.parallelExecutions).toBe(1);
      expect(metrics.performanceGain).toBeGreaterThan(1); // Should show improvement
    });
  });
});

describe('RealTimeQueryController', () => {
  let controller: RealTimeQueryController;

  beforeEach(() => {
    controller = new RealTimeQueryController({
      allowPause: true,
      allowModelChange: true,
      allowPermissionChange: true,
      monitoringInterval: 100
    });
  });

  afterEach(() => {
    controller.shutdown();
  });

  describe('Query Registration', () => {
    it('should register a query for control', () => {
      const mockQuery = {
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn(),
        supportedCommands: vi.fn(),
        supportedModels: vi.fn()
      } as any;

      const controlled = controller.registerQuery('query-1', 'agent-1', mockQuery);

      expect(controlled.queryId).toBe('query-1');
      expect(controlled.agentId).toBe('agent-1');
      expect(controlled.status).toBe('running');
      expect(controlled.canControl).toBe(true);
    });
  });

  describe('Query Control', () => {
    it('should pause a running query', async () => {
      const mockQuery = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        setPermissionMode: vi.fn(),
        setModel: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);

      const paused = await controller.pauseQuery('query-1', 'Manual pause');

      expect(paused).toBe(true);
      expect(mockQuery.interrupt).toHaveBeenCalled();

      const status = controller.getQueryStatus('query-1');
      expect(status?.status).toBe('paused');
      expect(status?.isPaused).toBe(true);
    });

    it('should resume a paused query', async () => {
      const mockQuery = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        setPermissionMode: vi.fn(),
        setModel: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);
      await controller.pauseQuery('query-1');

      const resumed = await controller.resumeQuery('query-1');

      expect(resumed).toBe(true);

      const status = controller.getQueryStatus('query-1');
      expect(status?.status).toBe('running');
      expect(status?.isPaused).toBe(false);
    });

    it('should terminate a query', async () => {
      const mockQuery = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        setPermissionMode: vi.fn(),
        setModel: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);

      const terminated = await controller.terminateQuery('query-1', 'Test termination');

      expect(terminated).toBe(true);
      expect(mockQuery.interrupt).toHaveBeenCalled();

      const status = controller.getQueryStatus('query-1');
      expect(status?.status).toBe('terminated');
    });

    it('should change model for a running query', async () => {
      const mockQuery = {
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn().mockResolvedValue(undefined),
        supportedModels: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);

      const changed = await controller.changeModel('query-1', 'claude-opus-4');

      expect(changed).toBe(true);
      expect(mockQuery.setModel).toHaveBeenCalledWith('claude-opus-4');

      const status = controller.getQueryStatus('query-1');
      expect(status?.currentModel).toBe('claude-opus-4');
    });

    it('should change permission mode', async () => {
      const mockQuery = {
        interrupt: vi.fn(),
        setPermissionMode: vi.fn().mockResolvedValue(undefined),
        setModel: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);

      const changed = await controller.changePermissionMode('query-1', 'bypassPermissions');

      expect(changed).toBe(true);
      expect(mockQuery.setPermissionMode).toHaveBeenCalledWith('bypassPermissions');

      const status = controller.getQueryStatus('query-1');
      expect(status?.permissionMode).toBe('bypassPermissions');
    });
  });

  describe('Command Queue', () => {
    it('should queue and execute commands', async () => {
      const mockQuery = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        setPermissionMode: vi.fn(),
        setModel: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);

      const command: QueryControlCommand = {
        type: 'pause',
        queryId: 'query-1',
        params: { reason: 'Test pause' }
      };

      controller.queueCommand(command);
      await controller.processQueuedCommands('query-1');

      expect(mockQuery.interrupt).toHaveBeenCalled();
    });
  });

  describe('Monitoring', () => {
    it('should emit status updates during monitoring', (done) => {
      const mockQuery = {
        interrupt: vi.fn(),
        setPermissionMode: vi.fn(),
        setModel: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);

      let updateCount = 0;
      controller.on('query:status', (update) => {
        updateCount++;
        if (updateCount >= 2) {
          expect(update.queryId).toBe('query-1');
          expect(update.status).toBe('running');
          done();
        }
      });
    });
  });

  describe('Cleanup', () => {
    it('should cleanup old queries', async () => {
      const mockQuery = {
        interrupt: vi.fn().mockResolvedValue(undefined),
        setPermissionMode: vi.fn(),
        setModel: vi.fn()
      } as any;

      controller.registerQuery('query-1', 'agent-1', mockQuery);
      await controller.terminateQuery('query-1');

      // Cleanup queries older than 0ms (all queries)
      controller.cleanup(0);

      const status = controller.getQueryStatus('query-1');
      expect(status).toBeUndefined();
    });
  });
});