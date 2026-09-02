/**
 * @claude-flow/mcp - Connection Pool
 *
 * High-performance connection pooling
 */

import { EventEmitter } from 'events';
import type {
  PooledConnection,
  ConnectionPoolStats,
  ConnectionPoolConfig,
  ConnectionState,
  IConnectionPool,
  ILogger,
  TransportType,
} from './types.js';

const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections: 10,
  minConnections: 2,
  idleTimeout: 30000,
  acquireTimeout: 5000,
  maxWaitingClients: 50,
  evictionRunInterval: 10000,
};

class ManagedConnection implements PooledConnection {
  public state: ConnectionState = 'idle';
  public lastUsedAt: Date;
  public useCount: number = 0;

  constructor(
    public readonly id: string,
    public readonly transport: TransportType,
    public readonly createdAt: Date = new Date(),
    public metadata?: Record<string, unknown>
  ) {
    this.lastUsedAt = this.createdAt;
  }

  acquire(): void {
    this.state = 'busy';
    this.lastUsedAt = new Date();
    this.useCount++;
  }

  release(): void {
    this.state = 'idle';
    this.lastUsedAt = new Date();
  }

  isExpired(idleTimeout: number): boolean {
    if (this.state !== 'idle') return false;
    return Date.now() - this.lastUsedAt.getTime() > idleTimeout;
  }

  isHealthy(): boolean {
    return this.state !== 'error' && this.state !== 'closed';
  }
}

interface WaitingClient {
  resolve: (connection: PooledConnection) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export class ConnectionPool extends EventEmitter implements IConnectionPool {
  private readonly config: ConnectionPoolConfig;
  private readonly connections: Map<string, ManagedConnection> = new Map();
  private readonly waitingClients: WaitingClient[] = [];
  private evictionTimer?: NodeJS.Timeout;
  private connectionCounter: number = 0;
  private isShuttingDown: boolean = false;

  private stats = {
    totalAcquired: 0,
    totalReleased: 0,
    totalCreated: 0,
    totalDestroyed: 0,
    acquireTimeTotal: 0,
    acquireCount: 0,
  };

  constructor(
    config: Partial<ConnectionPoolConfig> = {},
    private readonly logger: ILogger,
    private readonly transportType: TransportType = 'in-process'
  ) {
    super();
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
    this.startEvictionTimer();
    this.initializeMinConnections();
  }

  private async initializeMinConnections(): Promise<void> {
    const promises: Promise<ManagedConnection>[] = [];
    for (let i = 0; i < this.config.minConnections; i++) {
      promises.push(this.createConnection());
    }
    await Promise.all(promises);
    this.logger.debug('Connection pool initialized', {
      minConnections: this.config.minConnections,
    });
  }

  private async createConnection(): Promise<ManagedConnection> {
    const id = `conn-${++this.connectionCounter}-${Date.now()}`;
    const connection = new ManagedConnection(id, this.transportType);

    this.connections.set(id, connection);
    this.stats.totalCreated++;

    this.emit('pool:connection:created', { connectionId: id });
    this.logger.debug('Connection created', { id, total: this.connections.size });

    return connection;
  }

  async acquire(): Promise<PooledConnection> {
    const startTime = performance.now();

    if (this.isShuttingDown) {
      throw new Error('Connection pool is shutting down');
    }

    for (const connection of this.connections.values()) {
      if (connection.state === 'idle' && connection.isHealthy()) {
        connection.acquire();
        this.stats.totalAcquired++;
        this.recordAcquireTime(startTime);

        this.emit('pool:connection:acquired', { connectionId: connection.id });
        this.logger.debug('Connection acquired from pool', { id: connection.id });

        return connection;
      }
    }

    if (this.connections.size < this.config.maxConnections) {
      const connection = await this.createConnection();
      connection.acquire();
      this.stats.totalAcquired++;
      this.recordAcquireTime(startTime);

      this.emit('pool:connection:acquired', { connectionId: connection.id });
      return connection;
    }

    return this.waitForConnection(startTime);
  }

  private waitForConnection(startTime: number): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      if (this.waitingClients.length >= this.config.maxWaitingClients) {
        reject(new Error('Connection pool exhausted - max waiting clients reached'));
        return;
      }

      const client: WaitingClient = {
        resolve: (connection) => {
          this.recordAcquireTime(startTime);
          resolve(connection);
        },
        reject,
        timestamp: Date.now(),
      };

      this.waitingClients.push(client);

      setTimeout(() => {
        const index = this.waitingClients.indexOf(client);
        if (index !== -1) {
          this.waitingClients.splice(index, 1);
          reject(new Error(`Connection acquire timeout after ${this.config.acquireTimeout}ms`));
        }
      }, this.config.acquireTimeout);
    });
  }

  release(connection: PooledConnection): void {
    const managed = this.connections.get(connection.id);
    if (!managed) {
      this.logger.warn('Attempted to release unknown connection', { id: connection.id });
      return;
    }

    const waitingClient = this.waitingClients.shift();
    if (waitingClient) {
      managed.acquire();
      this.stats.totalAcquired++;
      this.emit('pool:connection:acquired', { connectionId: connection.id });
      waitingClient.resolve(managed);
      return;
    }

    managed.release();
    this.stats.totalReleased++;

    this.emit('pool:connection:released', { connectionId: connection.id });
    this.logger.debug('Connection released to pool', { id: connection.id });
  }

  destroy(connection: PooledConnection): void {
    const managed = this.connections.get(connection.id);
    if (!managed) {
      return;
    }

    managed.state = 'closed';
    this.connections.delete(connection.id);
    this.stats.totalDestroyed++;

    this.emit('pool:connection:destroyed', { connectionId: connection.id });
    this.logger.debug('Connection destroyed', { id: connection.id });

    if (this.connections.size < this.config.minConnections && !this.isShuttingDown) {
      this.createConnection().catch((err) => {
        this.logger.error('Failed to create replacement connection', err);
      });
    }
  }

  getStats(): ConnectionPoolStats {
    let idleCount = 0;
    let busyCount = 0;

    for (const connection of this.connections.values()) {
      if (connection.state === 'idle') idleCount++;
      else if (connection.state === 'busy') busyCount++;
    }

    return {
      totalConnections: this.connections.size,
      idleConnections: idleCount,
      busyConnections: busyCount,
      pendingRequests: this.waitingClients.length,
      totalAcquired: this.stats.totalAcquired,
      totalReleased: this.stats.totalReleased,
      totalCreated: this.stats.totalCreated,
      totalDestroyed: this.stats.totalDestroyed,
      avgAcquireTime: this.stats.acquireCount > 0
        ? this.stats.acquireTimeTotal / this.stats.acquireCount
        : 0,
    };
  }

  async drain(): Promise<void> {
    this.isShuttingDown = true;
    this.logger.info('Draining connection pool');

    while (this.waitingClients.length > 0) {
      const client = this.waitingClients.shift();
      client?.reject(new Error('Connection pool is draining'));
    }

    const maxWait = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      let busyCount = 0;
      for (const connection of this.connections.values()) {
        if (connection.state === 'busy') busyCount++;
      }

      if (busyCount === 0) break;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.logger.info('Connection pool drained');
  }

  async clear(): Promise<void> {
    this.stopEvictionTimer();
    await this.drain();

    for (const connection of this.connections.values()) {
      connection.state = 'closed';
    }

    this.connections.clear();
    this.logger.info('Connection pool cleared');
  }

  private startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => {
      this.evictIdleConnections();
    }, this.config.evictionRunInterval);
  }

  private stopEvictionTimer(): void {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = undefined;
    }
  }

  private evictIdleConnections(): void {
    if (this.isShuttingDown) return;

    const toEvict: ManagedConnection[] = [];

    for (const connection of this.connections.values()) {
      if (
        connection.isExpired(this.config.idleTimeout) &&
        this.connections.size > this.config.minConnections
      ) {
        toEvict.push(connection);
      }
    }

    for (const connection of toEvict) {
      this.destroy(connection);
      this.logger.debug('Evicted idle connection', { id: connection.id });
    }

    if (toEvict.length > 0) {
      this.logger.info('Evicted idle connections', { count: toEvict.length });
    }
  }

  private recordAcquireTime(startTime: number): void {
    const duration = performance.now() - startTime;
    this.stats.acquireTimeTotal += duration;
    this.stats.acquireCount++;
  }

  getConnections(): PooledConnection[] {
    return Array.from(this.connections.values());
  }

  isHealthy(): boolean {
    return !this.isShuttingDown && this.connections.size >= this.config.minConnections;
  }
}

export function createConnectionPool(
  config: Partial<ConnectionPoolConfig> = {},
  logger: ILogger,
  transportType: TransportType = 'in-process'
): ConnectionPool {
  return new ConnectionPool(config, logger, transportType);
}
