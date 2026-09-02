/**
 * @claude-flow/testing - MCP Fixtures
 *
 * Comprehensive mock MCP tools, contexts, and server configurations for testing.
 * Supports all MCP protocol operations and Claude-Flow tool integrations.
 *
 * Based on ADR-005 (MCP-first API design) and V3 specifications.
 */
import { vi, type Mock } from 'vitest';

/**
 * MCP transport types
 */
export type MCPTransportType = 'stdio' | 'http' | 'websocket';

/**
 * MCP content types
 */
export type MCPContentType = 'text' | 'image' | 'resource';

/**
 * MCP input schema type (JSON Schema subset)
 */
export interface MCPInputSchema {
  type: 'object';
  properties: Record<string, MCPPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * MCP property schema
 */
export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: MCPPropertySchema;
  properties?: Record<string, MCPPropertySchema>;
  required?: string[];
}

/**
 * MCP tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPInputSchema;
  handler?: (params: Record<string, unknown>) => Promise<MCPToolResult>;
}

/**
 * MCP tool result
 */
export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

/**
 * MCP content (text, image, or resource)
 */
export type MCPContent = MCPTextContent | MCPImageContent | MCPResourceContent;

/**
 * MCP text content
 */
export interface MCPTextContent {
  type: 'text';
  text: string;
}

/**
 * MCP image content
 */
export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/**
 * MCP resource content
 */
export interface MCPResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  name: string;
  version: string;
  transport: MCPTransportConfig;
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
  capabilities?: MCPCapabilities;
}

/**
 * MCP transport configuration
 */
export interface MCPTransportConfig {
  type: MCPTransportType;
  port?: number;
  host?: string;
  path?: string;
  timeout?: number;
}

/**
 * MCP resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * MCP prompt definition
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

/**
 * MCP prompt argument
 */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * MCP capabilities
 */
export interface MCPCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
  experimental?: Record<string, boolean>;
}

/**
 * MCP request base
 */
export interface MCPRequestBase {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP response base
 */
export interface MCPResponseBase<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: MCPError;
}

/**
 * MCP error
 */
export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * MCP server status
 */
export interface MCPServerStatus {
  running: boolean;
  transport: MCPTransportType;
  connectedClients: number;
  toolsRegistered: number;
  resourcesRegistered: number;
  promptsRegistered: number;
  requestsHandled: number;
  errorsCount: number;
  uptime: number;
}

/**
 * MCP session context
 */
export interface MCPSessionContext {
  sessionId: string;
  clientInfo: {
    name: string;
    version: string;
  };
  capabilities: MCPCapabilities;
  startedAt: Date;
  lastActivity: Date;
  requestCount: number;
}

/**
 * Pre-defined MCP tools for Claude-Flow
 */
export const mcpTools: Record<string, MCPTool> = {
  // Swarm management tools
  swarmInit: {
    name: 'swarm_init',
    description: 'Initialize a new swarm with specified topology and configuration',
    inputSchema: {
      type: 'object',
      properties: {
        topology: {
          type: 'string',
          description: 'Swarm topology (hierarchical, mesh, adaptive, hierarchical-mesh)',
          enum: ['hierarchical', 'mesh', 'ring', 'star', 'adaptive', 'hierarchical-mesh'],
        },
        maxAgents: {
          type: 'number',
          description: 'Maximum number of agents in the swarm',
          default: 15,
        },
        consensusProtocol: {
          type: 'string',
          description: 'Consensus protocol to use',
          enum: ['raft', 'pbft', 'gossip', 'byzantine'],
        },
      },
      required: ['topology'],
    },
  },

  agentSpawn: {
    name: 'agent_spawn',
    description: 'Spawn a new agent with specified type and configuration',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Agent type (queen-coordinator, coder, tester, etc.)',
        },
        name: {
          type: 'string',
          description: 'Agent name',
        },
        capabilities: {
          type: 'array',
          description: 'Agent capabilities',
          items: { type: 'string' },
        },
        priority: {
          type: 'number',
          description: 'Agent priority (0-100)',
          default: 50,
        },
      },
      required: ['type'],
    },
  },

  taskOrchestrate: {
    name: 'task_orchestrate',
    description: 'Orchestrate a task across multiple agents',
    inputSchema: {
      type: 'object',
      properties: {
        taskName: {
          type: 'string',
          description: 'Name of the task',
        },
        taskType: {
          type: 'string',
          description: 'Type of task (security, coding, testing, review)',
        },
        payload: {
          type: 'object',
          description: 'Task payload',
        },
        agents: {
          type: 'array',
          description: 'List of agent IDs to coordinate',
          items: { type: 'string' },
        },
        parallel: {
          type: 'boolean',
          description: 'Execute tasks in parallel',
          default: true,
        },
      },
      required: ['taskName', 'taskType'],
    },
  },

  // Memory tools
  memoryStore: {
    name: 'memory_store',
    description: 'Store a value in memory with optional embedding',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Memory key',
        },
        value: {
          type: 'object',
          description: 'Value to store',
        },
        type: {
          type: 'string',
          description: 'Memory type',
          enum: ['short-term', 'long-term', 'semantic', 'episodic'],
        },
        ttl: {
          type: 'number',
          description: 'Time-to-live in milliseconds',
        },
        generateEmbedding: {
          type: 'boolean',
          description: 'Generate vector embedding for semantic search',
          default: false,
        },
      },
      required: ['key', 'value'],
    },
  },

  memorySearch: {
    name: 'memory_search',
    description: 'Search memory using semantic vector search',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        topK: {
          type: 'number',
          description: 'Number of results to return',
          default: 10,
        },
        threshold: {
          type: 'number',
          description: 'Minimum similarity threshold (0-1)',
          default: 0.7,
        },
        filters: {
          type: 'object',
          description: 'Additional filters',
        },
      },
      required: ['query'],
    },
  },

  // Status tools
  swarmStatus: {
    name: 'swarm_status',
    description: 'Get current swarm status and metrics',
    inputSchema: {
      type: 'object',
      properties: {
        includeMetrics: {
          type: 'boolean',
          description: 'Include detailed metrics',
          default: true,
        },
        includeAgents: {
          type: 'boolean',
          description: 'Include agent details',
          default: false,
        },
      },
    },
  },

  agentList: {
    name: 'agent_list',
    description: 'List all agents in the swarm',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by agent status',
          enum: ['idle', 'busy', 'terminated', 'error', 'all'],
        },
        type: {
          type: 'string',
          description: 'Filter by agent type',
        },
      },
    },
  },

  agentMetrics: {
    name: 'agent_metrics',
    description: 'Get metrics for a specific agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Agent ID',
        },
      },
      required: ['agentId'],
    },
  },

  // Neural/Learning tools
  neuralStatus: {
    name: 'neural_status',
    description: 'Get neural learning system status',
    inputSchema: {
      type: 'object',
      properties: {
        includePatterns: {
          type: 'boolean',
          description: 'Include learned patterns summary',
          default: false,
        },
      },
    },
  },

  neuralTrain: {
    name: 'neural_train',
    description: 'Trigger neural training with current data',
    inputSchema: {
      type: 'object',
      properties: {
        algorithm: {
          type: 'string',
          description: 'Training algorithm',
          enum: ['ppo', 'dqn', 'a2c', 'sarsa', 'q-learning'],
        },
        epochs: {
          type: 'number',
          description: 'Number of training epochs',
          default: 10,
        },
      },
    },
  },

  // GitHub integration tools
  githubSwarm: {
    name: 'github_swarm',
    description: 'Initialize GitHub integration for a repository',
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format',
        },
        features: {
          type: 'array',
          description: 'Features to enable',
          items: { type: 'string' },
          default: ['issues', 'prs', 'reviews'],
        },
      },
      required: ['repo'],
    },
  },

  codeReview: {
    name: 'code_review',
    description: 'Request code review from swarm agents',
    inputSchema: {
      type: 'object',
      properties: {
        prNumber: {
          type: 'number',
          description: 'Pull request number',
        },
        repo: {
          type: 'string',
          description: 'Repository in owner/repo format',
        },
        focus: {
          type: 'array',
          description: 'Review focus areas',
          items: { type: 'string' },
          default: ['security', 'performance', 'style'],
        },
      },
      required: ['prNumber', 'repo'],
    },
  },
};

/**
 * Pre-defined MCP resources
 */
export const mcpResources: Record<string, MCPResource> = {
  swarmConfig: {
    uri: 'claude-flow://config/swarm',
    name: 'Swarm Configuration',
    description: 'Current swarm configuration',
    mimeType: 'application/json',
  },

  agentRegistry: {
    uri: 'claude-flow://agents/registry',
    name: 'Agent Registry',
    description: 'Registry of all available agent types',
    mimeType: 'application/json',
  },

  memoryStats: {
    uri: 'claude-flow://memory/stats',
    name: 'Memory Statistics',
    description: 'Memory system statistics and metrics',
    mimeType: 'application/json',
  },

  learningPatterns: {
    uri: 'claude-flow://neural/patterns',
    name: 'Learning Patterns',
    description: 'Learned patterns from ReasoningBank',
    mimeType: 'application/json',
  },
};

/**
 * Pre-defined MCP prompts
 */
export const mcpPrompts: Record<string, MCPPrompt> = {
  codeAnalysis: {
    name: 'analyze_code',
    description: 'Analyze code for security, performance, and style issues',
    arguments: [
      { name: 'language', description: 'Programming language', required: true },
      { name: 'focus', description: 'Analysis focus area', required: false },
    ],
  },

  taskPlanning: {
    name: 'plan_task',
    description: 'Generate a task execution plan',
    arguments: [
      { name: 'objective', description: 'Task objective', required: true },
      { name: 'constraints', description: 'Task constraints', required: false },
    ],
  },

  securityReview: {
    name: 'security_review',
    description: 'Perform security review on code or configuration',
    arguments: [
      { name: 'target', description: 'Review target (file, directory, config)', required: true },
      { name: 'severity', description: 'Minimum severity level', required: false },
    ],
  },
};

/**
 * Pre-defined MCP server configurations
 */
export const mcpServerConfigs: Record<string, MCPServerConfig> = {
  development: {
    name: 'claude-flow-dev',
    version: '3.0.0-alpha',
    transport: {
      type: 'http',
      port: 3000,
      host: 'localhost',
      timeout: 30000,
    },
    tools: Object.values(mcpTools),
    resources: Object.values(mcpResources),
    prompts: Object.values(mcpPrompts),
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
      logging: true,
      experimental: { streaming: true },
    },
  },

  production: {
    name: 'claude-flow',
    version: '3.0.0',
    transport: {
      type: 'http',
      port: 443,
      host: '0.0.0.0',
      timeout: 15000,
    },
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
      logging: false,
    },
  },

  stdio: {
    name: 'claude-flow-stdio',
    version: '3.0.0-alpha',
    transport: {
      type: 'stdio',
      timeout: 60000,
    },
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
      logging: true,
    },
  },

  websocket: {
    name: 'claude-flow-ws',
    version: '3.0.0-alpha',
    transport: {
      type: 'websocket',
      port: 8080,
      host: 'localhost',
      path: '/mcp',
      timeout: 30000,
    },
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
      logging: true,
      experimental: { streaming: true, multiplexing: true },
    },
  },
};

/**
 * Pre-defined MCP tool results
 */
export const mcpToolResults: Record<string, MCPToolResult> = {
  success: {
    content: [
      {
        type: 'text',
        text: 'Operation completed successfully',
      },
    ],
  },

  swarmInitialized: {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          swarmId: 'swarm-001',
          topology: 'hierarchical-mesh',
          status: 'active',
          agentCount: 15,
        }),
      },
    ],
  },

  agentSpawned: {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          agentId: 'agent-coder-001',
          type: 'coder',
          status: 'idle',
          capabilities: ['coding', 'implementation', 'debugging'],
        }),
      },
    ],
  },

  memorySearchResults: {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          results: [
            { key: 'pattern-001', score: 0.95 },
            { key: 'pattern-002', score: 0.88 },
          ],
          totalCount: 2,
          latencyMs: 15,
        }),
      },
    ],
  },

  error: {
    content: [
      {
        type: 'text',
        text: 'Operation failed: Invalid parameters',
      },
    ],
    isError: true,
  },
};

/**
 * Pre-defined MCP errors
 */
export const mcpErrors: Record<string, MCPError> = {
  parseError: {
    code: -32700,
    message: 'Parse error',
    data: { details: 'Invalid JSON received' },
  },

  invalidRequest: {
    code: -32600,
    message: 'Invalid request',
    data: { details: 'Missing required field' },
  },

  methodNotFound: {
    code: -32601,
    message: 'Method not found',
    data: { method: 'unknown_method' },
  },

  invalidParams: {
    code: -32602,
    message: 'Invalid params',
    data: { param: 'topology', expected: 'string' },
  },

  internalError: {
    code: -32603,
    message: 'Internal error',
    data: { details: 'Unexpected server error' },
  },

  toolNotFound: {
    code: -32001,
    message: 'Tool not found',
    data: { tool: 'unknown_tool' },
  },

  resourceNotFound: {
    code: -32002,
    message: 'Resource not found',
    data: { uri: 'unknown://resource' },
  },
};

/**
 * Pre-defined session contexts
 */
export const mcpSessionContexts: Record<string, MCPSessionContext> = {
  active: {
    sessionId: 'session-001',
    clientInfo: {
      name: 'claude-code',
      version: '1.0.0',
    },
    capabilities: {
      tools: true,
      resources: true,
      prompts: true,
    },
    startedAt: new Date('2024-01-15T10:00:00Z'),
    lastActivity: new Date(),
    requestCount: 42,
  },

  new: {
    sessionId: 'session-002',
    clientInfo: {
      name: 'test-client',
      version: '0.1.0',
    },
    capabilities: {
      tools: true,
    },
    startedAt: new Date(),
    lastActivity: new Date(),
    requestCount: 0,
  },

  expired: {
    sessionId: 'session-003',
    clientInfo: {
      name: 'old-client',
      version: '0.0.1',
    },
    capabilities: {},
    startedAt: new Date('2024-01-01T00:00:00Z'),
    lastActivity: new Date('2024-01-01T01:00:00Z'),
    requestCount: 5,
  },
};

/**
 * Factory function to create MCP tool
 */
export function createMCPTool(
  base: keyof typeof mcpTools,
  overrides?: Partial<MCPTool>
): MCPTool {
  return {
    ...mcpTools[base],
    ...overrides,
  };
}

/**
 * Factory function to create MCP server config
 */
export function createMCPServerConfig(
  base: keyof typeof mcpServerConfigs = 'development',
  overrides?: Partial<MCPServerConfig>
): MCPServerConfig {
  return {
    ...mcpServerConfigs[base],
    ...overrides,
  };
}

/**
 * Factory function to create MCP request
 */
export function createMCPRequest(
  method: string,
  params?: Record<string, unknown>,
  overrides?: Partial<MCPRequestBase>
): MCPRequestBase {
  return {
    jsonrpc: '2.0',
    id: `req-${Date.now()}`,
    method,
    params,
    ...overrides,
  };
}

/**
 * Factory function to create MCP response
 */
export function createMCPResponse<T>(
  id: string | number,
  result?: T,
  error?: MCPError
): MCPResponseBase<T> {
  return {
    jsonrpc: '2.0',
    id,
    result,
    error,
  };
}

/**
 * Factory function to create MCP tool result
 */
export function createMCPToolResult(
  text: string,
  isError: boolean = false
): MCPToolResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

/**
 * Factory function to create session context
 */
export function createMCPSessionContext(
  base: keyof typeof mcpSessionContexts = 'active',
  overrides?: Partial<MCPSessionContext>
): MCPSessionContext {
  return {
    ...mcpSessionContexts[base],
    ...overrides,
    sessionId: overrides?.sessionId ?? `session-${Date.now()}`,
    startedAt: overrides?.startedAt ?? new Date(),
    lastActivity: overrides?.lastActivity ?? new Date(),
  };
}

/**
 * Invalid MCP configurations for error testing
 */
export const invalidMCPConfigs = {
  emptyName: {
    ...mcpServerConfigs.development,
    name: '',
  },

  invalidPort: {
    ...mcpServerConfigs.development,
    transport: {
      type: 'http' as MCPTransportType,
      port: -1,
      host: 'localhost',
    },
  },

  missingTransport: {
    name: 'invalid-server',
    version: '1.0.0',
    transport: undefined as unknown as MCPTransportConfig,
  },
};

/**
 * Mock MCP client interface
 */
export interface MockMCPClient {
  connect: Mock<() => Promise<void>>;
  disconnect: Mock<() => Promise<void>>;
  callTool: Mock<(name: string, params: Record<string, unknown>) => Promise<MCPToolResult>>;
  listTools: Mock<() => Promise<MCPTool[]>>;
  readResource: Mock<(uri: string) => Promise<MCPResourceContent>>;
  listResources: Mock<() => Promise<MCPResource[]>>;
  getPrompt: Mock<(name: string, args: Record<string, string>) => Promise<string>>;
  listPrompts: Mock<() => Promise<MCPPrompt[]>>;
  isConnected: Mock<() => boolean>;
  getSessionContext: Mock<() => MCPSessionContext | null>;
}

/**
 * Create a mock MCP client
 */
export function createMockMCPClient(): MockMCPClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockResolvedValue(mcpToolResults.success),
    listTools: vi.fn().mockResolvedValue(Object.values(mcpTools)),
    readResource: vi.fn().mockResolvedValue({
      type: 'resource',
      resource: { uri: 'test://resource', text: '{}' },
    }),
    listResources: vi.fn().mockResolvedValue(Object.values(mcpResources)),
    getPrompt: vi.fn().mockResolvedValue('Generated prompt text'),
    listPrompts: vi.fn().mockResolvedValue(Object.values(mcpPrompts)),
    isConnected: vi.fn().mockReturnValue(true),
    getSessionContext: vi.fn().mockReturnValue(mcpSessionContexts.active),
  };
}

/**
 * Mock MCP server interface
 */
export interface MockMCPServer {
  start: Mock<() => Promise<void>>;
  stop: Mock<() => Promise<void>>;
  registerTool: Mock<(tool: MCPTool) => void>;
  registerResource: Mock<(resource: MCPResource) => void>;
  registerPrompt: Mock<(prompt: MCPPrompt) => void>;
  handleRequest: Mock<(request: MCPRequestBase) => Promise<MCPResponseBase>>;
  getStatus: Mock<() => MCPServerStatus>;
}

/**
 * Create a mock MCP server
 */
export function createMockMCPServer(): MockMCPServer {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    registerTool: vi.fn(),
    registerResource: vi.fn(),
    registerPrompt: vi.fn(),
    handleRequest: vi.fn().mockResolvedValue({
      jsonrpc: '2.0',
      id: 1,
      result: { success: true },
    }),
    getStatus: vi.fn().mockReturnValue({
      running: true,
      transport: 'http',
      connectedClients: 1,
      toolsRegistered: Object.keys(mcpTools).length,
      resourcesRegistered: Object.keys(mcpResources).length,
      promptsRegistered: Object.keys(mcpPrompts).length,
      requestsHandled: 100,
      errorsCount: 0,
      uptime: 3600000,
    }),
  };
}

/**
 * Mock transport interface
 */
export interface MockMCPTransport {
  send: Mock<(message: string) => Promise<void>>;
  receive: Mock<() => Promise<string>>;
  close: Mock<() => Promise<void>>;
  isOpen: Mock<() => boolean>;
}

/**
 * Create a mock MCP transport
 */
export function createMockMCPTransport(): MockMCPTransport {
  return {
    send: vi.fn().mockResolvedValue(undefined),
    receive: vi.fn().mockResolvedValue('{}'),
    close: vi.fn().mockResolvedValue(undefined),
    isOpen: vi.fn().mockReturnValue(true),
  };
}
