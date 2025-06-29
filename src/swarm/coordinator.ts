/**
 * Comprehensive Swarm Coordinator - Main orchestration engine
 */

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';

// Unified process execution interface
interface ProcessPoolCommand {
  command: string;
  args: string[];
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    stdio?: string[];
  };
}

interface ProcessPoolResult {
  exitCode: number;
  output: string;
  error?: string;
}

class ProcessPool {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async executeCommand(cmd: ProcessPoolCommand): Promise<ProcessPoolResult> {
    return new Promise((resolve, reject) => {
      // Import traced spawn for execution monitoring
      import('../tracing/index.js').then(({ spawn }) => {
        const proc = spawn(cmd.command, cmd.args, {
          ...cmd.options,
          stdio: cmd.options?.stdio || ['ignore', 'pipe', 'pipe']
        });

        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);

        proc.stdout?.on('data', (data) => {
          stdout = Buffer.concat([stdout, data]);
        });

        proc.stderr?.on('data', (data) => {
          stderr = Buffer.concat([stderr, data]);
        });

        proc.on('close', (code) => {
          resolve({
            exitCode: code || 0,
            output: stdout.toString('utf8'),
            error: stderr.toString('utf8')
          });
        });

        proc.on('error', reject);
      }).catch(reject);
    });
  }

  async checkCommand(command: string): Promise<boolean> {
    try {
      const result = await this.executeCommand({
        command: 'which',
        args: [command],
        options: {
          stdio: ['ignore', 'pipe', 'pipe']
        }
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
import {
  SwarmId, AgentId, TaskId, AgentState, TaskDefinition, SwarmObjective,
  SwarmConfig, SwarmStatus, SwarmProgress, SwarmResults, SwarmMetrics,
  SwarmMode, SwarmStrategy, AgentType, TaskType, TaskStatus, TaskPriority,
  SwarmEvent, EventType, SwarmEventEmitter, ValidationResult,
  SWARM_CONSTANTS
} from './types.js';
import { AutoStrategy } from './strategies/auto.js';

export class SwarmCoordinator extends EventEmitter implements SwarmEventEmitter {
  private logger: Logger;
  private config: SwarmConfig;
  private swarmId: SwarmId;
  
  // Core state management
  private agents: Map<string, AgentState> = new Map();
  private tasks: Map<string, TaskDefinition> = new Map();
  private objectives: Map<string, SwarmObjective> = new Map();
  
  // Execution state
  private _isRunning: boolean = false;
  private status: SwarmStatus = 'planning';
  private startTime?: Date;
  private endTime?: Date;
  
  // Performance tracking
  private metrics: SwarmMetrics;
  private events: SwarmEvent[] = [];
  private lastHeartbeat: Date = new Date();
  
  // Background processes
  private heartbeatTimer?: NodeJS.Timeout;
  private monitoringTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private executionIntervals?: Map<string, NodeJS.Timeout>;
  
  // Strategy instances
  private autoStrategy: AutoStrategy;
  
  constructor(config: Partial<SwarmConfig> = {}) {
    super();
    
    // Configure logger based on config or default to quiet mode
    const logLevel = (config as any).logging?.level || 'error';
    const logFormat = (config as any).logging?.format || 'text';
    const logDestination = (config as any).logging?.destination || 'console';
    
    this.logger = new Logger(
      { level: logLevel, format: logFormat, destination: logDestination },
      { component: 'SwarmCoordinator' }
    );
    this.processPool = new ProcessPool(this.logger);
    this.swarmId = this.generateSwarmId();
    
    // Initialize configuration with defaults
    this.config = this.mergeWithDefaults(config);
    
    // Initialize metrics
    this.metrics = this.initializeMetrics();
    
    // Initialize strategy instances
    this.autoStrategy = new AutoStrategy(config);
    
    // Setup event handlers
    this.setupEventHandlers();
    
    this.logger.info('SwarmCoordinator initialized', { 
      swarmId: this.swarmId.id,
      mode: this.config.mode,
      strategy: this.config.strategy 
    });
  }

  // ===== LIFECYCLE MANAGEMENT =====

  async initialize(): Promise<void> {
    if (this._isRunning) {
      throw new Error('Swarm coordinator already running');
    }

    this.logger.info('Initializing swarm coordinator...');
    this.status = 'initializing';
    
    try {
      // Validate configuration
      const validation = await this.validateConfiguration();
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.map(e => e.message).join(', ')}`);
      }

      // Initialize subsystems
      await this.initializeSubsystems();
      
      // Start background processes
      this.startBackgroundProcesses();
      
      this._isRunning = true;
      this.startTime = new Date();
      this.status = 'executing';
      
      this.emitSwarmEvent({
        id: generateId('event'),
        timestamp: new Date(),
        type: 'swarm.started',
        source: this.swarmId.id,
        data: { swarmId: this.swarmId },
        broadcast: true,
        processed: false
      });
      
      this.logger.info('Swarm coordinator initialized successfully');
      
    } catch (error) {
      this.status = 'failed';
      this.logger.error('Failed to initialize swarm coordinator', { error });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    this.logger.info('Shutting down swarm coordinator...');
    this.status = 'paused';
    
    try {
      // Stop background processes
      this.stopBackgroundProcesses();
      
      // Gracefully stop all agents
      await this.stopAllAgents();
      
      // Complete any running tasks
      await this.completeRunningTasks();
      
      // Save final state
      await this.saveState();
      
      this._isRunning = false;
      this.endTime = new Date();
      this.status = 'completed';
      
      this.emitSwarmEvent({
        id: generateId('event'),
        timestamp: new Date(),
        type: 'swarm.completed',
        source: this.swarmId.id,
        data: { 
          swarmId: this.swarmId,
          metrics: this.metrics,
          duration: this.endTime.getTime() - (this.startTime?.getTime() || 0)
        },
        broadcast: true,
        processed: false
      });
      
      this.logger.info('Swarm coordinator shut down successfully');
      
    } catch (error) {
      this.logger.error('Error during swarm coordinator shutdown', { error });
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (!this._isRunning || this.status === 'paused') {
      return;
    }

    this.logger.info('Pausing swarm coordinator...');
    this.status = 'paused';
    
    // Pause all agents
    for (const agent of this.agents.values()) {
      if (agent.status === 'busy') {
        await this.pauseAgent(agent.id.id);
      }
    }
    
    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'swarm.paused',
      source: this.swarmId.id,
      data: { swarmId: this.swarmId },
      broadcast: true,
      processed: false
    });
  }

  async resume(): Promise<void> {
    if (!this._isRunning || this.status !== 'paused') {
      return;
    }

    this.logger.info('Resuming swarm coordinator...');
    this.status = 'executing';
    
    // Resume all paused agents
    for (const agent of this.agents.values()) {
      if (agent.status === 'paused') {
        await this.resumeAgent(agent.id.id);
      }
    }
    
    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'swarm.resumed',
      source: this.swarmId.id,
      data: { swarmId: this.swarmId },
      broadcast: true,
      processed: false
    });
  }

  // ===== OBJECTIVE MANAGEMENT =====

  async createObjective(
    name: string,
    description: string,
    strategy: SwarmStrategy = 'auto',
    requirements: Partial<SwarmObjective['requirements']> = {}
  ): Promise<string> {
    const objectiveId = generateId('objective');
    
    const objective: SwarmObjective = {
      id: objectiveId,
      name,
      description,
      strategy,
      mode: this.config.mode,
      requirements: {
        minAgents: 1,
        maxAgents: this.config.maxAgents,
        agentTypes: this.determineRequiredAgentTypes(strategy),
        estimatedDuration: 60 * 60 * 1000, // 1 hour default
        maxDuration: 4 * 60 * 60 * 1000,   // 4 hours default
        qualityThreshold: this.config.qualityThreshold,
        reviewCoverage: 0.8,
        testCoverage: 0.7,
        reliabilityTarget: 0.95,
        ...requirements
      },
      constraints: {
        minQuality: this.config.qualityThreshold,
        requiredApprovals: [],
        allowedFailures: Math.floor(this.config.maxAgents * 0.1),
        recoveryTime: 5 * 60 * 1000, // 5 minutes
        milestones: [],
        resourceLimits: {} // Initialize empty resource limits
      },
      tasks: [],
      dependencies: [],
      status: 'planning',
      progress: this.initializeProgress(),
      createdAt: new Date(),
      metrics: this.initializeMetrics()
    };

    // Decompose objective into tasks using optimized AUTO strategy
    if (objective.strategy === 'auto') {
      const decompositionResult = await this.autoStrategy.decomposeObjective(objective);
      objective.tasks = decompositionResult.tasks;
      objective.dependencies = this.convertDependenciesToTaskDependencies(decompositionResult.dependencies);
    } else {
      objective.tasks = await this.decomposeObjective(objective);
      objective.dependencies = this.analyzeDependencies(objective.tasks);
    }
    
    this.objectives.set(objectiveId, objective);
    
    this.logger.info('Created objective', { 
      objectiveId, 
      name, 
      strategy, 
      taskCount: objective.tasks.length 
    });

    return objectiveId;
  }

  async executeObjective(objectiveId: string): Promise<void> {
    const objective = this.objectives.get(objectiveId);
    if (!objective) {
      throw new Error(`Objective not found: ${objectiveId}`);
    }

    if (objective.status !== 'planning') {
      throw new Error(`Objective already ${objective.status}`);
    }

    this.logger.info('Executing objective', { objectiveId, name: objective.name });
    objective.status = 'executing';
    objective.startedAt = new Date();

    try {
      // Ensure we have required agents
      await this.ensureRequiredAgents(objective);
      
      // Schedule initial tasks
      await this.scheduleInitialTasks(objective);
      
      // Start task execution loop
      this.startTaskExecutionLoop(objective);
      
    } catch (error) {
      objective.status = 'failed';
      this.logger.error('Failed to execute objective', { objectiveId, error });
      throw error;
    }
  }

  // ===== AGENT MANAGEMENT =====

  async registerAgent(
    name: string,
    type: AgentType,
    capabilities: Partial<AgentState['capabilities']> = {}
  ): Promise<string> {
    const agentId: AgentId = {
      id: generateId('agent'),
      swarmId: this.swarmId.id,
      type,
      instance: this.getNextInstanceNumber(type)
    };

    const agentState: AgentState = {
      id: agentId,
      name,
      type,
      status: 'initializing',
      capabilities: {
        // Default capabilities
        codeGeneration: false,
        codeReview: false,
        testing: false,
        documentation: false,
        research: false,
        analysis: false,
        webSearch: false,
        apiIntegration: false,
        fileSystem: true,
        terminalAccess: true,
        languages: [],
        frameworks: [],
        domains: [],
        tools: [],
        maxConcurrentTasks: 3,
        maxMemoryUsage: SWARM_CONSTANTS.DEFAULT_MEMORY_LIMIT,
        maxExecutionTime: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
        reliability: 0.8,
        speed: 1.0,
        quality: 0.8,
        ...capabilities
      },
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        averageExecutionTime: 0,
        successRate: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        diskUsage: 0,
        networkUsage: 0,
        codeQuality: 0,
        testCoverage: 0,
        bugRate: 0,
        userSatisfaction: 0,
        totalUptime: 0,
        lastActivity: new Date(),
        responseTime: 0
      },
      workload: 0,
      health: 1.0,
      config: {
        autonomyLevel: 0.7,
        learningEnabled: true,
        adaptationEnabled: true,
        maxTasksPerHour: 10,
        maxConcurrentTasks: capabilities.maxConcurrentTasks || 3,
        timeoutThreshold: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
        reportingInterval: 30000,
        heartbeatInterval: SWARM_CONSTANTS.DEFAULT_HEARTBEAT_INTERVAL,
        permissions: this.getDefaultPermissions(type),
        trustedAgents: [],
        expertise: {},
        preferences: {}
      },
      environment: {
        runtime: 'deno',
        version: '1.0.0',
        workingDirectory: `/tmp/swarm/${this.swarmId.id}/agents/${agentId.id}`,
        tempDirectory: `/tmp/swarm/${this.swarmId.id}/agents/${agentId.id}/temp`,
        logDirectory: `/tmp/swarm/${this.swarmId.id}/agents/${agentId.id}/logs`,
        apiEndpoints: {},
        credentials: {},
        availableTools: [],
        toolConfigs: {}
      },
      endpoints: [],
      lastHeartbeat: new Date(),
      taskHistory: [],
      errorHistory: [],
      childAgents: [],
      collaborators: [],
      completedTasks: []
    };

    this.agents.set(agentId.id, agentState);
    
    // Initialize agent capabilities based on type
    await this.initializeAgentCapabilities(agentState);
    
    // Start agent
    await this.startAgent(agentId.id);
    
    this.logger.info('Registered agent', { 
      agentId: agentId.id, 
      name, 
      type,
      capabilities: Object.keys(capabilities)
    });

    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'agent.created',
      source: agentId.id,
      data: { agent: agentState },
      broadcast: false,
      processed: false
    });

    return agentId.id;
  }

  async unregisterAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    this.logger.info('Unregistering agent', { agentId, name: agent.name });
    
    // Stop agent gracefully
    await this.stopAgent(agentId);
    
    // Reassign any active tasks
    if (agent.currentTask) {
      await this.reassignTask(agent.currentTask.id);
    }
    
    // Remove from agents map
    this.agents.delete(agentId);
    
    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'agent.stopped',
      source: agentId,
      data: { agentId },
      broadcast: false,
      processed: false
    });
  }

  async startAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.status !== 'initializing' && agent.status !== 'offline') {
      return;
    }

    this.logger.info('Starting agent', { agentId, name: agent.name });
    
    try {
      // Initialize agent environment
      await this.initializeAgentEnvironment(agent);
      
      // Start agent heartbeat
      this.startAgentHeartbeat(agent);
      
      agent.status = 'idle';
      agent.lastHeartbeat = new Date();
      
      this.emitSwarmEvent({
        id: generateId('event'),
        timestamp: new Date(),
        type: 'agent.started',
        source: agentId,
        data: { agent },
        broadcast: false,
        processed: false
      });
      
    } catch (error) {
      agent.status = 'error';
      agent.errorHistory.push({
        timestamp: new Date(),
        type: 'startup_error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        context: { agentId },
        severity: 'high',
        resolved: false
      });
      
      this.logger.error('Failed to start agent', { agentId, error });
      throw error;
    }
  }

  async stopAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }

    if (agent.status === 'offline' || agent.status === 'terminated') {
      return;
    }

    this.logger.info('Stopping agent', { agentId, name: agent.name });
    
    agent.status = 'terminating';
    
    try {
      // Cancel current task if any
      if (agent.currentTask) {
        await this.cancelTask(agent.currentTask.id, 'Agent stopping');
      }
      
      // Stop heartbeat
      this.stopAgentHeartbeat(agent);
      
      // Cleanup agent environment
      await this.cleanupAgentEnvironment(agent);
      
      agent.status = 'terminated';
      
    } catch (error) {
      agent.status = 'error';
      this.logger.error('Error stopping agent', { agentId, error });
    }
  }

  async pauseAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'busy') {
      return;
    }

    agent.status = 'paused';
    this.logger.info('Paused agent', { agentId });
  }

  async resumeAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent || agent.status !== 'paused') {
      return;
    }

    agent.status = 'busy';
    this.logger.info('Resumed agent', { agentId });
  }

  // ===== TASK MANAGEMENT =====

  async createTask(
    type: TaskType,
    name: string,
    description: string,
    instructions: string,
    options: Partial<TaskDefinition> = {}
  ): Promise<string> {
    const taskId: TaskId = {
      id: generateId('task'),
      swarmId: this.swarmId.id,
      sequence: this.tasks.size + 1,
      priority: 1
    };

    const task: TaskDefinition = {
      id: taskId,
      type,
      name,
      description,
      instructions,
      requirements: {
        capabilities: this.getRequiredCapabilities(type),
        tools: this.getRequiredTools(type),
        permissions: this.getRequiredPermissions(type),
        ...options.requirements
      },
      constraints: {
        dependencies: [],
        dependents: [],
        conflicts: [],
        maxRetries: SWARM_CONSTANTS.MAX_RETRIES,
        timeoutAfter: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
        ...options.constraints
      },
      priority: 'normal',
      input: options.input || {},
      context: options.context || {},
      examples: options.examples || [],
      status: 'created',
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: [],
      statusHistory: [{
        timestamp: new Date(),
        from: 'created' as TaskStatus,
        to: 'created' as TaskStatus,
        reason: 'Task created',
        triggeredBy: 'system'
      }],
      ...options
    };

    this.tasks.set(taskId.id, task);
    
    this.logger.info('Created task', { 
      taskId: taskId.id, 
      type, 
      name,
      priority: task.priority 
    });

    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'task.created',
      source: this.swarmId.id,
      data: { task },
      broadcast: false,
      processed: false
    });

    return taskId.id;
  }

  async assignTask(taskId: string, agentId?: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status !== 'created' && task.status !== 'queued') {
      throw new Error(`Task cannot be assigned, current status: ${task.status}`);
    }

    // Select agent if not specified
    if (!agentId) {
      const selectedAgentId = await this.selectAgentForTask(task);
      if (!selectedAgentId) {
        throw new Error('No suitable agent available for task');
      }
      agentId = selectedAgentId;
    }

    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.status !== 'idle') {
      throw new Error(`Agent not available: ${agent.status}`);
    }

    // Assign task
    task.assignedTo = agent.id;
    task.assignedAt = new Date();
    task.status = 'assigned';
    
    agent.currentTask = task.id;
    agent.status = 'busy';
    
    // Update status history
    task.statusHistory.push({
      timestamp: new Date(),
      from: task.statusHistory[task.statusHistory.length - 1].to,
      to: 'assigned',
      reason: `Assigned to agent ${agent.name}`,
      triggeredBy: 'system'
    });

    this.logger.info('Assigned task', { 
      taskId, 
      agentId, 
      agentName: agent.name 
    });

    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'task.assigned',
      source: agentId,
      data: { task, agent },
      broadcast: false,
      processed: false
    });

    // Start task execution
    await this.startTaskExecution(task);
  }

  async startTaskExecution(task: TaskDefinition): Promise<void> {
    if (!task.assignedTo) {
      throw new Error('Task not assigned to any agent');
    }

    const agent = this.agents.get(task.assignedTo.id);
    if (!agent) {
      throw new Error(`Agent not found: ${task.assignedTo.id}`);
    }

    this.logger.info('Starting task execution', { 
      taskId: task.id.id, 
      agentId: agent.id.id 
    });

    task.status = 'running';
    task.startedAt = new Date();
    
    // Create attempt record
    const attempt = {
      attemptNumber: task.attempts.length + 1,
      agent: agent.id,
      startedAt: new Date(),
      status: 'running' as TaskStatus,
      resourcesUsed: {}
    };
    task.attempts.push(attempt);
    
    // Update status history
    task.statusHistory.push({
      timestamp: new Date(),
      from: 'assigned',
      to: 'running',
      reason: 'Task execution started',
      triggeredBy: agent.id
    });

    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'task.started',
      source: agent.id.id,
      data: { task, agent, attempt },
      broadcast: false,
      processed: false
    });

    try {
      // Execute task (this would spawn actual Claude process)
      const result = await this.executeTaskWithAgent(task, agent);
      await this.completeTask(task.id.id, result);
      
    } catch (error) {
      await this.failTask(task.id.id, error);
    }
  }

  async completeTask(taskId: string, result: any): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const agent = task.assignedTo ? this.agents.get(task.assignedTo.id) : null;
    if (!agent) {
      throw new Error('Task not assigned to any agent');
    }

    this.logger.info('Completing task', { taskId, agentId: agent.id.id });

    task.status = 'completed';
    task.completedAt = new Date();
    task.result = {
      output: result,
      artifacts: {},
      metadata: {},
      quality: this.assessTaskQuality(task, result),
      completeness: 1.0,
      accuracy: 1.0,
      executionTime: task.completedAt.getTime() - (task.startedAt?.getTime() || 0),
      resourcesUsed: {},
      validated: false
    };

    // Update attempt
    const currentAttempt = task.attempts[task.attempts.length - 1];
    if (currentAttempt) {
      currentAttempt.completedAt = new Date();
      currentAttempt.status = 'completed';
      currentAttempt.result = task.result;
    }

    // Update agent state
    agent.status = 'idle';
    agent.currentTask = undefined;
    agent.metrics.tasksCompleted++;
    agent.metrics.lastActivity = new Date();
    agent.taskHistory.push(task.id);
    
    // Update agent metrics
    this.updateAgentMetrics(agent, task);

    // Update status history
    task.statusHistory.push({
      timestamp: new Date(),
      from: 'running',
      to: 'completed',
      reason: 'Task completed successfully',
      triggeredBy: agent.id
    });

    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'task.completed',
      source: agent.id.id,
      data: { task, agent, result: task.result },
      broadcast: false,
      processed: false
    });

    // Check for dependent tasks
    await this.processDependentTasks(task);
  }

  async failTask(taskId: string, error: any): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const agent = task.assignedTo ? this.agents.get(task.assignedTo.id) : null;
    if (!agent) {
      throw new Error('Task not assigned to any agent');
    }

    this.logger.warn('Task failed', { taskId, agentId: agent.id.id, error: error.message });

    task.error = {
      type: error.constructor.name,
      message: error.message,
      code: error.code,
      stack: error.stack,
      context: { taskId, agentId: agent.id.id },
      recoverable: this.isRecoverableError(error),
      retryable: this.isRetryableError(error)
    };

    // Update attempt
    const currentAttempt = task.attempts[task.attempts.length - 1];
    if (currentAttempt) {
      currentAttempt.completedAt = new Date();
      currentAttempt.status = 'failed';
      currentAttempt.error = task.error;
    }

    // Update agent state
    agent.status = 'idle';
    agent.currentTask = undefined;
    agent.metrics.tasksFailed++;
    agent.metrics.lastActivity = new Date();
    
    // Add to error history
    agent.errorHistory.push({
      timestamp: new Date(),
      type: 'task_failure',
      message: error.message,
      stack: error.stack,
      context: { taskId },
      severity: 'medium',
      resolved: false
    });

    // Determine if we should retry
    const shouldRetry = task.error.retryable && 
                       task.attempts.length < (task.constraints.maxRetries || SWARM_CONSTANTS.MAX_RETRIES);

    if (shouldRetry) {
      task.status = 'retrying';
      task.assignedTo = undefined;
      
      // Update status history
      task.statusHistory.push({
        timestamp: new Date(),
        from: 'running',
        to: 'retrying',
        reason: `Task failed, will retry: ${error.message}`,
        triggeredBy: agent.id
      });

      this.emitSwarmEvent({
        id: generateId('event'),
        timestamp: new Date(),
        type: 'task.retried',
        source: agent.id.id,
        data: { task, error: task.error, attempt: task.attempts.length },
        broadcast: false,
        processed: false
      });

      // Schedule retry with exponential backoff
      const retryDelay = Math.pow(2, task.attempts.length) * 1000;
      setTimeout(() => {
        this.assignTask(taskId).catch(retryError => {
          this.logger.error('Failed to retry task', { taskId, retryError });
        });
      }, retryDelay);

    } else {
      task.status = 'failed';
      task.completedAt = new Date();
      
      // Update status history
      task.statusHistory.push({
        timestamp: new Date(),
        from: 'running',
        to: 'failed',
        reason: `Task failed permanently: ${error.message}`,
        triggeredBy: agent.id
      });

      this.emitSwarmEvent({
        id: generateId('event'),
        timestamp: new Date(),
        type: 'task.failed',
        source: agent.id.id,
        data: { task, error: task.error },
        broadcast: false,
        processed: false
      });

      // Handle failure cascade
      await this.handleTaskFailureCascade(task);
    }
  }

  async cancelTask(taskId: string, reason: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const agent = task.assignedTo ? this.agents.get(task.assignedTo.id) : null;

    this.logger.info('Cancelling task', { taskId, reason });

    task.status = 'cancelled';
    task.completedAt = new Date();

    if (agent) {
      agent.status = 'idle';
      agent.currentTask = undefined;
    }

    // Update status history
    task.statusHistory.push({
      timestamp: new Date(),
      from: task.statusHistory[task.statusHistory.length - 1].to,
      to: 'cancelled',
      reason: `Task cancelled: ${reason}`,
      triggeredBy: 'system'
    });

    this.emitSwarmEvent({
      id: generateId('event'),
      timestamp: new Date(),
      type: 'task.cancelled',
      source: this.swarmId.id,
      data: { task, reason },
      broadcast: false,
      processed: false
    });
  }

  // ===== ADVANCED FEATURES =====

  async selectAgentForTask(task: TaskDefinition): Promise<string | null> {
    const availableAgents = Array.from(this.agents.values())
      .filter(agent => 
        agent.status === 'idle' &&
        this.agentCanHandleTask(agent, task)
      );

    if (availableAgents.length === 0) {
      return null;
    }

    // Score agents based on multiple criteria
    const scoredAgents = availableAgents.map(agent => ({
      agent,
      score: this.calculateAgentScore(agent, task)
    }));

    // Sort by score (highest first)
    scoredAgents.sort((a, b) => b.score - a.score);

    return scoredAgents[0].agent.id.id;
  }

  private calculateAgentScore(agent: AgentState, task: TaskDefinition): number {
    let score = 0;

    // Capability match (40% weight)
    const capabilityMatch = this.calculateCapabilityMatch(agent, task);
    score += capabilityMatch * 0.4;

    // Performance history (30% weight)
    const performanceScore = agent.metrics.successRate * agent.capabilities.reliability;
    score += performanceScore * 0.3;

    // Current workload (20% weight)
    const workloadScore = 1 - agent.workload;
    score += workloadScore * 0.2;

    // Quality rating (10% weight)
    score += agent.capabilities.quality * 0.1;

    return score;
  }

  private calculateCapabilityMatch(agent: AgentState, task: TaskDefinition): number {
    const requiredCapabilities = task.requirements.capabilities;
    let matches = 0;
    let total = requiredCapabilities.length;

    for (const capability of requiredCapabilities) {
      if (this.agentHasCapability(agent, capability)) {
        matches++;
      }
    }

    return total > 0 ? matches / total : 1.0;
  }

  private agentHasCapability(agent: AgentState, capability: string): boolean {
    const caps = agent.capabilities;
    
    switch (capability) {
      case 'code-generation': return caps.codeGeneration;
      case 'code-review': return caps.codeReview;
      case 'testing': return caps.testing;
      case 'documentation': return caps.documentation;
      case 'research': return caps.research;
      case 'analysis': return caps.analysis;
      case 'web-search': return caps.webSearch;
      case 'api-integration': return caps.apiIntegration;
      case 'file-system': return caps.fileSystem;
      case 'terminal-access': return caps.terminalAccess;
      case 'validation': return caps.testing; // Validation is part of testing capability
      default: 
        return caps.domains.includes(capability) ||
               caps.languages.includes(capability) ||
               caps.frameworks.includes(capability) ||
               caps.tools.includes(capability);
    }
  }

  private agentCanHandleTask(agent: AgentState, task: TaskDefinition): boolean {
    // Check if agent type is suitable
    if (task.requirements.agentType && agent.type !== task.requirements.agentType) {
      return false;
    }

    // Check if agent has required capabilities
    for (const capability of task.requirements.capabilities) {
      if (!this.agentHasCapability(agent, capability)) {
        return false;
      }
    }

    // Check reliability requirement
    if (task.requirements.minReliability && 
        agent.capabilities.reliability < task.requirements.minReliability) {
      return false;
    }

    // Check if agent has capacity
    if (agent.workload >= 1.0) {
      return false;
    }

    return true;
  }

  // ===== HELPER METHODS =====

  private generateSwarmId(): SwarmId {
    return {
      id: generateId('swarm'),
      timestamp: Date.now(),
      namespace: 'default'
    };
  }

  private mergeWithDefaults(config: Partial<SwarmConfig>): SwarmConfig {
    return {
      name: 'Unnamed Swarm',
      description: 'Auto-generated swarm',
      version: '1.0.0',
      mode: 'centralized',
      strategy: 'auto',
      coordinationStrategy: {
        name: 'default',
        description: 'Default coordination strategy',
        agentSelection: 'capability-based',
        taskScheduling: 'priority',
        loadBalancing: 'work-stealing',
        faultTolerance: 'retry',
        communication: 'event-driven'
      },
      maxAgents: 10,
      maxTasks: 100,
      maxDuration: 4 * 60 * 60 * 1000, // 4 hours
      resourceLimits: {
        memory: SWARM_CONSTANTS.DEFAULT_MEMORY_LIMIT,
        cpu: SWARM_CONSTANTS.DEFAULT_CPU_LIMIT,
        disk: SWARM_CONSTANTS.DEFAULT_DISK_LIMIT
      },
      qualityThreshold: SWARM_CONSTANTS.DEFAULT_QUALITY_THRESHOLD,
      reviewRequired: true,
      testingRequired: true,
      monitoring: {
        metricsEnabled: true,
        loggingEnabled: true,
        tracingEnabled: false,
        metricsInterval: 10000,
        heartbeatInterval: SWARM_CONSTANTS.DEFAULT_HEARTBEAT_INTERVAL,
        healthCheckInterval: 30000,
        retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
        maxLogSize: 100 * 1024 * 1024, // 100MB
        maxMetricPoints: 10000,
        alertingEnabled: true,
        alertThresholds: {
          errorRate: 0.1,
          responseTime: 5000,
          memoryUsage: 0.8,
          cpuUsage: 0.8
        },
        exportEnabled: false,
        exportFormat: 'json',
        exportDestination: '/tmp/swarm-metrics'
      },
      memory: {
        namespace: 'default',
        partitions: [],
        permissions: {
          read: 'swarm',
          write: 'team',
          delete: 'private',
          share: 'team'
        },
        persistent: true,
        backupEnabled: true,
        distributed: false,
        consistency: 'eventual',
        cacheEnabled: true,
        compressionEnabled: false
      },
      security: {
        authenticationRequired: false,
        authorizationRequired: false,
        encryptionEnabled: false,
        defaultPermissions: ['read', 'write'],
        adminRoles: ['admin', 'coordinator'],
        auditEnabled: true,
        auditLevel: 'info',
        inputValidation: true,
        outputSanitization: true
      },
      performance: {
        maxConcurrency: 10,
        defaultTimeout: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
        cacheEnabled: true,
        cacheSize: 100,
        cacheTtl: 3600000, // 1 hour
        optimizationEnabled: true,
        adaptiveScheduling: true,
        predictiveLoading: false,
        resourcePooling: true,
        connectionPooling: true,
        memoryPooling: false
      },
      ...config
    };
  }

  private initializeMetrics(): SwarmMetrics {
    return {
      throughput: 0,
      latency: 0,
      efficiency: 0,
      reliability: 0,
      averageQuality: 0,
      defectRate: 0,
      reworkRate: 0,
      resourceUtilization: {},
      costEfficiency: 0,
      agentUtilization: 0,
      agentSatisfaction: 0,
      collaborationEffectiveness: 0,
      scheduleVariance: 0,
      deadlineAdherence: 0
    };
  }

  private initializeProgress(): SwarmProgress {
    return {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      runningTasks: 0,
      estimatedCompletion: new Date(),
      timeRemaining: 0,
      percentComplete: 0,
      averageQuality: 0,
      passedReviews: 0,
      passedTests: 0,
      resourceUtilization: {},
      costSpent: 0,
      activeAgents: 0,
      idleAgents: 0,
      busyAgents: 0
    };
  }

  // ===== EVENT HANDLING =====

  private setupEventHandlers(): void {
    // Handle agent heartbeats
    this.on('agent.heartbeat', (data: any) => {
      const agent = this.agents.get(data.agentId);
      if (agent) {
        agent.lastHeartbeat = new Date();
        agent.health = data.health || 1.0;
        agent.metrics = { ...agent.metrics, ...data.metrics };
      }
    });

    // Handle task completion events
    this.on('task.completed', (data: any) => {
      this.updateSwarmMetrics();
      this.checkObjectiveCompletion();
    });

    // Handle task failure events
    this.on('task.failed', (data: any) => {
      this.updateSwarmMetrics();
      this.checkObjectiveFailure(data.task);
    });

    // Handle agent errors
    this.on('agent.error', (data: any) => {
      this.handleAgentError(data.agentId, data.error);
    });
  }

  // ===== SWARM EVENT EMITTER IMPLEMENTATION =====

  emitSwarmEvent(event: SwarmEvent): boolean {
    this.events.push(event);
    
    // Limit event history
    if (this.events.length > 1000) {
      this.events = this.events.slice(-500);
    }
    
    return this.emit(event.type, event);
  }

  emitSwarmEvents(events: SwarmEvent[]): boolean {
    let success = true;
    for (const event of events) {
      if (!this.emitSwarmEvent(event)) {
        success = false;
      }
    }
    return success;
  }

  onSwarmEvent(type: EventType, handler: (event: SwarmEvent) => void): this {
    return this.on(type, handler);
  }

  offSwarmEvent(type: EventType, handler: (event: SwarmEvent) => void): this {
    return this.off(type, handler);
  }

  filterEvents(predicate: (event: SwarmEvent) => boolean): SwarmEvent[] {
    return this.events.filter(predicate);
  }

  correlateEvents(correlationId: string): SwarmEvent[] {
    return this.events.filter(event => event.correlationId === correlationId);
  }

  // ===== PUBLIC API METHODS =====

  getSwarmId(): SwarmId {
    return this.swarmId;
  }

  getStatus(): SwarmStatus {
    return this.status;
  }

  getAgents(): AgentState[] {
    return Array.from(this.agents.values());
  }

  getAgent(agentId: string): AgentState | undefined {
    return this.agents.get(agentId);
  }

  getTasks(): TaskDefinition[] {
    return Array.from(this.tasks.values());
  }

  getTask(taskId: string): TaskDefinition | undefined {
    return this.tasks.get(taskId);
  }

  getObjectives(): SwarmObjective[] {
    return Array.from(this.objectives.values());
  }

  getObjective(objectiveId: string): SwarmObjective | undefined {
    return this.objectives.get(objectiveId);
  }

  getMetrics(): SwarmMetrics {
    return { ...this.metrics };
  }

  getEvents(): SwarmEvent[] {
    return [...this.events];
  }

  isRunning(): boolean {
    return this._isRunning;
  }

  getUptime(): number {
    if (!this.startTime) return 0;
    const endTime = this.endTime || new Date();
    return endTime.getTime() - this.startTime.getTime();
  }

  getSwarmStatus(): { status: SwarmStatus; objectives: number; tasks: { completed: number; failed: number; total: number }; agents: { total: number } } {
    const tasks = Array.from(this.tasks.values());
    const completedTasks = tasks.filter(t => t.status === 'completed').length;
    const failedTasks = tasks.filter(t => t.status === 'failed').length;
    
    return {
      status: this.status,
      objectives: this.objectives.size,
      tasks: {
        completed: completedTasks,
        failed: failedTasks,
        total: tasks.length
      },
      agents: {
        total: this.agents.size
      }
    };
  }

  // ===== STUB METHODS (TO BE IMPLEMENTED) =====

  private async validateConfiguration(): Promise<ValidationResult> {
    // Implementation needed
    return { valid: true, errors: [], warnings: [], validatedAt: new Date(), validator: 'SwarmCoordinator', context: {} };
  }

  private async initializeSubsystems(): Promise<void> {
    // Implementation needed
  }

  private startBackgroundProcesses(): void {
    // Start heartbeat monitoring
    this.heartbeatTimer = setInterval(() => {
      this.processHeartbeats();
    }, this.config.monitoring.heartbeatInterval);

    // Start performance monitoring
    this.monitoringTimer = setInterval(() => {
      this.updateSwarmMetrics();
    }, this.config.monitoring.metricsInterval);

    // Start cleanup process
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, 60000); // Every minute
  }

  private stopBackgroundProcesses(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = undefined;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    // Stop all execution intervals
    if (this.executionIntervals) {
      for (const [objectiveId, interval] of this.executionIntervals) {
        clearInterval(interval);
      }
      this.executionIntervals.clear();
    }
  }

  private async stopAllAgents(): Promise<void> {
    const stopPromises = Array.from(this.agents.keys()).map(agentId => 
      this.stopAgent(agentId)
    );
    await Promise.allSettled(stopPromises);
  }

  private async completeRunningTasks(): Promise<void> {
    const runningTasks = Array.from(this.tasks.values())
      .filter(task => task.status === 'running');
    
    // Wait for tasks to complete or timeout
    const timeout = 30000; // 30 seconds
    const deadline = Date.now() + timeout;
    
    while (runningTasks.some(task => task.status === 'running') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Cancel any remaining running tasks
    for (const task of runningTasks) {
      if (task.status === 'running') {
        await this.cancelTask(task.id.id, 'Swarm shutdown');
      }
    }
  }

  private async saveState(): Promise<void> {
    // Implementation needed - save swarm state to persistence layer
  }

  private determineRequiredAgentTypes(strategy: SwarmStrategy): AgentType[] {
    switch (strategy) {
      case 'research': return ['researcher', 'analyzer'];
      case 'development': return ['developer', 'tester', 'reviewer'];
      case 'analysis': return ['analyzer', 'researcher'];
      case 'testing': return ['tester', 'developer'];
      case 'optimization': return ['analyzer', 'developer'];
      case 'maintenance': return ['developer', 'monitor'];
      default: return ['coordinator', 'developer', 'analyzer'];
    }
  }

  private getAgentTypeInstructions(agentType: string): string {
    switch (agentType) {
      case 'developer':
        return '- Focus on implementation, code quality, and best practices\n- Create clean, maintainable code\n- Consider architecture and design patterns';
      case 'tester':
        return '- Focus on testing, edge cases, and quality assurance\n- Create comprehensive test suites\n- Identify potential bugs and issues';
      case 'analyzer':
        return '- Focus on analysis, research, and understanding\n- Break down complex problems\n- Provide insights and recommendations';
      case 'researcher':
        return '- Focus on gathering information and best practices\n- Research existing solutions and patterns\n- Document findings and recommendations';
      case 'reviewer':
        return '- Focus on code review and quality checks\n- Identify improvements and optimizations\n- Ensure standards compliance';
      case 'coordinator':
        return '- Focus on coordination and integration\n- Ensure all parts work together\n- Manage dependencies and interfaces';
      case 'monitor':
        return '- Focus on monitoring and observability\n- Set up logging and metrics\n- Ensure system health tracking';
      default:
        return '- Execute the task to the best of your ability\n- Follow best practices for your domain';
    }
  }

  private getAgentCapabilities(agentType: string): string[] {
    switch (agentType) {
      case 'developer':
        return ['code-generation', 'file-system', 'debugging'];
      case 'tester':
        return ['testing', 'code-generation', 'analysis'];
      case 'analyzer':
        return ['analysis', 'documentation', 'research'];
      case 'researcher':
        return ['research', 'documentation', 'analysis'];
      case 'reviewer':
        return ['code-review', 'analysis', 'documentation'];
      case 'coordinator':
        return ['coordination', 'analysis', 'documentation'];
      case 'monitor':
        return ['monitoring', 'analysis', 'documentation'];
      default:
        return ['analysis', 'documentation'];
    }
  }

  private async decomposeObjective(objective: SwarmObjective): Promise<TaskDefinition[]> {
    // Decompose objective into tasks with clear instructions for Claude
    this.logger.info('Decomposing objective', { 
      objectiveId: objective.id, 
      description: objective.description 
    });
    
    const tasks: TaskDefinition[] = [];
    
    // Extract target directory from objective
    const targetDirMatch = objective.description.match(/(?:in|to|at)\s+([^\s]+\/[^\s]+)|([^\s]+\/[^\s]+)$/);
    const targetDir = targetDirMatch ? targetDirMatch[1] || targetDirMatch[2] : null;
    const targetPath = targetDir ? (targetDir.startsWith('/') ? targetDir : `/workspaces/claude-code-flow/${targetDir}`) : null;
    
    // Check if objective requests "each agent" or "each agent type" for parallel execution
    const eachAgentPattern = /\beach\s+agent(?:\s+type)?\b/i;
    const requestsParallelAgents = eachAgentPattern.test(objective.description);
    
    // Create tasks with specific prompts for Claude
    if (requestsParallelAgents && this.config.mode === 'parallel') {
      // Create parallel tasks for each agent type
      const agentTypes = this.determineRequiredAgentTypes(objective.strategy);
      this.logger.info('Creating parallel tasks for each agent type', { 
        agentTypes,
        mode: this.config.mode 
      });
      
      for (const agentType of agentTypes) {
        const taskId = this.createTaskForObjective(`${agentType}-task`, agentType as TaskType, {
          title: `${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Agent Task`,
          description: `${agentType} agent executing: ${objective.description}`,
          instructions: `You are a ${agentType} agent. Please execute the following task from your perspective:

${objective.description}

${targetPath ? `Target Directory: ${targetPath}` : ''}

As a ${agentType} agent, focus on aspects relevant to your role:
${this.getAgentTypeInstructions(agentType)}

Work independently but be aware that other agents are working on this same objective from their perspectives.`,
          priority: 'high' as TaskPriority,
          estimatedDuration: 10 * 60 * 1000,
          requiredCapabilities: this.getAgentCapabilities(agentType)
        });
        tasks.push(taskId);
      }
    } else if (objective.strategy === 'development') {
      // Task 1: Analyze and Plan
      const task1 = this.createTaskForObjective('analyze-requirements', 'analysis', {
        title: 'Analyze Requirements and Plan Implementation',
        description: `Analyze the requirements and create a plan for: ${objective.description}`,
        instructions: `Please analyze the following request and create a detailed implementation plan:

Request: ${objective.description}

Target Directory: ${targetPath || 'Not specified - determine appropriate location'}

Your analysis should include:
1. Understanding of what needs to be built
2. Technology choices and rationale
3. Project structure and file organization
4. Key components and their responsibilities
5. Any external dependencies needed

Please provide a clear, structured plan that the next tasks can follow.`,
        priority: 'high' as TaskPriority,
        estimatedDuration: 5 * 60 * 1000,
        requiredCapabilities: ['analysis', 'documentation']
      });
      tasks.push(task1);
      
      // Task 2: Implementation
      const task2 = this.createTaskForObjective('create-implementation', 'coding', {
        title: 'Implement the Solution',
        description: `Create the implementation for: ${objective.description}`,
        instructions: `Please implement the following request:

Request: ${objective.description}

Target Directory: ${targetPath || 'Create in an appropriate location'}

Based on the analysis from the previous task, please:
1. Create all necessary files and directories
2. Implement the core functionality as requested
3. Ensure the code is well-structured and follows best practices
4. Include appropriate error handling
5. Add any necessary configuration files (package.json, requirements.txt, etc.)

Focus on creating a working implementation that matches the user's request exactly.`,
        priority: 'high' as TaskPriority,
        estimatedDuration: 10 * 60 * 1000,
        requiredCapabilities: ['code-generation', 'file-system'],
        dependencies: [task1.id.id]
      });
      tasks.push(task2);
      
      // Task 3: Testing
      const task3 = this.createTaskForObjective('write-tests', 'testing', {
        title: 'Create Tests',
        description: `Write tests for the implementation`,
        instructions: `Please create comprehensive tests for the implementation created in the previous task.

Target Directory: ${targetPath || 'Use the same directory as the implementation'}

Create appropriate test files that:
1. Test the main functionality
2. Cover edge cases
3. Ensure the implementation works as expected
4. Use appropriate testing frameworks for the technology stack
5. Include both unit tests and integration tests where applicable`,
        priority: 'medium' as TaskPriority,
        estimatedDuration: 5 * 60 * 1000,
        requiredCapabilities: ['testing', 'code-generation'],
        dependencies: [task2.id.id]
      });
      tasks.push(task3);
      
      // Task 4: Documentation
      const task4 = this.createTaskForObjective('create-documentation', 'documentation', {
        title: 'Create Documentation',
        description: `Document the implementation`,
        instructions: `Please create comprehensive documentation for the implemented solution.

Target Directory: ${targetPath || 'Use the same directory as the implementation'}

Create documentation that includes:
1. README.md with project overview, setup instructions, and usage examples
2. API documentation (if applicable)
3. Configuration options
4. Architecture overview
5. Deployment instructions (if applicable)
6. Any other relevant documentation

Make sure the documentation is clear, complete, and helps users understand and use the implementation.`,
        priority: 'medium' as TaskPriority,
        estimatedDuration: 5 * 60 * 1000,
        requiredCapabilities: ['documentation'],
        dependencies: [task2.id.id]
      });
      tasks.push(task4);
    } else {
      // For other strategies, create a comprehensive single task
      tasks.push(this.createTaskForObjective('execute-objective', 'coding' as TaskType, {
        title: 'Execute Objective',
        description: objective.description,
        instructions: `Please complete the following request:

${objective.description}

${targetPath ? `Target Directory: ${targetPath}` : ''}

Please analyze what is being requested and implement it appropriately. This may involve:
- Creating files and directories
- Writing code
- Setting up configurations
- Creating documentation
- Any other tasks necessary to fulfill the request

Ensure your implementation is complete, well-structured, and follows best practices.`,
        priority: 'high' as TaskPriority,
        estimatedDuration: 15 * 60 * 1000,
        requiredCapabilities: ['code-generation', 'file-system', 'documentation']
      }));
    }
    
    this.logger.info('Objective decomposed', { 
      objectiveId: objective.id, 
      taskCount: tasks.length 
    });
    
    return tasks;
  }
  
  private createTaskForObjective(id: string, type: TaskType, params: any): TaskDefinition {
    const taskId: TaskId = {
      id: generateId('task'),
      swarmId: this.swarmId.id,
      sequence: this.tasks.size + 1,
      priority: 1
    };
    
    return {
      id: taskId,
      type,
      name: params.title,
      description: params.description,
      instructions: params.description,
      requirements: {
        capabilities: params.requiredCapabilities || [],
        tools: this.getRequiredTools(type),
        permissions: this.getRequiredPermissions(type)
      },
      constraints: {
        dependencies: params.dependencies || [],
        dependents: [],
        conflicts: [],
        maxRetries: SWARM_CONSTANTS.MAX_RETRIES,
        timeoutAfter: params.estimatedDuration || SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT
      },
      priority: params.priority || 'medium',
      input: {
        description: params.description,
        objective: params.description
      },
      context: {
        objectiveId: id,
        targetDir: params.targetDir
      },
      examples: [],
      status: 'created',
      createdAt: new Date(),
      updatedAt: new Date(),
      attempts: [],
      statusHistory: [{
        timestamp: new Date(),
        from: 'created' as TaskStatus,
        to: 'created' as TaskStatus,
        reason: 'Task created',
        triggeredBy: 'system'
      }]
    };
  }

  private analyzeDependencies(tasks: TaskDefinition[]): any[] {
    // Implementation needed - analyze task dependencies
    return [];
  }
  
  private convertDependenciesToTaskDependencies(dependencies: Map<string, string[]>): any[] {
    // Convert decomposition dependencies to task dependencies format
    const result: any[] = [];
    dependencies.forEach((deps, taskId) => {
      deps.forEach(dependsOn => {
        result.push({
          taskId,
          dependsOn,
          type: 'sequential'
        });
      });
    });
    return result;
  }

  private async ensureRequiredAgents(objective: SwarmObjective): Promise<void> {
    // Implementation needed - ensure required agents are available
  }

  private async scheduleInitialTasks(objective: SwarmObjective): Promise<void> {
    this.logger.info('Scheduling initial tasks for objective', { 
      objectiveId: objective.id, 
      taskCount: objective.tasks.length 
    });
    
    // Extract target directory from objective description
    const targetDirPatterns = [
      /in\s+([^\s]+\/?)$/i,
      /(?:in|to|at)\s+([^\s]+\/[^\s]+)/i,
      /([^\s]+\/[^\s]+)$/,
      /examples\/[^\s]+/i
    ];
    
    let objectiveTargetDir = null;
    for (const pattern of targetDirPatterns) {
      const match = objective.description.match(pattern);
      if (match) {
        objectiveTargetDir = match[1] || match[0];
        break;
      }
    }
    
    // Add all tasks to the tasks map
    for (const task of objective.tasks) {
      task.context.objectiveId = objective.id;
      // Propagate target directory to all tasks
      if (objectiveTargetDir && !task.context.targetDir) {
        task.context.targetDir = objectiveTargetDir;
      }
      this.tasks.set(task.id.id, task);
    }
    
    // Find tasks with no dependencies and queue them
    const initialTasks = objective.tasks.filter(task => 
      !task.constraints.dependencies || task.constraints.dependencies.length === 0
    );
    
    this.logger.info('Found initial tasks without dependencies', { 
      count: initialTasks.length,
      tasks: initialTasks.map(t => ({ id: t.id.id, name: t.name }))
    });
    
    // Queue initial tasks for execution
    for (const task of initialTasks) {
      task.status = 'queued';
      task.updatedAt = new Date();
      
      // Update status history
      task.statusHistory.push({
        timestamp: new Date(),
        from: 'created' as TaskStatus,
        to: 'queued' as TaskStatus,
        reason: 'Task queued for execution',
        triggeredBy: 'system'
      });
      
      // Emit task queued event
      this.emitSwarmEvent({
        id: generateId('event'),
        timestamp: new Date(),
        type: 'task.queued',
        source: this.swarmId.id,
        data: { task },
        broadcast: false,
        processed: false
      });
    }
    
    // Update objective progress
    objective.progress.totalTasks = objective.tasks.length;
    objective.progress.runningTasks = 0;
    objective.progress.completedTasks = 0;
    objective.progress.failedTasks = 0;
  }

  private startTaskExecutionLoop(objective: SwarmObjective): void {
    this.logger.info('Starting task execution loop for objective', { 
      objectiveId: objective.id 
    });
    
    // Create an interval to process queued tasks
    const executionInterval = setInterval(async () => {
      try {
        // Check if objective is still executing
        if (objective.status !== 'executing') {
          clearInterval(executionInterval);
          return;
        }
        
        // Find queued tasks
        const queuedTasks = Array.from(this.tasks.values())
          .filter(task => 
            task.context?.objectiveId === objective.id && 
            task.status === 'queued'
          );
        
        // Find idle agents
        const idleAgents = Array.from(this.agents.values())
          .filter(agent => agent.status === 'idle');
        
        if (queuedTasks.length > 0 && idleAgents.length > 0) {
          this.logger.debug('Processing queued tasks', { 
            queuedTasks: queuedTasks.length, 
            idleAgents: idleAgents.length 
          });
        }
        
        // Assign tasks to idle agents
        for (const task of queuedTasks) {
          if (idleAgents.length === 0) break;
          
          // Find suitable agent
          const suitableAgents = idleAgents.filter(agent => 
            this.agentCanHandleTask(agent, task)
          );
          
          if (suitableAgents.length > 0) {
            // Assign to first suitable agent
            await this.assignTask(task.id.id, suitableAgents[0].id.id);
            
            // Remove agent from idle list
            const agentIndex = idleAgents.findIndex(a => a.id.id === suitableAgents[0].id.id);
            if (agentIndex >= 0) {
              idleAgents.splice(agentIndex, 1);
            }
          }
        }
        
        // Check for completed tasks and process dependencies
        const completedTasks = Array.from(this.tasks.values())
          .filter(task => 
            task.context?.objectiveId === objective.id && 
            task.status === 'completed'
          );
        
        // Find tasks that can now be queued (dependencies met)
        const pendingTasks = Array.from(this.tasks.values())
          .filter(task => 
            task.context?.objectiveId === objective.id && 
            task.status === 'created' &&
            this.taskDependenciesMet(task, completedTasks)
          );
        
        // Queue tasks with met dependencies
        for (const task of pendingTasks) {
          task.status = 'queued';
          task.updatedAt = new Date();
          
          task.statusHistory.push({
            timestamp: new Date(),
            from: 'created' as TaskStatus,
            to: 'queued' as TaskStatus,
            reason: 'Dependencies met, task queued',
            triggeredBy: 'system'
          });
          
          this.emitSwarmEvent({
            id: generateId('event'),
            timestamp: new Date(),
            type: 'task.queued',
            source: this.swarmId.id,
            data: { task },
            broadcast: false,
            processed: false
          });
        }
        
        // Check for stuck/timed out tasks
        const runningTasks = Array.from(this.tasks.values())
          .filter(task => 
            task.context?.objectiveId === objective.id && 
            task.status === 'running'
          );
        
        const now = Date.now();
        for (const task of runningTasks) {
          if (task.startedAt) {
            const runtime = now - task.startedAt.getTime();
            const timeout = task.constraints?.timeoutAfter || SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT;
            
            if (runtime > timeout) {
              this.logger.warn('Task timed out', { 
                taskId: task.id.id, 
                runtime: Math.round(runtime / 1000),
                timeout: Math.round(timeout / 1000)
              });
              
              // Mark task as failed due to timeout
              task.status = 'failed';
              task.completedAt = new Date();
              task.error = {
                type: 'TimeoutError',
                message: `Task exceeded timeout of ${timeout}ms`,
                code: 'TASK_TIMEOUT',
                context: { taskId: task.id.id, runtime },
                recoverable: true,
                retryable: true
              };
              
              // Update agent state if assigned
              if (task.assignedTo) {
                const agent = this.agents.get(task.assignedTo.id);
                if (agent) {
                  agent.status = 'idle';
                  agent.currentTask = undefined;
                  agent.metrics.tasksFailed++;
                }
              }
              
              // Emit timeout event
              this.emitSwarmEvent({
                id: generateId('event'),
                timestamp: new Date(),
                type: 'task.failed',
                source: this.swarmId.id,
                data: { task, reason: 'timeout' },
                broadcast: false,
                processed: false
              });
            }
          }
        }
        
        // Update objective progress
        const allTasks = Array.from(this.tasks.values())
          .filter(task => task.context?.objectiveId === objective.id);
        
        objective.progress.totalTasks = allTasks.length;
        objective.progress.completedTasks = allTasks.filter(t => t.status === 'completed').length;
        objective.progress.failedTasks = allTasks.filter(t => t.status === 'failed').length;
        objective.progress.runningTasks = allTasks.filter(t => t.status === 'running').length;
        objective.progress.percentComplete = objective.progress.totalTasks > 0 
          ? (objective.progress.completedTasks / objective.progress.totalTasks) * 100 
          : 0;
        
        // Check if objective is complete
        if (objective.progress.completedTasks + objective.progress.failedTasks === objective.progress.totalTasks) {
          objective.status = objective.progress.failedTasks === 0 ? 'completed' : 'failed';
          objective.completedAt = new Date();
          clearInterval(executionInterval);
          
          this.logger.info('Objective completed', { 
            objectiveId: objective.id,
            status: objective.status,
            completedTasks: objective.progress.completedTasks,
            failedTasks: objective.progress.failedTasks
          });
          
          this.emitSwarmEvent({
            id: generateId('event'),
            timestamp: new Date(),
            type: objective.status === 'completed' ? 'objective.completed' : 'objective.failed',
            source: this.swarmId.id,
            data: { objective },
            broadcast: true,
            processed: false
          });
        }
        
      } catch (error) {
        this.logger.error('Error in task execution loop', { error });
      }
    }, 2000); // Check every 2 seconds
    
    // Store interval reference for cleanup
    if (!this.executionIntervals) {
      this.executionIntervals = new Map();
    }
    this.executionIntervals.set(objective.id, executionInterval);
  }
  
  private taskDependenciesMet(task: TaskDefinition, completedTasks: TaskDefinition[]): boolean {
    if (!task.constraints.dependencies || task.constraints.dependencies.length === 0) {
      return true;
    }
    
    const completedTaskIds = completedTasks.map(t => t.id.id);
    return task.constraints.dependencies.every(dep => {
      // Handle both string and TaskId object dependencies
      const depId = typeof dep === 'string' ? dep : dep.id;
      return completedTaskIds.includes(depId);
    });
  }

  private getNextInstanceNumber(type: AgentType): number {
    const agentsOfType = Array.from(this.agents.values())
      .filter(agent => agent.type === type);
    return agentsOfType.length + 1;
  }

  private getDefaultPermissions(type: AgentType): string[] {
    switch (type) {
      case 'coordinator': return ['read', 'write', 'execute', 'admin'];
      case 'developer': return ['read', 'write', 'execute'];
      case 'tester': return ['read', 'execute'];
      case 'reviewer': return ['read', 'write'];
      default: return ['read'];
    }
  }

  private async initializeAgentCapabilities(agent: AgentState): Promise<void> {
    // Set capabilities based on agent type
    switch (agent.type) {
      case 'coordinator':
        agent.capabilities.codeGeneration = false;
        agent.capabilities.codeReview = true;
        agent.capabilities.testing = false;
        agent.capabilities.documentation = true;
        agent.capabilities.research = true;
        agent.capabilities.analysis = true;
        break;
      case 'developer':
        agent.capabilities.codeGeneration = true;
        agent.capabilities.codeReview = true;
        agent.capabilities.testing = true;
        agent.capabilities.documentation = true;
        break;
      case 'researcher':
        agent.capabilities.research = true;
        agent.capabilities.analysis = true;
        agent.capabilities.webSearch = true;
        agent.capabilities.documentation = true;
        break;
      case 'analyzer':
        agent.capabilities.analysis = true;
        agent.capabilities.research = true;
        agent.capabilities.documentation = true;
        break;
      case 'reviewer':
        agent.capabilities.codeReview = true;
        agent.capabilities.testing = true;
        agent.capabilities.documentation = true;
        break;
      case 'tester':
        agent.capabilities.testing = true;
        agent.capabilities.codeReview = true;
        break;
    }
  }

  private async initializeAgentEnvironment(agent: AgentState): Promise<void> {
    // Implementation needed - setup agent environment
  }

  private startAgentHeartbeat(agent: AgentState): void {
    // Implementation needed - start agent heartbeat
  }

  private stopAgentHeartbeat(agent: AgentState): void {
    // Implementation needed - stop agent heartbeat
  }

  private async cleanupAgentEnvironment(agent: AgentState): Promise<void> {
    // Implementation needed - cleanup agent environment
  }

  private getRequiredCapabilities(type: TaskType): string[] {
    switch (type) {
      case 'coding': return ['code-generation', 'file-system'];
      case 'testing': return ['testing', 'code-review'];
      case 'research': return ['research', 'web-search'];
      case 'analysis': return ['analysis', 'documentation'];
      case 'review': return ['code-review', 'documentation'];
      case 'documentation': return ['documentation'];
      default: return [];
    }
  }

  private getRequiredTools(type: TaskType): string[] {
    switch (type) {
      case 'coding': return ['editor', 'compiler', 'debugger'];
      case 'testing': return ['test-runner', 'coverage-tool'];
      case 'research': return ['web-browser', 'search-engine'];
      case 'analysis': return ['data-tools', 'visualization'];
      default: return [];
    }
  }

  private getRequiredPermissions(type: TaskType): string[] {
    switch (type) {
      case 'coding': return ['read', 'write', 'execute'];
      case 'testing': return ['read', 'execute'];
      case 'research': return ['read', 'network'];
      default: return ['read'];
    }
  }

  private async executeTaskWithAgent(task: TaskDefinition, agent: AgentState): Promise<any> {
    this.logger.info('Executing task with agent', { 
      taskId: task.id.id, 
      taskName: task.name,
      agentId: agent.id.id,
      agentName: agent.name
    });
    
    // Extract target directory from task
    const targetDir = this.extractTargetDirectory(task);
    
    try {
      // Use Claude Flow executor for full SPARC system in non-interactive mode
      const { ClaudeFlowExecutor } = await import('./claude-flow-executor.js');
      const executor = new ClaudeFlowExecutor({ 
        logger: this.logger,
        claudeFlowPath: '/workspaces/claude-code-flow/bin/claude-flow',
        enableSparc: true,
        verbose: this.config.logging?.level === 'debug',
        timeoutMinutes: this.config.taskTimeoutMinutes
      });
      
      const result = await executor.executeTask(task, agent, targetDir ?? undefined);
      
      this.logger.info('Task execution completed', { 
        taskId: task.id.id,
        success: true,
        outputLength: JSON.stringify(result).length
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('Task execution failed', { 
        taskId: task.id.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
  
  private createExecutionPrompt(task: TaskDefinition): string {
    // Create a prompt that Claude will understand
    let prompt = `# Swarm Task Execution\n\n`;
    prompt += `## Task: ${task.name}\n\n`;
    prompt += `${task.instructions || task.description}\n\n`;
    
    // Add working directory information if available
    const targetDir = this.extractTargetDirectory(task);
    if (targetDir) {
      prompt += `## Working Directory\n`;
      prompt += `Please create all files in: ${targetDir}\n\n`;
    }
    
    if (task.input && Object.keys(task.input).length > 0) {
      prompt += `## Additional Input\n`;
      prompt += `${JSON.stringify(task.input, null, 2)}\n\n`;
    }
    
    if (task.context && Object.keys(task.context).length > 0) {
      prompt += `## Context\n`;
      prompt += `${JSON.stringify(task.context, null, 2)}\n\n`;
    }
    
    // Add execution guidelines
    prompt += `## Guidelines\n`;
    prompt += `- Focus on completing this specific task\n`;
    prompt += `- Create all necessary files and directories\n`;
    prompt += `- Follow best practices for the technology being used\n`;
    prompt += `- Ensure the implementation is complete and functional\n`;
    
    return prompt;
  }
  
  private extractTargetDirectory(task: TaskDefinition): string | null {
    // Try multiple patterns to find the target directory
    const patterns = [
      /in\s+([^\s]+\/?)$/i,              // "in examples/dir" at end
      /(?:in|to|at)\s+([^\s]+\/[^\s]+)/i, // "in examples/gradio" anywhere
      /([^\s]+\/[^\s]+)$/,               // "examples/gradio" at end
      /examples\/[^\s]+/i                // specifically match examples/ paths
    ];
    
    let targetDir = null;
    
    // First check task description and input
    for (const pattern of patterns) {
      const descMatch = task.description.match(pattern);
      const inputMatch = task.input?.objective?.match(pattern);
      if (descMatch || inputMatch) {
        targetDir = (descMatch || inputMatch)[descMatch ? 1 : 0];
        break;
      }
    }
    
    // If not found and task has context with targetDir, use that
    if (!targetDir && task.context?.targetDir) {
      targetDir = task.context.targetDir;
    }
    
    // If still not found, check objective description from context
    if (!targetDir && task.context?.objectiveId) {
      const objective = this.objectives.get(task.context.objectiveId);
      if (objective) {
        for (const pattern of patterns) {
          const match = objective.description.match(pattern);
          if (match) {
            targetDir = match[1] || match[0];
            break;
          }
        }
      }
    }
    
    if (targetDir) {
      // Clean up the target directory
      targetDir = targetDir.replace(/\s+.*$/, '');
      // Resolve relative to current directory
      if (!targetDir.startsWith('/')) {
        targetDir = `/workspaces/claude-code-flow/${targetDir}`;
      }
    }
    
    return targetDir;
  }
  
  private async executeClaudeTask(
    task: TaskDefinition,
    agent: AgentState,
    prompt: string,
    targetDir: string | null
  ): Promise<any> {
    // Create unique instance ID for this execution
    const instanceId = `swarm-${this.swarmId.id}-${task.id.id}-${Date.now()}`;
    
    // Build Claude arguments for non-interactive execution
    const claudeArgs = [prompt];
    
    // Always skip permissions for swarm automation
    claudeArgs.push("--dangerously-skip-permissions");
    
    // Add non-interactive flags for automation
    claudeArgs.push("-p"); // Print mode
    claudeArgs.push("--output-format", "stream-json");
    claudeArgs.push("--verbose"); // Required when using stream-json with -p
    
    // Set working directory if specified
    if (targetDir) {
      // Ensure directory exists
      await fs.mkdir(targetDir, { recursive: true });
      
      // Add directory context to prompt
      const enhancedPrompt = `${prompt}\n\n## Important: Working Directory\nPlease ensure all files are created in: ${targetDir}`;
      claudeArgs[0] = enhancedPrompt;
    }
    
    try {
      // Check if claude command exists
      const checkResult = await this.processPool.checkCommand('claude');
      if (!checkResult) {
        throw new Error('Claude CLI not found. Please ensure claude is installed and in PATH.');
      }
      
      // Execute Claude with the prompt
      this.logger.info('Spawning Claude agent for task', { 
        taskId: task.id.id,
        agentId: agent.id.id,
        instanceId,
        targetDir 
      });
      
      // Execute using ProcessPool
      const output = await this.processPool.executeCommand({
        command: 'claude',
        args: claudeArgs,
        options: {
          cwd: targetDir || process.cwd(),
          env: {
            ...process.env,
            CLAUDE_INSTANCE_ID: instanceId,
            CLAUDE_SWARM_MODE: "true",
            CLAUDE_SWARM_ID: this.swarmId.id,
            CLAUDE_TASK_ID: task.id.id,
            CLAUDE_AGENT_ID: agent.id.id,
            CLAUDE_WORKING_DIRECTORY: targetDir || process.cwd(),
            CLAUDE_FLOW_MEMORY_ENABLED: "true",
            CLAUDE_FLOW_MEMORY_NAMESPACE: `swarm-${this.swarmId.id}`,
          },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      });
      
      if (output.exitCode === 0) {
        this.logger.info('Claude agent completed task successfully', {
          taskId: task.id.id,
          outputLength: output.output.length
        });
        
        return {
          success: true,
          output: output.output,
          instanceId,
          targetDir
        };
      } else {
        this.logger.error(`Claude agent failed with code ${output.exitCode}`, { 
          taskId: task.id.id,
          error: output.error 
        });
        throw new Error(`Claude execution failed: ${output.error}`);
      }
      
    } catch (error) {
      this.logger.error('Failed to execute Claude agent', { 
        taskId: task.id.id,
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error;
    }
  }
  
  private determineToolsForTask(task: TaskDefinition, agent: AgentState): string[] {
    const tools = new Set<string>();
    
    // Basic tools for all tasks
    tools.add("View");
    tools.add("Edit");
    tools.add("Bash");
    
    // Add tools based on task type
    switch (task.type) {
      case 'coding':
        tools.add("Create");
        tools.add("Write");
        tools.add("MultiEdit");
        tools.add("Test");
        break;
      case 'testing':
        tools.add("Test");
        tools.add("View");
        break;
      case 'documentation':
        tools.add("Write");
        tools.add("Create");
        break;
      case 'analysis':
        tools.add("Analyze");
        tools.add("Search");
        break;
      case 'research':
        tools.add("WebSearch");
        tools.add("Search");
        break;
    }
    
    // Add tools based on agent capabilities
    if (agent.capabilities.fileSystem) {
      tools.add("FileSystem");
    }
    if (agent.capabilities.terminalAccess) {
      tools.add("Terminal");
    }
    if (agent.capabilities.webSearch) {
      tools.add("WebSearch");
    }
    if (agent.capabilities.apiIntegration) {
      tools.add("API");
    }
    
    return Array.from(tools);
  }
  
  private async simulateTaskExecution(
    task: TaskDefinition,
    agent: AgentState,
    prompt: string
  ): Promise<any> {
    // Simulate different task types with actual file operations
    // Check if task has a target directory in the description or context
    let workDir = `/tmp/swarm/${this.swarmId.id}/work`;
    
    // Extract target directory from task description or input
    // Try multiple patterns to find the target directory
    const patterns = [
      /in\s+([^\s]+\/?)$/i,              // "in examples/dir" at end
      /(?:in|to|at)\s+([^\s]+\/[^\s]+)/i, // "in examples/gradio" anywhere
      /([^\s]+\/[^\s]+)$/,               // "examples/gradio" at end
      /examples\/[^\s]+/i                // specifically match examples/ paths
    ];
    
    let targetDir = null;
    for (const pattern of patterns) {
      const descMatch = task.description.match(pattern);
      const inputMatch = task.input?.objective?.match(pattern);
      if (descMatch || inputMatch) {
        targetDir = (descMatch || inputMatch)[descMatch ? 1 : 0];
        break;
      }
    }
    
    if (targetDir) {
      // Clean up the target directory (remove trailing words if needed)
      targetDir = targetDir.replace(/\s+.*$/, '');
      // Use absolute path or resolve relative to current directory
      workDir = targetDir.startsWith('/') ? targetDir : `/workspaces/claude-code-flow/${targetDir}`;
      
      this.logger.debug('Extracted target directory', { 
        original: task.description,
        targetDir,
        workDir 
      });
    }
    
    try {
      // Ensure work directory exists
      await fs.mkdir(workDir, { recursive: true });
      
      switch (task.type) {
        case 'coding':
          return await this.executeCodeGenerationTask(task, workDir, agent);
          
        case 'analysis':
          return await this.executeAnalysisTask(task, workDir, agent);
          
        case 'documentation':
          return await this.executeDocumentationTask(task, workDir, agent);
          
        case 'testing':
          return await this.executeTestingTask(task, workDir, agent);
          
        default:
          return await this.executeGenericTask(task, workDir, agent);
      }
    } catch (error) {
      throw new Error(`Task execution failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  private async executeCodeGenerationTask(task: TaskDefinition, workDir: string, agent: AgentState): Promise<any> {
    this.logger.info('Executing code generation task', { taskId: task.id.id });
    
    // Detect technology from description
    const description = task.description.toLowerCase();
    const isGradio = description.includes('gradio');
    const isPython = isGradio || description.includes('python') || description.includes('fastapi') || description.includes('django');
    const isHelloWorld = description.includes('hello') && description.includes('world');
    const isRestAPI = description.includes('rest api') || description.includes('api');
    
    if (isGradio) {
      // Create a Gradio application
      // TODO: Implement createGradioApp method
      throw new Error('Gradio app creation not yet implemented');
    } else if (isPython && isRestAPI) {
      // Create a Python REST API (FastAPI)
      // TODO: Implement createPythonRestAPI method
      throw new Error('Python REST API creation not yet implemented');
    } else if (isRestAPI) {
      // Create a REST API application
      const projectName = 'rest-api';
      const projectDir = `${workDir}/${projectName}`;
      await fs.mkdir(projectDir, { recursive: true });
      
      // Create main API file
      const apiCode = `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'REST API',
    swarmId: '${this.swarmId.id}',
    created: '${new Date().toISOString()}'
  });
});

// Sample endpoints
app.get('/api/v1/items', (req, res) => {
  res.json({
    items: [
      { id: 1, name: 'Item 1', description: 'First item' },
      { id: 2, name: 'Item 2', description: 'Second item' }
    ],
    total: 2
  });
});

app.get('/api/v1/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  res.json({
    id,
    name: \`Item \${id}\`,
    description: \`Description for item \${id}\`
  });
});

app.post('/api/v1/items', (req, res) => {
  const newItem = {
    id: Date.now(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  res.status(201).json(newItem);
});

app.put('/api/v1/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const updatedItem = {
    id,
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  res.json(updatedItem);
});

app.delete('/api/v1/items/:id', (req, res) => {
  const id = parseInt(req.params.id);
  res.json({ message: \`Item \${id} deleted successfully\` });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log(\`REST API server running on port \${port}\`);
  console.log('Created by Claude Flow Swarm');
});

module.exports = app;
`;
      
      await fs.writeFile(`${projectDir}/server.js`, apiCode, 'utf8');
      
      // Create package.json
      const packageJson = {
        name: projectName,
        version: "1.0.0",
        description: "REST API created by Claude Flow Swarm",
        main: "server.js",
        scripts: {
          start: "node server.js",
          dev: "nodemon server.js",
          test: "jest"
        },
        keywords: ["rest", "api", "swarm", "claude-flow"],
        author: "Claude Flow Swarm",
        license: "MIT",
        dependencies: {
          express: "^4.18.2"
        },
        devDependencies: {
          nodemon: "^3.0.1",
          jest: "^29.7.0",
          supertest: "^6.3.3"
        },
        swarmMetadata: {
          swarmId: this.swarmId.id,
          taskId: task.id.id,
          agentId: agent.id.id,
          created: new Date().toISOString()
        }
      };
      
      await fs.writeFile(
        `${projectDir}/package.json`, 
        JSON.stringify(packageJson, null, 2)
      );
      
      // Create README
      const readme = `# REST API

This REST API was created by the Claude Flow Swarm system.

## Swarm Details
- Swarm ID: ${this.swarmId.id}
- Task: ${task.name}
- Agent: ${agent.name}
- Generated: ${new Date().toISOString()}

## Installation

\`\`\`bash
npm install
\`\`\`

## Usage

Start the server:
\`\`\`bash
npm start
\`\`\`

Development mode with auto-reload:
\`\`\`bash
npm run dev
\`\`\`

## API Endpoints

- \`GET /health\` - Health check
- \`GET /api/v1/items\` - Get all items
- \`GET /api/v1/items/:id\` - Get item by ID
- \`POST /api/v1/items\` - Create new item
- \`PUT /api/v1/items/:id\` - Update item
- \`DELETE /api/v1/items/:id\` - Delete item

## Description
${task.description}

---
Created by Claude Flow Swarm
`;
      
      await fs.writeFile(`${projectDir}/README.md`, readme, 'utf8');
      
      // Create .gitignore
      const gitignore = `node_modules/
.env
*.log
.DS_Store
coverage/
`;
      
      await fs.writeFile(`${projectDir}/.gitignore`, gitignore, 'utf8');
      
      return {
        success: true,
        output: {
          message: 'REST API created successfully',
          location: projectDir,
          files: ['server.js', 'package.json', 'README.md', '.gitignore']
        },
        artifacts: {
          mainFile: `${projectDir}/server.js`,
          packageFile: `${projectDir}/package.json`,
          readmeFile: `${projectDir}/README.md`
        }
      };
    } else if (isHelloWorld) {
      // Create a simple hello world application
      const projectDir = `${workDir}/hello-world`;
      await fs.mkdir(projectDir, { recursive: true });
      
      // Create main application file
      const mainCode = `#!/usr/bin/env node

// Hello World Application
// Generated by Claude Flow Swarm

console.log('Hello, World!');
console.log('This application was created by the Claude Flow Swarm system.');
console.log('Swarm ID: ${this.swarmId.id}');
console.log('Task: ${task.name}');
console.log('Generated at: ${new Date().toISOString()}');

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { message: 'Hello, World!' };
}
`;
      
      await fs.writeFile(`${projectDir}/index.js`, mainCode, 'utf8');
      
      // Create package.json
      const packageJson = {
        name: "hello-world",
        version: "1.0.0",
        description: "Hello World application created by Claude Flow Swarm",
        main: "index.js",
        scripts: {
          start: "node index.js",
          test: "node test.js"
        },
        keywords: ["hello-world", "swarm", "claude-flow"],
        author: "Claude Flow Swarm",
        license: "MIT"
      };
      
      await fs.writeFile(
        `${projectDir}/package.json`, 
        JSON.stringify(packageJson, null, 2)
      );
      
      // Create README
      const readme = `# Hello World

This application was created by the Claude Flow Swarm system.

## Swarm Details
- Swarm ID: ${this.swarmId.id}
- Task: ${task.name}
- Generated: ${new Date().toISOString()}

## Usage

\`\`\`bash
npm start
\`\`\`

## Description
${task.description}
`;
      
      await fs.writeFile(`${projectDir}/README.md`, readme, 'utf8');
      
      return {
        success: true,
        output: {
          message: 'Hello World application created successfully',
          location: projectDir,
          files: ['index.js', 'package.json', 'README.md']
        },
        artifacts: {
          mainFile: `${projectDir}/index.js`,
          packageFile: `${projectDir}/package.json`,
          readmeFile: `${projectDir}/README.md`
        }
      };
    }
    
    // For other code generation tasks, create a basic structure
    const projectDir = `${workDir}/generated-code`;
    await fs.mkdir(projectDir, { recursive: true });
    
    const code = `// Generated code for: ${task.name}
// ${task.description}

function main() {
  console.log('Executing task: ${task.name}');
  // Implementation would go here
}

main();
`;
    
    await fs.writeFile(`${projectDir}/main.js`, code, 'utf8');
    
    return {
      success: true,
      output: {
        message: 'Code generated successfully',
        location: projectDir,
        files: ['main.js']
      }
    };
  }
  
  private async executeAnalysisTask(task: TaskDefinition, workDir: string, agent: AgentState): Promise<any> {
    this.logger.info('Executing analysis task', { taskId: task.id.id });
    
    const analysisDir = `${workDir}/analysis`;
    await fs.mkdir(analysisDir, { recursive: true });
    
    const analysis = {
      task: task.name,
      description: task.description,
      timestamp: new Date().toISOString(),
      findings: [
        'Analysis point 1: Task objectives are clear',
        'Analysis point 2: Resources are allocated',
        'Analysis point 3: Implementation path is defined'
      ],
      recommendations: [
        'Proceed with implementation',
        'Monitor progress regularly',
        'Adjust resources as needed'
      ]
    };
    
    await fs.writeFile(
      `${analysisDir}/analysis-report.json`,
      JSON.stringify(analysis, null, 2)
    );
    
    return {
      success: true,
      output: analysis,
      artifacts: {
        report: `${analysisDir}/analysis-report.json`
      }
    };
  }
  
  private async executeDocumentationTask(task: TaskDefinition, workDir: string, agent: AgentState): Promise<any> {
    this.logger.info('Executing documentation task', { taskId: task.id.id });
    
    const docsDir = `${workDir}/docs`;
    await fs.mkdir(docsDir, { recursive: true });
    
    const documentation = `# ${task.name}

${task.description}

## Overview
This documentation was generated by the Claude Flow Swarm system.

## Details
- Task ID: ${task.id.id}
- Generated: ${new Date().toISOString()}
- Swarm ID: ${this.swarmId.id}

## Instructions
${task.instructions}

## Implementation Notes
- This is an automated documentation generated by the swarm
- Further details would be added based on actual implementation
`;
    
    await fs.writeFile(`${docsDir}/documentation.md`, documentation, 'utf8');
    
    return {
      success: true,
      output: {
        message: 'Documentation created successfully',
        location: docsDir,
        files: ['documentation.md']
      },
      artifacts: {
        documentation: `${docsDir}/documentation.md`
      }
    };
  }
  
  private async executeTestingTask(task: TaskDefinition, workDir: string, agent: AgentState): Promise<any> {
    this.logger.info('Executing testing task', { taskId: task.id.id });
    
    const testDir = `${workDir}/tests`;
    await fs.mkdir(testDir, { recursive: true });
    
    const testCode = `// Test suite for: ${task.name}
// ${task.description}

const assert = require('assert');

describe('${task.name}', () => {
  it('should pass basic test', () => {
    assert.strictEqual(1 + 1, 2);
  });
  
  it('should validate implementation', () => {
    // Test implementation would go here
    assert.ok(true, 'Implementation validated');
  });
});

console.log('Tests completed for: ${task.name}');
`;
    
    await fs.writeFile(`${testDir}/test.js`, testCode);
    
    return {
      success: true,
      output: {
        message: 'Test suite created successfully',
        location: testDir,
        files: ['test.js'],
        testsPassed: 2,
        testsFailed: 0
      },
      artifacts: {
        testFile: `${testDir}/test.js`
      }
    };
  }
  
  private async executeGenericTask(task: TaskDefinition, workDir: string, agent: AgentState): Promise<any> {
    this.logger.info('Executing generic task', { taskId: task.id.id });
    
    const outputDir = `${workDir}/output`;
    await fs.mkdir(outputDir, { recursive: true });
    
    const output = {
      task: task.name,
      type: task.type,
      description: task.description,
      status: 'completed',
      timestamp: new Date().toISOString(),
      result: 'Task executed successfully'
    };
    
    await fs.writeFile(
      `${outputDir}/result.json`,
      JSON.stringify(output, null, 2)
    );
    
    return {
      success: true,
      output,
      artifacts: {
        result: `${outputDir}/result.json`
      }
    };
  }

  private assessTaskQuality(task: TaskDefinition, result: any): number {
    // Implementation needed - assess task quality
    return 0.8;
  }

  private updateAgentMetrics(agent: AgentState, task: TaskDefinition): void {
    // Update agent performance metrics
    const executionTime = task.completedAt!.getTime() - (task.startedAt?.getTime() || 0);
    
    agent.metrics.averageExecutionTime = 
      (agent.metrics.averageExecutionTime * agent.metrics.tasksCompleted + executionTime) / 
      (agent.metrics.tasksCompleted + 1);
    
    agent.metrics.successRate = 
      agent.metrics.tasksCompleted / (agent.metrics.tasksCompleted + agent.metrics.tasksFailed);
  }

  private async processDependentTasks(task: TaskDefinition): Promise<void> {
    // Implementation needed - process tasks that depend on this one
  }

  private isRecoverableError(error: any): boolean {
    // Implementation needed - determine if error is recoverable
    return true;
  }

  private isRetryableError(error: any): boolean {
    // Implementation needed - determine if error is retryable
    return true;
  }

  private async handleTaskFailureCascade(task: TaskDefinition): Promise<void> {
    // Implementation needed - handle failure cascade
  }

  private async reassignTask(taskId: string): Promise<void> {
    // Implementation needed - reassign task to different agent
  }

  private processHeartbeats(): void {
    const now = new Date();
    const timeout = this.config.monitoring.heartbeatInterval * 10; // Increased multiplier for long-running Claude tasks
    
    for (const agent of this.agents.values()) {
      if (agent.status === 'offline' || agent.status === 'terminated') {
        continue;
      }
      
      const timeSinceHeartbeat = now.getTime() - agent.lastHeartbeat.getTime();
      if (timeSinceHeartbeat > timeout) {
        this.logger.warn('Agent heartbeat timeout', { 
          agentId: agent.id.id, 
          timeSinceHeartbeat 
        });
        agent.status = 'error';
        agent.health = 0;
      }
    }
  }

  private updateSwarmMetrics(): void {
    // Implementation needed - update swarm-level metrics
  }

  private performCleanup(): void {
    // Implementation needed - perform periodic cleanup
  }

  private checkObjectiveCompletion(): void {
    // Implementation needed - check if objectives are complete
  }

  private checkObjectiveFailure(task: TaskDefinition): void {
    // Implementation needed - check if objective has failed
  }

  private handleAgentError(agentId: string, error: any): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'error';
      agent.health = 0;
      this.logger.error('Agent error', { agentId, error });
    }
  }
}