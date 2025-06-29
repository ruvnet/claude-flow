/**
 * Unified ProcessPool for consolidating all process execution
 * 
 * This consolidates all spawn() usage throughout the application into a single
 * interface that provides process management, monitoring, and resource control.
 */

import { ChildProcess } from '../tracing/index.js';
import { spawn } from '../tracing/index.js';
import { EventEmitter } from 'node:events';
import { Logger } from './logger.js';
import { registerChildProcess } from '../services/process-registry/integration.js';

export interface ProcessExecutionOptions {
  // Basic execution options
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  
  // Process management
  detached?: boolean;
  timeout?: number;
  killTimeout?: number;
  
  // I/O handling
  stdio?: 'inherit' | 'pipe' | 'ignore' | Array<'inherit' | 'pipe' | 'ignore'>;
  input?: string;
  captureOutput?: boolean;
  streamOutput?: boolean;
  
  // Monitoring and registry
  processName?: string;
  processType?: 'service' | 'task' | 'tool' | 'agent' | 'swarm';
  parentId?: string;
  metadata?: Record<string, any>;
  
  // Resource limits
  maxMemory?: number;
  maxCpuTime?: number;
  
  // Error handling
  retryAttempts?: number;
  retryDelay?: number;
}

export interface ProcessExecutionResult {
  success: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration: number;
  pid?: number;
  metadata: Record<string, any>;
}

export class ProcessPool extends EventEmitter {
  private static instance: ProcessPool | null = null;
  private logger: Logger;
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private executionCount = 0;
  private successCount = 0;
  private errorCount = 0;
  private totalDuration = 0;

  private constructor() {
    super();
    this.logger = new Logger(
      { level: 'info', format: 'text', destination: 'console' },
      { component: 'ProcessPool' }
    );
  }

  static getInstance(): ProcessPool {
    if (!ProcessPool.instance) {
      ProcessPool.instance = new ProcessPool();
    }
    return ProcessPool.instance;
  }

  /**
   * Execute a process with unified management
   */
  async execute(options: ProcessExecutionOptions): Promise<ProcessExecutionResult> {
    const executionId = `exec-${Date.now()}-${++this.executionCount}`;
    const startTime = Date.now();

    this.logger.info('Starting process execution', {
      executionId,
      command: options.command,
      args: options.args?.slice(0, 3), // Limit args logging
      processName: options.processName
    });

    try {
      const result = await this.executeWithRetry(executionId, options, startTime);
      this.successCount++;
      return result;
    } catch (error) {
      this.errorCount++;
      throw error;
    } finally {
      this.activeProcesses.delete(executionId);
    }
  }

  /**
   * Execute Claude command with specialized handling
   */
  async executeClaude(
    task: string,
    options: Omit<ProcessExecutionOptions, 'command'> & {
      tools?: string[];
      noPermissions?: boolean;
      config?: string;
      model?: string;
      claudePath?: string;
    }
  ): Promise<ProcessExecutionResult> {
    const claudeArgs: string[] = [];
    
    // Add prompt/task
    if (options.input) {
      claudeArgs.push('-p', task);
    } else {
      claudeArgs.push(task);
    }

    // Add tools
    if (options.tools && options.tools.length > 0) {
      claudeArgs.push('--allowedTools', options.tools.join(','));
    }

    // Add flags
    if (options.noPermissions) {
      claudeArgs.push('--dangerously-skip-permissions');
    }

    if (options.config) {
      claudeArgs.push('--mcp-config', options.config);
    }

    if (options.model) {
      claudeArgs.push('--model', options.model);
    }

    return this.execute({
      ...options,
      command: options.claudePath || 'claude',
      args: claudeArgs,
      processName: options.processName || 'claude-instance',
      processType: options.processType || 'agent'
    });
  }

  /**
   * Execute shell command with specialized handling
   */
  async executeShell(
    script: string,
    options: Omit<ProcessExecutionOptions, 'command' | 'args'> = {}
  ): Promise<ProcessExecutionResult> {
    return this.execute({
      ...options,
      command: 'bash',
      args: ['-c', script],
      processName: options.processName || 'shell-command',
      processType: options.processType || 'tool'
    });
  }

  /**
   * Execute Node.js script with specialized handling
   */
  async executeNode(
    scriptPath: string,
    args: string[] = [],
    options: Omit<ProcessExecutionOptions, 'command' | 'args'> = {}
  ): Promise<ProcessExecutionResult> {
    return this.execute({
      ...options,
      command: 'node',
      args: [scriptPath, ...args],
      processName: options.processName || 'node-script',
      processType: options.processType || 'service'
    });
  }

  /**
   * Kill a specific process
   */
  async killProcess(executionId: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const process = this.activeProcesses.get(executionId);
    if (process) {
      this.logger.info('Killing process', { executionId, signal });
      process.kill(signal);
    }
  }

  /**
   * Kill all active processes
   */
  async killAll(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    const promises = Array.from(this.activeProcesses.keys()).map(id => 
      this.killProcess(id, signal)
    );
    await Promise.allSettled(promises);
  }

  /**
   * Get execution statistics
   */
  getStats() {
    return {
      activeProcesses: this.activeProcesses.size,
      totalExecutions: this.executionCount,
      successCount: this.successCount,
      errorCount: this.errorCount,
      successRate: this.executionCount > 0 ? this.successCount / this.executionCount : 0,
      averageDuration: this.executionCount > 0 ? this.totalDuration / this.executionCount : 0
    };
  }

  private async executeWithRetry(
    executionId: string,
    options: ProcessExecutionOptions,
    startTime: number
  ): Promise<ProcessExecutionResult> {
    const maxRetries = options.retryAttempts || 0;
    const retryDelay = options.retryDelay || 1000;
    
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.executeSingle(executionId, options, startTime);
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          this.logger.warn('Process execution failed, retrying', {
            executionId,
            attempt: attempt + 1,
            maxRetries,
            error: lastError.message
          });
          
          if (retryDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }
    }

    throw lastError;
  }

  private async executeSingle(
    executionId: string,
    options: ProcessExecutionOptions,
    startTime: number
  ): Promise<ProcessExecutionResult> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 300000; // 5 minutes default
      const killTimeout = options.killTimeout || 5000; // 5 seconds default
      
      let outputBuffer = '';
      let errorBuffer = '';
      let isTimeout = false;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Prepare environment
      const env = {
        ...process.env,
        ...options.env
      };

      // Spawn process with tracing
      const childProcess = spawn(options.command, options.args || [], {
        cwd: options.cwd,
        env,
        stdio: options.stdio || 'pipe',
        detached: options.detached || false
      });

      if (!childProcess.pid) {
        reject(new Error(`Failed to spawn process: ${options.command}`));
        return;
      }

      // Register with process registry if options provided
      if (options.processName && options.parentId) {
        registerChildProcess(childProcess.pid, {
          name: options.processName,
          type: (options.processType === 'tool' ? 'service' : options.processType) || 'task',
          command: [options.command, ...(options.args || [])],
          parentId: options.parentId,
          metadata: options.metadata
        }).catch(error => {
          this.logger.warn('Failed to register child process', { error });
        });
      }

      // Track active process
      this.activeProcesses.set(executionId, childProcess);

      // Handle output capture
      if (options.captureOutput && childProcess.stdout) {
        childProcess.stdout.on('data', (data: Buffer) => {
          const chunk = data.toString();
          outputBuffer += chunk;
          
          if (options.streamOutput) {
            this.emit('output', {
              executionId,
              type: 'stdout',
              data: chunk
            });
          }
        });
      }

      if (options.captureOutput && childProcess.stderr) {
        childProcess.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          errorBuffer += chunk;
          
          if (options.streamOutput) {
            this.emit('output', {
              executionId,
              type: 'stderr',
              data: chunk
            });
          }
        });
      }

      // Handle process completion
      childProcess.on('close', (code: number | null, signal: string | null) => {
        const duration = Date.now() - startTime;
        this.totalDuration += duration;
        const exitCode = code || 0;

        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }

        this.logger.info('Process execution completed', {
          executionId,
          exitCode,
          signal,
          duration,
          isTimeout
        });

        const result: ProcessExecutionResult = {
          success: !isTimeout && exitCode === 0,
          exitCode,
          stdout: options.captureOutput ? outputBuffer : undefined,
          stderr: options.captureOutput ? errorBuffer : undefined,
          duration,
          pid: childProcess.pid,
          metadata: {
            executionId,
            timeout: isTimeout,
            signal,
            command: options.command,
            args: options.args
          }
        };

        if (isTimeout) {
          result.error = `Process timed out after ${timeout}ms`;
          reject(new Error(result.error));
        } else if (exitCode !== 0) {
          result.error = `Process exited with code ${exitCode}`;
          if (errorBuffer) {
            result.error += `: ${errorBuffer}`;
          }
          reject(new Error(result.error));
        } else {
          resolve(result);
        }
      });

      // Handle process errors
      childProcess.on('error', (error: Error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        
        this.logger.error('Process execution error', {
          executionId,
          error: error.message
        });
        
        reject(error);
      });

      // Send input if provided
      if (options.input && childProcess.stdin) {
        childProcess.stdin.write(options.input);
        childProcess.stdin.end();
      }

      // Setup timeout handling
      if (timeout > 0) {
        timeoutHandle = setTimeout(() => {
          isTimeout = true;
          this.logger.warn('Process execution timeout', {
            executionId,
            timeout,
            pid: childProcess.pid
          });

          // Graceful shutdown
          childProcess.kill('SIGTERM');

          // Force kill after grace period
          setTimeout(() => {
            if (!childProcess.killed) {
              this.logger.warn('Force killing process after timeout', {
                executionId,
                pid: childProcess.pid
              });
              childProcess.kill('SIGKILL');
            }
          }, killTimeout);
        }, timeout);
      }

      // If detached, unreference to allow parent to exit
      if (options.detached) {
        childProcess.unref();
      }
    });
  }
}

// Export singleton instance
export const processPool = ProcessPool.getInstance();