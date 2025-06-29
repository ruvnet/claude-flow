/**
 * Configuration loader utility for easy integration
 */

import { logger } from '../core/logger';
import { configManager, initializeConfig } from './index.js';
import { ClaudeFlowConfig } from './types.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Load configuration with fallback options
 */
export async function loadConfiguration(options?: {
  configPath?: string;
  environment?: string;
  enableHotReload?: boolean;
}): Promise<ClaudeFlowConfig> {
  const { configPath, environment, enableHotReload = true } = options || {};
  
  try {
    // Set environment if provided
    if (environment) {
      process.env['NODE_ENV'] = environment;
    }
    
    // Try to load from specified path or find default
    const config = await initializeConfig(configPath);
    
    // Enable hot reloading if requested
    if (enableHotReload && process.env['NODE_ENV'] !== 'production') {
      configManager.watchConfig((event) => {
        logger.info('Configuration updated', {
          changedKeys: event.changedKeys
        });
      });
    }
    
    logger.info('Configuration loaded successfully', {
      environment: config.runtime.environment,
      version: config.version
    });
    
    return config;
  } catch (error) {
    logger.error('Failed to load configuration', { error });
    throw error;
  }
}

/**
 * Create default configuration file if it doesn't exist
 */
export async function createDefaultConfigFile(path?: string): Promise<string> {
  const configPath = path || './claude-flow.config.json';
  
  if (!existsSync(configPath)) {
    const defaultConfig = configManager.getConfig();
    await configManager.saveConfig(defaultConfig, configPath);
    logger.info(`Created default configuration file at ${configPath}`);
  }
  
  return resolve(configPath);
}

/**
 * Configuration integration helper for existing modules
 */
export class ConfigIntegration {
  private static instance: ConfigIntegration;
  private config: ClaudeFlowConfig | null = null;
  
  static getInstance(): ConfigIntegration {
    if (!ConfigIntegration.instance) {
      ConfigIntegration.instance = new ConfigIntegration();
    }
    return ConfigIntegration.instance;
  }
  
  /**
   * Initialize configuration for a module
   */
  async initialize(moduleName: string, options?: any): Promise<void> {
    if (!this.config) {
      this.config = await loadConfiguration(options);
    }
    
    logger.debug(`Configuration initialized for module: ${moduleName}`);
  }
  
  /**
   * Get configuration for specific module
   */
  getModuleConfig<T>(modulePath: string): T {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    
    return configManager.get<T>(modulePath) as T;
  }
  
  /**
   * Get daemon configuration
   */
  getDaemonConfig() {
    return this.getModuleConfig<ClaudeFlowConfig['daemon']>('daemon');
  }
  
  /**
   * Get registry configuration
   */
  getRegistryConfig() {
    return this.getModuleConfig<ClaudeFlowConfig['registry']>('registry');
  }
  
  /**
   * Get security configuration
   */
  getSecurityConfig() {
    return this.getModuleConfig<ClaudeFlowConfig['security']>('security');
  }
  
  /**
   * Get performance configuration
   */
  getPerformanceConfig() {
    return this.getModuleConfig<ClaudeFlowConfig['performance']>('performance');
  }
  
  /**
   * Get monitoring configuration
   */
  getMonitoringConfig() {
    return this.getModuleConfig<ClaudeFlowConfig['monitoring']>('monitoring');
  }
}