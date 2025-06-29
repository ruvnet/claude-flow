import { ClaudeFlowConfig } from '../types.js';

/**
 * Staging environment configuration
 */
export const stagingConfig: ClaudeFlowConfig = {
  version: '1.0.0',
  daemon: {
    enabled: true,
    autoStart: false,
    pidFile: '/var/run/claudeflow-staging.pid',
    logFile: '/var/log/claudeflow-staging.log',
    ipc: {
      transport: 'http',
      port: 8081,
      timeout: 10000,
      maxConnections: 50,
      retryOptions: {
        maxRetries: 5,
        retryDelay: 2000,
        backoffMultiplier: 2
      }
    },
    healthCheck: {
      enabled: true,
      interval: 60000,
      timeout: 10000
    }
  },
  registry: {
    backend: 'sqlite',
    path: '/var/lib/claudeflow/staging.db',
    backup: {
      enabled: true,
      interval: 1800000, // 30 minutes
      retention: 3,
      path: '/var/lib/claudeflow/backups/staging',
      compression: true,
      encryption: false
    },
    cleanup: {
      orphanedProcessTimeout: 180000,
      heartbeatTimeout: 60000,
      maxProcessHistory: 500,
      staleDataThreshold: 600000
    },
    persistence: {
      enabled: true,
      flushInterval: 30000,
      compressionLevel: 6
    }
  },
  security: {
    authentication: {
      method: 'token',
      tokenFile: '/etc/claudeflow/staging-token'
    },
    authorization: {
      enabled: true,
      rbac: false
    },
    encryption: {
      enabled: false
    },
    audit: {
      enabled: true,
      logFile: '/var/log/claudeflow-staging-audit.log',
      level: 'detailed'
    }
  },
  monitoring: {
    enabled: true,
    metrics: {
      enabled: true,
      port: 9091,
      exporters: ['prometheus']
    },
    logging: {
      level: 'info',
      format: 'json',
      outputs: ['file', 'console']
    },
    tracing: {
      enabled: true,
      samplingRate: 0.1,
      exporters: ['jaeger']
    },
    alerting: {
      enabled: false
    }
  },
  performance: {
    maxConcurrentAgents: 20,
    agentTimeoutMs: 180000,
    memoryLimit: '2GB',
    cpuLimit: 70,
    cache: {
      enabled: true,
      size: '256MB',
      ttl: 3600,
      strategy: 'lru'
    },
    pooling: {
      enabled: true,
      minSize: 5,
      maxSize: 20,
      idleTimeoutMs: 300000
    }
  },
  runtime: {
    environment: 'staging',
    processTitle: 'claude-flow-staging',
    nodeOptions: ['--max-old-space-size=2048'],
    features: {
      experimental: false,
      debug: true,
      profiling: false
    }
  }
};