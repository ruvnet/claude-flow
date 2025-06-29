/**
 * Process execution tracing with automatic child-process usage tracking
 * 
 * This module provides traced versions of child_process functions that automatically
 * track usage patterns, collect metrics, and enforce thresholds.
 */

import { spawn as _spawn, exec as _exec, execFile as _execFile, fork as _fork, ChildProcess } from 'node:child_process';
import type { SpawnOptions, ExecOptions, ExecFileOptions, ForkOptions } from 'node:child_process';
import { metrics } from './metrics.js';

export interface TracedSpawnOptions extends SpawnOptions {
  tracingEnabled?: boolean;
  processName?: string;
  processType?: 'service' | 'task' | 'tool' | 'agent' | 'swarm';
  parentId?: string;
  metadata?: Record<string, any>;
}

export interface TracedExecOptions extends ExecOptions {
  tracingEnabled?: boolean;
  processName?: string;
  processType?: 'service' | 'task' | 'tool' | 'agent' | 'swarm';
  parentId?: string;
  metadata?: Record<string, any>;
}

export interface TracedExecFileOptions extends ExecFileOptions {
  tracingEnabled?: boolean;
  processName?: string;
  processType?: 'service' | 'task' | 'tool' | 'agent' | 'swarm';
  parentId?: string;
  metadata?: Record<string, any>;
}

export interface TracedForkOptions extends ForkOptions {
  tracingEnabled?: boolean;
  processName?: string;
  processType?: 'service' | 'task' | 'tool' | 'agent' | 'swarm';
  parentId?: string;
  metadata?: Record<string, any>;
}

/**
 * Traced version of child_process.spawn
 * 
 * Automatically tracks process execution and collects metrics
 */
export function spawn(command: string, args: string[] = [], options: TracedSpawnOptions = {}): ChildProcess {
  const { tracingEnabled = true, processName, processType, parentId, metadata, ...spawnOptions } = options;
  
  // Record spawn in metrics
  let executionId = '';
  if (tracingEnabled) {
    executionId = metrics.recordSpawn(command, args, {
      processName,
      processType,
      parentId,
      metadata
    });
    
    // Console logging for visibility
    console.debug(`[spawn] ${command} ${args.join(' ')} (ID: ${executionId})`);
  }
  
  // Create the actual child process
  const childProcess = _spawn(command, args, spawnOptions);
  
  if (tracingEnabled && childProcess.pid) {
    // Set up event listeners to track completion
    const startTime = Date.now();
    
    childProcess.on('close', (code: number | null, signal: string | null) => {
      const duration = Date.now() - startTime;
      const success = code === 0;
      const error = !success ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : undefined;
      
      metrics.recordCompletion(executionId, success, code || undefined, error, childProcess.pid);
      
      console.debug(`[spawn-complete] ${command} (ID: ${executionId}) - Success: ${success}, Duration: ${duration}ms`);
    });
    
    childProcess.on('error', (error: Error) => {
      const duration = Date.now() - startTime;
      metrics.recordCompletion(executionId, false, -1, error.message, childProcess.pid);
      
      console.debug(`[spawn-error] ${command} (ID: ${executionId}) - Error: ${error.message}, Duration: ${duration}ms`);
    });
    
    // Store execution ID on the process for reference
    (childProcess as any)._tracingExecutionId = executionId;
  }
  
  return childProcess;
}

/**
 * Traced version of child_process.exec
 * 
 * Automatically tracks process execution and collects metrics
 */
export function exec(command: string, options?: TracedExecOptions): ChildProcess;
export function exec(command: string, options: TracedExecOptions, callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess;
export function exec(command: string, callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess;
export function exec(
  command: string,
  optionsOrCallback?: TracedExecOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  let options: TracedExecOptions = {};
  let execCallback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
  
  // Parse arguments
  if (typeof optionsOrCallback === 'function') {
    execCallback = optionsOrCallback;
  } else if (optionsOrCallback) {
    options = optionsOrCallback;
    execCallback = callback;
  }
  
  const { tracingEnabled = true, processName, processType, parentId, metadata, ...execOptions } = options;
  
  // Record spawn in metrics
  let executionId = '';
  if (tracingEnabled) {
    executionId = metrics.recordSpawn('exec', [command], {
      processName,
      processType,
      parentId,
      metadata
    });
    
    console.debug(`[exec] ${command} (ID: ${executionId})`);
  }
  
  // Wrap the callback to record completion
  const wrappedCallback = execCallback ? (error: Error | null, stdout: string, stderr: string) => {
    if (tracingEnabled) {
      const success = !error;
      metrics.recordCompletion(executionId, success, error ? -1 : 0, error?.message);
      
      console.debug(`[exec-complete] ${command} (ID: ${executionId}) - Success: ${success}`);
    }
    
    execCallback!(error, stdout, stderr);
  } : undefined;
  
  // Create the actual child process
  let childProcess: ChildProcess;
  if (wrappedCallback) {
    childProcess = _exec(command, execOptions, wrappedCallback);
  } else {
    childProcess = _exec(command, execOptions);
  }
  
  if (tracingEnabled && childProcess.pid) {
    // Store execution ID on the process for reference
    (childProcess as any)._tracingExecutionId = executionId;
    
    // If no callback was provided, set up event listeners
    if (!execCallback) {
      const startTime = Date.now();
      
      childProcess.on('close', (code: number | null, signal: string | null) => {
        const duration = Date.now() - startTime;
        const success = code === 0;
        const error = !success ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : undefined;
        
        metrics.recordCompletion(executionId, success, code || undefined, error, childProcess.pid);
        
        console.debug(`[exec-complete] ${command} (ID: ${executionId}) - Success: ${success}, Duration: ${duration}ms`);
      });
      
      childProcess.on('error', (error: Error) => {
        const duration = Date.now() - startTime;
        metrics.recordCompletion(executionId, false, -1, error.message, childProcess.pid);
        
        console.debug(`[exec-error] ${command} (ID: ${executionId}) - Error: ${error.message}, Duration: ${duration}ms`);
      });
    }
  }
  
  return childProcess;
}

/**
 * Traced version of child_process.execFile
 * 
 * Automatically tracks process execution and collects metrics
 */
export function execFile(file: string, args?: string[], options?: TracedExecFileOptions): ChildProcess;
export function execFile(file: string, args: string[], options: TracedExecFileOptions, callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess;
export function execFile(file: string, args: string[], callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess;
export function execFile(file: string, callback: (error: Error | null, stdout: string, stderr: string) => void): ChildProcess;
export function execFile(
  file: string,
  argsOrOptionsOrCallback?: string[] | TracedExecFileOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  optionsOrCallback?: TracedExecFileOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void
): ChildProcess {
  let args: string[] = [];
  let options: TracedExecFileOptions = {};
  let execCallback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
  
  // Parse arguments
  if (Array.isArray(argsOrOptionsOrCallback)) {
    args = argsOrOptionsOrCallback;
    if (typeof optionsOrCallback === 'function') {
      execCallback = optionsOrCallback;
    } else if (optionsOrCallback) {
      options = optionsOrCallback;
      execCallback = callback;
    }
  } else if (typeof argsOrOptionsOrCallback === 'function') {
    execCallback = argsOrOptionsOrCallback;
  } else if (argsOrOptionsOrCallback) {
    options = argsOrOptionsOrCallback;
    if (typeof optionsOrCallback === 'function') {
      execCallback = optionsOrCallback;
    }
  }
  
  const { tracingEnabled = true, processName, processType, parentId, metadata, ...execFileOptions } = options;
  
  // Record spawn in metrics
  let executionId = '';
  if (tracingEnabled) {
    executionId = metrics.recordSpawn(file, args, {
      processName,
      processType,
      parentId,
      metadata
    });
    
    console.debug(`[execFile] ${file} ${args.join(' ')} (ID: ${executionId})`);
  }
  
  // Wrap the callback to record completion
  const wrappedCallback = execCallback ? (error: Error | null, stdout: string, stderr: string) => {
    if (tracingEnabled) {
      const success = !error;
      metrics.recordCompletion(executionId, success, error ? -1 : 0, error?.message);
      
      console.debug(`[execFile-complete] ${file} (ID: ${executionId}) - Success: ${success}`);
    }
    
    execCallback!(error, stdout, stderr);
  } : undefined;
  
  // Create the actual child process
  let childProcess: ChildProcess;
  if (wrappedCallback) {
    if (args.length > 0) {
      childProcess = _execFile(file, args, execFileOptions, wrappedCallback);
    } else {
      childProcess = _execFile(file, execFileOptions as any, wrappedCallback);
    }
  } else {
    if (args.length > 0) {
      childProcess = _execFile(file, args, execFileOptions);
    } else {
      childProcess = _execFile(file, execFileOptions as any);
    }
  }
  
  if (tracingEnabled && childProcess.pid) {
    // Store execution ID on the process for reference
    (childProcess as any)._tracingExecutionId = executionId;
    
    // If no callback was provided, set up event listeners
    if (!execCallback) {
      const startTime = Date.now();
      
      childProcess.on('close', (code: number | null, signal: string | null) => {
        const duration = Date.now() - startTime;
        const success = code === 0;
        const error = !success ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : undefined;
        
        metrics.recordCompletion(executionId, success, code || undefined, error, childProcess.pid);
        
        console.debug(`[execFile-complete] ${file} (ID: ${executionId}) - Success: ${success}, Duration: ${duration}ms`);
      });
      
      childProcess.on('error', (error: Error) => {
        const duration = Date.now() - startTime;
        metrics.recordCompletion(executionId, false, -1, error.message, childProcess.pid);
        
        console.debug(`[execFile-error] ${file} (ID: ${executionId}) - Error: ${error.message}, Duration: ${duration}ms`);
      });
    }
  }
  
  return childProcess;
}

/**
 * Traced version of child_process.fork
 * 
 * Automatically tracks process execution and collects metrics
 */
export function fork(modulePath: string, args?: string[], options?: TracedForkOptions): ChildProcess {
  const { tracingEnabled = true, processName, processType, parentId, metadata, ...forkOptions } = options || {};
  
  // Record spawn in metrics
  let executionId = '';
  if (tracingEnabled) {
    executionId = metrics.recordSpawn('node', [modulePath, ...(args || [])], {
      processName,
      processType,
      parentId,
      metadata
    });
    
    console.debug(`[fork] ${modulePath} ${(args || []).join(' ')} (ID: ${executionId})`);
  }
  
  // Create the actual child process
  const childProcess = _fork(modulePath, args, forkOptions);
  
  if (tracingEnabled && childProcess.pid) {
    const startTime = Date.now();
    
    // Set up event listeners to track completion
    childProcess.on('close', (code: number | null, signal: string | null) => {
      const duration = Date.now() - startTime;
      const success = code === 0;
      const error = !success ? `Process exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : undefined;
      
      metrics.recordCompletion(executionId, success, code || undefined, error, childProcess.pid);
      
      console.debug(`[fork-complete] ${modulePath} (ID: ${executionId}) - Success: ${success}, Duration: ${duration}ms`);
    });
    
    childProcess.on('error', (error: Error) => {
      const duration = Date.now() - startTime;
      metrics.recordCompletion(executionId, false, -1, error.message, childProcess.pid);
      
      console.debug(`[fork-error] ${modulePath} (ID: ${executionId}) - Error: ${error.message}, Duration: ${duration}ms`);
    });
    
    // Store execution ID on the process for reference
    (childProcess as any)._tracingExecutionId = executionId;
  }
  
  return childProcess;
}

/**
 * Get the tracing execution ID for a child process
 */
export function getExecutionId(childProcess: ChildProcess): string | undefined {
  return (childProcess as any)._tracingExecutionId;
}

/**
 * Get current process execution metrics
 */
export function getMetrics() {
  return metrics.getMetrics();
}

/**
 * Get current spawn count
 */
export function getSpawnCount(): number {
  return metrics.getSpawnCount();
}

/**
 * Reset metrics
 */
export function resetMetrics(): void {
  metrics.reset();
}

/**
 * Export metrics report
 */
export function exportMetrics(): string {
  return metrics.exportMetrics();
}

/**
 * Check if spawn count threshold is exceeded
 */
export function isThresholdExceeded(): boolean {
  const currentMetrics = metrics.getMetrics();
  const threshold = 9; // Default threshold
  return currentMetrics.totalSpawns >= threshold;
}

// Re-export types for convenience
export { ChildProcess };
export type { SpawnOptions, ExecOptions, ExecFileOptions, ForkOptions };

// Re-export original functions for cases where tracing needs to be bypassed
export { _spawn as spawnOriginal, _exec as execOriginal, _execFile as execFileOriginal, _fork as forkOriginal };
