/**
 * V3 MCP Memory Tools
 *
 * MCP tools for memory operations:
 * - memory/store - Store memory entry
 * - memory/search - Search memories (semantic + keyword)
 * - memory/list - List memory entries
 *
 * Implements ADR-005: MCP-First API Design
 * Implements ADR-006: Unified Memory Service (AgentDB integration)
 */
import { MCPTool } from '../types.js';
/**
 * memory/store tool
 */
export declare const storeMemoryTool: MCPTool;
/**
 * memory/search tool
 */
export declare const searchMemoryTool: MCPTool;
/**
 * memory/list tool
 */
export declare const listMemoryTool: MCPTool;
export declare const memoryTools: MCPTool[];
export default memoryTools;
//# sourceMappingURL=memory-tools.d.ts.map