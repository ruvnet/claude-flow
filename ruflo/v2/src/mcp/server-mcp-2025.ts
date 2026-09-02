/**
 * MCP 2025-11 Enhanced Server
 *
 * Integrates all MCP 2025-11 features with full backward compatibility:
 * - Version negotiation
 * - Async job support
 * - Registry integration
 * - JSON Schema 1.1 validation
 * - Dual-mode operation (2025-11 + legacy)
 */

import type { ILogger } from '../interfaces/logger.js';
import type { IEventBus } from '../interfaces/event-bus.js';
import { VersionNegotiator, BackwardCompatibilityAdapter, type MCPHandshake, type MCPVersion, type MCPCapability } from './protocol/version-negotiation.js';
import { MCPAsyncJobManager, type MCPToolRequest, type MCPJobHandle, type MCPJobResult } from './async/job-manager-mcp25.js';
import { MCPRegistryClient, type RegistryConfig } from './registry/mcp-registry-client-2025.js';
import { SchemaValidator, upgradeToolSchema } from './validation/schema-validator-2025.js';
import { ProgressiveToolRegistry } from './tool-registry-progressive.js';

/**
 * MCP 2025-11 server configuration
 */
export interface MCP2025ServerConfig {
  serverId: string;
  transport: 'stdio' | 'http' | 'ws';

  // Version & capabilities
  enableMCP2025: boolean; // Feature flag for gradual rollout
  supportLegacyClients: boolean; // Backward compatibility

  // Async jobs
  async: {
    enabled: boolean;
    maxJobs?: number;
    jobTTL?: number;
    persistence?: 'memory' | 'redis' | 'sqlite';
  };

  // Registry
  registry: RegistryConfig;

  // Schema validation
  validation: {
    enabled: boolean;
    strictMode?: boolean;
  };

  // Tool registry
  toolsDirectory?: string;

  // Existing config
  orchestratorContext?: any;
}

/**
 * MCP 2025-11 Enhanced Server
 */
export class MCP2025Server {
  private versionNegotiator: VersionNegotiator;
  private compatibilityAdapter: BackwardCompatibilityAdapter;
  private jobManager?: MCPAsyncJobManager;
  private registryClient?: MCPRegistryClient;
  private schemaValidator: SchemaValidator;
  private toolRegistry: ProgressiveToolRegistry;

  // Session state
  private sessions: Map<string, {
    clientId: string;
    version: MCPVersion;
    capabilities: MCPCapability[];
    isLegacy: boolean;
    createdAt: number;
    lastAccess: number;
  }> = new Map();

  // Session management constants
  private readonly MAX_SESSIONS = 10000;
  private readonly SESSION_TTL = 3600000; // 1 hour
  private sessionCleanupInterval?: NodeJS.Timeout;

  constructor(
    private config: MCP2025ServerConfig,
    private eventBus: IEventBus,
    private logger: ILogger
  ) {
    // Initialize version negotiation
    this.versionNegotiator = new VersionNegotiator(logger);
    this.compatibilityAdapter = new BackwardCompatibilityAdapter(logger);

    // Initialize schema validator
    this.schemaValidator = new SchemaValidator(logger);

    // Initialize tool registry (progressive)
    this.toolRegistry = new ProgressiveToolRegistry({
      enableInProcess: true,
      enableMetrics: true,
      enableCaching: true,
      orchestratorContext: config.orchestratorContext,
      toolsDirectory: config.toolsDirectory,
    });

    this.logger.info('MCP 2025-11 server created', {
      serverId: config.serverId,
      mcp2025Enabled: config.enableMCP2025,
      legacySupport: config.supportLegacyClients,
    });
  }

  /**
   * Initialize server
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing MCP 2025-11 server');

    // Initialize tool registry
    await this.toolRegistry.initialize();

    // Start session cleanup interval
    this.sessionCleanupInterval = setInterval(
      () => this.cleanupExpiredSessions(),
      300000 // Every 5 minutes
    );

    // Initialize async job manager if enabled
    if (this.config.async.enabled) {
      this.jobManager = new MCPAsyncJobManager(
        null, // Use memory persistence for now
        this.logger,
        {
          maxJobs: this.config.async.maxJobs,
          jobTTL: this.config.async.jobTTL,
        }
      );

      this.logger.info('Async job manager initialized');
    }

    // Initialize registry client if enabled
    if (this.config.registry.enabled) {
      this.registryClient = new MCPRegistryClient(
        this.config.registry,
        this.logger,
        () => this.toolRegistry.getToolNames(),
        () => this.versionNegotiator.getServerCapabilities(),
        async () => this.getHealthStatus()
      );

      // Register with MCP Registry
      try {
        await this.registryClient.register();
      } catch (error) {
        this.logger.error('Failed to register with MCP Registry', { error });
        // Don't fail initialization if registry is unavailable
      }
    }

    this.logger.info('MCP 2025-11 server initialized successfully');
  }

  /**
   * Handle client connection/handshake
   */
  async handleHandshake(clientHandshake: any, sessionId: string): Promise<MCPHandshake> {
    // Check if legacy client
    const isLegacy = this.compatibilityAdapter.isLegacyRequest(clientHandshake);

    let handshake: MCPHandshake;
    if (isLegacy && this.config.supportLegacyClients) {
      this.logger.info('Legacy client detected, enabling compatibility mode', { sessionId });
      handshake = this.compatibilityAdapter.convertToModern(clientHandshake);
    } else {
      handshake = clientHandshake;
    }

    // Negotiate version and capabilities
    const negotiation = await this.versionNegotiator.negotiate(handshake);

    if (!negotiation.success) {
      throw new Error(`Version negotiation failed: ${negotiation.error}`);
    }

    // Enforce session limit
    if (this.sessions.size >= this.MAX_SESSIONS) {
      // Remove oldest session
      const oldestSession = Array.from(this.sessions.entries())
        .sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
      if (oldestSession) {
        this.sessions.delete(oldestSession[0]);
        this.logger.warn('Session limit reached, removed oldest session', {
          removedSessionId: oldestSession[0],
        });
      }
    }

    // Store session info
    const now = Date.now();
    this.sessions.set(sessionId, {
      clientId: handshake.client_id || 'unknown',
      version: negotiation.agreed_version,
      capabilities: negotiation.agreed_capabilities,
      isLegacy,
      createdAt: now,
      lastAccess: now,
    });

    // Create server handshake response
    const serverHandshake = this.versionNegotiator.createServerHandshake(
      this.config.serverId,
      this.config.transport,
      {
        name: 'Claude Flow',
        version: '2.7.32',
        description: 'Enterprise AI orchestration with MCP 2025-11 support',
      }
    );

    // Apply agreed version and capabilities
    serverHandshake.mcp_version = negotiation.agreed_version;
    serverHandshake.capabilities = negotiation.agreed_capabilities;

    this.logger.info('Handshake completed', {
      sessionId,
      version: serverHandshake.mcp_version,
      capabilities: serverHandshake.capabilities,
      isLegacy,
    });

    return serverHandshake;
  }

  /**
   * Handle tool call request (with async support)
   */
  async handleToolCall(
    request: MCPToolRequest | any,
    sessionId: string
  ): Promise<MCPJobHandle | MCPJobResult | any> {
    const session = this.sessions.get(sessionId);

    // Update last access time
    if (session) {
      session.lastAccess = Date.now();
    }

    // Handle legacy request format
    if (session?.isLegacy) {
      return this.handleLegacyToolCall(request, sessionId);
    }

    // MCP 2025-11 format
    const mcpRequest = request as MCPToolRequest;

    // Validate request
    if (!mcpRequest.tool_id) {
      throw new Error('Missing tool_id in request');
    }

    // Get tool
    const tool = await this.toolRegistry.getTool(mcpRequest.tool_id);
    if (!tool) {
      throw new Error(`Tool not found: ${mcpRequest.tool_id}`);
    }

    // Validate input if validation enabled
    if (this.config.validation.enabled) {
      const validation = this.schemaValidator.validateInput(
        upgradeToolSchema(tool.inputSchema),
        mcpRequest.arguments
      );

      if (!validation.valid) {
        throw new Error(
          `Invalid input: ${validation.errors?.map(e => e.message).join(', ')}`
        );
      }
    }

    // Check if async mode requested
    const hasAsyncCapability = session?.capabilities.includes('async');
    const isAsyncRequest = mcpRequest.mode === 'async' && hasAsyncCapability;

    if (isAsyncRequest && this.jobManager) {
      // Submit as async job
      this.logger.info('Submitting async job', {
        tool_id: mcpRequest.tool_id,
        request_id: mcpRequest.request_id,
      });

      return await this.jobManager.submitJob(
        mcpRequest,
        async (args, onProgress) => {
          // Execute tool with progress tracking
          return await tool.handler(args, {
            orchestrator: this.config.orchestratorContext,
            sessionId,
          });
        }
      );
    } else {
      // Execute synchronously
      this.logger.info('Executing tool synchronously', {
        tool_id: mcpRequest.tool_id,
        request_id: mcpRequest.request_id,
      });

      const startTime = Date.now();
      const result = await tool.handler(mcpRequest.arguments, {
        orchestrator: this.config.orchestratorContext,
        sessionId,
      });

      // Validate output if validation enabled
      if (this.config.validation.enabled && tool.metadata?.outputSchema) {
        const validation = this.schemaValidator.validateOutput(
          tool.metadata.outputSchema,
          result
        );

        if (!validation.valid) {
          this.logger.warn('Output validation failed', {
            tool_id: mcpRequest.tool_id,
            errors: validation.errors,
          });
        }
      }

      // Return in MCP 2025-11 format
      return {
        request_id: mcpRequest.request_id,
        status: 'success',
        result,
        metadata: {
          duration_ms: Date.now() - startTime,
        },
      } as MCPJobResult;
    }
  }

  /**
   * Handle legacy tool call
   */
  private async handleLegacyToolCall(request: any, sessionId: string): Promise<any> {
    this.logger.info('Handling legacy tool call', {
      toolName: request.name || request.method,
      sessionId,
    });

    // Convert to modern format internally
    const toolId = request.name || request.method;
    const args = request.arguments || request.params || {};

    const tool = await this.toolRegistry.getTool(toolId);
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    const result = await tool.handler(args, {
      orchestrator: this.config.orchestratorContext,
      sessionId,
    });

    // Return in legacy format
    return this.compatibilityAdapter.convertToLegacy(
      { result, status: 'success' },
      true
    );
  }

  /**
   * Poll async job
   */
  async pollJob(job_id: string): Promise<MCPJobHandle> {
    if (!this.jobManager) {
      throw new Error('Async jobs not enabled');
    }

    return await this.jobManager.pollJob(job_id);
  }

  /**
   * Resume async job (get results)
   */
  async resumeJob(job_id: string): Promise<MCPJobResult> {
    if (!this.jobManager) {
      throw new Error('Async jobs not enabled');
    }

    return await this.jobManager.resumeJob(job_id);
  }

  /**
   * Cancel async job
   */
  async cancelJob(job_id: string): Promise<boolean> {
    if (!this.jobManager) {
      throw new Error('Async jobs not enabled');
    }

    return await this.jobManager.cancelJob(job_id);
  }

  /**
   * List async jobs
   */
  async listJobs(filter?: { status?: string; limit?: number }) {
    if (!this.jobManager) {
      throw new Error('Async jobs not enabled');
    }

    return await this.jobManager.listJobs(filter);
  }

  /**
   * Get health status
   */
  private async getHealthStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency_ms: number;
  }> {
    const startTime = Date.now();

    // Perform health checks
    const latency = Date.now() - startTime;

    // Determine status based on metrics
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    if (latency > 100) {
      status = 'degraded';
    }
    if (latency > 500) {
      status = 'unhealthy';
    }

    return { status, latency_ms: latency };
  }

  /**
   * Get metrics
   */
  getMetrics() {
    return {
      sessions: {
        total: this.sessions.size,
        byVersion: this.getSessionsByVersion(),
        legacy: Array.from(this.sessions.values()).filter(s => s.isLegacy).length,
      },
      jobs: this.jobManager?.getMetrics(),
      tools: this.toolRegistry.getMetrics(),
      validation: this.schemaValidator.getCacheStats(),
    };
  }

  private getSessionsByVersion() {
    const counts: Record<string, number> = {};
    for (const session of this.sessions.values()) {
      counts[session.version] = (counts[session.version] || 0) + 1;
    }
    return counts;
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      // Remove if last access was more than TTL ago
      if (now - session.lastAccess > this.SESSION_TTL) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info('Cleaned up expired sessions', { count: cleaned });
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up MCP 2025-11 server');

    // Stop session cleanup interval
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }

    // Unregister from registry
    if (this.registryClient) {
      await this.registryClient.unregister();
    }

    // Clear caches
    this.schemaValidator.clearCache();
    await this.toolRegistry.cleanup();

    // Clear sessions
    this.sessions.clear();

    this.logger.info('Cleanup complete');
  }
}
