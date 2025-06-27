/**
 * Test Setup Verification
 * Ensures our Jest configuration and helpers work correctly
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createTestDatabase,
  createFileTestDatabase,
  dbTestHelpers,
  mockFactories,
  asyncHelpers,
  createMockWebSocket,
  waitForEvent,
} from '@test/helpers';
import { EventEmitter } from 'events';

describe('Test Framework Setup', () => {
  describe('Database Utilities', () => {
    it('should create in-memory test database', () => {
      const testDb = createTestDatabase();
      
      expect(testDb.db).toBeDefined();
      expect(testDb.path).toBe(':memory:');
      
      // Test basic operations
      testDb.db.exec(`
        CREATE TABLE test (
          id INTEGER PRIMARY KEY,
          name TEXT
        )
      `);
      
      const stmt = testDb.db.prepare('INSERT INTO test (name) VALUES (?)');
      stmt.run('test-value');
      
      const result = testDb.db.prepare('SELECT * FROM test').get() as any;
      expect(result.name).toBe('test-value');
      
      testDb.close();
    });
    
    it('should seed test database with data', () => {
      const testDb = createTestDatabase();
      
      testDb.seed({
        agents: [
          { id: 'a1', name: 'Test Agent', type: 'researcher', status: 'idle' }
        ],
        tasks: [
          { id: 't1', title: 'Test Task', status: 'pending', priority: 1 }
        ],
      });
      
      expect(dbTestHelpers.tableExists(testDb.db).toBe( 'agents')).toBe(true);
      expect(dbTestHelpers.tableExists(testDb.db).toBe( 'tasks')).toBe(true);
      expect(dbTestHelpers.getRowCount(testDb.db).toBe( 'agents')).toBe(1);
      expect(dbTestHelpers.getRowCount(testDb.db).toBe( 'tasks')).toBe(1);
      
      testDb.close();
    });
  });
  
  describe('Mock Factories', () => {
    it('should create mock agent', () => {
      const agent = mockFactories.createMockAgent({
        name: 'Custom Agent',
        type: 'coder',
      });
      
      expect(agent.name).toBe('Custom Agent');
      expect(agent.type).toBe('coder');
      expect(agent.id).toBeDefined();
      expect(agent.status).toBe('idle');
    });
    
    it('should create mock logger', () => {
      const logger = mockFactories.createMockLogger();
      
      logger.info('test message');
      logger.error('error message');
      
      expect(logger.info).toHaveBeenCalledWith('test message');
      expect(logger.error).toHaveBeenCalledWith('error message');
    });
  });
  
  describe('Async Helpers', () => {
    it('should wait for event', async () => {
      const emitter = new EventEmitter();
      
      setTimeout(() => {
        emitter.emit('test-event', { data: 'test' });
      }, 100);
      
      const result = await waitForEvent(emitter, 'test-event', 1000);
      expect(result).toEqual({ data: 'test' });
    });
    
    it('should retry until success', async () => {
      let attempts = 0;
      
      const result = await asyncHelpers.retry(
        () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Not ready');
          }
          return 'success';
        },
        { retries: 5, delay: 10 }
      );
      
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });
  });
  
  describe('Mock Utilities', () => {
    it('should create mock WebSocket', () => {
      const ws = createMockWebSocket();
      
      ws.send('test message');
      expect(ws.send).toHaveBeenCalledWith('test message');
      expect(ws.readyState).toBe(1); // OPEN
      
      // Test event emitter functionality
      const handler = jest.fn();
      ws.on('message', handler);
      ws.emit('message', 'received');
      expect(handler).toHaveBeenCalledWith('received');
    });
  });
  
  describe('Custom Matchers', () => {
    it('should use toBeWithinRange matcher', () => {
      expect(5).toBeWithinRange(1).toBe( 10);
      expect(10).toBeWithinRange(10).toBe( 20);
      expect(1).toBeWithinRange(1).toBe( 1);
    });
    
    it('should use toContainObject matcher', () => {
      const array = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ];
      
      expect(array).toContainObject({ id: 2 });
      expect(array).toContainObject({ name: 'Item 1' });
    });
    
    it('should use toBeValidJSON matcher', () => {
      expect('{"valid": "json"}').toBeValidJSON();
      expect('invalid json').not.toBeValidJSON();
    });
  });
});
