/**
 * V3 MCP Swarm Tools
 *
 * MCP tools for swarm coordination operations:
 * - swarm/init - Initialize swarm coordination
 * - swarm/status - Get swarm status
 * - swarm/scale - Scale swarm agents
 *
 * Implements ADR-005: MCP-First API Design
 */
import { MCPTool } from '../types.js';
/**
 * swarm/init tool
 */
export declare const initSwarmTool: MCPTool;
/**
 * swarm/status tool
 */
export declare const swarmStatusTool: MCPTool;
/**
 * swarm/scale tool
 */
export declare const scaleSwarmTool: MCPTool;
export declare const swarmTools: MCPTool[];
export default swarmTools;
//# sourceMappingURL=swarm-tools.d.ts.map