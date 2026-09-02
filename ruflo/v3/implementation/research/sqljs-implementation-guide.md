# sql.js Implementation Guide for Claude-Flow

**Implementation Date**: 2026-01-03
**Target Version**: Claude-Flow v3.0
**Author**: Research Agent

---

## Overview

This guide provides step-by-step implementation instructions for integrating sql.js as a cross-platform SQLite provider alongside better-sqlite3.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                    │
│  (DatabaseService, MemoryManager, PersistenceManager)   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              DatabaseManager / sqlite-wrapper            │
│              (Provider Selection & Abstraction)          │
└─────────────┬───────────────┬───────────────┬───────────┘
              │               │               │
              ▼               ▼               ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │ SQLiteProvider│ │SqlJsProvider│ │ JSONProvider │
    │(better-sqlite3)│ │  (sql.js)   │ │ (Fallback)  │
    └─────────────┘   └─────────────┘   └─────────────┘
         (Linux/macOS)    (Windows/All)     (Ultimate FB)
```

---

## File Modifications Plan

### New Files

1. **`src/memory/backends/sqljs.ts`** - sql.js backend implementation
2. **`src/memory/providers/sqljs-provider.ts`** - Provider wrapper
3. **`src/utils/sqljs-loader.ts`** - WASM loader utility
4. **`tests/unit/memory/sqljs-backend.test.ts`** - Unit tests
5. **`tests/integration/sqljs-integration.test.ts`** - Integration tests

### Modified Files

1. **`src/memory/sqlite-wrapper.js`** - Add sql.js detection and wrapper
2. **`src/core/DatabaseManager.ts`** - Add SqlJsProvider support
3. **`package.json`** - Add sql.js dependency
4. **`tsconfig.json`** - Configure WASM file handling
5. **`.swcrc`** - Update build configuration

---

## Step-by-Step Implementation

### Step 1: Install sql.js Dependency

**File**: `/home/user/claude-flow/package.json`

```json
{
  "dependencies": {
    "sql.js": "^1.13.0",
    "existing-deps": "..."
  },
  "optionalDependencies": {
    "better-sqlite3": "^12.2.0",
    "agentdb": "^1.6.1"
  }
}
```

**Command**:
```bash
npm install sql.js@^1.13.0 --save
```

---

### Step 2: Create sql.js Backend Implementation

**File**: `/home/user/claude-flow/src/memory/backends/sqljs.ts`

```typescript
/**
 * sql.js Backend Implementation
 * Cross-platform SQLite backend using WebAssembly
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { IMemoryBackend } from './base.js';
import type { MemoryEntry, MemoryQuery } from '../../utils/types.js';
import type { ILogger } from '../../core/logger.js';
import { MemoryBackendError } from '../../utils/errors.js';

/**
 * Configuration for sql.js backend
 */
export interface SqlJsBackendConfig {
  dbPath: string;
  autoSave?: boolean;
  saveInterval?: number;
  wasmPath?: string;
}

/**
 * sql.js-based memory backend with file persistence
 */
export class SqlJsBackend implements IMemoryBackend {
  private SQL: any;
  private db?: SqlJsDatabase;
  private dbPath: string;
  private dirty: boolean = false;
  private saveTimer?: NodeJS.Timeout;
  private autoSave: boolean;
  private saveInterval: number;

  constructor(
    config: SqlJsBackendConfig,
    private logger: ILogger
  ) {
    this.dbPath = config.dbPath;
    this.autoSave = config.autoSave ?? true;
    this.saveInterval = config.saveInterval ?? 30000; // 30 seconds default
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing sql.js backend', {
      dbPath: this.dbPath,
      autoSave: this.autoSave
    });

    try {
      // Load SQL.js WASM module
      this.SQL = await initSqlJs({
        locateFile: (file) => {
          // Try multiple paths for WASM file
          const paths = [
            path.join(__dirname, '../../../node_modules/sql.js/dist', file),
            path.join(process.cwd(), 'node_modules/sql.js/dist', file),
            path.join(__dirname, '../../..', 'node_modules/sql.js/dist', file)
          ];

          for (const testPath of paths) {
            try {
              if (require('fs').existsSync(testPath)) {
                return testPath;
              }
            } catch {}
          }

          // Fallback to default
          return file;
        }
      });

      // Load existing database or create new one
      const dir = path.dirname(this.dbPath);
      await fs.mkdir(dir, { recursive: true });

      if (await this.fileExists(this.dbPath)) {
        await this.loadFromFile();
      } else {
        this.db = new this.SQL.Database();
        this.logger.info('Created new sql.js database');
      }

      // Create schema
      this.createTables();
      this.createIndexes();

      // Setup auto-save if enabled
      if (this.autoSave) {
        this.setupAutoSave();
      }

      this.logger.info('sql.js backend initialized successfully');
    } catch (error) {
      throw new MemoryBackendError('Failed to initialize sql.js backend', { error });
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async loadFromFile(): Promise<void> {
    try {
      const buffer = await fs.readFile(this.dbPath);
      this.db = new this.SQL.Database(new Uint8Array(buffer));
      this.logger.info('Loaded existing database from file', {
        dbPath: this.dbPath,
        size: buffer.length
      });
    } catch (error) {
      this.logger.warn('Failed to load database file, creating new', { error });
      this.db = new this.SQL.Database();
    }
  }

  private createTables(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        context TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        tags TEXT NOT NULL,
        version INTEGER NOT NULL,
        parent_id TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `;

    try {
      this.db!.run(sql);
    } catch (error) {
      throw new MemoryBackendError('Failed to create tables', { error });
    }
  }

  private createIndexes(): void {
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_agent_id ON memory_entries(agent_id)',
      'CREATE INDEX IF NOT EXISTS idx_session_id ON memory_entries(session_id)',
      'CREATE INDEX IF NOT EXISTS idx_type ON memory_entries(type)',
      'CREATE INDEX IF NOT EXISTS idx_timestamp ON memory_entries(timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_parent_id ON memory_entries(parent_id)',
    ];

    for (const sql of indexes) {
      try {
        this.db!.run(sql);
      } catch (error) {
        this.logger.warn('Failed to create index', { sql, error });
      }
    }
  }

  private setupAutoSave(): void {
    this.logger.debug('Setting up auto-save', { interval: this.saveInterval });
  }

  private markDirty(): void {
    this.dirty = true;

    if (this.autoSave) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => {
        this.saveToDisk().catch(err => {
          this.logger.error('Auto-save failed', err);
        });
      }, this.saveInterval);
    }
  }

  private async saveToDisk(): Promise<void> {
    if (!this.dirty || !this.db) return;

    try {
      const data = this.db.export();
      await fs.writeFile(this.dbPath, data);
      this.dirty = false;
      this.logger.debug('Database saved to disk', {
        dbPath: this.dbPath,
        size: data.length
      });
    } catch (error) {
      this.logger.error('Failed to save database', { error });
      throw new MemoryBackendError('Failed to save database', { error });
    }
  }

  async store(entry: MemoryEntry): Promise<void> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = `
      INSERT OR REPLACE INTO memory_entries (
        id, agent_id, session_id, type, content,
        context, timestamp, tags, version, parent_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      entry.id,
      entry.agentId,
      entry.sessionId,
      entry.type,
      entry.content,
      JSON.stringify(entry.context),
      entry.timestamp.toISOString(),
      JSON.stringify(entry.tags),
      entry.version,
      entry.parentId || null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ];

    try {
      this.db.run(sql, params);
      this.markDirty();
    } catch (error) {
      throw new MemoryBackendError('Failed to store entry', { error, entryId: entry.id });
    }
  }

  async retrieve(id: string): Promise<MemoryEntry | undefined> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = 'SELECT * FROM memory_entries WHERE id = ?';

    try {
      const result = this.db.exec(sql, [id]);

      if (result.length === 0 || result[0].values.length === 0) {
        return undefined;
      }

      return this.rowToEntry(result[0]);
    } catch (error) {
      throw new MemoryBackendError('Failed to retrieve entry', { error, entryId: id });
    }
  }

  async update(id: string, entry: MemoryEntry): Promise<void> {
    // sql.js INSERT OR REPLACE handles updates
    await this.store(entry);
  }

  async delete(id: string): Promise<void> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = 'DELETE FROM memory_entries WHERE id = ?';

    try {
      this.db.run(sql, [id]);
      this.markDirty();
    } catch (error) {
      throw new MemoryBackendError('Failed to delete entry', { error, entryId: id });
    }
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.agentId) {
      conditions.push('agent_id = ?');
      params.push(query.agentId);
    }

    if (query.sessionId) {
      conditions.push('session_id = ?');
      params.push(query.sessionId);
    }

    if (query.type) {
      conditions.push('type = ?');
      params.push(query.type);
    }

    if (query.startTime) {
      conditions.push('timestamp >= ?');
      params.push(query.startTime.toISOString());
    }

    if (query.endTime) {
      conditions.push('timestamp <= ?');
      params.push(query.endTime.toISOString());
    }

    if (query.search) {
      conditions.push('(content LIKE ? OR tags LIKE ?)');
      params.push(`%${query.search}%`, `%${query.search}%`);
    }

    if (query.tags && query.tags.length > 0) {
      const tagConditions = query.tags.map(() => 'tags LIKE ?');
      conditions.push(`(${tagConditions.join(' OR ')})`);
      query.tags.forEach((tag: string) => params.push(`%"${tag}"%`));
    }

    let sql = 'SELECT * FROM memory_entries';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY timestamp DESC';

    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }

    if (query.offset) {
      sql += ' OFFSET ?';
      params.push(query.offset);
    }

    try {
      const result = this.db.exec(sql, params);

      if (result.length === 0) {
        return [];
      }

      return this.rowsToEntries(result[0]);
    } catch (error) {
      throw new MemoryBackendError('Failed to query entries', { error, query });
    }
  }

  async getAllEntries(): Promise<MemoryEntry[]> {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }

    const sql = 'SELECT * FROM memory_entries ORDER BY timestamp DESC';

    try {
      const result = this.db.exec(sql);

      if (result.length === 0) {
        return [];
      }

      return this.rowsToEntries(result[0]);
    } catch (error) {
      throw new MemoryBackendError('Failed to get all entries', { error });
    }
  }

  async getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    if (!this.db) {
      return {
        healthy: false,
        error: 'Database not initialized',
      };
    }

    try {
      // Test query
      this.db.exec('SELECT 1');

      // Get metrics
      const countResult = this.db.exec('SELECT COUNT(*) as count FROM memory_entries');
      const entryCount = countResult[0]?.values[0]?.[0] || 0;

      const data = this.db.export();
      const dbSize = data.length;

      return {
        healthy: true,
        metrics: {
          entryCount: Number(entryCount),
          dbSizeBytes: dbSize,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down sql.js backend');

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    // Final save
    if (this.dirty) {
      await this.saveToDisk();
    }

    if (this.db) {
      this.db.close();
      delete this.db;
    }
  }

  private rowToEntry(result: any): MemoryEntry {
    const columns = result.columns;
    const values = result.values[0];

    const row: Record<string, any> = {};
    columns.forEach((col: string, i: number) => {
      row[col] = values[i];
    });

    return this.mapRowToEntry(row);
  }

  private rowsToEntries(result: any): MemoryEntry[] {
    const columns = result.columns;
    const values = result.values;

    return values.map((rowValues: any[]) => {
      const row: Record<string, any> = {};
      columns.forEach((col: string, i: number) => {
        row[col] = rowValues[i];
      });
      return this.mapRowToEntry(row);
    });
  }

  private mapRowToEntry(row: Record<string, unknown>): MemoryEntry {
    const entry: MemoryEntry = {
      id: row.id as string,
      agentId: row.agent_id as string,
      sessionId: row.session_id as string,
      type: row.type as MemoryEntry['type'],
      content: row.content as string,
      context: JSON.parse(row.context as string),
      timestamp: new Date(row.timestamp as string),
      tags: JSON.parse(row.tags as string),
      version: row.version as number,
    };

    if (row.parent_id) {
      entry.parentId = row.parent_id as string;
    }

    if (row.metadata) {
      entry.metadata = JSON.parse(row.metadata as string);
    }

    return entry;
  }

  /**
   * Force immediate save to disk
   */
  async flush(): Promise<void> {
    await this.saveToDisk();
  }

  /**
   * Export database as binary
   */
  export(): Uint8Array {
    if (!this.db) {
      throw new MemoryBackendError('Database not initialized');
    }
    return this.db.export();
  }

  /**
   * Get database size in bytes
   */
  getSize(): number {
    if (!this.db) return 0;
    return this.db.export().length;
  }
}
```

---

### Step 3: Update sqlite-wrapper.js

**File**: `/home/user/claude-flow/src/memory/sqlite-wrapper.js`

Add sql.js detection and provider creation:

```javascript
// Add after existing imports
let SqlJs = null;
let sqlJsAvailable = false;
let sqlJsLoadError = null;

/**
 * Try to load sql.js
 */
async function tryLoadSqlJs() {
  try {
    const module = await import('sql.js');
    SqlJs = module.default;
    sqlJsAvailable = true;
    console.log('✅ sql.js loaded successfully (cross-platform SQLite mode)');
    return true;
  } catch (error) {
    sqlJsLoadError = error;
    console.warn('⚠️  sql.js not available:', error.message);
    return false;
  }
}

/**
 * Check if sql.js is available
 */
export async function isSqlJsAvailable() {
  if (sqlJsAvailable !== null) {
    return sqlJsAvailable;
  }

  await tryLoadSqlJs();
  return sqlJsAvailable;
}

/**
 * Get sql.js constructor
 */
export async function getSqlJs() {
  if (!sqlJsAvailable && sqlJsLoadError === null) {
    await tryLoadSqlJs();
  }

  return SqlJs;
}

/**
 * Create database with automatic provider selection
 */
export async function createDatabase(dbPath, options = {}) {
  const preferredProvider = options.provider || getRecommendedProvider();

  // Try preferred provider first
  if (preferredProvider === 'better-sqlite3' && await isSQLiteAvailable()) {
    return createBetterSqlite3Database(dbPath);
  }

  if (preferredProvider === 'sql.js' && await isSqlJsAvailable()) {
    return createSqlJsDatabase(dbPath);
  }

  // Fallback chain
  if (await isSQLiteAvailable()) {
    return createBetterSqlite3Database(dbPath);
  }

  if (await isSqlJsAvailable()) {
    return createSqlJsDatabase(dbPath);
  }

  throw new Error('No SQLite provider available (tried better-sqlite3 and sql.js)');
}

/**
 * Create sql.js database instance
 */
async function createSqlJsDatabase(dbPath) {
  const SQL = await getSqlJs();

  if (!SQL) {
    throw new Error('sql.js is not available');
  }

  // Initialize SQL.js
  const initSql = await SQL({
    locateFile: file => {
      const path = require('path');
      return path.join(process.cwd(), 'node_modules/sql.js/dist', file);
    }
  });

  // Load or create database
  const fs = require('fs');
  let db;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new initSql.Database(new Uint8Array(buffer));
  } else {
    db = new initSql.Database();
  }

  // Wrap to match better-sqlite3 API
  return wrapSqlJsDatabase(db, dbPath);
}

/**
 * Wrap sql.js database to match better-sqlite3 API
 */
function wrapSqlJsDatabase(db, dbPath) {
  let dirty = false;
  let saveTimer = null;

  const markDirty = () => {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToDisk, 5000);
  };

  const saveToDisk = () => {
    if (!dirty) return;

    const fs = require('fs');
    const data = db.export();
    fs.writeFileSync(dbPath, data);
    dirty = false;
  };

  return {
    // Mimic better-sqlite3 API
    prepare: (sql) => {
      const stmt = db.prepare(sql);

      return {
        run: (...params) => {
          stmt.bind(params);
          stmt.step();
          stmt.reset();
          markDirty();
          return { changes: 1 }; // Simplified
        },
        get: (...params) => {
          stmt.bind(params);
          const result = stmt.step() ? stmt.getAsObject() : null;
          stmt.reset();
          return result;
        },
        all: (...params) => {
          stmt.bind(params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.reset();
          return results;
        }
      };
    },

    exec: (sql) => {
      db.run(sql);
      markDirty();
    },

    pragma: (pragma) => {
      // sql.js doesn't support pragma in the same way
      // Silently ignore for compatibility
    },

    close: () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveToDisk();
      db.close();
    },

    // sql.js specific methods
    export: () => db.export(),
    _sqljs: true // Marker for detection
  };
}

/**
 * Get recommended provider based on platform
 */
function getRecommendedProvider() {
  if (process.platform === 'win32') {
    return 'sql.js'; // Windows: prefer sql.js (no compilation)
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'better-sqlite3'; // macOS ARM: try native first
  }

  return 'better-sqlite3'; // Linux/Unix: native is usually best
}

// Pre-load both providers on module import
(async () => {
  await tryLoadSQLite();
  await tryLoadSqlJs();
})();

export default {
  isSQLiteAvailable,
  isSqlJsAvailable,
  getSQLiteDatabase,
  getSqlJs,
  createDatabase,
  isWindows,
  getStorageRecommendations
};
```

---

### Step 4: Update DatabaseManager.ts

**File**: `/home/user/claude-flow/src/core/DatabaseManager.ts`

Add SqlJsProvider option:

```typescript
// Add import
import { SqlJsBackend } from '../memory/backends/sqljs.js';

export class DatabaseManager implements IDatabaseProvider {
  // ... existing code ...

  private async initializeSQLiteWithRecovery(): Promise<IDatabaseProvider> {
    try {
      // Try better-sqlite3 first
      return new SQLiteProvider(this.dbPath);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for native module issues
      if (error instanceof NativeModuleError || isNativeModuleVersionError(error)) {
        console.warn('\n' + (error instanceof NativeModuleError ? error.message : getNativeModuleRecoveryMessage(error)));
        console.warn('   Attempting fallback to sql.js (cross-platform SQLite)...\n');

        // Try sql.js before JSON
        try {
          return new SqlJsProvider(this.dbPath, this.logger);
        } catch (sqlJsError) {
          console.warn('   sql.js not available, falling back to JSON storage.\n');
        }
      }

      // Final fallback to JSON
      this.provider = new JSONProvider(this.dbPath.replace('.sqlite', '.json'));
      this.dbType = 'json';
      return this.provider;
    }
  }
}

/**
 * sql.js Provider implementation
 */
class SqlJsProvider implements IDatabaseProvider {
  private backend: SqlJsBackend;
  private dbPath: string;

  constructor(dbPath: string, logger: ILogger) {
    this.dbPath = dbPath;
    this.backend = new SqlJsBackend(
      {
        dbPath,
        autoSave: true,
        saveInterval: 30000
      },
      logger
    );
  }

  async initialize(): Promise<void> {
    await this.backend.initialize();
  }

  async store(key: string, value: any, namespace: string = 'default'): Promise<void> {
    // Adapt to MemoryEntry format
    const entry = {
      id: `${namespace}:${key}`,
      agentId: namespace,
      sessionId: 'default',
      type: 'data' as const,
      content: typeof value === 'string' ? value : JSON.stringify(value),
      context: { namespace },
      timestamp: new Date(),
      tags: [],
      version: 1
    };

    await this.backend.store(entry);
  }

  async retrieve(key: string, namespace: string = 'default'): Promise<any> {
    const entry = await this.backend.retrieve(`${namespace}:${key}`);
    if (!entry) return null;

    try {
      return JSON.parse(entry.content);
    } catch {
      return entry.content;
    }
  }

  async delete(key: string, namespace: string = 'default'): Promise<boolean> {
    try {
      await this.backend.delete(`${namespace}:${key}`);
      return true;
    } catch {
      return false;
    }
  }

  async list(namespace: string = 'default'): Promise<string[]> {
    const entries = await this.backend.query({ agentId: namespace });
    return entries.map(e => e.id.replace(`${namespace}:`, ''));
  }

  async close(): Promise<void> {
    await this.backend.shutdown();
  }
}
```

---

### Step 5: Update Build Configuration

**File**: `/.swcrc`

```json
{
  "jsc": {
    "parser": {
      "syntax": "typescript",
      "tsx": false,
      "decorators": true,
      "dynamicImport": true
    },
    "target": "es2020",
    "externalHelpers": false,
    "keepClassNames": true
  },
  "module": {
    "type": "es6",
    "strict": false,
    "strictMode": true,
    "lazy": false,
    "noInterop": false
  },
  "copyFiles": {
    "enable": true,
    "files": {
      "**/*.wasm": true
    }
  }
}
```

**File**: `/home/user/claude-flow/package.json` (files section)

```json
{
  "files": [
    "dist/",
    "src/",
    "node_modules/sql.js/dist/sql-wasm.wasm",
    "node_modules/sql.js/dist/sql-wasm.js"
  ]
}
```

---

### Step 6: Add Tests

**File**: `/home/user/claude-flow/tests/unit/memory/sqljs-backend.test.ts`

```typescript
import { SqlJsBackend } from '../../../src/memory/backends/sqljs';
import { MemoryEntry } from '../../../src/utils/types';
import { createMockLogger } from '../../helpers/logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('SqlJsBackend', () => {
  let backend: SqlJsBackend;
  let dbPath: string;
  let logger: any;

  beforeEach(async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqljs-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    logger = createMockLogger();

    backend = new SqlJsBackend(
      {
        dbPath,
        autoSave: false // Disable for tests
      },
      logger
    );

    await backend.initialize();
  });

  afterEach(async () => {
    await backend.shutdown();
    await fs.remove(path.dirname(dbPath));
  });

  describe('store and retrieve', () => {
    it('should store and retrieve an entry', async () => {
      const entry: MemoryEntry = {
        id: 'test-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        type: 'observation',
        content: 'Test content',
        context: { key: 'value' },
        timestamp: new Date(),
        tags: ['test', 'demo'],
        version: 1
      };

      await backend.store(entry);
      const retrieved = await backend.retrieve('test-1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('test-1');
      expect(retrieved?.content).toBe('Test content');
      expect(retrieved?.tags).toEqual(['test', 'demo']);
    });

    it('should return undefined for non-existent entry', async () => {
      const retrieved = await backend.retrieve('non-existent');
      expect(retrieved).toBeUndefined();
    });

    it('should update existing entry', async () => {
      const entry: MemoryEntry = {
        id: 'test-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        type: 'observation',
        content: 'Original content',
        context: {},
        timestamp: new Date(),
        tags: [],
        version: 1
      };

      await backend.store(entry);

      const updated = { ...entry, content: 'Updated content' };
      await backend.update('test-1', updated);

      const retrieved = await backend.retrieve('test-1');
      expect(retrieved?.content).toBe('Updated content');
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const entries: MemoryEntry[] = [
        {
          id: 'entry-1',
          agentId: 'agent-1',
          sessionId: 'session-1',
          type: 'observation',
          content: 'Content 1',
          context: {},
          timestamp: new Date('2026-01-01'),
          tags: ['tag1'],
          version: 1
        },
        {
          id: 'entry-2',
          agentId: 'agent-1',
          sessionId: 'session-1',
          type: 'action',
          content: 'Content 2',
          context: {},
          timestamp: new Date('2026-01-02'),
          tags: ['tag2'],
          version: 1
        },
        {
          id: 'entry-3',
          agentId: 'agent-2',
          sessionId: 'session-2',
          type: 'observation',
          content: 'Content 3',
          context: {},
          timestamp: new Date('2026-01-03'),
          tags: ['tag1'],
          version: 1
        }
      ];

      for (const entry of entries) {
        await backend.store(entry);
      }
    });

    it('should query by agentId', async () => {
      const results = await backend.query({ agentId: 'agent-1' });
      expect(results).toHaveLength(2);
      expect(results[0].agentId).toBe('agent-1');
    });

    it('should query by type', async () => {
      const results = await backend.query({ type: 'observation' });
      expect(results).toHaveLength(2);
      expect(results.every(r => r.type === 'observation')).toBe(true);
    });

    it('should support pagination', async () => {
      const results = await backend.query({ limit: 2, offset: 1 });
      expect(results).toHaveLength(2);
    });
  });

  describe('file persistence', () => {
    it('should save to disk and reload', async () => {
      const entry: MemoryEntry = {
        id: 'persist-test',
        agentId: 'agent-1',
        sessionId: 'session-1',
        type: 'observation',
        content: 'Persistent data',
        context: {},
        timestamp: new Date(),
        tags: [],
        version: 1
      };

      await backend.store(entry);
      await backend.flush(); // Force save
      await backend.shutdown();

      // Create new instance with same path
      const backend2 = new SqlJsBackend({ dbPath }, logger);
      await backend2.initialize();

      const retrieved = await backend2.retrieve('persist-test');
      expect(retrieved?.content).toBe('Persistent data');

      await backend2.shutdown();
    });
  });

  describe('health status', () => {
    it('should return healthy status', async () => {
      const health = await backend.getHealthStatus();
      expect(health.healthy).toBe(true);
      expect(health.metrics).toBeDefined();
      expect(health.metrics?.entryCount).toBeGreaterThanOrEqual(0);
    });
  });
});
```

---

## Testing Checklist

### Unit Tests
- [ ] SqlJsBackend store/retrieve
- [ ] SqlJsBackend query operations
- [ ] File persistence
- [ ] WASM loading
- [ ] Error handling

### Integration Tests
- [ ] Provider selection logic
- [ ] Fallback chain (better-sqlite3 → sql.js → JSON)
- [ ] Database migration between providers
- [ ] Concurrent access

### Platform Tests
- [ ] Windows 10/11 (npm install, runtime)
- [ ] macOS (Intel and ARM64)
- [ ] Linux (Ubuntu, Alpine)
- [ ] WSL (Windows Subsystem for Linux)

### Performance Tests
- [ ] Benchmark sql.js vs better-sqlite3
- [ ] Memory usage comparison
- [ ] Large dataset handling (100K+ records)
- [ ] Bulk insert performance

---

## Deployment Checklist

### Pre-release
- [ ] Update CHANGELOG.md with sql.js integration
- [ ] Update README.md with Windows installation instructions
- [ ] Create migration guide for existing users
- [ ] Add troubleshooting section

### Release
- [ ] Publish to npm with `@alpha` tag for testing
- [ ] Test in real Windows environment
- [ ] Monitor issue tracker for reports
- [ ] Collect performance feedback

### Post-release
- [ ] Update documentation based on feedback
- [ ] Optimize performance bottlenecks
- [ ] Consider sql.js as default on all platforms (if successful)

---

## Troubleshooting Guide

### WASM File Not Found

**Error**: `Cannot find sql-wasm.wasm`

**Solution**:
```javascript
// Update locateFile in SqlJsBackend
locateFile: (file) => {
  if (process.env.SQLJS_WASM_PATH) {
    return path.join(process.env.SQLJS_WASM_PATH, file);
  }
  return path.join(__dirname, '../../../node_modules/sql.js/dist', file);
}
```

### Performance Issues

**Symptom**: Slow queries (>100ms)

**Solutions**:
1. Enable prepared statements caching
2. Use batch transactions
3. Reduce auto-save frequency
4. Consider switching to better-sqlite3 if available

### Memory Leaks

**Symptom**: Increasing memory usage

**Solutions**:
1. Call `stmt.free()` after prepared statements
2. Limit result set sizes
3. Implement periodic `db.export()` and recreate
4. Monitor with `process.memoryUsage()`

---

## Next Steps

1. Implement SqlJsBackend (Step 2)
2. Update sqlite-wrapper.js (Step 3)
3. Run unit tests
4. Test on Windows
5. Collect feedback
6. Iterate and optimize

---

**Document Version**: 1.0
**Last Updated**: 2026-01-03
**Status**: Ready for implementation
