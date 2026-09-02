/**
 * @claude-flow/mcp - MCP Server
 *
 * High-performance MCP server implementation
 */

import { EventEmitter } from 'events';
import { platform, arch } from 'os';
import type {
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
  ITransport,
  TransportType,
  ILogger,
  ToolContext,
} from './types.js';
import { MCPServerError, ErrorCodes } from './types.js';
import { ToolRegistry, createToolRegistry } from './tool-registry.js';
import { SessionManager, createSessionManager } from './session-manager.js';
import { ConnectionPool, createConnectionPool } from './connection-pool.js';
import { ResourceRegistry, createResourceRegistry } from './resource-registry.js';
import { PromptRegistry, createPromptRegistry } from './prompt-registry.js';
import { TaskManager, createTaskManager } from './task-manager.js';
import { createTransport, TransportManager, createTransportManager } from './transport/index.js';
import { RateLimiter, createRateLimiter, type RateLimitConfig } from './rate-limiter.js';
import { SamplingManager, createSamplingManager, type SamplingConfig, type LLMProvider } from './sampling.js';

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

export class MCPServer extends EventEmitter implements IMCPServer {
  private readonly config: MCPServerConfig;
  private readonly toolRegistry: ToolRegistry;
  private readonly sessionManager: SessionManager;
  private readonly resourceRegistry: ResourceRegistry;
  private readonly promptRegistry: PromptRegistry;
  private readonly taskManager: TaskManager;
  private readonly connectionPool?: ConnectionPool;
  private readonly transportManager: TransportManager;
  private readonly rateLimiter: RateLimiter;
  private readonly samplingManager: SamplingManager;
  private transport?: ITransport;
  private running = false;
  private startTime?: Date;
  private startupDuration?: number;
  private currentSession?: MCPSession;
  private resourceSubscriptions: Map<string, Set<string>> = new Map(); // sessionId -> subscribed URIs

  private readonly serverInfo = {
    name: 'Claude-Flow MCP Server V3',
    version: '3.0.0',
  };

  // MCP 2025-11-25 protocol version
  private readonly protocolVersion: MCPProtocolVersion = {
    major: 2025,
    minor: 11,
    patch: 25,
  };

  // Full MCP 2025-11-25 capabilities
  private capabilities: MCPCapabilities = {
    logging: { level: 'info' },
    tools: { listChanged: true },
    resources: { listChanged: true, subscribe: true },
    prompts: { listChanged: true },
    sampling: {},
  };

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

    this.toolRegistry = createToolRegistry(logger);
    this.sessionManager = createSessionManager(logger, {
      maxSessions: 100,
      sessionTimeout: 30 * 60 * 1000,
    });
    this.resourceRegistry = createResourceRegistry(logger, {
      enableSubscriptions: true,
      cacheEnabled: true,
      cacheTTL: 60000,
    });
    this.promptRegistry = createPromptRegistry(logger);
    this.taskManager = createTaskManager(logger, {
      maxConcurrentTasks: 10,
      taskTimeout: 300000,
    });
    this.transportManager = createTransportManager(logger);
    this.rateLimiter = createRateLimiter(logger, {
      requestsPerSecond: 100,
      burstSize: 200,
      perSessionLimit: 50,
    });
    this.samplingManager = createSamplingManager(logger);

    if (this.config.connectionPool) {
      this.connectionPool = createConnectionPool(
        this.config.connectionPool,
        logger,
        this.config.transport
      );
    }

    this.setupEventHandlers();
  }

  /**
   * Get resource registry for external registration
   */
  getResourceRegistry(): ResourceRegistry {
    return this.resourceRegistry;
  }

  /**
   * Get prompt registry for external registration
   */
  getPromptRegistry(): PromptRegistry {
    return this.promptRegistry;
  }

  /**
   * Get task manager for async operations
   */
  getTaskManager(): TaskManager {
    return this.taskManager;
  }

  /**
   * Get rate limiter for configuration
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  /**
   * Get sampling manager for LLM provider registration
   */
  getSamplingManager(): SamplingManager {
    return this.samplingManager;
  }

  /**
   * Register an LLM provider for sampling
   */
  registerLLMProvider(provider: LLMProvider, isDefault: boolean = false): void {
    this.samplingManager.registerProvider(provider, isDefault);
  }

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

      this.transport.onRequest(async (request) => {
        return await this.handleRequest(request);
      });

      this.transport.onNotification(async (notification) => {
        await this.handleNotification(notification);
      });

      await this.transport.start();
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

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.logger.info('Stopping MCP server');

    try {
      if (this.transport) {
        await this.transport.stop();
        this.transport = undefined;
      }

      this.sessionManager.clearAll();
      this.taskManager.destroy();
      this.resourceSubscriptions.clear();
      this.rateLimiter.destroy();

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

  registerTool(tool: MCPTool): boolean {
    return this.toolRegistry.register(tool);
  }

  registerTools(tools: MCPTool[]): { registered: number; failed: string[] } {
    return this.toolRegistry.registerBatch(tools);
  }

  unregisterTool(name: string): boolean {
    return this.toolRegistry.unregister(name);
  }

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

  getSessions(): MCPSession[] {
    return this.sessionManager.getActiveSessions();
  }

  getSession(sessionId: string): MCPSession | undefined {
    return this.sessionManager.getSession(sessionId);
  }

  terminateSession(sessionId: string): boolean {
    const result = this.sessionManager.closeSession(sessionId, 'Terminated by server');
    if (this.currentSession?.id === sessionId) {
      this.currentSession = undefined;
    }
    return result;
  }

  private async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const startTime = performance.now();
    this.requestStats.total++;

    this.logger.debug('Handling request', {
      id: request.id,
      method: request.method,
    });

    // Rate limiting check (skip for initialize)
    if (request.method !== 'initialize') {
      const sessionId = this.currentSession?.id;
      const rateLimitResult = this.rateLimiter.check(sessionId);
      if (!rateLimitResult.allowed) {
        this.requestStats.failed++;
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: 'Rate limit exceeded',
            data: { retryAfter: rateLimitResult.retryAfter },
          },
        };
      }
      this.rateLimiter.consume(sessionId);
    }

    try {
      if (request.method === 'initialize') {
        return await this.handleInitialize(request);
      }

      const session = this.getOrCreateSession();

      if (!session.isInitialized && request.method !== 'initialized') {
        return this.createErrorResponse(
          request.id,
          ErrorCodes.SERVER_NOT_INITIALIZED,
          'Server not initialized'
        );
      }

      this.sessionManager.updateActivity(session.id);

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

  private async handleInitialize(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as unknown as MCPInitializeParams | undefined;

    if (!params) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Invalid params'
      );
    }

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

  private async routeRequest(request: MCPRequest): Promise<MCPResponse> {
    switch (request.method) {
      // Tool methods
      case 'tools/list':
        return this.handleToolsList(request);
      case 'tools/call':
        return this.handleToolsCall(request);

      // Resource methods (MCP 2025-11-25)
      case 'resources/list':
        return this.handleResourcesList(request);
      case 'resources/read':
        return this.handleResourcesRead(request);
      case 'resources/subscribe':
        return this.handleResourcesSubscribe(request);
      case 'resources/unsubscribe':
        return this.handleResourcesUnsubscribe(request);

      // Prompt methods (MCP 2025-11-25)
      case 'prompts/list':
        return this.handlePromptsList(request);
      case 'prompts/get':
        return this.handlePromptsGet(request);

      // Task methods (MCP 2025-11-25)
      case 'tasks/status':
        return this.handleTasksStatus(request);
      case 'tasks/cancel':
        return this.handleTasksCancel(request);

      // Completion (MCP 2025-11-25)
      case 'completion/complete':
        return this.handleCompletion(request);

      // Logging (MCP 2025-11-25)
      case 'logging/setLevel':
        return this.handleLoggingSetLevel(request);

      // Sampling (MCP 2025-11-25)
      case 'sampling/createMessage':
        return this.handleSamplingCreateMessage(request);

      // Utility
      case 'ping':
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: { pong: true, timestamp: Date.now() },
        };

      default:
        // Check if it's a direct tool call
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

  // ============================================================================
  // Resource Handlers (MCP 2025-11-25)
  // ============================================================================

  private handleResourcesList(request: MCPRequest): MCPResponse {
    const params = request.params as { cursor?: string } | undefined;
    const result = this.resourceRegistry.list(params?.cursor);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }

  private async handleResourcesRead(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as { uri: string } | undefined;

    if (!params?.uri) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Resource URI is required'
      );
    }

    try {
      const result = await this.resourceRegistry.read(params.uri);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        error instanceof Error ? error.message : 'Resource read failed'
      );
    }
  }

  private handleResourcesSubscribe(request: MCPRequest): MCPResponse {
    const params = request.params as { uri: string } | undefined;
    const sessionId = this.currentSession?.id;

    if (!params?.uri) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Resource URI is required'
      );
    }

    if (!sessionId) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.SERVER_NOT_INITIALIZED,
        'No active session'
      );
    }

    try {
      // Track subscription for this session
      let sessionSubs = this.resourceSubscriptions.get(sessionId);
      if (!sessionSubs) {
        sessionSubs = new Set();
        this.resourceSubscriptions.set(sessionId, sessionSubs);
      }

      const subscriptionId = this.resourceRegistry.subscribe(params.uri, (uri, content) => {
        // Send notification when resource updates
        this.sendNotification('notifications/resources/updated', { uri });
      });

      sessionSubs.add(params.uri);

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { subscriptionId },
      };
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Subscription failed'
      );
    }
  }

  private handleResourcesUnsubscribe(request: MCPRequest): MCPResponse {
    const params = request.params as { uri: string } | undefined;
    const sessionId = this.currentSession?.id;

    if (!params?.uri) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Resource URI is required'
      );
    }

    if (sessionId) {
      const sessionSubs = this.resourceSubscriptions.get(sessionId);
      if (sessionSubs) {
        sessionSubs.delete(params.uri);
      }
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { success: true },
    };
  }

  // ============================================================================
  // Prompt Handlers (MCP 2025-11-25)
  // ============================================================================

  private handlePromptsList(request: MCPRequest): MCPResponse {
    const params = request.params as { cursor?: string } | undefined;
    const result = this.promptRegistry.list(params?.cursor);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };
  }

  private async handlePromptsGet(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as { name: string; arguments?: Record<string, string> } | undefined;

    if (!params?.name) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Prompt name is required'
      );
    }

    try {
      const result = await this.promptRegistry.get(params.name, params.arguments);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        error instanceof Error ? error.message : 'Prompt get failed'
      );
    }
  }

  // ============================================================================
  // Task Handlers (MCP 2025-11-25)
  // ============================================================================

  private handleTasksStatus(request: MCPRequest): MCPResponse {
    const params = request.params as { taskId?: string } | undefined;

    if (params?.taskId) {
      const task = this.taskManager.getTask(params.taskId);
      if (!task) {
        return this.createErrorResponse(
          request.id,
          ErrorCodes.INVALID_PARAMS,
          `Task not found: ${params.taskId}`
        );
      }
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: task,
      };
    }

    // Return all tasks
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { tasks: this.taskManager.getAllTasks() },
    };
  }

  private handleTasksCancel(request: MCPRequest): MCPResponse {
    const params = request.params as { taskId: string; reason?: string } | undefined;

    if (!params?.taskId) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Task ID is required'
      );
    }

    const success = this.taskManager.cancelTask(params.taskId, params.reason);

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { success },
    };
  }

  // ============================================================================
  // Completion Handler (MCP 2025-11-25)
  // ============================================================================

  private handleCompletion(request: MCPRequest): MCPResponse {
    const params = request.params as {
      ref: { type: string; name?: string; uri?: string };
      argument: { name: string; value: string };
    } | undefined;

    if (!params?.ref || !params?.argument) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Completion reference and argument are required'
      );
    }

    // Basic completion implementation - can be extended
    const completions: string[] = [];

    if (params.ref.type === 'ref/prompt') {
      // Get prompt argument completions
      const prompt = this.promptRegistry.getPrompt(params.ref.name || '');
      if (prompt?.arguments) {
        for (const arg of prompt.arguments) {
          if (arg.name === params.argument.name) {
            // Could add domain-specific completions here
          }
        }
      }
    } else if (params.ref.type === 'ref/resource') {
      // Get resource URI completions
      const { resources } = this.resourceRegistry.list();
      for (const resource of resources) {
        if (resource.uri.startsWith(params.argument.value)) {
          completions.push(resource.uri);
        }
      }
    }

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        completion: {
          values: completions.slice(0, 10),
          total: completions.length,
          hasMore: completions.length > 10,
        },
      },
    };
  }

  // ============================================================================
  // Logging Handler (MCP 2025-11-25)
  // ============================================================================

  private handleLoggingSetLevel(request: MCPRequest): MCPResponse {
    const params = request.params as { level: string } | undefined;

    if (!params?.level) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'Log level is required'
      );
    }

    // Update capabilities
    this.capabilities.logging = { level: params.level as 'debug' | 'info' | 'warn' | 'error' };

    this.logger.info('Log level updated', { level: params.level });

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { success: true },
    };
  }

  // ============================================================================
  // Sampling Handler (MCP 2025-11-25)
  // ============================================================================

  private async handleSamplingCreateMessage(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params as {
      messages: Array<{ role: string; content: { type: string; text?: string } }>;
      maxTokens: number;
      systemPrompt?: string;
      modelPreferences?: { hints?: Array<{ name?: string }>; intelligencePriority?: number; speedPriority?: number; costPriority?: number };
      includeContext?: string;
      temperature?: number;
      stopSequences?: string[];
      metadata?: Record<string, unknown>;
    } | undefined;

    if (!params?.messages || !params?.maxTokens) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INVALID_PARAMS,
        'messages and maxTokens are required'
      );
    }

    // Check if sampling is available
    const available = await this.samplingManager.isAvailable();
    if (!available) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INTERNAL_ERROR,
        'No LLM provider available for sampling'
      );
    }

    try {
      const result = await this.samplingManager.createMessage(
        {
          messages: params.messages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content as any,
          })),
          maxTokens: params.maxTokens,
          systemPrompt: params.systemPrompt,
          modelPreferences: params.modelPreferences,
          includeContext: params.includeContext as 'none' | 'thisServer' | 'allServers' | undefined,
          temperature: params.temperature,
          stopSequences: params.stopSequences,
          metadata: params.metadata,
        },
        {
          sessionId: this.currentSession?.id || 'unknown',
          serverId: this.serverInfo.name,
        }
      );

      return {
        jsonrpc: '2.0',
        id: request.id,
        result,
      };
    } catch (error) {
      return this.createErrorResponse(
        request.id,
        ErrorCodes.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Sampling failed'
      );
    }
  }

  // ============================================================================
  // Notification Sender
  // ============================================================================

  private async sendNotification(method: string, params?: Record<string, unknown>): Promise<void> {
    if (this.transport?.sendNotification) {
      await this.transport.sendNotification({
        jsonrpc: '2.0',
        method,
        params,
      });
    }
  }

  private getOrCreateSession(): MCPSession {
    if (this.currentSession) {
      return this.currentSession;
    }

    const session = this.sessionManager.createSession(this.config.transport);
    this.currentSession = session;
    return session;
  }

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

  private async registerBuiltInTools(): Promise<void> {
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

    this.registerTool({
      name: 'system/health',
      description: 'Get system health status',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => await this.getHealthStatus(),
      category: 'system',
      cacheable: true,
      cacheTTL: 2000,
    });

    this.registerTool({
      name: 'system/metrics',
      description: 'Get server metrics',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => this.getMetrics(),
      category: 'system',
      cacheable: true,
      cacheTTL: 1000,
    });

    this.registerTool({
      name: 'tools/list-detailed',
      description: 'List all registered tools with details',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Filter by category' },
        },
      },
      handler: async (input: unknown) => {
        const params = input as { category?: string };
        if (params.category) {
          return this.toolRegistry.getByCategory(params.category);
        }
        return this.toolRegistry.listTools();
      },
      category: 'system',
    });

    this.logger.info('Built-in tools registered', {
      count: 4,
    });
  }

  private setupEventHandlers(): void {
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

export function createMCPServer(
  config: Partial<MCPServerConfig>,
  logger: ILogger,
  orchestrator?: unknown,
  swarmCoordinator?: unknown
): MCPServer {
  return new MCPServer(config, logger, orchestrator, swarmCoordinator);
}
