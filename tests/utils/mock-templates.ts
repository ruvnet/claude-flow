/// <reference types="jest" />

/**
 * Mock Templates Library - Reusable, Jest-Compatible Mock Patterns
 * Provides pre-built templates for common interfaces and objects
 */

import { AsyncMockBuilder, EnhancedMockFactory } from './enhanced-mock-factory.js';

// =============================================================================
// TERMINAL MANAGEMENT MOCKS
// =============================================================================

/**
 * Terminal Manager Mock Template
 */
export const createTerminalManagerMock = (overrides: any = {}) => {
  const base = {
    initialize: async (): Promise<void> => {},
    shutdown: async (): Promise<void> => {},
    createSession: async (profile: any): Promise<string> => `session-${Date.now()}`,
    getSession: (sessionId: string) => ({ id: sessionId, status: 'active' }),
    destroySession: async (sessionId: string): Promise<void> => {},
    executeCommand: async (sessionId: string, command: any): Promise<string> => `Output: ${command}`,
    listSessions: (): any[] => [],
    getSessionCount: (): number => 0,
    getAvailableSlots: (): number => 5,
    performMaintenance: async (): Promise<void> => {},
    ...overrides
  };

  return AsyncMockBuilder.create(base)
    .spyOnAsync('initialize')
    .spyOnAsync('shutdown')
    .spyOnAsync('createSession')
    .spyOnSync('getSession')
    .spyOnAsync('destroySession')
    .spyOnAsync('executeCommand')
    .spyOnSync('listSessions')
    .spyOnSync('getSessionCount')
    .spyOnSync('getAvailableSlots')
    .spyOnAsync('performMaintenance')
    .build();
};

/**
 * Terminal Pool Mock Template
 */
export const createTerminalPoolMock = (overrides: any = {}) => {
  const base = {
    initialize: async (): Promise<void> => {},
    shutdown: async (): Promise<void> => {},
    createSession: async (profile: any): Promise<string> => `pool-session-${Date.now()}`,
    getSession: (sessionId: string) => ({ id: sessionId, status: 'active', pool: true }),
    destroySession: async (sessionId: string): Promise<void> => {},
    executeCommand: async (sessionId: string, command: any): Promise<string> => `Pool output: ${command}`,
    listSessions: (): any[] => [],
    getSessionCount: (): number => 0,
    getAvailableSlots: (): number => 10,
    performMaintenance: async (): Promise<void> => {},
    getPoolStats: () => ({ active: 0, idle: 5, total: 10 }),
    ...overrides
  };

  return AsyncMockBuilder.create(base)
    .spyOnAsync('initialize')
    .spyOnAsync('shutdown')
    .spyOnAsync('createSession')
    .spyOnSync('getSession')
    .spyOnAsync('destroySession')
    .spyOnAsync('executeCommand')
    .spyOnSync('listSessions')
    .spyOnSync('getSessionCount')
    .spyOnSync('getAvailableSlots')
    .spyOnAsync('performMaintenance')
    .spyOnSync('getPoolStats')
    .build();
};

// =============================================================================
// EVENT SYSTEM MOCKS
// =============================================================================

/**
 * Event Bus Mock Template
 */
export const createEventBusMock = (overrides: any = {}) => {
  const events: Array<{ event: string; data: any }> = [];
  const handlers = new Map<string, Array<(data: any) => void>>();

  const base = {
    emit: (event: string, data?: any) => {
      events.push({ event, data });
      const eventHandlers = handlers.get(event) || [];
      eventHandlers.forEach(handler => handler(data));
    },
    on: (event: string, handler: (data: any) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, []);
      }
      handlers.get(event)!.push(handler);
    },
    off: (event: string, handler: (data: any) => void) => {
      const eventHandlers = handlers.get(event) || [];
      const index = eventHandlers.indexOf(handler);
      if (index > -1) {
        eventHandlers.splice(index, 1);
      }
    },
    once: (event: string, handler: (data: any) => void) => {
      const wrappedHandler = (data: any) => {
        handler(data);
        base.off(event, wrappedHandler);
      };
      base.on(event, wrappedHandler);
    },
    removeAllListeners: (event?: string) => {
      if (event) {
        handlers.delete(event);
      } else {
        handlers.clear();
      }
    },
    getEvents: () => [...events],
    clearEvents: () => events.length = 0,
    ...overrides
  };

  return EnhancedMockFactory.createSafeMock(base);
};

// =============================================================================
// DATABASE MOCKS
// =============================================================================

/**
 * Database Connection Mock Template
 */
export const createDatabaseMock = (overrides: any = {}) => {
  const base = {
    connect: async (): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
    query: async (sql: string, params?: any[]): Promise<any[]> => [],
    execute: async (sql: string, params?: any[]): Promise<{ changes: number; lastID?: number }> => ({ 
      changes: 1, 
      lastID: Math.floor(Math.random() * 1000) 
    }),
    transaction: async <T>(callback: () => Promise<T>): Promise<T> => {
      return callback();
    },
    isConnected: (): boolean => true,
    getConnectionInfo: () => ({ database: 'test.db', type: 'sqlite' }),
    ...overrides
  };

  return AsyncMockBuilder.create(base)
    .spyOnAsync('connect')
    .spyOnAsync('disconnect')
    .spyOnAsync('query')
    .spyOnAsync('execute')
    .spyOnAsync('transaction')
    .spyOnSync('isConnected')
    .spyOnSync('getConnectionInfo')
    .build();
};

/**
 * SQLite Database Mock Template
 */
export const createSQLiteMock = (overrides: any = {}) => {
  return createDatabaseMock({
    pragma: async (statement: string): Promise<any[]> => [],
    backup: async (targetPath: string): Promise<void> => {},
    analyze: async (): Promise<void> => {},
    vacuum: async (): Promise<void> => {},
    getConnectionInfo: () => ({ database: 'test.db', type: 'sqlite', version: '3.39.0' }),
    ...overrides
  });
};

// =============================================================================
// LOGGER MOCKS
// =============================================================================

/**
 * Logger Mock Template
 */
export const createLoggerMock = (overrides: any = {}) => {
  const logs: Array<{ level: string; message: string; data?: any; timestamp: number }> = [];

  const base = {
    debug: (message: string, data?: any) => {
      logs.push({ level: 'debug', message, data, timestamp: Date.now() });
    },
    info: (message: string, data?: any) => {
      logs.push({ level: 'info', message, data, timestamp: Date.now() });
    },
    warn: (message: string, data?: any) => {
      logs.push({ level: 'warn', message, data, timestamp: Date.now() });
    },
    error: (message: string, error?: any) => {
      logs.push({ level: 'error', message, data: error, timestamp: Date.now() });
    },
    configure: async (config: any): Promise<void> => {},
    setLevel: (level: string) => {},
    getLevel: (): string => 'info',
    getLogs: () => [...logs],
    clearLogs: () => logs.length = 0,
    ...overrides
  };

  return EnhancedMockFactory.createSafeMock(base);
};

// =============================================================================
// COORDINATION MOCKS
// =============================================================================

/**
 * Task Coordinator Mock Template
 */
export const createTaskCoordinatorMock = (overrides: any = {}) => {
  const tasks = new Map<string, any>();
  const agentTasks = new Map<string, any[]>();

  const base = {
    initialize: async (): Promise<void> => {},
    shutdown: async (): Promise<void> => {
      tasks.clear();
      agentTasks.clear();
    },
    assignTask: async (task: any, agentId: string): Promise<void> => {
      tasks.set(task.id, { task, agentId });
      const agentTaskList = agentTasks.get(agentId) || [];
      agentTaskList.push(task);
      agentTasks.set(agentId, agentTaskList);
    },
    getAgentTaskCount: async (agentId: string): Promise<number> => {
      const agentTaskList = agentTasks.get(agentId) || [];
      return agentTaskList.filter(t => t.status !== 'completed' && t.status !== 'failed').length;
    },
    getAgentTasks: async (agentId: string): Promise<any[]> => {
      return agentTasks.get(agentId) || [];
    },
    cancelTask: async (taskId: string): Promise<void> => {
      const taskInfo = tasks.get(taskId);
      if (taskInfo) {
        taskInfo.task.status = 'cancelled';
      }
    },
    getHealthStatus: async (): Promise<{ 
      healthy: boolean; 
      error?: string; 
      metrics?: Record<string, number> 
    }> => {
      return {
        healthy: true,
        metrics: {
          activeTasks: tasks.size,
          activeAgents: agentTasks.size,
        }
      };
    },
    performMaintenance: async (): Promise<void> => {},
    ...overrides
  };

  return AsyncMockBuilder.create(base)
    .spyOnAsync('initialize')
    .spyOnAsync('shutdown')
    .spyOnAsync('assignTask')
    .spyOnAsync('getAgentTaskCount')
    .spyOnAsync('getAgentTasks')
    .spyOnAsync('cancelTask')
    .spyOnAsync('getHealthStatus')
    .spyOnAsync('performMaintenance')
    .build();
};

/**
 * MCP Server Mock Template
 */
export const createMcpServerMock = (overrides: any = {}) => {
  const tools = new Map<string, any>();

  const base = {
    start: async (): Promise<void> => {},
    stop: async (): Promise<void> => {
      tools.clear();
    },
    registerTool: (toolName: string, tool: any): void => {
      tools.set(toolName, tool);
    },
    getTools: (): any[] => Array.from(tools.values()),
    executeTool: async (toolName: string, args: any): Promise<any> => {
      const tool = tools.get(toolName);
      if (!tool) {
        throw new Error(`Tool ${toolName} not found`);
      }
      return { result: `Mock result for ${toolName}` };
    },
    getHealthStatus: async (): Promise<{ 
      healthy: boolean; 
      error?: string; 
      metrics?: Record<string, number> 
    }> => {
      return {
        healthy: true,
        metrics: {
          registeredTools: tools.size,
          uptime: Date.now(),
        }
      };
    },
    ...overrides
  };

  return AsyncMockBuilder.create(base)
    .spyOnAsync('start')
    .spyOnAsync('stop')
    .spyOnSync('registerTool')
    .spyOnSync('getTools')
    .spyOnAsync('executeTool')
    .spyOnAsync('getHealthStatus')
    .build();
};

// =============================================================================
// AGENT MOCKS
// =============================================================================

/**
 * Agent Mock Template
 */
export const createAgentMock = (overrides: any = {}) => {
  const base = {
    id: `agent-${Date.now()}`,
    type: 'generic',
    status: 'idle',
    initialize: async (): Promise<void> => {},
    shutdown: async (): Promise<void> => {},
    executeTask: async (task: any): Promise<any> => {
      return { status: 'completed', result: `Mock result for task ${task.id}` };
    },
    getStatus: (): string => base.status,
    getCapabilities: (): string[] => ['basic'],
    getMetrics: (): Record<string, number> => ({
      tasksCompleted: 0,
      tasksActive: 0,
      uptime: Date.now(),
    }),
    ...overrides
  };

  return AsyncMockBuilder.create(base)
    .spyOnAsync('initialize')
    .spyOnAsync('shutdown')
    .spyOnAsync('executeTask')
    .spyOnSync('getStatus')
    .spyOnSync('getCapabilities')
    .spyOnSync('getMetrics')
    .build();
};

// =============================================================================
// FILE SYSTEM MOCKS
// =============================================================================

/**
 * File System Mock Template
 */
export const createFileSystemMock = (overrides: any = {}) => {
  const files = new Map<string, string>();

  const base = {
    readFile: async (path: string): Promise<string> => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`File not found: ${path}`);
      }
      return content;
    },
    writeFile: async (path: string, content: string): Promise<void> => {
      files.set(path, content);
    },
    exists: async (path: string): Promise<boolean> => {
      return files.has(path);
    },
    deleteFile: async (path: string): Promise<void> => {
      files.delete(path);
    },
    listFiles: async (directory: string): Promise<string[]> => {
      return Array.from(files.keys()).filter(path => path.startsWith(directory));
    },
    mkdir: async (path: string): Promise<void> => {},
    rmdir: async (path: string): Promise<void> => {
      const pathsToDelete = Array.from(files.keys()).filter(p => p.startsWith(path));
      pathsToDelete.forEach(p => files.delete(p));
    },
    ...overrides
  };

  return AsyncMockBuilder.create(base)
    .spyOnAsync('readFile')
    .spyOnAsync('writeFile')
    .spyOnAsync('exists')
    .spyOnAsync('deleteFile')
    .spyOnAsync('listFiles')
    .spyOnAsync('mkdir')
    .spyOnAsync('rmdir')
    .build();
};

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Create a failing version of any mock template
 */
export const createFailingMock = <T>(
  mockTemplate: () => T,
  failingMethods: string[],
  error: Error = new Error('Mock failure')
): T => {
  const mock = mockTemplate();
  
  failingMethods.forEach(method => {
    const mockFn = (mock as any)[method];
    if (mockFn && typeof mockFn.mockRejectedValue === 'function') {
      mockFn.mockRejectedValue(error);
    } else if (mockFn && typeof mockFn.mockImplementation === 'function') {
      mockFn.mockImplementation(() => {
        throw error;
      });
    }
  });
  
  return mock;
};

/**
 * Create a delayed mock that simulates network/IO latency
 */
export const createDelayedMock = <T>(
  mockTemplate: () => T,
  delay: number = 100
): T => {
  const mock = mockTemplate();
  
  Object.keys(mock).forEach(key => {
    const method = (mock as any)[key];
    if (method && typeof method.mockImplementation === 'function') {
      const originalImplementation = method.getMockImplementation();
      if (originalImplementation) {
        method.mockImplementation(async (...args: any[]) => {
          await new Promise(resolve => setTimeout(resolve, delay));
          return originalImplementation(...args);
        });
      }
    }
  });
  
  return mock;
};

/**
 * Create performance-tracked mock for benchmarking
 */
export const createPerformanceTrackedMock = <T>(
  mockTemplate: () => T
): T & { getPerformanceMetrics: () => Record<string, { calls: number; totalTime: number; avgTime: number }> } => {
  const mock = mockTemplate();
  const performanceData = new Map<string, { calls: number; totalTime: number }>();
  
  Object.keys(mock).forEach(key => {
    const method = (mock as any)[key];
    if (method && typeof method.mockImplementation === 'function') {
      const originalImplementation = method.getMockImplementation();
      if (originalImplementation) {
        method.mockImplementation(async (...args: any[]) => {
          const start = performance.now();
          try {
            const result = await originalImplementation(...args);
            const duration = performance.now() - start;
            
            const existing = performanceData.get(key) || { calls: 0, totalTime: 0 };
            performanceData.set(key, {
              calls: existing.calls + 1,
              totalTime: existing.totalTime + duration
            });
            
            return result;
          } catch (error) {
            const duration = performance.now() - start;
            const existing = performanceData.get(key) || { calls: 0, totalTime: 0 };
            performanceData.set(key, {
              calls: existing.calls + 1,
              totalTime: existing.totalTime + duration
            });
            throw error;
          }
        });
      }
    }
  });
  
  return {
    ...mock,
    getPerformanceMetrics: () => {
      const metrics: Record<string, { calls: number; totalTime: number; avgTime: number }> = {};
      performanceData.forEach((data, key) => {
        metrics[key] = {
          calls: data.calls,
          totalTime: data.totalTime,
          avgTime: data.calls > 0 ? data.totalTime / data.calls : 0
        };
      });
      return metrics;
    }
  };
};