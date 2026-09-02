/**
 * V3 MCP Types
 * Model Context Protocol type definitions
 * Aligned with ADR-005 (MCP-first API design)
 */

/**
 * MCP tool definition
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPInputSchema;
  handler: MCPToolHandler;
}

/**
 * MCP input schema (JSON Schema)
 */
export interface MCPInputSchema {
  type: 'object';
  properties: Record<string, MCPPropertySchema>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * MCP property schema
 */
export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: MCPPropertySchema;
  properties?: Record<string, MCPPropertySchema>;
  required?: string[];
}

/**
 * MCP tool handler
 */
export type MCPToolHandler = (params: Record<string, unknown>) => Promise<MCPToolResult>;

/**
 * MCP tool result
 */
export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

/**
 * MCP content types
 */
export type MCPContent =
  | MCPTextContent
  | MCPImageContent
  | MCPResourceContent;

/**
 * MCP text content
 */
export interface MCPTextContent {
  type: 'text';
  text: string;
}

/**
 * MCP image content
 */
export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/**
 * MCP resource content
 */
export interface MCPResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  name: string;
  version: string;
  transport: MCPTransportConfig;
  tools?: MCPTool[];
  resources?: MCPResource[];
  prompts?: MCPPrompt[];
  capabilities?: MCPCapabilities;
}

/**
 * MCP transport configuration
 */
export interface MCPTransportConfig {
  type: 'stdio' | 'http' | 'websocket';
  port?: number;
  host?: string;
  path?: string;
}

/**
 * MCP resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  handler: () => Promise<MCPResourceContent['resource']>;
}

/**
 * MCP prompt definition
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
  handler: (args: Record<string, string>) => Promise<MCPPromptResult>;
}

/**
 * MCP prompt argument
 */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * MCP prompt result
 */
export interface MCPPromptResult {
  messages: MCPPromptMessage[];
}

/**
 * MCP prompt message
 */
export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: MCPContent;
}

/**
 * MCP capabilities
 */
export interface MCPCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
  logging?: boolean;
  experimental?: Record<string, boolean>;
}

/**
 * MCP request types
 */
export type MCPRequest =
  | MCPInitializeRequest
  | MCPToolCallRequest
  | MCPResourceReadRequest
  | MCPPromptGetRequest
  | MCPListRequest;

/**
 * MCP initialize request
 */
export interface MCPInitializeRequest {
  method: 'initialize';
  params: {
    protocolVersion: string;
    capabilities: MCPCapabilities;
    clientInfo: {
      name: string;
      version: string;
    };
  };
}

/**
 * MCP tool call request
 */
export interface MCPToolCallRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * MCP resource read request
 */
export interface MCPResourceReadRequest {
  method: 'resources/read';
  params: {
    uri: string;
  };
}

/**
 * MCP prompt get request
 */
export interface MCPPromptGetRequest {
  method: 'prompts/get';
  params: {
    name: string;
    arguments?: Record<string, string>;
  };
}

/**
 * MCP list request
 */
export interface MCPListRequest {
  method: 'tools/list' | 'resources/list' | 'prompts/list';
  params?: Record<string, unknown>;
}

/**
 * MCP response types
 */
export interface MCPResponse<T = unknown> {
  id: string | number;
  result?: T;
  error?: MCPError;
}

/**
 * MCP error
 */
export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * MCP event payloads
 */
export interface MCPEventPayloads {
  'mcp:initialized': {
    serverName: string;
    version: string;
    capabilities: MCPCapabilities;
  };
  'mcp:tool:called': {
    toolName: string;
    arguments: Record<string, unknown>;
    duration: number;
    success: boolean;
  };
  'mcp:resource:read': {
    uri: string;
    mimeType?: string;
    size: number;
  };
  'mcp:prompt:executed': {
    promptName: string;
    arguments: Record<string, string>;
    messageCount: number;
  };
  'mcp:error': {
    error: MCPError;
    request?: MCPRequest;
  };
  'mcp:shutdown': {
    reason: string;
  };
}

/**
 * MCP server status
 */
export interface MCPServerStatus {
  running: boolean;
  transport: MCPTransportConfig['type'];
  connectedClients: number;
  toolsRegistered: number;
  resourcesRegistered: number;
  promptsRegistered: number;
  requestsHandled: number;
  errorsCount: number;
  uptime: number;
}
