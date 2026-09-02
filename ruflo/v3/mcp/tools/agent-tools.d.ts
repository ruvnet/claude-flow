/**
 * V3 MCP Agent Tools
 *
 * MCP tools for agent lifecycle operations:
 * - agent/spawn - Spawn a new agent
 * - agent/list - List all agents
 * - agent/terminate - Terminate an agent
 * - agent/status - Get agent status
 *
 * Implements ADR-005: MCP-First API Design
 */
import { MCPTool } from '../types.js';
/**
 * agent/spawn tool
 */
export declare const spawnAgentTool: MCPTool;
/**
 * agent/list tool
 */
export declare const listAgentsTool: MCPTool;
/**
 * agent/terminate tool
 */
export declare const terminateAgentTool: MCPTool;
/**
 * agent/status tool
 */
export declare const agentStatusTool: MCPTool;
export declare const agentTools: MCPTool[];
export default agentTools;
//# sourceMappingURL=agent-tools.d.ts.map