import { ChildProcess } from '../tracing/index.js';
import { EventEmitter } from 'node:events';
import { Logger } from '../core/logger.js';
import { generateId } from '../utils/helpers.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Unified process execution interface
interface ProcessPoolCommand {
  command: string;
  args: string[];
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    detached?: boolean;
    stdio?: import('child_process').StdioOptions;
  };
}

interface ProcessPoolResult {
  exitCode: number;
  output: string;
  error?: string;
  pid?: number;
}

class ProcessPool {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async executeCommand(cmd: ProcessPoolCommand): Promise<{ process: ChildProcess; result: Promise<ProcessPoolResult> }> {
    return new Promise((resolve, reject) => {
      // Import spawn only when needed for execution
      import('../tracing/index.js').then(({ spawn }) => {
        const childProcess: ChildProcess = spawn(cmd.command, cmd.args, {
          cwd: cmd.options?.cwd,
          env: { ...process.env, ...cmd.options?.env } as Record<string, string>,
          detached: cmd.options?.detached,
          stdio: cmd.options?.stdio || ['ignore', 'pipe', 'pipe']
        });

        const resultPromise = new Promise<ProcessPoolResult>((resultResolve) => {
          let stdout = '';
          let stderr = '';

          childProcess.stdout?.on('data', (data: any) => {
            stdout += data.toString();
          });

          childProcess.stderr?.on('data', (data: any) => {
            stderr += data.toString();
          });

          childProcess.on('close', (code: any) => {
            resultResolve({
              exitCode: code || 0,
              output: stdout,
              error: stderr,
              pid: childProcess.pid
            });
          });

          // Handle timeout if specified
          if (cmd.options?.timeout) {
            setTimeout(() => {
              if (!childProcess.killed) {
                childProcess.kill('SIGTERM');
              }
            }, cmd.options.timeout);
          }
        });

        resolve({ process: childProcess, result: resultPromise });
      }).catch(reject);
    });
  }
}

export interface BackgroundTask {
  id: string;
  type: 'claude-spawn' | 'script' | 'command';
  command: string;
  args: string[];
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    retries?: number;
    detached?: boolean;
  };
  status: 'pending' | 'running' | 'completed' | 'failed';
  pid?: number;
  output?: string;
  error?: string;
  startTime?: Date;
  endTime?: Date;
  retryCount: number;
}

export interface BackgroundExecutorConfig {
  maxConcurrentTasks: number;
  defaultTimeout: number;
  logPath: string;
  enablePersistence: boolean;
  checkInterval: number;
  cleanupInterval: number;
  maxRetries: number;
}

export class BackgroundExecutor extends EventEmitter {
  private logger: Logger;
  private config: BackgroundExecutorConfig;
  private tasks: Map<string, BackgroundTask>;
  private processes: Map<string, ChildProcess>;
  private queue: string[];
  private isRunning: boolean = false;
  private checkTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private processPool: ProcessPool;

  constructor(config: Partial<BackgroundExecutorConfig> = {}) {
    super();
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'BackgroundExecutor' });
    this.config = {
      maxConcurrentTasks: 5,
      defaultTimeout: 300000, // 5 minutes
      logPath: './background-tasks',
      enablePersistence: true,
      checkInterval: 1000, // 1 second
      cleanupInterval: 60000, // 1 minute
      maxRetries: 3,
      ...config
    };

    this.tasks = new Map();
    this.processes = new Map();
    this.queue = [];
    this.processPool = new ProcessPool(this.logger);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.logger.info('Starting background executor...');
    this.isRunning = true;

    // Create log directory
    if (this.config.enablePersistence) {
      await fs.mkdir(this.config.logPath, { recursive: true });
    }

    // Start background processing
    this.checkTimer = setInterval(() => {
      this.processQueue();
      this.checkRunningTasks();
    }, this.config.checkInterval);

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupCompletedTasks();
    }, this.config.cleanupInterval);

    this.emit('executor:started');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.logger.info('Stopping background executor...');
    this.isRunning = false;

    // Clear timers
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Kill all running processes
    for (const [taskId, process] of this.processes) {
      this.logger.warn(`Killing process for task ${taskId}`);
      process.kill('SIGTERM');
    }

    this.emit('executor:stopped');
  }

  async submitTask(
    type: BackgroundTask['type'],
    command: string,
    args: string[] = [],
    options: BackgroundTask['options'] = {}
  ): Promise<string> {
    const taskId = generateId('bgtask');
    const task: BackgroundTask = {
      id: taskId,
      type,
      command,
      args,
      options: {
        timeout: this.config.defaultTimeout,
        retries: this.config.maxRetries,
        ...options
      },
      status: 'pending',
      retryCount: 0
    };

    this.tasks.set(taskId, task);
    this.queue.push(taskId);

    if (this.config.enablePersistence) {
      await this.saveTaskState(task);
    }

    this.logger.info(`Submitted background task: ${taskId} - ${command}`);
    this.emit('task:submitted', task);

    // Process immediately if possible
    this.processQueue();

    return taskId;
  }

  async submitClaudeTask(
    prompt: string,
    tools: string[] = [],
    options: Partial<{
      cwd: string;
      env: Record<string, string>;
      timeout: number;
      model?: string;
      maxTokens?: number;
    }> = {}
  ): Promise<string> {
    // Build claude command arguments
    const args = ['-p', prompt];
    
    if (tools.length > 0) {
      args.push('--allowedTools', tools.join(','));
    }

    if (options.model) {
      args.push('--model', options.model);
    }

    if (options.maxTokens) {
      args.push('--max-tokens', options.maxTokens.toString());
    }

    args.push('--dangerously-skip-permissions');

    return this.submitTask('claude-spawn', 'claude', args, {
      ...options,
      detached: true // Run in background
    });
  }

  private async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    // Check how many tasks are running
    const runningTasks = Array.from(this.tasks.values())
      .filter(t => t.status === 'running').length;

    const availableSlots = this.config.maxConcurrentTasks - runningTasks;

    // Process pending tasks
    for (let i = 0; i < availableSlots && this.queue.length > 0; i++) {
      const taskId = this.queue.shift();
      if (!taskId) continue;

      const task = this.tasks.get(taskId);
      if (!task || task.status !== 'pending') continue;

      await this.executeTask(task);
    }
  }

  private async executeTask(task: BackgroundTask): Promise<void> {
    try {
      task.status = 'running';
      task.startTime = new Date();

      this.logger.info(`Executing task ${task.id}: ${task.command} ${task.args.join(' ')}`);

      // Create log files for task
      const logDir = path.join(this.config.logPath, task.id);
      if (this.config.enablePersistence) {
        await fs.mkdir(logDir, { recursive: true });
      }

      // Spawn process using ProcessPool
      const processCommand: ProcessPoolCommand = {
        command: task.command,
        args: task.args,
        options: {
          cwd: task.options?.cwd,
          env: { ...process.env, ...task.options?.env } as Record<string, string>,
          detached: task.options?.detached,
          timeout: task.options?.timeout,
          stdio: ['ignore', 'pipe', 'pipe']
        }
      };

      const { process: childProcess, result } = await this.processPool.executeCommand(processCommand);

      task.pid = childProcess.pid;
      this.processes.set(task.id, childProcess);

      // Handle process output
      childProcess.stdout?.on('data', (data: any) => {
        this.emit('task:output', { taskId: task.id, data: data.toString() });
      });

      childProcess.stderr?.on('data', (data: any) => {
        this.emit('task:error', { taskId: task.id, data: data.toString() });
      });

      // Handle process completion
      result.then(async (processResult) => {
        task.endTime = new Date();
        task.output = processResult.output;
        task.error = processResult.error;

        if (processResult.exitCode === 0) {
          task.status = 'completed';
          this.logger.info(`Task ${task.id} completed successfully`);
          this.emit('task:completed', task);
        } else {
          task.status = 'failed';
          this.logger.error(`Task ${task.id} failed with code ${processResult.exitCode}`);
          
          // Retry logic
          if (task.retryCount < (task.options?.retries || 0)) {
            task.retryCount++;
            task.status = 'pending';
            this.queue.push(task.id);
            this.logger.info(`Retrying task ${task.id} (${task.retryCount}/${task.options?.retries})`);
            this.emit('task:retry', task);
          } else {
            this.emit('task:failed', task);
          }
        }

        this.processes.delete(task.id);

        if (this.config.enablePersistence) {
          await this.saveTaskOutput(task);
        }
      }).catch(async (error) => {
        task.status = 'failed';
        task.error = String(error);
        task.endTime = new Date();
        
        this.logger.error(`Task ${task.id} process error:`, error);
        this.emit('task:failed', task);
        this.processes.delete(task.id);

        if (this.config.enablePersistence) {
          await this.saveTaskState(task);
        }
      });

      // Set timeout if specified
      if (task.options?.timeout) {
        setTimeout(() => {
          if (this.processes.has(task.id)) {
            this.logger.warn(`Task ${task.id} timed out after ${task.options?.timeout}ms`);
            childProcess.kill('SIGTERM');
          }
        }, task.options.timeout);
      }

      // For detached processes, unref to allow main process to exit
      if (task.options?.detached) {
        childProcess.unref();
      }

      this.emit('task:started', task);

      if (this.config.enablePersistence) {
        await this.saveTaskState(task);
      }

    } catch (error) {
      task.status = 'failed';
      task.error = String(error);
      task.endTime = new Date();
      
      this.logger.error(`Failed to execute task ${task.id}:`, error);
      this.emit('task:failed', task);

      if (this.config.enablePersistence) {
        await this.saveTaskState(task);
      }
    }
  }

  private checkRunningTasks(): void {
    // Check for hung or timed out tasks
    const now = Date.now();

    for (const [taskId, task] of this.tasks) {
      if (task.status !== 'running' || !task.startTime) continue;

      const runtime = now - task.startTime.getTime();
      const timeout = task.options?.timeout || this.config.defaultTimeout;

      if (runtime > timeout) {
        const process = this.processes.get(taskId);
        if (process) {
          this.logger.warn(`Killing timed out task ${taskId}`);
          process.kill('SIGTERM');
          
          // Force kill after 5 seconds
          setTimeout(() => {
            if (this.processes.has(taskId)) {
              process.kill('SIGKILL');
            }
          }, 5000);
        }
      }
    }
  }

  private cleanupCompletedTasks(): void {
    const cutoffTime = Date.now() - 3600000; // 1 hour

    for (const [taskId, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        if (task.endTime && task.endTime.getTime() < cutoffTime) {
          this.tasks.delete(taskId);
          this.logger.debug(`Cleaned up old task: ${taskId}`);
        }
      }
    }
  }

  private async saveTaskState(task: BackgroundTask): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      const taskFile = path.join(this.config.logPath, task.id, 'task.json');
      await fs.writeFile(taskFile, JSON.stringify(task, null, 2));
    } catch (error) {
      this.logger.error(`Failed to save task state for ${task.id}:`, error);
    }
  }

  private async saveTaskOutput(task: BackgroundTask): Promise<void> {
    if (!this.config.enablePersistence) return;

    try {
      const logDir = path.join(this.config.logPath, task.id);
      
      if (task.output) {
        await fs.writeFile(path.join(logDir, 'stdout.log'), task.output);
      }
      
      if (task.error) {
        await fs.writeFile(path.join(logDir, 'stderr.log'), task.error);
      }

      // Save final task state
      await this.saveTaskState(task);
    } catch (error) {
      this.logger.error(`Failed to save task output for ${task.id}:`, error);
    }
  }

  // Public API methods
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  getTasks(status?: BackgroundTask['status']): BackgroundTask[] {
    const tasks = Array.from(this.tasks.values());
    return status ? tasks.filter(t => t.status === status) : tasks;
  }

  async waitForTask(taskId: string, timeout?: number): Promise<BackgroundTask> {
    return new Promise((resolve, reject) => {
      const task = this.tasks.get(taskId);
      if (!task) {
        reject(new Error('Task not found'));
        return;
      }

      if (task.status === 'completed' || task.status === 'failed') {
        resolve(task);
        return;
      }

      const timeoutHandle = timeout ? setTimeout(() => {
        reject(new Error('Wait timeout'));
      }, timeout) : undefined;

      const checkTask = () => {
        const currentTask = this.tasks.get(taskId);
        if (!currentTask) {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(new Error('Task disappeared'));
          return;
        }

        if (currentTask.status === 'completed' || currentTask.status === 'failed') {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(currentTask);
        } else {
          setTimeout(checkTask, 100);
        }
      };

      checkTask();
    });
  }

  async killTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const process = this.processes.get(taskId);
    if (process) {
      this.logger.info(`Killing task ${taskId}`);
      process.kill('SIGTERM');
      
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.processes.has(taskId)) {
          process.kill('SIGKILL');
        }
      }, 5000);
    }

    task.status = 'failed';
    task.error = 'Task killed by user';
    task.endTime = new Date();
    
    this.emit('task:killed', task);
  }

  getStatus(): {
    running: number;
    pending: number;
    completed: number;
    failed: number;
    queueLength: number;
  } {
    const tasks = Array.from(this.tasks.values());
    return {
      running: tasks.filter(t => t.status === 'running').length,
      pending: tasks.filter(t => t.status === 'pending').length,
      completed: tasks.filter(t => t.status === 'completed').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      queueLength: this.queue.length
    };
  }

  /**
   * Execute a background task request
   */
  async execute(request: any): Promise<string> {
    this.logger.info('Executing background request', { request });
    
    // Start the executor if not already running
    if (!this.isRunning) {
      await this.start();
    }
    
    // Submit the request as a background task
    if (request.coordinator && request.objective) {
      // This is a swarm coordination request
      return this.submitTask(
        'script',
        'node',
        ['-e', `console.log('Executing swarm: ${request.objective}');`],
        {
          cwd: process.cwd(),
          timeout: 300000 // 5 minutes
        }
      );
    }
    
    // Generic command execution
    return this.submitTask(
      'command',
      request.command || 'echo',
      request.args || ['Background task executed'],
      request.options || {}
    );
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up background executor...');
    
    // Stop the executor
    await this.stop();
    
    // Clear all tasks and processes
    this.tasks.clear();
    this.processes.clear();
    this.queue.length = 0;
    
    this.emit('executor:cleanup');
  }
}