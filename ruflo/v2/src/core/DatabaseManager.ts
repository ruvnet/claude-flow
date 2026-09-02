/**
 * DatabaseManager - Manages SQLite and JSON fallback storage
 * Provides a unified interface for persistent data storage with automatic fallback
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { IDatabaseProvider } from '../types/interfaces.js';
import { isNativeModuleVersionError, getNativeModuleRecoveryMessage } from '../utils/error-recovery.js';

/**
 * Custom error class for native module issues
 */
export class NativeModuleError extends Error {
  public readonly originalError: Error;
  public readonly isNativeModuleError = true;

  constructor(message: string, originalError: Error) {
    super(message);
    this.name = 'NativeModuleError';
    this.originalError = originalError;
  }
}

export class DatabaseManager implements IDatabaseProvider {
  private provider: IDatabaseProvider;
  private dbType: 'sqlite' | 'json';
  private dbPath: string;
  private initialized: boolean = false;
  private retryCount: number = 0;
  private maxRetries: number = 3;

  constructor(dbType: 'sqlite' | 'json' = 'sqlite', dbPath?: string) {
    this.dbType = dbType;
    this.dbPath = dbPath || this.getDefaultPath();

    // Try SQLite first, fallback to JSON if needed
    if (this.dbType === 'sqlite') {
      this.provider = this.initializeSQLiteWithRecovery();
    } else {
      this.provider = new JSONProvider(this.dbPath);
    }
  }

  /**
   * Initialize SQLite with automatic error recovery
   */
  private initializeSQLiteWithRecovery(): IDatabaseProvider {
    try {
      return new SQLiteProvider(this.dbPath);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Check for native module version mismatch (NODE_MODULE_VERSION error)
      if (error instanceof NativeModuleError || isNativeModuleVersionError(error)) {
        console.warn('\n' + (error instanceof NativeModuleError ? error.message : getNativeModuleRecoveryMessage(error)));
        console.warn('   Falling back to JSON storage (no data loss, just slower).\n');
      }
      // Check if it's an npm cache error
      else if (errorMsg.includes('ENOTEMPTY') || errorMsg.includes('better-sqlite3')) {
        console.warn('⚠️  SQLite initialization failed due to npm cache error');
        console.warn('   Will attempt automatic recovery during initialize()');
      } else {
        console.warn('SQLite not available, falling back to JSON storage:', errorMsg);
      }

      // Fallback to JSON for now
      this.provider = new JSONProvider(this.dbPath.replace('.sqlite', '.json'));
      this.dbType = 'json';
      return this.provider;
    }
  }

  private getDefaultPath(): string {
    const baseDir = path.join(process.cwd(), '.claude-flow');
    return this.dbType === 'sqlite'
      ? path.join(baseDir, 'database.sqlite')
      : path.join(baseDir, 'database.json');
  }

  async initialize(): Promise<void> {
    await fs.ensureDir(path.dirname(this.dbPath));

    try {
      await this.provider.initialize();
      this.initialized = true;
    } catch (error) {
      // If JSON provider failed, just propagate the error
      if (this.dbType === 'json') {
        throw error;
      }

      // For SQLite errors, attempt recovery
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (this.retryCount < this.maxRetries) {
        console.warn(`⚠️  Database initialization failed (attempt ${this.retryCount + 1}/${this.maxRetries})`);
        console.warn(`   Error: ${errorMsg}`);

        // Attempt to recover by switching to JSON
        console.log('🔄 Switching to JSON storage as fallback...');
        this.provider = new JSONProvider(this.dbPath.replace('.sqlite', '.json'));
        this.dbType = 'json';
        this.retryCount++;

        // Retry initialization with JSON provider
        await this.initialize();
      } else {
        throw error;
      }
    }
  }

  async store(key: string, value: any, namespace: string = 'default'): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.provider.store(key, value, namespace);
  }

  async retrieve(key: string, namespace: string = 'default'): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.provider.retrieve(key, namespace);
  }

  async delete(key: string, namespace: string = 'default'): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.provider.delete(key, namespace);
  }

  async list(namespace: string = 'default'): Promise<string[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return this.provider.list(namespace);
  }

  async close(): Promise<void> {
    if (this.provider) {
      await this.provider.close();
    }
    this.initialized = false;
  }

  getDatabaseType(): 'sqlite' | 'json' {
    return this.dbType;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // Specialized methods for common operations
  async storeJSON(key: string, data: object, namespace?: string): Promise<void> {
    await this.store(key, JSON.stringify(data), namespace);
  }

  async retrieveJSON(key: string, namespace?: string): Promise<object | null> {
    const data = await this.retrieve(key, namespace);
    if (!data) return null;
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return null;
    }
  }

  async exists(key: string, namespace?: string): Promise<boolean> {
    const data = await this.retrieve(key, namespace);
    return data !== null && data !== undefined;
  }

  async clear(namespace?: string): Promise<void> {
    const keys = await this.list(namespace);
    await Promise.all(keys.map(key => this.delete(key, namespace)));
  }
}

/**
 * SQLite implementation
 */
class SQLiteProvider implements IDatabaseProvider {
  private db: any;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    // Dynamic import to handle optional dependency
    try {
      const Database = require('better-sqlite3');
      this.db = new Database(dbPath);
    } catch (error) {
      // Check for native module version mismatch (NODE_MODULE_VERSION error)
      if (isNativeModuleVersionError(error)) {
        const recoveryMsg = getNativeModuleRecoveryMessage(error);
        throw new NativeModuleError(recoveryMsg, error as Error);
      }
      throw new Error('better-sqlite3 not available. Install with: npm install better-sqlite3');
    }
  }

  async initialize(): Promise<void> {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (namespace, key)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_storage_namespace ON storage(namespace);
      CREATE INDEX IF NOT EXISTS idx_storage_created_at ON storage(created_at);
    `);
  }

  async store(key: string, value: any, namespace: string = 'default'): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO storage (namespace, key, value, updated_at)
      VALUES (?, ?, ?, strftime('%s', 'now'))
    `);

    const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
    stmt.run(namespace, key, serializedValue);
  }

  async retrieve(key: string, namespace: string = 'default'): Promise<any> {
    const stmt = this.db.prepare('SELECT value FROM storage WHERE namespace = ? AND key = ?');
    const row = stmt.get(namespace, key);

    if (!row) return null;

    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  async delete(key: string, namespace: string = 'default'): Promise<boolean> {
    const stmt = this.db.prepare('DELETE FROM storage WHERE namespace = ? AND key = ?');
    const result = stmt.run(namespace, key);
    return result.changes > 0;
  }

  async list(namespace: string = 'default'): Promise<string[]> {
    const stmt = this.db.prepare('SELECT key FROM storage WHERE namespace = ? ORDER BY key');
    const rows = stmt.all(namespace);
    return rows.map((row: any) => row.key);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}

/**
 * JSON file-based implementation
 */
class JSONProvider implements IDatabaseProvider {
  private data: Record<string, Record<string, any>> = {};
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    try {
      if (await fs.pathExists(this.dbPath)) {
        const content = await fs.readJSON(this.dbPath);
        this.data = content || {};
      }
    } catch (error) {
      console.warn('Failed to load JSON database, starting fresh:', error);
      this.data = {};
    }
  }

  async store(key: string, value: any, namespace: string = 'default'): Promise<void> {
    if (!this.data[namespace]) {
      this.data[namespace] = {};
    }

    this.data[namespace][key] = value;
    await this.persist();
  }

  async retrieve(key: string, namespace: string = 'default'): Promise<any> {
    if (!this.data[namespace]) {
      return null;
    }
    return this.data[namespace][key] || null;
  }

  async delete(key: string, namespace: string = 'default'): Promise<boolean> {
    if (!this.data[namespace] || !(key in this.data[namespace])) {
      return false;
    }

    delete this.data[namespace][key];
    await this.persist();
    return true;
  }

  async list(namespace: string = 'default'): Promise<string[]> {
    if (!this.data[namespace]) {
      return [];
    }
    return Object.keys(this.data[namespace]).sort();
  }

  async close(): Promise<void> {
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.dbPath));
      await fs.writeJSON(this.dbPath, this.data, { spaces: 2 });
    } catch (error) {
      console.error('Failed to persist JSON database:', error);
    }
  }
}