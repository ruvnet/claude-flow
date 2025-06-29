/**
 * Advanced Task Executor with timeout handling and process management
 */

import { ChildProcess, spawn } from '../tracing/index.js';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import {
  TaskDefinition, AgentState, TaskResult, SwarmEvent, EventType,
  SWARM_CONSTANTS
} from './types.js';

export interface ExecutionContext {
  task: TaskDefinition;
  agent: AgentState;
  workingDirectory: string;
  tempDirectory: string;
  logDirectory: string;
  environment: Record<string, string>;
  resources: ExecutionResources;
}

export interface ExecutionResources {
  maxMemory: number;
  maxCpuTime: number;
  maxDiskSpace: number;
  maxNetworkConnections: number;
  maxFileHandles: number;
  priority: number;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
  duration: number;
  resourcesUsed: ResourceUsage;
  artifacts: Record<string, any>;
  metadata: Record<string, any>;
}

export interface ResourceUsage {
  cpuTime: number;
  maxMemory: number;
  diskIO: number;
  networkIO: number;
  fileHandles: number;
}

export interface ExecutionConfig {
  timeoutMs: number;
  retryAttempts: number;
  killTimeout: number;
  resourceLimits: ExecutionResources;
  sandboxed: boolean;
  logLevel: string;
  captureOutput: boolean;
  streamOutput: boolean;
  enableMetrics: boolean;
}

export class TaskExecutor extends EventEmitter {
  private logger: Logger;
  private config: ExecutionConfig;
  private activeExecutions: Map<string, ExecutionSession> = new Map();
  private resourceMonitor: ResourceMonitor;
  private processPool: ProcessPool;

  constructor(config: Partial<ExecutionConfig> = {}) {
    super();
    
    this.config = this.mergeWithDefaults(config);
    this.logger = new Logger(
      { level: (this.config.logLevel || 'info') as 'debug' | 'info' | 'warn' | 'error', format: 'text', destination: 'console' },
      { component: 'TaskExecutor' }
    );
    this.resourceMonitor = new ResourceMonitor();
    this.processPool = new ProcessPool(this.config);
    
    this.setupEventHandlers();
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing task executor...');
    
    await this.resourceMonitor.initialize();
    await this.processPool.initialize();
    
    this.logger.info('Task executor initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down task executor...');
    
    // Stop all active executions
    const stopPromises = Array.from(this.activeExecutions.values())
      .map(session => this.stopExecution(session.id, 'Executor shutdown'));
    
    await Promise.allSettled(stopPromises);
    
    await this.processPool.shutdown();
    await this.resourceMonitor.shutdown();
    
    this.logger.info('Task executor shut down');
  }

  async executeTask(
    task: TaskDefinition,
    agent: AgentState,
    options: Partial<ExecutionConfig> = {}
  ): Promise<ExecutionResult> {
    const sessionId = generateId('execution');
    const context = await this.createExecutionContext(task, agent);
    const config = { ...this.config, ...options };
    
    this.logger.info('Starting task execution', {
      sessionId,
      taskId: task.id.id,
      agentId: agent.id.id,
      timeout: config.timeoutMs
    });

    const session = new ExecutionSession(
      sessionId,
      task,
      agent,
      context,
      config,
      this.logger
    );

    this.activeExecutions.set(sessionId, session);

    try {
      // Setup monitoring
      this.resourceMonitor.startMonitoring(sessionId, context.resources);
      
      // Execute with timeout protection
      const result = await this.executeWithTimeout(session);
      
      // Cleanup
      await this.cleanupExecution(session);
      
      this.logger.info('Task execution completed', {
        sessionId,
        success: result.success,
        duration: result.duration
      });

      return result;

    } catch (error) {
      this.logger.error('Task execution failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });

      await this.cleanupExecution(session);
      throw error;

    } finally {
      this.activeExecutions.delete(sessionId);
      this.resourceMonitor.stopMonitoring(sessionId);
    }
  }

  async stopExecution(sessionId: string, reason: string): Promise<void> {
    const session = this.activeExecutions.get(sessionId);
    if (!session) {
      return;
    }

    this.logger.info('Stopping execution', { sessionId, reason });
    
    try {
      await session.stop(reason);
    } catch (error) {
      this.logger.error('Error stopping execution', { sessionId, error });
    }
  }

  async executeClaudeTask(
    task: TaskDefinition,
    agent: AgentState,
    claudeOptions: ClaudeExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const sessionId = generateId('claude-execution');
    const context = await this.createExecutionContext(task, agent);
    
    this.logger.info('Starting Claude task execution', {
      sessionId,
      taskId: task.id.id,
      agentId: agent.id.id
    });

    try {
      return await this.executeClaudeWithTimeout(
        sessionId,
        task,
        agent,
        context,
        claudeOptions
      );
    } catch (error) {
      this.logger.error('Claude task execution failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  getActiveExecutions(): ExecutionSession[] {
    return Array.from(this.activeExecutions.values());
  }

  getExecutionMetrics(): ExecutionMetrics {
    return {
      activeExecutions: this.activeExecutions.size,
      totalExecutions: this.processPool.getTotalExecutions(),
      averageDuration: this.processPool.getAverageDuration(),
      successRate: this.processPool.getSuccessRate(),
      resourceUtilization: this.resourceMonitor.getUtilization(),
      errorRate: this.processPool.getErrorRate()
    };
  }

  private async executeWithTimeout(session: ExecutionSession): Promise<ExecutionResult> {
    let timeout: NodeJS.Timeout | null = null;
    
    try {
      // Create a timeout promise that rejects after the specified time
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(async () => {
          this.logger.warn('Execution timeout', {
            sessionId: session.id,
            timeout: session.config.timeoutMs
          });
          
          try {
            await session.stop('Timeout');
          } catch (stopError) {
            this.logger.error('Error stopping session on timeout', { stopError });
          }
          
          reject(new Error(`Execution timed out after ${session.config.timeoutMs}ms`));
        }, session.config.timeoutMs);
      });
      
      // Race between execution and timeout
      const result = await Promise.race([
        session.execute(),
        timeoutPromise
      ]);
      
      // Clear timeout if execution completed successfully
      if (timeout) {
        clearTimeout(timeout);
      }
      
      return result;
    } catch (error) {
      // Clear timeout on error
      if (timeout) {
        clearTimeout(timeout);
      }
      throw error;
    }
  }

  private async executeClaudeWithTimeout(
    sessionId: string,
    task: TaskDefinition,
    agent: AgentState,
    context: ExecutionContext,
    options: ClaudeExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeout = options.timeout || this.config.timeoutMs;

    // Build Claude command
    const command = this.buildClaudeCommand(task, agent, options);
    
    // Create execution environment
    const env = {
      ...process.env,
      ...context.environment,
      CLAUDE_TASK_ID: task.id.id,
      CLAUDE_AGENT_ID: agent.id.id,
      CLAUDE_SESSION_ID: sessionId,
      CLAUDE_WORKING_DIR: context.workingDirectory
    };

    this.logger.debug('Executing Claude command', {
      sessionId,
      command: command.command,
      args: command.args,
      workingDir: context.workingDirectory
    });

    try {
      // Execute Claude process through ProcessPool
      const processCommand: ProcessCommand = {
        command: command.command,
        args: command.args,
        env,
        cwd: context.workingDirectory,
        timeout: timeout,
        detached: options.detached || false
      };
      if (command.input !== undefined) {
        processCommand.input = command.input;
      }
      
      const processResult = await this.processPool.execute(processCommand);
      
      const duration = Date.now() - startTime;
      
      this.logger.info('Claude process completed', {
        sessionId,
        exitCode: processResult.exitCode,
        signal: processResult.signal,
        duration,
        success: processResult.success
      });

      // Collect resource usage
      const resourceUsage = await this.collectResourceUsage(sessionId);
      
      // Collect artifacts
      const artifacts = await this.collectArtifacts(context);
      
      const result: ExecutionResult = {
        success: processResult.success,
        output: processResult.stdout,
        error: processResult.stderr,
        exitCode: processResult.exitCode,
        duration,
        resourcesUsed: resourceUsage,
        artifacts,
        metadata: {
          sessionId,
          timeout: !processResult.success && processResult.stderr.includes('timed out'),
          signal: processResult.signal,
          command: command.command,
          args: command.args,
          pid: processResult.pid
        }
      };

      if (!processResult.success) {
        if (processResult.stderr.includes('timed out')) {
          throw new Error(`Claude execution timed out after ${timeout}ms`);
        } else if (processResult.exitCode !== 0) {
          throw new Error(`Claude execution failed with exit code ${processResult.exitCode}: ${processResult.stderr}`);
        }
      }
      
      return result;

    } catch (error) {
      throw error;
    }
  }


  private buildClaudeCommand(
    task: TaskDefinition,
    agent: AgentState,
    options: ClaudeExecutionOptions
  ): ClaudeCommand {
    const args: string[] = [];
    let input = '';

    // Build prompt
    const prompt = this.buildClaudePrompt(task, agent);
    
    if (options.useStdin) {
      // Send prompt via stdin
      input = prompt;
    } else {
      // Send prompt as argument
      args.push('-p', prompt);
    }

    // Add tools
    if (task.requirements.tools.length > 0) {
      args.push('--allowedTools', task.requirements.tools.join(','));
    }

    // Add model if specified
    if (options.model) {
      args.push('--model', options.model);
    }

    // Add max tokens if specified
    if (options.maxTokens) {
      args.push('--max-tokens', options.maxTokens.toString());
    }

    // Add temperature if specified
    if (options.temperature !== undefined) {
      args.push('--temperature', options.temperature.toString());
    }

    // Skip permissions check for swarm execution
    args.push('--dangerously-skip-permissions');

    // Add output format
    if (options.outputFormat) {
      args.push('--output-format', options.outputFormat);
    }

    return {
      command: options.claudePath || 'claude',
      args,
      input
    };
  }

  private buildClaudePrompt(task: TaskDefinition, agent: AgentState): string {
    const sections: string[] = [];

    // Agent identification
    sections.push(`You are ${agent.name}, a ${agent.type} agent in a swarm system.`);
    sections.push(`Agent ID: ${agent.id.id}`);
    sections.push(`Swarm ID: ${agent.id.swarmId}`);
    sections.push('');

    // Task information
    sections.push(`TASK: ${task.name}`);
    sections.push(`Type: ${task.type}`);
    sections.push(`Priority: ${task.priority}`);
    sections.push('');

    // Task description
    sections.push('DESCRIPTION:');
    sections.push(task.description);
    sections.push('');

    // Task instructions
    sections.push('INSTRUCTIONS:');
    sections.push(task.instructions);
    sections.push('');

    // Context if provided
    if (Object.keys(task.context).length > 0) {
      sections.push('CONTEXT:');
      sections.push(JSON.stringify(task.context, null, 2));
      sections.push('');
    }

    // Input data if provided
    if (task.input && Object.keys(task.input).length > 0) {
      sections.push('INPUT DATA:');
      sections.push(JSON.stringify(task.input, null, 2));
      sections.push('');
    }

    // Examples if provided
    if (task.examples && task.examples.length > 0) {
      sections.push('EXAMPLES:');
      task.examples.forEach((example, index) => {
        sections.push(`Example ${index + 1}:`);
        sections.push(JSON.stringify(example, null, 2));
        sections.push('');
      });
    }

    // Expected output format
    sections.push('EXPECTED OUTPUT:');
    if (task.expectedOutput) {
      sections.push(JSON.stringify(task.expectedOutput, null, 2));
    } else {
      sections.push('Provide a structured response with:');
      sections.push('- Summary of what was accomplished');
      sections.push('- Any artifacts created (files, data, etc.)');
      sections.push('- Recommendations or next steps');
      sections.push('- Any issues encountered');
    }
    sections.push('');

    // Quality requirements
    sections.push('QUALITY REQUIREMENTS:');
    sections.push(`- Quality threshold: ${task.requirements.minReliability || 0.8}`);
    if (task.requirements.reviewRequired) {
      sections.push('- Review required before completion');
    }
    if (task.requirements.testingRequired) {
      sections.push('- Testing required before completion');
    }
    if (task.requirements.documentationRequired) {
      sections.push('- Documentation required');
    }
    sections.push('');

    // Capabilities and constraints
    sections.push('CAPABILITIES:');
    const capabilities = Object.entries(agent.capabilities)
      .filter(([key, value]) => typeof value === 'boolean' && value)
      .map(([key]) => key);
    sections.push(capabilities.join(', '));
    sections.push('');

    sections.push('CONSTRAINTS:');
    sections.push(`- Maximum execution time: ${task.constraints.timeoutAfter || SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT}ms`);
    sections.push(`- Maximum retries: ${task.constraints.maxRetries || SWARM_CONSTANTS.MAX_RETRIES}`);
    if (task.constraints.deadline) {
      sections.push(`- Deadline: ${task.constraints.deadline.toISOString()}`);
    }
    sections.push('');

    // Final instructions
    sections.push('EXECUTION GUIDELINES:');
    sections.push('1. Read and understand the task completely before starting');
    sections.push('2. Use your capabilities efficiently and effectively');
    sections.push('3. Provide detailed output about your progress and results');
    sections.push('4. Handle errors gracefully and report issues clearly');
    sections.push('5. Ensure your work meets the quality requirements');
    sections.push('6. When complete, provide a clear summary of what was accomplished');
    sections.push('');

    sections.push('Begin your task execution now.');

    return sections.join('\n');
  }

  private async createExecutionContext(
    task: TaskDefinition,
    agent: AgentState
  ): Promise<ExecutionContext> {
    const baseDir = path.join(os.tmpdir(), 'swarm-execution', task.id.id);
    const workingDir = path.join(baseDir, 'work');
    const tempDir = path.join(baseDir, 'temp');
    const logDir = path.join(baseDir, 'logs');

    // Create directories
    await fs.mkdir(workingDir, { recursive: true });
    await fs.mkdir(tempDir, { recursive: true });
    await fs.mkdir(logDir, { recursive: true });

    return {
      task,
      agent,
      workingDirectory: workingDir,
      tempDirectory: tempDir,
      logDirectory: logDir,
      environment: {
        NODE_ENV: 'production',
        SWARM_MODE: 'execution',
        AGENT_TYPE: agent.type,
        TASK_TYPE: task.type,
        ...agent.environment.credentials
      },
      resources: {
        maxMemory: task.requirements.memoryRequired || SWARM_CONSTANTS.DEFAULT_MEMORY_LIMIT,
        maxCpuTime: task.requirements.maxDuration || SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
        maxDiskSpace: 1024 * 1024 * 1024, // 1GB
        maxNetworkConnections: 10,
        maxFileHandles: 100,
        priority: this.getPriorityNumber(task.priority)
      }
    };
  }

  private async cleanupExecution(session: ExecutionSession): Promise<void> {
    try {
      await session.cleanup();
      this.logger.debug('Execution cleanup completed', { sessionId: session.id });
    } catch (error) {
      this.logger.warn('Error during execution cleanup', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async collectResourceUsage(sessionId: string): Promise<ResourceUsage> {
    return this.resourceMonitor.getUsage(sessionId);
  }

  private async collectArtifacts(context: ExecutionContext): Promise<Record<string, any>> {
    const artifacts: Record<string, any> = {};

    try {
      // Scan working directory for artifacts
      const files = await this.scanDirectory(context.workingDirectory);
      artifacts['files'] = files;

      // Check for specific artifact types
      artifacts['logs'] = await this.collectLogs(context.logDirectory);
      artifacts['outputs'] = await this.collectOutputs(context.workingDirectory);

    } catch (error) {
      this.logger.warn('Error collecting artifacts', {
        workingDir: context.workingDirectory,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return artifacts;
  }

  private async scanDirectory(dirPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const files: string[] = [];

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isFile()) {
          files.push(fullPath);
        } else if (entry.isDirectory()) {
          const subFiles = await this.scanDirectory(fullPath);
          files.push(...subFiles);
        }
      }

      return files;
    } catch (error) {
      return [];
    }
  }

  private async collectLogs(logDir: string): Promise<Record<string, string>> {
    const logs: Record<string, string> = {};

    try {
      const files = await fs.readdir(logDir);
      for (const file of files) {
        if (file.endsWith('.log')) {
          const filePath = path.join(logDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          logs[file] = content;
        }
      }
    } catch (error) {
      // Log directory might not exist
    }

    return logs;
  }

  private async collectOutputs(workingDir: string): Promise<Record<string, any>> {
    const outputs: Record<string, any> = {};

    try {
      // Look for common output files
      const outputFiles = ['output.json', 'result.json', 'response.json'];
      
      for (const fileName of outputFiles) {
        const filePath = path.join(workingDir, fileName);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          outputs[fileName] = JSON.parse(content);
        } catch (error) {
          // File doesn't exist or isn't valid JSON
        }
      }

    } catch (error) {
      // Working directory might not exist
    }

    return outputs;
  }

  private getPriorityNumber(priority: string): number {
    switch (priority) {
      case 'critical': return 0;
      case 'high': return 1;
      case 'normal': return 2;
      case 'low': return 3;
      case 'background': return 4;
      default: return 2;
    }
  }

  private mergeWithDefaults(config: Partial<ExecutionConfig>): ExecutionConfig {
    return {
      timeoutMs: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
      retryAttempts: SWARM_CONSTANTS.MAX_RETRIES,
      killTimeout: 5000, // 5 seconds
      resourceLimits: {
        maxMemory: SWARM_CONSTANTS.DEFAULT_MEMORY_LIMIT,
        maxCpuTime: SWARM_CONSTANTS.DEFAULT_TASK_TIMEOUT,
        maxDiskSpace: 1024 * 1024 * 1024, // 1GB
        maxNetworkConnections: 10,
        maxFileHandles: 100,
        priority: 2
      },
      sandboxed: true,
      logLevel: 'info',
      captureOutput: true,
      streamOutput: false,
      enableMetrics: true,
      ...config
    };
  }

  private setupEventHandlers(): void {
    // Handle resource limit violations
    this.resourceMonitor.on('limit-violation', (data: any) => {
      this.logger.warn('Resource limit violation', data);
      
      const session = this.activeExecutions.get(data.sessionId);
      if (session) {
        session.stop('Resource limit violation').catch(error => {
          this.logger.error('Error stopping session due to resource violation', {
            sessionId: data.sessionId,
            error
          });
        });
      }
    });

    // Handle process pool events
    this.processPool.on('process-failed', (data: any) => {
      this.logger.error('Process failed in pool', data);
    });
  }
}

// ===== SUPPORTING CLASSES =====

class ExecutionSession {
  public id: string;
  public task: TaskDefinition;
  public agent: AgentState;
  public context: ExecutionContext;
  public config: ExecutionConfig;
  private logger: Logger;
  private process?: ChildProcess;
  private startTime?: Date;
  private endTime?: Date;

  constructor(
    id: string,
    task: TaskDefinition,
    agent: AgentState,
    context: ExecutionContext,
    config: ExecutionConfig,
    logger: Logger
  ) {
    this.id = id;
    this.task = task;
    this.agent = agent;
    this.context = context;
    this.config = config;
    this.logger = logger;
  }

  async execute(): Promise<ExecutionResult> {
    this.startTime = new Date();
    
    // Implementation would go here for actual task execution
    // This is a placeholder that simulates execution
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    this.endTime = new Date();
    
    return {
      success: true,
      output: 'Task completed successfully',
      exitCode: 0,
      duration: this.endTime.getTime() - this.startTime.getTime(),
      resourcesUsed: {
        cpuTime: 1000,
        maxMemory: 50 * 1024 * 1024,
        diskIO: 1024,
        networkIO: 0,
        fileHandles: 5
      },
      artifacts: {},
      metadata: {
        sessionId: this.id,
        agentId: this.agent.id.id,
        taskId: this.task.id.id
      }
    };
  }

  async stop(reason: string): Promise<void> {
    this.logger.info('Stopping execution session', { sessionId: this.id, reason });
    
    if (this.process) {
      this.process.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  async cleanup(): Promise<void> {
    // Cleanup temporary files and resources
    try {
      await fs.rm(this.context.tempDirectory, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  }
}

class ResourceMonitor extends EventEmitter {
  private activeMonitors: Map<string, NodeJS.Timeout> = new Map();
  private usage: Map<string, ResourceUsage> = new Map();

  async initialize(): Promise<void> {
    // Initialize resource monitoring
  }

  async shutdown(): Promise<void> {
    // Stop all monitors
    for (const [sessionId, timer] of this.activeMonitors) {
      clearInterval(timer);
    }
    this.activeMonitors.clear();
  }

  startMonitoring(sessionId: string, limits: ExecutionResources): void {
    const timer = setInterval(() => {
      this.checkResources(sessionId, limits);
    }, 1000);
    
    this.activeMonitors.set(sessionId, timer);
  }

  stopMonitoring(sessionId: string): void {
    const timer = this.activeMonitors.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.activeMonitors.delete(sessionId);
    }
  }

  getUsage(sessionId: string): ResourceUsage {
    return this.usage.get(sessionId) || {
      cpuTime: 0,
      maxMemory: 0,
      diskIO: 0,
      networkIO: 0,
      fileHandles: 0
    };
  }

  getUtilization(): Record<string, number> {
    // Return overall system utilization
    return {
      cpu: 0.1,
      memory: 0.2,
      disk: 0.05,
      network: 0.01
    };
  }

  private checkResources(sessionId: string, limits: ExecutionResources): void {
    // Check if any limits are exceeded
    const usage = this.collectCurrentUsage(sessionId);
    this.usage.set(sessionId, usage);

    if (usage.maxMemory > limits.maxMemory) {
      this.emit('limit-violation', {
        sessionId,
        type: 'memory',
        current: usage.maxMemory,
        limit: limits.maxMemory
      });
    }

    if (usage.cpuTime > limits.maxCpuTime) {
      this.emit('limit-violation', {
        sessionId,
        type: 'cpu',
        current: usage.cpuTime,
        limit: limits.maxCpuTime
      });
    }
  }

  private collectCurrentUsage(sessionId: string): ResourceUsage {
    // Collect actual resource usage - this would interface with system APIs
    return {
      cpuTime: Math.random() * 1000,
      maxMemory: Math.random() * 100 * 1024 * 1024,
      diskIO: Math.random() * 1024,
      networkIO: Math.random() * 1024,
      fileHandles: Math.floor(Math.random() * 10)
    };
  }
}

// ===== UNIFIED PROCESS EXECUTOR INTERFACE =====

export interface IProcessExecutor {
  execute(command: ProcessCommand): Promise<ProcessResult>;
  validateInput(input: string[]): boolean;
  sanitizeArgs(args: string[]): string[];
  shutdown(): Promise<void>;
}

export interface ProcessCommand {
  command: string;
  args: string[];
  input?: string;
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  detached?: boolean;
}

export interface ProcessResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  pid?: number;
  signal?: string;
}

class ProcessPool extends EventEmitter implements IProcessExecutor {
  private config: ExecutionConfig;
  private totalExecutions = 0;
  private totalDuration = 0;
  private successCount = 0;
  private errorCount = 0;
  private activeProcesses = new Map<string, ChildProcess>();
  private processMetrics = new Map<string, ProcessMetrics>();

  constructor(config: ExecutionConfig) {
    super();
    this.config = config;
  }

  async initialize(): Promise<void> {
    // Initialize process pool
  }

  async shutdown(): Promise<void> {
    // Kill all active processes
    const killPromises = Array.from(this.activeProcesses.values())
      .map(process => this.killProcess(process));
    
    await Promise.allSettled(killPromises);
    this.activeProcesses.clear();
    this.processMetrics.clear();
  }

  async execute(command: ProcessCommand): Promise<ProcessResult> {
    const processId = generateId('process');
    const startTime = Date.now();
    
    this.totalExecutions++;
    
    // Validate and sanitize inputs
    if (!this.validateInput([command.command, ...command.args])) {
      throw new Error('Invalid command or arguments');
    }
    
    const sanitizedArgs = this.sanitizeArgs(command.args);
    
    return new Promise((resolve, reject) => {
      // Use traced spawn for process execution
      const childProcess = spawn(command.command, sanitizedArgs, {
        cwd: command.cwd || process.cwd(),
        env: command.env ? { ...process.env, ...command.env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: command.detached || false
      });

      if (!childProcess.pid) {
        this.errorCount++;
        reject(new Error('Failed to spawn process'));
        return;
      }

      this.activeProcesses.set(processId, childProcess);
      this.processMetrics.set(processId, {
        startTime,
        pid: childProcess.pid,
        command: command.command,
        args: sanitizedArgs
      });

      let stdout = '';
      let stderr = '';
      let isTimeout = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Set up timeout if specified
      if (command.timeout) {
        timeoutHandle = setTimeout(() => {
          isTimeout = true;
          this.killProcess(childProcess);
        }, command.timeout);
      }

      // Collect output
      if (childProcess.stdout) {
        childProcess.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });
      }

      if (childProcess.stderr) {
        childProcess.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });
      }

      // Handle process completion
      childProcess.on('close', (code: number | null, signal: string | null) => {
        const duration = Date.now() - startTime;
        const exitCode = code || 0;
        
        // Clear timeout
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        
        // Update metrics
        this.totalDuration += duration;
        if (!isTimeout && exitCode === 0) {
          this.successCount++;
        } else {
          this.errorCount++;
        }
        
        // Cleanup
        this.activeProcesses.delete(processId);
        this.processMetrics.delete(processId);
        
        const result: ProcessResult = {
          success: !isTimeout && exitCode === 0,
          exitCode,
          stdout,
          stderr,
          duration
        };
        if (childProcess.pid !== undefined) {
          result.pid = childProcess.pid;
        }
        if (signal) {
          result.signal = signal;
        }
        
        if (isTimeout) {
          result.stderr = `Process timed out after ${command.timeout}ms`;
        }
        
        resolve(result);
      });

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        this.errorCount++;
        
        // Clear timeout
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        
        // Cleanup
        this.activeProcesses.delete(processId);
        this.processMetrics.delete(processId);
        
        reject(error);
      });

      // Send input if provided
      if (command.input && childProcess.stdin) {
        childProcess.stdin.write(command.input);
        childProcess.stdin.end();
      }

      // If detached, unreference to allow parent to exit
      if (command.detached) {
        childProcess.unref();
      }
    });
  }

  validateInput(input: string[]): boolean {
    if (!input || input.length === 0) {
      return false;
    }
    
    // Check for dangerous commands
    const dangerousCommands = ['rm', 'del', 'format', 'fdisk', 'mkfs'];
    const firstInput = input[0];
    if (!firstInput) {
      return false;
    }
    const command = path.basename(firstInput).toLowerCase();
    
    if (dangerousCommands.includes(command)) {
      return false;
    }
    
    // Check for shell injection patterns
    const shellPatterns = [';', '&&', '||', '|', '>', '<', '`', '$'];
    const fullCommand = input.join(' ');
    
    return !shellPatterns.some(pattern => fullCommand.includes(pattern));
  }

  sanitizeArgs(args: string[]): string[] {
    return args.map(arg => {
      // Remove dangerous characters but preserve necessary ones
      return arg.replace(/[;&|><`$]/g, '');
    });
  }

  private async killProcess(process: ChildProcess): Promise<void> {
    if (process.killed) {
      return;
    }
    
    // Graceful shutdown first
    process.kill('SIGTERM');
    
    // Force kill after timeout
    setTimeout(() => {
      if (!process.killed) {
        process.kill('SIGKILL');
      }
    }, this.config.killTimeout || 5000);
  }

  getTotalExecutions(): number {
    return this.totalExecutions;
  }

  getAverageDuration(): number {
    return this.totalExecutions > 0 ? this.totalDuration / this.totalExecutions : 0;
  }

  getSuccessRate(): number {
    return this.totalExecutions > 0 ? this.successCount / this.totalExecutions : 0;
  }

  getErrorRate(): number {
    return this.totalExecutions > 0 ? this.errorCount / this.totalExecutions : 0;
  }

  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }
  
  getProcessMetrics(): ProcessMetrics[] {
    return Array.from(this.processMetrics.values());
  }
}

interface ProcessMetrics {
  startTime: number;
  pid: number;
  command: string;
  args: string[];
}

// ===== INTERFACES =====

export interface ClaudeExecutionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeout?: number;
  claudePath?: string;
  useStdin?: boolean;
  detached?: boolean;
  outputFormat?: string;
}

export interface ClaudeCommand {
  command: string;
  args: string[];
  input?: string;
}

export interface ExecutionMetrics {
  activeExecutions: number;
  totalExecutions: number;
  averageDuration: number;
  successRate: number;
  resourceUtilization: Record<string, number>;
  errorRate: number;
}

export default TaskExecutor;