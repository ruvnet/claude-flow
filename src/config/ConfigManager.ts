import { existsSync, readFileSync, writeFileSync, watch, FSWatcher } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';
import { logger } from '../core/logger';
import { 
  ClaudeFlowConfig, 
  ConfigValidationResult, 
  ConfigMigration,
  RuntimeConfig 
} from './types.js';
import { validateConfig } from './validator.js';
import { migrations } from './migrations.js';

export interface ConfigChangeEvent {
  previous: ClaudeFlowConfig;
  current: ClaudeFlowConfig;
  changedKeys: string[];
}

export class ConfigManager extends EventEmitter {
  private static instance: ConfigManager;
  private config: ClaudeFlowConfig | null = null;
  private configPath: string;
  private watchers: Map<string, FSWatcher> = new Map();
  private defaultPaths: string[] = [
    './claude-flow.config.json',
    './claude-flow.config.js',
    './.claudeflow/config.json',
    `${homedir()}/.claudeflow/config.json`,
    '/etc/claudeflow/config.json'
  ];

  private constructor() {
    super();
    this.configPath = this.findConfigPath();
  }

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Load configuration from file or defaults
   */
  async loadConfig(path?: string): Promise<ClaudeFlowConfig> {
    const configPath = path || this.configPath;
    
    try {
      if (existsSync(configPath)) {
        const rawConfig = readFileSync(configPath, 'utf-8');
        let parsedConfig: any;

        if (configPath.endsWith('.js')) {
          // Dynamic import for JS configs
          const module = await import(`file://${resolve(configPath)}`);
          parsedConfig = module.default || module;
        } else {
          parsedConfig = JSON.parse(rawConfig);
        }

        // Check if migration is needed
        if (parsedConfig.version && parsedConfig.version !== this.getCurrentVersion()) {
          parsedConfig = await this.migrateConfig(parsedConfig);
        }

        // Validate configuration
        const validation = validateConfig(parsedConfig);
        if (!validation.valid) {
          throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
        }

        if (validation.warnings.length > 0) {
          logger.warn('Configuration warnings:', validation.warnings);
        }

        this.config = parsedConfig;
        return this.config;
      }
    } catch (error) {
      logger.error('Failed to load configuration:', error);
    }

    // Return default configuration
    this.config = this.getDefaultConfig();
    return this.config;
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config: ClaudeFlowConfig, path?: string): Promise<void> {
    const configPath = path || this.configPath;
    
    // Validate before saving
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Cannot save invalid configuration: ${validation.errors.join(', ')}`);
    }

    try {
      // Ensure directory exists
      const dir = dirname(configPath);
      if (!existsSync(dir)) {
        const { mkdirSync } = await import('fs');
        mkdirSync(dir, { recursive: true });
      }

      writeFileSync(configPath, JSON.stringify(config, null, 2));
      this.config = config;
      
      logger.info(`Configuration saved to ${configPath}`);
    } catch (error) {
      logger.error('Failed to save configuration:', error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): ClaudeFlowConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  /**
   * Get configuration value by path
   */
  get<T = any>(path: string): T | undefined {
    const config = this.getConfig();
    const keys = path.split('.');
    let value: any = config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value as T;
  }

  /**
   * Set configuration value by path
   */
  async set(path: string, value: any): Promise<void> {
    const config = { ...this.getConfig() };
    const keys = path.split('.');
    let target: any = config;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in target) || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    const lastKey = keys[keys.length - 1];
    const oldValue = target[lastKey];
    target[lastKey] = value;

    // Validate new configuration
    const validation = validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Invalid configuration change: ${validation.errors.join(', ')}`);
    }

    await this.saveConfig(config);
    
    // Emit change event
    this.emit('configChanged', {
      previous: this.config,
      current: config,
      changedKeys: [path]
    } as ConfigChangeEvent);
  }

  /**
   * Watch configuration file for changes
   */
  watchConfig(callback?: (event: ConfigChangeEvent) => void): void {
    if (this.watchers.has(this.configPath)) {
      return;
    }

    const watcher = watch(this.configPath, async (eventType) => {
      if (eventType === 'change') {
        try {
          const previousConfig = { ...this.config };
          const newConfig = await this.loadConfig();
          
          const changedKeys = this.getChangedKeys(previousConfig, newConfig);
          
          if (changedKeys.length > 0) {
            const event: ConfigChangeEvent = {
              previous: previousConfig as ClaudeFlowConfig,
              current: newConfig,
              changedKeys
            };

            this.emit('configChanged', event);
            
            if (callback) {
              callback(event);
            }
            
            logger.info('Configuration reloaded:', changedKeys);
          }
        } catch (error) {
          logger.error('Failed to reload configuration:', error);
        }
      }
    });

    this.watchers.set(this.configPath, watcher);
    logger.info(`Watching configuration file: ${this.configPath}`);
  }

  /**
   * Stop watching configuration file
   */
  unwatchConfig(): void {
    const watcher = this.watchers.get(this.configPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(this.configPath);
      logger.info('Stopped watching configuration file');
    }
  }

  /**
   * Get environment-specific configuration
   */
  getEnvironmentConfig(): RuntimeConfig {
    const config = this.getConfig();
    return config.runtime || this.getDefaultRuntimeConfig();
  }

  /**
   * Merge configurations
   */
  mergeConfigs(...configs: Partial<ClaudeFlowConfig>[]): ClaudeFlowConfig {
    const merged = configs.reduce((acc, config) => {
      return this.deepMerge(acc, config);
    }, {} as any);

    const validation = validateConfig(merged);
    if (!validation.valid) {
      throw new Error(`Merged configuration is invalid: ${validation.errors.join(', ')}`);
    }

    return merged;
  }

  /**
   * Private helper methods
   */
  private findConfigPath(): string {
    for (const path of this.defaultPaths) {
      if (existsSync(path)) {
        return resolve(path);
      }
    }
    return resolve(this.defaultPaths[0]);
  }

  private getCurrentVersion(): string {
    return '1.0.0'; // Should match package.json version
  }

  private async migrateConfig(config: any): Promise<ClaudeFlowConfig> {
    const fromVersion = config.version || '0.0.0';
    const toVersion = this.getCurrentVersion();
    
    logger.info(`Migrating configuration from ${fromVersion} to ${toVersion}`);
    
    let migratedConfig = config;
    
    for (const migration of migrations) {
      if (this.compareVersions(fromVersion, migration.from) >= 0 &&
          this.compareVersions(migration.to, toVersion) <= 0) {
        migratedConfig = migration.migrate(migratedConfig);
        logger.info(`Applied migration: ${migration.description}`);
      }
    }
    
    migratedConfig.version = toVersion;
    return migratedConfig;
  }

  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      
      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }
    
    return 0;
  }

  private getChangedKeys(obj1: any, obj2: any, prefix = ''): string[] {
    const changes: string[] = [];
    const allKeys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);
    
    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      
      if (!(key in obj1) || !(key in obj2) || obj1[key] !== obj2[key]) {
        if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
          changes.push(...this.getChangedKeys(obj1[key], obj2[key], path));
        } else {
          changes.push(path);
        }
      }
    }
    
    return changes;
  }

  private deepMerge(target: any, source: any): any {
    const output = { ...target };
    
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }

  private getDefaultConfig(): ClaudeFlowConfig {
    const env = process.env.NODE_ENV || 'development';
    
    return {
      version: this.getCurrentVersion(),
      daemon: {
        enabled: env === 'production',
        autoStart: false,
        pidFile: '/tmp/claudeflow.pid',
        logFile: '/tmp/claudeflow.log',
        ipc: {
          transport: 'unix',
          path: '/tmp/claudeflow.sock',
          timeout: 5000
        },
        healthCheck: {
          enabled: true,
          interval: 30000,
          timeout: 5000
        }
      },
      registry: {
        backend: env === 'production' ? 'sqlite' : 'memory',
        path: './claudeflow.db',
        backup: {
          enabled: env === 'production',
          interval: 3600000,
          retention: 7,
          path: './backups'
        },
        cleanup: {
          orphanedProcessTimeout: 300000,
          heartbeatTimeout: 60000,
          maxProcessHistory: 1000
        },
        persistence: {
          enabled: env === 'production',
          flushInterval: 60000
        }
      },
      security: {
        authentication: {
          method: env === 'production' ? 'token' : 'none'
        },
        authorization: {
          enabled: false
        },
        encryption: {
          enabled: false
        },
        audit: {
          enabled: env === 'production',
          level: 'basic'
        }
      },
      monitoring: {
        enabled: env === 'production',
        metrics: {
          enabled: false
        },
        logging: {
          level: env === 'production' ? 'info' : 'debug',
          format: 'json'
        },
        tracing: {
          enabled: false
        },
        alerting: {
          enabled: false
        }
      },
      performance: {
        maxConcurrentAgents: 10,
        agentTimeoutMs: 300000,
        memoryLimit: '1GB',
        cpuLimit: 80,
        cache: {
          enabled: true,
          size: '100MB',
          ttl: 3600
        },
        pooling: {
          enabled: true,
          minSize: 2,
          maxSize: 10
        }
      },
      runtime: this.getDefaultRuntimeConfig()
    };
  }

  private getDefaultRuntimeConfig(): RuntimeConfig {
    return {
      environment: (process.env.NODE_ENV || 'development') as any,
      processTitle: 'claude-flow',
      features: {
        experimental: false,
        debug: process.env.NODE_ENV !== 'production',
        profiling: false
      }
    };
  }
}

function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}

// Export singleton instance
export const configManager = ConfigManager.getInstance();