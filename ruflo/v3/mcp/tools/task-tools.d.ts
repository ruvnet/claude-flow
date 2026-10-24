/**
 * V3 MCP Task Tools
 *
 * MCP tools for task management operations:
 * - tasks/create - Create a new task
 * - tasks/list - List tasks with filters
 * - tasks/status - Get task status
 * - tasks/cancel - Cancel running task
 * - tasks/assign - Assign task to agent
 * - tasks/update - Update task properties
 * - tasks/dependencies - Manage task dependencies
 * - tasks/results - Get task results
 *
 * Implements ADR-005: MCP-First API Design
 */
import { MCPTool } from '../types.js';
/**
 * tasks/create tool
 */
export declare const createTaskTool: MCPTool;
/**
 * tasks/list tool
 */
export declare const listTasksTool: MCPTool;
/**
 * tasks/status tool
 */
export declare const taskStatusTool: MCPTool;
/**
 * tasks/cancel tool
 */
export declare const cancelTaskTool: MCPTool;
/**
 * tasks/assign tool
 */
export declare const assignTaskTool: MCPTool;
/**
 * tasks/update tool
 */
export declare const updateTaskTool: MCPTool;
/**
 * tasks/dependencies tool
 */
export declare const taskDependenciesTool: MCPTool;
/**
 * tasks/results tool
 */
export declare const taskResultsTool: MCPTool;
export declare const taskTools: MCPTool[];
export default taskTools;
//# sourceMappingURL=task-tools.d.ts.map