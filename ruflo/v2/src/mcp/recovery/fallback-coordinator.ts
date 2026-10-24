/**
 * Fallback Coordinator for MCP
 * Manages graceful degradation to CLI when MCP connection fails
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../../core/logger.js';
import type { MCPRequest } from '../../utils/types.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface FallbackOperation {
  id: string;
  type: 'tool' | 'resource' | 'notification';
  method: string;
  params: unknown;
  timestamp: Date;
  priority: 'high' | 'medium' | 'low';
  retryable: boolean;
}

export interface FallbackConfig {
  enableFallback: boolean;
  maxQueueSize: number;
  queueTimeout: number;
  cliPath: string;
  fallbackNotificationInterval: number;
}

export interface FallbackState {
  isFallbackActive: boolean;
  queuedOperations: number;
  failedOperations: number;
  successfulOperations: number;
  lastFallbackActivation?: Date;
}

export class FallbackCoordinator extends EventEmitter {
  private operationQueue: FallbackOperation[] = [];
  private state: FallbackState;
  private notificationTimer?: NodeJS.Timeout;
  private processingQueue = false;

  private readonly defaultConfig: FallbackConfig = {
    enableFallback: true,
    maxQueueSize: 100,
    queueTimeout: 300000, // 5 minutes
    cliPath: 'npx ruv-swarm',
    fallbackNotificationInterval: 30000, // 30 seconds
  };

  constructor(
    private logger: ILogger,
    config?: Partial<FallbackConfig>,
  ) {
    super();
    this.config = { ...this.defaultConfig, ...config };

    this.state = {
      isFallbackActive: false,
      queuedOperations: 0,
      failedOperations: 0,
      successfulOperations: 0,
    };
  }

  private config: FallbackConfig;

  /**
   * Check if MCP is available
   */
  async isMCPAvailable(): Promise<boolean> {
    try {
      // Try to execute a simple MCP command
      const { stdout } = await execAsync(`${this.config.cliPath} status --json`);
      const status = JSON.parse(stdout);
      return status.connected === true;
    } catch (error) {
      this.logger.debug('MCP availability check failed', error);
      return false;
    }
  }

  /**
   * Enable CLI fallback mode
   */
  enableCLIFallback(): void {
    if (this.state.isFallbackActive) {
      this.logger.debug('Fallback already active');
      return;
    }

    this.logger.warn('Enabling CLI fallback mode');

    this.state.isFallbackActive = true;
    this.state.lastFallbackActivation = new Date();

    // Start notification timer
    this.startNotificationTimer();

    this.emit('fallbackEnabled', this.state);
  }

  /**
   * Disable CLI fallback mode
   */
  disableCLIFallback(): void {
    if (!this.state.isFallbackActive) {
      return;
    }

    this.logger.info('Disabling CLI fallback mode');

    this.state.isFallbackActive = false;

    // Stop notification timer
    this.stopNotificationTimer();

    this.emit('fallbackDisabled', this.state);

    // Process any queued operations
    if (this.operationQueue.length > 0) {
      this.processQueue().catch((error) => {
        this.logger.error('Error processing queue after fallback disabled', error);
      });
    }
  }

  /**
   * Queue an operation for later execution
   */
  queueOperation(operation: Omit<FallbackOperation, 'id' | 'timestamp'>): void {
    if (!this.config.enableFallback) {
      this.logger.debug('Fallback disabled, operation not queued');
      return;
    }

    if (this.operationQueue.length >= this.config.maxQueueSize) {
      this.logger.warn('Operation queue full, removing oldest operation');
      this.operationQueue.shift();
      this.state.failedOperations++;
    }

    const queuedOp: FallbackOperation = {
      ...operation,
      id: this.generateOperationId(),
      timestamp: new Date(),
    };

    this.operationQueue.push(queuedOp);
    this.state.queuedOperations = this.operationQueue.length;

    this.logger.debug('Operation queued', {
      id: queuedOp.id,
      type: queuedOp.type,
      method: queuedOp.method,
      queueSize: this.operationQueue.length,
    });

    this.emit('operationQueued', queuedOp);

    // If in fallback mode, try to execute via CLI
    if (this.state.isFallbackActive && !this.processingQueue) {
      this.executeViaCliFallback(queuedOp).catch((error) => {
        this.logger.error('CLI fallback execution failed', { operation: queuedOp, error });
      });
    }
  }

  /**
   * Process all queued operations
   */
  async processQueue(): Promise<void> {
    if (this.processingQueue || this.operationQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    this.logger.info('Processing operation queue', {
      queueSize: this.operationQueue.length,
    });

    this.emit('queueProcessingStart', this.operationQueue.length);

    const results = {
      successful: 0,
      failed: 0,
    };

    // Process operations in order
    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift()!;

      // Check if operation has expired
      if (this.isOperationExpired(operation)) {
        this.logger.warn('Operation expired', { id: operation.id });
        results.failed++;
        continue;
      }

      try {
        await this.replayOperation(operation);
        results.successful++;
        this.state.successfulOperations++;
      } catch (error) {
        this.logger.error('Failed to replay operation', {
          operation,
          error,
        });
        results.failed++;
        this.state.failedOperations++;

        // Re-queue if retryable
        if (operation.retryable) {
          this.operationQueue.push(operation);
        }
      }
    }

    this.state.queuedOperations = this.operationQueue.length;
    this.processingQueue = false;

    this.logger.info('Queue processing complete', results);
    this.emit('queueProcessingComplete', results);
  }

  /**
   * Get current fallback state
   */
  getState(): FallbackState {
    return { ...this.state };
  }

  /**
   * Get queued operations
   */
  getQueuedOperations(): FallbackOperation[] {
    return [...this.operationQueue];
  }

  /**
   * Clear operation queue
   */
  clearQueue(): void {
    const clearedCount = this.operationQueue.length;
    this.operationQueue = [];
    this.state.queuedOperations = 0;

    this.logger.info('Operation queue cleared', { clearedCount });
    this.emit('queueCleared', clearedCount);
  }

  private async executeViaCliFallback(operation: FallbackOperation): Promise<void> {
    this.logger.debug('Executing operation via CLI fallback', {
      id: operation.id,
      method: operation.method,
    });

    try {
      // Map MCP operations to CLI commands
      const cliCommand = this.mapOperationToCli(operation);

      if (!cliCommand) {
        throw new Error(`No CLI mapping for operation: ${operation.method}`);
      }

      const { stdout, stderr } = await execAsync(cliCommand);

      if (stderr) {
        this.logger.warn('CLI command stderr', { stderr });
      }

      this.logger.debug('CLI fallback execution successful', {
        id: operation.id,
        stdout: stdout.substring(0, 200), // Log first 200 chars
      });

      this.state.successfulOperations++;
      this.emit('fallbackExecutionSuccess', { operation, result: stdout });
    } catch (error) {
      this.logger.error('CLI fallback execution failed', {
        operation,
        error,
      });

      this.state.failedOperations++;
      this.emit('fallbackExecutionFailed', { operation, error });

      // Re-queue if retryable
      if (operation.retryable) {
        this.queueOperation(operation);
      }
    }
  }

  private async replayOperation(operation: FallbackOperation): Promise<void> {
    // This would typically use the MCP client to replay the operation
    // For now, we'll log it
    this.logger.info('Replaying operation', {
      id: operation.id,
      method: operation.method,
    });

    // Emit event for handling by the MCP client
    this.emit('replayOperation', operation);
  }

  private mapOperationToCli(operation: FallbackOperation): string | null {
    // Map common MCP operations to CLI commands
    const mappings: Record<string, (params: any) => string> = {
      // Tool operations
      'tools/list': () => `${this.config.cliPath} tools list`,
      'tools/call': (params) =>
        `${this.config.cliPath} tools call ${params.name} '${JSON.stringify(params.arguments)}'`,

      // Resource operations
      'resources/list': () => `${this.config.cliPath} resources list`,
      'resources/read': (params) => `${this.config.cliPath} resources read ${params.uri}`,

      // Session operations
      initialize: () => `${this.config.cliPath} session init`,
      shutdown: () => `${this.config.cliPath} session shutdown`,

      // Custom operations
      heartbeat: () => `${this.config.cliPath} health check`,
    };

    const mapper = mappings[operation.method];
    return mapper ? mapper(operation.params) : null;
  }

  private isOperationExpired(operation: FallbackOperation): boolean {
    const age = Date.now() - operation.timestamp.getTime();
    return age > this.config.queueTimeout;
  }

  private generateOperationId(): string {
    return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private startNotificationTimer(): void {
    if (this.notificationTimer) {
      return;
    }

    this.notificationTimer = setInterval(() => {
      if (this.state.isFallbackActive && this.operationQueue.length > 0) {
        this.logger.info('Fallback mode active', {
          queuedOperations: this.operationQueue.length,
          duration: Date.now() - (this.state.lastFallbackActivation?.getTime() || 0),
        });

        this.emit('fallbackStatus', this.state);
      }
    }, this.config.fallbackNotificationInterval);
  }

  private stopNotificationTimer(): void {
    if (this.notificationTimer) {
      clearInterval(this.notificationTimer);
      this.notificationTimer = undefined;
    }
  }
}
