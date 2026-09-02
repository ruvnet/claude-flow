/**
 * Reconnection Manager for MCP
 * Handles automatic reconnection with exponential backoff
 */

import { EventEmitter } from 'node:events';
import type { ILogger } from '../../core/logger.js';
import type { MCPClient } from '../client.js';

export interface ReconnectionConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitterFactor: number;
  resetAfterSuccess: boolean;
}

export interface ReconnectionState {
  attempts: number;
  nextDelay: number;
  isReconnecting: boolean;
  lastAttempt?: Date;
  lastError?: Error;
}

export class ReconnectionManager extends EventEmitter {
  private state: ReconnectionState;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectPromise?: Promise<boolean>;

  private readonly defaultConfig: ReconnectionConfig = {
    maxRetries: 10,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitterFactor: 0.1,
    resetAfterSuccess: true,
  };

  constructor(
    private client: MCPClient,
    private logger: ILogger,
    config?: Partial<ReconnectionConfig>,
  ) {
    super();
    this.config = { ...this.defaultConfig, ...config };

    this.state = {
      attempts: 0,
      nextDelay: this.config.initialDelay,
      isReconnecting: false,
    };
  }

  private config: ReconnectionConfig;

  /**
   * Attempt to reconnect
   */
  async attemptReconnection(): Promise<boolean> {
    // Prevent concurrent reconnection attempts
    if (this.reconnectPromise) {
      this.logger.debug('Reconnection already in progress');
      return this.reconnectPromise;
    }

    if (this.state.attempts >= this.config.maxRetries) {
      this.logger.error('Max reconnection attempts exceeded');
      this.emit('maxRetriesExceeded', this.state);
      return false;
    }

    this.reconnectPromise = this.performReconnection();
    const result = await this.reconnectPromise;
    this.reconnectPromise = undefined;

    return result;
  }

  /**
   * Start automatic reconnection
   */
  startAutoReconnect(): void {
    if (this.state.isReconnecting) {
      this.logger.debug('Auto-reconnect already active');
      return;
    }

    this.logger.info('Starting automatic reconnection');
    this.state.isReconnecting = true;
    this.emit('reconnectStart');

    this.scheduleReconnect();
  }

  /**
   * Stop reconnection attempts
   */
  stopReconnection(): void {
    if (!this.state.isReconnecting) {
      return;
    }

    this.logger.info('Stopping reconnection attempts');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.state.isReconnecting = false;
    this.emit('reconnectStop');
  }

  /**
   * Reset reconnection state
   */
  reset(): void {
    this.logger.debug('Resetting reconnection manager');

    this.stopReconnection();
    this.state = {
      attempts: 0,
      nextDelay: this.config.initialDelay,
      isReconnecting: false,
    };
  }

  /**
   * Get current reconnection state
   */
  getState(): ReconnectionState {
    return { ...this.state };
  }

  /**
   * Calculate next retry delay
   */
  getNextDelay(): number {
    return this.state.nextDelay;
  }

  private async performReconnection(): Promise<boolean> {
    this.state.attempts++;
    this.state.lastAttempt = new Date();

    this.logger.info('Attempting reconnection', {
      attempt: this.state.attempts,
      maxRetries: this.config.maxRetries,
      delay: this.state.nextDelay,
    });

    this.emit('attemptStart', {
      attempt: this.state.attempts,
      delay: this.state.nextDelay,
    });

    try {
      // Disconnect first if needed
      if (this.client.isConnected()) {
        await this.client.disconnect();
      }

      // Attempt to reconnect
      await this.client.connect();

      // Success!
      this.logger.info('Reconnection successful', {
        attempts: this.state.attempts,
      });

      this.emit('success', {
        attempts: this.state.attempts,
        duration: Date.now() - this.state.lastAttempt.getTime(),
      });

      // Reset state if configured
      if (this.config.resetAfterSuccess) {
        this.reset();
      }

      return true;
    } catch (error) {
      this.state.lastError = error as Error;

      this.logger.error('Reconnection failed', {
        attempt: this.state.attempts,
        error: (error as Error).message,
      });

      this.emit('attemptFailed', {
        attempt: this.state.attempts,
        error: error as Error,
      });

      // Calculate next delay with exponential backoff
      this.calculateNextDelay();

      // Schedule next attempt if within retry limit
      if (this.state.attempts < this.config.maxRetries && this.state.isReconnecting) {
        this.scheduleReconnect();
      } else if (this.state.attempts >= this.config.maxRetries) {
        this.logger.error('Max reconnection attempts reached');
        this.emit('maxRetriesExceeded', this.state);
        this.state.isReconnecting = false;
      }

      return false;
    }
  }

  private scheduleReconnect(): void {
    if (!this.state.isReconnecting) {
      return;
    }

    const delay = this.addJitter(this.state.nextDelay);

    this.logger.debug('Scheduling next reconnection attempt', {
      delay,
      baseDelay: this.state.nextDelay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.attemptReconnection().catch((error) => {
        this.logger.error('Scheduled reconnection error', error);
      });
    }, delay);

    this.emit('attemptScheduled', {
      attempt: this.state.attempts + 1,
      delay,
    });
  }

  private calculateNextDelay(): void {
    // Exponential backoff calculation
    const nextDelay = Math.min(
      this.state.nextDelay * this.config.backoffMultiplier,
      this.config.maxDelay,
    );

    this.state.nextDelay = nextDelay;

    this.logger.debug('Calculated next delay', {
      delay: nextDelay,
      multiplier: this.config.backoffMultiplier,
      maxDelay: this.config.maxDelay,
    });
  }

  private addJitter(delay: number): number {
    // Add random jitter to prevent thundering herd
    const jitter = delay * this.config.jitterFactor;
    const randomJitter = (Math.random() - 0.5) * 2 * jitter;

    return Math.max(0, delay + randomJitter);
  }

  /**
   * Force immediate reconnection attempt
   */
  async forceReconnect(): Promise<boolean> {
    this.logger.info('Forcing immediate reconnection');

    // Cancel any scheduled reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // Reset delay for immediate attempt
    const originalDelay = this.state.nextDelay;
    this.state.nextDelay = 0;

    const result = await this.attemptReconnection();

    // Restore delay if failed
    if (!result) {
      this.state.nextDelay = originalDelay;
    }

    return result;
  }

  /**
   * Get estimated time until next reconnection attempt
   */
  getTimeUntilNextAttempt(): number | null {
    if (!this.state.isReconnecting || !this.reconnectTimer) {
      return null;
    }

    // This is an approximation since we don't track the exact timer start
    return this.state.nextDelay;
  }
}
