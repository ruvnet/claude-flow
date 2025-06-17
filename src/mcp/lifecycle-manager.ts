/**
 * MCP Server Lifecycle Manager
 * Handles server lifecycle operations including start, stop, restart, and health checks
 */

import { EventEmitter } from 'node:events';
import { ILogger } from '../core/logger.js';
import { MCPConfig, MCPSession, MCPMetrics, HealthStatus } from '../utils/types.js';
import { MCPError } from '../utils/errors.js';
import { IMCPServer } from './server.js';

export enum LifecycleState {
  STOPPED = 'stopped',
  STARTING = 'starting',
  RUNNING = 'running',
  STOPPING = 'stopping',
  RESTARTING = 'restarting',
  ERROR = 'error',
}

export interface LifecycleEvent {
  timestamp: Date;
  state: LifecycleState;
  previousState?: LifecycleState;
  error?: Error;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  healthy: boolean;
  state: LifecycleState;
  uptime: number;
  lastRestart?: Date;
  error?: string;
  metrics?: Record<string, number>;
  components: {
    server: boolean;
    transport: boolean;
    sessions: boolean;
    tools: boolean;
    auth: boolean;
    loadBalancer: boolean;
  };
}

export interface LifecycleManagerConfig {
  healthCheckInterval: number;
  gracefulShutdownTimeout: number;
  maxRestartAttempts: number;
  restartDelay: number;
  enableAutoRestart: boolean;
  enableHealthChecks: boolean;
}

/**
 * MCP Server Lifecycle Manager
 * Manages the complete lifecycle of MCP servers with robust error handling
 */
export class MCPLifecycleManager extends EventEmitter {
  private state: LifecycleState = LifecycleState.STOPPED;
  private server?: IMCPServer;
  private healthCheckTimer?: NodeJS.Timeout;
  private startTime?: Date;
  private lastRestart?: Date;
  private restartAttempts = 0;
  private shutdownPromise?: Promise<void>;
  private history: LifecycleEvent[] = [];

  private readonly config: LifecycleManagerConfig = {
    healthCheckInterval: 30000, // 30 seconds
    gracefulShutdownTimeout: 10000, // 10 seconds
    maxRestartAttempts: 3,
    restartDelay: 5000, // 5 seconds
    enableAutoRestart: true,
    enableHealthChecks: true,
  };

  constructor(
    private mcpConfig: MCPConfig,
    private logger: ILogger,
    private serverFactory: () => IMCPServer,
    config?: Partial<LifecycleManagerConfig>,
  ) {
    super();
    
    if (config) {
      Object.assign(this.config, config);
    }

    this.setupEventHandlers();
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    if (this.state !== LifecycleState.STOPPED) {
      throw new MCPError(`Cannot start server in state: ${this.state}`);
    }

    this.setState(LifecycleState.STARTING);
    this.logger.info('Starting MCP server lifecycle manager');

    try {
      // Create server instance
      this.server = this.serverFactory();

      // Start the server
      await this.server.start();

      // Record start time
      this.startTime = new Date();
      this.restartAttempts = 0;

      // Start health checks
      if (this.config.enableHealthChecks) {
        this.startHealthChecks();
      }

      this.setState(LifecycleState.RUNNING);
      this.logger.info('MCP server started successfully');
    } catch (error) {
      this.setState(LifecycleState.ERROR, error as Error);
      this.logger.error('Failed to start MCP server', error);
      throw error;
    }
  }

  /**
   * Stop the MCP server gracefully
   */
  async stop(): Promise<void> {
    if (this.state === LifecycleState.STOPPED) {
      return;
    }

    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.setState(LifecycleState.STOPPING);
    this.logger.info('Stopping MCP server');

    this.shutdownPromise = this.performShutdown();
    await this.shutdownPromise;
    this.shutdownPromise = undefined;
  }

  /**
   * Restart the MCP server
   */
  async restart(): Promise<void> {
    if (this.state === LifecycleState.STOPPED) {
      return this.start();
    }

    this.setState(LifecycleState.RESTARTING);
    this.logger.info('Restarting MCP server');

    try {
      await this.stop();
      
      // Add restart delay
      if (this.config.restartDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.restartDelay));
      }

      await this.start();
      this.lastRestart = new Date();
      this.restartAttempts++;

      this.logger.info('MCP server restarted successfully');
    } catch (error) {
      this.setState(LifecycleState.ERROR, error as Error);
      this.logger.error('Failed to restart MCP server', error);
      throw error;
    }
  }

  /**
   * Perform comprehensive health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const result: HealthCheckResult = {
      healthy: false,
      state: this.state,
      uptime: this.getUptime(),
      lastRestart: this.lastRestart,
      components: {
        server: false,
        transport: false,
        sessions: false,
        tools: false,
        auth: false,
        loadBalancer: false,
      },
    };

    try {
      if (!this.server || this.state !== LifecycleState.RUNNING) {
        result.error = 'Server not running';
        return result;
      }

      // Check server health
      const serverHealth = await this.server.getHealthStatus();
      result.components.server = serverHealth.healthy;
      result.metrics = serverHealth.metrics;
      
      if (serverHealth.error) {
        result.error = serverHealth.error;
      }

      // Check individual components
      result.components.transport = serverHealth.metrics?.transportConnections !== undefined;
      result.components.sessions = serverHealth.metrics?.activeSessions !== undefined;
      result.components.tools = (serverHealth.metrics?.registeredTools || 0) > 0;
      result.components.auth = serverHealth.metrics?.authenticatedSessions !== undefined;
      result.components.loadBalancer = serverHealth.metrics?.rateLimitedRequests !== undefined;

      // Overall health assessment
      result.healthy = result.components.server && 
                      result.components.transport && 
                      result.components.sessions &&
                      result.components.tools;

      const checkDuration = Date.now() - startTime;
      if (result.metrics) {
        result.metrics.healthCheckDuration = checkDuration;
      }

      this.logger.debug('Health check completed', { 
        healthy: result.healthy, 
        duration: checkDuration,
        components: result.components,
      });

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Health check failed', error);
      return result;
    }
  }

  /**
   * Get current server state
   */
  getState(): LifecycleState {
    return this.state;
  }

  /**
   * Get server metrics
   */
  getMetrics(): MCPMetrics | undefined {
    return this.server?.getMetrics();
  }

  /**
   * Get active sessions
   */
  getSessions(): MCPSession[] {
    return this.server?.getSessions() || [];
  }

  /**
   * Get server uptime in milliseconds
   */
  getUptime(): number {
    return this.startTime ? Date.now() - this.startTime.getTime() : 0;
  }

  /**
   * Get lifecycle event history
   */
  getHistory(): LifecycleEvent[] {
    return [...this.history];
  }

  /**
   * Force terminate server (emergency stop)
   */
  async forceStop(): Promise<void> {
    this.logger.warn('Force stopping MCP server');
    
    // Stop health checks
    this.stopHealthChecks();

    // Force close server
    if (this.server) {
      try {
        await this.server.stop();
      } catch (error) {
        this.logger.error('Error during force stop', error);
      }
      this.server = undefined;
    }

    this.setState(LifecycleState.STOPPED);
    this.startTime = undefined;
  }

  /**
   * Enable or disable auto-restart
   */
  setAutoRestart(enabled: boolean): void {
    this.config.enableAutoRestart = enabled;
    this.logger.info('Auto-restart', { enabled });
  }

  /**
   * Enable or disable health checks
   */
  setHealthChecks(enabled: boolean): void {
    this.config.enableHealthChecks = enabled;
    
    if (enabled && this.state === LifecycleState.RUNNING) {
      this.startHealthChecks();
    } else {
      this.stopHealthChecks();
    }
    
    this.logger.info('Health checks', { enabled });
  }

  private setState(newState: LifecycleState, error?: Error): void {
    const previousState = this.state;
    this.state = newState;

    const event: LifecycleEvent = {
      timestamp: new Date(),
      state: newState,
      previousState,
      error,
    };

    this.history.push(event);
    
    // Keep only last 100 events
    if (this.history.length > 100) {
      this.history.shift();
    }

    this.emit('stateChange', event);
    this.logger.info('State change', { 
      from: previousState, 
      to: newState, 
      error: error?.message,
    });
  }

  private setupEventHandlers(): void {
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', error);
      this.handleServerError(error);
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection', reason);
      this.handleServerError(reason instanceof Error ? reason : new Error(String(reason)));
    });

    // Handle process signals
    process.on('SIGINT', () => {
      this.logger.info('Received SIGINT, shutting down gracefully');
      this.stop().catch(error => {
        this.logger.error('Error during graceful shutdown', error);
        process.exit(1);
      });
    });

    process.on('SIGTERM', () => {
      this.logger.info('Received SIGTERM, shutting down gracefully');
      this.stop().catch(error => {
        this.logger.error('Error during graceful shutdown', error);
        process.exit(1);
      });
    });
  }

  private async handleServerError(error: Error): Promise<void> {
    this.logger.error('Server error detected', error);
    this.setState(LifecycleState.ERROR, error);

    if (this.config.enableAutoRestart && this.restartAttempts < this.config.maxRestartAttempts) {
      this.logger.info('Attempting auto-restart', { 
        attempt: this.restartAttempts + 1, 
        maxAttempts: this.config.maxRestartAttempts,
      });

      try {
        await this.restart();
      } catch (restartError) {
        this.logger.error('Auto-restart failed', restartError);
      }
    } else {
      this.logger.error('Max restart attempts reached or auto-restart disabled');
      await this.forceStop();
    }
  }

  private startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        const health = await this.healthCheck();
        
        if (!health.healthy && this.state === LifecycleState.RUNNING) {
          this.logger.warn('Health check failed', health);
          this.handleServerError(new Error(health.error || 'Health check failed'));
        }
      } catch (error) {
        this.logger.error('Health check error', error);
      }
    }, this.config.healthCheckInterval);

    this.logger.debug('Health checks started', { interval: this.config.healthCheckInterval });
  }

  private stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      this.logger.debug('Health checks stopped');
    }
  }

  private async performShutdown(): Promise<void> {
    try {
      // Stop health checks
      this.stopHealthChecks();

      // Graceful shutdown with timeout
      const shutdownPromise = this.server?.stop() || Promise.resolve();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Shutdown timeout')), this.config.gracefulShutdownTimeout);
      });

      await Promise.race([shutdownPromise, timeoutPromise]);
      
      this.server = undefined;
      this.setState(LifecycleState.STOPPED);
      this.startTime = undefined;
      
      this.logger.info('MCP server stopped successfully');
    } catch (error) {
      this.logger.error('Error during shutdown', error);
      await this.forceStop();
      throw error;
    }
  }
}