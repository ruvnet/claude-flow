import { ClaudeFlowConfig } from '../types.js';

/**
 * Development environment configuration
 */
export const developmentConfig: ClaudeFlowConfig = {
  version: '1.0.0',
  daemon: {
    enabled: false,
    autoStart: false,
    pidFile: '/tmp/claudeflow-dev.pid',
    logFile: '/tmp/claudeflow-dev.log',
    ipc: {
      transport: 'unix',
      path: '/tmp/claudeflow-dev.sock',
      timeout: 5000,
      retryOptions: {
        maxRetries: 3,
        retryDelay: 1000,
        backoffMultiplier: 2
      }
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
      path: './backups/dev',
      compression: false,
      encryption: false
    },
    cleanup: {
      orphanedProcessTimeout: 60000,
      heartbeatTimeout: 30000,
      maxProcessHistory: 100,
      staleDataThreshold: 300000
    },
    persistence: {
      enabled: false
    }
  },
  security: {
    authentication: {
      method: 'none'
    },
    authorization: {
      enabled: false
    },
    encryption: {
      enabled: false
    },
    audit: {
      enabled: false,
      level: 'basic'
    }
  },
  monitoring: {
    enabled: true,
    metrics: {
      enabled: false
    },
    logging: {
      level: 'debug',
      format: 'pretty',
      outputs: ['console']
    },
    tracing: {
      enabled: false
    },
    alerting: {
      enabled: false
    }
  },
  performance: {
    maxConcurrentAgents: 5,
    agentTimeoutMs: 60000,
    memoryLimit: '512MB',
    cpuLimit: 50,
    cache: {
      enabled: true,
      size: '50MB',
      ttl: 1800,
      strategy: 'lru'
    },
    pooling: {
      enabled: false
    }
  },
  runtime: {
    environment: 'development',
    processTitle: 'claude-flow-dev',
    workDir: './tmp',
    features: {
      experimental: true,
      debug: true,
      profiling: true
    }
  }
};