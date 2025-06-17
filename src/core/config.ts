/**
 * Enterprise Configuration Management for Claude-Flow
 * Features: Security masking, change tracking, multi-format support, credential management
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash, randomBytes, createCipher, createDecipher } from 'crypto';
import { Config } from '../utils/types.js';
import { deepMerge, safeParseJSON } from '../utils/helpers.js';
import { ConfigError, ValidationError } from '../utils/errors.js';

// Format parsers
interface FormatParser {
  parse(content: string): any;
  stringify(obj: any): string;
  extension: string;
}

// Configuration change record
interface ConfigChange {
  timestamp: string;
  path: string;
  oldValue: any;
  newValue: any;
  user?: string;
  reason?: string;
  source: 'cli' | 'api' | 'file' | 'env';
}

// Security classification
interface SecurityClassification {
  level: 'public' | 'internal' | 'confidential' | 'secret';
  maskPattern?: string;
  encrypted?: boolean;
}

// Validation rule
interface ValidationRule {
  type: string;
  required?: boolean;
  min?: number;
  max?: number;
  values?: string[];
  pattern?: RegExp;
  validator?: (value: any, config: Config) => string | null;
  dependencies?: string[];
}

/**
 * Security classifications for configuration paths
 */
const SECURITY_CLASSIFICATIONS: Record<string, SecurityClassification> = {
  'credentials': { level: 'secret', encrypted: true },
  'credentials.apiKey': { level: 'secret', maskPattern: '****...****', encrypted: true },
  'credentials.token': { level: 'secret', maskPattern: '****...****', encrypted: true },
  'credentials.password': { level: 'secret', maskPattern: '********', encrypted: true },
  'mcp.apiKey': { level: 'confidential', maskPattern: '****...****' },
  'logging.destination': { level: 'internal' },
  'orchestrator': { level: 'internal' },
  'terminal': { level: 'public' },
};

/**
 * Sensitive configuration paths that should be masked in output
 */
const SENSITIVE_PATHS = [
  'credentials',
  'apiKey',
  'token',
  'password',
  'secret',
  'key',
  'auth',
];

/**
 * Format parsers for different configuration file types
 */
const FORMAT_PARSERS: Record<string, FormatParser> = {
  json: {
    parse: JSON.parse,
    stringify: (obj) => JSON.stringify(obj, null, 2),
    extension: '.json'
  },
  yaml: {
    parse: (content) => {
      // Simple YAML parser for basic key-value pairs
      const lines = content.split('\n');
      const result: any = {};
      let current = result;
      const stack: any[] = [result];
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        const indent = line.length - line.trimStart().length;
        const colonIndex = trimmed.indexOf(':');
        
        if (colonIndex === -1) continue;
        
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        
        // Simple value parsing
        let parsedValue: any = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);
        else if (value.startsWith('"') && value.endsWith('"')) {
          parsedValue = value.slice(1, -1);
        }
        
        current[key] = parsedValue;
      }
      
      return result;
    },
    stringify: (obj) => {
      const stringify = (obj: any, indent = 0): string => {
        const spaces = '  '.repeat(indent);
        let result = '';
        
        for (const [key, value] of Object.entries(obj)) {
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            result += `${spaces}${key}:\n${stringify(value, indent + 1)}`;
          } else {
            const formattedValue = typeof value === 'string' ? `"${value}"` : String(value);
            result += `${spaces}${key}: ${formattedValue}\n`;
          }
        }
        
        return result;
      };
      
      return stringify(obj);
    },
    extension: '.yaml'
  },
  toml: {
    parse: (content) => {
      // Simple TOML parser for basic sections and key-value pairs
      const lines = content.split('\n');
      const result: any = {};
      let currentSection = result;
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        
        // Section header
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          const sectionName = trimmed.slice(1, -1);
          currentSection = result[sectionName] = {};
          continue;
        }
        
        // Key-value pair
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex === -1) continue;
        
        const key = trimmed.substring(0, equalsIndex).trim();
        const value = trimmed.substring(equalsIndex + 1).trim();
        
        // Simple value parsing
        let parsedValue: any = value;
        if (value === 'true') parsedValue = true;
        else if (value === 'false') parsedValue = false;
        else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);
        else if (value.startsWith('"') && value.endsWith('"')) {
          parsedValue = value.slice(1, -1);
        }
        
        currentSection[key] = parsedValue;
      }
      
      return result;
    },
    stringify: (obj) => {
      let result = '';
      
      for (const [section, values] of Object.entries(obj)) {
        if (typeof values === 'object' && values !== null && !Array.isArray(values)) {
          result += `[${section}]\n`;
          for (const [key, value] of Object.entries(values)) {
            const formattedValue = typeof value === 'string' ? `"${value}"` : String(value);
            result += `${key} = ${formattedValue}\n`;
          }
          result += '\n';
        }
      }
      
      return result;
    },
    extension: '.toml'
  }
};

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
  credentials: {
    // Encrypted credentials storage
  },
  security: {
    encryptionEnabled: true,
    auditLogging: true,
    maskSensitiveValues: true,
    allowEnvironmentOverrides: true,
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
  private changeHistory: ConfigChange[] = [];
  private encryptionKey?: Buffer;
  private validationRules: Map<string, ValidationRule> = new Map();
  private formatParsers = FORMAT_PARSERS;

  private constructor() {
    this.config = deepClone(DEFAULT_CONFIG);
    this.userConfigDir = this.getUserConfigDir();
    this.initializeEncryption();
    this.setupValidationRules();
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
   * Initializes encryption for sensitive configuration values
   */
  private initializeEncryption(): void {
    try {
      const keyFile = join(this.userConfigDir, '.encryption-key');
      // Check if key file exists (simplified for demo)
      try {
        await fs.access(keyFile);
        // In a real implementation, this would be more secure
        this.encryptionKey = randomBytes(32);
      } catch {
        this.encryptionKey = randomBytes(32);
        // Store key securely (in production, use proper key management)
      }
    } catch (error) {
      console.warn('Failed to initialize encryption:', (error as Error).message);
    }
  }

  /**
   * Sets up validation rules for configuration paths
   */
  private setupValidationRules(): void {
    // Orchestrator validation rules
    this.validationRules.set('orchestrator.maxConcurrentAgents', {
      type: 'number',
      required: true,
      min: 1,
      max: 100,
      validator: (value, config) => {
        if (value > config.terminal?.poolSize * 2) {
          return 'maxConcurrentAgents should not exceed 2x terminal pool size';
        }
        return null;
      }
    });

    this.validationRules.set('orchestrator.taskQueueSize', {
      type: 'number',
      required: true,
      min: 1,
      max: 10000,
      dependencies: ['orchestrator.maxConcurrentAgents'],
      validator: (value, config) => {
        const maxAgents = config.orchestrator?.maxConcurrentAgents || 1;
        if (value < maxAgents * 10) {
          return 'taskQueueSize should be at least 10x maxConcurrentAgents';
        }
        return null;
      }
    });

    // Terminal validation rules
    this.validationRules.set('terminal.type', {
      type: 'string',
      required: true,
      values: ['auto', 'vscode', 'native']
    });

    this.validationRules.set('terminal.poolSize', {
      type: 'number',
      required: true,
      min: 1,
      max: 50
    });

    // Memory validation rules
    this.validationRules.set('memory.backend', {
      type: 'string',
      required: true,
      values: ['sqlite', 'markdown', 'hybrid']
    });

    this.validationRules.set('memory.cacheSizeMB', {
      type: 'number',
      required: true,
      min: 1,
      max: 10000,
      validator: (value) => {
        if (value > 1000) {
          return 'Large cache sizes may impact system performance';
        }
        return null;
      }
    });

    // Security validation rules
    this.validationRules.set('security.encryptionEnabled', {
      type: 'boolean',
      required: true
    });

    // Credentials validation
    this.validationRules.set('credentials.apiKey', {
      type: 'string',
      pattern: /^[a-zA-Z0-9_-]+$/,
      validator: (value) => {
        if (value && value.length < 16) {
          return 'API key should be at least 16 characters long';
        }
        return null;
      }
    });
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
   * Gets the current configuration with optional security masking
   */
  get(maskSensitive = false): Config {
    const config = deepClone(this.config);
    
    if (maskSensitive && this.config.security?.maskSensitiveValues) {
      return this.maskSensitiveValues(config);
    }
    
    return config;
  }

  /**
   * Gets configuration with security masking applied
   */
  getSecure(): Config {
    return this.get(true);
  }

  /**
   * Updates configuration values with change tracking
   */
  update(updates: Partial<Config>, options: { user?: string, reason?: string, source?: 'cli' | 'api' | 'file' | 'env' } = {}): Config {
    const oldConfig = deepClone(this.config);
    
    // Track changes before applying
    this.trackChanges(oldConfig, updates, options);
    
    // Apply updates
    this.config = deepMergeConfig(this.config, updates);
    
    // Validate the updated configuration
    this.validateWithDependencies(this.config);
    
    return this.get();
  }

  /**
   * Loads default configuration
   */
  loadDefault(): void {
    this.config = deepClone(DEFAULT_CONFIG);
  }

  /**
   * Saves configuration to file with format support
   */
  async save(path?: string, format?: string): Promise<void> {
    const savePath = path || this.configPath;
    if (!savePath) {
      throw new ConfigError('No configuration file path specified');
    }

    const detectedFormat = format || this.detectFormat(savePath);
    const parser = this.formatParsers[detectedFormat];
    
    if (!parser) {
      throw new ConfigError(`Unsupported format for saving: ${detectedFormat}`);
    }
    
    // Get configuration without sensitive values for saving
    const configToSave = this.getConfigForSaving();
    const content = parser.stringify(configToSave);
    
    await fs.writeFile(savePath, content, 'utf8');
    
    // Record the save operation
    this.recordChange({
      timestamp: new Date().toISOString(),
      path: 'CONFIG_SAVED',
      oldValue: null,
      newValue: savePath,
      source: 'file'
    });
  }
  
  /**
   * Gets configuration suitable for saving (excludes runtime-only values)
   */
  private getConfigForSaving(): Partial<Config> {
    const config = deepClone(this.config);
    
    // Remove encrypted credentials from the saved config
    // They should be stored separately in a secure location
    if (config.credentials) {
      delete config.credentials;
    }
    
    return config;
  }

  /**
   * Gets user configuration directory
   */
  private getUserConfigDir(): string {
    const home = homedir();
    return join(home, '.claude-flow');
  }

  /**
   * Creates user config directory if it doesn't exist
   */
  private async ensureUserConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.userConfigDir, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new ConfigError(`Failed to create config directory: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Loads all profiles from the profiles directory
   */
  async loadProfiles(): Promise<void> {
    const profilesDir = join(this.userConfigDir, 'profiles');
    
    try {
      const entries = await fs.readdir(profilesDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          const profileName = entry.name.replace('.json', '');
          const profilePath = join(profilesDir, entry.name);
          
          try {
            const content = await fs.readFile(profilePath, 'utf8');
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
    
    const profilesDir = join(this.userConfigDir, 'profiles');
    await fs.mkdir(profilesDir, { recursive: true });
    
    const profileConfig = config || this.config;
    const profilePath = join(profilesDir, `${profileName}.json`);
    
    const content = JSON.stringify(profileConfig, null, 2);
    await fs.writeFile(profilePath, content, 'utf8');
    
    this.profiles.set(profileName, profileConfig);
  }

  /**
   * Deletes a profile
   */
  async deleteProfile(profileName: string): Promise<void> {
    const profilePath = join(this.userConfigDir, 'profiles', `${profileName}.json`);
    
    try {
      await fs.unlink(profilePath);
      this.profiles.delete(profileName);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
   * Sets a configuration value by path with change tracking and validation
   */
  set(path: string, value: any, options: { user?: string, reason?: string, source?: 'cli' | 'api' | 'file' | 'env' } = {}): void {
    const oldValue = this.getValue(path);
    
    // Record the change
    this.recordChange({
      timestamp: new Date().toISOString(),
      path,
      oldValue,
      newValue: value,
      user: options.user,
      reason: options.reason,
      source: options.source || 'cli'
    });
    
    // Encrypt sensitive values
    if (this.isSensitivePath(path) && this.config.security?.encryptionEnabled) {
      value = this.encryptValue(value);
    }
    
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
    
    // Validate the path-specific rule and dependencies
    this.validatePath(path, value);
    this.validateWithDependencies(this.config);
  }

  /**
   * Gets a configuration value by path with decryption for sensitive values
   */
  getValue(path: string, decrypt = true): any {
    const keys = path.split('.');
    let current: any = this.config;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return undefined;
      }
    }
    
    // Decrypt sensitive values if requested
    if (decrypt && this.isSensitivePath(path) && this.isEncryptedValue(current)) {
      try {
        return this.decryptValue(current);
      } catch (error) {
        console.warn(`Failed to decrypt value at path ${path}:`, (error as Error).message);
        return current;
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
    
    this.validateWithDependencies(data.config);
    this.config = data.config;
    this.currentProfile = data.profile;
    
    // Record the import operation
    this.recordChange({
      timestamp: new Date().toISOString(),
      path: 'CONFIG_IMPORTED',
      oldValue: null,
      newValue: data.version || 'unknown',
      source: 'file'
    });
  }

  /**
   * Loads configuration from file with format detection
   */
  private async loadFromFile(path: string): Promise<Partial<Config>> {
    try {
      const content = await fs.readFile(path, 'utf8');
      const format = this.detectFormat(path, content);
      const parser = this.formatParsers[format];
      
      if (!parser) {
        throw new ConfigError(`Unsupported configuration format: ${format}`);
      }
      
      const config = parser.parse(content) as Partial<Config>;
      
      if (!config) {
        throw new ConfigError(`Invalid ${format.toUpperCase()} in configuration file: ${path}`);
      }

      return config;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, use defaults
        return {};
      }
      throw new ConfigError(`Failed to load configuration from ${path}: ${(error as Error).message}`);
    }
  }
  
  /**
   * Detects configuration file format
   */
  private detectFormat(path: string, content?: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    
    if (ext === 'yaml' || ext === 'yml') return 'yaml';
    if (ext === 'toml') return 'toml';
    if (ext === 'json') return 'json';
    
    // Try to detect from content
    if (content) {
      const trimmed = content.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
      if (trimmed.includes('=') && trimmed.includes('[')) return 'toml';
      if (trimmed.includes(':') && !trimmed.includes('=')) return 'yaml';
    }
    
    // Default to JSON
    return 'json';
  }

  /**
   * Loads configuration from environment variables
   */
  private loadFromEnv(): Partial<Config> {
    const config: Partial<Config> = {};

    // Orchestrator settings
    const maxAgents = process.env.CLAUDE_FLOW_MAX_AGENTS;
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
    const terminalType = process.env.CLAUDE_FLOW_TERMINAL_TYPE;
    if (terminalType === 'vscode' || terminalType === 'native' || terminalType === 'auto') {
      config.terminal = {
        ...DEFAULT_CONFIG.terminal,
        ...config.terminal,
        type: terminalType,
      };
    }

    // Memory settings
    const memoryBackend = process.env.CLAUDE_FLOW_MEMORY_BACKEND;
    if (memoryBackend === 'sqlite' || memoryBackend === 'markdown' || memoryBackend === 'hybrid') {
      config.memory = {
        ...DEFAULT_CONFIG.memory,
        ...config.memory,
        backend: memoryBackend,
      };
    }

    // MCP settings
    const mcpTransport = process.env.CLAUDE_FLOW_MCP_TRANSPORT;
    if (mcpTransport === 'stdio' || mcpTransport === 'http' || mcpTransport === 'websocket') {
      config.mcp = {
        ...DEFAULT_CONFIG.mcp,
        ...config.mcp,
        transport: mcpTransport,
      };
    }

    const mcpPort = process.env.CLAUDE_FLOW_MCP_PORT;
    if (mcpPort) {
      config.mcp = {
        ...DEFAULT_CONFIG.mcp,
        ...config.mcp,
        port: parseInt(mcpPort, 10),
      };
    }

    // Logging settings
    const logLevel = process.env.CLAUDE_FLOW_LOG_LEVEL;
    if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
      config.logging = {
        ...DEFAULT_CONFIG.logging,
        ...config.logging,
        level: logLevel,
      };
    }

    return config;
  }

  /**
   * Validates configuration with dependency checking
   */
  private validateWithDependencies(config: Config): void {
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Validate all paths with rules
    for (const [path, rule] of this.validationRules.entries()) {
      const value = this.getValueByPath(config, path);
      
      try {
        this.validatePath(path, value, config);
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    
    // Additional cross-field validations
    if (config.orchestrator.maxConcurrentAgents > config.terminal.poolSize * 3) {
      warnings.push('High agent-to-terminal ratio may cause resource contention');
    }
    
    if (config.memory.cacheSizeMB > 1000 && config.memory.backend === 'sqlite') {
      warnings.push('Large cache size with SQLite backend may impact performance');
    }
    
    if (config.mcp.transport === 'http' && !config.mcp.tlsEnabled) {
      warnings.push('HTTP transport without TLS is not recommended for production');
    }
    
    // Log warnings
    if (warnings.length > 0 && config.logging?.level === 'debug') {
      console.warn('Configuration warnings:', warnings);
    }
    
    // Throw errors
    if (errors.length > 0) {
      throw new ValidationError(`Configuration validation failed:\n${errors.join('\n')}`);
    }
  }
  
  /**
   * Validates a specific configuration path
   */
  private validatePath(path: string, value: any, config?: Config): void {
    const rule = this.validationRules.get(path);
    if (!rule) return;
    
    const currentConfig = config || this.config;
    
    // Required validation
    if (rule.required && (value === undefined || value === null)) {
      throw new ValidationError(`${path} is required`);
    }
    
    if (value === undefined || value === null) return;
    
    // Type validation
    if (rule.type === 'number' && (typeof value !== 'number' || isNaN(value))) {
      throw new ValidationError(`${path} must be a number`);
    }
    
    if (rule.type === 'string' && typeof value !== 'string') {
      throw new ValidationError(`${path} must be a string`);
    }
    
    if (rule.type === 'boolean' && typeof value !== 'boolean') {
      throw new ValidationError(`${path} must be a boolean`);
    }
    
    // Range validation
    if (typeof value === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        throw new ValidationError(`${path} must be at least ${rule.min}`);
      }
      if (rule.max !== undefined && value > rule.max) {
        throw new ValidationError(`${path} must be at most ${rule.max}`);
      }
    }
    
    // Values validation
    if (rule.values && !rule.values.includes(value)) {
      throw new ValidationError(`${path} must be one of: ${rule.values.join(', ')}`);
    }
    
    // Pattern validation
    if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
      throw new ValidationError(`${path} does not match required pattern`);
    }
    
    // Custom validator
    if (rule.validator) {
      const result = rule.validator(value, currentConfig);
      if (result) {
        throw new ValidationError(`${path}: ${result}`);
      }
    }
  }
  
  /**
   * Gets a value from a configuration object by path
   */
  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let current = obj;
    
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
   * Legacy validate method for backward compatibility
   */
  private validate(config: Config): void {
    this.validateWithDependencies(config);
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

// Export types for external use
export type {
  FormatParser,
  ConfigChange,
  SecurityClassification,
  ValidationRule
};

export {
  SENSITIVE_PATHS,
  SECURITY_CLASSIFICATIONS
};

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
    if (source.credentials) {
      result.credentials = { ...result.credentials, ...source.credentials };
    }
    if (source.security) {
      result.security = { ...result.security, ...source.security };
    }
  }
  
  return result;
}