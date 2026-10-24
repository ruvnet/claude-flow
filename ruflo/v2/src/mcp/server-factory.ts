/**
 * MCP Server Factory
 *
 * Creates appropriate MCP server instance based on configuration.
 * Provides seamless transition from legacy MCP to MCP 2025-11 with feature flags.
 */

import type { IEventBus } from '../interfaces/event-bus.js';
import type { ILogger } from '../interfaces/logger.js';
import type { MCPConfig } from '../utils/types.js';
import { MCPServer, type IMCPServer } from './server.js';
import { MCP2025Server, type MCP2025ServerConfig } from './server-mcp-2025.js';
import { ProgressiveToolRegistry } from './tool-registry-progressive.js';

/**
 * MCP server feature flags for gradual rollout
 */
export interface MCPFeatureFlags {
  // Enable MCP 2025-11 features
  enableMCP2025?: boolean;

  // Individual feature flags
  enableVersionNegotiation?: boolean;
  enableAsyncJobs?: boolean;
  enableRegistryIntegration?: boolean;
  enableSchemaValidation?: boolean;

  // Backward compatibility
  supportLegacyClients?: boolean;

  // Progressive disclosure (already implemented in Phase 1)
  enableProgressiveDisclosure?: boolean;
}

/**
 * Extended MCP configuration with 2025-11 support
 */
export interface ExtendedMCPConfig extends MCPConfig {
  // Feature flags
  features?: MCPFeatureFlags;

  // MCP 2025-11 specific config
  mcp2025?: {
    serverId?: string;

    // Async job configuration
    async?: {
      enabled?: boolean;
      maxJobs?: number;
      jobTTL?: number;
      persistence?: 'memory' | 'redis' | 'sqlite';
    };

    // Registry configuration
    registry?: {
      enabled?: boolean;
      url?: string;
      apiKey?: string;
      updateInterval?: number;
      retryAttempts?: number;
    };

    // Validation configuration
    validation?: {
      enabled?: boolean;
      strictMode?: boolean;
    };

    // Tool discovery
    toolsDirectory?: string;
  };
}

/**
 * MCP Server Factory
 *
 * Creates appropriate server instance based on configuration:
 * - MCP2025Server if MCP 2025-11 features enabled
 * - Legacy MCPServer for backward compatibility
 */
export class MCPServerFactory {
  /**
   * Create MCP server instance based on configuration
   */
  static async createServer(
    config: ExtendedMCPConfig,
    eventBus: IEventBus,
    logger: ILogger,
    orchestrator?: any,
    swarmCoordinator?: any,
    agentManager?: any,
    resourceManager?: any,
    messagebus?: any,
    monitor?: any
  ): Promise<IMCPServer | MCP2025Server> {
    const features = config.features || {};

    // Determine if MCP 2025-11 should be enabled
    const useMCP2025 = features.enableMCP2025 === true;

    if (useMCP2025) {
      logger.info('Creating MCP 2025-11 server with enhanced features');
      return await this.createMCP2025Server(
        config,
        eventBus,
        logger,
        orchestrator
      );
    } else {
      logger.info('Creating legacy MCP server (backward compatibility mode)');
      return this.createLegacyServer(
        config,
        eventBus,
        logger,
        orchestrator,
        swarmCoordinator,
        agentManager,
        resourceManager,
        messagebus,
        monitor
      );
    }
  }

  /**
   * Create MCP 2025-11 server with enhanced features
   */
  private static async createMCP2025Server(
    config: ExtendedMCPConfig,
    eventBus: IEventBus,
    logger: ILogger,
    orchestrator?: any
  ): Promise<MCP2025Server> {
    const features = config.features || {};
    const mcp2025Config = config.mcp2025 || {};

    // Build MCP 2025-11 server configuration
    const serverConfig: MCP2025ServerConfig = {
      serverId: mcp2025Config.serverId || `claude-flow-${Date.now()}`,
      transport: config.transport || 'stdio',

      // Feature flags
      enableMCP2025: true,
      supportLegacyClients: features.supportLegacyClients !== false, // Default true

      // Async jobs
      async: {
        enabled: features.enableAsyncJobs !== false, // Default true
        maxJobs: mcp2025Config.async?.maxJobs || 100,
        jobTTL: mcp2025Config.async?.jobTTL || 3600000, // 1 hour
        persistence: mcp2025Config.async?.persistence || 'memory',
      },

      // Registry integration
      registry: {
        enabled: features.enableRegistryIntegration === true,
        url: mcp2025Config.registry?.url || 'https://registry.mcp.run',
        apiKey: mcp2025Config.registry?.apiKey,
        updateInterval: mcp2025Config.registry?.updateInterval || 60000,
        retryAttempts: mcp2025Config.registry?.retryAttempts || 3,
      },

      // Schema validation
      validation: {
        enabled: features.enableSchemaValidation !== false, // Default true
        strictMode: mcp2025Config.validation?.strictMode || false,
      },

      // Tool registry (progressive disclosure)
      toolsDirectory: mcp2025Config.toolsDirectory,
      orchestratorContext: orchestrator,
    };

    // Create and initialize server
    const server = new MCP2025Server(serverConfig, eventBus, logger);
    await server.initialize();

    logger.info('MCP 2025-11 server created successfully', {
      serverId: serverConfig.serverId,
      features: {
        versionNegotiation: true,
        asyncJobs: serverConfig.async.enabled,
        registry: serverConfig.registry.enabled,
        validation: serverConfig.validation.enabled,
        progressiveDisclosure: true,
      },
    });

    return server;
  }

  /**
   * Create legacy MCP server for backward compatibility
   */
  private static createLegacyServer(
    config: ExtendedMCPConfig,
    eventBus: IEventBus,
    logger: ILogger,
    orchestrator?: any,
    swarmCoordinator?: any,
    agentManager?: any,
    resourceManager?: any,
    messagebus?: any,
    monitor?: any
  ): MCPServer {
    // Remove extended properties for legacy server
    const legacyConfig: MCPConfig = {
      transport: config.transport,
      host: config.host,
      port: config.port,
      tlsEnabled: config.tlsEnabled,
      enableMetrics: config.enableMetrics,
      auth: config.auth,
      loadBalancer: config.loadBalancer,
      sessionTimeout: config.sessionTimeout,
      maxSessions: config.maxSessions,
    };

    const server = new MCPServer(
      legacyConfig,
      eventBus,
      logger,
      orchestrator,
      swarmCoordinator,
      agentManager,
      resourceManager,
      messagebus,
      monitor
    );

    logger.info('Legacy MCP server created successfully', {
      transport: config.transport,
      mode: 'backward-compatibility',
    });

    return server;
  }

  /**
   * Detect optimal server configuration based on environment
   */
  static detectOptimalConfig(currentConfig: MCPConfig): ExtendedMCPConfig {
    const extended: ExtendedMCPConfig = {
      ...currentConfig,
      features: {
        // Enable MCP 2025-11 by default in development, opt-in for production
        enableMCP2025: process.env.NODE_ENV !== 'production',

        // Individual features (can be overridden)
        enableVersionNegotiation: true,
        enableAsyncJobs: true,
        enableRegistryIntegration: false, // Opt-in
        enableSchemaValidation: true,
        supportLegacyClients: true, // Always support legacy
        enableProgressiveDisclosure: true, // Phase 1 feature
      },
      mcp2025: {
        async: {
          enabled: true,
          maxJobs: 100,
          jobTTL: 3600000,
          persistence: 'memory',
        },
        registry: {
          enabled: false,
          url: process.env.MCP_REGISTRY_URL || 'https://registry.mcp.run',
          apiKey: process.env.MCP_REGISTRY_API_KEY,
        },
        validation: {
          enabled: true,
          strictMode: false,
        },
      },
    };

    return extended;
  }

  /**
   * Validate server configuration
   */
  static validateConfig(config: ExtendedMCPConfig): {
    valid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!config.transport) {
      errors.push('Transport type is required');
    }

    // MCP 2025-11 specific validation
    if (config.features?.enableMCP2025) {
      if (config.features.enableRegistryIntegration && !config.mcp2025?.registry?.apiKey) {
        warnings.push('Registry integration enabled but no API key provided');
      }

      if (config.mcp2025?.async?.persistence === 'redis') {
        warnings.push('Redis persistence not yet implemented, falling back to memory');
      }

      if (config.mcp2025?.async?.persistence === 'sqlite') {
        warnings.push('SQLite persistence not yet implemented, falling back to memory');
      }
    }

    // Transport validation
    if (config.transport === 'http') {
      if (!config.host) {
        warnings.push('HTTP transport enabled but no host specified, using default');
      }
      if (!config.port) {
        warnings.push('HTTP transport enabled but no port specified, using default');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}

/**
 * Convenience function for creating MCP server
 */
export async function createMCPServer(
  config: MCPConfig | ExtendedMCPConfig,
  eventBus: IEventBus,
  logger: ILogger,
  options?: {
    orchestrator?: any;
    swarmCoordinator?: any;
    agentManager?: any;
    resourceManager?: any;
    messagebus?: any;
    monitor?: any;
    autoDetectFeatures?: boolean;
  }
): Promise<IMCPServer | MCP2025Server> {
  // Auto-detect optimal configuration if requested
  const extendedConfig = options?.autoDetectFeatures
    ? MCPServerFactory.detectOptimalConfig(config)
    : (config as ExtendedMCPConfig);

  // Validate configuration
  const validation = MCPServerFactory.validateConfig(extendedConfig);

  if (!validation.valid) {
    throw new Error(`Invalid MCP configuration: ${validation.errors.join(', ')}`);
  }

  // Log warnings
  for (const warning of validation.warnings) {
    logger.warn('MCP configuration warning', { warning });
  }

  // Create server
  return await MCPServerFactory.createServer(
    extendedConfig,
    eventBus,
    logger,
    options?.orchestrator,
    options?.swarmCoordinator,
    options?.agentManager,
    options?.resourceManager,
    options?.messagebus,
    options?.monitor
  );
}

/**
 * Check if MCP 2025-11 features are available
 */
export function isMCP2025Available(): boolean {
  try {
    // Check if required dependencies are available
    require.resolve('uuid');
    require.resolve('ajv');
    require.resolve('ajv-formats');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get MCP server capabilities based on configuration
 */
export function getServerCapabilities(config: ExtendedMCPConfig): string[] {
  const capabilities: string[] = [];

  if (config.features?.enableMCP2025) {
    capabilities.push('mcp-2025-11');

    if (config.features.enableVersionNegotiation) {
      capabilities.push('version-negotiation');
    }

    if (config.features.enableAsyncJobs) {
      capabilities.push('async-jobs');
    }

    if (config.features.enableRegistryIntegration) {
      capabilities.push('registry');
    }

    if (config.features.enableSchemaValidation) {
      capabilities.push('schema-validation');
    }

    if (config.features.enableProgressiveDisclosure) {
      capabilities.push('progressive-disclosure');
    }
  }

  if (config.features?.supportLegacyClients !== false) {
    capabilities.push('backward-compatible');
  }

  return capabilities;
}
