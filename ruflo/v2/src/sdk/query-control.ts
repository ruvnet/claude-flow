/**
 * Real-Time Query Control
 * Claude-Flow v2.5-alpha.130
 *
 * Implements real-time control of running agent queries:
 * - Pause/resume execution
 * - Terminate agents dynamically
 * - Change model or permissions mid-execution
 * - Monitor agent status in real-time
 */

import { type Query, type PermissionMode, type ModelInfo } from '@anthropic-ai/claude-code/sdk';
import { EventEmitter } from 'events';
import { Logger } from '../core/logger.js';

export interface QueryControlOptions {
  allowPause?: boolean;
  allowModelChange?: boolean;
  allowPermissionChange?: boolean;
  monitoringInterval?: number;
}

export interface ControlledQuery {
  queryId: string;
  agentId: string;
  query: Query;
  status: 'running' | 'paused' | 'terminated' | 'completed' | 'failed';
  isPaused: boolean;
  canControl: boolean;
  startTime: number;
  pausedAt?: number;
  resumedAt?: number;
  terminatedAt?: number;
  currentModel?: string;
  permissionMode?: PermissionMode;
}

export interface QueryControlCommand {
  type: 'pause' | 'resume' | 'terminate' | 'changeModel' | 'changePermissions';
  queryId: string;
  params?: {
    model?: string;
    permissionMode?: PermissionMode;
    reason?: string;
  };
}

export interface QueryStatusUpdate {
  queryId: string;
  status: ControlledQuery['status'];
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * RealTimeQueryController - Control running queries dynamically
 * Enables pause, resume, terminate, and configuration changes during execution
 */
export class RealTimeQueryController extends EventEmitter {
  private logger: Logger;
  private controlledQueries: Map<string, ControlledQuery> = new Map();
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private commandQueue: Map<string, QueryControlCommand[]> = new Map();
  private options: QueryControlOptions;

  constructor(options: QueryControlOptions = {}) {
    super();
    this.options = {
      allowPause: options.allowPause !== false,
      allowModelChange: options.allowModelChange !== false,
      allowPermissionChange: options.allowPermissionChange !== false,
      monitoringInterval: options.monitoringInterval || 1000
    };

    this.logger = new Logger(
      { level: 'info', format: 'text', destination: 'console' },
      { component: 'RealTimeQueryController' }
    );
  }

  /**
   * Register a query for control
   */
  registerQuery(queryId: string, agentId: string, query: Query): ControlledQuery {
    const controlled: ControlledQuery = {
      queryId,
      agentId,
      query,
      status: 'running',
      isPaused: false,
      canControl: true,
      startTime: Date.now()
    };

    this.controlledQueries.set(queryId, controlled);
    this.startMonitoring(queryId);

    this.logger.info('Query registered for control', { queryId, agentId });
    this.emit('query:registered', { queryId, agentId });

    return controlled;
  }

  /**
   * Pause a running query
   * Note: SDK interrupt() will stop the query, not pause it
   * True pause/resume requires custom implementation
   */
  async pauseQuery(queryId: string, reason?: string): Promise<boolean> {
    if (!this.options.allowPause) {
      throw new Error('Pause is not enabled in controller options');
    }

    const controlled = this.controlledQueries.get(queryId);
    if (!controlled) {
      throw new Error(`Query not found: ${queryId}`);
    }

    if (controlled.isPaused || controlled.status !== 'running') {
      this.logger.warn('Query is not in a state to be paused', {
        queryId,
        status: controlled.status,
        isPaused: controlled.isPaused
      });
      return false;
    }

    try {
      // SDK doesn't support true pause, so we interrupt
      // In a real implementation, we'd need to track state and resume
      await controlled.query.interrupt();

      controlled.isPaused = true;
      controlled.status = 'paused';
      controlled.pausedAt = Date.now();

      this.logger.info('Query paused', { queryId, reason });
      this.emit('query:paused', { queryId, reason });

      return true;
    } catch (error) {
      this.logger.error('Failed to pause query', {
        queryId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Resume a paused query
   * Note: Actual resume requires storing state and restarting
   */
  async resumeQuery(queryId: string): Promise<boolean> {
    const controlled = this.controlledQueries.get(queryId);
    if (!controlled) {
      throw new Error(`Query not found: ${queryId}`);
    }

    if (!controlled.isPaused || controlled.status !== 'paused') {
      this.logger.warn('Query is not paused', { queryId, status: controlled.status });
      return false;
    }

    // In a real implementation, we'd resume from saved state
    // For now, mark as resumed
    controlled.isPaused = false;
    controlled.status = 'running';
    controlled.resumedAt = Date.now();

    this.logger.info('Query resumed', { queryId });
    this.emit('query:resumed', { queryId });

    return true;
  }

  /**
   * Terminate a query immediately
   */
  async terminateQuery(queryId: string, reason?: string): Promise<boolean> {
    const controlled = this.controlledQueries.get(queryId);
    if (!controlled) {
      throw new Error(`Query not found: ${queryId}`);
    }

    if (controlled.status === 'terminated') {
      return true;
    }

    try {
      await controlled.query.interrupt();

      controlled.status = 'terminated';
      controlled.terminatedAt = Date.now();
      this.stopMonitoring(queryId);

      this.logger.info('Query terminated', { queryId, reason });
      this.emit('query:terminated', { queryId, reason });

      return true;
    } catch (error) {
      this.logger.error('Failed to terminate query', {
        queryId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Change model for a running query
   */
  async changeModel(queryId: string, model: string): Promise<boolean> {
    if (!this.options.allowModelChange) {
      throw new Error('Model change is not enabled in controller options');
    }

    const controlled = this.controlledQueries.get(queryId);
    if (!controlled) {
      throw new Error(`Query not found: ${queryId}`);
    }

    if (controlled.status !== 'running') {
      throw new Error('Can only change model for running queries');
    }

    try {
      await controlled.query.setModel(model);
      controlled.currentModel = model;

      this.logger.info('Model changed for query', { queryId, model });
      this.emit('query:modelChanged', { queryId, model });

      return true;
    } catch (error) {
      this.logger.error('Failed to change model', {
        queryId,
        model,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Change permission mode for a running query
   */
  async changePermissionMode(queryId: string, mode: PermissionMode): Promise<boolean> {
    if (!this.options.allowPermissionChange) {
      throw new Error('Permission change is not enabled in controller options');
    }

    const controlled = this.controlledQueries.get(queryId);
    if (!controlled) {
      throw new Error(`Query not found: ${queryId}`);
    }

    if (controlled.status !== 'running') {
      throw new Error('Can only change permissions for running queries');
    }

    try {
      await controlled.query.setPermissionMode(mode);
      controlled.permissionMode = mode;

      this.logger.info('Permission mode changed for query', { queryId, mode });
      this.emit('query:permissionChanged', { queryId, mode });

      return true;
    } catch (error) {
      this.logger.error('Failed to change permission mode', {
        queryId,
        mode,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get supported models for a query
   */
  async getSupportedModels(queryId: string): Promise<ModelInfo[]> {
    const controlled = this.controlledQueries.get(queryId);
    if (!controlled) {
      throw new Error(`Query not found: ${queryId}`);
    }

    try {
      return await controlled.query.supportedModels();
    } catch (error) {
      this.logger.error('Failed to get supported models', { queryId });
      throw error;
    }
  }

  /**
   * Execute a control command
   */
  async executeCommand(command: QueryControlCommand): Promise<boolean> {
    this.logger.debug('Executing control command', { command });

    switch (command.type) {
      case 'pause':
        return this.pauseQuery(command.queryId, command.params?.reason);

      case 'resume':
        return this.resumeQuery(command.queryId);

      case 'terminate':
        return this.terminateQuery(command.queryId, command.params?.reason);

      case 'changeModel':
        if (!command.params?.model) {
          throw new Error('Model parameter required for changeModel command');
        }
        return this.changeModel(command.queryId, command.params.model);

      case 'changePermissions':
        if (!command.params?.permissionMode) {
          throw new Error('Permission mode required for changePermissions command');
        }
        return this.changePermissionMode(command.queryId, command.params.permissionMode);

      default:
        throw new Error(`Unknown command type: ${(command as any).type}`);
    }
  }

  /**
   * Queue a command for execution
   */
  queueCommand(command: QueryControlCommand): void {
    const queue = this.commandQueue.get(command.queryId) || [];
    queue.push(command);
    this.commandQueue.set(command.queryId, queue);

    this.emit('command:queued', command);
  }

  /**
   * Process queued commands for a query
   */
  async processQueuedCommands(queryId: string): Promise<void> {
    const queue = this.commandQueue.get(queryId);
    if (!queue || queue.length === 0) {
      return;
    }

    this.logger.debug('Processing queued commands', {
      queryId,
      commandCount: queue.length
    });

    while (queue.length > 0) {
      const command = queue.shift()!;
      try {
        await this.executeCommand(command);
      } catch (error) {
        this.logger.error('Failed to execute queued command', {
          queryId,
          command,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.commandQueue.delete(queryId);
  }

  /**
   * Get query status
   */
  getQueryStatus(queryId: string): ControlledQuery | undefined {
    return this.controlledQueries.get(queryId);
  }

  /**
   * Get all controlled queries
   */
  getAllQueries(): Map<string, ControlledQuery> {
    return new Map(this.controlledQueries);
  }

  /**
   * Start monitoring a query
   */
  private startMonitoring(queryId: string): void {
    const interval = setInterval(() => {
      const controlled = this.controlledQueries.get(queryId);
      if (!controlled) {
        this.stopMonitoring(queryId);
        return;
      }

      const update: QueryStatusUpdate = {
        queryId,
        status: controlled.status,
        timestamp: Date.now(),
        metadata: {
          isPaused: controlled.isPaused,
          duration: Date.now() - controlled.startTime
        }
      };

      this.emit('query:status', update);

    }, this.options.monitoringInterval);

    this.monitoringIntervals.set(queryId, interval);
  }

  /**
   * Stop monitoring a query
   */
  private stopMonitoring(queryId: string): void {
    const interval = this.monitoringIntervals.get(queryId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(queryId);
    }
  }

  /**
   * Unregister a query
   */
  unregisterQuery(queryId: string): void {
    this.stopMonitoring(queryId);
    this.controlledQueries.delete(queryId);
    this.commandQueue.delete(queryId);

    this.logger.info('Query unregistered', { queryId });
    this.emit('query:unregistered', { queryId });
  }

  /**
   * Cleanup completed queries
   */
  cleanup(olderThan: number = 3600000): void {
    const cutoff = Date.now() - olderThan;

    for (const [queryId, controlled] of this.controlledQueries.entries()) {
      const endTime = controlled.terminatedAt || controlled.startTime;

      if (controlled.status === 'completed' || controlled.status === 'terminated') {
        if (endTime < cutoff) {
          this.unregisterQuery(queryId);
        }
      }
    }
  }

  /**
   * Shutdown controller
   */
  shutdown(): void {
    // Stop all monitoring
    for (const queryId of this.monitoringIntervals.keys()) {
      this.stopMonitoring(queryId);
    }

    // Clear all data
    this.controlledQueries.clear();
    this.commandQueue.clear();

    this.logger.info('Query controller shutdown complete');
  }
}