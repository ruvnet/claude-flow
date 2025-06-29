import { EventEmitter } from 'node:events';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import { SwarmMonitor } from './swarm-monitor.js';
import { AdvancedTaskScheduler } from './advanced-scheduler.js';
import { MemoryManager } from '../memory/manager.js';
import { SwarmVerificationFramework, getDefaultVerificationRequirements } from './verification/index.js';
import type { Message, TaskResult, WorkStealingCoordinator, CircuitBreaker } from '../types/missing-types.js';
import { StubWorkStealingCoordinator, StubCircuitBreaker } from '../types/missing-types.js';
import type { AgentVerificationRequirements } from './verification/index.js';

export interface SwarmAgent {
  id: string;
  name: string;
  type: 'researcher' | 'developer' | 'analyzer' | 'coordinator' | 'reviewer';
  status: 'idle' | 'busy' | 'failed' | 'completed';
  capabilities: string[];
  currentTask?: SwarmTask;
  processId?: number;
  terminalId?: string;
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    totalDuration: number;
    lastActivity: Date;
  };
}

export interface SwarmTask {
  id: string;
  type: string;
  description: string;
  priority: number;
  dependencies: string[];
  assignedTo?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: TaskResult;
  error?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  retryCount: number;
  maxRetries: number;
  timeout?: number;
}

export interface SwarmObjective {
  id: string;
  description: string;
  strategy: 'auto' | 'research' | 'development' | 'analysis';
  tasks: SwarmTask[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
}

export interface SwarmConfig {
  maxAgents: number;
  maxConcurrentTasks: number;
  taskTimeout: number;
  enableMonitoring: boolean;
  enableWorkStealing: boolean;
  enableCircuitBreaker: boolean;
  memoryNamespace: string;
  coordinationStrategy: 'centralized' | 'distributed' | 'hybrid';
  backgroundTaskInterval: number;
  healthCheckInterval: number;
  maxRetries: number;
  backoffMultiplier: number;
  // Optional logger for external injection
  logger?: any;
  // Additional swarm facade options
  timeout?: number;
  mode?: any;
  parallel?: boolean;
  distributed?: boolean;
  persistence?: boolean;
}

export class SwarmCoordinator extends EventEmitter {
  private logger: Logger;
  private config: SwarmConfig;
  private agents: Map<string, SwarmAgent>;
  private objectives: Map<string, SwarmObjective>;
  private tasks: Map<string, SwarmTask>;
  private monitor?: SwarmMonitor;
  private scheduler?: AdvancedTaskScheduler;
  private memoryManager: MemoryManager;
  private backgroundWorkers: Map<string, NodeJS.Timeout>;
  private workStealer?: WorkStealingCoordinator;
  private circuitBreaker?: CircuitBreaker;
  private verificationFramework: SwarmVerificationFramework;
  private isRunning: boolean = false;

  constructor(config: Partial<SwarmConfig> = {}) {
    super();
    // Use provided logger or create new one
    this.logger = config.logger || new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'SwarmCoordinator' });
    this.config = {
      maxAgents: 10,
      maxConcurrentTasks: 5,
      taskTimeout: 300000, // 5 minutes
      enableMonitoring: true,
      enableWorkStealing: true,
      enableCircuitBreaker: true,
      memoryNamespace: 'swarm',
      coordinationStrategy: 'hybrid',
      backgroundTaskInterval: 5000, // 5 seconds
      healthCheckInterval: 10000, // 10 seconds
      maxRetries: 3,
      backoffMultiplier: 2,
      ...config
    };

    this.agents = new Map();
    this.objectives = new Map();
    this.tasks = new Map();
    this.backgroundWorkers = new Map();

    // Initialize memory manager
    // Create a minimal memory config
    const memoryConfig = {
      backend: 'sqlite' as const,
      databasePath: './.claude-flow/memory.db',
      cacheSizeMB: 100,
      compressionEnabled: false,
      encryptionEnabled: false,
      syncInterval: 60000,
      conflictResolution: 'timestamp' as const,
      retentionDays: 30,
      metadata: {
        namespace: this.config.memoryNamespace || 'swarm'
      }
    };
    
    // Create minimal event bus and logger for memory manager
    const eventBus = {
      emit: () => true,
      on: () => {},
      off: () => {},
      once: () => {}
    } as any;
    
    this.memoryManager = new MemoryManager(memoryConfig, eventBus, this.logger);

    // Initialize verification framework
    this.verificationFramework = new SwarmVerificationFramework(this.logger, {
      enforcement_enabled: true,
      status_timeout_ms: 30000,
      fail_fast: false,
      status_directory: './.claude-flow/swarm-status'
    });

    if (this.config.enableMonitoring) {
      this.monitor = new SwarmMonitor({
        updateInterval: 1000,
        enableAlerts: true,
        enableHistory: true
      });
    }

    // Initialize work stealer if enabled
    if (this.config.enableWorkStealing) {
      this.workStealer = new StubWorkStealingCoordinator();
    }

    // Initialize circuit breaker if enabled
    if (this.config.enableCircuitBreaker) {
      this.circuitBreaker = new StubCircuitBreaker();
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Monitor events
    if (this.monitor) {
      this.monitor.on('alert', (alert: any) => {
        this.handleMonitorAlert(alert);
      });
    }

    // Add custom event handlers for swarm coordination
    this.on('task:completed', (data: any) => {
      this.handleTaskCompleted(data.taskId, data.result);
    });

    this.on('task:failed', (data: any) => {
      this.handleTaskFailed(data.taskId, data.error);
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Swarm coordinator already running');
      return;
    }

    this.logger.info('Starting swarm coordinator...');
    this.isRunning = true;

    // Start subsystems
    await this.memoryManager.initialize();
    
    // Store verification framework in memory for agent coordination
    await this.storeVerificationFrameworkInMemory();
    
    if (this.monitor) {
      await this.monitor.start();
    }

    // Start background workers
    this.startBackgroundWorkers();

    this.emit('coordinator:started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping swarm coordinator...');
    this.isRunning = false;

    // Stop background workers
    this.stopBackgroundWorkers();

    // Stop subsystems
    if (this.scheduler && 'stop' in this.scheduler && typeof this.scheduler.stop === 'function') {
      await this.scheduler.stop();
    }
    
    if (this.monitor) {
      this.monitor.stop();
    }

    this.emit('coordinator:stopped');
  }

  private startBackgroundWorkers(): void {
    // Task processor worker
    const taskProcessor = setInterval(() => {
      this.processBackgroundTasks();
    }, this.config.backgroundTaskInterval);
    this.backgroundWorkers.set('taskProcessor', taskProcessor);

    // Health check worker
    const healthChecker = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
    this.backgroundWorkers.set('healthChecker', healthChecker);

    // Work stealing worker
    if (this.workStealer) {
      const workStealerWorker = setInterval(() => {
        this.performWorkStealing();
      }, this.config.backgroundTaskInterval);
      this.backgroundWorkers.set('workStealer', workStealerWorker);
    }

    // Memory sync worker
    const memorySync = setInterval(() => {
      this.syncMemoryState();
    }, this.config.backgroundTaskInterval * 2);
    this.backgroundWorkers.set('memorySync', memorySync);
  }

  private stopBackgroundWorkers(): void {
    for (const [name, worker] of this.backgroundWorkers) {
      clearInterval(worker);
      this.logger.debug(`Stopped background worker: ${name}`);
    }
    this.backgroundWorkers.clear();
  }

  async createObjective(description: string, strategy: SwarmObjective['strategy'] = 'auto'): Promise<string> {
    const objectiveId = generateId('objective');
    const objective: SwarmObjective = {
      id: objectiveId,
      description,
      strategy,
      tasks: [],
      status: 'planning',
      createdAt: new Date()
    };

    this.objectives.set(objectiveId, objective);
    this.logger.info(`Created objective: ${objectiveId} - ${description}`);

    // Decompose objective into tasks
    const tasks = await this.decomposeObjective(objective);
    objective.tasks = tasks;

    // Store in memory
    await this.memoryManager.remember({
      namespace: this.config.memoryNamespace,
      key: `objective:${objectiveId}`,
      content: JSON.stringify(objective),
      metadata: {
        type: 'objective',
        strategy,
        taskCount: tasks.length
      }
    });

    this.emit('objective:created', objective);
    return objectiveId;
  }

  private async decomposeObjective(objective: SwarmObjective): Promise<SwarmTask[]> {
    const tasks: SwarmTask[] = [];

    switch (objective.strategy) {
      case 'research':
        tasks.push(
          this.createTask('research', 'Gather information and research materials', 1),
          this.createTask('analysis', 'Analyze research findings', 2, ['research']),
          this.createTask('synthesis', 'Synthesize insights and create report', 3, ['analysis'])
        );
        break;

      case 'development':
        tasks.push(
          this.createTask('planning', 'Plan architecture and design', 1),
          this.createTask('implementation', 'Implement core functionality', 2, ['planning']),
          this.createTask('testing', 'Test and validate implementation', 3, ['implementation']),
          this.createTask('documentation', 'Create documentation', 3, ['implementation']),
          this.createTask('review', 'Peer review and refinement', 4, ['testing', 'documentation'])
        );
        break;

      case 'analysis':
        tasks.push(
          this.createTask('data-collection', 'Collect and prepare data', 1),
          this.createTask('analysis', 'Perform detailed analysis', 2, ['data-collection']),
          this.createTask('visualization', 'Create visualizations', 3, ['analysis']),
          this.createTask('reporting', 'Generate final report', 4, ['analysis', 'visualization'])
        );
        break;

      default: // auto
        // Use AI to decompose based on objective description
        tasks.push(
          this.createTask('exploration', 'Explore and understand requirements', 1),
          this.createTask('planning', 'Create execution plan', 2, ['exploration']),
          this.createTask('execution', 'Execute main tasks', 3, ['planning']),
          this.createTask('validation', 'Validate and test results', 4, ['execution']),
          this.createTask('completion', 'Finalize and document', 5, ['validation'])
        );
    }

    // Register tasks
    tasks.forEach(task => {
      this.tasks.set(task.id, task);
    });

    return tasks;
  }

  private createTask(
    type: string, 
    description: string, 
    priority: number, 
    dependencies: string[] = []
  ): SwarmTask {
    return {
      id: generateId('task'),
      type,
      description,
      priority,
      dependencies,
      status: 'pending',
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
      timeout: this.config.taskTimeout
    };
  }

  async registerAgent(
    name: string, 
    type: SwarmAgent['type'], 
    capabilities: string[] = []
  ): Promise<string> {
    const agentId = generateId('agent');
    const agent: SwarmAgent = {
      id: agentId,
      name,
      type,
      status: 'idle',
      capabilities,
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        totalDuration: 0,
        lastActivity: new Date()
      }
    };

    this.agents.set(agentId, agent);
    
    if (this.monitor) {
      this.monitor.registerAgent(agentId, name);
    }

    // Register with work stealer if enabled
    if (this.workStealer) {
      this.workStealer.registerWorker(agentId, 1);
    }

    this.logger.info(`Registered agent: ${name} (${agentId}) - Type: ${type}`);
    this.emit('agent:registered', agent);

    return agentId;
  }

  async assignTask(taskId: string, agentId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task || !agent) {
      throw new Error('Task or agent not found');
    }

    if (agent.status !== 'idle') {
      throw new Error('Agent is not available');
    }

    // Check circuit breaker
    if (this.circuitBreaker && !this.circuitBreaker.canExecute(agentId)) {
      throw new Error('Agent circuit breaker is open');
    }

    task.assignedTo = agentId;
    task.status = 'running';
    task.startedAt = new Date();

    agent.status = 'busy';
    agent.currentTask = task;

    if (this.monitor) {
      this.monitor.taskStarted(agentId, taskId, task.description);
    }

    this.logger.info(`Assigned task ${taskId} to agent ${agentId}`);
    this.emit('task:assigned', { task, agent });

    // Execute task in background
    this.executeTask(task, agent);
  }

  private async executeTask(task: SwarmTask, agent: SwarmAgent): Promise<void> {
    try {
      // Simulate task execution
      // In real implementation, this would spawn actual Claude instances
      const result = await this.simulateTaskExecution(task, agent);
      
      await this.handleTaskCompleted(task.id, result);
    } catch (error) {
      await this.handleTaskFailed(task.id, error);
    }
  }

  private async simulateTaskExecution(task: SwarmTask, agent: SwarmAgent): Promise<any> {
    // This is where we would actually spawn Claude processes
    // For now, simulate with timeout
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Task timeout'));
      }, task.timeout || this.config.taskTimeout);

      // Simulate work
      setTimeout(() => {
        clearTimeout(timeout);
        resolve({
          taskId: task.id,
          agentId: agent.id,
          result: `Completed ${task.type} task`,
          timestamp: new Date()
        });
      }, Math.random() * 5000 + 2000);
    });
  }

  private async handleTaskCompleted(taskId: string, result: any): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const agent = task.assignedTo ? this.agents.get(task.assignedTo) : null;

    // VERIFICATION ENFORCEMENT: Validate task completion before marking as completed
    if (agent) {
      try {
        await this.enforceTaskVerification(task, agent, result);
      } catch (error) {
        this.logger.error(`Task verification failed for ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
        await this.handleTaskFailed(taskId, error);
        return;
      }
    }

    task.status = 'completed';
    task.completedAt = new Date();
    task.result = result;

    if (agent) {
      agent.status = 'idle';
      agent.currentTask = undefined;
      agent.metrics.tasksCompleted++;
      agent.metrics.totalDuration += (task.completedAt.getTime() - (task.startedAt?.getTime() || 0));
      agent.metrics.lastActivity = new Date();

      if (this.monitor) {
        this.monitor.taskCompleted(agent.id, taskId);
      }

      if (this.circuitBreaker) {
        this.circuitBreaker.recordSuccess(agent.id);
      }
    }

    // Store result in memory
    await this.memoryManager.remember({
      namespace: this.config.memoryNamespace,
      key: `task:${taskId}:result`,
      content: JSON.stringify(result),
      metadata: {
        type: 'task-result',
        taskType: task.type,
        agentId: agent?.id,
        verified: true
      }
    });

    this.logger.info(`Task ${taskId} completed successfully with verification`);
    this.emit('task:completed', { task, result });

    // Check if objective is complete
    this.checkObjectiveCompletion(task);
  }

  private async handleTaskFailed(taskId: string, error: any): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const agent = task.assignedTo ? this.agents.get(task.assignedTo) : null;

    task.error = error.message || String(error);
    task.retryCount++;

    if (agent) {
      agent.status = 'idle';
      agent.currentTask = undefined;
      agent.metrics.tasksFailed++;
      agent.metrics.lastActivity = new Date();

      if (this.monitor && agent.id && task.error) {
        this.monitor.taskFailed(agent.id, taskId, task.error);
      }

      if (this.circuitBreaker && agent.id) {
        this.circuitBreaker.recordFailure(agent.id);
      }
    }

    // Retry logic
    if (task.retryCount < task.maxRetries) {
      task.status = 'pending';
      task.assignedTo = undefined;
      this.logger.warn(`Task ${taskId} failed, will retry (${task.retryCount}/${task.maxRetries})`);
      this.emit('task:retry', { task, error });
    } else {
      task.status = 'failed';
      task.completedAt = new Date();
      this.logger.error(`Task ${taskId} failed after ${task.retryCount} retries`);
      this.emit('task:failed', { task, error });
    }
  }

  private async checkObjectiveCompletion(completedTask: SwarmTask): Promise<void> {
    for (const [objectiveId, objective] of this.objectives) {
      if (objective.status !== 'executing') continue;

      const allTasksComplete = objective.tasks.every(task => {
        const t = this.tasks.get(task.id);
        return t && (t.status === 'completed' || t.status === 'failed');
      });

      if (allTasksComplete) {
        // VERIFICATION ENFORCEMENT: Verify entire objective before completion
        try {
          await this.enforceObjectiveVerification(objectiveId, objective);
          
          objective.status = 'completed';
          objective.completedAt = new Date();
          this.logger.info(`Objective ${objectiveId} completed with verification`);
          this.emit('objective:completed', objective);
        } catch (error) {
          this.logger.error(`Objective verification failed for ${objectiveId}: ${error instanceof Error ? error.message : String(error)}`);
          objective.status = 'failed';
          objective.completedAt = new Date();
          this.emit('objective:failed', { objective, error });
        }
      }
    }
  }

  private async processBackgroundTasks(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Process pending tasks
      const pendingTasks = Array.from(this.tasks.values())
        .filter(t => t.status === 'pending' && this.areDependenciesMet(t));

      // Get available agents
      const availableAgents = Array.from(this.agents.values())
        .filter(a => a.status === 'idle');

      // Assign tasks to agents
      for (const task of pendingTasks) {
        if (availableAgents.length === 0) break;

        const agent = this.selectBestAgent(task, availableAgents);
        if (agent) {
          try {
            await this.assignTask(task.id, agent.id);
            availableAgents.splice(availableAgents.indexOf(agent), 1);
          } catch (error) {
            this.logger.error(`Failed to assign task ${task.id}:`, error);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error processing background tasks:', error);
    }
  }

  private areDependenciesMet(task: SwarmTask): boolean {
    return task.dependencies.every(depId => {
      const dep = this.tasks.get(depId);
      return dep && dep.status === 'completed';
    });
  }

  private selectBestAgent(task: SwarmTask, availableAgents: SwarmAgent[]): SwarmAgent | null {
    // Simple selection based on task type and agent capabilities
    const compatibleAgents = availableAgents.filter(agent => {
      // Match task type to agent type
      if (task.type.includes('research') && agent.type === 'researcher') return true;
      if (task.type.includes('implement') && agent.type === 'developer') return true;
      if (task.type.includes('analysis') && agent.type === 'analyzer') return true;
      if (task.type.includes('review') && agent.type === 'reviewer') return true;
      return agent.type === 'coordinator'; // Coordinator can do any task
    });

    if (compatibleAgents.length === 0) {
      return availableAgents[0]; // Fallback to any available agent
    }

    // Select agent with best performance metrics
    return compatibleAgents.reduce((best, agent) => {
      const bestRatio = best.metrics.tasksCompleted / (best.metrics.tasksFailed + 1);
      const agentRatio = agent.metrics.tasksCompleted / (agent.metrics.tasksFailed + 1);
      return agentRatio > bestRatio ? agent : best;
    });
  }

  private async performHealthChecks(): Promise<void> {
    if (!this.isRunning) return;

    try {
      const now = new Date();
      
      for (const [agentId, agent] of this.agents) {
        // Check for stalled agents
        if (agent.status === 'busy' && agent.currentTask) {
          const taskDuration = now.getTime() - (agent.currentTask.startedAt?.getTime() || 0);
          if (taskDuration > this.config.taskTimeout) {
            this.logger.warn(`Agent ${agentId} appears stalled on task ${agent.currentTask.id}`);
            await this.handleTaskFailed(agent.currentTask.id, new Error('Task timeout'));
          }
        }

        // Check agent health
        const inactivityTime = now.getTime() - agent.metrics.lastActivity.getTime();
        if (inactivityTime > this.config.healthCheckInterval * 3) {
          this.logger.warn(`Agent ${agentId} has been inactive for ${Math.round(inactivityTime / 1000)}s`);
        }
      }
    } catch (error) {
      this.logger.error('Error performing health checks:', error);
    }
  }

  private async performWorkStealing(): Promise<void> {
    if (!this.isRunning || !this.workStealer) return;

    try {
      // Get agent workloads
      const workloads = new Map<string, number>();
      for (const [agentId, agent] of this.agents) {
        workloads.set(agentId, agent.status === 'busy' ? 1 : 0);
      }

      // Update work stealer
      this.workStealer.updateLoads(workloads);

      // Check for work stealing opportunities
      const stealingSuggestions = this.workStealer.suggestWorkStealing();
      
      for (const suggestion of stealingSuggestions) {
        this.logger.debug(`Work stealing suggestion: ${suggestion.from} -> ${suggestion.to}`);
        // In a real implementation, we would reassign tasks here
      }
    } catch (error) {
      this.logger.error('Error performing work stealing:', error);
    }
  }

  private async syncMemoryState(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Sync current state to memory
      const state = {
        objectives: Array.from(this.objectives.values()),
        tasks: Array.from(this.tasks.values()),
        agents: Array.from(this.agents.values()).map(a => ({
          ...a,
          currentTask: undefined // Don't store transient state
        })),
        timestamp: new Date()
      };

      await this.memoryManager.remember({
        namespace: this.config.memoryNamespace,
        key: 'swarm:state',
        content: JSON.stringify(state),
        metadata: {
          type: 'swarm-state',
          objectiveCount: state.objectives.length,
          taskCount: state.tasks.length,
          agentCount: state.agents.length
        }
      });
    } catch (error) {
      this.logger.error('Error syncing memory state:', error);
    }
  }

  private handleMonitorAlert(alert: any): void {
    this.logger.warn(`Monitor alert: ${alert.message}`);
    this.emit('monitor:alert', alert);
  }

  private handleAgentMessage(message: Message): void {
    this.logger.debug(`Agent message: ${message.type} from ${message.source || 'unknown'}`);
    this.emit('agent:message', message);
  }

  // Public API methods
  async executeObjective(objectiveId: string): Promise<void> {
    const objective = this.objectives.get(objectiveId);
    if (!objective) {
      throw new Error('Objective not found');
    }

    objective.status = 'executing';
    this.logger.info(`Executing objective: ${objectiveId}`);
    this.emit('objective:started', objective);

    // Tasks will be processed by background workers
  }

  getObjectiveStatus(objectiveId: string): SwarmObjective | undefined {
    return this.objectives.get(objectiveId);
  }

  getAgentStatus(agentId: string): SwarmAgent | undefined {
    return this.agents.get(agentId);
  }

  getSwarmStatus(): {
    objectives: number;
    tasks: { total: number; pending: number; running: number; completed: number; failed: number };
    agents: { total: number; idle: number; busy: number; failed: number };
    uptime: number;
  } {
    const tasks = Array.from(this.tasks.values());
    const agents = Array.from(this.agents.values());

    return {
      objectives: this.objectives.size,
      tasks: {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        running: tasks.filter(t => t.status === 'running').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        failed: tasks.filter(t => t.status === 'failed').length
      },
      agents: {
        total: agents.length,
        idle: agents.filter(a => a.status === 'idle').length,
        busy: agents.filter(a => a.status === 'busy').length,
        failed: agents.filter(a => a.status === 'failed').length
      },
      uptime: this.monitor ? this.monitor.getSummary().uptime : 0
    };
  }

  /**
   * Execute a swarm operation
   */
  async execute(request: any): Promise<void> {
    try {
      this.logger.info('Starting swarm execution', { objective: request.objective });
      
      // Create objective from request
      const objectiveId = await this.createObjective(
        request.objective,
        request.strategy || 'auto',
        []
      );
      
      // Execute the objective
      await this.executeObjective(objectiveId);
      
      this.logger.info('Swarm execution completed', { objectiveId });
    } catch (error) {
      this.logger.error('Swarm execution failed', { error });
      throw error;
    }
  }

  /**
   * Get status (alias for getSwarmStatus)
   */
  getStatus(): any {
    return this.getSwarmStatus();
  }

  /**
   * Stop the coordinator
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping swarm coordinator...');
    this.isRunning = false;
    
    // Stop all background workers
    for (const [workerId, timer] of this.backgroundWorkers) {
      clearTimeout(timer);
    }
    this.backgroundWorkers.clear();
    
    // Clean up monitor
    if (this.monitor) {
      await this.monitor.stop();
    }
    
    this.emit('coordinator:stopped');
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up swarm coordinator...');
    
    // Stop if still running
    if (this.isRunning) {
      await this.stop();
    }
    
    // Clear all data structures
    this.agents.clear();
    this.tasks.clear();
    this.objectives.clear();
    
    // Cleanup memory manager
    if (this.memoryManager) {
      // Memory manager cleanup would go here
    }
    
    this.emit('coordinator:cleanup');
  }

  /**
   * VERIFICATION ENFORCEMENT: Verify task completion before marking as completed
   */
  private async enforceTaskVerification(
    task: SwarmTask, 
    agent: SwarmAgent, 
    result: any
  ): Promise<void> {
    this.logger.info(`Enforcing verification for task ${task.id} by agent ${agent.id}`);
    
    // Get verification requirements for this agent
    const agentType = this.determineAgentVerificationType(task.type);
    const requirements = getDefaultVerificationRequirements(agent.id, agentType);
    
    // Create status file for the agent
    const statusFilePath = await this.verificationFramework.createAgentStatusFile(
      agent.id,
      task.description,
      requirements.required_commands.map(cmd => cmd.command)
    );
    
    // Execute verification commands
    const verificationResults = await this.verificationFramework.executeVerificationCommands(
      requirements.required_commands
    );
    
    // Update status file with results
    const hasErrors = verificationResults.some(r => !r.matches_expectation);
    await this.verificationFramework.updateStatusFile(statusFilePath, {
      ok: !hasErrors,
      errors: hasErrors ? verificationResults.filter(r => !r.matches_expectation).length : 0,
      spawned: 1,
      verification_results: verificationResults,
      details: {
        objective: task.description,
        strategy: 'task-execution',
        mode: 'individual',
        duration: result.duration || 0
      }
    });
    
    // Enforce verification rules
    if (hasErrors) {
      const failedCommands = verificationResults
        .filter(r => !r.matches_expectation)
        .map(r => r.command);
      
      throw new Error(
        `Task verification failed for agent ${agent.id}. ` +
        `Failed commands: ${failedCommands.join(', ')}`
      );
    }
    
    this.logger.info(`Task verification passed for ${task.id}`);
  }

  /**
   * VERIFICATION ENFORCEMENT: Verify entire objective before completion
   */
  private async enforceObjectiveVerification(
    objectiveId: string, 
    objective: SwarmObjective
  ): Promise<void> {
    this.logger.info(`Enforcing verification for objective ${objectiveId}`);
    
    // Collect all agent verification requirements
    const agentRequirements: AgentVerificationRequirements[] = [];
    const uniqueAgents = new Set<string>();
    
    for (const task of objective.tasks) {
      const taskObj = this.tasks.get(task.id);
      if (taskObj?.assignedTo && !uniqueAgents.has(taskObj.assignedTo)) {
        uniqueAgents.add(taskObj.assignedTo);
        const agent = this.agents.get(taskObj.assignedTo);
        if (agent) {
          const agentType = this.determineAgentVerificationType(taskObj.type);
          const requirements = getDefaultVerificationRequirements(agent.id, agentType);
          agentRequirements.push(requirements);
        }
      }
    }
    
    // Enforce verification for all agents
    const verificationResult = await this.verificationFramework.enforceVerification(
      agentRequirements
    );
    
    // Check if all agents passed verification
    if (!verificationResult.success) {
      const failedAgents = verificationResult.results
        .filter(r => !r.verification_success || !r.status_valid)
        .map(r => r.agentId);
      
      throw new Error(
        `Objective verification failed. ` +
        `Failed agents: ${failedAgents.join(', ')}. ` +
        `Summary: ${verificationResult.summary.successful_agents}/${verificationResult.summary.total_agents} passed`
      );
    }
    
    // Store verification result in memory
    await this.memoryManager.remember({
      namespace: this.config.memoryNamespace,
      key: `objective:${objectiveId}:verification`,
      content: JSON.stringify(verificationResult),
      metadata: {
        type: 'objective-verification',
        objectiveId,
        totalAgents: verificationResult.summary.total_agents,
        successfulAgents: verificationResult.summary.successful_agents
      }
    });
    
    this.logger.info(`Objective verification passed for ${objectiveId}`);
  }

  /**
   * Determine verification type based on task type
   */
  private determineAgentVerificationType(
    taskType: string
  ): 'typescript' | 'test' | 'build' | 'general' {
    if (taskType.includes('test')) return 'test';
    if (taskType.includes('build') || taskType.includes('implement')) return 'build';
    if (taskType.includes('typescript') || taskType.includes('type')) return 'typescript';
    return 'general';
  }

  /**
   * Get verification framework (for external access)
   */
  getVerificationFramework(): SwarmVerificationFramework {
    return this.verificationFramework;
  }

  /**
   * Store verification framework in memory for other agents
   */
  async storeVerificationFrameworkInMemory(): Promise<void> {
    const frameworkInfo = {
      framework_version: '1.0.0',
      enforcement_enabled: true,
      config: this.verificationFramework.getConfig(),
      documentation: {
        purpose: 'Enforce verification before reporting for swarm operations',
        required_fields: ['ok', 'errors', 'spawned', 'timestamp', 'verification_commands'],
        enforcement_rules: [
          'Missing status.json file = operation failure',
          'Invalid status.json schema = operation failure', 
          'ok: false or errors > 0 = operation failure',
          'Failed verification commands = operation failure'
        ]
      },
      templates: {
        status_schema: {
          ok: 'boolean - Overall operation success',
          errors: 'number - Number of errors (must be 0 for ok: true)',
          spawned: 'number - Number of agents/processes spawned',
          timestamp: 'string - ISO timestamp',
          verification_commands: 'string[] - Commands executed for verification'
        },
        verification_commands: {
          typescript: ['npm run typecheck'],
          test: ['npm test'],
          build: ['npm run build'],
          general: ['npm run typecheck', "grep -r spawn src --include='*.ts' | wc -l"]
        }
      }
    };
    
    await this.memoryManager.remember({
      namespace: this.config.memoryNamespace,
      key: 'swarm-development-hierarchical-1751174468691/verification-system/framework',
      content: JSON.stringify(frameworkInfo),
      metadata: {
        type: 'verification-framework',
        version: '1.0.0',
        created_by: 'SwarmCoordinator'
      }
    });
    
    this.logger.info('Verification framework stored in memory for agent coordination');
  }
}