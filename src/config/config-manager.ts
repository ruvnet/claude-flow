/**
 * Node.js-compatible Configuration management for Claude-Flow
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export interface Config {
  orchestrator: {
    maxConcurrentAgents: number;
    taskQueueSize: number;
    healthCheckInterval: number;
    shutdownTimeout: number;
  };
  terminal: {
    type: 'auto' | 'vscode' | 'native';
    poolSize: number;
    recycleAfter: number;
    healthCheckInterval: number;
    commandTimeout: number;
  };
  memory: {
    backend: 'sqlite' | 'markdown' | 'hybrid';
    cacheSizeMB: number;
    syncInterval: number;
    conflictResolution: 'crdt' | 'timestamp' | 'manual';
    retentionDays: number;
  };
  coordination: {
    maxRetries: number;
    retryDelay: number;
    deadlockDetection: boolean;
    resourceTimeout: number;
    messageTimeout: number;
  };
  mcp: {
    transport: 'stdio' | 'http' | 'websocket';
    port: number;
    tlsEnabled: boolean;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text';
    destination: 'console' | 'file';
  };
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = {
  orchestrator: {
    maxConcurrentAgents: 10,
    taskQueueSize: 100,
    healthCheckInterval: 30000,
    shutdownTimeout: 30000,
  },
  terminal: {
    type: 'auto',
    poolSize: 5,
    recycleAfter: 10,
    healthCheckInterval: 60000,
    commandTimeout: 300000,
  },
  memory: {
    backend: 'hybrid',
    cacheSizeMB: 100,
    syncInterval: 5000,
    conflictResolution: 'crdt',
    retentionDays: 30,
  },
  coordination: {
    maxRetries: 3,
    retryDelay: 1000,
    deadlockDetection: true,
    resourceTimeout: 60000,
    messageTimeout: 30000,
  },
  mcp: {
    transport: 'stdio',
    port: 3000,
    tlsEnabled: false,
  },
  logging: {
    level: 'info',
    format: 'json',
    destination: 'console',
  },
};

/**
 * Configuration validation error
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Configuration manager for Node.js
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: Config;
  private configPath?: string;
  private userConfigDir: string;

  private constructor() {
    this.config = this.deepClone(DEFAULT_CONFIG);
    this.userConfigDir = path.join(os.homedir(), '.claude-flow');
  }

  /**
   * Gets the singleton instance
   */
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Initialize configuration from file or create default
   */
  async init(configPath = 'claude-flow.config.json'): Promise<void> {
    try {
      await this.load(configPath);
      console.log(`✅ Configuration loaded from: ${configPath}`);
    } catch (error) {
      // Create default config file if it doesn't exist
      await this.createDefaultConfig(configPath);
      console.log(`✅ Default configuration created: ${configPath}`);
    }
  }

  /**
   * Creates a default configuration file
   */
  async createDefaultConfig(configPath: string): Promise<void> {
    const config = this.deepClone(DEFAULT_CONFIG);
    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, content, 'utf8');
    this.configPath = configPath;
  }

  /**
   * Loads configuration from file
   */
  async load(configPath?: string): Promise<Config> {
    if (configPath) {
      this.configPath = configPath;
    }

    if (!this.configPath) {
      throw new ConfigError('No configuration file path specified');
    }

    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const fileConfig = JSON.parse(content) as Partial<Config>;
      
      // Merge with defaults
      this.config = this.deepMerge(DEFAULT_CONFIG, fileConfig);
      
      // Load environment variables
      this.loadFromEnv();
      
      // Validate
      this.validate(this.config);
      
      return this.config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ConfigError(`Configuration file not found: ${this.configPath}`);
      }
      throw new ConfigError(`Failed to load configuration: ${(error as Error).message}`);
    }
  }

  /**
   * Shows current configuration
   */
  show(): Config {
    return this.deepClone(this.config);
  }

  /**
   * Gets a configuration value by path
   */
  get(path: string): any {
    const keys = path.split('.');
    let current: any = this.config;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    return current;
  }

  /**
   * Sets a configuration value by path
   */
  set(path: string, value: any): void {
    const keys = path.split('.');
    let current: any = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }
    
    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
    
    // Validate after setting
    this.validate(this.config);
  }

  /**
   * Saves current configuration to file
   */
  async save(configPath?: string): Promise<void> {
    const savePath = configPath || this.configPath;
    if (!savePath) {
      throw new ConfigError('No configuration file path specified');
    }

    const content = JSON.stringify(this.config, null, 2);
    await fs.writeFile(savePath, content, 'utf8');
  }

  /**
   * Validates the configuration
   */
  validate(config: Config): void {
    // Orchestrator validation
    if (config.orchestrator.maxConcurrentAgents < 1 || config.orchestrator.maxConcurrentAgents > 100) {
      throw new ConfigError('orchestrator.maxConcurrentAgents must be between 1 and 100');
    }
    if (config.orchestrator.taskQueueSize < 1 || config.orchestrator.taskQueueSize > 10000) {
      throw new ConfigError('orchestrator.taskQueueSize must be between 1 and 10000');
    }

    // Terminal validation
    if (!['auto', 'vscode', 'native'].includes(config.terminal.type)) {
      throw new ConfigError('terminal.type must be one of: auto, vscode, native');
    }
    if (config.terminal.poolSize < 1 || config.terminal.poolSize > 50) {
      throw new ConfigError('terminal.poolSize must be between 1 and 50');
    }

    // Memory validation
    if (!['sqlite', 'markdown', 'hybrid'].includes(config.memory.backend)) {
      throw new ConfigError('memory.backend must be one of: sqlite, markdown, hybrid');
    }
    if (config.memory.cacheSizeMB < 1 || config.memory.cacheSizeMB > 10000) {
      throw new ConfigError('memory.cacheSizeMB must be between 1 and 10000');
    }

    // Coordination validation
    if (config.coordination.maxRetries < 0 || config.coordination.maxRetries > 100) {
      throw new ConfigError('coordination.maxRetries must be between 0 and 100');
    }

    // MCP validation
    if (!['stdio', 'http', 'websocket'].includes(config.mcp.transport)) {
      throw new ConfigError('mcp.transport must be one of: stdio, http, websocket');
    }
    if (config.mcp.port < 1 || config.mcp.port > 65535) {
      throw new ConfigError('mcp.port must be between 1 and 65535');
    }

    // Logging validation
    if (!['debug', 'info', 'warn', 'error'].includes(config.logging.level)) {
      throw new ConfigError('logging.level must be one of: debug, info, warn, error');
    }
    if (!['json', 'text'].includes(config.logging.format)) {
      throw new ConfigError('logging.format must be one of: json, text');
    }
    if (!['console', 'file'].includes(config.logging.destination)) {
      throw new ConfigError('logging.destination must be one of: console, file');
    }
  }

  /**
   * Loads configuration from environment variables
   */
  private loadFromEnv(): void {
    // Orchestrator settings
    const maxAgents = process.env.CLAUDE_FLOW_MAX_AGENTS;
    if (maxAgents) {
      this.config.orchestrator.maxConcurrentAgents = parseInt(maxAgents, 10);
    }

    // Terminal settings
    const terminalType = process.env.CLAUDE_FLOW_TERMINAL_TYPE;
    if (terminalType === 'vscode' || terminalType === 'native' || terminalType === 'auto') {
      this.config.terminal.type = terminalType;
    }

    // Memory settings
    const memoryBackend = process.env.CLAUDE_FLOW_MEMORY_BACKEND;
    if (memoryBackend === 'sqlite' || memoryBackend === 'markdown' || memoryBackend === 'hybrid') {
      this.config.memory.backend = memoryBackend;
    }

    // MCP settings
    const mcpTransport = process.env.CLAUDE_FLOW_MCP_TRANSPORT;
    if (mcpTransport === 'stdio' || mcpTransport === 'http' || mcpTransport === 'websocket') {
      this.config.mcp.transport = mcpTransport;
    }

    const mcpPort = process.env.CLAUDE_FLOW_MCP_PORT;
    if (mcpPort) {
      this.config.mcp.port = parseInt(mcpPort, 10);
    }

    // Logging settings
    const logLevel = process.env.CLAUDE_FLOW_LOG_LEVEL;
    if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
      this.config.logging.level = logLevel;
    }
  }

  /**
   * Deep clone helper
   */
  private deepClone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }

  /**
   * Deep merge helper
   */
  private deepMerge(target: Config, source: Partial<Config>): Config {
    const result = this.deepClone(target);
    
    if (source.orchestrator) {
      result.orchestrator = { ...result.orchestrator, ...source.orchestrator };
    }
    if (source.terminal) {
      result.terminal = { ...result.terminal, ...source.terminal };
    }
    if (source.memory) {
      result.memory = { ...result.memory, ...source.memory };
    }
    if (source.coordination) {
      result.coordination = { ...result.coordination, ...source.coordination };
    }
    if (source.mcp) {
      result.mcp = { ...result.mcp, ...source.mcp };
    }
    if (source.logging) {
      result.logging = { ...result.logging, ...source.logging };
    }
    
    return result;
  }
}

// Export singleton instance
export const configManager = ConfigManager.getInstance();