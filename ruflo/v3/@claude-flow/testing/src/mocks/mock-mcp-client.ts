/**
 * @claude-flow/testing - Mock MCP Client
 *
 * Comprehensive mock MCP client for testing CLI and server interactions.
 * Simulates full MCP protocol behavior with request/response tracking.
 */
import { vi, type Mock } from 'vitest';
import type {
  MCPTool,
  MCPToolResult,
  MCPResource,
  MCPPrompt,
  MCPServerConfig,
  MCPSessionContext,
  MCPError,
  MCPContent,
  mcpTools,
  mcpResources,
  mcpPrompts,
  mcpToolResults,
  mcpErrors,
} from '../fixtures/mcp-fixtures.js';

/**
 * Mock MCP Client with full protocol simulation
 */
export class MockMCPClient {
  private _connected = false;
  private _session: MCPSessionContext | null = null;
  private _tools = new Map<string, MCPTool>();
  private _resources = new Map<string, MCPResource>();
  private _prompts = new Map<string, MCPPrompt>();
  private _requestHistory: MCPRequest[] = [];
  private _responseHistory: MCPResponse[] = [];
  private _toolHandlers = new Map<string, ToolHandler>();
  private _errorSimulation: ErrorSimulation | null = null;
  private _latencySimulation = 0;

  // Mock methods for verification
  connect = vi.fn(async () => {
    if (this._errorSimulation?.onConnect) {
      throw new Error(this._errorSimulation.onConnect);
    }

    await this.simulateLatency();

    this._connected = true;
    this._session = {
      sessionId: `session-${Date.now()}`,
      clientInfo: {
        name: 'mock-client',
        version: '1.0.0',
      },
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
      },
      startedAt: new Date(),
      lastActivity: new Date(),
      requestCount: 0,
    };
  });

  disconnect = vi.fn(async () => {
    if (this._errorSimulation?.onDisconnect) {
      throw new Error(this._errorSimulation.onDisconnect);
    }

    this._connected = false;
    this._session = null;
  });

  callTool = vi.fn(async (name: string, params: Record<string, unknown>): Promise<MCPToolResult> => {
    this.ensureConnected();

    const request: MCPRequest = {
      id: `req-${Date.now()}`,
      method: 'tools/call',
      params: { name, arguments: params },
      timestamp: new Date(),
    };
    this._requestHistory.push(request);

    if (this._session) {
      this._session.requestCount++;
      this._session.lastActivity = new Date();
    }

    await this.simulateLatency();

    // Check for error simulation
    if (this._errorSimulation?.onToolCall?.[name]) {
      const error = this._errorSimulation.onToolCall[name];
      const response: MCPResponse = {
        id: request.id,
        error: typeof error === 'string' ? { code: -32000, message: error } : error,
        timestamp: new Date(),
      };
      this._responseHistory.push(response);
      throw new MCPClientError(response.error!.message, response.error!.code);
    }

    // Check for custom handler
    const handler = this._toolHandlers.get(name);
    if (handler) {
      const result = await handler(params);
      const response: MCPResponse = {
        id: request.id,
        result,
        timestamp: new Date(),
      };
      this._responseHistory.push(response);
      return result;
    }

    // Check for registered tool
    const tool = this._tools.get(name);
    if (!tool) {
      const response: MCPResponse = {
        id: request.id,
        error: { code: -32601, message: `Tool not found: ${name}` },
        timestamp: new Date(),
      };
      this._responseHistory.push(response);
      throw new MCPClientError(`Tool not found: ${name}`, -32601);
    }

    // Default success response
    const result: MCPToolResult = {
      content: [{ type: 'text', text: JSON.stringify({ success: true, tool: name, params }) }],
    };
    const response: MCPResponse = {
      id: request.id,
      result,
      timestamp: new Date(),
    };
    this._responseHistory.push(response);

    return result;
  });

  listTools = vi.fn(async (): Promise<MCPTool[]> => {
    this.ensureConnected();
    await this.simulateLatency();
    return Array.from(this._tools.values());
  });

  readResource = vi.fn(async (uri: string): Promise<MCPResourceContent> => {
    this.ensureConnected();

    const request: MCPRequest = {
      id: `req-${Date.now()}`,
      method: 'resources/read',
      params: { uri },
      timestamp: new Date(),
    };
    this._requestHistory.push(request);

    await this.simulateLatency();

    const resource = this._resources.get(uri);
    if (!resource) {
      throw new MCPClientError(`Resource not found: ${uri}`, -32002);
    }

    return {
      type: 'resource',
      resource: {
        uri,
        mimeType: resource.mimeType,
        text: JSON.stringify({ name: resource.name, description: resource.description }),
      },
    };
  });

  listResources = vi.fn(async (): Promise<MCPResource[]> => {
    this.ensureConnected();
    await this.simulateLatency();
    return Array.from(this._resources.values());
  });

  getPrompt = vi.fn(async (name: string, args: Record<string, string>): Promise<MCPPromptResult> => {
    this.ensureConnected();

    const prompt = this._prompts.get(name);
    if (!prompt) {
      throw new MCPClientError(`Prompt not found: ${name}`, -32003);
    }

    await this.simulateLatency();

    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Prompt: ${name}\nArgs: ${JSON.stringify(args)}` },
        },
      ],
    };
  });

  listPrompts = vi.fn(async (): Promise<MCPPrompt[]> => {
    this.ensureConnected();
    await this.simulateLatency();
    return Array.from(this._prompts.values());
  });

  isConnected = vi.fn(() => this._connected);

  getSession = vi.fn(() => this._session);

  /**
   * Register a tool
   */
  registerTool(tool: MCPTool): void {
    this._tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: MCPTool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Register a custom tool handler
   */
  setToolHandler(name: string, handler: ToolHandler): void {
    this._toolHandlers.set(name, handler);
  }

  /**
   * Register a resource
   */
  registerResource(resource: MCPResource): void {
    this._resources.set(resource.uri, resource);
  }

  /**
   * Register multiple resources
   */
  registerResources(resources: MCPResource[]): void {
    for (const resource of resources) {
      this.registerResource(resource);
    }
  }

  /**
   * Register a prompt
   */
  registerPrompt(prompt: MCPPrompt): void {
    this._prompts.set(prompt.name, prompt);
  }

  /**
   * Register multiple prompts
   */
  registerPrompts(prompts: MCPPrompt[]): void {
    for (const prompt of prompts) {
      this.registerPrompt(prompt);
    }
  }

  /**
   * Configure error simulation
   */
  simulateErrors(config: ErrorSimulation): void {
    this._errorSimulation = config;
  }

  /**
   * Configure latency simulation
   */
  setLatency(ms: number): void {
    this._latencySimulation = ms;
  }

  /**
   * Get request history
   */
  getRequestHistory(): MCPRequest[] {
    return [...this._requestHistory];
  }

  /**
   * Get response history
   */
  getResponseHistory(): MCPResponse[] {
    return [...this._responseHistory];
  }

  /**
   * Get last request
   */
  getLastRequest(): MCPRequest | undefined {
    return this._requestHistory[this._requestHistory.length - 1];
  }

  /**
   * Get last response
   */
  getLastResponse(): MCPResponse | undefined {
    return this._responseHistory[this._responseHistory.length - 1];
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this._requestHistory = [];
    this._responseHistory = [];
  }

  /**
   * Reset client to initial state
   */
  reset(): void {
    this._connected = false;
    this._session = null;
    this._tools.clear();
    this._resources.clear();
    this._prompts.clear();
    this._requestHistory = [];
    this._responseHistory = [];
    this._toolHandlers.clear();
    this._errorSimulation = null;
    this._latencySimulation = 0;
    vi.clearAllMocks();
  }

  private ensureConnected(): void {
    if (!this._connected) {
      throw new MCPClientError('Not connected', -32000);
    }
  }

  private async simulateLatency(): Promise<void> {
    if (this._latencySimulation > 0) {
      await new Promise(resolve => setTimeout(resolve, this._latencySimulation));
    }
  }
}

/**
 * Mock MCP Server for testing server-side behavior
 */
export class MockMCPServer {
  private _running = false;
  private _config: MCPServerConfig | null = null;
  private _tools = new Map<string, MCPTool>();
  private _resources = new Map<string, MCPResource>();
  private _prompts = new Map<string, MCPPrompt>();
  private _connections: MockMCPConnection[] = [];
  private _requestLog: MCPRequest[] = [];
  private _errorCount = 0;

  start = vi.fn(async (config: MCPServerConfig) => {
    this._config = config;
    this._running = true;

    // Register configured tools/resources/prompts
    if (config.tools) {
      for (const tool of config.tools) {
        this._tools.set(tool.name, tool);
      }
    }
    if (config.resources) {
      for (const resource of config.resources) {
        this._resources.set(resource.uri, resource);
      }
    }
    if (config.prompts) {
      for (const prompt of config.prompts) {
        this._prompts.set(prompt.name, prompt);
      }
    }
  });

  stop = vi.fn(async () => {
    for (const conn of this._connections) {
      await conn.close();
    }
    this._connections = [];
    this._running = false;
  });

  handleRequest = vi.fn(async (request: MCPRequest): Promise<MCPResponse> => {
    this._requestLog.push(request);

    try {
      switch (request.method) {
        case 'tools/call':
          return this.handleToolCall(request);
        case 'resources/read':
          return this.handleResourceRead(request);
        case 'prompts/get':
          return this.handlePromptGet(request);
        case 'tools/list':
          return { id: request.id, result: Array.from(this._tools.values()), timestamp: new Date() };
        case 'resources/list':
          return { id: request.id, result: Array.from(this._resources.values()), timestamp: new Date() };
        case 'prompts/list':
          return { id: request.id, result: Array.from(this._prompts.values()), timestamp: new Date() };
        default:
          throw new MCPClientError(`Unknown method: ${request.method}`, -32601);
      }
    } catch (error) {
      this._errorCount++;
      return {
        id: request.id,
        error: { code: -32000, message: (error as Error).message },
        timestamp: new Date(),
      };
    }
  });

  registerTool = vi.fn((tool: MCPTool) => {
    this._tools.set(tool.name, tool);
  });

  registerResource = vi.fn((resource: MCPResource) => {
    this._resources.set(resource.uri, resource);
  });

  registerPrompt = vi.fn((prompt: MCPPrompt) => {
    this._prompts.set(prompt.name, prompt);
  });

  getStatus = vi.fn((): MCPServerStatus => ({
    running: this._running,
    transport: this._config?.transport.type ?? 'stdio',
    connectedClients: this._connections.length,
    toolsRegistered: this._tools.size,
    resourcesRegistered: this._resources.size,
    promptsRegistered: this._prompts.size,
    requestsHandled: this._requestLog.length,
    errorsCount: this._errorCount,
    uptime: this._running ? Date.now() : 0,
  }));

  /**
   * Simulate a client connection
   */
  acceptConnection(): MockMCPConnection {
    const conn = new MockMCPConnection(this);
    this._connections.push(conn);
    return conn;
  }

  /**
   * Get request log
   */
  getRequestLog(): MCPRequest[] {
    return [...this._requestLog];
  }

  /**
   * Reset server
   */
  reset(): void {
    this._running = false;
    this._config = null;
    this._tools.clear();
    this._resources.clear();
    this._prompts.clear();
    this._connections = [];
    this._requestLog = [];
    this._errorCount = 0;
    vi.clearAllMocks();
  }

  private handleToolCall(request: MCPRequest): MCPResponse {
    const { name, arguments: params } = request.params as { name: string; arguments: Record<string, unknown> };
    const tool = this._tools.get(name);

    if (!tool) {
      return {
        id: request.id,
        error: { code: -32601, message: `Tool not found: ${name}` },
        timestamp: new Date(),
      };
    }

    return {
      id: request.id,
      result: {
        content: [{ type: 'text', text: JSON.stringify({ success: true, tool: name }) }],
      },
      timestamp: new Date(),
    };
  }

  private handleResourceRead(request: MCPRequest): MCPResponse {
    const { uri } = request.params as { uri: string };
    const resource = this._resources.get(uri);

    if (!resource) {
      return {
        id: request.id,
        error: { code: -32002, message: `Resource not found: ${uri}` },
        timestamp: new Date(),
      };
    }

    return {
      id: request.id,
      result: {
        type: 'resource',
        resource: { uri, mimeType: resource.mimeType, text: '{}' },
      },
      timestamp: new Date(),
    };
  }

  private handlePromptGet(request: MCPRequest): MCPResponse {
    const { name } = request.params as { name: string };
    const prompt = this._prompts.get(name);

    if (!prompt) {
      return {
        id: request.id,
        error: { code: -32003, message: `Prompt not found: ${name}` },
        timestamp: new Date(),
      };
    }

    return {
      id: request.id,
      result: {
        messages: [{ role: 'user', content: { type: 'text', text: `Prompt: ${name}` } }],
      },
      timestamp: new Date(),
    };
  }
}

/**
 * Mock MCP Connection
 */
export class MockMCPConnection {
  private _open = true;
  private _server: MockMCPServer;

  constructor(server: MockMCPServer) {
    this._server = server;
  }

  send = vi.fn(async (request: MCPRequest): Promise<MCPResponse> => {
    if (!this._open) {
      throw new MCPClientError('Connection closed', -32000);
    }
    return this._server.handleRequest(request);
  });

  close = vi.fn(async () => {
    this._open = false;
  });

  isOpen(): boolean {
    return this._open;
  }
}

/**
 * MCP Client Error
 */
export class MCPClientError extends Error {
  constructor(message: string, public code: number) {
    super(message);
    this.name = 'MCPClientError';
  }
}

// Supporting types
interface MCPRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
  timestamp: Date;
}

interface MCPResponse {
  id: string;
  result?: unknown;
  error?: MCPError;
  timestamp: Date;
}

interface MCPResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

interface MCPPromptResult {
  messages: Array<{
    role: 'user' | 'assistant';
    content: MCPContent;
  }>;
}

interface MCPServerStatus {
  running: boolean;
  transport: string;
  connectedClients: number;
  toolsRegistered: number;
  resourcesRegistered: number;
  promptsRegistered: number;
  requestsHandled: number;
  errorsCount: number;
  uptime: number;
}

type ToolHandler = (params: Record<string, unknown>) => Promise<MCPToolResult>;

interface ErrorSimulation {
  onConnect?: string;
  onDisconnect?: string;
  onToolCall?: Record<string, string | MCPError>;
}

/**
 * Create a pre-configured mock MCP client with standard tools
 */
export function createStandardMockMCPClient(): MockMCPClient {
  const client = new MockMCPClient();

  // Register standard Claude-Flow tools
  client.registerTool({
    name: 'swarm_init',
    description: 'Initialize a new swarm',
    inputSchema: {
      type: 'object',
      properties: {
        topology: { type: 'string' },
        maxAgents: { type: 'number' },
      },
      required: ['topology'],
    },
  });

  client.registerTool({
    name: 'agent_spawn',
    description: 'Spawn a new agent',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['type'],
    },
  });

  client.registerTool({
    name: 'task_orchestrate',
    description: 'Orchestrate a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskName: { type: 'string' },
        taskType: { type: 'string' },
      },
      required: ['taskName', 'taskType'],
    },
  });

  client.registerTool({
    name: 'memory_store',
    description: 'Store a value in memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'object' },
      },
      required: ['key', 'value'],
    },
  });

  client.registerTool({
    name: 'memory_search',
    description: 'Search memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        topK: { type: 'number' },
      },
      required: ['query'],
    },
  });

  return client;
}

/**
 * Create a mock MCP client that simulates failures
 */
export function createFailingMockMCPClient(
  errorConfig: ErrorSimulation
): MockMCPClient {
  const client = new MockMCPClient();
  client.simulateErrors(errorConfig);
  return client;
}

/**
 * Create a mock MCP client with latency
 */
export function createSlowMockMCPClient(latencyMs: number): MockMCPClient {
  const client = new MockMCPClient();
  client.setLatency(latencyMs);
  return client;
}
