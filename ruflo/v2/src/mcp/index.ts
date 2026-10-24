/**
 * MCP (Model Context Protocol) Module
 * Export all MCP components for easy integration
 */

// Phase 6: In-Process MCP Server (10-100x performance improvement)
export { InProcessMCPServer, createInProcessServer } from './in-process-server.js';
export type { InProcessServerConfig, ToolCallMetrics } from './in-process-server.js';

export {
  ClaudeFlowToolRegistry,
  createToolRegistry,
  createClaudeFlowSdkServer,
} from './tool-registry.js';
export type { ToolRegistryConfig } from './tool-registry.js';

export {
  SDKIntegration,
  initializeSDKIntegration,
  getSDKIntegration,
  createInProcessQuery,
  getInProcessServerConfig,
  measurePerformance,
} from './sdk-integration.js';
export type { SDKIntegrationConfig } from './sdk-integration.js';

// Core MCP Server
export { MCPServer, type IMCPServer } from './server.js';

// MCP 2025-11 Server and Components
export { MCP2025Server, type MCP2025ServerConfig } from './server-mcp-2025.js';
export {
  MCPServerFactory,
  createMCPServer,
  isMCP2025Available,
  getServerCapabilities,
  type MCPFeatureFlags,
  type ExtendedMCPConfig,
} from './server-factory.js';

// MCP 2025-11 Protocol Components
export {
  VersionNegotiator,
  BackwardCompatibilityAdapter,
  type MCPHandshake,
  type MCPVersion,
  type MCPCapability,
  type NegotiationResult as MCP2025NegotiationResult,
} from './protocol/version-negotiation.js';

// MCP 2025-11 Async Job Management
export {
  MCPAsyncJobManager,
  type MCPToolRequest,
  type MCPJobHandle,
  type MCPJobResult,
  type AsyncJob,
  type JobStatus,
} from './async/job-manager-mcp25.js';

// MCP 2025-11 Registry Integration
export {
  MCPRegistryClient,
  type RegistryConfig,
  type ServerRegistryEntry,
} from './registry/mcp-registry-client-2025.js';

// MCP 2025-11 Schema Validation
export {
  SchemaValidator,
  upgradeToolSchema,
  type ValidationResult,
} from './validation/schema-validator-2025.js';

// Progressive Tool Registry (Phase 1 & 2)
export {
  ProgressiveToolRegistry,
  createProgressiveToolRegistry,
  createProgressiveClaudeFlowSdkServer,
  type ProgressiveToolRegistryConfig,
} from './tool-registry-progressive.js';

// Dynamic Tool Loader (Phase 1)
export {
  DynamicToolLoader,
  type ToolMetadata,
  type ToolSearchQuery,
} from './tools/loader.js';

// Lifecycle Management
export {
  MCPLifecycleManager,
  LifecycleState,
  type LifecycleEvent,
  type HealthCheckResult,
  type LifecycleManagerConfig,
} from './lifecycle-manager.js';

// Tool Registry and Management
export {
  ToolRegistry,
  type ToolCapability,
  type ToolMetrics,
  type ToolDiscoveryQuery,
} from './tools.js';

// Protocol Management
export {
  MCPProtocolManager,
  type ProtocolVersionInfo,
  type CompatibilityResult,
  type NegotiationResult,
} from './protocol-manager.js';

// Authentication and Authorization
export {
  AuthManager,
  type IAuthManager,
  type AuthContext,
  type AuthResult,
  type TokenInfo,
  type TokenGenerationOptions,
  type AuthSession,
  Permissions,
} from './auth.js';

// Performance Monitoring
export {
  MCPPerformanceMonitor,
  type PerformanceMetrics,
  type RequestMetrics,
  type AlertRule,
  type Alert,
  type OptimizationSuggestion,
} from './performance-monitor.js';

// Orchestration Integration
export {
  MCPOrchestrationIntegration,
  type OrchestrationComponents,
  type MCPOrchestrationConfig,
  type IntegrationStatus,
} from './orchestration-integration.js';

// Transport Implementations
export { type ITransport } from './transports/base.js';
export { StdioTransport } from './transports/stdio.js';
export { HttpTransport } from './transports/http.js';

// Request Routing
export { RequestRouter } from './router.js';

// Session Management
export { SessionManager, type ISessionManager } from './session-manager.js';

// Load Balancing
export { LoadBalancer, type ILoadBalancer, RequestQueue } from './load-balancer.js';

// Tool Implementations
export { createClaudeFlowTools, type ClaudeFlowToolContext } from './claude-flow-tools.js';
export { createSwarmTools, type SwarmToolContext } from './swarm-tools.js';

/**
 * MCP Integration Factory
 * Provides a simple way to create a complete MCP integration
 */
export class MCPIntegrationFactory {
  /**
   * Create a complete MCP integration with all components
   */
  static async createIntegration(config: {
    mcpConfig: import('../utils/types.js').MCPConfig;
    orchestrationConfig?: Partial<MCPOrchestrationConfig>;
    components?: Partial<OrchestrationComponents>;
    logger: import('../core/logger.js').ILogger;
  }): Promise<MCPOrchestrationIntegration> {
    const { mcpConfig, orchestrationConfig = {}, components = {}, logger } = config;

    const integration = new MCPOrchestrationIntegration(
      mcpConfig,
      {
        enabledIntegrations: {
          orchestrator: true,
          swarm: true,
          agents: true,
          resources: true,
          memory: true,
          monitoring: true,
          terminals: true,
        },
        autoStart: true,
        healthCheckInterval: 30000,
        reconnectAttempts: 3,
        reconnectDelay: 5000,
        enableMetrics: true,
        enableAlerts: true,
        ...orchestrationConfig,
      },
      components,
      logger,
    );

    return integration;
  }

  /**
   * Create a standalone MCP server (without orchestration integration)
   */
  static async createStandaloneServer(config: {
    mcpConfig: import('../utils/types.js').MCPConfig;
    logger: import('../core/logger.js').ILogger;
    enableLifecycleManagement?: boolean;
    enablePerformanceMonitoring?: boolean;
  }): Promise<{
    server: MCPServer;
    lifecycleManager?: MCPLifecycleManager;
    performanceMonitor?: MCPPerformanceMonitor;
  }> {
    const {
      mcpConfig,
      logger,
      enableLifecycleManagement = true,
      enablePerformanceMonitoring = true,
    } = config;

    const eventBus = new (await import('node:events')).EventEmitter();
    const server = new MCPServer(mcpConfig, eventBus, logger);

    let lifecycleManager: MCPLifecycleManager | undefined;
    let performanceMonitor: MCPPerformanceMonitor | undefined;

    if (enableLifecycleManagement) {
      lifecycleManager = new MCPLifecycleManager(mcpConfig, logger, () => server);
    }

    if (enablePerformanceMonitoring) {
      performanceMonitor = new MCPPerformanceMonitor(logger);
    }

    return {
      server,
      lifecycleManager,
      performanceMonitor,
    };
  }

  /**
   * Create a development/testing MCP setup
   */
  static async createDevelopmentSetup(logger: import('../core/logger.js').ILogger): Promise<{
    server: MCPServer;
    lifecycleManager: MCPLifecycleManager;
    performanceMonitor: MCPPerformanceMonitor;
    protocolManager: MCPProtocolManager;
  }> {
    const mcpConfig: import('../utils/types.js').MCPConfig = {
      transport: 'stdio',
      enableMetrics: true,
      auth: {
        enabled: false,
        method: 'token',
      },
    };

    const { server, lifecycleManager, performanceMonitor } = await this.createStandaloneServer({
      mcpConfig,
      logger,
      enableLifecycleManagement: true,
      enablePerformanceMonitoring: true,
    });

    const protocolManager = new MCPProtocolManager(logger);

    return {
      server,
      lifecycleManager: lifecycleManager!,
      performanceMonitor: performanceMonitor!,
      protocolManager,
    };
  }
}

/**
 * Default MCP configuration for common use cases
 */
export const DefaultMCPConfigs = {
  /**
   * Development configuration with stdio transport
   */
  development: {
    transport: 'stdio' as const,
    enableMetrics: true,
    auth: {
      enabled: false,
      method: 'token' as const,
    },
  },

  /**
   * Production configuration with HTTP transport and authentication
   */
  production: {
    transport: 'http' as const,
    host: '0.0.0.0',
    port: 3000,
    tlsEnabled: true,
    enableMetrics: true,
    auth: {
      enabled: true,
      method: 'token' as const,
    },
    loadBalancer: {
      enabled: true,
      maxRequestsPerSecond: 100,
      maxConcurrentRequests: 50,
    },
    sessionTimeout: 3600000, // 1 hour
    maxSessions: 1000,
  },

  /**
   * Testing configuration with minimal features
   */
  testing: {
    transport: 'stdio' as const,
    enableMetrics: false,
    auth: {
      enabled: false,
      method: 'token' as const,
    },
  },
} as const;

/**
 * MCP Utility Functions
 */
export const MCPUtils = {
  /**
   * Validate MCP protocol version
   */
  isValidProtocolVersion(version: import('../utils/types.js').MCPProtocolVersion): boolean {
    return (
      typeof version.major === 'number' &&
      typeof version.minor === 'number' &&
      typeof version.patch === 'number' &&
      version.major > 0
    );
  },

  /**
   * Compare two protocol versions
   */
  compareVersions(
    a: import('../utils/types.js').MCPProtocolVersion,
    b: import('../utils/types.js').MCPProtocolVersion,
  ): number {
    if (a.major !== b.major) return a.major - b.major;
    if (a.minor !== b.minor) return a.minor - b.minor;
    return a.patch - b.patch;
  },

  /**
   * Format protocol version as string
   */
  formatVersion(version: import('../utils/types.js').MCPProtocolVersion): string {
    return `${version.major}.${version.minor}.${version.patch}`;
  },

  /**
   * Parse protocol version from string
   */
  parseVersion(versionString: string): import('../utils/types.js').MCPProtocolVersion {
    const parts = versionString.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 3 || parts.some((p) => isNaN(p))) {
      throw new Error(`Invalid version string: ${versionString}`);
    }
    return {
      major: parts[0],
      minor: parts[1],
      patch: parts[2],
    };
  },

  /**
   * Generate a random session ID
   */
  generateSessionId(): string {
    return `mcp_session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  },

  /**
   * Generate a random request ID
   */
  generateRequestId(): string {
    return `mcp_req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  },
};

/**
 * Phase 6: Initialize MCP with in-process server for maximum performance
 *
 * Provides 10-100x performance improvement by eliminating IPC overhead.
 * All Claude-Flow MCP tools execute in-process with microsecond latency.
 */
export async function initializeInProcessMCP(orchestratorContext?: any) {
  const { initializeSDKIntegration } = await import('./sdk-integration.js');

  return initializeSDKIntegration({
    enableInProcess: true,
    enableMetrics: true,
    enableCaching: true,
    orchestratorContext,
    fallbackToStdio: true,
  });
}

/**
 * Phase 6: Get in-process server status and performance metrics
 */
export async function getInProcessMCPStatus() {
  const { getSDKIntegration } = await import('./sdk-integration.js');
  const integration = getSDKIntegration();

  if (!integration) {
    return {
      initialized: false,
      inProcess: false,
      message: 'In-process MCP not initialized',
    };
  }

  return {
    initialized: true,
    inProcess: integration.isInProcessAvailable(),
    metrics: integration.getMetrics(),
    performanceComparison: integration.getPerformanceComparison(),
  };
}
