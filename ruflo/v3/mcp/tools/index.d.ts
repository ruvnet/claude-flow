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
import { getV2Tool, mapV2ToV3ToolName } from './v2-compat-tools.js';
export { spawnAgentTool, listAgentsTool, terminateAgentTool, agentStatusTool, agentTools, } from './agent-tools.js';
export { initSwarmTool, swarmStatusTool, scaleSwarmTool, swarmTools, } from './swarm-tools.js';
export { storeMemoryTool, searchMemoryTool, listMemoryTool, memoryTools, } from './memory-tools.js';
export { loadConfigTool, saveConfigTool, validateConfigTool, configTools, } from './config-tools.js';
export { preEditTool, postEditTool, preCommandTool, postCommandTool, routeTool, explainTool, pretrainTool, metricsTool, listHooksTool, hooksTools, } from './hooks-tools.js';
export { createTaskTool, listTasksTool, taskStatusTool, cancelTaskTool, assignTaskTool, updateTaskTool, taskDependenciesTool, taskResultsTool, taskTools, } from './task-tools.js';
export { systemStatusTool, systemMetricsTool, systemHealthTool, systemInfoTool, systemTools, } from './system-tools.js';
export { saveSessionTool, restoreSessionTool, listSessionsTool, sessionTools, } from './session-tools.js';
export { dispatchWorkerTool, workerStatusTool, cancelWorkerTool, triggersTool, detectTriggersTool, workerResultsTool, workerStatsTool, workerContextTool, workerTools, } from './worker-tools.js';
export { sonaTools, } from './sona-tools.js';
export { federationStatusTool, spawnEphemeralTool, terminateEphemeralTool, listEphemeralTool, registerSwarmTool, broadcastTool, proposeTool, voteTool, federationTools, } from './federation-tools.js';
export { v2CompatTools, getV2Tool, mapV2ToV3ToolName, swarmInitTool as v2SwarmInitTool, swarmStatusV2Tool, swarmMonitorTool, agentSpawnTool as v2AgentSpawnTool, agentListTool as v2AgentListTool, agentMetricsTool, taskOrchestrateTool, taskStatusV2Tool, taskResultsV2Tool, memoryUsageTool, neuralStatusTool, neuralTrainTool, neuralPatternsTool, benchmarkRunTool, featuresDetectTool, } from './v2-compat-tools.js';
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
export declare function getAllTools(includeV2Compat?: boolean): MCPTool[];
/**
 * Get only V3 tools (excludes V2 compatibility tools)
 */
export declare function getV3Tools(): MCPTool[];
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
export declare function getToolsByCategory(category: string): MCPTool[];
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
export declare function getToolByName(name: string): MCPTool | undefined;
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
export declare function getToolsByTag(tag: string): MCPTool[];
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
export declare function getToolStats(): {
    total: number;
    byCategory: Record<string, number>;
    categories: string[];
    tags: string[];
    cacheable: number;
    deprecated: number;
};
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
export declare function validateToolRegistration(): {
    valid: boolean;
    issues: Array<{
        tool: string;
        issue: string;
    }>;
};
declare const _default: {
    getAllTools: typeof getAllTools;
    getV3Tools: typeof getV3Tools;
    getToolsByCategory: typeof getToolsByCategory;
    getToolByName: typeof getToolByName;
    getToolsByTag: typeof getToolsByTag;
    getToolStats: typeof getToolStats;
    validateToolRegistration: typeof validateToolRegistration;
    agentTools: MCPTool<unknown, unknown>[];
    swarmTools: MCPTool<unknown, unknown>[];
    memoryTools: MCPTool<unknown, unknown>[];
    configTools: MCPTool<unknown, unknown>[];
    hooksTools: MCPTool<unknown, unknown>[];
    taskTools: MCPTool<unknown, unknown>[];
    systemTools: MCPTool<unknown, unknown>[];
    sessionTools: MCPTool<unknown, unknown>[];
    workerTools: MCPTool<unknown, unknown>[];
    sonaTools: MCPTool<unknown, unknown>[];
    federationTools: MCPTool<unknown, unknown>[];
    v2CompatTools: MCPTool<unknown, unknown>[];
    getV2Tool: typeof getV2Tool;
    mapV2ToV3ToolName: typeof mapV2ToV3ToolName;
};
export default _default;
//# sourceMappingURL=index.d.ts.map