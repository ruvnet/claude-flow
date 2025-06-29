/**
 * Configuration management for Claude-Flow
 */

// Export types
export * from './types.js';

// Export ConfigManager
export { ConfigManager, configManager } from './ConfigManager.js';
export type { ConfigChangeEvent } from './ConfigManager.js';

// Export validator
export { validateConfig } from './validator.js';

// Export migrations
export { migrations, createMigration, applyMigrations } from './migrations.js';

// Export environments
export * from './environments/index.js';

// Re-export commonly used functions
import { configManager } from './ConfigManager.js';
import { getEnvironmentConfig, isProduction, isDevelopment, isStaging } from './environments/index.js';
import { ClaudeFlowConfig } from './types.js';

/**
 * Initialize and load configuration
 */
export async function initializeConfig(configPath?: string): Promise<ClaudeFlowConfig> {
  // Load config from file or environment
  const config = configPath 
    ? await configManager.loadConfig(configPath)
    : await configManager.loadConfig();
  
  // Enable hot reloading in development
  if (isDevelopment()) {
    configManager.watchConfig((event) => {
      console.log('Configuration changed:', event.changedKeys);
    });
  }
  
  return config;
}

/**
 * Get current configuration (shorthand)
 */
export function getConfig(): ClaudeFlowConfig {
  return configManager.getConfig();
}

/**
 * Get configuration value by path (shorthand)
 */
export function getConfigValue<T = any>(path: string): T | undefined {
  return configManager.get<T>(path);
}

/**
 * Set configuration value (shorthand)
 */
export async function setConfigValue(path: string, value: any): Promise<void> {
  return configManager.set(path, value);
}

/**
 * Configuration presets for common scenarios
 */
export const ConfigPresets = {
  /**
   * Minimal configuration for testing
   */
  testing: (): Partial<ClaudeFlowConfig> => ({
    daemon: { 
      enabled: false,
      autoStart: false,
      pidFile: '/tmp/claudeflow-test.pid',
      logFile: '/tmp/claudeflow-test.log',
      ipc: {
        transport: 'unix',
        path: '/tmp/claudeflow-test.sock',
        timeout: 5000
      },
      healthCheck: {
        enabled: false,
        interval: 30000,
        timeout: 5000
      }
    },
    registry: { 
      backend: 'memory',
      backup: {
        enabled: false,
        interval: 3600000,
        retention: 1,
        path: './test-backups'
      },
      cleanup: {
        orphanedProcessTimeout: 60000,
        heartbeatTimeout: 30000,
        maxProcessHistory: 100
      },
      persistence: {
        enabled: false
      }
    },
    security: { 
      authentication: { method: 'none' },
      authorization: {
        enabled: false
      },
      encryption: {
        enabled: false
      },
      audit: {
        enabled: false
      }
    },
    monitoring: { 
      enabled: false,
      metrics: {
        enabled: false
      },
      logging: {
        level: 'debug',
        format: 'text'
      },
      tracing: {
        enabled: false
      },
      alerting: {
        enabled: false
      }
    },
    performance: {
      maxConcurrentAgents: 2,
      agentTimeoutMs: 10000,
      memoryLimit: '256MB',
      cpuLimit: 50,
      cache: {
        enabled: false,
        size: '10MB',
        ttl: 300
      },
      pooling: {
        enabled: false,
        minSize: 1,
        maxSize: 2
      }
    }
  }),

  /**
   * High-performance configuration
   */
  highPerformance: (): Partial<ClaudeFlowConfig> => ({
    performance: {
      maxConcurrentAgents: 100,
      agentTimeoutMs: 600000,
      memoryLimit: '8GB',
      cpuLimit: 90,
      cache: {
        enabled: true,
        size: '2GB',
        ttl: 14400,
        strategy: 'lfu'
      },
      pooling: {
        enabled: true,
        minSize: 20,
        maxSize: 100,
        idleTimeoutMs: 300000
      }
    }
  }),

  /**
   * Secure configuration
   */
  secure: (): Partial<ClaudeFlowConfig> => ({
    security: {
      authentication: {
        method: 'jwt'
      },
      authorization: {
        enabled: true,
        rbac: true
      },
      encryption: {
        enabled: true,
        algorithm: 'aes-256-gcm'
      },
      audit: {
        enabled: true,
        level: 'full'
      }
    }
  })
};

// Default export
export default configManager;