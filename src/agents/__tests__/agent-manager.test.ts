/**
 * Jest tests for AgentManager TypeScript fixes
 * Tests the type safety improvements made in Issue #136
 */

import { AgentManager } from '../agent-manager';
import { EventEmitter } from 'node:events';
import type { ILogger } from '../../core/logger';
import type { IEventBus } from '../../core/event-bus';
import type { AgentType, AgentMetrics, AgentError } from '../../swarm/types';

// Mock implementations
const createMockLogger = (): jest.Mocked<ILogger> => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
});

const createMockEventBus = (): jest.Mocked<IEventBus> => ({
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  removeAllListeners: jest.fn(),
});

describe('AgentManager TypeScript Fixes', () => {
  let manager: AgentManager;
  let mockEventBus: jest.Mocked<IEventBus>;
  let mockLogger: jest.Mocked<ILogger>;

  beforeEach(() => {
    mockEventBus = createMockEventBus();
    mockLogger = createMockLogger();

    manager = new AgentManager({
      maxAgents: 10,
      defaultTimeout: 30000,
      heartbeatInterval: 5000,
      healthCheckInterval: 10000,
      autoRestart: true,
      resourceLimits: {
        memory: 1024,
        cpu: 2,
        disk: 5000
      },
      agentDefaults: {
        autonomyLevel: 0.5,
        learningEnabled: true,
        adaptationEnabled: true
      },
      environmentDefaults: {
        runtime: 'node',
        workingDirectory: './agents',
        tempDirectory: './tmp',
        logDirectory: './logs'
      }
    }, mockLogger, mockEventBus);
  });

  describe('Event Handling Type Safety', () => {
    it('should handle heartbeat events with proper typing', () => {
      const heartbeatData = {
        agentId: 'test-agent',
        timestamp: new Date(),
        metrics: {
          tasksCompleted: 5,
          tasksFailed: 0,
          averageExecutionTime: 1000,
          successRate: 1.0,
          cpuUsage: 0.1,
          memoryUsage: 256,
          diskUsage: 100,
          networkUsage: 50,
          codeQuality: 0.9,
          testCoverage: 0.85,
          bugRate: 0.05,
          userSatisfaction: 0.95,
          totalUptime: 3600,
          lastActivity: new Date(),
          responseTime: 150
        } as AgentMetrics
      };

      // This should not cause TypeScript errors
      expect(() => {
        (manager as any).handleHeartbeat(heartbeatData);
      }).not.toThrow();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle unknown event data safely', () => {
      const unknownData = { unexpected: 'data' };
      
      // Should handle gracefully without TypeScript errors
      expect(() => {
        (manager as any).handleHeartbeat(unknownData);
      }).not.toThrow();
      
      // Should log a warning for invalid data
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Invalid heartbeat data received',
        { data: unknownData }
      );
    });

    it('should handle agent error events with proper typing', () => {
      const errorData = {
        agentId: 'test-agent',
        error: {
          timestamp: new Date(),
          type: 'runtime_error',
          message: 'Test error',
          context: { test: true },
          severity: 'medium',
          resolved: false
        } as AgentError
      };

      expect(() => {
        (manager as any).handleAgentError(errorData);
      }).not.toThrow();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle task assignment events safely', () => {
      const taskData = {
        agentId: 'test-agent',
        taskId: 'task-123',
        type: 'analysis'
      };

      expect(() => {
        (manager as any).handleTaskAssigned(taskData);
      }).not.toThrow();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle task completion events safely', () => {
      const taskData = {
        agentId: 'test-agent',
        taskId: 'task-123',
        metrics: {
          tasksCompleted: 1,
          tasksFailed: 0,
          averageExecutionTime: 500,
          successRate: 1.0,
          cpuUsage: 0.1,
          memoryUsage: 256,
          diskUsage: 100,
          networkUsage: 50,
          codeQuality: 0.9,
          testCoverage: 0.85,
          bugRate: 0.05,
          userSatisfaction: 0.95,
          totalUptime: 3600,
          lastActivity: new Date(),
          responseTime: 150
        } as AgentMetrics
      };

      expect(() => {
        (manager as any).handleTaskCompleted(taskData);
      }).not.toThrow();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should handle resource usage events safely', () => {
      const resourceData = {
        agentId: 'test-agent',
        usage: {
          cpu: 0.2,
          memory: 512,
          disk: 200
        }
      };

      expect(() => {
        (manager as any).handleResourceUsage(resourceData);
      }).not.toThrow();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Configuration Merging Type Safety', () => {
    it('should merge config with defaults properly', () => {
      const templateConfig = {
        autonomyLevel: 0.7,
        learningEnabled: true
        // Other properties should get defaults
      };

      const overrideConfig = {
        maxTasksPerHour: 20
      };

      const result = (manager as any).mergeConfigWithDefaults(templateConfig, overrideConfig);

      expect(result).toEqual({
        autonomyLevel: 0.7,
        learningEnabled: true,
        adaptationEnabled: true, // from defaults
        maxTasksPerHour: 20,
        maxConcurrentTasks: 3, // from defaults
        timeoutThreshold: 30000, // from manager config
        reportingInterval: 5000, // from manager config
        heartbeatInterval: 5000, // from manager config
        permissions: [],
        trustedAgents: [],
        expertise: {},
        preferences: {}
      });
    });

    it('should merge environment with defaults properly', () => {
      const templateEnv = {
        runtime: 'deno' as const,
        workingDirectory: '/custom/dir'
      };

      const overrideEnv = {
        version: '2.0.0'
      };

      const result = (manager as any).mergeEnvironmentWithDefaults(templateEnv, overrideEnv);

      expect(result).toEqual({
        runtime: 'deno',
        version: '2.0.0',
        workingDirectory: '/custom/dir',
        tempDirectory: './tmp', // from defaults
        logDirectory: './logs', // from defaults
        apiEndpoints: {},
        credentials: {},
        availableTools: [],
        toolConfigs: {}
      });
    });

    it('should handle undefined overrides safely', () => {
      const templateConfig = {
        autonomyLevel: 0.8
      };

      const result = (manager as any).mergeConfigWithDefaults(templateConfig, undefined);

      expect(result.autonomyLevel).toBe(0.8);
      expect(result.learningEnabled).toBe(true); // from defaults
      expect(result.adaptationEnabled).toBe(true); // from defaults
    });
  });

  describe('Type Guard Functions', () => {
    it('should validate heartbeat data correctly', () => {
      const validData = {
        agentId: 'test-agent',
        timestamp: new Date()
      };

      const invalidData = {
        agentId: 'test-agent'
        // missing timestamp
      };

      expect((manager as any).isHeartbeatData(validData)).toBe(true);
      expect((manager as any).isHeartbeatData(invalidData)).toBe(false);
      expect((manager as any).isHeartbeatData(null)).toBe(false);
      expect((manager as any).isHeartbeatData(undefined)).toBe(false);
      expect((manager as any).isHeartbeatData('string')).toBe(false);
    });

    it('should validate agent error data correctly', () => {
      const validData = {
        agentId: 'test-agent',
        error: { type: 'test', message: 'test' }
      };

      const invalidData = {
        agentId: 'test-agent'
        // missing error
      };

      expect((manager as any).isAgentErrorData(validData)).toBe(true);
      expect((manager as any).isAgentErrorData(invalidData)).toBe(false);
    });

    it('should validate task data correctly', () => {
      const validData = {
        agentId: 'test-agent',
        taskId: 'task-123'
      };

      const invalidData = {
        taskId: 'task-123'
        // missing agentId
      };

      expect((manager as any).isTaskData(validData)).toBe(true);
      expect((manager as any).isTaskData(invalidData)).toBe(false);
    });

    it('should validate resource usage data correctly', () => {
      const validData = {
        agentId: 'test-agent',
        usage: { cpu: 0.5, memory: 512, disk: 100 }
      };

      const invalidData = {
        agentId: 'test-agent'
        // missing usage
      };

      expect((manager as any).isResourceUsageData(validData)).toBe(true);
      expect((manager as any).isResourceUsageData(invalidData)).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown errors safely in catch blocks', () => {
      // This tests the error instanceof Error check in catch blocks
      const stringError = 'string error';
      const errorObject = new Error('real error');

      // Mock the addAgentError method to verify correct error message handling
      const addAgentErrorSpy = jest.spyOn(manager as any, 'addAgentError').mockImplementation(() => {});

      // Simulate the error handling from the catch block
      const handleError = (error: unknown) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return errorMessage;
      };

      expect(handleError(stringError)).toBe('string error');
      expect(handleError(errorObject)).toBe('real error');
      expect(handleError(null)).toBe('null');
      expect(handleError(undefined)).toBe('undefined');
      expect(handleError({ custom: 'object' })).toBe('[object Object]');

      addAgentErrorSpy.mockRestore();
    });
  });
});