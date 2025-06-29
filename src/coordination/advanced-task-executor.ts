/**
 * Advanced task executor with timeout handling, retry logic, and resource management
 */

import { EventEmitter } from 'node:events';
import { ChildProcess } from 'node:child_process';
import { TaskDefinition, TaskResult, TaskStatus, AgentState, TaskError } from '../swarm/types.js';
import { ProcessCommand, ProcessResult, IProcessExecutor as ProcessExecutor } from '../swarm/executor.js';
import { ILogger } from '../core/logger.js';
import { IEventBus } from '../core/event-bus.js';
import { CircuitBreaker, CircuitBreakerManager } from './circuit-breaker.js';
import { generateId } from '../utils/helpers.js';

export interface TaskExecutorConfig {
  maxConcurrentTasks: number;
  defaultTimeout: number;
  retryAttempts: number;
  retryBackoffBase: number;
  retryBackoffMax: number;
  resourceLimits: {
    memory: number;
    cpu: number;
    disk: number;
  };
  enableCircuitBreaker: boolean;
  enableResourceMonitoring: boolean;
  killTimeout: number;
}

export interface ExecutionContext {
  taskId: string;
  agentId: string;
  process?: ChildProcess;
  startTime: Date;
  timeout?: NodeJS.Timeout;
  resources: ResourceUsage;
  circuitBreaker?: CircuitBreaker;
}

export interface ResourceUsage {
  memory: number;
  cpu: number;
  disk: number;
  network: number;
  lastUpdated: Date;
}

export interface TaskExecutionResult {
  success: boolean;
  result?: TaskResult;
  error?: TaskError;
  executionTime: number;
  resourcesUsed: ResourceUsage;
  retryCount: number;
}

/**
 * Advanced task executor with comprehensive timeout and resource management
 */
export class AdvancedTaskExecutor extends EventEmitter {
  private logger: ILogger;
  private eventBus: IEventBus;
  private config: TaskExecutorConfig;
  private runningTasks = new Map<string, ExecutionContext>();
  private circuitBreakerManager: CircuitBreakerManager;
  private processExecutor: ProcessExecutor;
  private resourceMonitor?: NodeJS.Timeout;
  private queuedTasks: TaskDefinition[] = [];
  private isShuttingDown = false;

  constructor(
    config: Partial<TaskExecutorConfig>,
    logger: ILogger,
    eventBus: IEventBus
  ) {
    super();
    this.logger = logger;
    this.eventBus = eventBus;
    
    this.config = {
      maxConcurrentTasks: 10,
      defaultTimeout: 300000, // 5 minutes
      retryAttempts: 3,
      retryBackoffBase: 1000,
      retryBackoffMax: 30000,
      resourceLimits: {
        memory: 512 * 1024 * 1024, // 512MB
        cpu: 1.0, // 1 CPU core
        disk: 1024 * 1024 * 1024, // 1GB
      },
      enableCircuitBreaker: true,
      enableResourceMonitoring: true,
      killTimeout: 5000,
      ...config
    };

    // Initialize circuit breaker manager
    this.circuitBreakerManager = new CircuitBreakerManager(
      {
        failureThreshold: 5,
        successThreshold: 3,
        timeout: 60000, // 1 minute
        halfOpenLimit: 2,
      },
      this.logger,
      this.eventBus
    );

    // Initialize process executor
    this.processExecutor = new ProcessExecutor({
      maxConcurrentProcesses: this.config.maxConcurrentTasks,
      defaultTimeout: this.config.defaultTimeout
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle process events
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());

    // Handle circuit breaker events
    this.eventBus.on('circuitbreaker:state-change', (event) => {
      this.logger.info('Circuit breaker state changed', event);
      this.emit('circuit-breaker-changed', event);
    });
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing advanced task executor', {
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      defaultTimeout: this.config.defaultTimeout,
      resourceLimits: this.config.resourceLimits
    });

    if (this.config.enableResourceMonitoring) {
      this.startResourceMonitoring();
    }

    this.emit('executor-initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down task executor');
    this.isShuttingDown = true;

    // Stop resource monitoring
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
    }

    // Cancel all running tasks
    const cancelPromises = Array.from(this.runningTasks.values()).map(ctx =>
      this.cancelTask(ctx.taskId, 'Shutdown requested')
    );

    await Promise.all(cancelPromises);

    this.emit('executor-shutdown');
  }

  /**
   * Execute a task with comprehensive error handling and resource management
   */
  async executeTask(
    task: TaskDefinition,
    agent: AgentState,
    options: {
      timeout?: number;
      retryAttempts?: number;
      priority?: number;
    } = {}
  ): Promise<TaskExecutionResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = options.retryAttempts ?? this.config.retryAttempts;
    const timeout = options.timeout ?? this.config.defaultTimeout;

    this.logger.info('Starting task execution', {
      taskId: task.id.id,
      agentId: agent.id.id,
      type: task.type,
      timeout,
      maxRetries
    });

    // Check if we have capacity
    if (this.runningTasks.size >= this.config.maxConcurrentTasks) {
      this.queuedTasks.push(task);
      this.logger.info('Task queued due to capacity limits', {
        taskId: task.id.id,
        queueSize: this.queuedTasks.length
      });
      
      // Wait for capacity
      await this.waitForCapacity();
    }

    while (retryCount <= maxRetries) {
      try {
        const result = await this.executeSingleAttempt(task, agent, timeout, retryCount);
        
        this.logger.info('Task completed successfully', {
          taskId: task.id.id,
          executionTime: Date.now() - startTime,
          retryCount
        });

        return {
          success: true,
          result: result.result,
          executionTime: Date.now() - startTime,
          resourcesUsed: result.resourcesUsed,
          retryCount
        };

      } catch (error) {
        retryCount++;
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        this.logger.warn('Task attempt failed', {
          taskId: task.id.id,
          attempt: retryCount,
          maxRetries,
          error: errorMessage
        });

        // Check if we should retry
        if (retryCount > maxRetries) {
          const taskError: TaskError = {
            type: 'execution_failed',
            message: errorMessage,
            stack: errorStack,
            context: {
              retryCount,
              maxRetries,
              taskType: task.type
            },
            recoverable: false,
            retryable: false
          };

          return {
            success: false,
            error: taskError,
            executionTime: Date.now() - startTime,
            resourcesUsed: this.getDefaultResourceUsage(),
            retryCount
          };
        }

        // Calculate backoff delay
        const backoffDelay = Math.min(
          this.config.retryBackoffBase * Math.pow(2, retryCount - 1),
          this.config.retryBackoffMax
        );

        this.logger.info('Retrying task after backoff', {
          taskId: task.id.id,
          backoffDelay,
          attempt: retryCount + 1
        });

        await this.delay(backoffDelay);
      }
    }

    // This should never be reached, but TypeScript requires it
    throw new Error('Unexpected end of retry loop');
  }

  private async executeSingleAttempt(
    task: TaskDefinition,
    agent: AgentState,
    timeout: number,
    retryCount: number
  ): Promise<{ result: TaskResult; resourcesUsed: ResourceUsage }> {
    const executionContext: ExecutionContext = {
      taskId: task.id.id,
      agentId: agent.id.id,
      startTime: new Date(),
      resources: this.getDefaultResourceUsage()
    };

    this.runningTasks.set(task.id.id, executionContext);

    try {
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        executionContext.timeout = setTimeout(() => {
          reject(new Error(`Task timeout after ${timeout}ms`));
        }, timeout);
      });

      // Set up circuit breaker if enabled
      if (this.config.enableCircuitBreaker) {
        executionContext.circuitBreaker = this.circuitBreakerManager.getBreaker(
          `agent-${agent.id.id}`
        );
      }

      // Execute task with circuit breaker protection
      const executionPromise = this.config.enableCircuitBreaker && executionContext.circuitBreaker
        ? executionContext.circuitBreaker.execute(() => this.performTaskExecution(task, agent, executionContext))
        : this.performTaskExecution(task, agent, executionContext);

      // Race between execution and timeout
      const result = await Promise.race([executionPromise, timeoutPromise]);

      // Clear timeout
      if (executionContext.timeout) {
        clearTimeout(executionContext.timeout);
      }

      return result;

    } finally {
      // Cleanup
      this.runningTasks.delete(task.id.id);
      
      // Process queued tasks
      this.processQueuedTasks();
    }
  }

  private async performTaskExecution(
    task: TaskDefinition,
    agent: AgentState,
    context: ExecutionContext
  ): Promise<{ result: TaskResult; resourcesUsed: ResourceUsage }> {
    const startTime = Date.now();

    // Create task execution command
    const command = this.buildExecutionCommand(task, agent);
    
    this.logger.debug('Executing task command', {
      taskId: task.id.id,
      command: command.cmd,
      args: command.args
    });

    // Execute through unified process executor
    const processCommand: ProcessCommand = {
      command: command.cmd,
      args: command.args,
      env: {
        ...command.env,
        TASK_ID: task.id.id,
        AGENT_ID: agent.id.id,
        TASK_TYPE: task.type
      },
      input: task.input ? JSON.stringify({
        task: task,
        agent: agent,
        input: task.input
      }) : undefined,
      timeout: this.config.defaultTimeout
    };

    const processResult = await this.processExecutor.execute(processCommand);
    
    // Create mock process object for context compatibility
    context.process = {
      pid: processResult.pid,
      killed: false,
      kill: () => true
    } as any;

    const stdout = processResult.stdout;
    const stderr = processResult.stderr;
    const exitCode = processResult.exitCode;

    const executionTime = processResult.duration;

    // Parse result
    let taskResult: TaskResult;
    
    if (processResult.success && exitCode === 0) {
      try {
        const output = JSON.parse(stdout);
        taskResult = {
          output: output.result || output,
          artifacts: output.artifacts || {},
          metadata: output.metadata || {},
          quality: output.quality || 0.8,
          completeness: output.completeness || 1.0,
          accuracy: output.accuracy || 0.9,
          executionTime,
          resourcesUsed: {
            memory: context.resources.memory,
            cpu: context.resources.cpu,
            disk: context.resources.disk,
            network: context.resources.network
          },
          validated: false
        };
      } catch (error) {
        taskResult = {
          output: stdout,
          artifacts: {},
          metadata: { stderr },
          quality: 0.5,
          completeness: 1.0,
          accuracy: 0.7,
          executionTime,
          resourcesUsed: {
            memory: context.resources.memory,
            cpu: context.resources.cpu,
            disk: context.resources.disk,
            network: context.resources.network
          },
          validated: false
        };
      }
    } else {
      throw new Error(`Task execution failed with exit code ${exitCode}: ${stderr}`);
    }

    return {
      result: taskResult,
      resourcesUsed: context.resources
    };
  }

  private buildExecutionCommand(task: TaskDefinition, agent: AgentState): {
    cmd: string;
    args: string[];
    env: Record<string, string>;
  } {
    // This would be customized based on task type and agent capabilities
    // For now, return a default Claude execution command
    
    const cmd = 'deno';
    const args = [
      'run',
      '--allow-all',
      '--no-check',
      './src/cli/commands/task-executor.ts',
      '--task-type',
      task.type,
      '--agent-type',
      agent.type
    ];

    const env = {
      TASK_TIMEOUT: (task.constraints.timeoutAfter || this.config.defaultTimeout).toString(),
      MEMORY_LIMIT: this.config.resourceLimits.memory.toString(),
      CPU_LIMIT: this.config.resourceLimits.cpu.toString()
    };

    return { cmd, args, env };
  }

  private async cancelTask(taskId: string, reason: string): Promise<void> {
    const context = this.runningTasks.get(taskId);
    if (!context) {
      return;
    }

    this.logger.info('Cancelling task', { taskId, reason });

    // Clear timeout
    if (context.timeout) {
      clearTimeout(context.timeout);
    }

    // Kill process if running
    if (context.process && !context.process.killed) {
      context.process.kill('SIGTERM');

      // Force kill after timeout
      setTimeout(() => {
        if (context.process && !context.process.killed) {
          context.process.kill('SIGKILL');
        }
      }, this.config.killTimeout);
    }

    // Remove from running tasks
    this.runningTasks.delete(taskId);

    this.emit('task-cancelled', { taskId, reason });
  }

  private startResourceMonitoring(): void {
    this.resourceMonitor = setInterval(() => {
      this.updateResourceUsage();
    }, 5000); // Update every 5 seconds
  }

  private async updateResourceUsage(): Promise<void> {
    for (const [taskId, context] of this.runningTasks) {
      if (context.process) {
        try {
          const usage = await this.getProcessResourceUsage(context.process.pid!);
          context.resources = {
            ...usage,
            lastUpdated: new Date()
          };

          // Check resource limits
          this.checkResourceLimits(taskId, context);
        } catch (error) {
          this.logger.warn('Failed to get resource usage', {
            taskId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  }

  private async getProcessResourceUsage(pid: number): Promise<ResourceUsage> {
    // In a real implementation, this would use system APIs
    // For now, return mock data
    return {
      memory: Math.random() * this.config.resourceLimits.memory,
      cpu: Math.random() * 100,
      disk: Math.random() * this.config.resourceLimits.disk,
      network: Math.random() * 1024 * 1024,
      lastUpdated: new Date()
    };
  }

  private checkResourceLimits(taskId: string, context: ExecutionContext): void {
    const { memory, cpu } = context.resources;
    const limits = this.config.resourceLimits;

    if (memory > limits.memory) {
      this.logger.warn('Task exceeding memory limit', {
        taskId,
        current: memory,
        limit: limits.memory
      });
      
      this.cancelTask(taskId, 'Memory limit exceeded');
    }

    if (cpu > limits.cpu * 100) { // CPU is in percentage
      this.logger.warn('Task exceeding CPU limit', {
        taskId,
        current: cpu,
        limit: limits.cpu * 100
      });
    }
  }

  private getDefaultResourceUsage(): ResourceUsage {
    return {
      memory: 0,
      cpu: 0,
      disk: 0,
      network: 0,
      lastUpdated: new Date()
    };
  }

  private async waitForCapacity(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.runningTasks.size < this.config.maxConcurrentTasks) {
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
    });
  }

  private processQueuedTasks(): void {
    while (
      this.queuedTasks.length > 0 &&
      this.runningTasks.size < this.config.maxConcurrentTasks
    ) {
      const task = this.queuedTasks.shift();
      if (task) {
        this.emit('task-dequeued', { taskId: task.id.id });
      }
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async gracefulShutdown(): Promise<void> {
    this.logger.info('Received shutdown signal, initiating graceful shutdown');
    await this.shutdown();
    process.exit(0);
  }

  // Public API methods

  getRunningTasks(): string[] {
    return Array.from(this.runningTasks.keys());
  }

  getTaskContext(taskId: string): ExecutionContext | undefined {
    return this.runningTasks.get(taskId);
  }

  getQueuedTasks(): TaskDefinition[] {
    return [...this.queuedTasks];
  }

  getExecutorStats(): {
    runningTasks: number;
    queuedTasks: number;
    maxConcurrentTasks: number;
    totalCapacity: number;
    resourceLimits: TaskExecutorConfig['resourceLimits'];
    circuitBreakers: Record<string, any>;
  } {
    return {
      runningTasks: this.runningTasks.size,
      queuedTasks: this.queuedTasks.length,
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      totalCapacity: this.config.maxConcurrentTasks,
      resourceLimits: this.config.resourceLimits,
      circuitBreakers: this.circuitBreakerManager.getAllMetrics()
    };
  }

  async forceKillTask(taskId: string): Promise<void> {
    await this.cancelTask(taskId, 'Force killed by user');
  }

  updateConfig(newConfig: Partial<TaskExecutorConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Task executor configuration updated', { newConfig });
  }
}