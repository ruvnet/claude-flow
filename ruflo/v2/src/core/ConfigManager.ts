/**
 * ConfigManager - Handles configuration validation and setup
 * Manages environment variables, file-based config, and validation schemas
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { ConfigValidationResult, InitConfig, DatabaseConfig, TopologyConfig } from '../types/interfaces.js';

export interface ClaudeFlowConfig {
  // Core settings
  mode?: string;
  topology?: string;
  maxAgents?: number;
  strategy?: string;

  // Database configuration
  database?: DatabaseConfig;

  // Topology configuration
  topologyConfig?: TopologyConfig;

  // MCP integration
  mcpServers?: MCPServerConfig[];

  // GitHub integration
  github?: GitHubConfig;

  // Neural network settings
  neural?: NeuralConfig;

  // Hive mind settings
  hiveMind?: HiveMindConfig;

  // Enterprise features
  enterprise?: EnterpriseConfig;

  // Debugging and logging
  debug?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  logPath?: string;

  // Performance settings
  performance?: PerformanceConfig;
}

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface GitHubConfig {
  token?: string;
  owner?: string;
  repo?: string;
  webhookSecret?: string;
  autoSync?: boolean;
}

export interface NeuralConfig {
  modelPath?: string;
  wasmOptimization?: boolean;
  simdAcceleration?: boolean;
  trainingEnabled?: boolean;
}

export interface HiveMindConfig {
  queenEnabled?: boolean;
  workerPoolSize?: number;
  consensusThreshold?: number;
  adaptationRate?: number;
}

export interface EnterpriseConfig {
  authentication?: boolean;
  encryption?: boolean;
  audit?: boolean;
  compliance?: string[];
}

export interface PerformanceConfig {
  maxConcurrency?: number;
  timeout?: number;
  retryAttempts?: number;
  cacheEnabled?: boolean;
}

export class ConfigManager {
  private config: ClaudeFlowConfig = {};
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || this.findConfigFile();
    this.loadConfiguration();
  }

  /**
   * Find configuration file in standard locations
   */
  private findConfigFile(): string {
    const possiblePaths = [
      'claude-flow.config.json',
      'claude-flow.config.js',
      '.claude-flow.json',
      '.claude-flow/config.json',
      'config/claude-flow.json',
      path.join(process.cwd(), 'claude-flow.config.json')
    ];

    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }

    return 'claude-flow.config.json'; // Default
  }

  /**
   * Load configuration from file and environment variables
   */
  private loadConfiguration(): void {
    // Load from file if exists
    if (fs.existsSync(this.configPath)) {
      try {
        const fileContent = fs.readFileSync(this.configPath, 'utf8');
        this.config = JSON.parse(fileContent);
      } catch (error) {
        console.warn(`Failed to load config from ${this.configPath}:`, error);
      }
    }

    // Override with environment variables
    this.loadEnvironmentVariables();
  }

  /**
   * Load configuration from environment variables
   */
  private loadEnvironmentVariables(): void {
    const envConfig: Partial<ClaudeFlowConfig> = {};

    // Core settings
    if (process.env.CLAUDE_FLOW_MODE) envConfig.mode = process.env.CLAUDE_FLOW_MODE;
    if (process.env.CLAUDE_FLOW_TOPOLOGY) envConfig.topology = process.env.CLAUDE_FLOW_TOPOLOGY;
    if (process.env.CLAUDE_FLOW_MAX_AGENTS) envConfig.maxAgents = parseInt(process.env.CLAUDE_FLOW_MAX_AGENTS);
    if (process.env.CLAUDE_FLOW_STRATEGY) envConfig.strategy = process.env.CLAUDE_FLOW_STRATEGY;

    // Database
    if (process.env.CLAUDE_FLOW_DATABASE_TYPE || process.env.CLAUDE_FLOW_DATABASE_PATH) {
      envConfig.database = {
        type: (process.env.CLAUDE_FLOW_DATABASE_TYPE as 'sqlite' | 'json') || 'sqlite',
        path: process.env.CLAUDE_FLOW_DATABASE_PATH
      };
    }

    // GitHub
    if (process.env.GITHUB_TOKEN) {
      envConfig.github = {
        token: process.env.GITHUB_TOKEN,
        owner: process.env.GITHUB_OWNER,
        repo: process.env.GITHUB_REPO,
        webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
        autoSync: process.env.GITHUB_AUTO_SYNC === 'true'
      };
    }

    // Debug
    if (process.env.CLAUDE_FLOW_DEBUG) envConfig.debug = process.env.CLAUDE_FLOW_DEBUG === 'true';
    if (process.env.CLAUDE_FLOW_LOG_LEVEL) envConfig.logLevel = process.env.CLAUDE_FLOW_LOG_LEVEL as any;

    // Merge with existing config
    this.config = { ...this.config, ...envConfig };
  }

  /**
   * Validate the configuration
   */
  async validate(): Promise<ConfigValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate mode
    const validModes = ['standard', 'github', 'hive-mind', 'sparc', 'neural', 'enterprise'];
    if (this.config.mode && !validModes.includes(this.config.mode)) {
      errors.push(`Invalid mode: ${this.config.mode}. Valid modes: ${validModes.join(', ')}`);
    }

    // Validate topology
    const validTopologies = ['mesh', 'hierarchical', 'ring', 'star'];
    if (this.config.topology && !validTopologies.includes(this.config.topology)) {
      errors.push(`Invalid topology: ${this.config.topology}. Valid topologies: ${validTopologies.join(', ')}`);
    }

    // Validate maxAgents
    if (this.config.maxAgents !== undefined) {
      if (this.config.maxAgents < 1 || this.config.maxAgents > 100) {
        errors.push('maxAgents must be between 1 and 100');
      }
    }

    // Validate strategy
    const validStrategies = ['balanced', 'specialized', 'adaptive'];
    if (this.config.strategy && !validStrategies.includes(this.config.strategy)) {
      errors.push(`Invalid strategy: ${this.config.strategy}. Valid strategies: ${validStrategies.join(', ')}`);
    }

    // Validate database configuration
    if (this.config.database) {
      if (!['sqlite', 'json'].includes(this.config.database.type)) {
        errors.push('Database type must be either "sqlite" or "json"');
      }

      if (this.config.database.path && !fs.existsSync(path.dirname(this.config.database.path))) {
        warnings.push(`Database directory does not exist: ${path.dirname(this.config.database.path)}`);
      }
    }

    // Validate GitHub configuration
    if (this.config.github?.token && !this.config.github.token.startsWith('ghp_')) {
      warnings.push('GitHub token format appears invalid');
    }

    // Validate performance configuration
    if (this.config.performance?.maxConcurrency && this.config.performance.maxConcurrency < 1) {
      errors.push('maxConcurrency must be at least 1');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get the current configuration
   */
  getConfig(): ClaudeFlowConfig {
    return { ...this.config };
  }

  /**
   * Get a specific configuration value
   */
  get<K extends keyof ClaudeFlowConfig>(key: K): ClaudeFlowConfig[K] {
    return this.config[key];
  }

  /**
   * Set a configuration value
   */
  set<K extends keyof ClaudeFlowConfig>(key: K, value: ClaudeFlowConfig[K]): void {
    this.config[key] = value;
  }

  /**
   * Save configuration to file
   */
  async save(): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(this.configPath));
      await fs.writeJSON(this.configPath, this.config, { spaces: 2 });
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error}`);
    }
  }

  /**
   * Reset configuration to defaults
   */
  reset(): void {
    this.config = {
      mode: 'standard',
      topology: 'mesh',
      maxAgents: 8,
      strategy: 'balanced',
      database: {
        type: 'sqlite',
        path: '.claude-flow/database.sqlite'
      },
      debug: false,
      logLevel: 'info'
    };
  }

  /**
   * Merge additional configuration
   */
  merge(additionalConfig: Partial<ClaudeFlowConfig>): void {
    this.config = { ...this.config, ...additionalConfig };
  }

  /**
   * Create InitConfig from current configuration
   */
  toInitConfig(): InitConfig {
    return {
      mode: this.config.mode as any,
      topology: this.config.topology as any,
      maxAgents: this.config.maxAgents,
      strategy: this.config.strategy as any,
      database: this.config.database?.type,
      debug: this.config.debug
    };
  }
}