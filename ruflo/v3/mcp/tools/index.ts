/**
 * V3 MCP Tools - Central Export
 *
 * Exports all MCP tools and provides a getAllTools() function
 * for convenient registration.
 *
 * Implements ADR-005: MCP-First API Design
 *
 * Tool Categories:
 * - Agent Tools: agent/spawn, agent/list, agent/terminate, agent/status
 * - Swarm Tools: swarm/init, swarm/status, swarm/scale
 * - Memory Tools: memory/store, memory/search, memory/list
 * - Config Tools: config/load, config/save, config/validate
 * - Hooks Tools: hooks/pre-edit, hooks/post-edit, hooks/pre-command, hooks/post-command,
 *                hooks/route, hooks/explain, hooks/pretrain, hooks/metrics, hooks/list
 * - Task Tools: tasks/create, tasks/list, tasks/status, tasks/cancel,
 *               tasks/assign, tasks/update, tasks/dependencies, tasks/results
 * - System Tools: system/status, system/metrics, system/health, system/info
 * - Session Tools: session/save, session/restore, session/list
 */

import { MCPTool } from '../types.js';

// Import tool groups
import { agentTools } from './agent-tools.js';
import { swarmTools } from './swarm-tools.js';
import { memoryTools } from './memory-tools.js';
import { configTools } from './config-tools.js';
import { hooksTools } from './hooks-tools.js';
import { taskTools } from './task-tools.js';
import { systemTools } from './system-tools.js';
import { sessionTools } from './session-tools.js';
import { workerTools } from './worker-tools.js';
import { sonaTools } from './sona-tools.js';
import { federationTools } from './federation-tools.js';
import { v2CompatTools, getV2Tool, mapV2ToV3ToolName } from './v2-compat-tools.js';

// ============================================================================
// Individual Tool Exports
// ============================================================================

// Agent tools
export {
  spawnAgentTool,
  listAgentsTool,
  terminateAgentTool,
  agentStatusTool,
  agentTools,
} from './agent-tools.js';

// Swarm tools
export {
  initSwarmTool,
  swarmStatusTool,
  scaleSwarmTool,
  swarmTools,
} from './swarm-tools.js';

// Memory tools
export {
  storeMemoryTool,
  searchMemoryTool,
  listMemoryTool,
  memoryTools,
} from './memory-tools.js';

// Config tools
export {
  loadConfigTool,
  saveConfigTool,
  validateConfigTool,
  configTools,
} from './config-tools.js';

// Hooks tools
export {
  preEditTool,
  postEditTool,
  preCommandTool,
  postCommandTool,
  routeTool,
  explainTool,
  pretrainTool,
  metricsTool,
  listHooksTool,
  hooksTools,
} from './hooks-tools.js';

// Task tools
export {
  createTaskTool,
  listTasksTool,
  taskStatusTool,
  cancelTaskTool,
  assignTaskTool,
  updateTaskTool,
  taskDependenciesTool,
  taskResultsTool,
  taskTools,
} from './task-tools.js';

// System tools
export {
  systemStatusTool,
  systemMetricsTool,
  systemHealthTool,
  systemInfoTool,
  systemTools,
} from './system-tools.js';

// Session tools
export {
  saveSessionTool,
  restoreSessionTool,
  listSessionsTool,
  sessionTools,
} from './session-tools.js';

// Worker tools (agentic-flow@alpha compatible)
export {
  dispatchWorkerTool,
  workerStatusTool,
  cancelWorkerTool,
  triggersTool,
  detectTriggersTool,
  workerResultsTool,
  workerStatsTool,
  workerContextTool,
  workerTools,
} from './worker-tools.js';

// SONA tools (Self-Optimizing Neural Architecture)
export {
  sonaTools,
} from './sona-tools.js';

// Federation tools (Ephemeral Agent Coordination)
export {
  federationStatusTool,
  spawnEphemeralTool,
  terminateEphemeralTool,
  listEphemeralTool,
  registerSwarmTool,
  broadcastTool,
  proposeTool,
  voteTool,
  federationTools,
} from './federation-tools.js';

// V2 Compatibility tools (backward compatibility with V2 MCP naming)
export {
  v2CompatTools,
  getV2Tool,
  mapV2ToV3ToolName,
  swarmInitTool as v2SwarmInitTool,
  swarmStatusV2Tool,
  swarmMonitorTool,
  agentSpawnTool as v2AgentSpawnTool,
  agentListTool as v2AgentListTool,
  agentMetricsTool,
  taskOrchestrateTool,
  taskStatusV2Tool,
  taskResultsV2Tool,
  memoryUsageTool,
  neuralStatusTool,
  neuralTrainTool,
  neuralPatternsTool,
  benchmarkRunTool,
  featuresDetectTool,
} from './v2-compat-tools.js';

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all MCP tools
 *
 * Returns all available MCP tools in a single array for convenient
 * registration with the MCP server.
 *
 * @returns Array of all MCP tools
 *
 * @example
 * ```typescript
 * import { getAllTools } from './mcp/tools/index.js';
 *
 * const tools = getAllTools();
 * server.registerTools(tools);
 * ```
 */
export function getAllTools(includeV2Compat = true): MCPTool[] {
  const v3Tools = [
    ...agentTools,
    ...swarmTools,
    ...memoryTools,
    ...configTools,
    ...hooksTools,
    ...taskTools,
    ...systemTools,
    ...sessionTools,
    ...workerTools,
    ...sonaTools,
    ...federationTools,
  ];

  // Include V2 compatibility tools if requested (default: true for backward compatibility)
  if (includeV2Compat) {
    return [...v3Tools, ...v2CompatTools];
  }

  return v3Tools;
}

/**
 * Get only V3 tools (excludes V2 compatibility tools)
 */
export function getV3Tools(): MCPTool[] {
  return getAllTools(false);
}

/**
 * Get tools by category
 *
 * Returns all tools belonging to a specific category.
 *
 * @param category - Tool category to filter by
 * @returns Array of tools in the specified category
 *
 * @example
 * ```typescript
 * import { getToolsByCategory } from './mcp/tools/index.js';
 *
 * const agentTools = getToolsByCategory('agent');
 * const memoryTools = getToolsByCategory('memory');
 * ```
 */
export function getToolsByCategory(category: string): MCPTool[] {
  const allTools = getAllTools();
  return allTools.filter(tool => tool.category === category);
}

/**
 * Get tool by name
 *
 * Returns a specific tool by its name.
 *
 * @param name - Tool name (e.g., 'agent/spawn')
 * @returns The tool if found, undefined otherwise
 *
 * @example
 * ```typescript
 * import { getToolByName } from './mcp/tools/index.js';
 *
 * const spawnTool = getToolByName('agent/spawn');
 * if (spawnTool) {
 *   await spawnTool.handler({ agentType: 'coder' });
 * }
 * ```
 */
export function getToolByName(name: string): MCPTool | undefined {
  const allTools = getAllTools();
  return allTools.find(tool => tool.name === name);
}

/**
 * Get tools by tag
 *
 * Returns all tools that have a specific tag.
 *
 * @param tag - Tag to filter by
 * @returns Array of tools with the specified tag
 *
 * @example
 * ```typescript
 * import { getToolsByTag } from './mcp/tools/index.js';
 *
 * const lifecycleTools = getToolsByTag('lifecycle');
 * const agentdbTools = getToolsByTag('agentdb');
 * ```
 */
export function getToolsByTag(tag: string): MCPTool[] {
  const allTools = getAllTools();
  return allTools.filter(tool => tool.tags?.includes(tag));
}

/**
 * Get tool statistics
 *
 * Returns statistics about the available tools.
 *
 * @returns Object containing tool statistics
 *
 * @example
 * ```typescript
 * import { getToolStats } from './mcp/tools/index.js';
 *
 * const stats = getToolStats();
 * console.log(`Total tools: ${stats.total}`);
 * console.log(`Categories: ${stats.categories.join(', ')}`);
 * ```
 */
export function getToolStats(): {
  total: number;
  byCategory: Record<string, number>;
  categories: string[];
  tags: string[];
  cacheable: number;
  deprecated: number;
} {
  const allTools = getAllTools();

  const byCategory: Record<string, number> = {};
  const categories = new Set<string>();
  const tags = new Set<string>();
  let cacheable = 0;
  let deprecated = 0;

  allTools.forEach(tool => {
    // Count by category
    if (tool.category) {
      categories.add(tool.category);
      byCategory[tool.category] = (byCategory[tool.category] || 0) + 1;
    }

    // Collect tags
    tool.tags?.forEach(tag => tags.add(tag));

    // Count cacheable tools
    if (tool.cacheable) {
      cacheable++;
    }

    // Count deprecated tools
    if (tool.deprecated) {
      deprecated++;
    }
  });

  return {
    total: allTools.length,
    byCategory,
    categories: Array.from(categories).sort(),
    tags: Array.from(tags).sort(),
    cacheable,
    deprecated,
  };
}

/**
 * Validate tool registration
 *
 * Checks if all tools have valid schemas and handlers.
 *
 * @returns Validation result
 *
 * @example
 * ```typescript
 * import { validateToolRegistration } from './mcp/tools/index.js';
 *
 * const validation = validateToolRegistration();
 * if (!validation.valid) {
 *   console.error('Tool validation failed:', validation.issues);
 * }
 * ```
 */
export function validateToolRegistration(): {
  valid: boolean;
  issues: Array<{ tool: string; issue: string }>;
} {
  const allTools = getAllTools();
  const issues: Array<{ tool: string; issue: string }> = [];

  allTools.forEach(tool => {
    // Check required fields
    if (!tool.name) {
      issues.push({ tool: 'unknown', issue: 'Tool is missing name' });
      return;
    }

    if (!tool.description) {
      issues.push({ tool: tool.name, issue: 'Missing description' });
    }

    if (!tool.inputSchema) {
      issues.push({ tool: tool.name, issue: 'Missing inputSchema' });
    }

    if (!tool.handler || typeof tool.handler !== 'function') {
      issues.push({ tool: tool.name, issue: 'Missing or invalid handler' });
    }

    // Check schema validity
    if (tool.inputSchema) {
      if (!tool.inputSchema.type) {
        issues.push({ tool: tool.name, issue: 'inputSchema missing type' });
      }

      if (tool.inputSchema.type === 'object' && !tool.inputSchema.properties) {
        issues.push({ tool: tool.name, issue: 'Object schema missing properties' });
      }
    }

    // Check for duplicate names
    const duplicates = allTools.filter(t => t.name === tool.name);
    if (duplicates.length > 1) {
      issues.push({ tool: tool.name, issue: 'Duplicate tool name' });
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  getAllTools,
  getV3Tools,
  getToolsByCategory,
  getToolByName,
  getToolsByTag,
  getToolStats,
  validateToolRegistration,
  // V3 Tool Groups
  agentTools,
  swarmTools,
  memoryTools,
  configTools,
  hooksTools,
  taskTools,
  systemTools,
  sessionTools,
  workerTools,
  sonaTools,
  federationTools,
  // V2 Compatibility
  v2CompatTools,
  getV2Tool,
  mapV2ToV3ToolName,
};
