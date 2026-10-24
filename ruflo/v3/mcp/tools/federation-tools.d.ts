/**
 * V3 MCP Federation Tools
 *
 * MCP tools for federation hub and ephemeral agent management:
 * - federation/status - Get federation status
 * - federation/spawn-ephemeral - Spawn ephemeral agent
 * - federation/terminate-ephemeral - Terminate ephemeral agent
 * - federation/list-ephemeral - List ephemeral agents
 * - federation/register-swarm - Register swarm with federation
 * - federation/broadcast - Broadcast message to all swarms
 * - federation/propose - Propose federation-wide consensus
 * - federation/vote - Vote on consensus proposal
 *
 * Implements ADR-005: MCP-First API Design
 * Implements ADR-001: agentic-flow@alpha compatibility
 */
import { MCPTool } from '../types.js';
export declare const federationStatusTool: MCPTool;
export declare const spawnEphemeralTool: MCPTool;
export declare const terminateEphemeralTool: MCPTool;
export declare const listEphemeralTool: MCPTool;
export declare const registerSwarmTool: MCPTool;
export declare const broadcastTool: MCPTool;
export declare const proposeTool: MCPTool;
export declare const voteTool: MCPTool;
export declare const federationTools: MCPTool[];
export default federationTools;
//# sourceMappingURL=federation-tools.d.ts.map