/**
 * Container Worker Pool
 * Docker-based worker pool for high-throughput headless execution.
 *
 * ADR-020: Headless Worker Integration Architecture - Phase 3
 * - Manages pool of Docker containers for isolated worker execution
 * - Supports dynamic scaling based on workload
 * - Provides container lifecycle management
 * - Integrates with WorkerQueue for task distribution
 *
 * Key Features:
 * - Container pooling with configurable size
 * - Health checking and auto-recovery
 * - Resource limits (CPU, memory)
 * - Volume mounting for workspace access
 * - Network isolation per worker type
 */

import { EventEmitter } from 'events';
import { spawn, exec, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { HeadlessWorkerType, HeadlessExecutionResult, SandboxMode } from './headless-worker-executor.js';

const execAsync = promisify(exec);

// ============================================
// Type Definitions
// ============================================

/**
 * Container state
 */
export type ContainerState = 'creating' | 'ready' | 'busy' | 'unhealthy' | 'terminated';

/**
 * Container info
 */
export interface ContainerInfo {
  id: string;
  name: string;
  state: ContainerState;
  createdAt: Date;
  lastUsedAt?: Date;
  workerType?: HeadlessWorkerType;
  executionCount: number;
  healthCheckFailures: number;
  pid?: number;
}

/**
 * Container pool configuration
 */
export interface ContainerPoolConfig {
  /** Maximum number of containers in the pool */
  maxContainers: number;

  /** Minimum number of containers to keep warm */
  minContainers: number;

  /** Docker image to use */
  image: string;

  /** Container resource limits */
  resources: {
    cpus: string;
    memory: string;
  };

  /** Health check interval in ms */
  healthCheckIntervalMs: number;

  /** Container idle timeout in ms */
  idleTimeoutMs: number;

  /** Workspace volume mount path */
  workspacePath: string;

  /** State persistence path */
  statePath: string;

  /** Network name for container isolation */
  network?: string;

  /** Environment variables for containers */
  env?: Record<string, string>;

  /** Default sandbox mode */
  defaultSandbox: SandboxMode;
}

/**
 * Container execution options
 */
export interface ContainerExecutionOptions {
  workerType: HeadlessWorkerType;
  prompt: string;
  contextPatterns?: string[];
  sandbox?: SandboxMode;
  model?: string;
  timeoutMs?: number;
}

/**
 * Pool status
 */
export interface ContainerPoolStatus {
  totalContainers: number;
  readyContainers: number;
  busyContainers: number;
  unhealthyContainers: number;
  queuedTasks: number;
  containers: ContainerInfo[];
  dockerAvailable: boolean;
  lastHealthCheck?: Date;
}

// ============================================
// Constants
// ============================================

const DEFAULT_CONFIG: ContainerPoolConfig = {
  maxContainers: 3,
  minContainers: 1,
  image: 'ghcr.io/ruvnet/claude-flow-headless:latest',
  resources: {
    cpus: '2',
    memory: '4g',
  },
  healthCheckIntervalMs: 30000,
  idleTimeoutMs: 300000, // 5 minutes
  workspacePath: '/workspace',
  statePath: '.claude-flow/container-pool',
  defaultSandbox: 'strict',
};

// ============================================
// ContainerWorkerPool Class
// ============================================

/**
 * ContainerWorkerPool - Manages Docker containers for headless worker execution
 */
export class ContainerWorkerPool extends EventEmitter {
  private config: ContainerPoolConfig;
  private projectRoot: string;
  private containers: Map<string, ContainerInfo> = new Map();
  private taskQueue: Array<{
    options: ContainerExecutionOptions;
    resolve: (result: HeadlessExecutionResult) => void;
    reject: (error: Error) => void;
    queuedAt: Date;
  }> = [];
  private healthCheckTimer?: NodeJS.Timeout;
  private idleCheckTimer?: NodeJS.Timeout;
  private dockerAvailable: boolean | null = null;
  private initialized = false;
  private isShuttingDown = false;
  private exitHandlersRegistered = false;

  constructor(projectRoot: string, config?: Partial<ContainerPoolConfig>) {
    super();
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Ensure state directory exists
    const stateDir = join(projectRoot, this.config.statePath);
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Initialize the container pool
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    // Check Docker availability
    this.dockerAvailable = await this.checkDockerAvailable();
    if (!this.dockerAvailable) {
      this.emit('warning', { message: 'Docker not available - container pool disabled' });
      return false;
    }

    // Pull image if needed
    await this.ensureImage();

    // Create minimum containers
    await this.scaleToMinimum();

    // Start health check timer
    this.startHealthChecks();

    // Start idle check timer
    this.startIdleChecks();

    // Register exit handlers for cleanup
    this.registerExitHandlers();

    this.initialized = true;
    this.emit('initialized', { containers: this.containers.size });

    return true;
  }

  /**
   * Register process exit handlers to clean up containers
   */
  private registerExitHandlers(): void {
    if (this.exitHandlersRegistered) return;

    const cleanup = async () => {
      if (!this.isShuttingDown) {
        await this.shutdown();
      }
    };

    process.once('SIGTERM', cleanup);
    process.once('SIGINT', cleanup);
    process.once('beforeExit', cleanup);

    this.exitHandlersRegistered = true;
  }

  /**
   * Execute a worker in a container
   */
  async execute(options: ContainerExecutionOptions): Promise<HeadlessExecutionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.dockerAvailable) {
      return this.createErrorResult(options.workerType, 'Docker not available');
    }

    // Try to get a ready container
    const container = this.getReadyContainer();

    if (container) {
      return this.executeInContainer(container, options);
    }

    // No ready containers - check if we can create more
    if (this.containers.size < this.config.maxContainers) {
      const newContainer = await this.createContainer();
      if (newContainer) {
        return this.executeInContainer(newContainer, options);
      }
    }

    // Queue the task
    return new Promise((resolve, reject) => {
      this.taskQueue.push({
        options,
        resolve,
        reject,
        queuedAt: new Date(),
      });
      this.emit('taskQueued', {
        workerType: options.workerType,
        queuePosition: this.taskQueue.length,
      });
    });
  }

  /**
   * Scale pool for batch execution
   */
  async scaleForBatch(workerCount: number): Promise<void> {
    const targetSize = Math.min(workerCount, this.config.maxContainers);
    const currentSize = this.containers.size;

    if (targetSize > currentSize) {
      const toCreate = targetSize - currentSize;
      const createPromises: Promise<ContainerInfo | null>[] = [];

      for (let i = 0; i < toCreate; i++) {
        createPromises.push(this.createContainer());
      }

      await Promise.all(createPromises);
      this.emit('scaled', { from: currentSize, to: this.containers.size });
    }
  }

  /**
   * Get pool status
   */
  getStatus(): ContainerPoolStatus {
    const containers = Array.from(this.containers.values());
    return {
      totalContainers: containers.length,
      readyContainers: containers.filter(c => c.state === 'ready').length,
      busyContainers: containers.filter(c => c.state === 'busy').length,
      unhealthyContainers: containers.filter(c => c.state === 'unhealthy').length,
      queuedTasks: this.taskQueue.length,
      containers,
      dockerAvailable: this.dockerAvailable ?? false,
      lastHealthCheck: undefined, // Will be set by health check
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    // Stop timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = undefined;
    }

    // Reject queued tasks
    for (const task of this.taskQueue) {
      task.reject(new Error('Pool shutting down'));
    }
    this.taskQueue = [];

    // Terminate all containers with timeout
    const terminatePromises: Promise<void>[] = [];
    for (const [id] of this.containers) {
      terminatePromises.push(
        this.terminateContainer(id).catch(() => {
          // Ignore errors during shutdown
        })
      );
    }

    // Wait for all containers with 30s timeout
    await Promise.race([
      Promise.all(terminatePromises),
      new Promise<void>(resolve => setTimeout(resolve, 30000)),
    ]);

    this.initialized = false;
    this.emit('shutdown', {});
  }

  // ============================================
  // Private Methods - Container Lifecycle
  // ============================================

  /**
   * Check if Docker is available (async)
   */
  private async checkDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker --version', { timeout: 5000 });
      await execAsync('docker info', { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the container image exists (async)
   */
  private async ensureImage(): Promise<void> {
    try {
      await execAsync(`docker image inspect ${this.config.image}`, { timeout: 10000 });
    } catch {
      // Image not found, try to pull
      this.emit('imagePull', { image: this.config.image });
      try {
        await execAsync(`docker pull ${this.config.image}`, { timeout: 300000 });
      } catch (error) {
        this.emit('warning', { message: `Failed to pull image: ${error}` });
        // Continue anyway - might work with local image
      }
    }
  }

  /**
   * Create a new container
   */
  private async createContainer(): Promise<ContainerInfo | null> {
    const id = `cf-worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const name = `claude-flow-worker-${id}`;

    const containerInfo: ContainerInfo = {
      id,
      name,
      state: 'creating',
      createdAt: new Date(),
      executionCount: 0,
      healthCheckFailures: 0,
    };

    this.containers.set(id, containerInfo);
    this.emit('containerCreating', { id, name });

    try {
      // Build docker run command
      const args = [
        'run', '-d',
        '--name', name,
        '--cpus', this.config.resources.cpus,
        '--memory', this.config.resources.memory,
        '-v', `${this.projectRoot}:${this.config.workspacePath}:ro`,
        '-v', `${join(this.projectRoot, this.config.statePath)}:/root/.claude-flow`,
        '-w', this.config.workspacePath,
      ];

      // Add environment variables
      const env = {
        ...this.config.env,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        CLAUDE_CODE_HEADLESS: 'true',
        CLAUDE_CODE_SANDBOX_MODE: this.config.defaultSandbox,
      };

      for (const [key, value] of Object.entries(env)) {
        if (value) {
          args.push('-e', `${key}=${value}`);
        }
      }

      // Add network if specified
      if (this.config.network) {
        args.push('--network', this.config.network);
      }

      // Add image and entrypoint to keep container running
      args.push(this.config.image, 'tail', '-f', '/dev/null');

      // Create the container (async)
      const { stdout } = await execAsync(`docker ${args.join(' ')}`, { timeout: 60000 });
      const containerId = stdout.trim();

      containerInfo.state = 'ready';
      this.emit('containerCreated', { id, name, containerId });

      return containerInfo;
    } catch (error) {
      this.containers.delete(id);
      this.emit('containerError', { id, error: String(error) });
      return null;
    }
  }

  /**
   * Terminate a container (async)
   */
  private async terminateContainer(id: string): Promise<void> {
    const container = this.containers.get(id);
    if (!container) return;

    container.state = 'terminated';

    try {
      await execAsync(`docker rm -f ${container.name}`, { timeout: 30000 });
    } catch {
      // Ignore removal errors
    }

    this.containers.delete(id);
    this.emit('containerTerminated', { id, name: container.name });
  }

  /**
   * Get a ready container
   */
  private getReadyContainer(): ContainerInfo | null {
    for (const container of this.containers.values()) {
      if (container.state === 'ready') {
        return container;
      }
    }
    return null;
  }

  /**
   * Scale to minimum containers
   */
  private async scaleToMinimum(): Promise<void> {
    const current = this.containers.size;
    const needed = this.config.minContainers - current;

    if (needed > 0) {
      const createPromises: Promise<ContainerInfo | null>[] = [];
      for (let i = 0; i < needed; i++) {
        createPromises.push(this.createContainer());
      }
      await Promise.all(createPromises);
    }
  }

  // ============================================
  // Private Methods - Execution
  // ============================================

  /**
   * Execute worker in a specific container
   */
  private async executeInContainer(
    container: ContainerInfo,
    options: ContainerExecutionOptions
  ): Promise<HeadlessExecutionResult> {
    const startTime = Date.now();
    const executionId = `${options.workerType}_${startTime}_${Math.random().toString(36).slice(2, 8)}`;

    container.state = 'busy';
    container.workerType = options.workerType;
    container.lastUsedAt = new Date();

    this.emit('executionStart', { executionId, containerId: container.id, workerType: options.workerType });

    try {
      // Build the command to run inside container
      const command = this.buildWorkerCommand(options);

      // Execute in container with timeout
      const timeoutMs = options.timeoutMs || 300000;
      const output = await this.execInContainer(container.name, command, timeoutMs);

      container.state = 'ready';
      container.executionCount++;

      const result: HeadlessExecutionResult = {
        success: true,
        output: output,
        parsedOutput: this.tryParseJson(output),
        durationMs: Date.now() - startTime,
        model: options.model || 'sonnet',
        sandboxMode: options.sandbox || this.config.defaultSandbox,
        workerType: options.workerType,
        timestamp: new Date(),
        executionId,
      };

      this.emit('executionComplete', result);

      // Process queue
      this.processQueue();

      return result;
    } catch (error) {
      container.state = 'ready';

      const result = this.createErrorResult(
        options.workerType,
        error instanceof Error ? error.message : String(error)
      );
      result.executionId = executionId;
      result.durationMs = Date.now() - startTime;

      this.emit('executionError', result);

      // Process queue
      this.processQueue();

      return result;
    }
  }

  /**
   * Execute command in container
   */
  private async execInContainer(
    containerName: string,
    command: string[],
    timeoutMs: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['exec', containerName, ...command];

      const child = spawn('docker', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (timedOut) {
          reject(new Error(`Execution timed out after ${timeoutMs}ms`));
          return;
        }

        if (code !== 0) {
          reject(new Error(stderr || `Process exited with code ${code}`));
          return;
        }

        resolve(stdout);
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Build worker command for container execution
   */
  private buildWorkerCommand(options: ContainerExecutionOptions): string[] {
    // Use npx to run claude-flow daemon trigger
    return [
      'npx', 'claude-flow@v3alpha',
      'daemon', 'trigger',
      '-w', options.workerType,
      '--headless',
    ];
  }

  /**
   * Process queued tasks
   */
  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const container = this.getReadyContainer();
      if (!container) break;

      const task = this.taskQueue.shift();
      if (task) {
        this.executeInContainer(container, task.options)
          .then(task.resolve)
          .catch(task.reject);
      }
    }
  }

  // ============================================
  // Private Methods - Health & Maintenance
  // ============================================

  /**
   * Start health check timer
   */
  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.runHealthChecks();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Run health checks on all containers
   */
  private async runHealthChecks(): Promise<void> {
    for (const [id, container] of this.containers) {
      if (container.state === 'terminated') continue;

      try {
        // Check if container is running (async)
        const { stdout } = await execAsync(
          `docker inspect -f '{{.State.Running}}' ${container.name}`,
          { timeout: 10000 }
        );
        const output = stdout.trim();

        if (output !== 'true') {
          container.healthCheckFailures++;
          if (container.healthCheckFailures >= 3) {
            container.state = 'unhealthy';
            this.emit('containerUnhealthy', { id, name: container.name });

            // Remove and replace
            await this.terminateContainer(id);
            if (this.containers.size < this.config.minContainers) {
              await this.createContainer();
            }
          }
        } else {
          container.healthCheckFailures = 0;
        }
      } catch {
        container.healthCheckFailures++;
      }
    }

    this.emit('healthCheckComplete', { containers: this.containers.size });
  }

  /**
   * Start idle check timer
   */
  private startIdleChecks(): void {
    this.idleCheckTimer = setInterval(async () => {
      await this.runIdleChecks();
    }, 60000); // Check every minute
  }

  /**
   * Terminate idle containers above minimum
   */
  private async runIdleChecks(): Promise<void> {
    const now = Date.now();
    const readyContainers = Array.from(this.containers.values())
      .filter(c => c.state === 'ready')
      .sort((a, b) => (a.lastUsedAt?.getTime() || 0) - (b.lastUsedAt?.getTime() || 0));

    // Keep minimum containers
    const toTerminate = readyContainers.slice(this.config.minContainers);

    for (const container of toTerminate) {
      const lastUsed = container.lastUsedAt?.getTime() || container.createdAt.getTime();
      if (now - lastUsed > this.config.idleTimeoutMs) {
        await this.terminateContainer(container.id);
        this.emit('containerIdleTerminated', { id: container.id, name: container.name });
      }
    }
  }

  // ============================================
  // Private Methods - Utilities
  // ============================================

  /**
   * Try to parse JSON from output
   */
  private tryParseJson(output: string): unknown {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(output.trim());
    } catch {
      return undefined;
    }
  }

  /**
   * Create an error result
   */
  private createErrorResult(workerType: HeadlessWorkerType, error: string): HeadlessExecutionResult {
    return {
      success: false,
      output: '',
      durationMs: 0,
      model: 'unknown',
      sandboxMode: this.config.defaultSandbox,
      workerType,
      timestamp: new Date(),
      executionId: `error_${Date.now()}`,
      error,
    };
  }
}

// Export default
export default ContainerWorkerPool;
