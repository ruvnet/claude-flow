import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MCPServer } from '../../src/infrastructure/mcp/MCPServer';
import { AgentTools } from '../../src/infrastructure/mcp/tools/AgentTools';
import { MemoryTools } from '../../src/infrastructure/mcp/tools/MemoryTools';
import { ConfigTools } from '../../src/infrastructure/mcp/tools/ConfigTools';
import { SwarmCoordinator } from '../../src/coordination/application/SwarmCoordinator';
import { HybridBackend } from '../../src/memory/infrastructure/HybridBackend';

describe('MCP Tools Integration Tests', () => {
  let mcpServer: MCPServer;
  let agentTools: AgentTools;
  let memoryTools: MemoryTools;
  let configTools: ConfigTools;
  let coordinator: SwarmCoordinator;
  let memoryBackend: HybridBackend;

  beforeEach(async () => {
    memoryBackend = {
      store: vi.fn(),
      retrieve: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      vectorSearch: vi.fn().mockResolvedValue([]),
      initialize: vi.fn(),
      close: vi.fn()
    } as any;

    coordinator = {
      spawnAgent: vi.fn(),
      listAgents: vi.fn().mockResolvedValue([]),
      terminateAgent: vi.fn(),
      getAgentMetrics: vi.fn(),
      initialize: vi.fn(),
      shutdown: vi.fn()
    } as any;

    agentTools = new AgentTools(coordinator);
    memoryTools = new MemoryTools(memoryBackend);
    configTools = new ConfigTools();

    mcpServer = new MCPServer({
      tools: [agentTools, memoryTools, configTools]
    });

    await mcpServer.start();
  });

  afterEach(async () => {
    await mcpServer.stop();
  });

  it('should spawn agent via MCP agent tools', async () => {
    const mockAgent = {
      id: 'mcp-agent-1',
      type: 'coder',
      status: 'active',
      capabilities: ['code', 'refactor']
    };

    (coordinator.spawnAgent as any).mockResolvedValue(mockAgent);

    const result = await agentTools.execute('agent_spawn', {
      id: 'mcp-agent-1',
      type: 'coder',
      capabilities: ['code', 'refactor']
    });

    expect(result.success).toBe(true);
    expect(result.agent.id).toBe('mcp-agent-1');
    expect(coordinator.spawnAgent).toHaveBeenCalledWith({
      id: 'mcp-agent-1',
      type: 'coder',
      capabilities: ['code', 'refactor']
    });
  });

  it('should list agents via MCP agent tools', async () => {
    const mockAgents = [
      { id: 'agent-1', type: 'coder', status: 'active' },
      { id: 'agent-2', type: 'tester', status: 'active' },
      { id: 'agent-3', type: 'reviewer', status: 'idle' }
    ];

    (coordinator.listAgents as any).mockResolvedValue(mockAgents);

    const result = await agentTools.execute('agent_list', {});

    expect(result.success).toBe(true);
    expect(result.agents).toHaveLength(3);
    expect(result.agents[0].id).toBe('agent-1');
  });

  it('should terminate agent via MCP agent tools', async () => {
    (coordinator.terminateAgent as any).mockResolvedValue({ success: true });

    const result = await agentTools.execute('agent_terminate', {
      agentId: 'agent-to-kill'
    });

    expect(result.success).toBe(true);
    expect(coordinator.terminateAgent).toHaveBeenCalledWith('agent-to-kill');
  });

  it('should get agent metrics via MCP agent tools', async () => {
    const mockMetrics = {
      agentId: 'metrics-agent',
      tasksCompleted: 10,
      averageExecutionTime: 250,
      successRate: 0.95,
      health: 'healthy'
    };

    (coordinator.getAgentMetrics as any).mockResolvedValue(mockMetrics);

    const result = await agentTools.execute('agent_metrics', {
      agentId: 'metrics-agent'
    });

    expect(result.success).toBe(true);
    expect(result.metrics.tasksCompleted).toBe(10);
    expect(result.metrics.successRate).toBe(0.95);
  });

  it('should store memory via MCP memory tools', async () => {
    const memory = {
      id: 'mcp-mem-1',
      agentId: 'agent-1',
      content: 'Test memory from MCP',
      type: 'task',
      timestamp: Date.now()
    };

    (memoryBackend.store as any).mockResolvedValue(memory);

    const result = await memoryTools.execute('memory_store', memory);

    expect(result.success).toBe(true);
    expect(memoryBackend.store).toHaveBeenCalledWith(memory);
  });

  it('should search memory via MCP memory tools', async () => {
    const mockMemories = [
      { id: '1', agentId: 'agent-1', content: 'Memory 1', type: 'task', timestamp: Date.now() },
      { id: '2', agentId: 'agent-1', content: 'Memory 2', type: 'context', timestamp: Date.now() }
    ];

    (memoryBackend.query as any).mockResolvedValue(mockMemories);

    const result = await memoryTools.execute('memory_search', {
      agentId: 'agent-1',
      type: 'task'
    });

    expect(result.success).toBe(true);
    expect(result.memories).toHaveLength(2);
    expect(memoryBackend.query).toHaveBeenCalledWith({
      agentId: 'agent-1',
      type: 'task'
    });
  });

  it('should perform vector search via MCP memory tools', async () => {
    const mockResults = [
      {
        id: 'vec-1',
        agentId: 'agent-1',
        content: 'Similar content',
        similarity: 0.95,
        timestamp: Date.now()
      },
      {
        id: 'vec-2',
        agentId: 'agent-1',
        content: 'Another similar',
        similarity: 0.87,
        timestamp: Date.now()
      }
    ];

    (memoryBackend.vectorSearch as any).mockResolvedValue(mockResults);

    const queryEmbedding = new Array(384).fill(0).map(() => Math.random());

    const result = await memoryTools.execute('memory_vector_search', {
      embedding: queryEmbedding,
      k: 5
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].similarity).toBeGreaterThan(0.9);
  });

  it('should load config via MCP config tools', async () => {
    const mockConfig = {
      swarm: {
        topology: 'hierarchical',
        maxAgents: 10
      },
      memory: {
        backend: 'hybrid',
        ttl: 3600000
      },
      performance: {
        flashAttention: true,
        targetSpeedup: '2.49x-7.47x'
      }
    };

    vi.spyOn(configTools, 'loadConfig').mockResolvedValue(mockConfig);

    const result = await configTools.execute('config_load', {
      path: './config/v3.json'
    });

    expect(result.success).toBe(true);
    expect(result.config.swarm.topology).toBe('hierarchical');
    expect(result.config.performance.flashAttention).toBe(true);
  });

  it('should save config via MCP config tools', async () => {
    const config = {
      swarm: { topology: 'mesh' },
      memory: { backend: 'agentdb' }
    };

    vi.spyOn(configTools, 'saveConfig').mockResolvedValue({ success: true });

    const result = await configTools.execute('config_save', {
      path: './config/custom.json',
      config
    });

    expect(result.success).toBe(true);
  });

  it('should validate config via MCP config tools', async () => {
    const invalidConfig = {
      swarm: { topology: 'invalid-topology' },
      memory: { backend: 'unknown' }
    };

    const result = await configTools.execute('config_validate', {
      config: invalidConfig
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle MCP tool execution errors gracefully', async () => {
    (coordinator.spawnAgent as any).mockRejectedValue(new Error('Spawn failed'));

    const result = await agentTools.execute('agent_spawn', {
      id: 'failing-agent',
      type: 'coder'
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Spawn failed');
  });

  it('should support chained MCP tool operations', async () => {
    // Spawn agent
    const mockAgent = { id: 'chain-agent', type: 'coder', status: 'active' };
    (coordinator.spawnAgent as any).mockResolvedValue(mockAgent);

    const spawnResult = await agentTools.execute('agent_spawn', {
      id: 'chain-agent',
      type: 'coder'
    });

    expect(spawnResult.success).toBe(true);

    // Store memory for the agent
    const memory = {
      id: 'chain-mem',
      agentId: 'chain-agent',
      content: 'Agent spawned',
      type: 'event',
      timestamp: Date.now()
    };

    (memoryBackend.store as any).mockResolvedValue(memory);

    const storeResult = await memoryTools.execute('memory_store', memory);

    expect(storeResult.success).toBe(true);

    // Retrieve memories
    (memoryBackend.query as any).mockResolvedValue([memory]);

    const searchResult = await memoryTools.execute('memory_search', {
      agentId: 'chain-agent'
    });

    expect(searchResult.success).toBe(true);
    expect(searchResult.memories).toHaveLength(1);
  });

  it('should handle concurrent MCP tool requests', async () => {
    const mockAgents = Array.from({ length: 5 }, (_, i) => ({
      id: `concurrent-agent-${i}`,
      type: 'coder',
      status: 'active'
    }));

    (coordinator.spawnAgent as any).mockImplementation(async (config) => ({
      id: config.id,
      type: config.type,
      status: 'active'
    }));

    const requests = mockAgents.map(agent =>
      agentTools.execute('agent_spawn', {
        id: agent.id,
        type: agent.type
      })
    );

    const results = await Promise.all(requests);

    expect(results).toHaveLength(5);
    expect(results.every(r => r.success)).toBe(true);
  });

  it('should provide MCP tool introspection', async () => {
    const tools = mcpServer.listTools();

    expect(tools.length).toBeGreaterThan(0);

    const agentSpawnTool = tools.find(t => t.name === 'agent_spawn');
    expect(agentSpawnTool).toBeDefined();
    expect(agentSpawnTool?.parameters).toBeDefined();
    expect(agentSpawnTool?.description).toBeDefined();

    const memoryStoreTool = tools.find(t => t.name === 'memory_store');
    expect(memoryStoreTool).toBeDefined();

    const configLoadTool = tools.find(t => t.name === 'config_load');
    expect(configLoadTool).toBeDefined();
  });

  it('should support MCP tool parameter validation', async () => {
    const invalidParams = {
      id: '', // Invalid: empty ID
      type: 'invalid-type', // Invalid: unknown type
      capabilities: 'not-an-array' // Invalid: should be array
    };

    const result = await agentTools.execute('agent_spawn', invalidParams as any);

    expect(result.success).toBe(false);
    expect(result.error).toContain('validation');
  });

  it('should integrate all MCP tools in workflow', async () => {
    // 1. Load configuration
    const mockConfig = {
      swarm: { topology: 'hierarchical', maxAgents: 5 },
      memory: { backend: 'hybrid' }
    };
    vi.spyOn(configTools, 'loadConfig').mockResolvedValue(mockConfig);

    const configResult = await configTools.execute('config_load', {
      path: './config/v3.json'
    });
    expect(configResult.success).toBe(true);

    // 2. Spawn agents based on config
    (coordinator.spawnAgent as any).mockImplementation(async (config) => ({
      id: config.id,
      type: config.type,
      status: 'active'
    }));

    const agentResult = await agentTools.execute('agent_spawn', {
      id: 'workflow-agent',
      type: 'coder'
    });
    expect(agentResult.success).toBe(true);

    // 3. Store agent spawn event in memory
    (memoryBackend.store as any).mockResolvedValue({
      id: 'event-1',
      agentId: 'workflow-agent',
      content: 'Agent spawned',
      type: 'event',
      timestamp: Date.now()
    });

    const memoryResult = await memoryTools.execute('memory_store', {
      id: 'event-1',
      agentId: 'workflow-agent',
      content: 'Agent spawned',
      type: 'event',
      timestamp: Date.now()
    });
    expect(memoryResult.success).toBe(true);

    // 4. Retrieve agent metrics
    (coordinator.getAgentMetrics as any).mockResolvedValue({
      agentId: 'workflow-agent',
      tasksCompleted: 0,
      successRate: 1.0,
      health: 'healthy'
    });

    const metricsResult = await agentTools.execute('agent_metrics', {
      agentId: 'workflow-agent'
    });
    expect(metricsResult.success).toBe(true);

    // Verify complete workflow
    expect(configResult.config).toBeDefined();
    expect(agentResult.agent).toBeDefined();
    expect(memoryResult.success).toBe(true);
    expect(metricsResult.metrics).toBeDefined();
  });
});
