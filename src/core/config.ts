/**
 * Configuration management for Claude-Flow
 */

import { Config } from '../utils/types.ts';
import { deepMerge, safeParseJSON } from '../utils/helpers.ts';
import { ConfigError, ValidationError } from '../utils/errors.ts';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Config = {
  orchestrator: {
    maxConcurrentAgents: 10,
    taskQueueSize: 100,
    healthCheckInterval: 30000, // 30 seconds
    shutdownTimeout: 30000, // 30 seconds
  },
  terminal: {
    type: 'auto',
    poolSize: 5,
    recycleAfter: 10, // recycle after 10 uses
    healthCheckInterval: 60000, // 1 minute
    commandTimeout: 300000, // 5 minutes
  },
  memory: {
    backend: 'hybrid',
    cacheSizeMB: 100,
    syncInterval: 5000, // 5 seconds
    conflictResolution: 'crdt',
    retentionDays: 30,
  },
  coordination: {
    maxRetries: 3,
    retryDelay: 1000, // 1 second
    deadlockDetection: true,
    resourceTimeout: 60000, // 1 minute
    messageTimeout: 30000, // 30 seconds
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
  openCodex: {
    model: '',
    baseUrl: '',
    apiKey: '',
    path: 'open-codex',
  },
};

/**
 * Configuration manager
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: Config;
  private configPath?: string;
  private profiles: Map<string, Partial<Config>> = new Map();
  private currentProfile?: string;
  private userConfigDir: string;

  private constructor() {
    this.config = deepClone(DEFAULT_CONFIG);
    this.userConfigDir = this.getUserConfigDir();
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
   * Loads configuration from various sources
   */
  async load(configPath?: string): Promise<Config> {
    if (configPath !== undefined) {
      this.configPath = configPath;
    }

    // Start with defaults
    let config = deepClone(DEFAULT_CONFIG);

    // Load from file if specified
    if (configPath) {
      const fileConfig = await this.loadFromFile(configPath);
      config = deepMergeConfig(config, fileConfig);
    }

    // Load from environment variables
    const envConfig = this.loadFromEnv();
    config = deepMergeConfig(config, envConfig);

    // Validate the final configuration
    this.validate(config);

    this.config = config;
    return config;
  }

  /**
   * Gets the current configuration
   */
  get(): Config {
    return deepClone(this.config);
  }

  /**
   * Updates configuration values
   */
  update(updates: Partial<Config>): Config {
    this.config = deepMergeConfig(this.config, updates);
    this.validate(this.config);
    return this.get();
  }

  /**
   * Loads default configuration
   */
  loadDefault(): void {
    this.config = deepClone(DEFAULT_CONFIG);
  }

  /**
   * Saves configuration to file
   */
  async save(path?: string): Promise<void> {
    const savePath = path || this.configPath;
    if (!savePath) {
      throw new ConfigError('No configuration file path specified');
    }

    const content = JSON.stringify(this.config, null, 2);
    await Deno.writeTextFile(savePath, content);
  }

  /**
   * Gets user configuration directory
   */
  private getUserConfigDir(): string {
    const home = Deno.env.get('HOME') || Deno.env.get('USERPROFILE') || '/tmp';
    return `${home}/.claude-flow`;
  }

  /**
   * Creates user config directory if it doesn't exist
   */
  private async ensureUserConfigDir(): Promise<void> {
    try {
      await Deno.mkdir(this.userConfigDir, { recursive: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) {
        throw new ConfigError(`Failed to create config directory: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Loads all profiles from the profiles directory
   */
  async loadProfiles(): Promise<void> {
    const profilesDir = `${this.userConfigDir}/profiles`;
    
    try {
      for await (const entry of Deno.readDir(profilesDir)) {
        if (entry.isFile && entry.name.endsWith('.json')) {
          const profileName = entry.name.replace('.json', '');
          const profilePath = `${profilesDir}/${entry.name}`;
          
          try {
            const content = await Deno.readTextFile(profilePath);
            const profileConfig = safeParseJSON<Partial<Config>>(content);
            
            if (profileConfig) {
              this.profiles.set(profileName, profileConfig);
            }
          } catch (error) {
            console.warn(`Failed to load profile ${profileName}: ${(error as Error).message}`);
          }
        }
      }
    } catch (error) {
      // Profiles directory doesn't exist - this is okay
    }
  }

  /**
   * Applies a named profile
   */
  async applyProfile(profileName: string): Promise<void> {
    await this.loadProfiles();
    
    const profile = this.profiles.get(profileName);
    if (!profile) {
      throw new ConfigError(`Profile '${profileName}' not found`);
    }

    this.config = deepMergeConfig(this.config, profile);
    this.currentProfile = profileName;
    this.validate(this.config);
  }

  /**
   * Saves current configuration as a profile
   */
  async saveProfile(profileName: string, config?: Partial<Config>): Promise<void> {
    await this.ensureUserConfigDir();
    
    const profilesDir = `${this.userConfigDir}/profiles`;
    await Deno.mkdir(profilesDir, { recursive: true });
    
    const profileConfig = config || this.config;
    const profilePath = `${profilesDir}/${profileName}.json`;
    
    const content = JSON.stringify(profileConfig, null, 2);
    await Deno.writeTextFile(profilePath, content);
    
    this.profiles.set(profileName, profileConfig);
  }

  /**
   * Deletes a profile
   */
  async deleteProfile(profileName: string): Promise<void> {
    const profilePath = `${this.userConfigDir}/profiles/${profileName}.json`;
    
    try {
      await Deno.remove(profilePath);
      this.profiles.delete(profileName);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new ConfigError(`Profile '${profileName}' not found`);
      }
      throw new ConfigError(`Failed to delete profile: ${(error as Error).message}`);
    }
  }

  /**
   * Lists all available profiles
   */
  async listProfiles(): Promise<string[]> {
    await this.loadProfiles();
    return Array.from(this.profiles.keys());
  }

  /**
   * Gets a specific profile configuration
   */
  async getProfile(profileName: string): Promise<Partial<Config> | undefined> {
    await this.loadProfiles();
    return this.profiles.get(profileName);
  }

  /**
   * Gets the current active profile name
   */
  getCurrentProfile(): string | undefined {
    return this.currentProfile;
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
    
    current[keys[keys.length - 1]] = value;
    this.validate(this.config);
  }

  /**
   * Gets a configuration value by path
   */
  getValue(path: string): any {
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
   * Resets configuration to defaults
   */
  reset(): void {
    this.config = deepClone(DEFAULT_CONFIG);
    delete this.currentProfile;
  }

  /**
   * Gets configuration schema for validation
   */
  getSchema(): any {
    return {
      orchestrator: {
        maxConcurrentAgents: { type: 'number', min: 1, max: 100 },
        taskQueueSize: { type: 'number', min: 1, max: 10000 },
        healthCheckInterval: { type: 'number', min: 1000, max: 300000 },
        shutdownTimeout: { type: 'number', min: 1000, max: 300000 },
      },
      terminal: {
        type: { type: 'string', values: ['auto', 'vscode', 'native'] },
        poolSize: { type: 'number', min: 1, max: 50 },
        recycleAfter: { type: 'number', min: 1, max: 1000 },
        healthCheckInterval: { type: 'number', min: 1000, max: 3600000 },
        commandTimeout: { type: 'number', min: 1000, max: 3600000 },
      },
      memory: {
        backend: { type: 'string', values: ['sqlite', 'markdown', 'hybrid'] },
        cacheSizeMB: { type: 'number', min: 1, max: 10000 },
        syncInterval: { type: 'number', min: 1000, max: 300000 },
        conflictResolution: { type: 'string', values: ['crdt', 'timestamp', 'manual'] },
        retentionDays: { type: 'number', min: 1, max: 3650 },
      },
      coordination: {
        maxRetries: { type: 'number', min: 0, max: 100 },
        retryDelay: { type: 'number', min: 100, max: 60000 },
        deadlockDetection: { type: 'boolean' },
        resourceTimeout: { type: 'number', min: 1000, max: 3600000 },
        messageTimeout: { type: 'number', min: 1000, max: 300000 },
      },
      mcp: {
        transport: { type: 'string', values: ['stdio', 'http', 'websocket'] },
        port: { type: 'number', min: 1, max: 65535 },
        tlsEnabled: { type: 'boolean' },
      },
      logging: {
        level: { type: 'string', values: ['debug', 'info', 'warn', 'error'] },
        format: { type: 'string', values: ['json', 'text'] },
        destination: { type: 'string', values: ['console', 'file'] },
      },
      openCodex: {
        model: { type: 'string' },
        baseUrl: { type: 'string' },
        apiKey: { type: 'string' },
        path: { type: 'string' },
      },
    };
  }

  /**
   * Validates a value against schema
   */
  private validateValue(value: any, schema: any, path: string): void {
    if (schema.type === 'number') {
      if (typeof value !== 'number' || isNaN(value)) {
        throw new ValidationError(`${path}: must be a number`);
      }
      if (schema.min !== undefined && value < schema.min) {
        throw new ValidationError(`${path}: must be at least ${schema.min}`);
      }
      if (schema.max !== undefined && value > schema.max) {
        throw new ValidationError(`${path}: must be at most ${schema.max}`);
      }
    } else if (schema.type === 'string') {
      if (typeof value !== 'string') {
        throw new ValidationError(`${path}: must be a string`);
      }
      if (schema.values && !schema.values.includes(value)) {
        throw new ValidationError(`${path}: must be one of [${schema.values.join(', ')}]`);
      }
    } else if (schema.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new ValidationError(`${path}: must be a boolean`);
      }
    }
  }

  /**
   * Gets configuration diff between current and default
   */
  getDiff(): any {
    const defaultConfig = DEFAULT_CONFIG;
    const diff: any = {};
    
    const findDifferences = (current: any, defaults: any, path: string = '') => {
      for (const key in current) {
        const currentValue = current[key];
        const defaultValue = defaults[key];
        const fullPath = path ? `${path}.${key}` : key;
        
        if (typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)) {
          if (typeof defaultValue === 'object' && defaultValue !== null) {
            const nestedDiff = {};
            findDifferences(currentValue, defaultValue, fullPath);
            if (Object.keys(nestedDiff).length > 0) {
              if (!path) {
                diff[key] = nestedDiff;
              }
            }
          }
        } else if (currentValue !== defaultValue) {
          const pathParts = fullPath.split('.');
          let target = diff;
          for (let i = 0; i < pathParts.length - 1; i++) {
            if (!target[pathParts[i]]) {
              target[pathParts[i]] = {};
            }
            target = target[pathParts[i]];
          }
          target[pathParts[pathParts.length - 1]] = currentValue;
        }
      }
    };
    
    findDifferences(this.config, defaultConfig);
    return diff;
  }

  /**
   * Exports configuration with metadata
   */
  export(): any {
    return {
      version: '1.0.0',
      exported: new Date().toISOString(),
      profile: this.currentProfile,
      config: this.config,
      diff: this.getDiff(),
    };
  }

  /**
   * Imports configuration from export
   */
  import(data: any): void {
    if (!data.config) {
      throw new ConfigError('Invalid configuration export format');
    }
    
    this.validate(data.config);
    this.config = data.config;
    this.currentProfile = data.profile;
  }

  /**
   * Loads configuration from file
   */
  private async loadFromFile(path: string): Promise<Partial<Config>> {
    try {
      const content = await Deno.readTextFile(path);
      const config = safeParseJSON<Partial<Config>>(content);
      
      if (!config) {
        throw new ConfigError(`Invalid JSON in configuration file: ${path}`);
      }

      return config;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // File doesn't exist, use defaults
        return {};
      }
      throw new ConfigError(`Failed to load configuration from ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Loads configuration from environment variables
   */
  private loadFromEnv(): Partial<Config> {
    const config: Partial<Config> = {};

    // Orchestrator settings
    const maxAgents = Deno.env.get('CLAUDE_FLOW_MAX_AGENTS');
    if (maxAgents) {
      if (!config.orchestrator) {
        config.orchestrator = {} as any;
      }
      config.orchestrator = {
        ...DEFAULT_CONFIG.orchestrator,
        ...config.orchestrator,
        maxConcurrentAgents: parseInt(maxAgents, 10),
      };
    }

    // Terminal settings
    const terminalType = Deno.env.get('CLAUDE_FLOW_TERMINAL_TYPE');
    if (terminalType === 'vscode' || terminalType === 'native' || terminalType === 'auto') {
      config.terminal = {
        ...DEFAULT_CONFIG.terminal,
        ...config.terminal,
        type: terminalType,
      };
    }

    // Memory settings
    const memoryBackend = Deno.env.get('CLAUDE_FLOW_MEMORY_BACKEND');
    if (memoryBackend === 'sqlite' || memoryBackend === 'markdown' || memoryBackend === 'hybrid') {
      config.memory = {
        ...DEFAULT_CONFIG.memory,
        ...config.memory,
        backend: memoryBackend,
      };
    }

    // MCP settings
    const mcpTransport = Deno.env.get('CLAUDE_FLOW_MCP_TRANSPORT');
    if (mcpTransport === 'stdio' || mcpTransport === 'http' || mcpTransport === 'websocket') {
      config.mcp = {
        ...DEFAULT_CONFIG.mcp,
        ...config.mcp,
        transport: mcpTransport,
      };
    }

    const mcpPort = Deno.env.get('CLAUDE_FLOW_MCP_PORT');
    if (mcpPort) {
      config.mcp = {
        ...DEFAULT_CONFIG.mcp,
        ...config.mcp,
        port: parseInt(mcpPort, 10),
      };
    }

    // Logging settings
    const logLevel = Deno.env.get('CLAUDE_FLOW_LOG_LEVEL');
    if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
      config.logging = {
        ...DEFAULT_CONFIG.logging,
        ...config.logging,
        level: logLevel,
      };
    }

    // OpenCodex settings
    const openCodexModel = Deno.env.get('OPEN_CODEX_MODEL');
    if (openCodexModel) {
      config.openCodex = {
        ...DEFAULT_CONFIG.openCodex,
        ...config.openCodex,
        model: openCodexModel,
      };
    }

    const openCodexBaseUrl = Deno.env.get('OPEN_CODEX_BASE_URL');
    if (openCodexBaseUrl) {
      config.openCodex = {
        ...DEFAULT_CONFIG.openCodex,
        ...config.openCodex,
        baseUrl: openCodexBaseUrl,
      };
    }

    const openCodexApiKey = Deno.env.get('OPEN_CODEX_API_KEY');
    if (openCodexApiKey) {
      config.openCodex = {
        ...DEFAULT_CONFIG.openCodex,
        ...config.openCodex,
        apiKey: openCodexApiKey,
      };
    }

    const openCodexPath = Deno.env.get('OPEN_CODEX_PATH');
    if (openCodexPath) {
      config.openCodex = {
        ...DEFAULT_CONFIG.openCodex,
        ...config.openCodex,
        path: openCodexPath,
      };
    }

    return config;
  }

  /**
   * Validates configuration
   */
  private validate(config: Config): void {
    // Orchestrator validation
    if (config.orchestrator.maxConcurrentAgents < 1) {
      throw new ValidationError('maxConcurrentAgents must be at least 1');
    }
    if (config.orchestrator.taskQueueSize < 1) {
      throw new ValidationError('taskQueueSize must be at least 1');
    }

    // Terminal validation
    if (config.terminal.poolSize < 1) {
      throw new ValidationError('terminal poolSize must be at least 1');
    }
    if (config.terminal.recycleAfter < 1) {
      throw new ValidationError('terminal recycleAfter must be at least 1');
    }

    // Memory validation
    if (config.memory.cacheSizeMB < 1) {
      throw new ValidationError('memory cacheSizeMB must be at least 1');
    }
    if (config.memory.retentionDays < 1) {
      throw new ValidationError('memory retentionDays must be at least 1');
    }

    // Coordination validation
    if (config.coordination.maxRetries < 0) {
      throw new ValidationError('coordination maxRetries cannot be negative');
    }

    // MCP validation
    if (config.mcp.transport === 'http' || config.mcp.transport === 'websocket') {
      if (!config.mcp.port || config.mcp.port < 1 || config.mcp.port > 65535) {
        throw new ValidationError('Invalid MCP port number');
      }
    }
  }
}

// Export singleton instance
export const configManager = ConfigManager.getInstance();

// Helper function to load configuration
export async function loadConfig(path?: string): Promise<Config> {
  return await configManager.load(path);
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// Custom deepMerge for Config type
function deepMergeConfig(target: Config, ...sources: Partial<Config>[]): Config {
  const result = deepClone(target);
  
  for (const source of sources) {
    if (!source) continue;
    
    // Merge each section
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
    if (source.openCodex) {
      result.openCodex = { ...result.openCodex, ...source.openCodex };
    }
  }
  
  return result;
}