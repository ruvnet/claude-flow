/**
 * V3 MCP Worker Tools
 *
 * MCP tools for background worker management (agentic-flow@alpha compatible):
 * - worker/dispatch - Spawn background worker
 * - worker/status - Get worker status
 * - worker/cancel - Cancel running worker
 * - worker/triggers - List available triggers
 * - worker/results - Get completed results
 * - worker/detect - Detect triggers in prompt
 * - worker/stats - Aggregated statistics
 * - worker/context - Get context for injection
 *
 * Implements ADR-005: MCP-First API Design
 * Implements ADR-001: agentic-flow@alpha compatibility
 */
import { MCPTool } from '../types.js';
export declare const dispatchWorkerTool: MCPTool;
export declare const workerStatusTool: MCPTool;
export declare const cancelWorkerTool: MCPTool;
export declare const triggersTool: MCPTool;
export declare const detectTriggersTool: MCPTool;
export declare const workerResultsTool: MCPTool;
export declare const workerStatsTool: MCPTool;
export declare const workerContextTool: MCPTool;
export declare const workerTools: MCPTool[];
export default workerTools;
//# sourceMappingURL=worker-tools.d.ts.map