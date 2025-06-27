/**
 * Database Testing Utilities
 * Provides helpers for SQLite database testing with better-sqlite3
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { nanoid } from 'nanoid';

export interface TestDatabase {
  db: Database.Database;
  path: string;
  close: () => void;
  reset: () => void;
  seed: (data?: SeedData) => void;
}

export interface SeedData {
  agents?: Array<{ id: string; name: string; type: string; status: string }>;
  tasks?: Array<{ id: string; title: string; status: string; priority: number }>;
  memory?: Array<{ key: string; value: any; namespace?: string }>;
  config?: Array<{ key: string; value: any }>;
}

/**
 * Creates an in-memory SQLite database for testing
 */
export function createTestDatabase(name?: string): TestDatabase {
  const dbPath = ':memory:';
  const db = new Database(dbPath);
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  return {
    db,
    path: dbPath,
    close: () => db.close(),
    reset: () => {
      // Get all tables
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all() as { name: string }[];
      
      // Drop all tables
      db.transaction(() => {
        for (const table of tables) {
          db.prepare(`DROP TABLE IF EXISTS ${table.name}`).run();
        }
      })();
    },
    seed: (data) => seedDatabase(db, data),
  };
}

/**
 * Creates a file-based test database
 */
export function createFileTestDatabase(name?: string): TestDatabase {
  const testDir = join(tmpdir(), 'claude-flow-tests', nanoid());
  mkdirSync(testDir, { recursive: true });
  
  const dbPath = join(testDir, `${name || 'test'}.db`);
  const db = new Database(dbPath);
  
  // Enable foreign keys and WAL mode
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  
  return {
    db,
    path: dbPath,
    close: () => {
      db.close();
      // Clean up test directory
      if (existsSync(testDir)) {
        require('fs').rmSync(testDir, { recursive: true, force: true });
      }
    },
    reset: () => {
      const tables = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name NOT LIKE 'sqlite_%'
      `).all() as { name: string }[];
      
      db.transaction(() => {
        for (const table of tables) {
          db.prepare(`DROP TABLE IF EXISTS ${table.name}`).run();
        }
      })();
    },
    seed: (data) => seedDatabase(db, data),
  };
}

/**
 * Seeds a test database with sample data
 */
function seedDatabase(db: Database.Database, data?: SeedData): void {
  // Create basic schema
  db.transaction(() => {
    // Agents table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `).run();
    
    // Tasks table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        agent_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
      )
    `).run();
    
    // Memory table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        namespace TEXT DEFAULT 'default',
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `).run();
    
    // Config table
    db.prepare(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `).run();
  })();
  
  // Insert seed data if provided
  if (data) {
    db.transaction(() => {
      // Insert agents
      if (data.agents) {
        const insertAgent = db.prepare(`
          INSERT INTO agents (id, name, type, status) 
          VALUES (@id, @name, @type, @status)
        `);
        for (const agent of data.agents) {
          insertAgent.run(agent);
        }
      }
      
      // Insert tasks
      if (data.tasks) {
        const insertTask = db.prepare(`
          INSERT INTO tasks (id, title, status, priority) 
          VALUES (@id, @title, @status, @priority)
        `);
        for (const task of data.tasks) {
          insertTask.run(task);
        }
      }
      
      // Insert memory
      if (data.memory) {
        const insertMemory = db.prepare(`
          INSERT INTO memory (key, value, namespace) 
          VALUES (@key, @value, @namespace)
        `);
        for (const item of data.memory) {
          insertMemory.run({
            key: item.key,
            value: JSON.stringify(item.value),
            namespace: item.namespace || 'default',
          });
        }
      }
      
      // Insert config
      if (data.config) {
        const insertConfig = db.prepare(`
          INSERT INTO config (key, value) 
          VALUES (@key, @value)
        `);
        for (const item of data.config) {
          insertConfig.run({
            key: item.key,
            value: JSON.stringify(item.value),
          });
        }
      }
    })();
  }
}

/**
 * Database test helpers
 */
export const dbTestHelpers = {
  /**
   * Verifies that a table exists
   */
  tableExists(db: Database.Database, tableName: string): boolean {
    const result = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `).get(tableName);
    return !!result;
  },
  
  /**
   * Gets row count for a table
   */
  getRowCount(db: Database.Database, tableName: string): number {
    const result = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number };
    return result.count;
  },
  
  /**
   * Verifies that a column exists in a table
   */
  columnExists(db: Database.Database, tableName: string, columnName: string): boolean {
    const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return columns.some(col => col.name === columnName);
  },
  
  /**
   * Creates a mock database connection with jest mocks
   */
  createMockDatabase(): jest.Mocked<Database.Database> {
    return {
      prepare: jest.fn().mockReturnValue({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn(),
        iterate: jest.fn(),
        pluck: jest.fn(),
        expand: jest.fn(),
        raw: jest.fn(),
        columns: jest.fn(),
        bind: jest.fn(),
      }),
      exec: jest.fn(),
      pragma: jest.fn(),
      transaction: jest.fn((fn) => fn),
      close: jest.fn(),
      backup: jest.fn(),
      serialize: jest.fn(),
      loadExtension: jest.fn(),
      defaultSafeIntegers: jest.fn(),
      aggregate: jest.fn(),
      function: jest.fn(),
      table: jest.fn(),
      // Add other properties as needed
    } as any;
  },
};
