/**
 * V3 MCP Hooks Tools
 *
 * MCP tools for hooks system operations:
 * - hooks/pre-edit - Pre-edit hook with context and suggestions
 * - hooks/post-edit - Post-edit hook for learning
 * - hooks/pre-command - Pre-command hook for risk assessment
 * - hooks/post-command - Post-command hook for recording
 * - hooks/route - Route task to optimal agent
 * - hooks/explain - Explain routing decision
 * - hooks/pretrain - Bootstrap intelligence
 * - hooks/metrics - Get learning metrics
 * - hooks/list - List registered hooks
 *
 * Implements ADR-005: MCP-First API Design
 * Integrates with ReasoningBank for self-learning capabilities
 */
import { MCPTool } from '../types.js';
/**
 * hooks/pre-edit tool
 */
export declare const preEditTool: MCPTool;
/**
 * hooks/post-edit tool
 */
export declare const postEditTool: MCPTool;
/**
 * hooks/pre-command tool
 */
export declare const preCommandTool: MCPTool;
/**
 * hooks/post-command tool
 */
export declare const postCommandTool: MCPTool;
/**
 * hooks/route tool
 */
export declare const routeTool: MCPTool;
/**
 * hooks/explain tool
 */
export declare const explainTool: MCPTool;
/**
 * hooks/pretrain tool
 */
export declare const pretrainTool: MCPTool;
/**
 * hooks/metrics tool
 */
export declare const metricsTool: MCPTool;
/**
 * hooks/list tool
 */
export declare const listHooksTool: MCPTool;
export declare const hooksTools: MCPTool[];
export default hooksTools;
//# sourceMappingURL=hooks-tools.d.ts.map