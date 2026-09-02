/**
 * Tool Registry for In-Process MCP Server
 *
 * Registers all 50+ Claude-Flow MCP tools for in-process execution.
 * Provides tool discovery, validation, and routing.
 */

import { createInProcessServer, InProcessMCPServer } from './in-process-server.js';
import { createClaudeFlowTools } from './claude-flow-tools.js';
import { logger } from '../core/logger.js';
import type { MCPTool } from '../utils/types.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-code/sdk.d.ts';

// Import SDK tool creation function
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-code/sdk';
import { z } from 'zod';

export interface ToolRegistryConfig {
  enableInProcess: boolean;
  enableMetrics: boolean;
  enableCaching: boolean;
  orchestratorContext?: any;
}

/**
 * Global tool registry for managing all MCP tools
 */
export class ClaudeFlowToolRegistry {
  private inProcessServer?: InProcessMCPServer;
  private sdkServer?: McpSdkServerConfigWithInstance;
  private tools: Map<string, MCPTool>;
  private config: ToolRegistryConfig;

  constructor(config: ToolRegistryConfig) {
    this.config = config;
    this.tools = new Map();

    logger.info('ClaudeFlowToolRegistry initialized', {
      enableInProcess: config.enableInProcess,
      enableMetrics: config.enableMetrics,
    });
  }

  /**
   * Initialize the tool registry with all Claude-Flow tools
   */
  async initialize(): Promise<void> {
    logger.info('Loading Claude-Flow tools...');

    // Load all tools from claude-flow-tools.ts
    const claudeFlowTools = await createClaudeFlowTools(logger);

    // Register each tool
    for (const tool of claudeFlowTools) {
      this.tools.set(tool.name, tool);
    }

    logger.info(`Loaded ${this.tools.size} Claude-Flow tools`);

    // Create in-process server if enabled
    if (this.config.enableInProcess) {
      await this.createInProcessServer();
    }
  }

  /**
   * Create SDK-compatible in-process server
   */
  private async createInProcessServer(): Promise<void> {
    logger.info('Creating in-process MCP server...');

    // Create in-process server
    this.inProcessServer = createInProcessServer({
      name: 'claude-flow',
      version: '2.0.0',
      enableMetrics: this.config.enableMetrics,
      enableCaching: this.config.enableCaching,
    });

    // Register all tools
    for (const [name, tool] of this.tools) {
      this.inProcessServer.registerTool(tool);
    }

    // Set orchestrator context if provided
    if (this.config.orchestratorContext) {
      this.inProcessServer.setContext({
        orchestrator: this.config.orchestratorContext,
        sessionId: 'in-process-session',
      });
    }

    // Create SDK MCP server for integration
    await this.createSdkServer();

    logger.info('In-process MCP server created', {
      toolCount: this.inProcessServer.getToolNames().length,
    });
  }

  /**
   * Create SDK-compatible MCP server using SDK's createSdkMcpServer
   */
  private async createSdkServer(): Promise<void> {
    if (!this.inProcessServer) {
      throw new Error('In-process server not initialized');
    }

    // Convert Claude-Flow tools to SDK tool format
    const sdkTools = Array.from(this.tools.values()).map(tool => {
      return this.convertToSdkTool(tool);
    });

    // Create SDK MCP server
    this.sdkServer = createSdkMcpServer({
      name: 'claude-flow',
      version: '2.0.0',
      tools: sdkTools,
    });

    logger.info('SDK MCP server created', { toolCount: sdkTools.length });
  }

  /**
   * Convert Claude-Flow tool to SDK tool format
   */
  private convertToSdkTool(mcpTool: MCPTool): any {
    // Convert JSON Schema to Zod schema
    const zodSchema = this.jsonSchemaToZod(mcpTool.inputSchema);

    // Create SDK tool using the 'tool' helper
    return tool(
      mcpTool.name,
      mcpTool.description,
      zodSchema,
      async (args: any, extra: unknown) => {
        // Execute via in-process server
        if (this.inProcessServer) {
          return await this.inProcessServer.callTool(mcpTool.name, args);
        }

        // Fallback to direct execution
        const result = await mcpTool.handler(args, {
          orchestrator: this.config.orchestratorContext,
          sessionId: 'sdk-session',
        });

        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
          isError: false,
        };
      }
    );
  }

  /**
   * Convert JSON Schema to Zod schema (simplified)
   */
  private jsonSchemaToZod(schema: any): any {
    const zodSchema: any = {};

    if (!schema.properties) {
      return {};
    }

    for (const [key, prop] of Object.entries(schema.properties)) {
      const p = prop as any;

      // Basic type conversion
      if (p.type === 'string') {
        zodSchema[key] = p.enum ? z.enum(p.enum) : z.string();
        if (p.default !== undefined) {
          zodSchema[key] = zodSchema[key].default(p.default);
        }
        if (!schema.required?.includes(key)) {
          zodSchema[key] = zodSchema[key].optional();
        }
      } else if (p.type === 'number' || p.type === 'integer') {
        zodSchema[key] = z.number();
        if (p.default !== undefined) {
          zodSchema[key] = zodSchema[key].default(p.default);
        }
        if (!schema.required?.includes(key)) {
          zodSchema[key] = zodSchema[key].optional();
        }
      } else if (p.type === 'boolean') {
        zodSchema[key] = z.boolean();
        if (p.default !== undefined) {
          zodSchema[key] = zodSchema[key].default(p.default);
        }
        if (!schema.required?.includes(key)) {
          zodSchema[key] = zodSchema[key].optional();
        }
      } else if (p.type === 'array') {
        zodSchema[key] = z.array(z.any());
        if (!schema.required?.includes(key)) {
          zodSchema[key] = zodSchema[key].optional();
        }
      } else if (p.type === 'object') {
        zodSchema[key] = z.record(z.any());
        if (!schema.required?.includes(key)) {
          zodSchema[key] = zodSchema[key].optional();
        }
      } else {
        // Default to any
        zodSchema[key] = z.any();
        if (!schema.required?.includes(key)) {
          zodSchema[key] = zodSchema[key].optional();
        }
      }

      // Add description
      if (p.description) {
        zodSchema[key] = zodSchema[key].describe(p.description);
      }
    }

    return zodSchema;
  }

  /**
   * Get SDK server config for use in query() options
   */
  getSdkServerConfig(): McpSdkServerConfigWithInstance | undefined {
    return this.sdkServer;
  }

  /**
   * Get in-process server instance
   */
  getInProcessServer(): InProcessMCPServer | undefined {
    return this.inProcessServer;
  }

  /**
   * Get tool by name
   */
  getTool(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Check if tool should use in-process execution
   */
  shouldUseInProcess(toolName: string): boolean {
    // All Claude-Flow tools use in-process
    return this.tools.has(toolName);
  }

  /**
   * Route tool call to appropriate transport
   */
  async routeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    context?: any
  ): Promise<any> {
    const startTime = performance.now();

    try {
      if (this.shouldUseInProcess(toolName) && this.inProcessServer) {
        logger.debug('Routing to in-process server', { toolName });
        const result = await this.inProcessServer.callTool(toolName, args, context);
        const duration = performance.now() - startTime;

        logger.info('In-process tool call completed', {
          toolName,
          duration: `${duration.toFixed(2)}ms`,
          transport: 'in-process',
        });

        return result;
      }

      // External tools would use stdio/SSE (not implemented in this phase)
      logger.warn('Tool not found in in-process registry', { toolName });
      throw new Error(`Tool not available: ${toolName}`);
    } catch (error) {
      logger.error('Tool routing failed', { toolName, error });
      throw error;
    }
  }

  /**
   * Get performance metrics
   */
  getMetrics() {
    if (!this.inProcessServer) {
      return { error: 'In-process server not initialized' };
    }

    const stats = this.inProcessServer.getStats();
    const metrics = this.inProcessServer.getMetrics();

    return {
      stats,
      recentMetrics: metrics.slice(-10), // Last 10 calls
      summary: {
        totalCalls: metrics.length,
        averageLatency: stats.averageDuration,
        cacheHitRate: stats.cacheHitRate,
      },
    };
  }

  /**
   * Get performance comparison (in-process vs IPC)
   */
  getPerformanceComparison() {
    const metrics = this.getMetrics();

    if ('error' in metrics) {
      return metrics;
    }

    const avgInProcessLatency = metrics.stats.averageDuration;

    // Estimated IPC latency (based on typical MCP stdio overhead)
    const estimatedIPCLatency = avgInProcessLatency * 50; // 50x overhead estimate

    return {
      inProcessLatency: `${avgInProcessLatency.toFixed(2)}ms`,
      estimatedIPCLatency: `${estimatedIPCLatency.toFixed(2)}ms`,
      speedupFactor: `${(estimatedIPCLatency / avgInProcessLatency).toFixed(1)}x`,
      recommendation: 'Use in-process for all Claude-Flow tools for maximum performance',
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.inProcessServer) {
      this.inProcessServer.clearCache();
      this.inProcessServer.clearMetrics();
    }

    this.tools.clear();
    logger.info('Tool registry cleaned up');
  }
}

/**
 * Create a global tool registry instance
 */
export async function createToolRegistry(
  config: ToolRegistryConfig
): Promise<ClaudeFlowToolRegistry> {
  const registry = new ClaudeFlowToolRegistry(config);
  await registry.initialize();
  return registry;
}

/**
 * Export SDK server creation helper
 */
export async function createClaudeFlowSdkServer(
  orchestratorContext?: any
): Promise<McpSdkServerConfigWithInstance> {
  const registry = await createToolRegistry({
    enableInProcess: true,
    enableMetrics: true,
    enableCaching: true,
    orchestratorContext,
  });

  const sdkServer = registry.getSdkServerConfig();
  if (!sdkServer) {
    throw new Error('Failed to create SDK server');
  }

  return sdkServer;
}