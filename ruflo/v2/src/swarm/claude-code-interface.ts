/**
 * Claude Code Coordination Interface
 * 
 * This module provides the interface layer for coordinating with Claude Code
 * instances, managing agent spawning through the claude CLI, handling process
 * lifecycle, and enabling seamless communication between the swarm system
 * and individual Claude agents.
 */

import { EventEmitter } from 'node:events';
import { spawn, ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import { MemoryManager } from '../memory/manager.js';
import TaskExecutor, { 
  ClaudeExecutionOptions,
  ExecutionResult,
  ExecutionContext
} from './executor.js';
import {
  SwarmAgent,
  SwarmTask,
  TaskDefinition,
  AgentState,
  AgentCapabilities,
  TaskResult,
  SwarmExecutionContext,
} from './types.js';

export interface ClaudeCodeConfig {
  claudeExecutablePath: string;
  defaultModel: string;
  maxTokens: number;
  temperature: number;
  timeout: number;
  maxConcurrentAgents: number;
  enableStreaming: boolean;
  enableLogging: boolean;
  workingDirectory: string;
  environmentVariables: Record<string, string>;
  agentPoolSize: number;
  processRecycling: boolean;
  healthCheckInterval: number;
}

export interface ClaudeAgent {
  id: string;
  processId: number;
  process: ChildProcess;
  type: string;
  capabilities: string[];
  status: 'initializing' | 'idle' | 'busy' | 'error' | 'terminated';
  currentTask?: string;
  spawnedAt: Date;
  lastActivity: Date;
  totalTasks: number;
  totalDuration: number;
  metrics: ClaudeAgentMetrics;
}

export interface ClaudeAgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  averageResponseTime: number;
  totalTokensUsed: number;
  memoryUsage: number;
  cpuUsage: number;
  errorRate: number;
  successRate: number;
}

export interface ClaudeTaskExecution {
  id: string;
  taskId: string;
  agentId: string;
  startTime: Date;
  endTime?: Date;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  input: any;
  output?: any;
  error?: string;
  duration?: number;
  tokensUsed?: number;
  retryCount: number;
  maxRetries: number;
}

export interface ClaudeSpawnOptions {
  type: string;
  name?: string;
  capabilities?: string[];
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  workingDirectory?: string;
  environment?: Record<string, string>;
  tools?: string[];
  priority?: number;
}

export interface ProcessPool {
  idle: ClaudeAgent[];
  busy: ClaudeAgent[];
  failed: ClaudeAgent[];
  totalSpawned: number;
  totalTerminated: number;
  recyclingEnabled: boolean;
  maxAge: number;
  maxTasks: number;
}

export class ClaudeCodeInterface extends EventEmitter {
  private logger: Logger;
  private config: ClaudeCodeConfig;
  private memoryManager: MemoryManager;
  private processPool: ProcessPool;
  private activeExecutions: Map<string, ClaudeTaskExecution> = new Map();
  private agents: Map<string, ClaudeAgent> = new Map();
  private taskExecutor: TaskExecutor;
  private healthCheckInterval?: NodeJS.Timeout;
  private isInitialized: boolean = false;

  constructor(
    config: Partial<ClaudeCodeConfig> = {},
    memoryManager: MemoryManager
  ) {
    super();
    
    this.logger = new Logger('ClaudeCodeInterface');
    this.config = this.createDefaultConfig(config);
    this.memoryManager = memoryManager;
    this.processPool = this.initializeProcessPool();
    
    this.taskExecutor = new TaskExecutor({
      timeoutMs: this.config.timeout,
      enableMetrics: true,
      captureOutput: true,
      streamOutput: this.config.enableStreaming,
    });

    this.setupEventHandlers();
  }

  /**
   * Initialize the Claude Code interface
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Claude Code interface already initialized');
      return;
    }

    this.logger.info('Initializing Claude Code interface...');

    try {
      // Verify Claude executable exists
      await this.verifyClaudeExecutable();

      // Initialize task executor
      await this.taskExecutor.initialize();

      // Pre-warm agent pool if configured
      if (this.config.agentPoolSize > 0) {
        await this.prewarmAgentPool();
      }

      // Start health checks
      this.startHealthChecks();

      this.isInitialized = true;
      this.logger.info('Claude Code interface initialized successfully', {
        poolSize: this.processPool.idle.length,
        maxConcurrent: this.config.maxConcurrentAgents,
      });

      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize Claude Code interface', error);
      throw error;
    }
  }

  /**
   * Shutdown the interface gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) return;

    this.logger.info('Shutting down Claude Code interface...');

    try {
      // Stop health checks
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      // Cancel active executions
      const cancellationPromises = Array.from(this.activeExecutions.keys())
        .map(executionId => this.cancelExecution(executionId, 'Interface shutdown'));
      
      await Promise.allSettled(cancellationPromises);

      // Terminate all agents
      await this.terminateAllAgents();

      // Shutdown task executor
      await this.taskExecutor.shutdown();

      this.isInitialized = false;
      this.logger.info('Claude Code interface shut down successfully');
      this.emit('shutdown');

    } catch (error) {
      this.logger.error('Error during Claude Code interface shutdown', error);
      throw error;
    }
  }

  /**
   * Spawn a new Claude agent with specified configuration
   */
  async spawnAgent(options: ClaudeSpawnOptions): Promise<string> {
    this.logger.info('Spawning Claude agent', {
      type: options.type,
      name: options.name,
      capabilities: options.capabilities,
    });

    try {
      // Check if we can spawn more agents
      if (this.getTotalActiveAgents() >= this.config.maxConcurrentAgents) {
        throw new Error('Maximum concurrent agents limit reached');
      }

      // Build Claude command
      const command = this.buildClaudeCommand(options);
      
      // Spawn process
      const process = spawn(command.executable, command.args, {
        cwd: options.workingDirectory || this.config.workingDirectory,
        env: {
          ...process.env,
          ...this.config.environmentVariables,
          ...options.environment,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      if (!process.pid) {
        throw new Error('Failed to spawn Claude process');
      }

      // Create agent record
      const agentId = generateId('claude-agent');
      const agent: ClaudeAgent = {
        id: agentId,
        processId: process.pid,
        process,
        type: options.type,
        capabilities: options.capabilities || [],
        status: 'initializing',
        spawnedAt: new Date(),
        lastActivity: new Date(),
        totalTasks: 0,
        totalDuration: 0,
        metrics: this.initializeAgentMetrics(),
      };

      this.agents.set(agentId, agent);
      this.processPool.idle.push(agent);
      this.processPool.totalSpawned++;

      // Setup process event handlers
      this.setupProcessEventHandlers(agent);

      // Wait for agent to be ready
      await this.waitForAgentReady(agent);

      agent.status = 'idle';
      agent.lastActivity = new Date();

      this.logger.info('Claude agent spawned successfully', {
        agentId,
        processId: process.pid,
        type: options.type,
      });

      this.emit('agent:spawned', {
        agentId,
        type: options.type,
        processId: process.pid,
      });

      return agentId;

    } catch (error) {
      this.logger.error('Failed to spawn Claude agent', {
        type: options.type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute a task using a Claude agent
   */
  async executeTask(
    taskDefinition: TaskDefinition,
    agentId?: string,
    options: Partial<ClaudeExecutionOptions> = {}
  ): Promise<ClaudeTaskExecution> {
    const executionId = generateId('claude-execution');
    
    this.logger.info('Executing task with Claude agent', {
      executionId,
      taskId: taskDefinition.id.id,
      agentId,
    });

    try {
      // Get or select agent
      const agent = agentId ? this.agents.get(agentId) : await this.selectOptimalAgent(taskDefinition);
      
      if (!agent) {
        throw new Error(agentId ? `Agent not found: ${agentId}` : 'No suitable agent available');
      }

      if (agent.status !== 'idle') {
        throw new Error(`Agent ${agent.id} is not available (status: ${agent.status})`);
      }

      // Create execution record
      const execution: ClaudeTaskExecution = {
        id: executionId,
        taskId: taskDefinition.id.id,
        agentId: agent.id,
        startTime: new Date(),
        status: 'queued',
        input: {
          task: taskDefinition,
          options,
        },
        retryCount: 0,
        maxRetries: options.maxRetries || 3,
      };

      this.activeExecutions.set(executionId, execution);

      // Update agent status
      agent.status = 'busy';
      agent.currentTask = executionId;
      agent.lastActivity = new Date();

      // Move agent from idle to busy pool
      this.moveAgentToBusyPool(agent);

      // Execute task
      execution.status = 'running';
      const result = await this.executeTaskWithAgent(agent, taskDefinition, options);

      // Update execution record
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();
      execution.output = result.result;
      execution.tokensUsed = result.metadata?.tokensUsed;

      if (result.success) {
        execution.status = 'completed';
        agent.metrics.tasksCompleted++;
      } else {
        execution.status = 'failed';
        execution.error = result.error;
        agent.metrics.tasksFailed++;
      }

      // Update agent metrics
      this.updateAgentMetrics(agent, execution);

      // Return agent to idle pool
      this.returnAgentToIdlePool(agent);

      this.logger.info('Task execution completed', {
        executionId,
        success: result.success,
        duration: execution.duration,
        tokensUsed: execution.tokensUsed,
      });

      this.emit('task:completed', {
        executionId,
        taskId: taskDefinition.id.id,
        agentId: agent.id,
        success: result.success,
        duration: execution.duration,
      });

      return execution;

    } catch (error) {
      const execution = this.activeExecutions.get(executionId);
      if (execution) {
        execution.status = 'failed';
        execution.error = error instanceof Error ? error.message : String(error);
        execution.endTime = new Date();
        execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

        // Return agent to pool if it was assigned
        const agent = this.agents.get(execution.agentId);
        if (agent) {
          this.returnAgentToIdlePool(agent);
        }
      }

      this.logger.error('Task execution failed', {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Cancel a running task execution
   */
  async cancelExecution(executionId: string, reason: string): Promise<void> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    this.logger.info('Cancelling task execution', {
      executionId,
      reason,
      taskId: execution.taskId,
      agentId: execution.agentId,
    });

    try {
      execution.status = 'cancelled';
      execution.error = reason;
      execution.endTime = new Date();
      execution.duration = execution.endTime.getTime() - execution.startTime.getTime();

      // Cancel agent task if running
      const agent = this.agents.get(execution.agentId);
      if (agent && agent.currentTask === executionId) {
        await this.cancelAgentTask(agent);
        this.returnAgentToIdlePool(agent);
      }

      this.emit('task:cancelled', {
        executionId,
        reason,
        taskId: execution.taskId,
        agentId: execution.agentId,
      });

    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Terminate a specific agent
   */
  async terminateAgent(agentId: string, reason: string = 'Manual termination'): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    this.logger.info('Terminating Claude agent', {
      agentId,
      processId: agent.processId,
      reason,
    });

    try {
      // Cancel current task if any
      if (agent.currentTask) {
        await this.cancelExecution(agent.currentTask, 'Agent termination');
      }

      // Update status
      agent.status = 'terminated';

      // Terminate process
      await this.terminateProcess(agent.process);

      // Remove from pools and agents map
      this.removeAgentFromPools(agent);
      this.agents.delete(agentId);
      this.processPool.totalTerminated++;

      this.logger.info('Claude agent terminated successfully', {
        agentId,
        reason,
        totalTasks: agent.totalTasks,
        totalDuration: agent.totalDuration,
      });

      this.emit('agent:terminated', {
        agentId,
        reason,
        metrics: agent.metrics,
      });

    } catch (error) {
      this.logger.error('Error terminating agent', {
        agentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get agent status and metrics
   */
  getAgentStatus(agentId: string): ClaudeAgent | null {
    return this.agents.get(agentId) || null;
  }

  /**
   * Get all active agents
   */
  getAllAgents(): ClaudeAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get execution status
   */
  getExecutionStatus(executionId: string): ClaudeTaskExecution | null {
    return this.activeExecutions.get(executionId) || null;
  }

  /**
   * Get comprehensive interface metrics
   */
  getInterfaceMetrics(): {
    agents: {
      total: number;
      idle: number;
      busy: number;
      failed: number;
      terminated: number;
    };
    executions: {
      active: number;
      completed: number;
      failed: number;
      cancelled: number;
    };
    performance: {
      averageResponseTime: number;
      totalTokensUsed: number;
      successRate: number;
      throughput: number;
    };
    pool: {
      totalSpawned: number;
      totalTerminated: number;
      recyclingEnabled: boolean;
      poolUtilization: number;
    };
  } {
    const agents = Array.from(this.agents.values());
    const executions = Array.from(this.activeExecutions.values());

    const totalCompleted = agents.reduce((sum, a) => sum + a.metrics.tasksCompleted, 0);
    const totalFailed = agents.reduce((sum, a) => sum + a.metrics.tasksFailed, 0);
    const totalTokens = agents.reduce((sum, a) => sum + a.metrics.totalTokensUsed, 0);
    const avgResponseTime = agents.length > 0 
      ? agents.reduce((sum, a) => sum + a.metrics.averageResponseTime, 0) / agents.length 
      : 0;

    return {
      agents: {
        total: agents.length,
        idle: this.processPool.idle.length,
        busy: this.processPool.busy.length,
        failed: this.processPool.failed.length,
        terminated: this.processPool.totalTerminated,
      },
      executions: {
        active: executions.filter(e => e.status === 'running').length,
        completed: totalCompleted,
        failed: totalFailed,
        cancelled: executions.filter(e => e.status === 'cancelled').length,
      },
      performance: {
        averageResponseTime: avgResponseTime,
        totalTokensUsed: totalTokens,
        successRate: totalCompleted + totalFailed > 0 ? totalCompleted / (totalCompleted + totalFailed) : 0,
        throughput: this.calculateThroughput(),
      },
      pool: {
        totalSpawned: this.processPool.totalSpawned,
        totalTerminated: this.processPool.totalTerminated,
        recyclingEnabled: this.processPool.recyclingEnabled,
        poolUtilization: this.calculatePoolUtilization(),
      },
    };
  }

  // Private methods

  private async verifyClaudeExecutable(): Promise<void> {
    try {
      const { spawn } = await import('node:child_process');
      const process = spawn(this.config.claudeExecutablePath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      return new Promise((resolve, reject) => {
        let output = '';
        
        process.stdout?.on('data', (data) => {
          output += data.toString();
        });

        process.on('close', (code) => {
          if (code === 0) {
            this.logger.info('Claude executable verified', {
              path: this.config.claudeExecutablePath,
              version: output.trim(),
            });
            resolve();
          } else {
            reject(new Error(`Claude executable verification failed with code ${code}`));
          }
        });

        process.on('error', reject);
      });

    } catch (error) {
      throw new Error(`Claude executable not found: ${this.config.claudeExecutablePath}`);
    }
  }

  private async prewarmAgentPool(): Promise<void> {
    this.logger.info('Pre-warming agent pool', {
      targetSize: this.config.agentPoolSize,
    });

    const promises: Promise<string>[] = [];
    
    for (let i = 0; i < this.config.agentPoolSize; i++) {
      promises.push(this.spawnAgent({
        type: 'general',
        name: `pool-agent-${i}`,
        capabilities: ['general'],
      }));
    }

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    this.logger.info('Agent pool pre-warming completed', {
      successful,
      failed,
      targetSize: this.config.agentPoolSize,
    });
  }

  private buildClaudeCommand(options: ClaudeSpawnOptions): {
    executable: string;
    args: string[];
  } {
    const args: string[] = [];

    // Add model
    args.push('--model', options.model || this.config.defaultModel);

    // Add max tokens
    args.push('--max-tokens', String(options.maxTokens || this.config.maxTokens));

    // Add temperature
    args.push('--temperature', String(options.temperature || this.config.temperature));

    // Add system prompt if provided
    if (options.systemPrompt) {
      args.push('--system', options.systemPrompt);
    }

    // Add tools if specified
    if (options.tools && options.tools.length > 0) {
      args.push('--allowedTools', options.tools.join(','));
    }

    // Enable streaming if configured
    if (this.config.enableStreaming) {
      args.push('--stream');
    }

    // Skip permissions for swarm execution
    args.push('--dangerously-skip-permissions');

    return {
      executable: this.config.claudeExecutablePath,
      args,
    };
  }

  private setupProcessEventHandlers(agent: ClaudeAgent): void {
    const { process } = agent;

    process.on('exit', (code, signal) => {
      this.logger.info('Claude agent process exited', {
        agentId: agent.id,
        processId: agent.processId,
        code,
        signal,
      });

      if (agent.status !== 'terminated') {
        agent.status = 'error';
        this.moveAgentToFailedPool(agent);
      }

      this.emit('agent:exited', {
        agentId: agent.id,
        code,
        signal,
      });
    });

    process.on('error', (error) => {
      this.logger.error('Claude agent process error', {
        agentId: agent.id,
        processId: agent.processId,
        error: error.message,
      });

      agent.status = 'error';
      this.moveAgentToFailedPool(agent);

      this.emit('agent:error', {
        agentId: agent.id,
        error: error.message,
      });
    });

    // Handle stdout/stderr if needed
    if (this.config.enableLogging) {
      process.stdout?.on('data', (data) => {
        this.logger.debug('Agent stdout', {
          agentId: agent.id,
          data: data.toString().trim(),
        });
      });

      process.stderr?.on('data', (data) => {
        this.logger.debug('Agent stderr', {
          agentId: agent.id,
          data: data.toString().trim(),
        });
      });
    }
  }

  private async waitForAgentReady(agent: ClaudeAgent, timeout: number = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = 1000; // 1 second

      const checkReady = () => {
        const elapsed = Date.now() - startTime;
        
        if (elapsed > timeout) {
          reject(new Error(`Agent ${agent.id} failed to become ready within ${timeout}ms`));
          return;
        }

        // Check if process is still running
        if (agent.process.killed || agent.process.exitCode !== null) {
          reject(new Error(`Agent ${agent.id} process terminated during initialization`));
          return;
        }

        // For now, assume agent is ready after a short delay
        // In a real implementation, you might check for specific output or response
        if (elapsed > 2000) { // 2 seconds
          resolve();
        } else {
          setTimeout(checkReady, checkInterval);
        }
      };

      checkReady();
    });
  }

  private async selectOptimalAgent(taskDefinition: TaskDefinition): Promise<ClaudeAgent | null> {
    const availableAgents = this.processPool.idle.filter(agent => agent.status === 'idle');
    
    if (availableAgents.length === 0) {
      // Try to spawn a new agent if under limit
      if (this.getTotalActiveAgents() < this.config.maxConcurrentAgents) {
        const agentId = await this.spawnAgent({
          type: 'task-specific',
          capabilities: taskDefinition.requirements.capabilities,
        });
        return this.agents.get(agentId) || null;
      }
      return null;
    }

    // Select agent based on capabilities and performance
    const scoredAgents = availableAgents.map(agent => ({
      agent,
      score: this.calculateAgentScore(agent, taskDefinition),
    }));

    scoredAgents.sort((a, b) => b.score - a.score);
    return scoredAgents[0].agent;
  }

  private calculateAgentScore(agent: ClaudeAgent, taskDefinition: TaskDefinition): number {
    let score = 0;

    // Capability match
    const requiredCapabilities = taskDefinition.requirements.capabilities;
    const matchingCapabilities = agent.capabilities.filter(cap => 
      requiredCapabilities.includes(cap)
    );
    score += (matchingCapabilities.length / requiredCapabilities.length) * 100;

    // Performance metrics
    score += agent.metrics.successRate * 50;
    score += Math.max(0, 50 - agent.metrics.averageResponseTime / 1000) * 10; // Prefer faster agents

    // Load balancing - prefer agents with fewer completed tasks
    const maxTasks = Math.max(...this.processPool.idle.map(a => a.totalTasks), 1);
    score += (1 - agent.totalTasks / maxTasks) * 20;

    return score;
  }

  private async executeTaskWithAgent(
    agent: ClaudeAgent,
    taskDefinition: TaskDefinition,
    options: Partial<ClaudeExecutionOptions>
  ): Promise<ExecutionResult> {
    const startTime = performance.now();

    try {
      // Create execution context for the agent
      const context: ExecutionContext = {
        task: taskDefinition,
        agent: this.convertToAgentState(agent),
        workingDirectory: options.workingDirectory || this.config.workingDirectory,
        tempDirectory: path.join(this.config.workingDirectory, 'temp', agent.id),
        logDirectory: path.join(this.config.workingDirectory, 'logs', agent.id),
        environment: {
          ...this.config.environmentVariables,
          CLAUDE_AGENT_ID: agent.id,
          CLAUDE_TASK_ID: taskDefinition.id.id,
        },
        resources: {
          maxMemory: taskDefinition.requirements.memoryRequired || 512 * 1024 * 1024,
          maxCpuTime: taskDefinition.requirements.maxDuration || 300000,
          maxDiskSpace: 1024 * 1024 * 1024,
          maxNetworkConnections: 10,
          maxFileHandles: 100,
          priority: 1,
        },
      };

      // Execute using task executor
      const result = await this.taskExecutor.executeClaudeTask(
        taskDefinition,
        context.agent,
        {
          model: options.model || this.config.defaultModel,
          maxTokens: options.maxTokens || this.config.maxTokens,
          temperature: options.temperature || this.config.temperature,
          timeout: options.timeout || this.config.timeout,
          claudePath: this.config.claudeExecutablePath,
          ...options,
        }
      );

      const duration = performance.now() - startTime;
      
      // Update agent activity
      agent.lastActivity = new Date();
      agent.totalTasks++;
      agent.totalDuration += duration;

      return result;

    } catch (error) {
      const duration = performance.now() - startTime;
      agent.totalDuration += duration;
      
      throw error;
    }
  }

  private convertToAgentState(agent: ClaudeAgent): AgentState {
    // Convert ClaudeAgent to AgentState for compatibility
    return {
      id: {
        id: agent.id,
        swarmId: 'claude-interface',
        type: agent.type as any,
        instance: 1,
      },
      name: `Claude-${agent.id}`,
      type: agent.type as any,
      status: agent.status as any,
      capabilities: this.createAgentCapabilities(agent.capabilities),
      metrics: {
        tasksCompleted: agent.metrics.tasksCompleted,
        tasksFailed: agent.metrics.tasksFailed,
        averageExecutionTime: agent.metrics.averageResponseTime,
        successRate: agent.metrics.successRate,
        cpuUsage: agent.metrics.cpuUsage,
        memoryUsage: agent.metrics.memoryUsage,
        diskUsage: 0,
        networkUsage: 0,
        codeQuality: 0.8,
        testCoverage: 0.7,
        bugRate: 0.1,
        userSatisfaction: 0.9,
        totalUptime: Date.now() - agent.spawnedAt.getTime(),
        lastActivity: agent.lastActivity,
        responseTime: agent.metrics.averageResponseTime,
      },
      currentTask: agent.currentTask ? {
        id: agent.currentTask,
        swarmId: 'claude-interface',
        sequence: 0,
        priority: 1,
      } : undefined,
      workload: agent.status === 'busy' ? 1 : 0,
      health: agent.status === 'error' ? 0 : 1,
      config: {
        autonomyLevel: 0.8,
        learningEnabled: false,
        adaptationEnabled: false,
        maxTasksPerHour: 60,
        maxConcurrentTasks: 1,
        timeoutThreshold: this.config.timeout,
        reportingInterval: 10000,
        heartbeatInterval: 5000,
        permissions: ['read', 'write', 'execute'],
        trustedAgents: [],
        expertise: {},
        preferences: {},
      },
      environment: {
        runtime: 'claude',
        version: '1.0.0',
        workingDirectory: this.config.workingDirectory,
        tempDirectory: path.join(this.config.workingDirectory, 'temp', agent.id),
        logDirectory: path.join(this.config.workingDirectory, 'logs', agent.id),
        apiEndpoints: {},
        credentials: {},
        availableTools: agent.capabilities,
        toolConfigs: {},
      },
      endpoints: [],
      lastHeartbeat: agent.lastActivity,
      taskHistory: [],
      errorHistory: [],
      parentAgent: undefined,
      childAgents: [],
      collaborators: [],
    };
  }

  private createAgentCapabilities(capabilities: string[]): AgentCapabilities {
    return {
      codeGeneration: capabilities.includes('coding') || capabilities.includes('codeGeneration'),
      codeReview: capabilities.includes('review') || capabilities.includes('codeReview'),
      testing: capabilities.includes('testing'),
      documentation: capabilities.includes('documentation'),
      research: capabilities.includes('research'),
      analysis: capabilities.includes('analysis'),
      webSearch: capabilities.includes('webSearch'),
      apiIntegration: capabilities.includes('apiIntegration'),
      fileSystem: capabilities.includes('fileSystem'),
      terminalAccess: capabilities.includes('terminal'),
      languages: capabilities.filter(c => ['javascript', 'typescript', 'python', 'java'].includes(c)),
      frameworks: capabilities.filter(c => ['react', 'node', 'express'].includes(c)),
      domains: capabilities.filter(c => ['web', 'api', 'database'].includes(c)),
      tools: capabilities.filter(c => ['bash', 'git', 'npm'].includes(c)),
      maxConcurrentTasks: 1,
      maxMemoryUsage: 512 * 1024 * 1024,
      maxExecutionTime: this.config.timeout,
      reliability: 0.9,
      speed: 1.0,
      quality: 0.8,
    };
  }

  private async cancelAgentTask(agent: ClaudeAgent): Promise<void> {
    if (agent.process && !agent.process.killed) {
      // Send interrupt signal
      agent.process.kill('SIGINT');
      
      // Wait briefly for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Force kill if still running
      if (!agent.process.killed) {
        agent.process.kill('SIGKILL');
      }
    }

    agent.currentTask = undefined;
    agent.status = 'idle';
    agent.lastActivity = new Date();
  }

  private async terminateProcess(process: ChildProcess): Promise<void> {
    if (process.killed || process.exitCode !== null) {
      return;
    }

    // Send termination signal
    process.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Force kill if still running
    if (!process.killed && process.exitCode === null) {
      process.kill('SIGKILL');
    }
  }

  private async terminateAllAgents(): Promise<void> {
    const terminationPromises = Array.from(this.agents.keys())
      .map(agentId => this.terminateAgent(agentId, 'Interface shutdown'));
    
    await Promise.allSettled(terminationPromises);
  }

  private moveAgentToBusyPool(agent: ClaudeAgent): void {
    const idleIndex = this.processPool.idle.indexOf(agent);
    if (idleIndex !== -1) {
      this.processPool.idle.splice(idleIndex, 1);
      this.processPool.busy.push(agent);
    }
  }

  private returnAgentToIdlePool(agent: ClaudeAgent): void {
    agent.status = 'idle';
    agent.currentTask = undefined;
    agent.lastActivity = new Date();

    const busyIndex = this.processPool.busy.indexOf(agent);
    if (busyIndex !== -1) {
      this.processPool.busy.splice(busyIndex, 1);
      this.processPool.idle.push(agent);
    }
  }

  private moveAgentToFailedPool(agent: ClaudeAgent): void {
    // Remove from other pools
    this.removeAgentFromPools(agent);
    this.processPool.failed.push(agent);
  }

  private removeAgentFromPools(agent: ClaudeAgent): void {
    const idleIndex = this.processPool.idle.indexOf(agent);
    if (idleIndex !== -1) {
      this.processPool.idle.splice(idleIndex, 1);
    }

    const busyIndex = this.processPool.busy.indexOf(agent);
    if (busyIndex !== -1) {
      this.processPool.busy.splice(busyIndex, 1);
    }

    const failedIndex = this.processPool.failed.indexOf(agent);
    if (failedIndex !== -1) {
      this.processPool.failed.splice(failedIndex, 1);
    }
  }

  private updateAgentMetrics(agent: ClaudeAgent, execution: ClaudeTaskExecution): void {
    const metrics = agent.metrics;
    
    // Update averages
    const totalTasks = metrics.tasksCompleted + metrics.tasksFailed;
    if (execution.duration) {
      metrics.averageResponseTime = totalTasks > 0 
        ? ((metrics.averageResponseTime * (totalTasks - 1)) + execution.duration) / totalTasks
        : execution.duration;
    }

    // Update success rate
    metrics.successRate = totalTasks > 0 
      ? metrics.tasksCompleted / totalTasks 
      : 0;

    // Update error rate
    metrics.errorRate = 1 - metrics.successRate;

    // Update token usage if available
    if (execution.tokensUsed) {
      metrics.totalTokensUsed += execution.tokensUsed;
    }
  }

  private getTotalActiveAgents(): number {
    return this.processPool.idle.length + this.processPool.busy.length;
  }

  private calculateThroughput(): number {
    const agents = Array.from(this.agents.values());
    const totalTasks = agents.reduce((sum, a) => sum + a.totalTasks, 0);
    const totalTime = agents.reduce((sum, a) => sum + a.totalDuration, 0);
    
    return totalTime > 0 ? (totalTasks / totalTime) * 60000 : 0; // tasks per minute
  }

  private calculatePoolUtilization(): number {
    const total = this.getTotalActiveAgents();
    const busy = this.processPool.busy.length;
    
    return total > 0 ? busy / total : 0;
  }

  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  private performHealthCheck(): void {
    const now = Date.now();
    
    for (const agent of this.agents.values()) {
      // Check for stalled agents
      const inactiveTime = now - agent.lastActivity.getTime();
      
      if (agent.status === 'busy' && inactiveTime > this.config.timeout * 2) {
        this.logger.warn('Agent appears stalled', {
          agentId: agent.id,
          inactiveTime,
          currentTask: agent.currentTask,
        });

        // Try to recover the agent
        this.recoverStalledAgent(agent);
      }

      // Check for failed processes
      if (agent.process.killed || agent.process.exitCode !== null) {
        if (agent.status !== 'terminated') {
          this.logger.warn('Agent process died unexpectedly', {
            agentId: agent.id,
            exitCode: agent.process.exitCode,
          });
          
          agent.status = 'error';
          this.moveAgentToFailedPool(agent);
        }
      }
    }
  }

  private async recoverStalledAgent(agent: ClaudeAgent): Promise<void> {
    try {
      if (agent.currentTask) {
        await this.cancelExecution(agent.currentTask, 'Agent recovery');
      }
      
      this.returnAgentToIdlePool(agent);
      
      this.logger.info('Agent recovered from stalled state', {
        agentId: agent.id,
      });

    } catch (error) {
      this.logger.error('Failed to recover stalled agent', {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Terminate the problematic agent
      await this.terminateAgent(agent.id, 'Recovery failed');
    }
  }

  private initializeProcessPool(): ProcessPool {
    return {
      idle: [],
      busy: [],
      failed: [],
      totalSpawned: 0,
      totalTerminated: 0,
      recyclingEnabled: this.config.processRecycling,
      maxAge: 3600000, // 1 hour
      maxTasks: 100,
    };
  }

  private initializeAgentMetrics(): ClaudeAgentMetrics {
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      averageResponseTime: 0,
      totalTokensUsed: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      errorRate: 0,
      successRate: 0,
    };
  }

  private createDefaultConfig(config: Partial<ClaudeCodeConfig>): ClaudeCodeConfig {
    return {
      claudeExecutablePath: 'claude',
      defaultModel: 'claude-3-5-sonnet-20241022',
      maxTokens: 4096,
      temperature: 0.7,
      timeout: 300000, // 5 minutes
      maxConcurrentAgents: 10,
      enableStreaming: false,
      enableLogging: true,
      workingDirectory: process.cwd(),
      environmentVariables: {},
      agentPoolSize: 0,
      processRecycling: true,
      healthCheckInterval: 30000, // 30 seconds
      ...config,
    };
  }

  private setupEventHandlers(): void {
    this.on('agent:spawned', (data) => {
      this.logger.info('Agent spawned event', data);
    });

    this.on('agent:terminated', (data) => {
      this.logger.info('Agent terminated event', data);
    });

    this.on('task:completed', (data) => {
      this.logger.info('Task completed event', data);
    });

    this.on('task:cancelled', (data) => {
      this.logger.warn('Task cancelled event', data);
    });
  }
}

export default ClaudeCodeInterface;