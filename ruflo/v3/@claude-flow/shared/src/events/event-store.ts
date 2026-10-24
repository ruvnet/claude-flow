/**
 * Event Store Persistence (ADR-007)
 *
 * Provides persistent storage for domain events using SQLite.
 * Supports event replay, snapshots, and projections.
 *
 * Key Features:
 * - Append-only event log
 * - Event versioning per aggregate
 * - Event filtering and queries
 * - Snapshot support for performance
 * - Event replay for projections
 * - Cross-platform SQLite (sql.js fallback)
 *
 * @module v3/shared/events/event-store
 */

import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { DomainEvent, AllDomainEvents } from './domain-events.js';

// =============================================================================
// Event Store Configuration
// =============================================================================

export interface EventStoreConfig {
  /** Path to SQLite database file (:memory: for in-memory) */
  databasePath: string;

  /** Enable verbose logging */
  verbose: boolean;

  /** Auto-persist interval in milliseconds (0 = manual only) */
  autoPersistInterval: number;

  /** Maximum events before snapshot recommendation */
  snapshotThreshold: number;

  /** Path to sql.js WASM file (optional) */
  wasmPath?: string;
}

const DEFAULT_CONFIG: EventStoreConfig = {
  databasePath: ':memory:',
  verbose: false,
  autoPersistInterval: 5000, // 5 seconds
  snapshotThreshold: 100,
};

// =============================================================================
// Event Store Interfaces
// =============================================================================

export interface EventFilter {
  /** Filter by aggregate IDs */
  aggregateIds?: string[];

  /** Filter by aggregate types */
  aggregateTypes?: Array<'agent' | 'task' | 'memory' | 'swarm'>;

  /** Filter by event types */
  eventTypes?: string[];

  /** Filter events after timestamp */
  afterTimestamp?: number;

  /** Filter events before timestamp */
  beforeTimestamp?: number;

  /** Filter by minimum version */
  fromVersion?: number;

  /** Limit number of results */
  limit?: number;

  /** Offset for pagination */
  offset?: number;
}

export interface EventSnapshot {
  /** Aggregate ID */
  aggregateId: string;

  /** Aggregate type */
  aggregateType: 'agent' | 'task' | 'memory' | 'swarm';

  /** Version at snapshot */
  version: number;

  /** Snapshot state */
  state: Record<string, unknown>;

  /** Timestamp when snapshot was created */
  timestamp: number;
}

export interface EventStoreStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsByAggregate: Record<string, number>;
  oldestEvent: number | null;
  newestEvent: number | null;
  snapshotCount: number;
}

// =============================================================================
// Event Store Implementation
// =============================================================================

export class EventStore extends EventEmitter {
  private config: EventStoreConfig;
  private db: SqlJsDatabase | null = null;
  private initialized: boolean = false;
  private persistTimer: NodeJS.Timeout | null = null;
  private SQL: any = null;

  // Version tracking per aggregate
  private aggregateVersions: Map<string, number> = new Map();

  constructor(config: Partial<EventStoreConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the event store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load sql.js WASM
    this.SQL = await initSqlJs({
      locateFile: this.config.wasmPath
        ? () => this.config.wasmPath!
        : (file) => `https://sql.js.org/dist/${file}`,
    });

    // Load existing database if exists
    if (this.config.databasePath !== ':memory:' && existsSync(this.config.databasePath)) {
      const buffer = readFileSync(this.config.databasePath);
      this.db = new this.SQL.Database(new Uint8Array(buffer));

      if (this.config.verbose) {
        console.log(`[EventStore] Loaded database from ${this.config.databasePath}`);
      }
    } else {
      this.db = new this.SQL.Database();

      if (this.config.verbose) {
        console.log('[EventStore] Created new event store database');
      }
    }

    // Create schema
    this.createSchema();

    // Load aggregate versions
    this.loadAggregateVersions();

    // Set up auto-persist
    if (this.config.autoPersistInterval > 0 && this.config.databasePath !== ':memory:') {
      this.persistTimer = setInterval(() => {
        this.persist().catch((err) => {
          this.emit('error', { operation: 'auto-persist', error: err });
        });
      }, this.config.autoPersistInterval);
    }

    this.initialized = true;
    this.emit('initialized');
  }

  /**
   * Shutdown the event store
   */
  async shutdown(): Promise<void> {
    if (!this.initialized || !this.db) return;

    // Stop auto-persist
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    // Final persist
    if (this.config.databasePath !== ':memory:') {
      await this.persist();
    }

    this.db.close();
    this.db = null;
    this.initialized = false;
    this.emit('shutdown');
  }

  /**
   * Append a new event to the store
   */
  async append(event: DomainEvent): Promise<void> {
    this.ensureInitialized();

    // Get next version for aggregate
    const currentVersion = this.aggregateVersions.get(event.aggregateId) || 0;
    const nextVersion = currentVersion + 1;

    // Set version on event
    event.version = nextVersion;

    // Insert event
    const stmt = `
      INSERT INTO events (
        id, type, aggregate_id, aggregate_type, version, timestamp,
        source, payload, metadata, causation_id, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    this.db!.run(stmt, [
      event.id,
      event.type,
      event.aggregateId,
      event.aggregateType,
      event.version,
      event.timestamp,
      event.source,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata || {}),
      event.causationId || null,
      event.correlationId || null,
    ]);

    // Update version tracker
    this.aggregateVersions.set(event.aggregateId, nextVersion);

    // Emit event appended notification
    this.emit('event:appended', event);

    // Check if snapshot needed
    if (nextVersion % this.config.snapshotThreshold === 0) {
      this.emit('snapshot:recommended', { aggregateId: event.aggregateId, version: nextVersion });
    }
  }

  /**
   * Get events for a specific aggregate
   */
  async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
    this.ensureInitialized();

    let sql = 'SELECT * FROM events WHERE aggregate_id = ?';
    const params: any[] = [aggregateId];

    if (fromVersion !== undefined) {
      sql += ' AND version >= ?';
      params.push(fromVersion);
    }

    sql += ' ORDER BY version ASC';

    const stmt = this.db!.prepare(sql);
    const events: DomainEvent[] = [];

    stmt.bind(params);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      events.push(this.rowToEvent(row));
    }

    stmt.free();

    return events;
  }

  /**
   * Get events by type
   */
  async getEventsByType(type: string): Promise<DomainEvent[]> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT * FROM events WHERE type = ? ORDER BY timestamp ASC');
    const events: DomainEvent[] = [];

    stmt.bind([type]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      events.push(this.rowToEvent(row));
    }

    stmt.free();

    return events;
  }

  /**
   * Query events with filters
   */
  async query(filter: EventFilter): Promise<DomainEvent[]> {
    this.ensureInitialized();

    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: any[] = [];

    // Aggregate ID filter
    if (filter.aggregateIds && filter.aggregateIds.length > 0) {
      sql += ` AND aggregate_id IN (${filter.aggregateIds.map(() => '?').join(',')})`;
      params.push(...filter.aggregateIds);
    }

    // Aggregate type filter
    if (filter.aggregateTypes && filter.aggregateTypes.length > 0) {
      sql += ` AND aggregate_type IN (${filter.aggregateTypes.map(() => '?').join(',')})`;
      params.push(...filter.aggregateTypes);
    }

    // Event type filter
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      sql += ` AND type IN (${filter.eventTypes.map(() => '?').join(',')})`;
      params.push(...filter.eventTypes);
    }

    // Timestamp filters
    if (filter.afterTimestamp) {
      sql += ' AND timestamp > ?';
      params.push(filter.afterTimestamp);
    }

    if (filter.beforeTimestamp) {
      sql += ' AND timestamp < ?';
      params.push(filter.beforeTimestamp);
    }

    // Version filter
    if (filter.fromVersion) {
      sql += ' AND version >= ?';
      params.push(filter.fromVersion);
    }

    // Order by timestamp
    sql += ' ORDER BY timestamp ASC';

    // Pagination
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    if (filter.offset) {
      sql += ' OFFSET ?';
      params.push(filter.offset);
    }

    const stmt = this.db!.prepare(sql);
    const events: DomainEvent[] = [];

    stmt.bind(params);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      events.push(this.rowToEvent(row));
    }

    stmt.free();

    return events;
  }

  /**
   * Replay events from a specific version
   */
  async *replay(fromVersion: number = 0): AsyncIterable<DomainEvent> {
    this.ensureInitialized();

    const stmt = this.db!.prepare('SELECT * FROM events WHERE version >= ? ORDER BY version ASC');
    stmt.bind([fromVersion]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      yield this.rowToEvent(row);
    }

    stmt.free();
  }

  /**
   * Save a snapshot for an aggregate
   */
  async saveSnapshot(snapshot: EventSnapshot): Promise<void> {
    this.ensureInitialized();

    const stmt = `
      INSERT OR REPLACE INTO snapshots (
        aggregate_id, aggregate_type, version, state, timestamp
      ) VALUES (?, ?, ?, ?, ?)
    `;

    this.db!.run(stmt, [
      snapshot.aggregateId,
      snapshot.aggregateType,
      snapshot.version,
      JSON.stringify(snapshot.state),
      snapshot.timestamp,
    ]);

    this.emit('snapshot:saved', snapshot);
  }

  /**
   * Get snapshot for an aggregate
   */
  async getSnapshot(aggregateId: string): Promise<EventSnapshot | null> {
    this.ensureInitialized();

    const stmt = this.db!.prepare(
      'SELECT * FROM snapshots WHERE aggregate_id = ? ORDER BY version DESC LIMIT 1'
    );

    const row = stmt.getAsObject([aggregateId]);
    stmt.free();

    if (!row || Object.keys(row).length === 0) {
      return null;
    }

    return {
      aggregateId: row.aggregate_id as string,
      aggregateType: row.aggregate_type as any,
      version: row.version as number,
      state: JSON.parse(row.state as string),
      timestamp: row.timestamp as number,
    };
  }

  /**
   * Get event store statistics
   */
  async getStats(): Promise<EventStoreStats> {
    this.ensureInitialized();

    // Total events
    const totalStmt = this.db!.prepare('SELECT COUNT(*) as count FROM events');
    const totalRow = totalStmt.getAsObject();
    totalStmt.free();
    const totalEvents = (totalRow.count as number) || 0;

    // Events by type
    const typeStmt = this.db!.prepare('SELECT type, COUNT(*) as count FROM events GROUP BY type');
    const eventsByType: Record<string, number> = {};
    while (typeStmt.step()) {
      const row = typeStmt.getAsObject();
      eventsByType[row.type as string] = (row.count as number) || 0;
    }
    typeStmt.free();

    // Events by aggregate
    const aggStmt = this.db!.prepare(
      'SELECT aggregate_id, COUNT(*) as count FROM events GROUP BY aggregate_id'
    );
    const eventsByAggregate: Record<string, number> = {};
    while (aggStmt.step()) {
      const row = aggStmt.getAsObject();
      eventsByAggregate[row.aggregate_id as string] = (row.count as number) || 0;
    }
    aggStmt.free();

    // Timestamp range
    const rangeStmt = this.db!.prepare('SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest FROM events');
    const rangeRow = rangeStmt.getAsObject();
    rangeStmt.free();

    // Snapshot count
    const snapshotStmt = this.db!.prepare('SELECT COUNT(*) as count FROM snapshots');
    const snapshotRow = snapshotStmt.getAsObject();
    snapshotStmt.free();

    return {
      totalEvents,
      eventsByType,
      eventsByAggregate,
      oldestEvent: (rangeRow.oldest as number) || null,
      newestEvent: (rangeRow.newest as number) || null,
      snapshotCount: (snapshotRow.count as number) || 0,
    };
  }

  /**
   * Persist to disk
   */
  async persist(): Promise<void> {
    if (!this.db || this.config.databasePath === ':memory:') {
      return;
    }

    const data = this.db.export();
    const buffer = Buffer.from(data);

    writeFileSync(this.config.databasePath, buffer);

    if (this.config.verbose) {
      console.log(`[EventStore] Persisted ${buffer.length} bytes to ${this.config.databasePath}`);
    }

    this.emit('persisted', { size: buffer.length, path: this.config.databasePath });
  }

  // ===== Private Methods =====

  private createSchema(): void {
    if (!this.db) return;

    // Events table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        source TEXT NOT NULL,
        payload TEXT NOT NULL,
        metadata TEXT,
        causation_id TEXT,
        correlation_id TEXT
      )
    `);

    // Indexes for performance
    this.db.run('CREATE INDEX IF NOT EXISTS idx_aggregate_id ON events(aggregate_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_aggregate_type ON events(aggregate_type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_event_type ON events(type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON events(timestamp)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_version ON events(version)');
    this.db.run(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_aggregate_version ON events(aggregate_id, version)'
    );

    // Snapshots table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS snapshots (
        aggregate_id TEXT PRIMARY KEY,
        aggregate_type TEXT NOT NULL,
        version INTEGER NOT NULL,
        state TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    if (this.config.verbose) {
      console.log('[EventStore] Schema created successfully');
    }
  }

  private loadAggregateVersions(): void {
    if (!this.db) return;

    const stmt = this.db.prepare(
      'SELECT aggregate_id, MAX(version) as max_version FROM events GROUP BY aggregate_id'
    );

    while (stmt.step()) {
      const row = stmt.getAsObject();
      this.aggregateVersions.set(row.aggregate_id as string, (row.max_version as number) || 0);
    }

    stmt.free();
  }

  private rowToEvent(row: any): DomainEvent {
    return {
      id: row.id as string,
      type: row.type as string,
      aggregateId: row.aggregate_id as string,
      aggregateType: row.aggregate_type as any,
      version: row.version as number,
      timestamp: row.timestamp as number,
      source: row.source as any,
      payload: JSON.parse(row.payload as string),
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      causationId: row.causation_id as string | undefined,
      correlationId: row.correlation_id as string | undefined,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('EventStore not initialized. Call initialize() first.');
    }
  }
}
