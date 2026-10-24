/**
 * MCP 2025-11 Registry Client
 *
 * Implements server registration and health reporting
 * per MCP 2025-11 specification
 */

import type { ILogger } from '../../interfaces/logger.js';
import type { MCPVersion, MCPCapability } from '../protocol/version-negotiation.js';

/**
 * MCP Registry entry (2025-11 format)
 */
export interface MCPRegistryEntry {
  server_id: string;
  version: MCPVersion;
  endpoint: string;
  tools: string[];
  auth: 'bearer' | 'mutual_tls' | 'none';
  capabilities: MCPCapability[];
  metadata: {
    name: string;
    description: string;
    author: string;
    homepage?: string;
    documentation?: string;
    repository?: string;
  };
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    last_check: string; // ISO 8601
    latency_ms: number;
  };
}

/**
 * Registry search query
 */
export interface RegistrySearchQuery {
  category?: string;
  tags?: string[];
  capabilities?: MCPCapability[];
  limit?: number;
}

/**
 * Registry configuration
 */
export interface RegistryConfig {
  enabled: boolean;
  registryUrl?: string;
  apiKey?: string;
  serverId: string;
  serverEndpoint: string;
  authMethod: 'bearer' | 'mutual_tls' | 'none';
  metadata: MCPRegistryEntry['metadata'];
  healthCheckInterval?: number; // milliseconds
}

/**
 * MCP 2025-11 Registry Client
 */
export class MCPRegistryClient {
  private registryUrl: string;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    private config: RegistryConfig,
    private logger: ILogger,
    private getTools: () => Promise<string[]>,
    private getCapabilities: () => MCPCapability[],
    private getHealth: () => Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; latency_ms: number }>
  ) {
    this.registryUrl = config.registryUrl || 'https://registry.mcp.anthropic.com/api/v1';
  }

  /**
   * Register server with MCP Registry
   */
  async register(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info('Registry registration disabled');
      return;
    }

    try {
      const entry = await this.buildRegistryEntry();

      this.logger.info('Registering server with MCP Registry', {
        server_id: entry.server_id,
        endpoint: entry.endpoint,
        capabilities: entry.capabilities,
      });

      const response = await fetch(`${this.registryUrl}/servers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && {
            'Authorization': `Bearer ${this.config.apiKey}`,
          }),
        },
        body: JSON.stringify(entry),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Registration failed: ${response.status} - ${error}`);
      }

      const result = await response.json();
      this.logger.info('Server registered successfully', {
        server_id: result.server_id,
      });

      // Start periodic health reporting
      this.startHealthReporting();
    } catch (error) {
      this.logger.error('Failed to register with MCP Registry', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update server metadata in registry
   */
  async updateMetadata(updates: Partial<MCPRegistryEntry>): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      this.logger.info('Updating server metadata in registry', {
        server_id: this.config.serverId,
      });

      const response = await fetch(
        `${this.registryUrl}/servers/${this.config.serverId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey && {
              'Authorization': `Bearer ${this.config.apiKey}`,
            }),
          },
          body: JSON.stringify(updates),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Update failed: ${response.status} - ${error}`);
      }

      this.logger.info('Server metadata updated successfully');
    } catch (error) {
      this.logger.error('Failed to update metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Report health status to registry
   */
  async reportHealth(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    try {
      const health = await this.getHealth();

      const response = await fetch(
        `${this.registryUrl}/servers/${this.config.serverId}/health`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.apiKey && {
              'Authorization': `Bearer ${this.config.apiKey}`,
            }),
          },
          body: JSON.stringify({
            status: health.status,
            last_check: new Date().toISOString(),
            latency_ms: health.latency_ms,
          }),
        }
      );

      if (!response.ok) {
        this.logger.warn('Health report failed', {
          status: response.status,
        });
      }
    } catch (error) {
      this.logger.error('Failed to report health', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Search for servers in registry
   */
  async searchServers(query: RegistrySearchQuery): Promise<MCPRegistryEntry[]> {
    try {
      const params = new URLSearchParams();

      if (query.category) {
        params.set('category', query.category);
      }
      if (query.tags) {
        params.set('tags', query.tags.join(','));
      }
      if (query.capabilities) {
        params.set('capabilities', query.capabilities.join(','));
      }
      if (query.limit) {
        params.set('limit', query.limit.toString());
      }

      const response = await fetch(`${this.registryUrl}/servers?${params}`);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const results = await response.json();
      return results.servers || [];
    } catch (error) {
      this.logger.error('Failed to search servers', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Unregister from registry
   */
  async unregister(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Stop health reporting
    this.stopHealthReporting();

    try {
      this.logger.info('Unregistering from MCP Registry', {
        server_id: this.config.serverId,
      });

      const response = await fetch(
        `${this.registryUrl}/servers/${this.config.serverId}`,
        {
          method: 'DELETE',
          headers: {
            ...(this.config.apiKey && {
              'Authorization': `Bearer ${this.config.apiKey}`,
            }),
          },
        }
      );

      if (!response.ok) {
        this.logger.warn('Unregistration failed', {
          status: response.status,
        });
      } else {
        this.logger.info('Server unregistered successfully');
      }
    } catch (error) {
      this.logger.error('Failed to unregister', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Build registry entry from current server state
   */
  private async buildRegistryEntry(): Promise<MCPRegistryEntry> {
    const tools = await this.getTools();
    const capabilities = this.getCapabilities();
    const health = await this.getHealth();

    return {
      server_id: this.config.serverId,
      version: '2025-11',
      endpoint: this.config.serverEndpoint,
      tools,
      auth: this.config.authMethod,
      capabilities,
      metadata: this.config.metadata,
      health: {
        status: health.status,
        last_check: new Date().toISOString(),
        latency_ms: health.latency_ms,
      },
    };
  }

  /**
   * Start periodic health reporting
   */
  private startHealthReporting(): void {
    const interval = this.config.healthCheckInterval || 60000; // Default: 60 seconds

    this.healthCheckInterval = setInterval(async () => {
      await this.reportHealth();
    }, interval);

    this.logger.info('Health reporting started', {
      interval_ms: interval,
    });
  }

  /**
   * Stop health reporting
   */
  private stopHealthReporting(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      this.logger.info('Health reporting stopped');
    }
  }
}
