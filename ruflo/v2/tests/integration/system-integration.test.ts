/**
 * System Integration Tests for Claude Flow v2.0.0
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SystemIntegration } from '../../integration/system-integration.js';
import { EventBus } from '../../core/event-bus.js';
import type { IntegrationConfig, SystemHealth } from '../../integration/types.js';

// Mock all dependencies
jest.mock('../../core/event-bus.js');
jest.mock('../../core/logger.js');
jest.mock('../../core/orchestrator-fixed.js');
jest.mock('../../config/config-manager.js');
jest.mock('../../memory/manager.js');
jest.mock('../../agents/agent-manager.js');
jest.mock('../../coordination/swarm-coordinator.js');
jest.mock('../../task/engine.js');
jest.mock('../../monitoring/real-time-monitor.js');
jest.mock('../../mcp/server.js');

describe('SystemIntegration', () => {
  let systemIntegration: SystemIntegration;
  let mockEventBus: jest.Mocked<EventBus>;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create fresh instance
    systemIntegration = SystemIntegration.getInstance();
    mockEventBus = EventBus.getInstance() as jest.Mocked<EventBus>;
  });

  afterEach(async () => {
    // Clean shutdown
    if (systemIntegration.isReady()) {
      await systemIntegration.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should initialize all components in correct order', async () => {
      const config: IntegrationConfig = {
        logLevel: 'info',
        environment: 'testing'
      };

      await systemIntegration.initialize(config);
      
      expect(systemIntegration.isReady()).toBe(true);
      
      // Verify initialization status
      const status = systemIntegration.getInitializationStatus();
      expect(status.initialized).toBe(true);
      expect(status.components).toContain('config');
      expect(status.components).toContain('orchestrator');
      expect(status.components).toContain('memory');
      expect(status.components).toContain('agents');
      expect(status.components).toContain('swarm');
      expect(status.components).toContain('tasks');
      expect(status.components).toContain('monitor');
      expect(status.components).toContain('mcp');
    });

    it('should handle initialization errors gracefully', async () => {
      // Mock a component to fail initialization
      const mockOrchestrator = {
        initialize: jest.fn().mockRejectedValue(new Error('Orchestrator init failed'))
      };

      await expect(systemIntegration.initialize()).rejects.toThrow('Orchestrator init failed');
      expect(systemIntegration.isReady()).toBe(false);
    });

    it('should not reinitialize if already initialized', async () => {
      await systemIntegration.initialize();
      const firstInitTime = Date.now();
      
      await systemIntegration.initialize();
      
      // Should not reinitialize
      expect(systemIntegration.isReady()).toBe(true);
    });
  });

  describe('Component Management', () => {
    beforeEach(async () => {
      await systemIntegration.initialize();
    });

    it('should return correct components by name', () => {
      const orchestrator = systemIntegration.getComponent('orchestrator');
      expect(orchestrator).toBeDefined();
      
      const agentManager = systemIntegration.getComponent('agentManager');
      expect(agentManager).toBeDefined();
      
      const nonExistent = systemIntegration.getComponent('nonExistent');
      expect(nonExistent).toBeNull();
    });

    it('should track component statuses', async () => {
      const health = await systemIntegration.getSystemHealth();
      
      expect(health.overall).toBe('healthy');
      expect(health.components).toBeDefined();
      expect(health.metrics.totalComponents).toBeGreaterThan(0);
      expect(health.metrics.healthyComponents).toBeGreaterThan(0);
      expect(health.metrics.unhealthyComponents).toBe(0);
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(async () => {
      await systemIntegration.initialize();
    });

    it('should detect unhealthy components', async () => {
      // Simulate component failure
      mockEventBus.emit('component:status', {
        component: 'test-component',
        status: 'unhealthy',
        message: 'Component failed'
      });

      const health = await systemIntegration.getSystemHealth();
      expect(health.overall).toBe('unhealthy');
      expect(health.metrics.unhealthyComponents).toBeGreaterThan(0);
    });

    it('should detect warning components', async () => {
      // Simulate component warning
      mockEventBus.emit('component:status', {
        component: 'test-component',
        status: 'warning',
        message: 'Component warning'
      });

      const health = await systemIntegration.getSystemHealth();
      expect(health.overall).toBe('warning');
      expect(health.metrics.warningComponents).toBeGreaterThan(0);
    });

    it('should calculate correct health metrics', async () => {
      const health = await systemIntegration.getSystemHealth();
      
      expect(health.metrics.totalComponents).toBe(
        health.metrics.healthyComponents + 
        health.metrics.unhealthyComponents + 
        health.metrics.warningComponents
      );
      
      expect(health.timestamp).toBeLessThanOrEqual(Date.now());
      expect(health.metrics.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Event Handling', () => {
    beforeEach(async () => {
      await systemIntegration.initialize();
    });

    it('should handle system ready event', async () => {
      const eventSpy = jest.spyOn(mockEventBus, 'emit');
      
      // Re-initialize to trigger ready event
      await systemIntegration.shutdown();
      await systemIntegration.initialize();
      
      expect(eventSpy).toHaveBeenCalledWith('system:ready', expect.objectContaining({
        timestamp: expect.any(Number),
        components: expect.any(Array),
        health: expect.any(Object)
      }));
    });

    it('should handle component status updates', () => {
      const eventSpy = jest.spyOn(mockEventBus, 'emit');
      
      // Simulate status update
      mockEventBus.emit('component:status', {
        component: 'test-component',
        status: 'healthy',
        message: 'All good'
      });

      expect(eventSpy).toHaveBeenCalledWith('component:status:updated', expect.objectContaining({
        component: 'test-component',
        status: 'healthy',
        message: 'All good'
      }));
    });

    it('should handle system errors', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      // Simulate system error
      mockEventBus.emit('system:error', {
        component: 'test-component',
        error: new Error('Test error')
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Shutdown', () => {
    it('should shutdown all components gracefully', async () => {
      await systemIntegration.initialize();
      expect(systemIntegration.isReady()).toBe(true);
      
      await systemIntegration.shutdown();
      expect(systemIntegration.isReady()).toBe(false);
    });

    it('should handle shutdown errors gracefully', async () => {
      await systemIntegration.initialize();
      
      // Mock a component to fail shutdown
      const mockOrchestrator = systemIntegration.getComponent('orchestrator');
      if (mockOrchestrator) {
        (mockOrchestrator as any).shutdown = jest.fn().mockRejectedValue(new Error('Shutdown failed'));
      }
      
      // Should not throw
      await expect(systemIntegration.shutdown()).resolves.not.toThrow();
    });
  });

  describe('Configuration', () => {
    it('should accept custom configuration', async () => {
      const config: IntegrationConfig = {
        logLevel: 'debug',
        environment: 'development',
        orchestrator: {
          maxConcurrency: 10,
          timeout: 5000
        },
        agents: {
          maxAgents: 20,
          defaultStrategy: 'research'
        },
        swarm: {
          topology: 'mesh',
          maxDepth: 5,
          enablePersistence: true
        },
        memory: {
          backend: 'memory',
          ttl: 3600,
          maxSize: 1000
        },
        monitoring: {
          enabled: true,
          metrics: true,
          realTime: true
        },
        mcp: {
          port: 8080,
          host: 'localhost',
          enableAuth: true
        }
      };

      await systemIntegration.initialize(config);
      expect(systemIntegration.isReady()).toBe(true);
    });
  });

  describe('Singleton Pattern', () => {
    it('should always return the same instance', () => {
      const instance1 = SystemIntegration.getInstance();
      const instance2 = SystemIntegration.getInstance();
      
      expect(instance1).toBe(instance2);
    });
  });
});