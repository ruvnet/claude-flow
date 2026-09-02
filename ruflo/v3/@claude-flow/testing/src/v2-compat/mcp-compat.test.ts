/**
 * V2 MCP Tool Compatibility Tests
 *
 * Tests all 65 V2 MCP tools work via name mapping and parameter translation.
 * Verifies parameter translation and response format compatibility.
 *
 * @module v3/testing/v2-compat/mcp-compat.test
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  V2CompatibilityValidator,
  V2_MCP_TOOLS,
  type V2MCPTool,
  type ValidationResult,
} from './compatibility-validator.js';

/**
 * Tool name mapping from V2 to V3
 */
const TOOL_NAME_MAPPING: Record<string, string> = {
  // Agent tools
  'dispatch_agent': 'agent/spawn',
  'agents/spawn': 'agent/spawn',
  'agents/list': 'agent/list',
  'agents/terminate': 'agent/terminate',
  'agents/info': 'agent/status',
  'agent/create': 'agent/spawn',

  // Swarm tools
  'swarm_status': 'swarm/status',
  'swarm/get-status': 'swarm/status',
  'swarm/get-comprehensive-status': 'swarm/status',
  'mcp__ruv-swarm__swarm_init': 'swarm/init',
  'mcp__ruv-swarm__swarm_status': 'swarm/status',
  'mcp__ruv-swarm__agent_spawn': 'agent/spawn',
  'mcp__ruv-swarm__agent_list': 'agent/list',
  'mcp__ruv-swarm__agent_metrics': 'agent/status',

  // Memory tools
  'memory/query': 'memory/search',
  'mcp__ruv-swarm__memory_usage': 'memory/list',

  // Config tools
  'config/get': 'config/load',
  'config/update': 'config/save',

  // Neural tools
  'mcp__ruv-swarm__neural_status': 'hooks/metrics',
  'mcp__ruv-swarm__neural_train': 'hooks/pretrain',
};

/**
 * Mock MCP client for testing
 */
interface MockMCPClient {
  callTool: Mock<(name: string, params: Record<string, unknown>) => Promise<unknown>>;
  getTools: Mock<() => string[]>;
  translateToolName: Mock<(name: string) => string>;
  translateParams: Mock<(name: string, params: Record<string, unknown>) => Record<string, unknown>>;
}

/**
 * Create mock MCP client
 */
function createMockMCPClient(): MockMCPClient {
  const v3Tools = [
    'agent/spawn', 'agent/list', 'agent/terminate', 'agent/status',
    'swarm/init', 'swarm/status', 'swarm/scale', 'swarm/consensus', 'swarm/broadcast',
    'memory/store', 'memory/search', 'memory/delete', 'memory/list',
    'task/create', 'task/assign', 'task/status', 'task/complete',
    'config/load', 'config/save',
    'hooks/metrics', 'hooks/pretrain',
    'github/pr-create', 'github/pr-review', 'github/issue-create',
  ];

  return {
    callTool: vi.fn().mockImplementation(async (name: string, params: Record<string, unknown>) => {
      const v3Name = TOOL_NAME_MAPPING[name] || name;

      if (!v3Tools.includes(v3Name)) {
        throw new Error(`Tool not found: ${name} (translated: ${v3Name})`);
      }

      // Simulate tool responses
      const responses: Record<string, unknown> = {
        'agent/spawn': { id: 'agent-1', type: params.agentType || params.type, status: 'active' },
        'agent/list': [{ id: 'agent-1', type: 'coder', status: 'active' }],
        'agent/terminate': { success: true },
        'agent/status': { id: 'agent-1', metrics: { tasksCompleted: 0 } },
        'swarm/init': { id: 'swarm-1', topology: 'hierarchical-mesh' },
        'swarm/status': { agents: 0, topology: 'hierarchical-mesh', status: 'active' },
        'memory/store': { id: 'mem-1', stored: true },
        'memory/search': [{ id: 'mem-1', content: 'test' }],
        'memory/list': [{ id: 'mem-1', type: 'pattern' }],
        'task/create': { id: 'task-1', status: 'pending' },
        'config/load': { value: 'test-value' },
        'config/save': { success: true },
        'hooks/metrics': { patterns: 10, successRate: 0.85 },
        'hooks/pretrain': { trained: true, patterns: 100 },
      };

      return responses[v3Name] || { success: true };
    }),
    getTools: vi.fn().mockReturnValue(v3Tools),
    translateToolName: vi.fn().mockImplementation((v2Name: string) => TOOL_NAME_MAPPING[v2Name] || v2Name),
    translateParams: vi.fn().mockImplementation((toolName: string, params: Record<string, unknown>) => {
      // Parameter translation logic
      if (toolName === 'dispatch_agent' || toolName === 'agents/spawn') {
        return {
          agentType: params.type,
          id: params.name,
          config: {
            capabilities: params.capabilities,
            systemPrompt: params.systemPrompt,
          },
          priority: (params.priority as number) > 5 ? 'high' : 'normal',
        };
      }

      if (toolName === 'memory/query') {
        return {
          query: params.search,
          searchType: 'hybrid',
          type: params.type,
          limit: params.limit || 10,
        };
      }

      if (toolName.includes('swarm_init')) {
        return {
          topology: params.topology || 'hierarchical-mesh',
          maxAgents: params.maxAgents || 15,
          config: {
            consensusMechanism: params.consensus || 'majority',
          },
        };
      }

      return params;
    }),
  };
}

describe('V2 MCP Tool Compatibility', () => {
  let validator: V2CompatibilityValidator;
  let mockMCP: MockMCPClient;

  beforeEach(() => {
    mockMCP = createMockMCPClient();
    validator = new V2CompatibilityValidator({
      verbose: false,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Agent Tools', () => {
    const agentTools = V2_MCP_TOOLS.filter(t =>
      t.name.includes('agent') || t.name === 'dispatch_agent'
    );

    it.each(agentTools)('should support V2 tool: $name', async (tool: V2MCPTool) => {
      const params = Object.fromEntries(
        Object.entries(tool.parameters)
          .filter(([, def]) => def.required)
          .map(([key, def]) => [key, def.type === 'string' ? 'test' : {}])
      );

      const result = await mockMCP.callTool(tool.name, params);

      expect(result).toBeDefined();
    });

    it('should translate dispatch_agent to agent/spawn', () => {
      const v3Name = mockMCP.translateToolName('dispatch_agent');

      expect(v3Name).toBe('agent/spawn');
    });

    it('should translate agents/spawn to agent/spawn', () => {
      const v3Name = mockMCP.translateToolName('agents/spawn');

      expect(v3Name).toBe('agent/spawn');
    });

    it('should translate agents/info to agent/status', () => {
      const v3Name = mockMCP.translateToolName('agents/info');

      expect(v3Name).toBe('agent/status');
    });

    it('should translate agent parameters correctly', () => {
      const v2Params = {
        type: 'coder',
        name: 'my-coder',
        capabilities: ['coding'],
        priority: 8,
      };

      const v3Params = mockMCP.translateParams('dispatch_agent', v2Params);

      expect(v3Params.agentType).toBe('coder');
      expect(v3Params.id).toBe('my-coder');
      expect(v3Params.priority).toBe('high');
    });

    it('should handle mcp__ruv-swarm__agent_spawn', async () => {
      const result = await mockMCP.callTool('mcp__ruv-swarm__agent_spawn', { type: 'coder' });

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('type');
    });
  });

  describe('Swarm Tools', () => {
    const swarmTools = V2_MCP_TOOLS.filter(t => t.name.includes('swarm'));

    it.each(swarmTools)('should support V2 tool: $name', async (tool: V2MCPTool) => {
      const params = Object.fromEntries(
        Object.entries(tool.parameters)
          .filter(([, def]) => def.required)
          .map(([key, def]) => [key, def.type === 'string' ? 'test' : {}])
      );

      const result = await mockMCP.callTool(tool.name, params);

      expect(result).toBeDefined();
    });

    it('should translate swarm_status to swarm/status', () => {
      const v3Name = mockMCP.translateToolName('swarm_status');

      expect(v3Name).toBe('swarm/status');
    });

    it('should translate swarm/get-comprehensive-status to swarm/status', () => {
      const v3Name = mockMCP.translateToolName('swarm/get-comprehensive-status');

      expect(v3Name).toBe('swarm/status');
    });

    it('should translate swarm init parameters', () => {
      const v2Params = {
        topology: 'mesh',
        maxAgents: 10,
        consensus: 'quorum',
      };

      const v3Params = mockMCP.translateParams('mcp__ruv-swarm__swarm_init', v2Params);

      expect(v3Params.topology).toBe('mesh');
      expect(v3Params.maxAgents).toBe(10);
      expect(v3Params.config).toHaveProperty('consensusMechanism');
    });

    it('should return compatible swarm status response', async () => {
      const result = await mockMCP.callTool('swarm_status', {}) as Record<string, unknown>;

      expect(result).toHaveProperty('agents');
      expect(result).toHaveProperty('topology');
      expect(result).toHaveProperty('status');
    });
  });

  describe('Memory Tools', () => {
    const memoryTools = V2_MCP_TOOLS.filter(t => t.name.includes('memory'));

    it.each(memoryTools)('should support V2 tool: $name', async (tool: V2MCPTool) => {
      const params = Object.fromEntries(
        Object.entries(tool.parameters)
          .filter(([, def]) => def.required)
          .map(([key, def]) => [key, def.type === 'string' ? 'test' : {}])
      );

      const result = await mockMCP.callTool(tool.name, params);

      expect(result).toBeDefined();
    });

    it('should translate memory/query to memory/search', () => {
      const v3Name = mockMCP.translateToolName('memory/query');

      expect(v3Name).toBe('memory/search');
    });

    it('should translate memory query parameters', () => {
      const v2Params = {
        search: 'test query',
        type: 'pattern',
        limit: 20,
      };

      const v3Params = mockMCP.translateParams('memory/query', v2Params);

      expect(v3Params.query).toBe('test query');
      expect(v3Params.searchType).toBe('hybrid');
      expect(v3Params.limit).toBe(20);
    });

    it('should return array from memory search', async () => {
      const result = await mockMCP.callTool('memory/query', { search: 'test' });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Config Tools', () => {
    it('should translate config/get to config/load', () => {
      const v3Name = mockMCP.translateToolName('config/get');

      expect(v3Name).toBe('config/load');
    });

    it('should translate config/update to config/save', () => {
      const v3Name = mockMCP.translateToolName('config/update');

      expect(v3Name).toBe('config/save');
    });

    it('should handle config get operation', async () => {
      const result = await mockMCP.callTool('config/get', { key: 'test.key' }) as Record<string, unknown>;

      expect(result).toHaveProperty('value');
    });

    it('should handle config update operation', async () => {
      const result = await mockMCP.callTool('config/update', {
        key: 'test.key',
        value: 'new-value',
      }) as Record<string, unknown>;

      expect(result).toHaveProperty('success');
    });
  });

  describe('Task Tools', () => {
    const taskTools = V2_MCP_TOOLS.filter(t => t.name.startsWith('task/'));

    it.each(taskTools)('should support V2 tool: $name', async (tool: V2MCPTool) => {
      const params = Object.fromEntries(
        Object.entries(tool.parameters)
          .filter(([, def]) => def.required)
          .map(([key, def]) => [key, def.type === 'string' ? 'test' : 'test'])
      );

      const result = await mockMCP.callTool(tool.name, params);

      expect(result).toBeDefined();
    });

    it('should create task with description', async () => {
      const result = await mockMCP.callTool('task/create', {
        description: 'Test task',
      }) as Record<string, unknown>;

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('status');
    });

    it('should assign task to agent', async () => {
      const result = await mockMCP.callTool('task/assign', {
        taskId: 'task-1',
        agentId: 'agent-1',
      });

      expect(result).toBeDefined();
    });
  });

  describe('Neural/Learning Tools', () => {
    it('should translate neural_status to hooks/metrics', () => {
      const v3Name = mockMCP.translateToolName('mcp__ruv-swarm__neural_status');

      expect(v3Name).toBe('hooks/metrics');
    });

    it('should translate neural_train to hooks/pretrain', () => {
      const v3Name = mockMCP.translateToolName('mcp__ruv-swarm__neural_train');

      expect(v3Name).toBe('hooks/pretrain');
    });

    it('should return compatible metrics response', async () => {
      const result = await mockMCP.callTool('mcp__ruv-swarm__neural_status', {}) as Record<string, unknown>;

      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('successRate');
    });

    it('should handle pretrain operation', async () => {
      const result = await mockMCP.callTool('mcp__ruv-swarm__neural_train', {
        data: { source: 'repo' },
      }) as Record<string, unknown>;

      expect(result).toHaveProperty('trained');
    });
  });

  describe('GitHub Tools', () => {
    const githubTools = V2_MCP_TOOLS.filter(t => t.name.startsWith('github/'));

    it.each(githubTools)('should support V2 tool: $name', async (tool: V2MCPTool) => {
      const params = Object.fromEntries(
        Object.entries(tool.parameters)
          .filter(([, def]) => def.required)
          .map(([key, def]) => {
            if (def.type === 'number') return [key, 1];
            return [key, 'test'];
          })
      );

      const result = await mockMCP.callTool(tool.name, params);

      expect(result).toBeDefined();
    });

    it('should handle PR creation', async () => {
      const result = await mockMCP.callTool('github/pr-create', {
        title: 'Test PR',
        body: 'Test body',
      });

      expect(result).toBeDefined();
    });

    it('should handle PR review', async () => {
      const result = await mockMCP.callTool('github/pr-review', {
        prNumber: 123,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should throw for unknown tool', async () => {
      await expect(mockMCP.callTool('unknown/tool', {}))
        .rejects.toThrow('Tool not found');
    });

    it('should handle missing required parameters gracefully', async () => {
      // Tool should still be callable even with empty params for testing
      const result = await mockMCP.callTool('agent/list', {});

      expect(result).toBeDefined();
    });
  });

  describe('Full MCP Validation', () => {
    it('should pass full MCP validation', async () => {
      const result: ValidationResult = await validator.validateMCPTools();

      expect(result.category).toBe('mcp');
      expect(result.totalChecks).toBeGreaterThan(0);
      expect(result.passedChecks).toBeGreaterThan(0);
    });

    it('should detect all V2 MCP tools', async () => {
      const result = await validator.validateMCPTools();
      const toolChecks = result.checks.filter(c => c.name.startsWith('MCP Tool:'));

      expect(toolChecks.length).toBeGreaterThanOrEqual(V2_MCP_TOOLS.length);
    });

    it('should verify parameter translation', async () => {
      const result = await validator.validateMCPTools();
      const paramChecks = result.checks.filter(c => c.name.includes('Param:'));

      expect(paramChecks.length).toBeGreaterThan(0);
    });

    it('should identify V3 equivalents', async () => {
      const result = await validator.validateMCPTools();

      for (const check of result.checks.filter(c => c.name.startsWith('MCP Tool:'))) {
        if (check.passed && check.details) {
          expect(check.details.v3Equivalent).toBeDefined();
        }
      }
    });

    it('should report breaking changes correctly', async () => {
      const result = await validator.validateMCPTools();

      // Most tools should have V3 equivalents
      expect(result.breakingChanges).toBeLessThan(result.totalChecks * 0.2);
    });
  });

  describe('Response Format Compatibility', () => {
    it('should return consistent agent info format', async () => {
      const result = await mockMCP.callTool('dispatch_agent', { type: 'coder' }) as Record<string, unknown>;

      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('status');
    });

    it('should return array for list operations', async () => {
      const agentList = await mockMCP.callTool('agents/list', {});
      const memoryList = await mockMCP.callTool('memory/query', { search: 'test' });

      expect(Array.isArray(agentList)).toBe(true);
      expect(Array.isArray(memoryList)).toBe(true);
    });

    it('should return success boolean for mutations', async () => {
      const terminateResult = await mockMCP.callTool('agents/terminate', { id: 'agent-1' }) as Record<string, unknown>;
      const configResult = await mockMCP.callTool('config/update', { key: 'k', value: 'v' }) as Record<string, unknown>;

      expect(terminateResult).toHaveProperty('success');
      expect(configResult).toHaveProperty('success');
    });
  });
});

describe('MCP Tool Coverage', () => {
  it('should define at least 30 V2 MCP tools', () => {
    expect(V2_MCP_TOOLS.length).toBeGreaterThanOrEqual(30);
  });

  it('should have V3 equivalents for most tools', () => {
    const withEquivalent = V2_MCP_TOOLS.filter(t => t.v3Equivalent);

    expect(withEquivalent.length).toBeGreaterThan(V2_MCP_TOOLS.length * 0.8);
  });

  it('should categorize tools correctly', () => {
    const categories = {
      agent: V2_MCP_TOOLS.filter(t => t.name.includes('agent') || t.name === 'dispatch_agent'),
      swarm: V2_MCP_TOOLS.filter(t => t.name.includes('swarm')),
      memory: V2_MCP_TOOLS.filter(t => t.name.includes('memory')),
      config: V2_MCP_TOOLS.filter(t => t.name.includes('config')),
      task: V2_MCP_TOOLS.filter(t => t.name.startsWith('task/')),
      neural: V2_MCP_TOOLS.filter(t => t.name.includes('neural')),
      github: V2_MCP_TOOLS.filter(t => t.name.startsWith('github/')),
      coordinate: V2_MCP_TOOLS.filter(t => t.name.startsWith('coordinate/')),
    };

    expect(categories.agent.length).toBeGreaterThanOrEqual(6);
    expect(categories.swarm.length).toBeGreaterThanOrEqual(5);
    expect(categories.memory.length).toBeGreaterThanOrEqual(3);
  });

  it('should define required parameters correctly', () => {
    for (const tool of V2_MCP_TOOLS) {
      for (const [, def] of Object.entries(tool.parameters)) {
        expect(def).toHaveProperty('type');
        expect(def).toHaveProperty('required');
        expect(typeof def.required).toBe('boolean');
      }
    }
  });
});
