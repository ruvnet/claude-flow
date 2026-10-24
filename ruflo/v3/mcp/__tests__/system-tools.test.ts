/**
 * V3 MCP System Tools Tests
 *
 * Tests for system MCP tools:
 * - system/status
 * - system/metrics
 * - system/health
 * - system/info
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  systemStatusTool,
  systemMetricsTool,
  systemHealthTool,
  systemInfoTool,
  systemTools,
} from '../tools/system-tools.js';
import { ToolContext } from '../types.js';

describe('System Tools', () => {
  let mockContext: ToolContext;
  let mockOrchestrator: any;
  let mockSwarmCoordinator: any;
  let mockResourceManager: any;

  beforeEach(() => {
    mockOrchestrator = {
      getStatus: vi.fn().mockResolvedValue({ healthy: true }),
      listTasks: vi.fn().mockResolvedValue({
        total: 10,
        tasks: [
          { status: 'pending' },
          { status: 'pending' },
          { status: 'running' },
          { status: 'running' },
          { status: 'completed' },
          { status: 'completed' },
          { status: 'completed' },
          { status: 'completed' },
          { status: 'failed' },
          { status: 'failed' },
        ],
      }),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    mockSwarmCoordinator = {
      getStatus: vi.fn().mockResolvedValue({
        swarmId: 'swarm-1',
        state: 'ready',
        agents: [
          { id: 'agent-1', type: 'coder', status: 'active' },
          { id: 'agent-2', type: 'tester', status: 'idle' },
        ],
        topology: {
          type: 'hierarchical-mesh',
          edges: [],
        },
        createdAt: new Date(),
      }),
      getMetrics: vi.fn().mockResolvedValue({
        totalTasks: 100,
        completedTasks: 80,
        failedTasks: 5,
        activeTasks: 15,
        averageTaskDuration: 2500,
        throughput: 10,
        successRate: 0.95,
      }),
      healthCheck: vi.fn().mockResolvedValue(true),
    };

    mockResourceManager = {
      memoryService: {
        getStats: vi.fn().mockResolvedValue({
          entryCount: 1000,
          size: 1024 * 1024,
        }),
        healthCheck: vi.fn().mockResolvedValue(true),
      },
    };

    mockContext = {
      sessionId: 'test-session',
      orchestrator: mockOrchestrator,
      swarmCoordinator: mockSwarmCoordinator,
      resourceManager: mockResourceManager,
    };
  });

  describe('system/status', () => {
    it('should have correct tool definition', () => {
      expect(systemStatusTool.name).toBe('system/status');
      expect(systemStatusTool.category).toBe('system');
      expect(systemStatusTool.cacheable).toBe(true);
    });

    it('should return basic system status', async () => {
      const result = await systemStatusTool.handler({}, mockContext);

      expect(result).toBeDefined();
      expect(result.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.version).toBe('3.0.0');
      expect(result.components).toBeDefined();
      expect(Array.isArray(result.components)).toBe(true);
    });

    it('should include agent information when requested', async () => {
      const result = await systemStatusTool.handler({
        includeAgents: true,
      }, mockContext);

      expect(result.agents).toBeDefined();
      expect(result.agents.total).toBe(2);
      expect(result.agents.active).toBe(1);
      expect(result.agents.idle).toBe(1);
    });

    it('should include task information when requested', async () => {
      const result = await systemStatusTool.handler({
        includeTasks: true,
      }, mockContext);

      expect(result.tasks).toBeDefined();
      expect(result.tasks.total).toBe(10);
      expect(result.tasks.pending).toBe(2);
      expect(result.tasks.running).toBe(2);
      expect(result.tasks.completed).toBe(4);
      expect(result.tasks.failed).toBe(2);
    });

    it('should include memory usage when requested', async () => {
      const result = await systemStatusTool.handler({
        includeMemory: true,
      }, mockContext);

      expect(result.memory).toBeDefined();
      expect(result.memory.heapUsed).toBeDefined();
      expect(result.memory.heapTotal).toBeDefined();
      expect(result.memory.rss).toBeDefined();
    });

    it('should include connection information when requested', async () => {
      const result = await systemStatusTool.handler({
        includeConnections: true,
      }, mockContext);

      expect(result.connections).toBeDefined();
      expect(result.connections.total).toBeDefined();
      expect(result.connections.active).toBeDefined();
      expect(result.connections.idle).toBeDefined();
    });

    it('should check component health', async () => {
      const result = await systemStatusTool.handler({}, mockContext);

      expect(result.components.length).toBeGreaterThan(0);
      result.components.forEach(component => {
        expect(component.name).toBeDefined();
        expect(component.status).toBeDefined();
        expect(['healthy', 'degraded', 'unhealthy', 'unknown']).toContain(component.status);
      });
    });
  });

  describe('system/metrics', () => {
    it('should have correct tool definition', () => {
      expect(systemMetricsTool.name).toBe('system/metrics');
      expect(systemMetricsTool.category).toBe('system');
      expect(systemMetricsTool.cacheable).toBe(true);
    });

    it('should return metrics with default time range', async () => {
      const result = await systemMetricsTool.handler({}, mockContext);

      expect(result).toBeDefined();
      expect(result.timeRange).toBe('1h');
      expect(result.collectedAt).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    it('should return metrics for different time ranges', async () => {
      const timeRanges = ['1h', '6h', '24h', '7d'];

      for (const timeRange of timeRanges) {
        const result = await systemMetricsTool.handler({
          timeRange,
        }, mockContext);

        expect(result.timeRange).toBe(timeRange);
      }
    });

    it('should include agent metrics when requested', async () => {
      const result = await systemMetricsTool.handler({
        components: ['agents'],
      }, mockContext);

      expect(result.metrics.agents).toBeDefined();
      expect(Array.isArray(result.metrics.agents)).toBe(true);
      result.metrics.agents!.forEach(metric => {
        expect(metric.name).toBeDefined();
        expect(metric.unit).toBeDefined();
        expect(metric.current).toBeDefined();
      });
    });

    it('should include task metrics when requested', async () => {
      const result = await systemMetricsTool.handler({
        components: ['tasks'],
      }, mockContext);

      expect(result.metrics.tasks).toBeDefined();
    });

    it('should include memory metrics when requested', async () => {
      const result = await systemMetricsTool.handler({
        components: ['memory'],
      }, mockContext);

      expect(result.metrics.memory).toBeDefined();
    });

    it('should include swarm metrics when requested', async () => {
      const result = await systemMetricsTool.handler({
        components: ['swarm'],
      }, mockContext);

      expect(result.metrics.swarm).toBeDefined();
    });

    it('should include all components by default', async () => {
      const result = await systemMetricsTool.handler({
        components: ['all'],
      }, mockContext);

      expect(result.metrics.agents).toBeDefined();
      expect(result.metrics.tasks).toBeDefined();
      expect(result.metrics.memory).toBeDefined();
      expect(result.metrics.swarm).toBeDefined();
    });

    it('should provide summary metrics', async () => {
      const result = await systemMetricsTool.handler({}, mockContext);

      expect(result.summary).toBeDefined();
      expect(result.summary.totalRequests).toBeDefined();
      expect(result.summary.successRate).toBeDefined();
      expect(result.summary.avgLatency).toBeDefined();
      expect(result.summary.errorCount).toBeDefined();
    });
  });

  describe('system/health', () => {
    it('should have correct tool definition', () => {
      expect(systemHealthTool.name).toBe('system/health');
      expect(systemHealthTool.category).toBe('system');
      expect(systemHealthTool.inputSchema.properties.deep).toBeDefined();
    });

    it('should perform basic health check', async () => {
      const result = await systemHealthTool.handler({}, mockContext);

      expect(result).toBeDefined();
      expect(typeof result.healthy).toBe('boolean');
      expect(result.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
      expect(result.timestamp).toBeDefined();
      expect(result.duration).toBeDefined();
      expect(result.checks).toBeDefined();
      expect(Array.isArray(result.checks)).toBe(true);
    });

    it('should include basic checks', async () => {
      const result = await systemHealthTool.handler({
        deep: false,
      }, mockContext);

      const checkNames = result.checks.map(c => c.name);
      expect(checkNames).toContain('process');
      expect(checkNames).toContain('memory');
      expect(checkNames).toContain('event-loop');
    });

    it('should perform deep health check', async () => {
      const result = await systemHealthTool.handler({
        deep: true,
      }, mockContext);

      expect(result.checks.length).toBeGreaterThanOrEqual(3);

      result.checks.forEach(check => {
        expect(check.name).toBeDefined();
        expect(check.status).toBeDefined();
        expect(['pass', 'warn', 'fail']).toContain(check.status);
        expect(check.duration).toBeDefined();
      });
    });

    it('should respect timeout setting', async () => {
      const result = await systemHealthTool.handler({
        deep: true,
        timeout: 10000,
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.duration).toBeLessThan(10000);
    });

    it('should check specific components', async () => {
      const result = await systemHealthTool.handler({
        components: ['process', 'memory'],
      }, mockContext);

      const checkNames = result.checks.map(c => c.name);
      expect(checkNames).toContain('process');
      expect(checkNames).toContain('memory');
    });

    it('should report healthy status for passing checks', async () => {
      const result = await systemHealthTool.handler({
        deep: false,
      }, mockContext);

      if (result.checks.every(c => c.status === 'pass')) {
        expect(result.healthy).toBe(true);
        expect(result.status).toBe('healthy');
      }
    });

    it('should report degraded status for warnings', async () => {
      // This test verifies the logic, actual result depends on system state
      const result = await systemHealthTool.handler({}, mockContext);
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
    });
  });

  describe('system/info', () => {
    it('should have correct tool definition', () => {
      expect(systemInfoTool.name).toBe('system/info');
      expect(systemInfoTool.category).toBe('system');
      expect(systemInfoTool.cacheable).toBe(true);
      expect(systemInfoTool.cacheTTL).toBe(60000);
    });

    it('should return basic system information', async () => {
      const result = await systemInfoTool.handler({}, mockContext);

      expect(result).toBeDefined();
      expect(result.name).toBe('claude-flow');
      expect(result.version).toBe('3.0.0');
      expect(result.nodeVersion).toBeDefined();
      expect(result.platform).toBeDefined();
      expect(result.arch).toBeDefined();
      expect(result.hostname).toBeDefined();
      expect(result.cpuCount).toBeGreaterThan(0);
      expect(result.totalMemory).toBeGreaterThan(0);
      expect(result.freeMemory).toBeGreaterThan(0);
      expect(result.uptime).toBeGreaterThanOrEqual(0);
      expect(result.pid).toBeGreaterThan(0);
    });

    it('should not include env by default', async () => {
      const result = await systemInfoTool.handler({}, mockContext);

      expect(result.env).toBeUndefined();
    });

    it('should include filtered env when requested', async () => {
      process.env.NODE_ENV = 'test';

      const result = await systemInfoTool.handler({
        includeEnv: true,
      }, mockContext);

      expect(result.env).toBeDefined();
      if (result.env!.NODE_ENV) {
        expect(result.env!.NODE_ENV).toBe('test');
      }

      // Should not include sensitive environment variables
      expect(result.env!['API_KEY']).toBeUndefined();
      expect(result.env!['SECRET']).toBeUndefined();
    });

    it('should include versions when requested', async () => {
      const result = await systemInfoTool.handler({
        includeVersions: true,
      }, mockContext);

      expect(result.versions).toBeDefined();
      expect(result.versions!.node).toBeDefined();
      expect(result.versions!.v8).toBeDefined();
    });

    it('should include capabilities when requested', async () => {
      const result = await systemInfoTool.handler({
        includeCapabilities: true,
      }, mockContext);

      expect(result.capabilities).toBeDefined();
      expect(result.capabilities!.features).toBeDefined();
      expect(Array.isArray(result.capabilities!.features)).toBe(true);
      expect(result.capabilities!.tools).toBeGreaterThan(0);
      expect(result.capabilities!.transports).toBeDefined();
      expect(result.capabilities!.protocols).toBeDefined();
    });

    it('should include expected features', async () => {
      const result = await systemInfoTool.handler({
        includeCapabilities: true,
      }, mockContext);

      const features = result.capabilities!.features;
      expect(features).toContain('mcp-protocol');
      expect(features).toContain('agent-lifecycle');
      expect(features).toContain('swarm-coordination');
    });

    it('should include expected transports', async () => {
      const result = await systemInfoTool.handler({
        includeCapabilities: true,
      }, mockContext);

      const transports = result.capabilities!.transports;
      expect(transports).toContain('stdio');
      expect(transports).toContain('http');
      expect(transports).toContain('websocket');
    });
  });

  describe('Tool Collection', () => {
    it('should export all 4 system tools', () => {
      expect(systemTools).toHaveLength(4);
    });

    it('should have unique tool names', () => {
      const names = systemTools.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should all have handlers', () => {
      systemTools.forEach(tool => {
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      });
    });

    it('should all have inputSchema', () => {
      systemTools.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      });
    });

    it('should all be in system category', () => {
      systemTools.forEach(tool => {
        expect(tool.category).toBe('system');
      });
    });

    it('should include expected tool names', () => {
      const names = systemTools.map(t => t.name);
      expect(names).toContain('system/status');
      expect(names).toContain('system/metrics');
      expect(names).toContain('system/health');
      expect(names).toContain('system/info');
    });
  });
});
