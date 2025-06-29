/**
 * Connection Pool for Claude API
 * Manages reusable connections to improve performance
 */

import { EventEmitter } from 'node:events';
import { Logger } from '../../core/logger.js';
import type { ClaudeAPI } from '../../types/missing-types.js';

export interface PoolConfig {
  min: number;
  max: number;
  acquireTimeoutMillis: number;
  idleTimeoutMillis: number;
  evictionRunIntervalMillis: number;
  testOnBorrow: boolean;
  testOnReturn: boolean;
  testWhileIdle: boolean;
  maxConnectionAge: number;
  healthCheckInterval: number;
  leakDetectionThreshold: number;
  validationTimeout: number;
}

export interface PooledConnection {
  id: string;
  api: ClaudeAPI;
  inUse: boolean;
  createdAt: Date;
  lastUsedAt: Date;
  useCount: number;
  lastValidatedAt?: Date;
  acquiredAt?: Date;
  acquiredBy?: string;
  isHealthy: boolean;
  consecutiveFailures: number;
  totalFailures: number;
}

export class ClaudeConnectionPool extends EventEmitter {
  private connections: Map<string, PooledConnection> = new Map();
  private waitingQueue: Array<{
    resolve: (conn: PooledConnection) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  
  private config: PoolConfig;
  private logger: Logger;
  private evictionTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private leakDetectionTimer?: NodeJS.Timeout;
  private isShuttingDown = false;
  private connectionCounter = 0;
  
  constructor(config: Partial<PoolConfig> = {}) {
    super();
    
    this.config = {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 10000,
      testOnBorrow: true,
      testOnReturn: true,
      testWhileIdle: true,
      maxConnectionAge: 3600000, // 1 hour
      healthCheckInterval: 30000, // 30 seconds
      leakDetectionThreshold: 60000, // 1 minute
      validationTimeout: 5000, // 5 seconds
      ...config
    };
    
    this.logger = new Logger(
      { level: 'info', format: 'json', destination: 'console' },
      { component: 'ClaudeConnectionPool' }
    );
    
    this.initialize();
  }
  
  private async initialize(): Promise<void> {
    // Create minimum connections
    for (let i = 0; i < this.config.min; i++) {
      await this.createConnection();
    }
    
    // Start timers
    this.startEvictionTimer();
    this.startHealthCheckTimer();
    this.startLeakDetectionTimer();
    
    this.logger.info('Connection pool initialized', {
      min: this.config.min,
      max: this.config.max,
      healthCheckInterval: this.config.healthCheckInterval,
      leakDetectionThreshold: this.config.leakDetectionThreshold
    });
  }
  
  private async createConnection(): Promise<PooledConnection> {
    const id = `conn-${++this.connectionCounter}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Mock ClaudeAPI instance - in production, this would be replaced with actual implementation
    const api: ClaudeAPI = {
      sendMessage: async (message: string) => `Response to: ${message}`,
      complete: async (prompt: string, options?: any) => `Completion for: ${prompt}`,
      disconnect: async () => {},
      isConnected: () => true
    };
    
    const connection: PooledConnection = {
      id,
      api,
      inUse: false,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      useCount: 0,
      lastValidatedAt: new Date(),
      isHealthy: true,
      consecutiveFailures: 0,
      totalFailures: 0
    };
    
    this.connections.set(id, connection);
    this.emit('connection:created', connection);
    
    this.logger.debug('Created new connection', { id, totalConnections: this.connections.size });
    
    return connection;
  }
  
  async acquire(): Promise<PooledConnection> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }
    
    const acquireStartTime = Date.now();
    const acquireId = `acquire-${acquireStartTime}-${Math.random().toString(36).substring(7)}`;
    
    // Try to find an available connection
    for (const conn of this.connections.values()) {
      if (!conn.inUse && conn.isHealthy) {
        // Check connection age
        if (this.isConnectionTooOld(conn)) {
          await this.destroyConnection(conn);
          continue;
        }
        
        conn.inUse = true;
        conn.lastUsedAt = new Date();
        conn.acquiredAt = new Date();
        conn.acquiredBy = acquireId;
        conn.useCount++;
        
        // Test connection if configured
        if (this.config.testOnBorrow) {
          const isHealthy = await this.testConnection(conn);
          if (!isHealthy) {
            await this.destroyConnection(conn);
            continue;
          }
        }
        
        this.emit('connection:acquired', conn);
        this.logger.debug('Connection acquired', { 
          id: conn.id, 
          acquireId,
          acquireTime: Date.now() - acquireStartTime,
          useCount: conn.useCount 
        });
        return conn;
      }
    }
    
    // Create new connection if under limit
    if (this.connections.size < this.config.max) {
      const conn = await this.createConnection();
      conn.inUse = true;
      conn.acquiredAt = new Date();
      conn.acquiredBy = acquireId;
      conn.useCount++;
      this.emit('connection:acquired', conn);
      return conn;
    }
    
    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex(item => item.resolve === resolve);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error('Connection acquire timeout'));
      }, this.config.acquireTimeoutMillis);
      
      this.waitingQueue.push({ resolve, reject, timeout });
    });
  }
  
  async release(connection: PooledConnection): Promise<void> {
    const conn = this.connections.get(connection.id);
    if (!conn) {
      this.logger.warn('Attempted to release unknown connection', { id: connection.id });
      return;
    }
    
    if (!conn.inUse) {
      this.logger.warn('Attempted to release connection that is not in use', { id: connection.id });
      return;
    }
    
    const releaseTime = Date.now();
    const holdTime = conn.acquiredAt ? releaseTime - conn.acquiredAt.getTime() : 0;
    
    // Test connection on return if configured
    if (this.config.testOnReturn) {
      const isHealthy = await this.testConnection(conn);
      if (!isHealthy) {
        await this.destroyConnection(conn);
        // Try to create replacement if under minimum
        if (this.connections.size < this.config.min && !this.isShuttingDown) {
          await this.createConnection();
        }
        return;
      }
    }
    
    conn.inUse = false;
    conn.lastUsedAt = new Date();
    delete conn.acquiredAt;
    delete conn.acquiredBy;
    
    this.emit('connection:released', conn);
    this.logger.debug('Connection released', { 
      id: conn.id, 
      holdTime,
      useCount: conn.useCount 
    });
    
    // Check if anyone is waiting for a connection
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        conn.inUse = true;
        conn.acquiredAt = new Date();
        conn.acquiredBy = `queued-${Date.now()}`;
        conn.useCount++;
        waiter.resolve(conn);
      }
    }
  }
  
  async execute<T>(fn: (api: ClaudeAPI) => Promise<T>): Promise<T> {
    const conn = await this.acquire();
    try {
      return await fn(conn.api);
    } finally {
      await this.release(conn);
    }
  }
  
  private async testConnection(conn: PooledConnection): Promise<boolean> {
    try {
      const startTime = Date.now();
      
      // Check if API is still connected
      if (!conn.api.isConnected()) {
        conn.isHealthy = false;
        conn.consecutiveFailures++;
        conn.totalFailures++;
        return false;
      }
      
      // Perform a quick validation request with timeout
      const validationPromise = Promise.race([
        conn.api.sendMessage('health-check'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Validation timeout')), this.config.validationTimeout)
        )
      ]);
      
      await validationPromise;
      
      // Update connection health status
      conn.isHealthy = true;
      conn.consecutiveFailures = 0;
      conn.lastValidatedAt = new Date();
      
      const validationTime = Date.now() - startTime;
      this.logger.debug('Connection validation successful', { 
        id: conn.id, 
        validationTime,
        totalFailures: conn.totalFailures
      });
      
      return true;
    } catch (error) {
      conn.isHealthy = false;
      conn.consecutiveFailures++;
      conn.totalFailures++;
      
      this.logger.warn('Connection health check failed', { 
        id: conn.id, 
        consecutiveFailures: conn.consecutiveFailures,
        totalFailures: conn.totalFailures,
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      
      return false;
    }
  }
  
  private async destroyConnection(conn: PooledConnection): Promise<void> {
    this.connections.delete(conn.id);
    this.emit('connection:destroyed', conn);
    
    // Ensure minimum connections
    if (this.connections.size < this.config.min && !this.isShuttingDown) {
      await this.createConnection();
    }
  }
  
  private evictIdleConnections(): void {
    const now = Date.now();
    const idleThreshold = now - this.config.idleTimeoutMillis;
    
    for (const conn of this.connections.values()) {
      if (!conn.inUse && 
          conn.lastUsedAt.getTime() < idleThreshold && 
          this.connections.size > this.config.min) {
        this.destroyConnection(conn);
      }
    }
  }
  
  async drain(): Promise<void> {
    this.isShuttingDown = true;
    
    // Clear all timers
    this.stopAllTimers();
    
    // Reject all waiting requests
    for (const waiter of this.waitingQueue) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Connection pool is draining'));
    }
    this.waitingQueue = [];
    
    // Wait for all connections to be released
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (true) {
      const inUseConnections = Array.from(this.connections.values())
        .filter(conn => conn.inUse);
      
      if (inUseConnections.length === 0) break;
      
      if (Date.now() - startTime > maxWaitTime) {
        this.logger.warn('Timeout waiting for connections to be released', { 
          inUseCount: inUseConnections.length,
          inUseConnections: inUseConnections.map(c => ({
            id: c.id,
            acquiredBy: c.acquiredBy,
            acquiredAt: c.acquiredAt,
            holdTime: c.acquiredAt ? Date.now() - c.acquiredAt.getTime() : 0
          }))
        });
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Destroy all connections
    for (const conn of this.connections.values()) {
      await this.destroyConnection(conn);
    }
    
    this.logger.info('Connection pool drained', { 
      finalConnectionCount: this.connections.size,
      totalConnectionsCreated: this.connectionCounter
    });
  }
  
  getStats() {
    const connections = Array.from(this.connections.values());
    const healthyConnections = connections.filter(c => c.isHealthy);
    const unhealthyConnections = connections.filter(c => !c.isHealthy);
    
    return {
      total: connections.length,
      inUse: connections.filter(c => c.inUse).length,
      idle: connections.filter(c => !c.inUse).length,
      healthy: healthyConnections.length,
      unhealthy: unhealthyConnections.length,
      waitingQueue: this.waitingQueue.length,
      totalUseCount: connections.reduce((sum, c) => sum + c.useCount, 0),
      totalFailures: connections.reduce((sum, c) => sum + c.totalFailures, 0),
      averageUseCount: connections.length > 0 ? connections.reduce((sum, c) => sum + c.useCount, 0) / connections.length : 0,
      oldestConnection: connections.length > 0 ? Math.min(...connections.map(c => c.createdAt.getTime())) : null,
      newestConnection: connections.length > 0 ? Math.max(...connections.map(c => c.createdAt.getTime())) : null
    };
  }
  
  /**
   * Start eviction timer
   */
  private startEvictionTimer(): void {
    this.stopEvictionTimer();
    this.evictionTimer = setInterval(() => {
      this.evictIdleConnections();
    }, this.config.evictionRunIntervalMillis);
  }
  
  /**
   * Stop eviction timer
   */
  private stopEvictionTimer(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      delete this.evictionTimer;
    }
  }
  
  /**
   * Start health check timer
   */
  private startHealthCheckTimer(): void {
    this.stopHealthCheckTimer();
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }
  
  /**
   * Stop health check timer
   */
  private stopHealthCheckTimer(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      delete this.healthCheckTimer;
    }
  }
  
  /**
   * Start leak detection timer
   */
  private startLeakDetectionTimer(): void {
    this.stopLeakDetectionTimer();
    this.leakDetectionTimer = setInterval(() => {
      this.detectConnectionLeaks();
    }, this.config.leakDetectionThreshold);
  }
  
  /**
   * Stop leak detection timer
   */
  private stopLeakDetectionTimer(): void {
    if (this.leakDetectionTimer) {
      clearInterval(this.leakDetectionTimer);
      delete this.leakDetectionTimer;
    }
  }
  
  /**
   * Stop all timers
   */
  private stopAllTimers(): void {
    this.stopEvictionTimer();
    this.stopHealthCheckTimer();
    this.stopLeakDetectionTimer();
  }
  
  /**
   * Perform health checks on idle connections
   */
  private async performHealthChecks(): Promise<void> {
    if (this.isShuttingDown || !this.config.testWhileIdle) {
      return;
    }
    
    const idleConnections = Array.from(this.connections.values())
      .filter(conn => !conn.inUse && conn.isHealthy);
    
    for (const conn of idleConnections) {
      try {
        const needsValidation = !conn.lastValidatedAt || 
          (Date.now() - conn.lastValidatedAt.getTime()) > this.config.healthCheckInterval;
        
        if (needsValidation) {
          const isHealthy = await this.testConnection(conn);
          if (!isHealthy) {
            await this.destroyConnection(conn);
          }
        }
      } catch (error) {
        this.logger.error('Error during health check', { 
          connectionId: conn.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }
  
  /**
   * Detect connection leaks
   */
  private detectConnectionLeaks(): void {
    if (this.isShuttingDown) {
      return;
    }
    
    const now = Date.now();
    const leakedConnections = Array.from(this.connections.values())
      .filter(conn => {
        return conn.inUse && 
               conn.acquiredAt && 
               (now - conn.acquiredAt.getTime()) > this.config.leakDetectionThreshold;
      });
    
    for (const conn of leakedConnections) {
      const holdTime = conn.acquiredAt ? now - conn.acquiredAt.getTime() : 0;
      this.logger.warn('Potential connection leak detected', {
        connectionId: conn.id,
        acquiredBy: conn.acquiredBy,
        holdTime,
        useCount: conn.useCount
      });
      
      this.emit('connection:leak', {
        connection: conn,
        holdTime,
        threshold: this.config.leakDetectionThreshold
      });
    }
  }
  
  /**
   * Check if connection is too old
   */
  private isConnectionTooOld(conn: PooledConnection): boolean {
    return (Date.now() - conn.createdAt.getTime()) > this.config.maxConnectionAge;
  }
}