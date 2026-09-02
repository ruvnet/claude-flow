/**
 * ConfigTools
 *
 * MCP tools for configuration management operations.
 */

import type {
  MCPTool,
  MCPToolProvider,
  MCPToolResult
} from '../../../shared/types';

export interface V3Config {
  swarm?: {
    topology?: 'hierarchical' | 'mesh' | 'simple' | 'adaptive';
    maxAgents?: number;
    leaderElection?: boolean;
    peerDiscovery?: boolean;
  };
  memory?: {
    backend?: 'hybrid' | 'agentdb' | 'sqlite';
    ttl?: number;
    maxSize?: number;
    vectorDimension?: number;
    hnswM?: number;
  };
  performance?: {
    flashAttention?: boolean;
    targetSpeedup?: string;
    concurrency?: number;
    gnnLayers?: number;
    batchSize?: number;
  };
}

export class ConfigTools implements MCPToolProvider {
  private configs: Map<string, V3Config>;

  constructor() {
    this.configs = new Map();
  }

  /**
   * Get available tools
   */
  getTools(): MCPTool[] {
    return [
      {
        name: 'config_load',
        description: 'Load configuration from a path',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Configuration file path' }
          },
          required: ['path']
        }
      },
      {
        name: 'config_save',
        description: 'Save configuration to a path',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Configuration file path' },
            config: { type: 'object', description: 'Configuration to save' }
          },
          required: ['path', 'config']
        }
      },
      {
        name: 'config_validate',
        description: 'Validate a configuration',
        parameters: {
          type: 'object',
          properties: {
            config: { type: 'object', description: 'Configuration to validate' }
          },
          required: ['config']
        }
      },
      {
        name: 'config_get',
        description: 'Get current configuration',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Configuration path' }
          }
        }
      }
    ];
  }

  /**
   * Execute a tool
   */
  async execute(toolName: string, params: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      switch (toolName) {
        case 'config_load':
          return await this.loadConfigTool(params.path as string);

        case 'config_save':
          return await this.saveConfigTool(
            params.path as string,
            params.config as V3Config
          );

        case 'config_validate':
          return await this.validateConfigTool(params.config as V3Config);

        case 'config_get':
          return await this.getConfigTool(params.path as string | undefined);

        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Load configuration (for use with mocking in tests)
   */
  async loadConfig(path: string): Promise<V3Config> {
    // In real implementation, would read from file
    // For now, return cached or default config
    return this.configs.get(path) || this.getDefaultConfig();
  }

  /**
   * Save configuration (for use with mocking in tests)
   */
  async saveConfig(path: string, config: V3Config): Promise<{ success: boolean }> {
    this.configs.set(path, config);
    return { success: true };
  }

  private async loadConfigTool(path: string): Promise<MCPToolResult> {
    const config = await this.loadConfig(path);
    return { success: true, config };
  }

  private async saveConfigTool(path: string, config: V3Config): Promise<MCPToolResult> {
    await this.saveConfig(path, config);
    return { success: true };
  }

  private async validateConfigTool(config: V3Config): Promise<MCPToolResult> {
    const errors: string[] = [];

    // Validate swarm config
    if (config.swarm) {
      const validTopologies = ['hierarchical', 'mesh', 'simple', 'adaptive'];
      if (config.swarm.topology && !validTopologies.includes(config.swarm.topology)) {
        errors.push(`Invalid swarm.topology: ${config.swarm.topology}. Must be one of: ${validTopologies.join(', ')}`);
      }
    }

    // Validate memory config
    if (config.memory) {
      const validBackends = ['hybrid', 'agentdb', 'sqlite'];
      if (config.memory.backend && !validBackends.includes(config.memory.backend)) {
        errors.push(`Invalid memory.backend: ${config.memory.backend}. Must be one of: ${validBackends.join(', ')}`);
      }
    }

    return {
      success: errors.length === 0,
      valid: errors.length === 0,
      errors
    };
  }

  private async getConfigTool(path?: string): Promise<MCPToolResult> {
    if (path) {
      const config = this.configs.get(path);
      return { success: true, config };
    }
    return { success: true, config: this.getDefaultConfig() };
  }

  private getDefaultConfig(): V3Config {
    return {
      swarm: {
        topology: 'hierarchical',
        maxAgents: 10,
        leaderElection: true
      },
      memory: {
        backend: 'hybrid',
        ttl: 3600000,
        maxSize: 1000000
      },
      performance: {
        flashAttention: true,
        targetSpeedup: '2.49x-7.47x',
        concurrency: 4
      }
    };
  }
}

export { ConfigTools as default };
