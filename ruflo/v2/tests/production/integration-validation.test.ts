/**
 * Production Integration Validation Tests
 * 
 * These tests validate real system integrations and production readiness.
 * NO MOCKS OR STUBS - only real component testing.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { SystemIntegration } from '../../src/integration/system-integration.js';
import { AgentManager } from '../../src/agents/agent-manager.js';
import { MemoryManager } from '../../src/memory/manager.js';
import { SwarmCoordinator } from '../../src/coordination/swarm-coordinator.js';
import { ConfigManager } from '../../src/config/config-manager.js';
import type { IntegrationConfig } from '../../src/integration/types.js';

describe('Production Integration Validation', () => {
  let systemIntegration: SystemIntegration;
  let agentManager: AgentManager;
  let memoryManager: MemoryManager;
  let swarmCoordinator: SwarmCoordinator;
  let configManager: ConfigManager;

  beforeAll(async () => {
    // Initialize with production-like configuration
    configManager = new ConfigManager();
    await configManager.initialize({
      environment: 'production-test',
      logLevel: 'info',
      enableMetrics: true
    });
  });

  afterAll(async () => {
    // Clean shutdown
    if (systemIntegration?.isReady()) {
      await systemIntegration.shutdown();
    }
  });

  beforeEach(async () => {
    // Fresh instance for each test
    systemIntegration = SystemIntegration.getInstance();
  });

  afterEach(async () => {
    // Clean up after each test
    if (systemIntegration?.isReady()) {
      await systemIntegration.shutdown();
    }
  });

  describe('System Initialization Validation', () => {
    test('should initialize all components without mocks', async () => {
      const config: IntegrationConfig = {
        logLevel: 'info',
        environment: 'production-test',
        orchestrator: {
          maxConcurrency: 5,
          timeout: 10000
        },
        agents: {
          maxAgents: 10,
          defaultStrategy: 'balanced'
        }
      };

      await systemIntegration.initialize(config);
      
      expect(systemIntegration.isReady()).toBe(true);
      
      // Verify all components are real implementations
      const orchestrator = systemIntegration.getComponent('orchestrator');
      expect(orchestrator).toBeDefined();
      expect(orchestrator.constructor.name).not.toContain('Mock');
      
      const agentMgr = systemIntegration.getComponent('agentManager');
      expect(agentMgr).toBeDefined();
      expect(agentMgr.constructor.name).not.toContain('Mock');
      
      const swarmCoord = systemIntegration.getComponent('swarmCoordinator');
      expect(swarmCoord).toBeDefined();
      expect(swarmCoord.constructor.name).not.toContain('Mock');
    });

    test('should handle component initialization failures gracefully', async () => {
      // Test with invalid configuration to trigger failure
      const invalidConfig: IntegrationConfig = {
        logLevel: 'info',
        environment: 'production-test',
        orchestrator: {
          maxConcurrency: -1, // Invalid value
          timeout: -1000      // Invalid value
        }
      };

      try {
        await systemIntegration.initialize(invalidConfig);
        // If it doesn't throw, that's unexpected but we should check readiness
        expect(systemIntegration.isReady()).toBe(false);
      } catch (error) {
        // Expected - invalid config should cause initialization to fail
        expect(error).toBeDefined();
        expect(systemIntegration.isReady()).toBe(false);
      }
    });
  });

  describe('Real Component Interaction Validation', () => {
    beforeEach(async () => {
      await systemIntegration.initialize({
        logLevel: 'info',
        environment: 'production-test'
      });
    });

    test('should create and manage real agents', async () => {
      const agentMgr = systemIntegration.getComponent('agentManager') as AgentManager;
      expect(agentMgr).toBeDefined();

      // Create a real agent
      const agentId = await agentMgr.createAgent({
        type: 'researcher',
        name: 'test-researcher',
        capabilities: ['research', 'analysis']
      });

      expect(agentId).toBeDefined();
      expect(typeof agentId).toBe('string');
      expect(agentId).not.toContain('mock');

      // Verify agent was actually created
      const agent = await agentMgr.getAgent(agentId);
      expect(agent).toBeDefined();
      expect(agent.type).toBe('researcher');
      expect(agent.capabilities).toContain('research');

      // Clean up
      await agentMgr.removeAgent(agentId);
    });

    test('should persist and retrieve real memory data', async () => {
      const memoryMgr = systemIntegration.getComponent('memoryManager') as MemoryManager;
      expect(memoryMgr).toBeDefined();

      const testKey = `test-production-${Date.now()}`;
      const testData = {
        message: 'Production validation test',
        timestamp: Date.now(),
        data: { complex: true, nested: { value: 42 } }
      };

      // Store data
      await memoryMgr.store(testKey, testData, 'validation-test');

      // Retrieve data
      const retrieved = await memoryMgr.retrieve(testKey, 'validation-test');
      expect(retrieved).toEqual(testData);

      // Clean up
      await memoryMgr.delete(testKey, 'validation-test');
    });

    test('should coordinate real swarm operations', async () => {
      const swarmCoord = systemIntegration.getComponent('swarmCoordinator') as SwarmCoordinator;
      expect(swarmCoord).toBeDefined();

      // Initialize a real swarm
      const swarmId = await swarmCoord.initializeSwarm({
        topology: 'mesh',
        maxAgents: 3,
        strategy: 'balanced'
      });

      expect(swarmId).toBeDefined();
      expect(typeof swarmId).toBe('string');
      expect(swarmId).not.toContain('mock');

      // Verify swarm was created
      const swarmStatus = await swarmCoord.getSwarmStatus(swarmId);
      expect(swarmStatus).toBeDefined();
      expect(swarmStatus.topology).toBe('mesh');
      expect(swarmStatus.maxAgents).toBe(3);

      // Clean up
      await swarmCoord.destroySwarm(swarmId);
    });
  });

  describe('Error Handling and Recovery Validation', () => {
    beforeEach(async () => {
      await systemIntegration.initialize({
        logLevel: 'info',
        environment: 'production-test'
      });
    });

    test('should handle component failures and recover', async () => {
      const agentMgr = systemIntegration.getComponent('agentManager') as AgentManager;
      
      // Try to create agent with invalid configuration
      try {
        await agentMgr.createAgent({
          type: 'invalid-type' as any,
          name: '',
          capabilities: []
        });
        
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        // Expected failure
        expect(error).toBeDefined();
        expect(error.message).toContain('invalid');
      }

      // System should still be operational
      expect(systemIntegration.isReady()).toBe(true);
      
      // Should be able to create valid agent after failure
      const validAgentId = await agentMgr.createAgent({
        type: 'researcher',
        name: 'recovery-test',
        capabilities: ['research']
      });
      
      expect(validAgentId).toBeDefined();
      await agentMgr.removeAgent(validAgentId);
    });

    test('should handle memory storage failures gracefully', async () => {
      const memoryMgr = systemIntegration.getComponent('memoryManager') as MemoryManager;
      
      // Try to store invalid data
      try {
        const circularRef: any = {};
        circularRef.self = circularRef;
        
        await memoryMgr.store('circular-test', circularRef, 'validation-test');
        
        // If it doesn't throw, verify it was handled gracefully
        const retrieved = await memoryMgr.retrieve('circular-test', 'validation-test');
        expect(retrieved).toBeDefined();
      } catch (error) {
        // Expected - circular references should be handled
        expect(error).toBeDefined();
      }

      // System should still be operational
      expect(systemIntegration.isReady()).toBe(true);
      
      // Should be able to store valid data after failure
      await memoryMgr.store('valid-after-error', { test: true }, 'validation-test');
      const retrieved = await memoryMgr.retrieve('valid-after-error', 'validation-test');
      expect(retrieved).toEqual({ test: true });
      
      // Clean up
      await memoryMgr.delete('valid-after-error', 'validation-test');
    });
  });

  describe('Performance Under Load Validation', () => {
    beforeEach(async () => {
      await systemIntegration.initialize({
        logLevel: 'error', // Reduce logging for performance tests
        environment: 'production-test'
      });
    });

    test('should handle concurrent agent operations', async () => {
      const agentMgr = systemIntegration.getComponent('agentManager') as AgentManager;
      const concurrency = 10;
      const startTime = Date.now();

      // Create multiple agents concurrently
      const createPromises = Array.from({ length: concurrency }, (_, i) =>
        agentMgr.createAgent({
          type: 'researcher',
          name: `concurrent-agent-${i}`,
          capabilities: ['research']
        })
      );

      const agentIds = await Promise.all(createPromises);
      const creationTime = Date.now() - startTime;

      // Verify all agents were created
      expect(agentIds).toHaveLength(concurrency);
      agentIds.forEach(id => {
        expect(id).toBeDefined();
        expect(typeof id).toBe('string');
      });

      // Performance requirement: should create 10 agents in under 5 seconds
      expect(creationTime).toBeLessThan(5000);

      // Clean up concurrently
      const cleanupStart = Date.now();
      const removePromises = agentIds.map(id => agentMgr.removeAgent(id));
      await Promise.all(removePromises);
      const cleanupTime = Date.now() - cleanupStart;

      // Cleanup should also be fast
      expect(cleanupTime).toBeLessThan(2000);
    });

    test('should handle concurrent memory operations', async () => {
      const memoryMgr = systemIntegration.getComponent('memoryManager') as MemoryManager;
      const concurrency = 50;
      const startTime = Date.now();

      // Perform concurrent memory operations
      const operations = Array.from({ length: concurrency }, (_, i) => {
        const key = `concurrent-${i}`;
        const data = { index: i, timestamp: Date.now() };
        
        return memoryMgr.store(key, data, 'performance-test')
          .then(() => memoryMgr.retrieve(key, 'performance-test'))
          .then(retrieved => {
            expect(retrieved).toEqual(data);
            return memoryMgr.delete(key, 'performance-test');
          });
      });

      await Promise.all(operations);
      const totalTime = Date.now() - startTime;

      // Performance requirement: 50 store/retrieve/delete cycles in under 10 seconds
      expect(totalTime).toBeLessThan(10000);
    });
  });

  describe('System Health Monitoring Validation', () => {
    beforeEach(async () => {
      await systemIntegration.initialize({
        logLevel: 'info',
        environment: 'production-test',
        monitoring: {
          enabled: true,
          metrics: true,
          realTime: true
        }
      });
    });

    test('should provide accurate system health metrics', async () => {
      const health = await systemIntegration.getSystemHealth();
      
      expect(health).toBeDefined();
      expect(health.overall).toMatch(/^(healthy|warning|unhealthy)$/);
      expect(health.timestamp).toBeLessThanOrEqual(Date.now());
      expect(health.components).toBeDefined();
      expect(health.metrics).toBeDefined();
      
      // Verify metric consistency
      const { totalComponents, healthyComponents, unhealthyComponents, warningComponents } = health.metrics;
      expect(totalComponents).toBe(healthyComponents + unhealthyComponents + warningComponents);
      expect(totalComponents).toBeGreaterThan(0);
    });

    test('should detect component health changes', async () => {
      // Get initial health
      const initialHealth = await systemIntegration.getSystemHealth();
      expect(initialHealth.overall).toBe('healthy');

      // Create a component and verify health update
      const agentMgr = systemIntegration.getComponent('agentManager') as AgentManager;
      const agentId = await agentMgr.createAgent({
        type: 'researcher',
        name: 'health-test',
        capabilities: ['research']
      });

      // System should still be healthy
      const afterCreateHealth = await systemIntegration.getSystemHealth();
      expect(afterCreateHealth.overall).toBe('healthy');
      expect(afterCreateHealth.metrics.totalComponents).toBeGreaterThanOrEqual(initialHealth.metrics.totalComponents);

      // Clean up
      await agentMgr.removeAgent(agentId);
    });
  });
});