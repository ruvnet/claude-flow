import { ConfigMigration, ClaudeFlowConfig } from './types.js';

/**
 * Configuration migrations for version upgrades
 */
export const migrations: ConfigMigration[] = [
  {
    from: '0.1.0',
    to: '0.2.0',
    description: 'Add health check configuration to daemon',
    migrate: (config: any): any => {
      if (config.daemon && !config.daemon.healthCheck) {
        config.daemon.healthCheck = {
          enabled: true,
          interval: 30000,
          timeout: 5000
        };
      }
      return config;
    }
  },
  {
    from: '0.2.0',
    to: '0.3.0',
    description: 'Add persistence configuration to registry',
    migrate: (config: any): any => {
      if (config.registry && !config.registry.persistence) {
        config.registry.persistence = {
          enabled: config.registry.backend !== 'memory',
          flushInterval: 60000
        };
      }
      return config;
    }
  },
  {
    from: '0.3.0',
    to: '0.4.0',
    description: 'Add runtime configuration section',
    migrate: (config: any): any => {
      if (!config.runtime) {
        config.runtime = {
          environment: process.env['NODE_ENV'] || 'development',
          processTitle: 'claude-flow',
          features: {
            experimental: false,
            debug: process.env['NODE_ENV'] !== 'production',
            profiling: false
          }
        };
      }
      return config;
    }
  },
  {
    from: '0.4.0',
    to: '0.5.0',
    description: 'Add retry options to IPC configuration',
    migrate: (config: any): any => {
      if (config.daemon?.ipc && !config.daemon.ipc.retryOptions) {
        config.daemon.ipc.retryOptions = {
          maxRetries: 3,
          retryDelay: 1000,
          backoffMultiplier: 2
        };
      }
      return config;
    }
  },
  {
    from: '0.5.0',
    to: '0.6.0',
    description: 'Add security audit configuration',
    migrate: (config: any): any => {
      if (config.security && !config.security.audit) {
        config.security.audit = {
          enabled: config.runtime?.environment === 'production',
          level: 'basic'
        };
      }
      return config;
    }
  },
  {
    from: '0.6.0',
    to: '0.7.0',
    description: 'Add performance cache configuration',
    migrate: (config: any): any => {
      if (config.performance && !config.performance.cache) {
        config.performance.cache = {
          enabled: true,
          size: '100MB',
          ttl: 3600,
          strategy: 'lru'
        };
      }
      return config;
    }
  },
  {
    from: '0.7.0',
    to: '0.8.0',
    description: 'Add monitoring alerting configuration',
    migrate: (config: any): any => {
      if (config.monitoring && !config.monitoring.alerting) {
        config.monitoring.alerting = {
          enabled: false,
          webhooks: []
        };
      }
      return config;
    }
  },
  {
    from: '0.8.0',
    to: '0.9.0',
    description: 'Add backup encryption and compression options',
    migrate: (config: any): any => {
      if (config.registry?.backup) {
        if (config.registry.backup.compression === undefined) {
          config.registry.backup.compression = true;
        }
        if (config.registry.backup.encryption === undefined) {
          config.registry.backup.encryption = false;
        }
      }
      return config;
    }
  },
  {
    from: '0.9.0',
    to: '1.0.0',
    description: 'Final v1.0.0 migration - normalize all configurations',
    migrate: (config: any): ClaudeFlowConfig => {
      // Ensure all required sections exist
      const normalizedConfig: ClaudeFlowConfig = {
        version: '1.0.0',
        daemon: config.daemon || getDefaultDaemonConfig(),
        registry: config.registry || getDefaultRegistryConfig(),
        security: config.security || getDefaultSecurityConfig(),
        monitoring: config.monitoring || getDefaultMonitoringConfig(),
        performance: config.performance || getDefaultPerformanceConfig(),
        runtime: config.runtime || getDefaultRuntimeConfig()
      };

      // Deep merge with existing config
      return deepMerge(normalizedConfig, config) as ClaudeFlowConfig;
    }
  }
];

/**
 * Create a migration helper function
 */
export function createMigration(
  from: string,
  to: string,
  description: string,
  migrate: (config: any) => any
): ConfigMigration {
  return { from, to, description, migrate };
}

/**
 * Apply all migrations to a configuration
 */
export function applyMigrations(
  config: any,
  fromVersion: string,
  toVersion: string
): ClaudeFlowConfig {
  let migratedConfig = config;
  const applicableMigrations = migrations.filter(
    m => compareVersions(fromVersion, m.from) <= 0 && compareVersions(m.to, toVersion) <= 0
  );

  for (const migration of applicableMigrations) {
    migratedConfig = migration.migrate(migratedConfig);
  }

  migratedConfig.version = toVersion;
  return migratedConfig;
}

/**
 * Helper functions
 */
function compareVersions(v1: string, v2: string): number {
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

function deepMerge(target: any, source: any): any {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          output[key] = source[key];
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        output[key] = source[key];
      }
    });
  }
  
  return output;
}

function isObject(item: any): boolean {
  return item && typeof item === 'object' && !Array.isArray(item);
}

// Default configuration getters for migration
function getDefaultDaemonConfig() {
  return {
    enabled: false,
    autoStart: false,
    pidFile: '/tmp/claudeflow.pid',
    logFile: '/tmp/claudeflow.log',
    ipc: {
      transport: 'unix' as const,
      path: '/tmp/claudeflow.sock',
      timeout: 5000
    },
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 5000
    }
  };
}

function getDefaultRegistryConfig() {
  return {
    backend: 'memory' as const,
    backup: {
      enabled: false,
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
      enabled: false
    }
  };
}

function getDefaultSecurityConfig() {
  return {
    authentication: {
      method: 'none' as const
    },
    authorization: {
      enabled: false
    },
    encryption: {
      enabled: false
    },
    audit: {
      enabled: false,
      level: 'basic' as const
    }
  };
}

function getDefaultMonitoringConfig() {
  return {
    enabled: false,
    metrics: {
      enabled: false
    },
    logging: {
      level: 'info' as const,
      format: 'json' as const
    },
    tracing: {
      enabled: false
    },
    alerting: {
      enabled: false
    }
  };
}

function getDefaultPerformanceConfig() {
  return {
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
  };
}

function getDefaultRuntimeConfig() {
  return {
    environment: 'development' as const,
    processTitle: 'claude-flow',
    features: {
      experimental: false,
      debug: true,
      profiling: false
    }
  };
}