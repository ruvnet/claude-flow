/**
 * Database service for swarm coordination system
 * Provides data access layer with support for multiple database engines
 */

import { ILogger } from '../core/logger.js';
import { DatabaseError } from '../utils/errors.js';
import { nanoid } from 'nanoid';

export interface DatabaseConfig {
  type: 'sqlite' | 'mysql' | 'postgresql';
  host?: string;
  port?: number;
  database: string;
  username?: string;
  password?: string;
  ssl?: boolean;
  poolSize?: number;
  timeout?: number;
  retryAttempts?: number;
}

export interface SwarmRecord {
  id: string;
  name: string;
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star';
  maxAgents: number;
  strategy: 'balanced' | 'specialized' | 'adaptive';
  status: 'initializing' | 'active' | 'paused' | 'destroyed';
  config?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  destroyedAt?: Date;
}

export interface AgentRecord {
  id: string;
  swarmId: string;
  type: string;
  name?: string;
  status: 'spawning' | 'idle' | 'busy' | 'error' | 'terminated';
  capabilities?: string[];
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  terminatedAt?: Date;
}

export interface TaskRecord {
  id: string;
  swarmId: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  strategy: 'parallel' | 'sequential' | 'adaptive';
  status: 'pending' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
  maxAgents?: number;
  requirements?: string[];
  metadata?: Record<string, unknown>;
  result?: unknown;
  errorMessage?: string;
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface MetricRecord {
  id: string;
  swarmId?: string;
  agentId?: string;
  metricType: string;
  metricName: string;
  metricValue: number;
  unit?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface EventRecord {
  id: string;
  swarmId?: string;
  agentId?: string;
  eventType: string;
  eventName: string;
  eventData?: Record<string, unknown>;
  severity: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  createdAt: Date;
}

/**
 * Database service implementation
 */
export class DatabaseService {
  private db: any; // Database connection instance
  private initialized = false;

  constructor(
    private config: DatabaseConfig,
    private logger: ILogger,
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing database service', {
        type: this.config.type,
        database: this.config.database,
      });

      // Initialize database connection based on type
      switch (this.config.type) {
        case 'sqlite':
          await this.initializeSQLite();
          break;
        case 'mysql':
          await this.initializeMySQL();
          break;
        case 'postgresql':
          await this.initializePostgreSQL();
          break;
        default:
          throw new DatabaseError(`Unsupported database type: ${this.config.type}`);
      }

      // Run migrations if needed
      await this.runMigrations();

      this.initialized = true;
      this.logger.info('Database service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize database service', error);
      throw new DatabaseError('Database initialization failed', { error });
    }
  }

  async shutdown(): Promise<void> {
    if (!this.initialized || !this.db) {
      return;
    }

    try {
      if (this.config.type === 'sqlite') {
        await this.db.close();
      } else {
        await this.db.end();
      }
      this.initialized = false;
      this.logger.info('Database service shutdown complete');
    } catch (error) {
      this.logger.error('Error shutting down database service', error);
    }
  }

  // Swarm operations
  async createSwarm(swarm: Omit<SwarmRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SwarmRecord> {
    const id = `swarm_${Date.now()}_${nanoid(10)}`;
    const now = new Date();

    const record: SwarmRecord = {
      id,
      ...swarm,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const query = `
        INSERT INTO swarms (id, name, topology, max_agents, strategy, status, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        record.id,
        record.name,
        record.topology,
        record.maxAgents,
        record.strategy,
        record.status,
        JSON.stringify(record.config),
        record.createdAt,
        record.updatedAt,
      ];

      await this.execute(query, values);
      return record;
    } catch (error) {
      throw new DatabaseError('Failed to create swarm', { error, swarmId: id });
    }
  }

  async getSwarm(id: string): Promise<SwarmRecord | null> {
    try {
      const query = 'SELECT * FROM swarms WHERE id = ?';
      const rows = await this.query(query, [id]);
      
      if (rows.length === 0) {
        return null;
      }

      return this.mapSwarmRow(rows[0]);
    } catch (error) {
      throw new DatabaseError('Failed to get swarm', { error, swarmId: id });
    }
  }

  async updateSwarm(id: string, updates: Partial<SwarmRecord>): Promise<void> {
    try {
      const setClause = Object.keys(updates)
        .filter(key => key !== 'id' && key !== 'createdAt')
        .map(key => `${this.camelToSnake(key)} = ?`)
        .join(', ');
      
      const values = Object.entries(updates)
        .filter(([key]) => key !== 'id' && key !== 'createdAt')
        .map(([key, value]) => {
          if (key === 'config' && typeof value === 'object') {
            return JSON.stringify(value);
          }
          return value;
        });
      
      values.push(new Date()); // updated_at
      values.push(id);

      const query = `UPDATE swarms SET ${setClause}, updated_at = ? WHERE id = ?`;
      await this.execute(query, values);
    } catch (error) {
      throw new DatabaseError('Failed to update swarm', { error, swarmId: id });
    }
  }

  async deleteSwarm(id: string): Promise<void> {
    try {
      const query = 'UPDATE swarms SET status = ?, destroyed_at = ? WHERE id = ?';
      await this.execute(query, ['destroyed', new Date(), id]);
    } catch (error) {
      throw new DatabaseError('Failed to delete swarm', { error, swarmId: id });
    }
  }

  async listSwarms(filter?: { status?: string }): Promise<SwarmRecord[]> {
    try {
      let query = 'SELECT * FROM swarms';
      const values: any[] = [];

      if (filter?.status) {
        query += ' WHERE status = ?';
        values.push(filter.status);
      }

      query += ' ORDER BY created_at DESC';
      const rows = await this.query(query, values);
      
      return rows.map(row => this.mapSwarmRow(row));
    } catch (error) {
      throw new DatabaseError('Failed to list swarms', { error });
    }
  }

  // Agent operations
  async createAgent(agent: Omit<AgentRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AgentRecord> {
    const id = `agent_${Date.now()}_${nanoid(10)}`;
    const now = new Date();

    const record: AgentRecord = {
      id,
      ...agent,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const query = `
        INSERT INTO agents (id, swarm_id, type, name, status, capabilities, config, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        record.id,
        record.swarmId,
        record.type,
        record.name,
        record.status,
        JSON.stringify(record.capabilities),
        JSON.stringify(record.config),
        JSON.stringify(record.metadata),
        record.createdAt,
        record.updatedAt,
      ];

      await this.execute(query, values);
      return record;
    } catch (error) {
      throw new DatabaseError('Failed to create agent', { error, agentId: id });
    }
  }

  async getAgentsBySwarm(swarmId: string): Promise<AgentRecord[]> {
    try {
      const query = 'SELECT * FROM agents WHERE swarm_id = ? AND status != ? ORDER BY created_at';
      const rows = await this.query(query, [swarmId, 'terminated']);
      
      return rows.map(row => this.mapAgentRow(row));
    } catch (error) {
      throw new DatabaseError('Failed to get agents by swarm', { error, swarmId });
    }
  }

  async updateAgent(id: string, updates: Partial<AgentRecord>): Promise<void> {
    try {
      const setClause = Object.keys(updates)
        .filter(key => key !== 'id' && key !== 'createdAt')
        .map(key => `${this.camelToSnake(key)} = ?`)
        .join(', ');
      
      const values = Object.entries(updates)
        .filter(([key]) => key !== 'id' && key !== 'createdAt')
        .map(([key, value]) => {
          if (['capabilities', 'config', 'metadata'].includes(key) && typeof value === 'object') {
            return JSON.stringify(value);
          }
          return value;
        });
      
      values.push(new Date()); // updated_at
      values.push(id);

      const query = `UPDATE agents SET ${setClause}, updated_at = ? WHERE id = ?`;
      await this.execute(query, values);
    } catch (error) {
      throw new DatabaseError('Failed to update agent', { error, agentId: id });
    }
  }

  // Task operations
  async createTask(task: Omit<TaskRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskRecord> {
    const id = `task_${Date.now()}_${nanoid(10)}`;
    const now = new Date();

    const record: TaskRecord = {
      id,
      ...task,
      createdAt: now,
      updatedAt: now,
    };

    try {
      const query = `
        INSERT INTO tasks (id, swarm_id, description, priority, strategy, status, max_agents, requirements, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        record.id,
        record.swarmId,
        record.description,
        record.priority,
        record.strategy,
        record.status,
        record.maxAgents,
        JSON.stringify(record.requirements),
        JSON.stringify(record.metadata),
        record.createdAt,
        record.updatedAt,
      ];

      await this.execute(query, values);
      return record;
    } catch (error) {
      throw new DatabaseError('Failed to create task', { error, taskId: id });
    }
  }

  async getTasksBySwarm(swarmId: string): Promise<TaskRecord[]> {
    try {
      const query = 'SELECT * FROM tasks WHERE swarm_id = ? ORDER BY created_at DESC';
      const rows = await this.query(query, [swarmId]);
      
      return rows.map(row => this.mapTaskRow(row));
    } catch (error) {
      throw new DatabaseError('Failed to get tasks by swarm', { error, swarmId });
    }
  }

  async updateTask(id: string, updates: Partial<TaskRecord>): Promise<void> {
    try {
      const setClause = Object.keys(updates)
        .filter(key => key !== 'id' && key !== 'createdAt')
        .map(key => `${this.camelToSnake(key)} = ?`)
        .join(', ');
      
      const values = Object.entries(updates)
        .filter(([key]) => key !== 'id' && key !== 'createdAt')
        .map(([key, value]) => {
          if (['requirements', 'metadata', 'result'].includes(key) && typeof value === 'object') {
            return JSON.stringify(value);
          }
          return value;
        });
      
      values.push(new Date()); // updated_at
      values.push(id);

      const query = `UPDATE tasks SET ${setClause}, updated_at = ? WHERE id = ?`;
      await this.execute(query, values);
    } catch (error) {
      throw new DatabaseError('Failed to update task', { error, taskId: id });
    }
  }

  // Metrics operations
  async recordMetric(metric: Omit<MetricRecord, 'id' | 'timestamp'>): Promise<void> {
    const id = `metric_${Date.now()}_${nanoid(8)}`;
    const record = {
      id,
      ...metric,
      timestamp: new Date(),
    };

    try {
      const query = `
        INSERT INTO performance_metrics (id, swarm_id, agent_id, metric_type, metric_name, metric_value, unit, timestamp, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        record.id,
        record.swarmId,
        record.agentId,
        record.metricType,
        record.metricName,
        record.metricValue,
        record.unit,
        record.timestamp,
        JSON.stringify(record.metadata),
      ];

      await this.execute(query, values);
    } catch (error) {
      throw new DatabaseError('Failed to record metric', { error, metricId: id });
    }
  }

  async getMetrics(filter: {
    swarmId?: string;
    agentId?: string;
    metricType?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  }): Promise<MetricRecord[]> {
    try {
      let query = 'SELECT * FROM performance_metrics WHERE 1=1';
      const values: any[] = [];

      if (filter.swarmId) {
        query += ' AND swarm_id = ?';
        values.push(filter.swarmId);
      }
      if (filter.agentId) {
        query += ' AND agent_id = ?';
        values.push(filter.agentId);
      }
      if (filter.metricType) {
        query += ' AND metric_type = ?';
        values.push(filter.metricType);
      }
      if (filter.startTime) {
        query += ' AND timestamp >= ?';
        values.push(filter.startTime);
      }
      if (filter.endTime) {
        query += ' AND timestamp <= ?';
        values.push(filter.endTime);
      }

      query += ' ORDER BY timestamp DESC';
      
      if (filter.limit) {
        query += ' LIMIT ?';
        values.push(filter.limit);
      }

      const rows = await this.query(query, values);
      return rows.map(row => this.mapMetricRow(row));
    } catch (error) {
      throw new DatabaseError('Failed to get metrics', { error });
    }
  }

  // Event logging
  async recordEvent(event: Omit<EventRecord, 'id' | 'createdAt'>): Promise<void> {
    const id = `event_${Date.now()}_${nanoid(8)}`;
    const record = {
      id,
      ...event,
      createdAt: new Date(),
    };

    try {
      const query = `
        INSERT INTO events (id, swarm_id, agent_id, event_type, event_name, event_data, severity, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const values = [
        record.id,
        record.swarmId,
        record.agentId,
        record.eventType,
        record.eventName,
        JSON.stringify(record.eventData),
        record.severity,
        record.createdAt,
      ];

      await this.execute(query, values);
    } catch (error) {
      // Don't throw for event logging failures, just log the error
      this.logger.error('Failed to record event', { error, event: record });
    }
  }

  // Health check
  async getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    try {
      const query = 'SELECT 1 as test';
      await this.query(query);
      
      // Get basic metrics
      const swarmCount = await this.query('SELECT COUNT(*) as count FROM swarms WHERE status != ?', ['destroyed']);
      const agentCount = await this.query('SELECT COUNT(*) as count FROM agents WHERE status != ?', ['terminated']);
      const activeTaskCount = await this.query('SELECT COUNT(*) as count FROM tasks WHERE status IN (?, ?, ?)', ['pending', 'assigned', 'running']);

      return {
        healthy: true,
        metrics: {
          totalSwarms: swarmCount[0]?.count || 0,
          totalAgents: agentCount[0]?.count || 0,
          activeTasks: activeTaskCount[0]?.count || 0,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown database error',
      };
    }
  }

  // Private helper methods
  private async initializeSQLite(): Promise<void> {
    try {
      // Import better-sqlite3 dynamically
      const Database = (await import('better-sqlite3')).default;
      this.db = new Database(this.config.database);
      
      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('cache_size = 1000');
      this.db.pragma('temp_store = memory');
    } catch (error) {
      throw new DatabaseError('Failed to initialize SQLite', { error });
    }
  }

  private async initializeMySQL(): Promise<void> {
    // MySQL initialization would go here
    throw new DatabaseError('MySQL support not implemented yet');
  }

  private async initializePostgreSQL(): Promise<void> {
    // PostgreSQL initialization would go here
    throw new DatabaseError('PostgreSQL support not implemented yet');
  }

  private async runMigrations(): Promise<void> {
    try {
      // Check if migrations table exists
      const migrationQuery = this.config.type === 'sqlite'
        ? "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
        : "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'migrations'";
      
      const migrationTable = await this.query(migrationQuery);
      
      if (migrationTable.length === 0) {
        // Create migrations table and run initial schema
        await this.execute(`
          CREATE TABLE migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename VARCHAR(255) NOT NULL,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        // Run schema creation (simplified for demo)
        await this.createTables();
        
        await this.execute(
          "INSERT INTO migrations (filename) VALUES (?)",
          ['001_initial_schema.sql']
        );
      }
    } catch (error) {
      throw new DatabaseError('Failed to run migrations', { error });
    }
  }

  private async createTables(): Promise<void> {
    const tables = [
      // Swarms table
      `CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        topology TEXT NOT NULL,
        max_agents INTEGER DEFAULT 8,
        strategy TEXT DEFAULT 'balanced',
        status TEXT DEFAULT 'initializing',
        config TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        destroyed_at TEXT
      )`,
      
      // Agents table
      `CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'spawning',
        capabilities TEXT,
        config TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        terminated_at TEXT,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      )`,
      
      // Tasks table
      `CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        description TEXT NOT NULL,
        priority TEXT DEFAULT 'medium',
        strategy TEXT DEFAULT 'adaptive',
        status TEXT DEFAULT 'pending',
        max_agents INTEGER,
        requirements TEXT,
        metadata TEXT,
        result TEXT,
        error_message TEXT,
        assigned_to TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      )`,
      
      // Performance metrics table
      `CREATE TABLE IF NOT EXISTS performance_metrics (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        agent_id TEXT,
        metric_type TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        metric_value REAL NOT NULL,
        unit TEXT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT
      )`,
      
      // Events table
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        swarm_id TEXT,
        agent_id TEXT,
        event_type TEXT NOT NULL,
        event_name TEXT NOT NULL,
        event_data TEXT,
        severity TEXT DEFAULT 'info',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
    ];

    for (const table of tables) {
      await this.execute(table);
    }
  }

  private async query(sql: string, params: any[] = []): Promise<any[]> {
    if (this.config.type === 'sqlite') {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    }
    
    // Other database types would be handled here
    throw new DatabaseError('Unsupported database operation');
  }

  private async execute(sql: string, params: any[] = []): Promise<any> {
    if (this.config.type === 'sqlite') {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    }
    
    // Other database types would be handled here
    throw new DatabaseError('Unsupported database operation');
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  private mapSwarmRow(row: any): SwarmRecord {
    return {
      id: row.id,
      name: row.name,
      topology: row.topology,
      maxAgents: row.max_agents,
      strategy: row.strategy,
      status: row.status,
      config: row.config ? JSON.parse(row.config) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      destroyedAt: row.destroyed_at ? new Date(row.destroyed_at) : undefined,
    };
  }

  private mapAgentRow(row: any): AgentRecord {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      type: row.type,
      name: row.name,
      status: row.status,
      capabilities: row.capabilities ? JSON.parse(row.capabilities) : undefined,
      config: row.config ? JSON.parse(row.config) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      terminatedAt: row.terminated_at ? new Date(row.terminated_at) : undefined,
    };
  }

  private mapTaskRow(row: any): TaskRecord {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      description: row.description,
      priority: row.priority,
      strategy: row.strategy,
      status: row.status,
      maxAgents: row.max_agents,
      requirements: row.requirements ? JSON.parse(row.requirements) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      result: row.result ? JSON.parse(row.result) : undefined,
      errorMessage: row.error_message,
      assignedTo: row.assigned_to,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    };
  }

  private mapMetricRow(row: any): MetricRecord {
    return {
      id: row.id,
      swarmId: row.swarm_id,
      agentId: row.agent_id,
      metricType: row.metric_type,
      metricName: row.metric_name,
      metricValue: row.metric_value,
      unit: row.unit,
      timestamp: new Date(row.timestamp),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}