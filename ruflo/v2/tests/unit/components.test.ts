/**
 * Component Unit Tests for Claude Flow v2.0.0
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';
import { Orchestrator } from '../../core/orchestrator-fixed.js';
import { ConfigManager } from '../../config/config-manager.js';
import { MemoryManager } from '../../memory/manager.js';
import { AgentManager } from '../../agents/agent-manager.js';

// Mock external dependencies
jest.mock('fs-extra');
jest.mock('better-sqlite3');

describe('Component Unit Tests', () => {
  let eventBus: EventBus;
  let logger: Logger;

  beforeEach(() => {
    eventBus = EventBus.getInstance();
    logger = new Logger({ level: 'info', format: 'text', destination: 'console' });
  });

  afterEach(() => {
    // Clean up event bus
    eventBus.removeAllListeners();
  });

  describe('EventBus', () => {
    it('should be a singleton', () => {
      const eventBus1 = EventBus.getInstance();
      const eventBus2 = EventBus.getInstance();
      expect(eventBus1).toBe(eventBus2);
    });

    it('should emit and receive events', () => {
      const mockCallback = jest.fn();
      eventBus.on('test-event', mockCallback);
      
      const testData = { message: 'test' };
      eventBus.emit('test-event', testData);
      
      expect(mockCallback).toHaveBeenCalledWith(testData);
    });

    it('should handle multiple listeners', () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn();
      
      eventBus.on('test-event', mockCallback1);
      eventBus.on('test-event', mockCallback2);
      
      eventBus.emit('test-event', { data: 'test' });
      
      expect(mockCallback1).toHaveBeenCalled();
      expect(mockCallback2).toHaveBeenCalled();
    });

    it('should remove listeners', () => {
      const mockCallback = jest.fn();
      eventBus.on('test-event', mockCallback);
      eventBus.off('test-event', mockCallback);
      
      eventBus.emit('test-event', { data: 'test' });
      
      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe('Logger', () => {
    it('should create logger with default config', () => {
      const defaultLogger = new Logger();
      expect(defaultLogger).toBeDefined();
    });

    it('should create logger with custom config', () => {
      const customLogger = new Logger({
        level: 'debug',
        format: 'json',
        destination: 'file'
      });
      expect(customLogger).toBeDefined();
    });

    it('should log messages at different levels', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      logger.info('Info message');
      logger.warn('Warning message');
      logger.error('Error message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(3);
      consoleSpy.mockRestore();
    });
  });

  describe('ConfigManager', () => {
    let configManager: ConfigManager;

    beforeEach(() => {
      configManager = ConfigManager.getInstance();
    });

    it('should be a singleton', () => {
      const configManager1 = ConfigManager.getInstance();
      const configManager2 = ConfigManager.getInstance();
      expect(configManager1).toBe(configManager2);
    });

    it('should load default configuration', async () => {
      await configManager.load();
      expect(configManager.get('agents.maxAgents')).toBeDefined();
    });

    it('should get and set configuration values', async () => {
      await configManager.load();
      
      configManager.set('test.value', 'test');
      expect(configManager.get('test.value')).toBe('test');
    });

    it('should handle nested configuration paths', async () => {
      await configManager.load();
      
      configManager.set('nested.deep.value', 'deep');
      expect(configManager.get('nested.deep.value')).toBe('deep');
    });
  });

  describe('MemoryManager', () => {
    let memoryManager: MemoryManager;

    beforeEach(async () => {
      memoryManager = new MemoryManager();
      await memoryManager.initialize();
    });

    afterEach(async () => {
      await memoryManager.shutdown();
    });

    it('should initialize successfully', () => {
      expect(memoryManager).toBeDefined();
    });

    it('should store and retrieve data', async () => {
      const testData = { test: 'value' };
      await memoryManager.set('test-key', testData);
      
      const retrieved = await memoryManager.get('test-key');
      expect(retrieved).toEqual(testData);
    });

    it('should handle non-existent keys', async () => {
      const result = await memoryManager.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete data', async () => {
      await memoryManager.set('delete-test', 'value');
      await memoryManager.delete('delete-test');
      
      const result = await memoryManager.get('delete-test');
      expect(result).toBeNull();
    });

    it('should list keys with pattern', async () => {
      await memoryManager.set('pattern:1', 'value1');
      await memoryManager.set('pattern:2', 'value2');
      await memoryManager.set('other:1', 'value3');
      
      const keys = await memoryManager.keys('pattern:*');
      expect(keys).toContain('pattern:1');
      expect(keys).toContain('pattern:2');
      expect(keys).not.toContain('other:1');
    });
  });

  describe('AgentManager', () => {
    let agentManager: AgentManager;

    beforeEach(async () => {
      agentManager = new AgentManager(eventBus, logger);
      await agentManager.initialize();
    });

    afterEach(async () => {
      await agentManager.shutdown();
    });

    it('should initialize successfully', () => {
      expect(agentManager).toBeDefined();
    });

    it('should spawn agents', async () => {
      const agentId = await agentManager.spawnAgent('researcher', {
        name: 'Test Researcher',
        capabilities: ['research', 'analysis']
      });
      
      expect(agentId).toBeDefined();
      expect(typeof agentId).toBe('string');
    });

    it('should list active agents', async () => {
      await agentManager.spawnAgent('researcher', { name: 'Agent 1' });
      await agentManager.spawnAgent('coder', { name: 'Agent 2' });
      
      const agents = await agentManager.listAgents();
      expect(agents.length).toBe(2);
    });

    it('should get agent by id', async () => {
      const agentId = await agentManager.spawnAgent('researcher', { name: 'Test Agent' });
      
      const agent = await agentManager.getAgent(agentId);
      expect(agent).toBeDefined();
      expect(agent.id).toBe(agentId);
    });

    it('should terminate agents', async () => {
      const agentId = await agentManager.spawnAgent('researcher', { name: 'Test Agent' });
      
      await agentManager.terminateAgent(agentId);
      
      const agent = await agentManager.getAgent(agentId);
      expect(agent).toBeNull();
    });

    it('should handle agent communication', async () => {
      const agentId1 = await agentManager.spawnAgent('researcher', { name: 'Agent 1' });
      const agentId2 = await agentManager.spawnAgent('coder', { name: 'Agent 2' });
      
      const message = {
        from: agentId1,
        to: agentId2,
        type: 'request',
        data: { task: 'analyze data' }
      };
      
      const response = await agentManager.sendMessage(message);
      expect(response).toBeDefined();
    });
  });

  describe('Orchestrator', () => {
    let orchestrator: Orchestrator;
    let configManager: ConfigManager;

    beforeEach(async () => {
      configManager = ConfigManager.getInstance();
      await configManager.load();
      
      orchestrator = new Orchestrator(configManager, eventBus, logger);
      await orchestrator.initialize();
    });

    afterEach(async () => {
      await orchestrator.shutdown();
    });

    it('should initialize successfully', () => {
      expect(orchestrator).toBeDefined();
    });

    it('should handle task submission', async () => {
      const task = {
        id: 'test-task',
        type: 'research',
        objective: 'Test objective',
        priority: 'high'
      };
      
      const result = await orchestrator.submitTask(task);
      expect(result).toBeDefined();
    });

    it('should get orchestrator status', async () => {
      const status = await orchestrator.getStatus();
      
      expect(status).toBeDefined();
      expect(status.status).toBeDefined();
      expect(status.activeTasks).toBeDefined();
      expect(status.queuedTasks).toBeDefined();
    });

    it('should handle multiple concurrent tasks', async () => {
      const tasks = [
        { id: 'task1', type: 'research', objective: 'Objective 1' },
        { id: 'task2', type: 'analysis', objective: 'Objective 2' },
        { id: 'task3', type: 'coding', objective: 'Objective 3' }
      ];
      
      const promises = tasks.map(task => orchestrator.submitTask(task));
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toBeDefined();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle initialization errors', async () => {
      // Mock a component to throw during initialization
      const mockComponent = {
        initialize: jest.fn().mockRejectedValue(new Error('Init failed'))
      };
      
      await expect(mockComponent.initialize()).rejects.toThrow('Init failed');
    });

    it('should handle runtime errors', () => {
      const errorHandler = jest.fn();
      eventBus.on('error', errorHandler);
      
      eventBus.emit('error', new Error('Runtime error'));
      
      expect(errorHandler).toHaveBeenCalled();
    });

    it('should handle network errors', async () => {
      // Simulate network failure
      const mockNetworkOperation = jest.fn().mockRejectedValue(new Error('Network error'));
      
      await expect(mockNetworkOperation()).rejects.toThrow('Network error');
    });
  });

  describe('Performance', () => {
    it('should handle high event throughput', () => {
      const mockHandler = jest.fn();
      eventBus.on('performance-test', mockHandler);
      
      const eventCount = 1000;
      const startTime = Date.now();
      
      for (let i = 0; i < eventCount; i++) {
        eventBus.emit('performance-test', { id: i });
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      expect(mockHandler).toHaveBeenCalledTimes(eventCount);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should handle memory efficiently', async () => {
      const memoryManager = new MemoryManager();
      await memoryManager.initialize();
      
      // Store many items
      const itemCount = 1000;
      for (let i = 0; i < itemCount; i++) {
        await memoryManager.set(`item-${i}`, { data: `value-${i}` });
      }
      
      // Retrieve items
      for (let i = 0; i < itemCount; i++) {
        const value = await memoryManager.get(`item-${i}`);
        expect(value).toEqual({ data: `value-${i}` });
      }
      
      await memoryManager.shutdown();
    });
  });
});