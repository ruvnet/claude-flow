/**
 * Mock Components for System Integration Testing
 * These are lightweight mocks for missing components during development
 */

import { EventBus } from '../core/event-bus.js';
import { Logger } from '../core/logger.js';

export class MockConfigManager {
  private config: Record<string, any> = {};

  static getInstance(): MockConfigManager {
    return new MockConfigManager();
  }

  async load(): Promise<void> {
    // Mock configuration loading
    this.config = {
      agents: { maxAgents: 10 },
      swarm: { topology: 'mesh' },
      memory: { backend: 'memory' }
    };
  }

  get(path: string): any {
    const keys = path.split('.');
    let value = this.config;
    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) break;
    }
    return value;
  }

  set(path: string, value: any): void {
    const keys = path.split('.');
    let obj = this.config;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in obj)) {
        obj[key] = {};
      }
      obj = obj[key];
    }
    obj[keys[keys.length - 1]] = value;
  }

  async initialize(): Promise<void> {
    await this.load();
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'configManager',
      healthy: true,
      message: 'Mock config manager healthy',
      timestamp: Date.now()
    });
  }
}

export class MockMemoryManager {
  private storage: Map<string, any> = new Map();

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  async get(key: string): Promise<any> {
    return this.storage.get(key) || null;
  }

  async set(key: string, value: any): Promise<void> {
    this.storage.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  async keys(pattern?: string): Promise<string[]> {
    const allKeys = Array.from(this.storage.keys());
    if (!pattern) return allKeys;
    
    // Simple pattern matching
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return allKeys.filter(key => regex.test(key));
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'memoryManager',
      healthy: true,
      message: 'Mock memory manager healthy',
      timestamp: Date.now()
    });
  }

  getMetrics(): Promise<any> {
    return Promise.resolve({
      storageSize: this.storage.size,
      memoryUsage: process.memoryUsage().heapUsed
    });
  }
}

export class MockAgentManager {
  private agents: Map<string, any> = new Map();

  constructor(private eventBus: EventBus, private logger: Logger) {}

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  async spawnAgent(type: string, config: any): Promise<string> {
    const agentId = `mock-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.agents.set(agentId, {
      id: agentId,
      type,
      config,
      status: 'active',
      createdAt: new Date()
    });
    return agentId;
  }

  async terminateAgent(agentId: string): Promise<void> {
    this.agents.delete(agentId);
  }

  async listAgents(): Promise<any[]> {
    return Array.from(this.agents.values());
  }

  async getAgent(agentId: string): Promise<any> {
    return this.agents.get(agentId) || null;
  }

  async sendMessage(message: any): Promise<any> {
    // Mock message sending
    return { success: true, id: `msg-${Date.now()}` };
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'agentManager',
      healthy: true,
      message: 'Mock agent manager healthy',
      timestamp: Date.now()
    });
  }

  getMetrics(): Promise<any> {
    return Promise.resolve({
      activeAgents: this.agents.size,
      totalAgents: this.agents.size
    });
  }
}

export class MockSwarmCoordinator {
  private swarms: Map<string, any> = new Map();

  constructor(
    eventBus?: EventBus,
    logger?: Logger,
    memoryManager?: MockMemoryManager
  ) {}

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  async createSwarm(config: any): Promise<string> {
    const swarmId = `mock-swarm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.swarms.set(swarmId, {
      id: swarmId,
      config,
      status: 'active',
      agents: [],
      createdAt: new Date()
    });
    return swarmId;
  }

  async getSwarmStatus(swarmId: string): Promise<any> {
    const swarm = this.swarms.get(swarmId);
    return swarm || null;
  }

  async spawnAgentInSwarm(swarmId: string, agentConfig: any): Promise<string> {
    const agentId = `mock-swarm-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const swarm = this.swarms.get(swarmId);
    if (swarm) {
      swarm.agents.push(agentId);
    }
    return agentId;
  }

  async getSwarmAgents(swarmId: string): Promise<string[]> {
    const swarm = this.swarms.get(swarmId);
    return swarm?.agents || [];
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'swarmCoordinator',
      healthy: true,
      message: 'Mock swarm coordinator healthy',
      timestamp: Date.now()
    });
  }

  getMetrics(): Promise<any> {
    return Promise.resolve({
      activeSwarms: this.swarms.size,
      totalAgents: Array.from(this.swarms.values()).reduce((sum, swarm) => sum + swarm.agents.length, 0)
    });
  }
}

export class MockTaskEngine {
  private tasks: Map<string, any> = new Map();

  constructor(
    eventBus?: EventBus,
    logger?: Logger,
    memoryManager?: MockMemoryManager
  ) {}

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  async createTask(taskConfig: any): Promise<string> {
    const taskId = `mock-task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.tasks.set(taskId, {
      id: taskId,
      ...taskConfig,
      status: 'pending',
      createdAt: new Date()
    });
    return taskId;
  }

  async getTaskStatus(taskId: string): Promise<any> {
    return this.tasks.get(taskId) || null;
  }

  async getActiveTasks(swarmId?: string): Promise<any[]> {
    const allTasks = Array.from(this.tasks.values());
    return swarmId 
      ? allTasks.filter(task => task.swarmId === swarmId && task.status === 'active')
      : allTasks.filter(task => task.status === 'active');
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'taskEngine',
      healthy: true,
      message: 'Mock task engine healthy',
      timestamp: Date.now()
    });
  }

  getMetrics(): Promise<any> {
    const tasks = Array.from(this.tasks.values());
    return Promise.resolve({
      totalTasks: tasks.length,
      activeTasks: tasks.filter(t => t.status === 'active').length,
      queuedTasks: tasks.filter(t => t.status === 'pending').length,
      completedTasks: tasks.filter(t => t.status === 'completed').length
    });
  }
}

export class MockRealTimeMonitor {
  constructor(eventBus?: EventBus, logger?: Logger) {}

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  attachToOrchestrator(orchestrator: any): void {
    // Mock attachment
  }

  attachToAgentManager(agentManager: any): void {
    // Mock attachment
  }

  attachToSwarmCoordinator(swarmCoordinator: any): void {
    // Mock attachment
  }

  attachToTaskEngine(taskEngine: any): void {
    // Mock attachment
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'monitor',
      healthy: true,
      message: 'Mock monitor healthy',
      timestamp: Date.now()
    });
  }
}

export class MockMcpServer {
  constructor(eventBus?: EventBus, logger?: Logger) {}

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  attachToOrchestrator(orchestrator: any): void {
    // Mock attachment
  }

  attachToAgentManager(agentManager: any): void {
    // Mock attachment
  }

  attachToSwarmCoordinator(swarmCoordinator: any): void {
    // Mock attachment
  }

  attachToTaskEngine(taskEngine: any): void {
    // Mock attachment
  }

  attachToMemoryManager(memoryManager: any): void {
    // Mock attachment
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'mcpServer',
      healthy: true,
      message: 'Mock MCP server healthy',
      timestamp: Date.now()
    });
  }
}

export class MockOrchestrator {
  constructor(
    private configManager: any,
    private eventBus: EventBus,
    private logger: Logger
  ) {}

  async initialize(): Promise<void> {
    // Mock initialization
  }

  async shutdown(): Promise<void> {
    // Mock shutdown
  }

  setAgentManager(agentManager: any): void {
    // Mock setter
  }

  healthCheck(): Promise<any> {
    return Promise.resolve({
      component: 'orchestrator',
      healthy: true,
      message: 'Mock orchestrator healthy',
      timestamp: Date.now()
    });
  }
}