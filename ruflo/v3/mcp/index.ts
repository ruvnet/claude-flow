/**
 * V3 MCP Module
 *
 * Optimized MCP (Model Context Protocol) implementation for Claude-Flow V3
 *
 * Features:
 * - High-performance server with <400ms startup
 * - Connection pooling with max 10 connections
 * - Multiple transport support (stdio, http, websocket, in-process)
 * - Fast tool registry with <10ms registration
 * - Session management with timeout handling
 * - Comprehensive metrics and monitoring
 *
 * Performance Targets:
 * - Server startup: <400ms
 * - Tool registration: <10ms
 * - Tool execution: <50ms overhead
 * - Connection acquire: <5ms
 *
 * @module @claude-flow/mcp
 * @version 3.0.0
 */

// Core types
export {
  // Protocol types
  JsonRpcVersion,
  RequestId,
  MCPMessage,
  MCPRequest,
  MCPResponse,
  MCPNotification,
  MCPError,

  // Server configuration
  TransportType,
  AuthMethod,
  AuthConfig,
  LoadBalancerConfig,
  ConnectionPoolConfig,
  MCPServerConfig,

  // Session types
  SessionState,
  MCPSession,
  MCPClientInfo,

  // Capability types
  MCPCapabilities,
  MCPProtocolVersion,
  MCPInitializeParams,
  MCPInitializeResult,

  // Tool types
  JSONSchema,
  ToolContext,
  ToolHandler,
  MCPTool,
  ToolCallResult,
  ToolRegistrationOptions,

  // Transport types
  RequestHandler,
  NotificationHandler,
  TransportHealthStatus,
  ITransport,

  // Connection pool types
  ConnectionState,
  PooledConnection,
  ConnectionPoolStats,
  IConnectionPool,

  // Metrics types
  ToolCallMetrics,
  MCPServerMetrics,
  SessionMetrics,

  // Event types
  MCPEventType,
  MCPEvent,
  EventHandler,

  // Logger
  LogLevel,
  ILogger,

  // Error handling
  ErrorCodes,
  MCPServerError,
} from './types.js';

// Server
export {
  MCPServer,
  IMCPServer,
  createMCPServer,
} from './server.js';

// Tool Registry
export {
  ToolRegistry,
  createToolRegistry,
  defineTool,
} from './tool-registry.js';

// Session Manager
export {
  SessionManager,
  SessionConfig,
  createSessionManager,
} from './session-manager.js';

// Connection Pool
export {
  ConnectionPool,
  createConnectionPool,
} from './connection-pool.js';

// Transport layer
export {
  // Factory
  createTransport,
  createInProcessTransport,
  TransportManager,
  createTransportManager,
  TransportConfig,
  DEFAULT_TRANSPORT_CONFIGS,

  // Specific transports
  StdioTransport,
  StdioTransportConfig,
  HttpTransport,
  HttpTransportConfig,
  WebSocketTransport,
  WebSocketTransportConfig,
} from './transport/index.js';

/**
 * Quick start function to create and configure an MCP server
 *
 * @example
 * ```typescript
 * import { quickStart } from '@claude-flow/mcp';
 *
 * const server = await quickStart({
 *   transport: 'stdio',
 *   name: 'My MCP Server',
 * });
 *
 * // Register custom tools
 * server.registerTool({
 *   name: 'my-tool',
 *   description: 'My custom tool',
 *   inputSchema: { type: 'object', properties: {} },
 *   handler: async () => ({ result: 'success' }),
 * });
 *
 * // Start server
 * await server.start();
 * ```
 */
export async function quickStart(
  config: Partial<MCPServerConfig>,
  logger?: ILogger
): Promise<MCPServer> {
  // Create default logger if not provided
  const defaultLogger: ILogger = logger || {
    debug: (msg, data) => console.debug(`[DEBUG] ${msg}`, data || ''),
    info: (msg, data) => console.info(`[INFO] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[WARN] ${msg}`, data || ''),
    error: (msg, data) => console.error(`[ERROR] ${msg}`, data || ''),
  };

  const server = createMCPServer(config, defaultLogger);

  return server;
}

/**
 * Module version
 */
export const VERSION = '3.0.0';

/**
 * Module name
 */
export const MODULE_NAME = '@claude-flow/mcp';
