/**
 * V3 MCP Server Implementation
 *
 * Optimized MCP server with:
 * - Connection pooling for efficient resource usage
 * - Fast tool registration (<10ms)
 * - Optimized request routing (<50ms overhead)
 * - Multiple transport support (stdio, http, websocket, in-process)
 * - Session management with timeout handling
 * - Comprehensive metrics and monitoring
 *
 * Performance Targets:
 * - Server startup: <400ms
 * - Tool registration: <10ms
 * - Tool execution: <50ms overhead
 */

import { EventEmitter } from 'events';
import { platform, arch } from 'os';
import {
  MCPServerConfig,
  MCPRequest,
  MCPResponse,
  MCPNotification,
  MCPSession,
  MCPTool,
  MCPInitializeParams,
  MCPInitializeResult,
  MCPCapabilities,
  MCPProtocolVersion,
  MCPServerMetrics,
  MCPServerError,
  ErrorCodes,
  ITransport,
  TransportType,
  ILogger,
  ToolContext,
} from './types.js';
import { ToolRegistry, createToolRegistry } from './tool-registry.js';
import { SessionManager, createSessionManager } from './session-manager.js';
import { ConnectionPool, createConnectionPool } from './connection-pool.js';
import { createTransport, TransportManager, createTransportManager } from './transport/index.js';

/**
 * Default server configuration
 */
const DEFAULT_CONFIG: Partial<MCPServerConfig> = {
  name: 'Claude-Flow MCP Server V3',
  version: '3.0.0',
  transport: 'stdio',
  host: 'localhost',
  port: 3000,
  enableMetrics: true,
  enableCaching: true,
  cacheTTL: 10000,
  logLevel: 'info',
  requestTimeout: 30000,
  maxRequestSize: 10 * 1024 * 1024,
};

/**
 * MCP Server Interface
 */
export interface IMCPServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  registerTool(tool: MCPTool): boolean;
  registerTools(tools: MCPTool[]): { registered: number; failed: string[] };
  getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }>;
  getMetrics(): MCPServerMetrics;
  getSessions(): MCPSession[];
  getSession(sessionId: string): MCPSession | undefined;
  terminateSession(sessionId: string): boolean;
}

/**
 * V3 MCP Server
 */
export class MCPServer extends EventEmitter implements IMCPServer {
  private readonly config: MCPServerConfig;
  private readonly toolRegistry: ToolRegistry;
  private readonly sessionManager: SessionManager;
  private readonly connectionPool?: ConnectionPool;
  private readonly transportManager: TransportManager;
  private transport?: ITransport;
  private running = false;
  private startTime?: Date;
  private startupDuration?: number;
  private currentSession?: MCPSession;

  // Server information
  private readonly serverInfo = {
    name: 'Claude-Flow MCP Server V3',
    version: '3.0.0',
  };

  // Protocol version
  private readonly protocolVersion: MCPProtocolVersion = {
    major: 2024,
    minor: 11,
    patch: 5,
  };

  // Server capabilities
  private readonly capabilities: MCPCapabilities = {
    logging: { level: 'info' },
    tools: { listChanged: true },
    resources: { listChanged: false, subscribe: false },
    prompts: { listChanged: false },
  };

  // Request statistics
  private requestStats = {
    total: 0,
    successful: 0,
    failed: 0,
    totalResponseTime: 0,
  };

  constructor(
    config: Partial<MCPServerConfig>,
    private readonly logger: ILogger,
    private readonly orchestrator?: unknown,
    private readonly swarmCoordinator?: unknown
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config } as MCPServerConfig;

    // Initialize components
    this.toolRegistry = createToolRegistry(logger);
    this.sessionManager = createSessionManager(logger, {
      maxSessions: 100,
      sessionTimeout: 30 * 60 * 1000,
    });
    this.transportManager = createTransportManager(logger);

    // Initialize connection pool if enabled
    if (this.config.connectionPool) {
      this.connectionPool = createConnectionPool(
        this.config.connectionPool,
        logger,
        this.config.transport
      );
    }

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new MCPServerError('Server already running');
    }

    const startTime = performance.now();
    this.startTime = new Date();

    this.logger.info('Starting MCP server', {
      name: this.config.name,
      version: this.config.version,
      transport: this.config.transport,
    });

    try {
      // Create and start transport
      this.transport = createTransport(this.config.transport, this.logger, {
        type: this.config.transport,
        host: this.config.host,
        port: this.config.port,
        corsEnabled: this.config.corsEnabled,
        corsOrigins: this.config.corsOrigins,
        auth: this.config.auth,
        maxRequestSize: String(this.config.maxRequestSize),
        requestTimeout: this.config.requestTimeout,
      } as any);

      // Setup request handler
      this.transport.onRequest(async (request) => {
        return await this.handleRequest(request);
      });

      // Setup notification handler
      this.transport.onNotification(async (notification) => {
        await this.handleNotification(notification);
      });

      // Start transport
      await this.transport.start();

      // Register built-in tools
      await this.registerBuiltInTools();

      this.running = true;
      this.startupDuration = performance.now() - startTime;

      this.logger.info('MCP server started', {
        startupTime: `${this.startupDuration.toFixed(2)}ms`,
        tools: this.toolRegistry.getToolCount(),
      });

      this.emit('server:started', {
        startupTime: this.startupDuration,
        tools: this.toolRegistry.getToolCount(),
      });

    } catch (error) {
      this.logger.error('Failed to start MCP server', { error });
      throw new MCPServerError('Failed to start server', ErrorCodes.INTERNAL_ERROR, { error });
    }
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping MCP server');

    try {
      // Stop transport
      if (this.transport) {
        await this.transport.stop();
        this.transport = undefined;
      }

      // Clear sessions
      this.sessionManager.clearAll();

      // Clear connection pool
      if (this.connectionPool) {
        await this.connectionPool.clear();
      }

      this.running = false;
      this.currentSession = undefined;

      this.logger.info('MCP server stopped');
      this.emit('server:stopped');

    } catch (error) {
      this.logger.error('Error stopping MCP server', { error });
      throw error;
    }
  }

  /**
   * Register a tool
   */
  registerTool(tool: MCPTool): boolean {
    return this.toolRegistry.register(tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: MCPTool[]): { registered: number; failed: string[] } {
    return this.toolRegistry.registerBatch(tools);
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    return this.toolRegistry.unregister(name);
  }

  /**
   * Get health status
   */
  async getHealthStatus(): Promise<{
    healthy: boolean;
    error?: string;
    metrics?: Record<string, number>;
  }> {
    try {
      const transportHealth = this.transport
        ? await this.transport.getHealthStatus()
        : { healthy: false, error: 'Transport not initialized' };

      const sessionMetrics = this.sessionManager.getSessionMetrics();
      const poolStats = this.connectionPool?.getStats();

      const metrics: Record<string, number> = {
        registeredTools: this.toolRegistry.getToolCount(),
        totalRequests: this.requestStats.total,
        successfulRequests: this.requestStats.successful,
        failedRequests: this.requestStats.failed,
        totalSessions: sessionMetrics.total,
        activeSessions: sessionMetrics.active,
        ...(transportHealth.metrics || {}),
      };

      if (poolStats) {
        metrics.poolConnections = poolStats.totalConnections;
        metrics.poolIdleConnections = poolStats.idleConnections;
        metrics.poolBusyConnections = poolStats.busyConnections;
      }

      return {
        healthy: this.running && transportHealth.healthy,
        error: transportHealth.error,
        metrics,
      };

    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get server metrics
   */
  getMetrics(): MCPServerMetrics {
    const sessionMetrics = this.sessionManager.getSessionMetrics();
    const registryStats = this.toolRegistry.getStats();

    return {
      totalRequests: this.requestStats.total,
      successfulRequests: this.requestStats.successful,
      failedRequests: this.requestStats.failed,
      averageResponseTime: this.requestStats.total > 0
        ? this.requestStats.totalResponseTime / this.requestStats.total
        : 0,
      activeSessions: sessionMetrics.active,
      toolInvocations: Object.fromEntries(
        registryStats.topTools.map((t) => [t.name, t.calls])
      ),
      errors: {},
      lastReset: this.startTime || new Date(),
      startupTime: this.startupDuration,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
    };
  }

  /**
   * Get all sessions
   */
  getSessions(): MCPSession[] {
    return this.sessionManager.getActiveSessions();
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): MCPSession | undefined {
    return this.sessionManager.getSession(sessionId);
  }

  /**
   * Terminate a session
   */
  terminateSession(sessionId: string): boolean {
    const result = this.sessionManager.closeSession(sessionId, 'Terminated by server');
    if (this.currentSession?.id === sessionId) {
      this.currentSession = undefined;
    }
    return result;
  }

  /**
   * Handle incoming request
   */
  private async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const startTime = performance.now();
    this.requestStats.total++;

    this.logger.debug('Handling request', {
      id: request.id,
      method: request.method,
    });

    try {
      // Handle initialization
      if (request.method === 'initialize') {
        return await this.handleInitialize(request);
      }

      // Get or create session
      const session = this.getOrCreateSession();

      // Check initialization
      if (!session.isInitialized && request.method !== 'initialized') {
        return this.createErrorResponse(
          request.id,
          ErrorCodes.SERVER_NOT_INITIALIZED,
          'Server not initialized'
        );
      }

      // Update session activity
      this.sessionManager.updateActivity(session.id);

      // Route request
      const response = await this.routeRequest(request);

      const duration = performance.now() - startTime;
      this.requestStats.successful++;
      this.requestStats.totalResponseTime += duration;

      this.logger.debug('Request completed', {
        id: request.id,
        method: request.method,
        duration: `${duration.toFixed(2)}ms`,
      });

      return response;

    } catch (error) {
      const duration = performance.now() - startTime;
      this.requestStats.failed++;
      this.requestStats.totalResponseTime += duration;

      this.logger.error('Request failed', {
        id: request.id,
        method: request.method,
        error,
      });

      return this.createErrorResponse(
        request.id,
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error'
      );
    }
  }

  /**
   * Handle notification
   */
  private async handleNotification(notification: MCPNotification): Promise<void> {
    this.logger.debug('Handling notification', { method: notification.method });

    switch (notification.method) {
      case 'initialized':
        this.logger.info('Client initialized notification received');
        break;

      case 'notifications/cancelled':
        this.logger.debug('Request cancelled', notification.params);
        break;

      default:
        this.logger.debug('Unknown notification', { method: notification.method });
    }
  }

  /**
   * Handle initialize request
   */
  private async handleInitialize(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as MCPInitializeParams;

    if (!params) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Invalid params'
      );
    }

    // Create and initialize session
    const session = this.sessionManager.createSession(this.config.transport);
    this.sessionManager.initializeSession(session.id, params);
    this.currentSession = session;

    const result: MCPInitializeResult = {
      protocolVersion: this.protocolVersion,
      capabilities: this.capabilities,
      serverInfo: this.serverInfo,
      instructions: 'Claude-Flow MCP Server V3 ready for tool execution',
    };

    this.logger.info('Session initialized', {
      sessionId: session.id,
      clientInfo: params.clientInfo,
    });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }

  /**
   * Route request to appropriate handler
   */
  private async routeRequest(request: MCPRequest): Promise<MCPResponse> {
    switch (request.method) {
      case 'tools/list':
        return this.handleToolsList(request);

      case 'tools/call':
        return this.handleToolsCall(request);

      case 'resources/list':
        return this.handleResourcesList(request);

      case 'prompts/list':
        return this.handlePromptsList(request);

      case 'ping':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { pong: true, timestamp: Date.now() },
        };

      default:
        // Try to execute as tool call (backwards compatibility)
        if (this.toolRegistry.hasTool(request.method)) {
          return this.handleToolExecution(request);
        }

        return this.createErrorResponse(
          request.id,
          ErrorCodes.METHOD_NOT_FOUND,
          `Method not found: ${request.method}`
        );
    }
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(request: MCPRequest): MCPResponse {
    const tools = this.toolRegistry.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: this.toolRegistry.getTool(t.name)?.inputSchema,
    }));

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { tools },
    };
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as { name: string; arguments?: Record<string, unknown> };

    if (!params?.name) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Tool name is required'
      );
    }

    const context: ToolContext = {
      sessionId: this.currentSession?.id || 'unknown',
      requestId: request.id,
      orchestrator: this.orchestrator,
      swarmCoordinator: this.swarmCoordinator,
    };

    const result = await this.toolRegistry.execute(
      params.name,
      params.arguments || {},
      context
    );

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }

  /**
   * Handle direct tool execution (backwards compatibility)
   */
  private async handleToolExecution(request: MCPRequest): Promise<MCPResponse> {
    const context: ToolContext = {
      sessionId: this.currentSession?.id || 'unknown',
      requestId: request.id,
      orchestrator: this.orchestrator,
      swarmCoordinator: this.swarmCoordinator,
    };

    const result = await this.toolRegistry.execute(
      request.method,
      (request.params as Record<string, unknown>) || {},
      context
    );

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }

  /**
   * Handle resources/list request
   */
  private handleResourcesList(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { resources: [] },
    };
  }

  /**
   * Handle prompts/list request
   */
  private handlePromptsList(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { prompts: [] },
    };
  }

  /**
   * Get or create current session
   */
  private getOrCreateSession(): MCPSession {
    if (this.currentSession) {
      return this.currentSession;
    }

    const session = this.sessionManager.createSession(this.config.transport);
    this.currentSession = session;
    return session;
  }

  /**
   * Create error response
   */
  private createErrorResponse(
    id: string | number | null,
    code: number,
    message: string
  ): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
  }

  /**
   * Register built-in tools
   */
  private async registerBuiltInTools(): Promise<void> {
    const startTime = performance.now();

    // Register all ADR-005 MCP-first tools
    const { getAllTools } = await import('./tools/index.js');
    const mcpTools = getAllTools();

    const mcpResult = this.registerTools(mcpTools);

    this.logger.info('MCP-first tools registered (ADR-005)', {
      registered: mcpResult.registered,
      failed: mcpResult.failed.length,
      failedTools: mcpResult.failed,
    });

    // System info tool
    this.registerTool({
      name: 'system/info',
      description: 'Get system information',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => ({
        name: this.serverInfo.name,
        version: this.serverInfo.version,
        platform: platform(),
        arch: arch(),
        runtime: 'Node.js',
        uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      }),
      category: 'system',
    });

    // Health check tool
    this.registerTool({
      name: 'system/health',
      description: 'Get system health status',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => await this.getHealthStatus(),
      category: 'system',
      cacheable: true,
      cacheTTL: 2000,
    });

    // Metrics tool
    this.registerTool({
      name: 'system/metrics',
      description: 'Get server metrics',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => this.getMetrics(),
      category: 'system',
      cacheable: true,
      cacheTTL: 1000,
    });

    // Tools list tool
    this.registerTool({
      name: 'tools/list-detailed',
      description: 'List all registered tools with details',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category' },
        },
      },
      handler: async (input: { category?: string }) => {
        if (input.category) {
          return this.toolRegistry.getByCategory(input.category);
        }
        return this.toolRegistry.listTools();
      },
      category: 'system',
    });

    const duration = performance.now() - startTime;

    this.logger.info('Built-in tools registered', {
      mcpTools: mcpResult.registered,
      systemTools: 4,
      totalTools: mcpResult.registered + 4,
      registrationTime: `${duration.toFixed(2)}ms`,
    });
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Tool events
    this.toolRegistry.on('tool:registered', (name) => {
      this.emit('tool:registered', name);
    });

    this.toolRegistry.on('tool:called', (data) => {
      this.emit('tool:called', data);
    });

    this.toolRegistry.on('tool:completed', (data) => {
      this.emit('tool:completed', data);
    });

    this.toolRegistry.on('tool:error', (data) => {
      this.emit('tool:error', data);
    });

    // Session events
    this.sessionManager.on('session:created', (session) => {
      this.emit('session:created', session);
    });

    this.sessionManager.on('session:closed', (data) => {
      this.emit('session:closed', data);
    });

    this.sessionManager.on('session:expired', (session) => {
      this.emit('session:expired', session);
    });
  }
}

/**
 * Create an MCP server instance
 */
export function createMCPServer(
  config: Partial<MCPServerConfig>,
  logger: ILogger,
  orchestrator?: unknown,
  swarmCoordinator?: unknown
): MCPServer {
  return new MCPServer(config, logger, orchestrator, swarmCoordinator);
}
