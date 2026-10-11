/**
 * RVF Event Log (ADR-057 Phase 2)
 *
 * Pure-TypeScript append-only event log that stores events in a binary
 * file format. Replaces the sql.js-dependent EventStore with a zero-
 * dependency alternative.
 *
 * Binary format:
 *   File header:  4 bytes — magic "RVFL"
 *   Record:       4 bytes (uint32 BE payload length) + N bytes (JSON payload)
 *
 * In-memory indexes are rebuilt on initialize() by replaying the file.
 * Snapshots are stored in a separate `.snap.rvf` file using the same format.
 *
 * @module v3/shared/events/rvf-event-log
 */

import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DomainEvent } from './domain-events.js';

// Re-export shared interfaces so consumers do not need to import event-store.ts
import type { EventFilter, EventSnapshot, EventStoreStats } from './event-store.js';

/** Validate a file path is safe */
function validatePath(p: string): void {
  if (p.includes('\0')) throw new Error('Event log path contains null bytes');
}

// =============================================================================
// Configuration
// =============================================================================

export interface RvfEventLogConfig {
  /** Path to event log file */
  logPath: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Maximum events before snapshot recommendation */
  snapshotThreshold?: number;
}

const DEFAULT_CONFIG: Required<RvfEventLogConfig> = {
  logPath: 'events.rvf',
  verbose: false,
  snapshotThreshold: 100,
};

// =============================================================================
// Constants
// =============================================================================

/** Magic bytes that identify an RVF event log file */
const MAGIC = Buffer.from('RVFL');
const MAGIC_LENGTH = 4;
const LENGTH_PREFIX_BYTES = 4;

// =============================================================================
// RvfEventLog Implementation
// =============================================================================

export class RvfEventLog extends EventEmitter {
  private config: Required<RvfEventLogConfig>;
  private initialized = false;

  /**
   * All events kept in insertion order.
   * Rebuilt from the file on initialize().
   */
  private events: DomainEvent[] = [];

  /** Fast lookup: aggregateId -> indices into this.events */
  private aggregateIndex: Map<string, number[]> = new Map();

  /** Version tracking per aggregate */
  private aggregateVersions: Map<string, number> = new Map();

  /** Snapshots keyed by aggregateId (latest wins) */
  private snapshots: Map<string, EventSnapshot> = new Map();

  /** Path to the companion snapshot file */
  private snapshotPath: string;

  constructor(config: Partial<RvfEventLogConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<RvfEventLogConfig>;
    this.snapshotPath = this.config.logPath.replace(/\.rvf$/, '.snap.rvf');
    if (this.snapshotPath === this.config.logPath) {
      this.snapshotPath = this.config.logPath + '.snap.rvf';
    }
    validatePath(this.config.logPath);
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /** Create / open the log file and rebuild in-memory indexes. */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.ensureDirectory(this.config.logPath);

    // --- events file ---
    if (existsSync(this.config.logPath)) {
      this.replayFile(this.config.logPath, (event: DomainEvent) => {
        this.indexEvent(event);
      });
    } else {
      const tmpLog = this.config.logPath + '.tmp';
      writeFileSync(tmpLog, MAGIC);
      renameSync(tmpLog, this.config.logPath);
    }

    // --- snapshots file ---
    if (existsSync(this.snapshotPath)) {
      this.replayFile(this.snapshotPath, (_raw: unknown) => {
        const snap = _raw as EventSnapshot;
        this.snapshots.set(snap.aggregateId, snap);
      });
    } else {
      const tmpSnap = this.snapshotPath + '.tmp';
      writeFileSync(tmpSnap, MAGIC);
      renameSync(tmpSnap, this.snapshotPath);
    }

    this.initialized = true;

    if (this.config.verbose) {
      console.log(
        `[RvfEventLog] Initialized – ${this.events.length} events, ` +
          `${this.snapshots.size} snapshots`
      );
    }

    this.emit('initialized');
  }

  /** Flush to disk and release resources. */
  async close(): Promise<void> {
    if (!this.initialized) return;

    // All data is already on disk (append-only), so just clear memory.
    this.events = [];
    this.aggregateIndex.clear();
    this.aggregateVersions.clear();
    this.snapshots.clear();
    this.initialized = false;

    this.emit('shutdown');
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /** Append a domain event to the log. */
  async append(event: DomainEvent): Promise<void> {
    this.ensureInitialized();

    if (!event.aggregateId || typeof event.aggregateId !== 'string') {
      throw new Error('Event must have a valid aggregateId string');
    }
    if (!event.type || typeof event.type !== 'string') {
      throw new Error('Event must have a valid type string');
    }

    // Assign next version for aggregate
    const currentVersion = this.aggregateVersions.get(event.aggregateId) ?? 0;
    const nextVersion = currentVersion + 1;
    event.version = nextVersion;

    // Persist to disk first (crash-safe ordering)
    this.appendRecord(this.config.logPath, event);

    // Update in-memory state
    this.indexEvent(event);

    this.emit('event:appended', event);

    if (nextVersion % this.config.snapshotThreshold === 0) {
      this.emit('snapshot:recommended', {
        aggregateId: event.aggregateId,
        version: nextVersion,
      });
    }
  }

  /** Save a snapshot for an aggregate. */
  async saveSnapshot(snapshot: EventSnapshot): Promise<void> {
    this.ensureInitialized();

    this.appendRecord(this.snapshotPath, snapshot);
    this.snapshots.set(snapshot.aggregateId, snapshot);

    this.emit('snapshot:saved', snapshot);
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /** Get events for a specific aggregate, optionally from a version. */
  async getEvents(aggregateId: string, fromVersion?: number): Promise<DomainEvent[]> {
    this.ensureInitialized();

    const indices = this.aggregateIndex.get(aggregateId);
    if (!indices || indices.length === 0) return [];

    let result = indices.map((i) => this.events[i]);

    if (fromVersion !== undefined) {
      result = result.filter((e) => e.version >= fromVersion);
    }

    // Events within an aggregate are already version-ordered because we
    // append in order, but sort defensively.
    return result.sort((a, b) => a.version - b.version);
  }

  /** Query events with an optional filter (matches EventStore.query API). */
  async getAllEvents(filter?: EventFilter): Promise<DomainEvent[]> {
    this.ensureInitialized();

    if (!filter) {
      return [...this.events].sort((a, b) => a.timestamp - b.timestamp);
    }

    let result: DomainEvent[] = [...this.events];

    // Aggregate ID filter
    if (filter.aggregateIds && filter.aggregateIds.length > 0) {
      const set = new Set(filter.aggregateIds);
      result = result.filter((e) => set.has(e.aggregateId));
    }

    // Aggregate type filter
    if (filter.aggregateTypes && filter.aggregateTypes.length > 0) {
      const set = new Set<string>(filter.aggregateTypes);
      result = result.filter((e) => set.has(e.aggregateType));
    }

    // Event type filter
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      const set = new Set(filter.eventTypes);
      result = result.filter((e) => set.has(e.type));
    }

    // Timestamp filters
    if (filter.afterTimestamp !== undefined) {
      result = result.filter((e) => e.timestamp > filter.afterTimestamp!);
    }
    if (filter.beforeTimestamp !== undefined) {
      result = result.filter((e) => e.timestamp < filter.beforeTimestamp!);
    }

    // Version filter
    if (filter.fromVersion !== undefined) {
      result = result.filter((e) => e.version >= filter.fromVersion!);
    }

    // Sort by timestamp ascending (matches EventStore behaviour)
    result.sort((a, b) => a.timestamp - b.timestamp);

    // Pagination
    if (filter.offset) {
      result = result.slice(filter.offset);
    }
    if (filter.limit !== undefined) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /** Get latest snapshot for an aggregate. */
  async getSnapshot(aggregateId: string): Promise<EventSnapshot | null> {
    this.ensureInitialized();
    return this.snapshots.get(aggregateId) ?? null;
  }

  /** Return event store statistics. */
  async getStats(): Promise<EventStoreStats> {
    this.ensureInitialized();

    const eventsByType: Record<string, number> = {};
    const eventsByAggregate: Record<string, number> = {};
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const event of this.events) {
      // by type
      eventsByType[event.type] = (eventsByType[event.type] ?? 0) + 1;

      // by aggregate
      eventsByAggregate[event.aggregateId] =
        (eventsByAggregate[event.aggregateId] ?? 0) + 1;

      // timestamp range
      if (oldest === null || event.timestamp < oldest) oldest = event.timestamp;
      if (newest === null || event.timestamp > newest) newest = event.timestamp;
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      eventsByAggregate,
      oldestEvent: oldest,
      newestEvent: newest,
      snapshotCount: this.snapshots.size,
    };
  }

  /**
   * Flush to disk.
   * For the append-only log this is a no-op because every append() call
   * writes to disk synchronously. Provided for API compatibility with
   * EventStore.
   */
  async persist(): Promise<void> {
    // All records are already flushed on append. Nothing to do.
    if (this.config.verbose) {
      console.log('[RvfEventLog] persist() called — all data already on disk');
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Replay an RVF file and invoke `handler` for every decoded record.
   * Used both for events and snapshots.
   */
  private replayFile(filePath: string, handler: (record: any) => void): void {
    const buf = readFileSync(filePath);

    // Validate magic
    if (buf.length < MAGIC_LENGTH || buf.subarray(0, MAGIC_LENGTH).compare(MAGIC) !== 0) {
      throw new Error(`[RvfEventLog] Invalid file header in ${filePath}`);
    }

    let offset = MAGIC_LENGTH;

    const MAX_PAYLOAD_SIZE = 100 * 1024 * 1024; // 100MB safety limit
    while (offset + LENGTH_PREFIX_BYTES <= buf.length) {
      const payloadLength = buf.readUInt32BE(offset);
      offset += LENGTH_PREFIX_BYTES;

      if (payloadLength > MAX_PAYLOAD_SIZE) {
        if (this.config.verbose) {
          console.warn(`[RvfEventLog] Payload size ${payloadLength} exceeds safety limit`);
        }
        break;
      }

      if (offset + payloadLength > buf.length) {
        // Truncated record — stop reading (crash recovery).
        if (this.config.verbose) {
          console.warn(
            `[RvfEventLog] Truncated record at offset ${offset - LENGTH_PREFIX_BYTES} — ` +
              `expected ${payloadLength} bytes, have ${buf.length - offset}`
          );
        }
        break;
      }

      const json = buf.subarray(offset, offset + payloadLength).toString('utf8');
      offset += payloadLength;

      try {
        const record = JSON.parse(json);
        handler(record);
      } catch {
        if (this.config.verbose) {
          console.warn(`[RvfEventLog] Corrupt JSON record skipped`);
        }
      }
    }
  }

  /** Append a single record to an RVF file. */
  private appendRecord(filePath: string, record: unknown): void {
    const json = JSON.stringify(record);
    const payload = Buffer.from(json, 'utf8');
    const lengthBuf = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES);
    lengthBuf.writeUInt32BE(payload.length, 0);

    appendFileSync(filePath, Buffer.concat([lengthBuf, payload]));
  }

  /** Add an event to the in-memory indexes. */
  private indexEvent(event: DomainEvent): void {
    const idx = this.events.length;
    this.events.push(event);

    // aggregateIndex
    let indices = this.aggregateIndex.get(event.aggregateId);
    if (!indices) {
      indices = [];
      this.aggregateIndex.set(event.aggregateId, indices);
    }
    indices.push(idx);

    // version tracker
    const current = this.aggregateVersions.get(event.aggregateId) ?? 0;
    if (event.version > current) {
      this.aggregateVersions.set(event.aggregateId, event.version);
    }
  }

  /** Ensure parent directory exists for a file path. */
  private ensureDirectory(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /** Guard that throws if initialize() has not been called. */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RvfEventLog not initialized. Call initialize() first.');
    }
  }
}
