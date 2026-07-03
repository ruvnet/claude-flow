/**
 * AgentFederationPlugin Tests
 *
 * Tests the ACTUAL AgentFederationPlugin class from the real source module.
 * The PluginContext is a test double (vi.fn()) since it is an external interface,
 * but the system under test is the real plugin -- no mocks, no reimplementations.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentFederationPlugin } from '../../src/plugin.js';

function createMockContext() {
  return {
    config: {
      nodeId: 'test-node',
      endpoint: 'ws://localhost:9100',
      complianceMode: 'none',
      staticPeers: [] as string[],
      hashSalt: 'test-salt',
    } as Record<string, unknown>,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    eventBus: {
      emit: vi.fn(),
      on: vi.fn(),
    },
    services: {
      register: vi.fn(),
      get: vi.fn(),
    },
  };
}

describe('AgentFederationPlugin', () => {
  let plugin: AgentFederationPlugin;
  let context: ReturnType<typeof createMockContext>;

  beforeEach(() => {
    plugin = new AgentFederationPlugin();
    context = createMockContext();
  });

  describe('interface compliance', () => {
    it('should have name set to @claude-flow/plugin-agent-federation', () => {
      expect(plugin.name).toBe('@claude-flow/plugin-agent-federation');
    });

    it('should have version set to 1.0.0-alpha.1', () => {
      expect(plugin.version).toBe('1.0.0-alpha.1');
    });

    it('should have a non-empty description', () => {
      expect(plugin.description).toBeDefined();
      expect(plugin.description!.length).toBeGreaterThan(0);
    });

    it('should have author set to Claude Flow Team', () => {
      expect(plugin.author).toBe('Claude Flow Team');
    });

    it('should declare @claude-flow/security as a dependency', () => {
      expect(plugin.dependencies).toContain('@claude-flow/security');
    });

    it('should declare @claude-flow/aidefence as a dependency', () => {
      expect(plugin.dependencies).toContain('@claude-flow/aidefence');
    });

    it('should have exactly 2 dependencies', () => {
      expect(plugin.dependencies).toHaveLength(2);
    });

    it('should have all required lifecycle methods', () => {
      expect(typeof plugin.initialize).toBe('function');
      expect(typeof plugin.shutdown).toBe('function');
      expect(typeof plugin.registerMCPTools).toBe('function');
      expect(typeof plugin.registerCLICommands).toBe('function');
      expect(typeof plugin.registerAgentTypes).toBe('function');
      expect(typeof plugin.healthCheck).toBe('function');
    });
  });

  describe('initialize', () => {
    it('should complete without throwing', async () => {
      await expect(plugin.initialize(context as any)).resolves.not.toThrow();
    });

    it('should register services in the container', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalled();
    });

    it('should register 8 services in the container', async () => {
      // 7 original + federation:transport (ADR-104, registered iff
      // loadQuicTransport succeeded — succeeds in this env since
      // agentic-flow's loader has no required peers)
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledTimes(8);
    });

    it('should register federation:coordinator service', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledWith(
        'federation:coordinator',
        expect.anything(),
      );
    });

    it('should register federation:discovery service', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledWith(
        'federation:discovery',
        expect.anything(),
      );
    });

    it('should register federation:audit service', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledWith(
        'federation:audit',
        expect.anything(),
      );
    });

    it('should register federation:pii service', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledWith(
        'federation:pii',
        expect.anything(),
      );
    });

    it('should register federation:trust service', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledWith(
        'federation:trust',
        expect.anything(),
      );
    });

    it('should register federation:policy service', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledWith(
        'federation:policy',
        expect.anything(),
      );
    });

    it('should register federation:routing service', async () => {
      await plugin.initialize(context as any);
      expect(context.services.register).toHaveBeenCalledWith(
        'federation:routing',
        expect.anything(),
      );
    });

    it('should log initialization message', async () => {
      await plugin.initialize(context as any);
      expect(context.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('initialized'),
      );
    });
  });

  describe('shutdown', () => {
    it('should not throw when shutting down before initialization', async () => {
      await expect(plugin.shutdown()).resolves.not.toThrow();
    });

    it('should complete successfully after initialization', async () => {
      await plugin.initialize(context as any);
      await expect(plugin.shutdown()).resolves.not.toThrow();
    });
  });

  describe('registerMCPTools', () => {
    it('should return 16 MCP tool definitions', () => {
      // 9 original + 3 ADR-097 Phase 4 + 1 ADR-097 Phase 3 upstream + 3 ADR-111 Phase 6
      const tools = plugin.registerMCPTools();
      expect(tools).toHaveLength(16);
    });

    it.each([
      'federation_init',
      'federation_join',
      'federation_peers',
      'federation_send',
      'federation_query',
      'federation_status',
      'federation_trust',
      'federation_audit',
      'federation_consensus',
      // ADR-097 Phase 4
      'federation_breaker_status',
      'federation_evict',
      'federation_reactivate',
      // ADR-097 Phase 3 upstream
      'federation_report_spend',
      // ADR-111 Phase 6
      'federation_wg_status',
      'federation_wg_attest',
      'federation_wg_keyrotate',
    ] as const)('should include tool "%s"', (expectedName) => {
      const tools = plugin.registerMCPTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain(expectedName);
    });

    it('should have unique tool names', () => {
      const tools = plugin.registerMCPTools();
      const names = tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('should have handler functions for all tools', () => {
      const tools = plugin.registerMCPTools();
      for (const tool of tools) {
        expect(typeof tool.handler).toBe('function');
      }
    });

    it('should have non-empty descriptions for all tools', () => {
      const tools = plugin.registerMCPTools();
      for (const tool of tools) {
        expect(tool.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('registerCLICommands', () => {
    it('should return 11 CLI command definitions', () => {
      const commands = plugin.registerCLICommands();
      expect(commands).toHaveLength(11);
    });

    it.each([
      'federation init',
      'federation join',
      'federation leave',
      'federation peers',
      'federation peers add',
      'federation peers remove',
      'federation status',
      'federation audit',
      'federation trust',
      'federation trust elevate',
      'federation config',
    ] as const)('should include command "%s"', (expectedName) => {
      const commands = plugin.registerCLICommands();
      const names = commands.map((c) => c.name);
      expect(names).toContain(expectedName);
    });

    it('should have unique command names', () => {
      const commands = plugin.registerCLICommands();
      const names = commands.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('should have handler functions for all commands', () => {
      const commands = plugin.registerCLICommands();
      for (const cmd of commands) {
        expect(typeof cmd.handler).toBe('function');
      }
    });

    it('should have non-empty descriptions for all commands', () => {
      const commands = plugin.registerCLICommands();
      for (const cmd of commands) {
        expect(cmd.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe('registerAgentTypes', () => {
    it('should return 1 agent type definition', () => {
      const types = plugin.registerAgentTypes();
      expect(types).toHaveLength(1);
    });

    it('should define federation-coordinator type', () => {
      const types = plugin.registerAgentTypes();
      expect(types[0]!.type).toBe('federation-coordinator');
    });

    it('should have a non-empty name', () => {
      const types = plugin.registerAgentTypes();
      expect(types[0]!.name.length).toBeGreaterThan(0);
    });

    it('should have a non-empty description', () => {
      const types = plugin.registerAgentTypes();
      expect(types[0]!.description.length).toBeGreaterThan(0);
    });

    it('should have a defaultConfig with expected structure', () => {
      const types = plugin.registerAgentTypes();
      const config = types[0]!.defaultConfig;
      expect(config).toBeDefined();
      expect(config.type).toBe('coordinator');
      expect(config.name).toBe('federation-coordinator');
      expect(Array.isArray(config.capabilities)).toBe(true);
      expect(config.capabilities.length).toBeGreaterThan(0);
    });

    it('should declare requiredCapabilities', () => {
      const types = plugin.registerAgentTypes();
      expect(types[0]!.requiredCapabilities).toBeDefined();
      expect(types[0]!.requiredCapabilities).toContain('federation:discover');
      expect(types[0]!.requiredCapabilities).toContain('federation:connect');
    });
  });

  describe('healthCheck', () => {
    it('should return false before initialization (no coordinator)', async () => {
      const healthy = await plugin.healthCheck();
      expect(healthy).toBe(false);
    });

    it('should return false after plugin.initialize because coordinator.initialize is not called', async () => {
      // The plugin creates the coordinator but does not call coordinator.initialize(),
      // so coordinator.getStatus().healthy is false (coordinator.initialized is false).
      await plugin.initialize(context as any);
      const healthy = await plugin.healthCheck();
      expect(healthy).toBe(false);
    });

    it('should return false after shutdown (coordinator is null)', async () => {
      await plugin.initialize(context as any);
      await plugin.shutdown();
      const healthy = await plugin.healthCheck();
      expect(healthy).toBe(false);
    });
  });
});
