/**
 * Connection Health Monitor for MCP
 * Monitors connection health and triggers recovery when needed
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../../core/logger.js';
import type { MCPClient } from '../client.js';

export interface HealthStatus {
  healthy: boolean;
  lastHeartbeat: Date;
  missedHeartbeats: number;
  latency: number;
  connectionState: 'connected' | 'disconnected' | 'reconnecting';
  error?: string;
}

export interface HealthMonitorConfig {
  heartbeatInterval: number;
  heartbeatTimeout: number;
  maxMissedHeartbeats: number;
  enableAutoRecovery: boolean;
}

export class ConnectionHealthMonitor extends EventEmitter {
  private heartbeatTimer?: NodeJS.Timeout;
  private timeoutTimer?: NodeJS.Timeout;
  private lastHeartbeat: Date = new Date();
  private missedHeartbeats = 0;
  private currentLatency = 0;
  private isMonitoring = false;
  private healthStatus: HealthStatus;

  private readonly defaultConfig: HealthMonitorConfig = {
    heartbeatInterval: 5000,
    heartbeatTimeout: 10000,
    maxMissedHeartbeats: 3,
    enableAutoRecovery: true,
  };

  constructor(
    private client: MCPClient,
    private logger: ILogger,
    config?: Partial<HealthMonitorConfig>,
  ) {
    super();
    this.config = { ...this.defaultConfig, ...config };

    this.healthStatus = {
      healthy: false,
      lastHeartbeat: new Date(),
      missedHeartbeats: 0,
      latency: 0,
      connectionState: 'disconnected',
    };
  }

  private config: HealthMonitorConfig;

  /**
   * Start health monitoring
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('Health monitor already running');
      return;
    }

    this.logger.info('Starting connection health monitor', {
      config: this.config,
    });

    this.isMonitoring = true;
    this.missedHeartbeats = 0;
    this.lastHeartbeat = new Date();

    // Start heartbeat cycle
    this.scheduleHeartbeat();

    // Update initial status
    this.updateHealthStatus('connected');
    this.emit('started');
  }

  /**
   * Stop health monitoring
   */
  async stop(): Promise<void> {
    if (!this.isMonitoring) {
      return;
    }

    this.logger.info('Stopping connection health monitor');
    this.isMonitoring = false;

    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    this.updateHealthStatus('disconnected');
    this.emit('stopped');
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Check connection health immediately
   */
  async checkHealth(): Promise<HealthStatus> {
    try {
      const startTime = Date.now();

      // Send heartbeat ping
      await this.sendHeartbeat();

      // Calculate latency
      this.currentLatency = Date.now() - startTime;
      this.lastHeartbeat = new Date();
      this.missedHeartbeats = 0;

      this.updateHealthStatus('connected', true);

      return this.getHealthStatus();
    } catch (error) {
      this.logger.error('Health check failed', error);
      this.handleHeartbeatFailure(error as Error);
      return this.getHealthStatus();
    }
  }

  /**
   * Force a health check
   */
  async forceCheck(): Promise<void> {
    this.logger.debug('Forcing health check');

    // Cancel current timers
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
    }

    // Perform immediate check
    await this.performHeartbeat();
  }

  private scheduleHeartbeat(): void {
    if (!this.isMonitoring) {
      return;
    }

    this.heartbeatTimer = setTimeout(() => {
      this.performHeartbeat().catch((error) => {
        this.logger.error('Heartbeat error', error);
      });
    }, this.config.heartbeatInterval);
  }

  private async performHeartbeat(): Promise<void> {
    if (!this.isMonitoring) {
      return;
    }

    this.logger.debug('Performing heartbeat');

    try {
      // Set timeout for heartbeat response
      this.setHeartbeatTimeout();

      const startTime = Date.now();
      await this.sendHeartbeat();

      // Clear timeout on success
      this.clearHeartbeatTimeout();

      // Update metrics
      this.currentLatency = Date.now() - startTime;
      this.lastHeartbeat = new Date();
      this.missedHeartbeats = 0;

      this.logger.debug('Heartbeat successful', {
        latency: this.currentLatency,
      });

      this.updateHealthStatus('connected', true);

      // Schedule next heartbeat
      this.scheduleHeartbeat();
    } catch (error) {
      this.handleHeartbeatFailure(error as Error);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    // Send heartbeat notification via MCP
    await this.client.notify('heartbeat', {
      timestamp: Date.now(),
      sessionId: this.generateSessionId(),
    });
  }

  private setHeartbeatTimeout(): void {
    this.timeoutTimer = setTimeout(() => {
      this.handleHeartbeatTimeout();
    }, this.config.heartbeatTimeout);
  }

  private clearHeartbeatTimeout(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }
  }

  private handleHeartbeatTimeout(): void {
    this.logger.warn('Heartbeat timeout');
    this.handleHeartbeatFailure(new Error('Heartbeat timeout'));
  }

  private handleHeartbeatFailure(error: Error): void {
    this.clearHeartbeatTimeout();

    this.missedHeartbeats++;
    this.logger.warn('Heartbeat failed', {
      missedHeartbeats: this.missedHeartbeats,
      maxMissed: this.config.maxMissedHeartbeats,
      error: error instanceof Error ? error.message : String(error),
    });

    if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
      this.logger.error('Max missed heartbeats exceeded, connection unhealthy');
      this.updateHealthStatus(
        'disconnected',
        false,
        error instanceof Error ? error.message : String(error),
      );

      if (this.config.enableAutoRecovery) {
        this.emit('connectionLost', { error });
      }
    } else {
      // Schedule next heartbeat with backoff
      const backoffDelay = this.config.heartbeatInterval * (this.missedHeartbeats + 1);
      this.logger.debug('Scheduling heartbeat with backoff', { delay: backoffDelay });

      this.heartbeatTimer = setTimeout(() => {
        this.performHeartbeat().catch((err) => {
          this.logger.error('Backoff heartbeat error', err);
        });
      }, backoffDelay);
    }
  }

  private updateHealthStatus(
    connectionState: 'connected' | 'disconnected' | 'reconnecting',
    healthy?: boolean,
    error?: string,
  ): void {
    const previousStatus = { ...this.healthStatus };

    this.healthStatus = {
      healthy: healthy ?? connectionState === 'connected',
      lastHeartbeat: this.lastHeartbeat,
      missedHeartbeats: this.missedHeartbeats,
      latency: this.currentLatency,
      connectionState,
      error,
    };

    // Emit event if health changed
    if (
      previousStatus.healthy !== this.healthStatus.healthy ||
      previousStatus.connectionState !== this.healthStatus.connectionState
    ) {
      this.logger.info('Health status changed', {
        from: previousStatus.connectionState,
        to: this.healthStatus.connectionState,
        healthy: this.healthStatus.healthy,
      });

      this.emit('healthChange', this.healthStatus, previousStatus);
    }
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Reset monitor state
   */
  reset(): void {
    this.missedHeartbeats = 0;
    this.currentLatency = 0;
    this.lastHeartbeat = new Date();

    if (this.isMonitoring) {
      this.logger.debug('Resetting health monitor');
      this.clearHeartbeatTimeout();
      this.scheduleHeartbeat();
    }
  }
}
