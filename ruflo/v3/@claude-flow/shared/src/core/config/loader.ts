/**
 * V3 Configuration Loader
 * Load configuration from various sources
 */

import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { existsSync } from 'fs';
import type { SystemConfig } from './schema.js';
import { validateSystemConfig, type ValidationResult } from './validator.js';
import { defaultSystemConfig, mergeWithDefaults } from './defaults.js';

/**
 * Configuration source type
 */
export type ConfigSource = 'file' | 'env' | 'default' | 'merged';

/**
 * Loaded configuration with metadata
 */
export interface LoadedConfig {
  config: SystemConfig;
  source: ConfigSource;
  path?: string;
  warnings?: string[];
}

/**
 * Configuration file names to search for
 */
const CONFIG_FILE_NAMES = [
  'claude-flow.config.json',
  'claude-flow.config.js',
  'claude-flow.json',
  '.claude-flow.json',
];

/**
 * Find configuration file in directory
 */
async function findConfigFile(directory: string): Promise<string | null> {
  for (const name of CONFIG_FILE_NAMES) {
    const path = join(directory, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

/**
 * Load configuration from JSON file
 */
async function loadJsonConfig(path: string): Promise<unknown> {
  const content = await readFile(path, 'utf8');
  return JSON.parse(content);
}

/**
 * Load configuration from environment variables
 */
function loadEnvConfig(): Partial<SystemConfig> {
  const config: Partial<SystemConfig> = {};

  // Orchestrator settings
  if (process.env.CLAUDE_FLOW_MAX_AGENTS) {
    config.orchestrator = {
      ...defaultSystemConfig.orchestrator,
      lifecycle: {
        ...defaultSystemConfig.orchestrator.lifecycle,
        maxConcurrentAgents: parseInt(process.env.CLAUDE_FLOW_MAX_AGENTS, 10),
      },
    };
  }

  // Data directory
  if (process.env.CLAUDE_FLOW_DATA_DIR) {
    config.orchestrator = {
      ...config.orchestrator,
      ...defaultSystemConfig.orchestrator,
      session: {
        ...defaultSystemConfig.orchestrator.session,
        dataDir: process.env.CLAUDE_FLOW_DATA_DIR,
      },
    };
  }

  // Memory type
  if (process.env.CLAUDE_FLOW_MEMORY_TYPE) {
    const memoryType = process.env.CLAUDE_FLOW_MEMORY_TYPE as NonNullable<SystemConfig['memory']>['type'];
    if (['sqlite', 'agentdb', 'hybrid', 'redis', 'memory'].includes(memoryType)) {
      config.memory = {
        ...(defaultSystemConfig.memory ?? { type: 'hybrid' }),
        type: memoryType,
      };
    }
  }

  // MCP transport
  const defaultMcp = defaultSystemConfig.mcp ?? { name: 'claude-flow', version: '3.0.0', transport: { type: 'stdio' as const } };
  if (process.env.CLAUDE_FLOW_MCP_TRANSPORT) {
    const transport = process.env.CLAUDE_FLOW_MCP_TRANSPORT as 'stdio' | 'http' | 'websocket';
    if (['stdio', 'http', 'websocket'].includes(transport)) {
      config.mcp = {
        ...defaultMcp,
        transport: {
          ...defaultMcp.transport,
          type: transport,
        },
      };
    }
  }

  if (process.env.CLAUDE_FLOW_MCP_PORT) {
    config.mcp = {
      ...config.mcp,
      ...defaultMcp,
      transport: {
        ...config.mcp?.transport,
        ...defaultMcp.transport,
        port: parseInt(process.env.CLAUDE_FLOW_MCP_PORT, 10),
      },
    };
  }

  // Swarm topology
  const defaultSwarm = defaultSystemConfig.swarm ?? { topology: 'hierarchical-mesh' as const, maxAgents: 20 };
  if (process.env.CLAUDE_FLOW_SWARM_TOPOLOGY) {
    const topology = process.env.CLAUDE_FLOW_SWARM_TOPOLOGY as NonNullable<SystemConfig['swarm']>['topology'];
    if (['hierarchical', 'mesh', 'ring', 'star', 'adaptive', 'hierarchical-mesh'].includes(topology)) {
      config.swarm = {
        ...defaultSwarm,
        topology,
      };
    }
  }

  return config;
}

/**
 * Configuration loader class
 */
export class ConfigLoader {
  private searchPaths: string[] = [];

  constructor(additionalPaths?: string[]) {
    // Default search paths
    this.searchPaths = [
      process.cwd(),
      resolve(process.cwd(), '..'),
      resolve(process.env.HOME ?? '', '.claude-flow'),
    ];

    if (additionalPaths) {
      this.searchPaths.push(...additionalPaths);
    }
  }

  /**
   * Load configuration from all sources
   */
  async load(): Promise<LoadedConfig> {
    const warnings: string[] = [];

    // Start with defaults
    let config: SystemConfig = { ...defaultSystemConfig };
    let source: ConfigSource = 'default';
    let path: string | undefined;

    // Try to load from file
    for (const searchPath of this.searchPaths) {
      const configPath = await findConfigFile(searchPath);
      if (configPath) {
        try {
          const fileConfig = await loadJsonConfig(configPath);
          const validation = validateSystemConfig(fileConfig);

          if (validation.success) {
            config = mergeWithDefaults(validation.data!, defaultSystemConfig) as SystemConfig;
            source = 'file';
            path = configPath;
            break;
          } else {
            warnings.push(`Invalid config at ${configPath}: ${validation.errors?.map(e => e.message).join(', ')}`);
          }
        } catch (error) {
          warnings.push(`Failed to load config from ${configPath}: ${(error as Error).message}`);
        }
      }
    }

    // Merge with environment variables
    const envConfig = loadEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      config = this.deepMerge(config, envConfig) as SystemConfig;
      source = source === 'default' ? 'env' : 'merged';
    }

    return {
      config,
      source,
      path,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Load configuration from specific file
   */
  async loadFromFile(filePath: string): Promise<LoadedConfig> {
    const absolutePath = resolve(filePath);
    const fileConfig = await loadJsonConfig(absolutePath);
    const validation = validateSystemConfig(fileConfig);

    if (!validation.success) {
      throw new Error(`Invalid configuration: ${validation.errors?.map(e => e.message).join(', ')}`);
    }

    const config = mergeWithDefaults(validation.data!, defaultSystemConfig) as SystemConfig;

    return {
      config,
      source: 'file',
      path: absolutePath,
    };
  }

  /**
   * Deep merge objects
   */
  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>,
        );
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue;
      }
    }

    return result;
  }
}

/**
 * Load configuration (convenience function)
 */
export async function loadConfig(options?: { paths?: string[]; file?: string }): Promise<LoadedConfig> {
  const loader = new ConfigLoader(options?.paths);

  if (options?.file) {
    return loader.loadFromFile(options.file);
  }

  return loader.load();
}
