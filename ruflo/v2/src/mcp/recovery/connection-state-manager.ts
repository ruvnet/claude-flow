/**
 * Connection State Manager for MCP
 * Persists connection state across disconnections
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ILogger } from '../../core/logger.js';
import type { MCPRequest, MCPConfig } from '../../utils/types.js';

export interface ConnectionState {
  sessionId: string;
  lastConnected: Date;
  lastDisconnected?: Date;
  pendingRequests: MCPRequest[];
  configuration: MCPConfig;
  metadata: Record<string, unknown>;
}

export interface ConnectionEvent {
  timestamp: Date;
  type: 'connect' | 'disconnect' | 'reconnect' | 'error';
  sessionId: string;
  details?: Record<string, unknown>;
  error?: string;
}

export interface ConnectionMetrics {
  totalConnections: number;
  totalDisconnections: number;
  totalReconnections: number;
  averageSessionDuration: number;
  averageReconnectionTime: number;
  lastConnectionDuration?: number;
  connectionHistory: ConnectionEvent[];
}

export interface StateManagerConfig {
  enablePersistence: boolean;
  stateDirectory: string;
  maxHistorySize: number;
  persistenceInterval: number;
}

export class ConnectionStateManager {
  private currentState?: ConnectionState;
  private connectionHistory: ConnectionEvent[] = [];
  private metrics: ConnectionMetrics = {
    totalConnections: 0,
    totalDisconnections: 0,
    totalReconnections: 0,
    averageSessionDuration: 0,
    averageReconnectionTime: 0,
    connectionHistory: [],
  };

  private persistenceTimer?: NodeJS.Timeout;
  private statePath: string;
  private metricsPath: string;

  private readonly defaultConfig: StateManagerConfig = {
    enablePersistence: true,
    stateDirectory: '.mcp-state',
    maxHistorySize: 1000,
    persistenceInterval: 60000, // 1 minute
  };

  constructor(
    private logger: ILogger,
    config?: Partial<StateManagerConfig>,
  ) {
    this.config = { ...this.defaultConfig, ...config };

    this.statePath = join(this.config.stateDirectory, 'connection-state.json');
    this.metricsPath = join(this.config.stateDirectory, 'connection-metrics.json');

    this.initialize().catch((error) => {
      this.logger.error('Failed to initialize state manager', error);
    });
  }

  private config: StateManagerConfig;

  /**
   * Initialize the state manager
   */
  private async initialize(): Promise<void> {
    if (!this.config.enablePersistence) {
      return;
    }

    try {
      // Ensure state directory exists
      await fs.mkdir(this.config.stateDirectory, { recursive: true });

      // Load existing state
      await this.loadState();
      await this.loadMetrics();

      // Start persistence timer
      this.startPersistenceTimer();

      this.logger.info('Connection state manager initialized', {
        stateDirectory: this.config.stateDirectory,
      });
    } catch (error) {
      this.logger.error('Failed to initialize state manager', error);
    }
  }

  /**
   * Save current connection state
   */
  saveState(state: ConnectionState): void {
    this.currentState = {
      ...state,
      metadata: {
        ...state.metadata,
        lastSaved: new Date().toISOString(),
      },
    };

    this.logger.debug('Connection state saved', {
      sessionId: state.sessionId,
      pendingRequests: state.pendingRequests.length,
    });

    // Persist immediately if critical
    if (state.pendingRequests.length > 0) {
      this.persistState().catch((error) => {
        this.logger.error('Failed to persist critical state', error);
      });
    }
  }

  /**
   * Restore previous connection state
   */
  restoreState(): ConnectionState | null {
    if (!this.currentState) {
      this.logger.debug('No state to restore');
      return null;
    }

    this.logger.info('Restoring connection state', {
      sessionId: this.currentState.sessionId,
      pendingRequests: this.currentState.pendingRequests.length,
    });

    return { ...this.currentState };
  }

  /**
   * Record a connection event
   */
  recordEvent(event: Omit<ConnectionEvent, 'timestamp'>): void {
    const fullEvent: ConnectionEvent = {
      ...event,
      timestamp: new Date(),
    };

    this.connectionHistory.push(fullEvent);

    // Trim history if needed
    if (this.connectionHistory.length > this.config.maxHistorySize) {
      this.connectionHistory = this.connectionHistory.slice(-this.config.maxHistorySize);
    }

    // Update metrics
    this.updateMetrics(fullEvent);

    this.logger.debug('Connection event recorded', {
      type: event.type,
      sessionId: event.sessionId,
    });
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    return {
      ...this.metrics,
      connectionHistory: [...this.connectionHistory],
    };
  }

  /**
   * Clear a specific session state
   */
  clearSession(sessionId: string): void {
    if (this.currentState?.sessionId === sessionId) {
      this.currentState = undefined;

      this.logger.info('Session state cleared', { sessionId });

      this.persistState().catch((error) => {
        this.logger.error('Failed to persist cleared state', error);
      });
    }
  }

  /**
   * Add a pending request
   */
  addPendingRequest(request: MCPRequest): void {
    if (!this.currentState) {
      this.logger.warn('No active state to add pending request');
      return;
    }

    this.currentState.pendingRequests.push(request);

    this.logger.debug('Pending request added', {
      requestId: request.id,
      method: request.method,
      total: this.currentState.pendingRequests.length,
    });
  }

  /**
   * Remove a pending request
   */
  removePendingRequest(requestId: string): void {
    if (!this.currentState) {
      return;
    }

    this.currentState.pendingRequests = this.currentState.pendingRequests.filter(
      (req) => req.id !== requestId,
    );
  }

  /**
   * Get pending requests
   */
  getPendingRequests(): MCPRequest[] {
    return this.currentState?.pendingRequests || [];
  }

  /**
   * Update session metadata
   */
  updateMetadata(metadata: Record<string, unknown>): void {
    if (!this.currentState) {
      return;
    }

    this.currentState.metadata = {
      ...this.currentState.metadata,
      ...metadata,
    };
  }

  /**
   * Calculate session duration
   */
  getSessionDuration(sessionId: string): number | null {
    const connectEvent = this.connectionHistory.find(
      (e) => e.sessionId === sessionId && e.type === 'connect',
    );

    const disconnectEvent = this.connectionHistory.find(
      (e) => e.sessionId === sessionId && e.type === 'disconnect',
    );

    if (!connectEvent) {
      return null;
    }

    const endTime = disconnectEvent ? disconnectEvent.timestamp : new Date();
    return endTime.getTime() - connectEvent.timestamp.getTime();
  }

  /**
   * Get reconnection time for a session
   */
  getReconnectionTime(sessionId: string): number | null {
    const disconnectEvent = this.connectionHistory.find(
      (e) => e.sessionId === sessionId && e.type === 'disconnect',
    );

    const reconnectEvent = this.connectionHistory.find(
      (e) =>
        e.sessionId === sessionId &&
        e.type === 'reconnect' &&
        e.timestamp > (disconnectEvent?.timestamp || new Date(0)),
    );

    if (!disconnectEvent || !reconnectEvent) {
      return null;
    }

    return reconnectEvent.timestamp.getTime() - disconnectEvent.timestamp.getTime();
  }

  private updateMetrics(event: ConnectionEvent): void {
    switch (event.type) {
      case 'connect':
        this.metrics.totalConnections++;
        break;

      case 'disconnect':
        this.metrics.totalDisconnections++;

        // Calculate session duration
        const duration = this.getSessionDuration(event.sessionId);
        if (duration !== null) {
          this.metrics.lastConnectionDuration = duration;

          // Update average
          const totalDuration =
            this.metrics.averageSessionDuration * (this.metrics.totalDisconnections - 1) + duration;
          this.metrics.averageSessionDuration = totalDuration / this.metrics.totalDisconnections;
        }
        break;

      case 'reconnect':
        this.metrics.totalReconnections++;

        // Calculate reconnection time
        const reconnectTime = this.getReconnectionTime(event.sessionId);
        if (reconnectTime !== null) {
          // Update average
          const totalTime =
            this.metrics.averageReconnectionTime * (this.metrics.totalReconnections - 1) +
            reconnectTime;
          this.metrics.averageReconnectionTime = totalTime / this.metrics.totalReconnections;
        }
        break;
    }
  }

  private async loadState(): Promise<void> {
    try {
      const data = await fs.readFile(this.statePath, 'utf-8');
      const state = JSON.parse(data);

      // Convert date strings back to Date objects
      state.lastConnected = new Date(state.lastConnected);
      if (state.lastDisconnected) {
        state.lastDisconnected = new Date(state.lastDisconnected);
      }

      this.currentState = state;

      this.logger.info('Connection state loaded', {
        sessionId: state.sessionId,
        pendingRequests: state.pendingRequests.length,
      });
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        this.logger.error('Failed to load connection state', error);
      }
    }
  }

  private async loadMetrics(): Promise<void> {
    try {
      const data = await fs.readFile(this.metricsPath, 'utf-8');
      const loaded = JSON.parse(data);

      // Convert date strings back to Date objects
      loaded.connectionHistory = loaded.connectionHistory.map((event: any) => ({
        ...event,
        timestamp: new Date(event.timestamp),
      }));

      this.metrics = loaded;
      this.connectionHistory = loaded.connectionHistory;

      this.logger.info('Connection metrics loaded', {
        totalConnections: this.metrics.totalConnections,
        historySize: this.connectionHistory.length,
      });
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        this.logger.error('Failed to load connection metrics', error);
      }
    }
  }

  private async persistState(): Promise<void> {
    if (!this.config.enablePersistence) {
      return;
    }

    try {
      if (this.currentState) {
        await fs.writeFile(this.statePath, JSON.stringify(this.currentState, null, 2), 'utf-8');
      }

      // Also persist metrics
      await fs.writeFile(
        this.metricsPath,
        JSON.stringify(
          {
            ...this.metrics,
            connectionHistory: this.connectionHistory,
          },
          null,
          2,
        ),
        'utf-8',
      );

      this.logger.debug('State and metrics persisted');
    } catch (error) {
      this.logger.error('Failed to persist state', error);
    }
  }

  private startPersistenceTimer(): void {
    if (this.persistenceTimer) {
      return;
    }

    this.persistenceTimer = setInterval(() => {
      this.persistState().catch((error) => {
        this.logger.error('Periodic persistence failed', error);
      });
    }, this.config.persistenceInterval);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.persistenceTimer) {
      clearInterval(this.persistenceTimer);
      this.persistenceTimer = undefined;
    }

    // Final persistence
    await this.persistState();
  }
}
