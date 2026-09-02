/**
 * MCP Module Index
 *
 * Re-exports MCP components from their infrastructure location.
 */

export { MCPServer } from '../infrastructure/mcp/MCPServer';
export { AgentTools } from '../infrastructure/mcp/tools/AgentTools';
export { MemoryTools } from '../infrastructure/mcp/tools/MemoryTools';
export { ConfigTools } from '../infrastructure/mcp/tools/ConfigTools';

export type {
  MCPServerOptions,
  MCPTool,
  MCPToolProvider,
  MCPToolResult,
  MCPRequest,
  MCPResponse
} from '../shared/types';
