/**
 * Request router for MCP
 */

import { MCPRequest } from '../utils/types.js';
import { ILogger } from '../core/logger.js';
import { MCPMethodNotFoundError } from '../utils/errors.js';
import { ToolRegistry } from './tools.js';

/**
 * Request router implementation
 */
export class RequestRouter {
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;

  constructor(
    private toolRegistry: ToolRegistry,
    private logger: ILogger,
  ) {}

  /**
   * Routes a request to the appropriate handler
   */
  async route(request: MCPRequest): Promise<unknown> {
    this.totalRequests++;

    try {
      // Parse method to determine handler
      const { method, params } = request;

      // Handle built-in methods
      if (method.startsWith('rpc.')) {
        return await this.handleRPCMethod(method, params);
      }

      // Handle tool invocations
      if (method.startsWith('tools.')) {
        return await this.handleToolMethod(method, params);
      }

      // Try to execute as a tool directly
      const tool = this.toolRegistry.getTool(method);
      if (tool) {
        const result = await this.toolRegistry.executeTool(method, params);
        this.successfulRequests++;
        return result;
      }

      // Method not found
      throw new MCPMethodNotFoundError(method);
    } catch (error) {
      this.failedRequests++;
      throw error;
    }
  }

  /**
   * Gets router metrics
   */
  getMetrics(): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
  } {
    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
    };
  }

  /**
   * Handles built-in RPC methods
   */
  private async handleRPCMethod(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'rpc.discover':
        return this.discoverMethods();

      case 'rpc.ping':
        return { pong: true };

      case 'rpc.describe':
        return this.describeMethod(params);

      default:
        throw new MCPMethodNotFoundError(method);
    }
  }

  /**
   * Handles tool-related methods
   */
  private async handleToolMethod(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'tools.list':
        return this.toolRegistry.listTools();

      case 'tools.invoke':
        return await this.invokeTool(params);

      case 'tools.describe':
        return this.describeTool(params);

      default:
        throw new MCPMethodNotFoundError(method);
    }
  }

  /**
   * Discovers all available methods
   */
  private discoverMethods(): Record<string, string> {
    const methods: Record<string, string> = {
      'rpc.discover': 'Discover all available methods',
      'rpc.ping': 'Ping the server',
      'rpc.describe': 'Describe a specific method',
      'tools.list': 'List all available tools',
      'tools.invoke': 'Invoke a specific tool',
      'tools.describe': 'Describe a specific tool',
    };

    // Add all registered tools
    for (const tool of this.toolRegistry.listTools()) {
      methods[tool.name] = tool.description;
    }

    return methods;
  }

  /**
   * Describes a specific method
   */
  private describeMethod(params: unknown): unknown {
    if (!params || typeof params !== 'object' || !('method' in params)) {
      throw new Error('Invalid params: method required');
    }

    const { method } = params as { method: string };

    // Check if it's a tool
    const tool = this.toolRegistry.getTool(method);
    if (tool) {
      return {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      };
    }

    // Check built-in methods
    const builtInMethods: Record<string, unknown> = {
      'rpc.discover': {
        description: 'Discover all available methods',
        inputSchema: { type: 'object', properties: {} },
      },
      'rpc.ping': {
        description: 'Ping the server',
        inputSchema: { type: 'object', properties: {} },
      },
      'rpc.describe': {
        description: 'Describe a specific method',
        inputSchema: {
          type: 'object',
          properties: {
            method: { type: 'string' },
          },
          required: ['method'],
        },
      },
      'tools.list': {
        description: 'List all available tools',
        inputSchema: { type: 'object', properties: {} },
      },
      'tools.invoke': {
        description: 'Invoke a specific tool',
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string' },
            input: { type: 'object' },
          },
          required: ['tool', 'input'],
        },
      },
      'tools.describe': {
        description: 'Describe a specific tool',
        inputSchema: {
          type: 'object',
          properties: {
            tool: { type: 'string' },
          },
          required: ['tool'],
        },
      },
    };

    if (method in builtInMethods) {
      return builtInMethods[method];
    }

    throw new MCPMethodNotFoundError(method);
  }

  /**
   * Invokes a tool
   */
  private async invokeTool(params: unknown): Promise<unknown> {
    if (!params || typeof params !== 'object' || !('tool' in params)) {
      throw new Error('Invalid params: tool required');
    }

    const { tool, input } = params as { tool: string; input?: unknown };
    return await this.toolRegistry.executeTool(tool, input || {});
  }

  /**
   * Describes a specific tool
   */
  private describeTool(params: unknown): unknown {
    if (!params || typeof params !== 'object' || !('tool' in params)) {
      throw new Error('Invalid params: tool required');
    }

    const { tool: toolName } = params as { tool: string };
    const tool = this.toolRegistry.getTool(toolName);

    if (!tool) {
      throw new Error(`Tool not found: ${toolName}`);
    }

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }
}