/**
 * V3 MCP Configuration Tools
 *
 * MCP tools for configuration management:
 * - config/load - Load configuration
 * - config/save - Save configuration
 * - config/validate - Validate configuration
 *
 * Implements ADR-005: MCP-First API Design
 */
import { MCPTool } from '../types.js';
/**
 * config/load tool
 */
export declare const loadConfigTool: MCPTool;
/**
 * config/save tool
 */
export declare const saveConfigTool: MCPTool;
/**
 * config/validate tool
 */
export declare const validateConfigTool: MCPTool;
export declare const configTools: MCPTool[];
export default configTools;
//# sourceMappingURL=config-tools.d.ts.map