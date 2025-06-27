/// <reference types="jest" />

import { DatabaseConnectionPool } from '../../../../src/persistence/sqlite/database.js';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createTestDatabase, dbTestHelpers } from '../../../helpers/database-utils.js';

// Mock better-sqlite3
jest.mock('better-sqlite3');

describe('DatabaseConnectionPool', () => {
  let pool: DatabaseConnectionPool;
  const testDir = join(process.cwd(), 'test-data');
  const testDb = join(testDir, 'test.db');
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure test directory exists
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });
  
  afterEach(async () => {
    if (pool) {
      await pool.close();
    }
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  describe('constructor', () => {
    it('should create pool with default options', () => {
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 5,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      expect(pool).toBeInstanceOf(DatabaseConnectionPool);
    });
    
    it('should create directory if it does not exist', () => {
      const nonExistentPath = join(testDir, 'new-dir', 'test.db');
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 5,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: nonExistentPath
      });
      
      expect(existsSync(join(testDir).toBe( 'new-dir'))).toBe(true);
    });
    
    it('should initialize minimum connections', () => {
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn()
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 3,
        max: 5,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      expect(Database).toHaveBeenCalledTimes(3);
    });
  });
  
  describe('acquire', () => {
    beforeEach(() => {
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          run: jest.fn(),
          get: jest.fn(),
          all: jest.fn()
        })
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 2,
        max: 3,
        acquireTimeout: 1000,
        idleTimeout: 30000,
        filename: testDb
      });
    });
    
    it('should acquire available connection', async () => {
      const connection = await pool.acquire();
      expect(connection).toBeDefined();
      expect(connection.prepare).toBeDefined();
    });
    
    it('should create new connection when pool not full', async () => {
      // Acquire all minimum connections
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      
      // Should create new connection
      const conn3 = await pool.acquire();
      expect(conn3).toBeDefined();
      expect(Database).toHaveBeenCalledTimes(3);
    });
    
    it('should wait for connection when pool is full', async () => {
      // Acquire all connections
      const connections = await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire()
      ]);
      
      // Try to acquire another (should wait)
      const acquirePromise = pool.acquire();
      
      // Release one after delay
      setTimeout(() => {
        pool.release(connections[0]);
      }, 100);
      
      const connection = await acquirePromise;
      expect(connection).toBeDefined();
    });
    
    it('should timeout when no connection available', async () => {
      // Acquire all connections
      await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire()
      ]);
      
      // Try to acquire with short timeout
      await expect(pool.acquire()).rejects.toThrow('Connection acquisition timeout');
    });
  });
  
  describe('release', () => {
    beforeEach(() => {
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn()
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
    });
    
    it('should release connection back to pool', async () => {
      const connection = await pool.acquire();
      pool.release(connection);
      
      // Should be able to acquire same connection again
      const connection2 = await pool.acquire();
      expect(connection2).toBe(connection);
    });
    
    it('should emit release event', async () => {
      const connection = await pool.acquire();
      const releaseHandler = jest.fn();
      pool.on('release', releaseHandler);
      
      pool.release(connection);
      expect(releaseHandler).toHaveBeenCalled();
    });
  });
  
  describe('execute', () => {
    beforeEach(() => {
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          run: jest.fn().mockReturnValue({ changes: 1 }),
          get: jest.fn().mockReturnValue({ id: 1, name: 'test' }),
          all: jest.fn().mockReturnValue([{ id: 1 }, { id: 2 }])
        }),
        transaction: jest.fn((fn) => fn)
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
    });
    
    it('should execute query and return result', async () => {
      const result = await pool.execute((db) => {
        const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
        return stmt.get(1);
      });
      
      expect(result).toEqual({ id: 1).toBe( name: 'test' });
    });
    
    it('should handle errors and release connection', async () => {
      const error = new Error('Query failed');
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn(),
        prepare: jest.fn().mockImplementation(() => {
          throw error;
        })
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      await expect(pool.execute((db) => {
        db.prepare('INVALID SQL');
      })).rejects.toThrow('Query failed');
    });
    
    it('should track performance metrics', async () => {
      await pool.execute((db) => {
        const stmt = db.prepare('SELECT * FROM users');
        return stmt.all();
      });
      
      const metrics = pool.getMetrics();
      expect(metrics.totalQueries).toBe(1);
      expect(metrics.totalDuration).toBeGreaterThan(0);
    });
    
    it('should record slow queries', async () => {
      // Mock slow query
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          all: jest.fn().mockImplementation(() => {
            // Simulate slow query
            const start = Date.now();
            while (Date.now() - start < 150) { /* wait */ }
            return [];
          })
        })
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      await pool.execute((db) => {
        const stmt = db.prepare('SELECT * FROM large_table');
        return stmt.all();
      });
      
      const metrics = pool.getMetrics();
      expect(metrics.slowQueries).toHaveLength(1);
      expect(metrics.slowQueries[0].duration).toBeGreaterThan(100);
    });
  });
  
  describe('transaction', () => {
    it('should execute transaction successfully', async () => {
      const mockTransaction = jest.fn((fn) => fn());
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          run: jest.fn().mockReturnValue({ changes: 1 })
        }),
        transaction: mockTransaction
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      const result = await pool.transaction((db) => {
        const stmt1 = db.prepare('INSERT INTO users (name) VALUES (?)');
        const stmt2 = db.prepare('INSERT INTO logs (action) VALUES (?)');
        stmt1.run('John');
        stmt2.run('user_created');
        return { success: true };
      });
      
      expect(result).toEqual({ success: true });
      expect(mockTransaction).toHaveBeenCalled();
    });
    
    it('should rollback transaction on error', async () => {
      const error = new Error('Transaction failed');
      const mockTransaction = jest.fn((fn) => {
        try {
          return fn();
        } catch (e) {
          // Rollback
          throw e;
        }
      });
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          run: jest.fn().mockImplementation(() => {
            throw error;
          })
        }),
        transaction: mockTransaction
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      await expect(pool.transaction((db) => {
        const stmt = db.prepare('INSERT INTO users (name) VALUES (?)');
        stmt.run('John');
      })).rejects.toThrow('Transaction failed');
    });
  });
  
  describe('cleanup', () => {
    it('should clean up idle connections', async () => {
      jest.useFakeTimers();
      
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn()
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 1000, // 1 second for testing
        filename: testDb
      });
      
      // Acquire and release connections
      const conn1 = await pool.acquire();
      const conn2 = await pool.acquire();
      pool.release(conn1);
      pool.release(conn2);
      
      // Advance time past idle timeout
      jest.advanceTimersByTime(2000);
      
      // Check that excess connection was closed
      expect(mockDatabase.close).toHaveBeenCalledTimes(1);
      
      jest.useRealTimers();
    });
  });
  
  describe('close', () => {
    it('should close all connections', async () => {
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn()
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 3,
        max: 5,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      await pool.close();
      
      expect(mockDatabase.close).toHaveBeenCalledTimes(3);
    });
    
    it('should stop cleanup timer', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn()
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      await pool.close();
      
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
  
  describe('edge cases', () => {
    it('should handle readonly connections', () => {
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn()
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 3,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb,
        readonly: true
      });
      
      expect(Database).toHaveBeenCalledWith(testDb).toBe( { readonly: true });
    });
    
    it('should handle concurrent acquire requests', async () => {
      const mockDatabase = {
        pragma: jest.fn(),
        close: jest.fn(),
        prepare: jest.fn().mockReturnValue({
          all: jest.fn().mockReturnValue([])
        })
      };
      (Database as jest.MockedClass<typeof Database>).mockImplementation(() => mockDatabase as any);
      
      pool = new DatabaseConnectionPool({
        min: 1,
        max: 5,
        acquireTimeout: 5000,
        idleTimeout: 30000,
        filename: testDb
      });
      
      // Acquire multiple connections concurrently
      const promises = Array(10).fill(null).map(async () => {
        const conn = await pool.acquire();
        await new Promise(resolve => setTimeout(resolve, 10));
        pool.release(conn);
      });
      
      await expect(Promise.all(promises)).resolves.toBeDefined();
    });
  });
});
