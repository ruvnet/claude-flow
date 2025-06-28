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
}

export interface PooledConnection {
  id: string;
  api: ClaudeAPI;
  inUse: boolean;
  createdAt: Date;
  lastUsedAt: Date;
  useCount: number;
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
  private isShuttingDown = false;
  
  constructor(config: Partial<PoolConfig> = {}) {
    super();
    
    this.config = {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000,
      evictionRunIntervalMillis: 10000,
      testOnBorrow: true,
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
    
    // Start eviction timer
    this.evictionTimer = setInterval(() => {
      this.evictIdleConnections();
    }, this.config.evictionRunIntervalMillis);
    
    this.logger.info('Connection pool initialized', {
      min: this.config.min,
      max: this.config.max
    });
  }
  
  private async createConnection(): Promise<PooledConnection> {
    const id = `conn-${Date.now()}-${Math.random().toString(36).substring(7)}`;
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
      useCount: 0
    };
    
    this.connections.set(id, connection);
    this.emit('connection:created', connection);
    
    return connection;
  }
  
  async acquire(): Promise<PooledConnection> {
    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }
    
    // Try to find an available connection
    for (const conn of this.connections.values()) {
      if (!conn.inUse) {
        conn.inUse = true;
        conn.lastUsedAt = new Date();
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
        return conn;
      }
    }
    
    // Create new connection if under limit
    if (this.connections.size < this.config.max) {
      const conn = await this.createConnection();
      conn.inUse = true;
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
    
    conn.inUse = false;
    conn.lastUsedAt = new Date();
    
    this.emit('connection:released', conn);
    
    // Check if anyone is waiting for a connection
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        clearTimeout(waiter.timeout);
        conn.inUse = true;
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
      // Simple health check - could be expanded
      return true;
    } catch (error) {
      this.logger.warn('Connection health check failed', { 
        id: conn.id, 
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
    
    // Clear eviction timer
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = undefined;
    }
    
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
      const inUseCount = Array.from(this.connections.values())
        .filter(conn => conn.inUse).length;
      
      if (inUseCount === 0) break;
      
      if (Date.now() - startTime > maxWaitTime) {
        this.logger.warn('Timeout waiting for connections to be released', { inUseCount });
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Destroy all connections
    for (const conn of this.connections.values()) {
      await this.destroyConnection(conn);
    }
    
    this.logger.info('Connection pool drained');
  }
  
  getStats() {
    const connections = Array.from(this.connections.values());
    return {
      total: connections.length,
      inUse: connections.filter(c => c.inUse).length,
      idle: connections.filter(c => !c.inUse).length,
      waitingQueue: this.waitingQueue.length,
      totalUseCount: connections.reduce((sum, c) => sum + c.useCount, 0)
    };
  }
}