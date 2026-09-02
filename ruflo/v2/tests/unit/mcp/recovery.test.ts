/**
 * Tests for MCP Recovery Mechanisms
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { MCPClient } from '../../../src/mcp/client.js';
import { ConnectionHealthMonitor } from '../../../src/mcp/recovery/connection-health-monitor.js';
import { ReconnectionManager } from '../../../src/mcp/recovery/reconnection-manager.js';
import { FallbackCoordinator } from '../../../src/mcp/recovery/fallback-coordinator.js';
import { ConnectionStateManager } from '../../../src/mcp/recovery/connection-state-manager.js';
import { RecoveryManager } from '../../../src/mcp/recovery/recovery-manager.js';
import { ITransport } from '../../../src/mcp/transports/base.js';
import { logger } from '../../../src/core/logger.js';

// Mock transport
class MockTransport extends EventEmitter implements ITransport {
  private connected = false;
  private failConnect = false;
  private failHeartbeat = false;

  async start(): Promise<void> {
    // Mock implementation
  }

  async stop(): Promise<void> {
    // Mock implementation
  }

  async connect(): Promise<void> {
    if (this.failConnect) {
      throw new Error('Connection failed');
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  onRequest(handler: any): void {
    // Mock implementation
  }

  async sendRequest(request: any): Promise<any> {
    if (!this.connected) {
      throw new Error('Not connected');
    }
    
    // Mock heartbeat response
    if (request.method === 'heartbeat' && this.failHeartbeat) {
      throw new Error('Heartbeat failed');
    }
    
    return { jsonrpc: '2.0', id: request.id, result: {} };
  }

  async sendNotification(notification: any): Promise<void> {
    if (notification.method === 'heartbeat' && this.failHeartbeat) {
      throw new Error('Heartbeat failed');
    }
  }

  async getHealthStatus(): Promise<any> {
    return { healthy: this.connected };
  }

  setFailConnect(fail: boolean): void {
    this.failConnect = fail;
  }

  setFailHeartbeat(fail: boolean): void {
    this.failHeartbeat = fail;
  }
}

describe('MCP Recovery Mechanisms', () => {
  let mockTransport: MockTransport;
  let client: MCPClient;

  beforeEach(() => {
    mockTransport = new MockTransport();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (client) {
      await client.cleanup();
    }
  });

  describe('Connection Health Monitor', () => {
    test('should detect healthy connection', async () => {
      client = new MCPClient({
        transport: mockTransport,
        enableRecovery: false,
      });
      
      await client.connect();
      
      const monitor = new ConnectionHealthMonitor(client, logger);
      await monitor.start();
      
      const health = await monitor.checkHealth();
      expect(health.healthy).toBe(true);
      expect(health.connectionState).toBe('connected');
      
      await monitor.stop();
    });

    test('should detect connection failure', async () => {
      client = new MCPClient({
        transport: mockTransport,
        enableRecovery: false,
      });
      
      await client.connect();
      
      const monitor = new ConnectionHealthMonitor(client, logger, {
        heartbeatInterval: 100,
        heartbeatTimeout: 200,
        maxMissedHeartbeats: 2,
      });
      
      let connectionLostEmitted = false;
      monitor.on('connectionLost', () => {
        connectionLostEmitted = true;
      });
      
      await monitor.start();
      
      // Simulate heartbeat failure
      mockTransport.setFailHeartbeat(true);
      
      // Wait for heartbeat failures
      await new Promise(resolve => setTimeout(resolve, 600));
      
      expect(connectionLostEmitted).toBe(true);
      const health = monitor.getHealthStatus();
      expect(health.healthy).toBe(false);
      expect(health.missedHeartbeats).toBeGreaterThanOrEqual(2);
      
      await monitor.stop();
    });
  });

  describe('Reconnection Manager', () => {
    test('should attempt reconnection with backoff', async () => {
      client = new MCPClient({
        transport: mockTransport,
        enableRecovery: false,
      });
      
      const manager = new ReconnectionManager(client, logger, {
        maxRetries: 3,
        initialDelay: 100,
        backoffMultiplier: 2,
      });
      
      // Simulate disconnection
      mockTransport.setFailConnect(true);
      
      let attempts = 0;
      manager.on('attemptStart', () => {
        attempts++;
      });
      
      manager.startAutoReconnect();
      
      // Wait for attempts
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(attempts).toBeGreaterThan(0);
      expect(attempts).toBeLessThanOrEqual(3);
      
      manager.stopReconnection();
    });

    test('should successfully reconnect', async () => {
      client = new MCPClient({
        transport: mockTransport,
        enableRecovery: false,
      });
      
      await client.connect();
      await client.disconnect();
      
      const manager = new ReconnectionManager(client, logger);
      
      let success = false;
      manager.on('success', () => {
        success = true;
      });
      
      const result = await manager.attemptReconnection();
      
      expect(result).toBe(true);
      expect(success).toBe(true);
      expect(client.isConnected()).toBe(true);
    });
  });

  describe('Fallback Coordinator', () => {
    test('should queue operations in fallback mode', async () => {
      const coordinator = new FallbackCoordinator(logger);
      
      coordinator.enableCLIFallback();
      
      coordinator.queueOperation({
        type: 'tool',
        method: 'test/method',
        params: { test: true },
        priority: 'high',
        retryable: true,
      });
      
      const state = coordinator.getState();
      expect(state.isFallbackActive).toBe(true);
      expect(state.queuedOperations).toBe(1);
      
      const operations = coordinator.getQueuedOperations();
      expect(operations).toHaveLength(1);
      expect(operations[0].method).toBe('test/method');
    });

    test('should process queue when fallback disabled', async () => {
      const coordinator = new FallbackCoordinator(logger);
      
      coordinator.enableCLIFallback();
      
      // Queue operations
      for (let i = 0; i < 3; i++) {
        coordinator.queueOperation({
          type: 'tool',
          method: `test/method${i}`,
          params: { index: i },
          priority: 'medium',
          retryable: true,
        });
      }
      
      let processedCount = 0;
      coordinator.on('replayOperation', () => {
        processedCount++;
      });
      
      coordinator.disableCLIFallback();
      
      // Process queue should be triggered
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(processedCount).toBe(0); // No MCP client to replay
      expect(coordinator.getState().isFallbackActive).toBe(false);
    });
  });

  describe('Connection State Manager', () => {
    test('should persist and restore state', async () => {
      const stateManager = new ConnectionStateManager(logger, {
        enablePersistence: false, // Disable file persistence for tests
      });
      
      const state = {
        sessionId: 'test-session',
        lastConnected: new Date(),
        pendingRequests: [
          { jsonrpc: '2.0' as const, id: '1', method: 'test', params: {} },
        ],
        configuration: {},
        metadata: { test: true },
      };
      
      stateManager.saveState(state);
      
      const restored = stateManager.restoreState();
      expect(restored).toBeTruthy();
      expect(restored?.sessionId).toBe('test-session');
      expect(restored?.pendingRequests).toHaveLength(1);
    });

    test('should track connection events', () => {
      const stateManager = new ConnectionStateManager(logger, {
        enablePersistence: false,
      });
      
      stateManager.recordEvent({
        type: 'connect',
        sessionId: 'session-1',
      });
      
      stateManager.recordEvent({
        type: 'disconnect',
        sessionId: 'session-1',
      });
      
      stateManager.recordEvent({
        type: 'reconnect',
        sessionId: 'session-1',
      });
      
      const metrics = stateManager.getMetrics();
      expect(metrics.totalConnections).toBe(1);
      expect(metrics.totalDisconnections).toBe(1);
      expect(metrics.totalReconnections).toBe(1);
      expect(metrics.connectionHistory).toHaveLength(3);
    });
  });

  describe('Recovery Manager Integration', () => {
    test('should coordinate recovery on connection loss', async () => {
      client = new MCPClient({
        transport: mockTransport,
        enableRecovery: true,
        recoveryConfig: {
          enableRecovery: true,
          healthMonitor: {
            heartbeatInterval: 100,
            heartbeatTimeout: 200,
            maxMissedHeartbeats: 1,
          },
          reconnection: {
            maxRetries: 2,
            initialDelay: 100,
          },
          fallback: {
            enableFallback: true,
          },
        },
      });
      
      await client.connect();
      
      let recoveryStarted = false;
      let fallbackActivated = false;
      
      client.on('recoveryStart', () => {
        recoveryStarted = true;
      });
      
      client.on('fallbackActivated', () => {
        fallbackActivated = true;
      });
      
      // Simulate connection failure
      mockTransport.setFailHeartbeat(true);
      await client.disconnect();
      mockTransport.setFailConnect(true);
      
      // Force recovery
      await client.forceRecovery();
      
      // Wait for recovery attempts
      await new Promise(resolve => setTimeout(resolve, 500));
      
      expect(recoveryStarted).toBe(true);
      expect(fallbackActivated).toBe(true);
      
      const status = client.getRecoveryStatus();
      expect(status?.isRecoveryActive).toBe(true);
      expect(status?.fallbackState.isFallbackActive).toBe(true);
    });

    test('should successfully recover connection', async () => {
      client = new MCPClient({
        transport: mockTransport,
        enableRecovery: true,
        recoveryConfig: {
          enableRecovery: true,
          reconnection: {
            maxRetries: 3,
            initialDelay: 100,
          },
        },
      });
      
      await client.connect();
      
      let recoverySuccess = false;
      client.on('recoverySuccess', () => {
        recoverySuccess = true;
      });
      
      // Simulate temporary failure
      await client.disconnect();
      mockTransport.setFailConnect(true);
      
      // Start recovery
      const recoveryPromise = client.forceRecovery();
      
      // Allow failure then fix
      await new Promise(resolve => setTimeout(resolve, 200));
      mockTransport.setFailConnect(false);
      
      // Wait for recovery
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(recoverySuccess).toBe(true);
      expect(client.isConnected()).toBe(true);
    });
  });
});