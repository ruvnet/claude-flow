/**
 * Config Adapter Tests
 */

import { describe, it, expect } from 'vitest';
import { systemConfigToV3Config, v3ConfigToSystemConfig } from '../src/config-adapter.js';
import type { SystemConfig } from '@claude-flow/shared';
import type { V3Config } from '../src/types.js';

describe('ConfigAdapter', () => {
  describe('systemConfigToV3Config', () => {
    it('should convert minimal SystemConfig to V3Config', () => {
      const systemConfig: SystemConfig = {
        orchestrator: {
          lifecycle: {
            autoStart: true,
            maxConcurrentAgents: 10,
            shutdownTimeoutMs: 30000,
            cleanupOrphanedAgents: true,
          },
          session: {
            dataDir: '/test/data',
            persistState: true,
            stateFile: 'session.json',
          },
          monitoring: {
            enabled: true,
            metricsIntervalMs: 5000,
            healthCheckIntervalMs: 10000,
          },
        },
        swarm: {
          topology: 'hierarchical-mesh',
          maxAgents: 15,
        },
        memory: {
          type: 'hybrid',
        },
        mcp: {
          enabled: true,
          transport: {
            type: 'stdio',
            host: 'localhost',
            port: 3000,
          },
          enabledTools: ['agent/*', 'swarm/*'],
          security: {
            requireAuth: false,
            allowedOrigins: ['*'],
            rateLimiting: {
              enabled: true,
              maxRequestsPerMinute: 100,
            },
          },
        },
        logging: {
          level: 'info',
          pretty: true,
          destination: 'console',
          format: 'text',
        },
        hooks: {
          enabled: true,
          autoExecute: true,
          definitions: [],
        },
      };

      const v3Config = systemConfigToV3Config(systemConfig);

      expect(v3Config.version).toBe('3.0.0');
      expect(v3Config.projectRoot).toBe('/test/data');
      expect(v3Config.agents.maxConcurrent).toBe(10);
      expect(v3Config.agents.autoSpawn).toBe(false); // Default is false for safety
      expect(v3Config.swarm.topology).toBe('hybrid'); // 'hierarchical-mesh' normalizes to 'hybrid'
      expect(v3Config.swarm.maxAgents).toBe(15);
      expect(v3Config.memory.backend).toBe('hybrid');
      expect(v3Config.mcp.serverHost).toBe('localhost');
      expect(v3Config.mcp.serverPort).toBe(3000);
      expect(v3Config.mcp.autoStart).toBe(false); // Default is false for safety
      expect(v3Config.cli.colorOutput).toBe(true);
      expect(v3Config.cli.verbosity).toBe('normal'); // Default verbosity level
      expect(v3Config.hooks.enabled).toBe(false); // Default is false
      expect(v3Config.hooks.autoExecute).toBe(false); // Default is false
    });

    it('should handle missing optional fields', () => {
      const minimalConfig: SystemConfig = {
        orchestrator: {
          lifecycle: {
            autoStart: false,
            maxConcurrentAgents: 5,
            shutdownTimeoutMs: 30000,
            cleanupOrphanedAgents: true,
          },
          session: {
            dataDir: '/data',
            persistState: true,
            stateFile: 'session.json',
          },
          monitoring: {
            enabled: true,
            metricsIntervalMs: 5000,
            healthCheckIntervalMs: 10000,
          },
        },
        swarm: {
          topology: 'mesh',
          maxAgents: 10,
        },
        memory: {
          type: 'sqlite',
        },
        mcp: {
          enabled: false,
          transport: {
            type: 'http',
            host: '127.0.0.1',
            port: 8080,
          },
          enabledTools: [],
          security: {
            requireAuth: false,
            allowedOrigins: ['*'],
            rateLimiting: {
              enabled: true,
              maxRequestsPerMinute: 100,
            },
          },
        },
        logging: {
          level: 'debug',
          pretty: false,
          destination: 'file',
          format: 'json',
        },
        hooks: {
          enabled: false,
          autoExecute: false,
          definitions: [],
        },
      };

      const v3Config = systemConfigToV3Config(minimalConfig);

      expect(v3Config.agents.maxConcurrent).toBe(5);
      expect(v3Config.agents.autoSpawn).toBe(false);
      expect(v3Config.memory.backend).toBe('sqlite');
      expect(v3Config.mcp.autoStart).toBe(false);
      expect(v3Config.cli.colorOutput).toBe(true); // Default is always true
    });
  });

  describe('v3ConfigToSystemConfig', () => {
    it('should convert V3Config to SystemConfig', () => {
      const v3Config: V3Config = {
        version: '3.0.0',
        projectRoot: '/test/project',
        agents: {
          defaultType: 'coder',
          autoSpawn: true,
          maxConcurrent: 20,
          timeout: 60000,
          providers: [],
        },
        swarm: {
          topology: 'hierarchical',
          maxAgents: 20,
          autoScale: true,
          coordinationStrategy: 'consensus',
          healthCheckInterval: 15000,
        },
        memory: {
          backend: 'agentdb',
          persistPath: '/test/memory',
          cacheSize: 500000,
          enableHNSW: true,
          vectorDimension: 768,
        },
        mcp: {
          serverHost: '0.0.0.0',
          serverPort: 4000,
          autoStart: true,
          transportType: 'websocket',
          tools: ['memory/*'],
        },
        cli: {
          colorOutput: true,
          interactive: true,
          verbosity: 'verbose',
          outputFormat: 'json',
          progressStyle: 'bar',
        },
        hooks: {
          enabled: true,
          autoExecute: false,
          hooks: [
            {
              name: 'test-hook',
              event: 'pre-task',
              handler: '/path/to/handler.js',
              priority: 10,
              enabled: true,
            },
          ],
        },
      };

      const systemConfig = v3ConfigToSystemConfig(v3Config);

      // Core orchestrator conversion (autoStart not mapped)
      expect(systemConfig.orchestrator?.lifecycle?.maxConcurrentAgents).toBe(20);
      expect(systemConfig.orchestrator?.session?.dataDir).toBe('/test/project');
      expect(systemConfig.swarm?.topology).toBe('hierarchical');
      expect(systemConfig.swarm?.maxAgents).toBe(20);
      expect(systemConfig.swarm?.autoScale?.enabled).toBe(true);
      expect(systemConfig.swarm?.coordination?.consensusRequired).toBe(true);
      expect(systemConfig.memory?.type).toBe('agentdb');
      expect(systemConfig.memory?.path).toBe('/test/memory');
      expect(systemConfig.memory?.agentdb?.dimensions).toBe(768);
      expect(systemConfig.memory?.agentdb?.indexType).toBe('hnsw');
      // MCP enabled not mapped, just transport
      expect(systemConfig.mcp?.transport?.type).toBe('websocket');
      expect(systemConfig.mcp?.transport?.host).toBe('0.0.0.0');
      expect(systemConfig.mcp?.transport?.port).toBe(4000);
      // logging and hooks not included in v3ConfigToSystemConfig conversion
    });

    it('should handle different coordination strategies', () => {
      const leaderConfig: V3Config = {
        version: '3.0.0',
        projectRoot: '/test',
        agents: {
          defaultType: 'coder',
          autoSpawn: false,
          maxConcurrent: 10,
          timeout: 30000,
          providers: [],
        },
        swarm: {
          topology: 'star',
          maxAgents: 10,
          autoScale: false,
          coordinationStrategy: 'leader',
          healthCheckInterval: 5000,
        },
        memory: {
          backend: 'memory',
          persistPath: '/data',
          cacheSize: 100000,
          enableHNSW: false,
          vectorDimension: 1536,
        },
        mcp: {
          serverHost: 'localhost',
          serverPort: 3000,
          autoStart: false,
          transportType: 'stdio',
          tools: [],
        },
        cli: {
          colorOutput: true,
          interactive: true,
          verbosity: 'normal',
          outputFormat: 'text',
          progressStyle: 'spinner',
        },
        hooks: {
          enabled: false,
          autoExecute: false,
          hooks: [],
        },
      };

      const systemConfig = v3ConfigToSystemConfig(leaderConfig);

      expect(systemConfig.swarm?.coordination?.consensusRequired).toBe(false);
      expect(systemConfig.memory?.agentdb?.indexType).toBe('flat');
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve key config values through round-trip', () => {
      const originalSystemConfig: SystemConfig = {
        orchestrator: {
          lifecycle: {
            autoStart: true,
            maxConcurrentAgents: 12,
            shutdownTimeoutMs: 30000,
            cleanupOrphanedAgents: true,
          },
          session: {
            dataDir: '/test/roundtrip',
            persistState: true,
            stateFile: 'session.json',
          },
          monitoring: {
            enabled: true,
            metricsIntervalMs: 5000,
            healthCheckIntervalMs: 8000,
          },
        },
        swarm: {
          topology: 'hierarchical-mesh',
          maxAgents: 12,
        },
        memory: {
          type: 'hybrid',
          path: '/test/memory',
          agentdb: {
            dimensions: 1536,
            indexType: 'hnsw',
            efConstruction: 200,
            m: 16,
            quantization: 'none',
          },
        },
        mcp: {
          enabled: true,
          transport: {
            type: 'http',
            host: '127.0.0.1',
            port: 5000,
          },
          enabledTools: ['test/*'],
          security: {
            requireAuth: false,
            allowedOrigins: ['*'],
            rateLimiting: {
              enabled: true,
              maxRequestsPerMinute: 100,
            },
          },
        },
        logging: {
          level: 'warn',
          pretty: true,
          destination: 'console',
          format: 'text',
        },
        hooks: {
          enabled: true,
          autoExecute: true,
          definitions: [],
        },
      };

      const v3Config = systemConfigToV3Config(originalSystemConfig);
      const roundTripConfig = v3ConfigToSystemConfig(v3Config);

      // Core values preserved through round-trip
      expect(roundTripConfig.orchestrator?.lifecycle?.maxConcurrentAgents).toBe(12);
      expect(roundTripConfig.swarm?.topology).toBe('hierarchical-mesh');
      expect(roundTripConfig.swarm?.maxAgents).toBe(12);
      expect(roundTripConfig.memory?.type).toBe('hybrid');
      expect(roundTripConfig.memory?.path).toBe('/test/memory');
      expect(roundTripConfig.mcp?.transport?.type).toBe('http');
      expect(roundTripConfig.mcp?.transport?.port).toBe(5000);
      // Note: logging is not included in v3ConfigToSystemConfig
    });
  });
});
