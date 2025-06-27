import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { performance } from 'perf_hooks';

interface ConnectionPoolOptions {
  min: number;
  max: number;
  acquireTimeout: number;
  idleTimeout: number;
  filename: string;
  readonly?: boolean;
}

interface PerformanceMetrics {
  totalQueries: number;
  totalDuration: number;
  slowQueries: Array<{ query: string; duration: number; timestamp: Date }>;
}

class DatabaseConnection {
  private db: Database.Database;
  private inUse: boolean = false;
  private lastUsed: number = Date.now();
  private readonly id: string;

  constructor(filename: string, readonly: boolean = false, id: string) {
    this.id = id;
    this.db = new Database(filename, { readonly });
    this.setupPragmas();
  }

  private setupPragmas(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB
    this.db.pragma('page_size = 4096');
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('mmap_size = 268435456'); // 256MB
    this.db.pragma('optimize');
  }

  acquire(): void {
    if (this.inUse) {
      throw new Error(`Connection ${this.id} is already in use`);
    }
    this.inUse = true;
    this.lastUsed = Date.now();
  }

  release(): void {
    this.inUse = false;
    this.lastUsed = Date.now();
  }

  isInUse(): boolean {
    return this.inUse;
  }

  getIdleTime(): number {
    return Date.now() - this.lastUsed;
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

export class DatabaseConnectionPool extends EventEmitter {
  private connections: DatabaseConnection[] = [];
  private options: ConnectionPoolOptions;
  private metrics: PerformanceMetrics = {
    totalQueries: 0,
    totalDuration: 0,
    slowQueries: []
  };
  private cleanupInterval?: NodeJS.Timeout;

  constructor(options: ConnectionPoolOptions) {
    super();
    this.options = options;
    this.ensureDirectoryExists();
    this.initializePool();
    this.startCleanupTimer();
  }

  private ensureDirectoryExists(): void {
    const dir = dirname(this.options.filename);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private initializePool(): void {
    for (let i = 0; i < this.options.min; i++) {
      const conn = new DatabaseConnection(
        this.options.filename,
        this.options.readonly,
        `conn-${i}`
      );
      this.connections.push(conn);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 30000); // Every 30 seconds
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    const toRemove: DatabaseConnection[] = [];

    for (let i = this.connections.length - 1; i >= this.options.min; i--) {
      const conn = this.connections[i];
      if (!conn.isInUse() && conn.getIdleTime() > this.options.idleTimeout) {
        toRemove.push(conn);
        this.connections.splice(i, 1);
      }
    }

    toRemove.forEach(conn => conn.close());
    
    if (toRemove.length > 0) {
      this.emit('connectionsRemoved', toRemove.length);
    }
  }

  async acquire(): Promise<Database.Database> {
    const startTime = Date.now();
    const timeout = this.options.acquireTimeout;

    while (Date.now() - startTime < timeout) {
      // Try to find an available connection
      for (const conn of this.connections) {
        if (!conn.isInUse()) {
          conn.acquire();
          this.emit('connectionAcquired');
          return conn.getDatabase();
        }
      }

      // Create new connection if under max limit
      if (this.connections.length < this.options.max) {
        const conn = new DatabaseConnection(
          this.options.filename,
          this.options.readonly,
          `conn-${this.connections.length}`
        );
        conn.acquire();
        this.connections.push(conn);
        this.emit('connectionCreated');
        return conn.getDatabase();
      }

      // Wait a bit before trying again
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    throw new Error(
      `Failed to acquire database connection within ${timeout}ms. ` +
      `Pool size: ${this.connections.length}, all connections in use.`
    );
  }

  release(db: Database.Database): void {
    const conn = this.connections.find(c => c.getDatabase() === db);
    if (conn) {
      conn.release();
      this.emit('connectionReleased');
    }
  }

  async withConnection<T>(
    fn: (db: Database.Database) => T | Promise<T>
  ): Promise<T> {
    const db = await this.acquire();
    try {
      const start = performance.now();
      const result = await fn(db);
      const duration = performance.now() - start;
      
      this.recordMetrics(duration);
      
      return result;
    } finally {
      this.release(db);
    }
  }

  async withTransaction<T>(
    fn: (db: Database.Database) => T | Promise<T>
  ): Promise<T> {
    return this.withConnection(async (db) => {
      const transaction = db.transaction(() => fn(db));
      return transaction();
    });
  }

  private recordMetrics(duration: number, query?: string): void {
    this.metrics.totalQueries++;
    this.metrics.totalDuration += duration;

    // Record slow queries (> 100ms)
    if (duration > 100 && query) {
      this.metrics.slowQueries.push({
        query,
        duration,
        timestamp: new Date()
      });

      // Keep only last 100 slow queries
      if (this.metrics.slowQueries.length > 100) {
        this.metrics.slowQueries.shift();
      }
    }
  }

  getMetrics(): PerformanceMetrics {
    return {
      ...this.metrics,
      averageQueryTime: this.metrics.totalQueries > 0
        ? this.metrics.totalDuration / this.metrics.totalQueries
        : 0
    };
  }

  getPoolStats(): {
    total: number;
    inUse: number;
    available: number;
    utilization: number;
  } {
    const inUse = this.connections.filter(c => c.isInUse()).length;
    return {
      total: this.connections.length,
      inUse,
      available: this.connections.length - inUse,
      utilization: this.connections.length > 0
        ? (inUse / this.connections.length) * 100
        : 0
    };
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Wait for all connections to be released
    const maxWait = 5000; // 5 seconds
    const start = Date.now();
    
    while (this.connections.some(c => c.isInUse()) && Date.now() - start < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Force close all connections
    this.connections.forEach(conn => conn.close());
    this.connections = [];
    
    this.emit('poolClosed');
  }
}

// Singleton instance
let pool: DatabaseConnectionPool | null = null;

export function initializeDatabase(options: Partial<ConnectionPoolOptions> = {}): DatabaseConnectionPool {
  if (pool) {
    throw new Error('Database pool already initialized');
  }

  const defaultOptions: ConnectionPoolOptions = {
    filename: './data/claude-flow.db',
    min: 2,
    max: 10,
    acquireTimeout: 30000,
    idleTimeout: 60000,
    readonly: false,
    ...options
  };

  pool = new DatabaseConnectionPool(defaultOptions);
  return pool;
}

export function getDatabase(): DatabaseConnectionPool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initializeDatabase() first.');
  }
  return pool;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

// Helper functions for common operations
export async function query<T = any>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const db = getDatabase();
  return db.withConnection((conn) => {
    const stmt = conn.prepare(sql);
    return stmt.all(...params) as T[];
  });
}

export async function queryOne<T = any>(
  sql: string,
  params: any[] = []
): Promise<T | undefined> {
  const db = getDatabase();
  return db.withConnection((conn) => {
    const stmt = conn.prepare(sql);
    return stmt.get(...params) as T | undefined;
  });
}

export async function execute(
  sql: string,
  params: any[] = []
): Promise<Database.RunResult> {
  const db = getDatabase();
  return db.withConnection((conn) => {
    const stmt = conn.prepare(sql);
    return stmt.run(...params);
  });
}

export async function executeMany(
  sql: string,
  paramsList: any[][]
): Promise<void> {
  const db = getDatabase();
  return db.withTransaction((conn) => {
    const stmt = conn.prepare(sql);
    for (const params of paramsList) {
      stmt.run(...params);
    }
  });
}

// Export types
export { Database };