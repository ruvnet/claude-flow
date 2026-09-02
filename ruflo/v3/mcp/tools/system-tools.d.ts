/**
 * V3 MCP System Tools
 *
 * MCP tools for system operations:
 * - system/status - Overall system status
 * - system/metrics - Performance metrics
 * - system/health - Health check endpoint
 * - system/info - System information
 *
 * Implements ADR-005: MCP-First API Design
 */
import { MCPTool } from '../types.js';
/**
 * system/status tool
 */
export declare const systemStatusTool: MCPTool;
/**
 * system/metrics tool
 */
export declare const systemMetricsTool: MCPTool;
/**
 * system/health tool
 */
export declare const systemHealthTool: MCPTool;
/**
 * system/info tool
 */
export declare const systemInfoTool: MCPTool;
export declare const systemTools: MCPTool[];
export default systemTools;
//# sourceMappingURL=system-tools.d.ts.map