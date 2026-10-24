/**
 * V3 CLI MCP Client
 *
 * Thin wrapper for calling MCP tools from CLI commands.
 * Implements ADR-005: MCP-First API Design - CLI as thin wrapper around MCP tools
 *
 * This provides a simple interface for CLI commands to call MCP tools without
 * containing hardcoded business logic. All business logic lives in MCP tool handlers.
 */

import type { MCPTool } from './mcp-tools/types.js';

// Import MCP tool handlers from local package
import { agentTools } from './mcp-tools/agent-tools.js';
import { swarmTools } from './mcp-tools/swarm-tools.js';
import { memoryTools } from './mcp-tools/memory-tools.js';
import { configTools } from './mcp-tools/config-tools.js';
import { hooksTools } from './mcp-tools/hooks-tools.js';
import { taskTools } from './mcp-tools/task-tools.js';
import { sessionTools } from './mcp-tools/session-tools.js';
import { hiveMindTools } from './mcp-tools/hive-mind-tools.js';
import { workflowTools } from './mcp-tools/workflow-tools.js';
import { analyzeTools } from './mcp-tools/analyze-tools.js';
import { progressTools } from './mcp-tools/progress-tools.js';
import { embeddingsTools } from './mcp-tools/embeddings-tools.js';
import { claimsTools } from './mcp-tools/claims-tools.js';
import { securityTools } from './mcp-tools/security-tools.js';
import { transferTools } from './mcp-tools/transfer-tools.js';
// V2 Compatibility tools
import { systemTools } from './mcp-tools/system-tools.js';
import { terminalTools } from './mcp-tools/terminal-tools.js';
import { neuralTools } from './mcp-tools/neural-tools.js';
import { performanceTools } from './mcp-tools/performance-tools.js';
import { githubTools } from './mcp-tools/github-tools.js';
import { daaTools } from './mcp-tools/daa-tools.js';
import { coordinationTools } from './mcp-tools/coordination-tools.js';

/**
 * MCP Tool Registry
 * Maps tool names to their handler functions
 */
const TOOL_REGISTRY = new Map<string, MCPTool>();

// Register all tools
function registerTools(tools: MCPTool[]): void {
  tools.forEach(tool => {
    TOOL_REGISTRY.set(tool.name, tool);
  });
}

// Initialize registry with all available tools
registerTools([
  ...agentTools,
  ...swarmTools,
  ...memoryTools,
  ...configTools,
  ...hooksTools,
  ...taskTools,
  ...sessionTools,
  ...hiveMindTools,
  ...workflowTools,
  ...analyzeTools,
  ...progressTools,
  ...embeddingsTools,
  ...claimsTools,
  ...securityTools,
  ...transferTools,
  // V2 Compatibility tools
  ...systemTools,
  ...terminalTools,
  ...neuralTools,
  ...performanceTools,
  ...githubTools,
  ...daaTools,
  ...coordinationTools,
]);

/**
 * MCP Client Error
 */
export class MCPClientError extends Error {
  constructor(
    message: string,
    public toolName: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'MCPClientError';
  }
}

/**
 * Call an MCP tool by name with input parameters
 *
 * @param toolName - Name of the MCP tool (e.g., 'agent/spawn', 'swarm/init')
 * @param input - Input parameters for the tool
 * @param context - Optional tool context
 * @returns Promise resolving to tool result
 * @throws {MCPClientError} If tool not found or execution fails
 *
 * @example
 * ```typescript
 * // Spawn an agent
 * const result = await callMCPTool('agent/spawn', {
 *   agentType: 'coder',
 *   priority: 'normal'
 * });
 *
 * // Initialize swarm
 * const swarm = await callMCPTool('swarm/init', {
 *   topology: 'hierarchical-mesh',
 *   maxAgents: 15
 * });
 * ```
 */
export async function callMCPTool<T = unknown>(
  toolName: string,
  input: Record<string, unknown> = {},
  context?: Record<string, unknown>
): Promise<T> {
  // Look up tool in registry
  const tool = TOOL_REGISTRY.get(toolName);

  if (!tool) {
    throw new MCPClientError(
      `MCP tool not found: ${toolName}`,
      toolName
    );
  }

  try {
    // Call the tool handler
    const result = await tool.handler(input, context);
    return result as T;
  } catch (error) {
    // Wrap and re-throw with context
    throw new MCPClientError(
      `Failed to execute MCP tool '${toolName}': ${error instanceof Error ? error.message : String(error)}`,
      toolName,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Get tool metadata by name
 *
 * @param toolName - Name of the MCP tool
 * @returns Tool metadata or undefined if not found
 */
export function getToolMetadata(toolName: string): Omit<MCPTool, 'handler'> | undefined {
  const tool = TOOL_REGISTRY.get(toolName);

  if (!tool) {
    return undefined;
  }

  // Return everything except the handler function
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    category: tool.category,
    tags: tool.tags,
    version: tool.version,
    cacheable: tool.cacheable,
    cacheTTL: tool.cacheTTL,
  };
}

/**
 * List all available MCP tools
 *
 * @param category - Optional category filter
 * @returns Array of tool metadata
 */
export function listMCPTools(category?: string): Array<Omit<MCPTool, 'handler'>> {
  const tools = Array.from(TOOL_REGISTRY.values());

  const filtered = category
    ? tools.filter(t => t.category === category)
    : tools;

  return filtered.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    category: tool.category,
    tags: tool.tags,
    version: tool.version,
    cacheable: tool.cacheable,
    cacheTTL: tool.cacheTTL,
  }));
}

/**
 * Check if an MCP tool exists
 *
 * @param toolName - Name of the MCP tool
 * @returns True if tool exists
 */
export function hasTool(toolName: string): boolean {
  return TOOL_REGISTRY.has(toolName);
}

/**
 * Get all tool categories
 *
 * @returns Array of unique categories
 */
export function getToolCategories(): string[] {
  const categories = new Set<string>();

  TOOL_REGISTRY.forEach(tool => {
    if (tool.category) {
      categories.add(tool.category);
    }
  });

  return Array.from(categories).sort();
}

/**
 * Validate tool input against schema
 *
 * @param toolName - Name of the MCP tool
 * @param input - Input to validate
 * @returns Validation result with errors if any
 */
export function validateToolInput(
  toolName: string,
  input: Record<string, unknown>
): { valid: boolean; errors?: string[] } {
  const tool = TOOL_REGISTRY.get(toolName);

  if (!tool) {
    return {
      valid: false,
      errors: [`Tool '${toolName}' not found`],
    };
  }

  // Basic validation - check required fields
  const schema = tool.inputSchema;
  const errors: string[] = [];

  if (schema.required && Array.isArray(schema.required)) {
    for (const requiredField of schema.required) {
      if (!(requiredField in input)) {
        errors.push(`Missing required field: ${requiredField}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export default {
  callMCPTool,
  getToolMetadata,
  listMCPTools,
  hasTool,
  getToolCategories,
  validateToolInput,
  MCPClientError,
};
