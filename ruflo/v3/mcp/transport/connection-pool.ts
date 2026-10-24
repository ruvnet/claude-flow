/**
 * V3 MCP Connection Pool
 *
 * High-performance connection pooling for MCP transports:
 * - Reusable connection management
 * - Health checking and automatic recovery
 * - Load balancing across connections
 * - Circuit breaker pattern for fault tolerance
 *
 * Performance Targets:
 * - 3-5x throughput improvement
 * - Connection reuse: >95%
 * - Health check: <10ms
 */

import { EventEmitter } from 'events';

/**
 * Connection pool configuration
 */
export interface ConnectionPoolConfig {
  /** Minimum connections to maintain */
  minConnections: number;
  /** Maximum connections allowed */
  maxConnections: number;
  /** Connection acquisition timeout (ms) */
  acquireTimeout: number;
  /** Idle timeout before connection removal (ms) */
  idleTimeout: number;
  /** Health check interval (ms) */
  healthCheckInterval: number;
  /** Max consecutive failures before circuit break */
  maxFailures: number;
  /** Circuit breaker reset time (ms) */
  circuitBreakerResetTime: number;
}

/**
 * Default pool configuration
 */
const DEFAULT_CONFIG: ConnectionPoolConfig = {
  minConnections: 2,
  maxConnections: 10,
  acquireTimeout: 5000,
  idleTimeout: 30000,
  healthCheckInterval: 10000,
  maxFailures: 3,
  circuitBreakerResetTime: 30000,
};

/**
 * Connection state
 */
type ConnectionState = 'available' | 'acquired' | 'unhealthy';

/**
 * Pooled connection wrapper
 */
export interface PooledConnection<T> {
  id: string;
  connection: T;
  state: ConnectionState;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
  consecutiveFailures: number;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  totalConnections: number;
  availableConnections: number;
  acquiredConnections: number;
  unhealthyConnections: number;
  totalAcquisitions: number;
  totalReleases: number;
  totalCreations: number;
  totalRemovals: number;
  avgAcquireTime: number;
  circuitBreakerOpen: boolean;
}

/**
 * Connection factory interface
 */
export interface ConnectionFactory<T> {
  create(): Promise<T>;
  validate(connection: T): Promise<boolean>;
  destroy(connection: T): Promise<void>;
}

/**
 * Generic Connection Pool
 *
 * Provides high-performance connection management with:
 * - Lazy connection creation
 * - Health checking
 * - Circuit breaker pattern
 * - Statistics tracking
 */
export class ConnectionPool<T> extends EventEmitter {
  private config: ConnectionPoolConfig;
  private connections: Map<string, PooledConnection<T>> = new Map();
  private waitQueue: Array<{
    resolve: (conn: PooledConnection<T>) => void;
    reject: (error: Error) => void;
    timeoutId: NodeJS.Timeout;
  }> = [];
  private connectionCounter = 0;
  private healthCheckTimer?: NodeJS.Timeout;
  private circuitBreakerOpen = false;
  private circuitBreakerOpenedAt = 0;

  // Statistics
  private totalAcquisitions = 0;
  private totalReleases = 0;
  private totalCreations = 0;
  private totalRemovals = 0;
  private totalAcquireTime = 0;

  constructor(
    private readonly factory: ConnectionFactory<T>,
    config: Partial<ConnectionPoolConfig> = {}
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the pool
   */
  async initialize(): Promise<void> {
    // Create minimum connections
    const promises: Promise<void>[] = [];
    for (let i = 0; i < this.config.minConnections; i++) {
      promises.push(this.createConnection());
    }
    await Promise.all(promises);

    // Start health check timer
    this.startHealthCheck();

    this.emit('initialized', { connections: this.connections.size });
  }

  /**
   * Shutdown the pool
   */
  async shutdown(): Promise<void> {
    // Stop health check
    this.stopHealthCheck();

    // Reject all waiting requests
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error('Pool shutting down'));
    }
    this.waitQueue = [];

    // Destroy all connections
    const destroyPromises: Promise<void>[] = [];
    for (const pooled of this.connections.values()) {
      destroyPromises.push(this.destroyConnection(pooled));
    }
    await Promise.all(destroyPromises);

    this.emit('shutdown');
  }

  /**
   * Acquire a connection from the pool
   */
  async acquire(): Promise<PooledConnection<T>> {
    const startTime = performance.now();

    // Check circuit breaker
    if (this.circuitBreakerOpen) {
      if (Date.now() - this.circuitBreakerOpenedAt > this.config.circuitBreakerResetTime) {
        // Reset circuit breaker
        this.circuitBreakerOpen = false;
        this.emit('circuitBreaker:reset');
      } else {
        throw new Error('Circuit breaker open - service unavailable');
      }
    }

    // Try to get an available connection
    for (const pooled of this.connections.values()) {
      if (pooled.state === 'available') {
        pooled.state = 'acquired';
        pooled.lastUsedAt = Date.now();
        pooled.useCount++;
        this.totalAcquisitions++;
        this.totalAcquireTime += performance.now() - startTime;
        this.emit('connection:acquired', { id: pooled.id });
        return pooled;
      }
    }

    // No available connection - try to create new one
    if (this.connections.size < this.config.maxConnections) {
      await this.createConnection();
      return this.acquire(); // Recursive call to get the new connection
    }

    // Pool exhausted - wait for a connection
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitQueue.findIndex(w => w.timeoutId === timeoutId);
        if (index >= 0) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error('Connection acquire timeout'));
      }, this.config.acquireTimeout);

      this.waitQueue.push({ resolve, reject, timeoutId });
    });
  }

  /**
   * Release a connection back to the pool
   */
  release(pooled: PooledConnection<T>, success = true): void {
    if (!this.connections.has(pooled.id)) {
      return; // Connection was already removed
    }

    if (!success) {
      pooled.consecutiveFailures++;
      if (pooled.consecutiveFailures >= this.config.maxFailures) {
        this.markUnhealthy(pooled);
        this.checkCircuitBreaker();
        return;
      }
    } else {
      pooled.consecutiveFailures = 0;
    }

    // Check if there are waiters
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timeoutId);
      pooled.state = 'acquired';
      pooled.lastUsedAt = Date.now();
      pooled.useCount++;
      this.totalAcquisitions++;
      waiter.resolve(pooled);
    } else {
      pooled.state = 'available';
      pooled.lastUsedAt = Date.now();
    }

    this.totalReleases++;
    this.emit('connection:released', { id: pooled.id });
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    let available = 0;
    let acquired = 0;
    let unhealthy = 0;

    for (const pooled of this.connections.values()) {
      switch (pooled.state) {
        case 'available':
          available++;
          break;
        case 'acquired':
          acquired++;
          break;
        case 'unhealthy':
          unhealthy++;
          break;
      }
    }

    return {
      totalConnections: this.connections.size,
      availableConnections: available,
      acquiredConnections: acquired,
      unhealthyConnections: unhealthy,
      totalAcquisitions: this.totalAcquisitions,
      totalReleases: this.totalReleases,
      totalCreations: this.totalCreations,
      totalRemovals: this.totalRemovals,
      avgAcquireTime: this.totalAcquisitions > 0 ? this.totalAcquireTime / this.totalAcquisitions : 0,
      circuitBreakerOpen: this.circuitBreakerOpen,
    };
  }

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<void> {
    const id = `conn-${++this.connectionCounter}`;

    try {
      const connection = await this.factory.create();

      const pooled: PooledConnection<T> = {
        id,
        connection,
        state: 'available',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        useCount: 0,
        consecutiveFailures: 0,
      };

      this.connections.set(id, pooled);
      this.totalCreations++;
      this.emit('connection:created', { id });
    } catch (error) {
      this.emit('connection:createFailed', { id, error });
      throw error;
    }
  }

  /**
   * Destroy a connection
   */
  private async destroyConnection(pooled: PooledConnection<T>): Promise<void> {
    this.connections.delete(pooled.id);
    this.totalRemovals++;

    try {
      await this.factory.destroy(pooled.connection);
      this.emit('connection:destroyed', { id: pooled.id });
    } catch (error) {
      this.emit('connection:destroyFailed', { id: pooled.id, error });
    }
  }

  /**
   * Mark a connection as unhealthy
   */
  private markUnhealthy(pooled: PooledConnection<T>): void {
    pooled.state = 'unhealthy';
    this.emit('connection:unhealthy', { id: pooled.id });
  }

  /**
   * Check if circuit breaker should open
   */
  private checkCircuitBreaker(): void {
    let unhealthyCount = 0;
    for (const pooled of this.connections.values()) {
      if (pooled.state === 'unhealthy') {
        unhealthyCount++;
      }
    }

    // Open circuit breaker if majority of connections are unhealthy
    if (unhealthyCount > this.connections.size / 2) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenedAt = Date.now();
      this.emit('circuitBreaker:open');
    }
  }

  /**
   * Start health check timer
   */
  private startHealthCheck(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health check timer
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Perform health check on all connections
   */
  private async performHealthCheck(): Promise<void> {
    const now = Date.now();
    const promises: Promise<void>[] = [];

    for (const pooled of this.connections.values()) {
      // Skip acquired connections
      if (pooled.state === 'acquired') {
        continue;
      }

      // Remove idle connections (keep minimum)
      if (
        pooled.state === 'available' &&
        now - pooled.lastUsedAt > this.config.idleTimeout &&
        this.connections.size > this.config.minConnections
      ) {
        promises.push(this.destroyConnection(pooled));
        continue;
      }

      // Validate unhealthy connections
      if (pooled.state === 'unhealthy') {
        promises.push(this.validateAndRecover(pooled));
      }
    }

    // Ensure minimum connections
    const availableCount = Array.from(this.connections.values()).filter(
      p => p.state === 'available'
    ).length;

    if (availableCount < this.config.minConnections) {
      const toCreate = this.config.minConnections - availableCount;
      for (let i = 0; i < toCreate; i++) {
        promises.push(this.createConnection());
      }
    }

    await Promise.allSettled(promises);
  }

  /**
   * Validate and recover an unhealthy connection
   */
  private async validateAndRecover(pooled: PooledConnection<T>): Promise<void> {
    try {
      const isValid = await this.factory.validate(pooled.connection);
      if (isValid) {
        pooled.state = 'available';
        pooled.consecutiveFailures = 0;
        this.emit('connection:recovered', { id: pooled.id });
      } else {
        // Replace the connection
        await this.destroyConnection(pooled);
        await this.createConnection();
      }
    } catch {
      // Replace the connection
      await this.destroyConnection(pooled);
      await this.createConnection();
    }
  }
}

/**
 * Create a connection pool
 */
export function createConnectionPool<T>(
  factory: ConnectionFactory<T>,
  config?: Partial<ConnectionPoolConfig>
): ConnectionPool<T> {
  return new ConnectionPool(factory, config);
}
