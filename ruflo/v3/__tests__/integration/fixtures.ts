/**
 * Integration Test Fixtures
 *
 * Shared test data and mock implementations for integration tests
 */

/**
 * Agent Fixtures
 */
export const AgentFixtures = {
  coder: {
    id: 'coder-fixture',
    type: 'coder',
    status: 'active',
    capabilities: ['code', 'refactor', 'debug'],
    metadata: {
      language: 'typescript',
      experience: 'senior'
    }
  },

  tester: {
    id: 'tester-fixture',
    type: 'tester',
    status: 'active',
    capabilities: ['test', 'validate', 'e2e'],
    metadata: {
      framework: 'vitest',
      coverage: true
    }
  },

  reviewer: {
    id: 'reviewer-fixture',
    type: 'reviewer',
    status: 'active',
    capabilities: ['review', 'analyze', 'security-audit'],
    metadata: {
      focus: 'security',
      automated: true
    }
  },

  coordinator: {
    id: 'coordinator-fixture',
    type: 'coordinator',
    status: 'active',
    role: 'leader',
    capabilities: ['coordinate', 'manage', 'orchestrate'],
    metadata: {
      topology: 'hierarchical',
      maxWorkers: 10
    }
  }
};

/**
 * Task Fixtures
 */
export const TaskFixtures = {
  simpleCode: {
    id: 'task-simple-code',
    type: 'code',
    description: 'Implement simple function',
    priority: 'medium' as const,
    status: 'pending',
    metadata: {
      complexity: 'low',
      estimatedTime: 300
    }
  },

  complexCode: {
    id: 'task-complex-code',
    type: 'code',
    description: 'Implement complex algorithm',
    priority: 'high' as const,
    status: 'pending',
    dependencies: [],
    metadata: {
      complexity: 'high',
      estimatedTime: 1800
    }
  },

  unitTest: {
    id: 'task-unit-test',
    type: 'test',
    description: 'Write unit tests',
    priority: 'high' as const,
    status: 'pending',
    metadata: {
      testType: 'unit',
      coverage: 'high'
    }
  },

  integrationTest: {
    id: 'task-integration-test',
    type: 'test',
    description: 'Write integration tests',
    priority: 'medium' as const,
    status: 'pending',
    dependencies: ['task-simple-code'],
    metadata: {
      testType: 'integration',
      coverage: 'medium'
    }
  },

  codeReview: {
    id: 'task-code-review',
    type: 'review',
    description: 'Review code changes',
    priority: 'high' as const,
    status: 'pending',
    dependencies: ['task-simple-code', 'task-unit-test'],
    metadata: {
      reviewType: 'security',
      automated: true
    }
  }
};

/**
 * Memory Fixtures
 */
export const MemoryFixtures = {
  taskMemory: {
    id: 'memory-task',
    agentId: 'coder-fixture',
    content: 'Completed login feature implementation',
    type: 'task',
    timestamp: Date.now(),
    metadata: {
      taskId: 'task-simple-code',
      success: true,
      duration: 250
    }
  },

  contextMemory: {
    id: 'memory-context',
    agentId: 'coder-fixture',
    content: 'User authentication system uses JWT tokens',
    type: 'context',
    timestamp: Date.now(),
    metadata: {
      category: 'authentication',
      relevance: 'high'
    }
  },

  eventMemory: {
    id: 'memory-event',
    agentId: 'system',
    content: 'Agent spawned successfully',
    type: 'event',
    timestamp: Date.now(),
    metadata: {
      eventType: 'agent-spawn',
      agentId: 'coder-fixture'
    }
  },

  vectorMemory: {
    id: 'memory-vector',
    agentId: 'coder-fixture',
    content: 'Implemented machine learning inference pipeline',
    type: 'task',
    timestamp: Date.now(),
    embedding: new Array(384).fill(0).map(() => Math.random()),
    metadata: {
      category: 'ml',
      algorithm: 'inference'
    }
  }
};

/**
 * Workflow Fixtures
 */
export const WorkflowFixtures = {
  simple: {
    id: 'workflow-simple',
    name: 'Simple Feature Workflow',
    tasks: [
      TaskFixtures.simpleCode,
      TaskFixtures.unitTest,
      TaskFixtures.codeReview
    ]
  },

  complex: {
    id: 'workflow-complex',
    name: 'Complex Feature Workflow',
    tasks: [
      TaskFixtures.complexCode,
      { ...TaskFixtures.unitTest, dependencies: ['task-complex-code'] },
      { ...TaskFixtures.integrationTest, dependencies: ['task-complex-code'] },
      {
        ...TaskFixtures.codeReview,
        dependencies: ['task-unit-test', 'task-integration-test']
      }
    ]
  },

  parallel: {
    id: 'workflow-parallel',
    name: 'Parallel Execution Workflow',
    tasks: [
      { ...TaskFixtures.simpleCode, id: 'parallel-task-1' },
      { ...TaskFixtures.simpleCode, id: 'parallel-task-2' },
      { ...TaskFixtures.simpleCode, id: 'parallel-task-3' }
    ]
  }
};

/**
 * Plugin Fixtures
 */
export const PluginFixtures = {
  validator: {
    id: 'plugin-validator',
    name: 'Validator Plugin',
    version: '1.0.0',
    description: 'Validates task inputs',
    getExtensionPoints: () => [
      {
        name: 'task.beforeExecute',
        handler: async (task: any) => ({
          validated: true,
          task
        })
      }
    ]
  },

  logger: {
    id: 'plugin-logger',
    name: 'Logger Plugin',
    version: '1.0.0',
    description: 'Logs task execution',
    getExtensionPoints: () => [
      {
        name: 'task.afterExecute',
        handler: async (result: any) => ({
          logged: true,
          result
        })
      }
    ]
  },

  metrics: {
    id: 'plugin-metrics',
    name: 'Metrics Plugin',
    version: '1.0.0',
    description: 'Collects execution metrics',
    getExtensionPoints: () => [
      {
        name: 'task.beforeExecute',
        handler: async (task: any) => ({
          startTime: Date.now(),
          task
        })
      },
      {
        name: 'task.afterExecute',
        handler: async (result: any) => ({
          endTime: Date.now(),
          result
        })
      }
    ]
  }
};

/**
 * Configuration Fixtures
 */
export const ConfigFixtures = {
  hierarchical: {
    swarm: {
      topology: 'hierarchical',
      maxAgents: 10,
      leaderElection: true
    },
    memory: {
      backend: 'hybrid',
      ttl: 3600000,
      maxSize: 1000000
    },
    performance: {
      flashAttention: true,
      targetSpeedup: '2.49x-7.47x',
      concurrency: 4
    }
  },

  mesh: {
    swarm: {
      topology: 'mesh',
      maxAgents: 20,
      peerDiscovery: true
    },
    memory: {
      backend: 'agentdb',
      vectorDimension: 384,
      hnswM: 16
    },
    performance: {
      flashAttention: true,
      gnnLayers: 3,
      batchSize: 32
    }
  },

  minimal: {
    swarm: {
      topology: 'simple',
      maxAgents: 3
    },
    memory: {
      backend: 'sqlite',
      ttl: 1800000
    }
  }
};

/**
 * Event Fixtures
 */
export const EventFixtures = {
  agentSpawned: {
    type: 'agent:spawned',
    agentId: 'coder-fixture',
    timestamp: Date.now(),
    payload: {
      type: 'coder',
      capabilities: ['code']
    }
  },

  taskStarted: {
    type: 'task:started',
    taskId: 'task-simple-code',
    agentId: 'coder-fixture',
    timestamp: Date.now(),
    payload: {
      priority: 'medium'
    }
  },

  taskCompleted: {
    type: 'task:completed',
    taskId: 'task-simple-code',
    agentId: 'coder-fixture',
    timestamp: Date.now(),
    payload: {
      duration: 250,
      success: true
    }
  },

  workflowStarted: {
    type: 'workflow:started',
    workflowId: 'workflow-simple',
    timestamp: Date.now(),
    payload: {
      taskCount: 3
    }
  }
};

/**
 * Error Fixtures
 */
export const ErrorFixtures = {
  validationError: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid task configuration',
    details: {
      field: 'priority',
      reason: 'must be one of: high, medium, low'
    }
  },

  executionError: {
    code: 'EXECUTION_ERROR',
    message: 'Task execution failed',
    details: {
      taskId: 'task-simple-code',
      error: 'Timeout after 5000ms'
    }
  },

  coordinationError: {
    code: 'COORDINATION_ERROR',
    message: 'Failed to coordinate agents',
    details: {
      topology: 'hierarchical',
      reason: 'Leader election timeout'
    }
  }
};

/**
 * Mock Implementations
 */
export const MockImplementations = {
  /**
   * Mock SwarmCoordinator that tracks operations
   */
  createMockCoordinator: () => {
    const operations: any[] = [];
    const agents = new Map();

    return {
      operations, // Expose for testing
      agents, // Expose for testing

      async spawnAgent(config: any) {
        operations.push({ type: 'spawn', config });
        const agent = { ...config, status: 'active' };
        agents.set(config.id, agent);
        return agent;
      },

      async listAgents() {
        operations.push({ type: 'list' });
        return Array.from(agents.values());
      },

      async terminateAgent(agentId: string) {
        operations.push({ type: 'terminate', agentId });
        agents.delete(agentId);
        return { success: true };
      },

      async executeTask(agentId: string, task: any) {
        operations.push({ type: 'execute', agentId, task });
        return {
          status: 'completed',
          result: 'success',
          duration: 250
        };
      },

      async initialize() {
        operations.push({ type: 'initialize' });
      },

      async shutdown() {
        operations.push({ type: 'shutdown' });
        agents.clear();
      }
    };
  },

  /**
   * Mock HybridBackend that stores data in memory
   */
  createMockMemoryBackend: () => {
    const memories = new Map();
    const operations: any[] = [];

    return {
      operations, // Expose for testing
      memories, // Expose for testing

      async store(memory: any) {
        operations.push({ type: 'store', memory });
        memories.set(memory.id, memory);
        return memory;
      },

      async retrieve(id: string) {
        operations.push({ type: 'retrieve', id });
        return memories.get(id) || null;
      },

      async query(query: any) {
        operations.push({ type: 'query', query });
        return Array.from(memories.values()).filter((m: any) => {
          if (query.agentId && m.agentId !== query.agentId) return false;
          if (query.type && m.type !== query.type) return false;
          return true;
        });
      },

      async vectorSearch(embedding: number[], k: number) {
        operations.push({ type: 'vectorSearch', k });
        return Array.from(memories.values())
          .filter((m: any) => m.embedding)
          .slice(0, k)
          .map((m: any) => ({ ...m, similarity: Math.random() }));
      },

      async update(memory: any) {
        operations.push({ type: 'update', memory });
        memories.set(memory.id, memory);
      },

      async delete(id: string) {
        operations.push({ type: 'delete', id });
        memories.delete(id);
      },

      async initialize() {
        operations.push({ type: 'initialize' });
      },

      async close() {
        operations.push({ type: 'close' });
        memories.clear();
      }
    };
  },

  /**
   * Mock PluginManager that tracks plugin operations
   */
  createMockPluginManager: () => {
    const plugins = new Map();
    const operations: any[] = [];

    return {
      operations, // Expose for testing
      plugins, // Expose for testing

      async loadPlugin(plugin: any, config?: any) {
        operations.push({ type: 'load', plugin, config });
        plugins.set(plugin.id, plugin);
        if (plugin.initialize) {
          await plugin.initialize(config);
        }
      },

      async unloadPlugin(pluginId: string) {
        operations.push({ type: 'unload', pluginId });
        const plugin = plugins.get(pluginId);
        if (plugin?.shutdown) {
          await plugin.shutdown();
        }
        plugins.delete(pluginId);
      },

      listPlugins() {
        operations.push({ type: 'list' });
        return Array.from(plugins.values());
      },

      async invokeExtensionPoint(name: string, data: any) {
        operations.push({ type: 'invoke', name, data });
        const results: any[] = [];

        for (const plugin of plugins.values()) {
          const extensionPoints = plugin.getExtensionPoints();
          const matching = extensionPoints.filter((ep: any) => ep.name === name);

          for (const ep of matching) {
            try {
              const result = await ep.handler(data);
              results.push(result);
            } catch (error) {
              results.push({ error: (error as Error).message });
            }
          }
        }

        return results;
      },

      async initialize() {
        operations.push({ type: 'initialize' });
      },

      async shutdown() {
        operations.push({ type: 'shutdown' });
        plugins.clear();
      }
    };
  }
};

/**
 * Test Data Generators
 */
export const Generators = {
  /**
   * Generate realistic agent configuration
   */
  agent: (overrides: Partial<any> = {}) => ({
    id: `agent-${Math.random().toString(36).slice(2)}`,
    type: ['coder', 'tester', 'reviewer'][Math.floor(Math.random() * 3)],
    status: 'active',
    capabilities: ['code', 'test', 'review'].slice(0, Math.floor(Math.random() * 3) + 1),
    metadata: {},
    ...overrides
  }),

  /**
   * Generate realistic task configuration
   */
  task: (overrides: Partial<any> = {}) => ({
    id: `task-${Math.random().toString(36).slice(2)}`,
    type: ['code', 'test', 'review'][Math.floor(Math.random() * 3)],
    description: 'Generated test task',
    priority: ['high', 'medium', 'low'][Math.floor(Math.random() * 3)] as any,
    status: 'pending',
    metadata: {},
    ...overrides
  }),

  /**
   * Generate realistic memory
   */
  memory: (overrides: Partial<any> = {}) => ({
    id: `memory-${Math.random().toString(36).slice(2)}`,
    agentId: `agent-${Math.random().toString(36).slice(2)}`,
    content: 'Generated memory content',
    type: ['task', 'context', 'event'][Math.floor(Math.random() * 3)],
    timestamp: Date.now(),
    metadata: {},
    ...overrides
  })
};
