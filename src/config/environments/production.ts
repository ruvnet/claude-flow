import { ClaudeFlowConfig } from '../types.js';

/**
 * Production environment configuration
 */
export const productionConfig: ClaudeFlowConfig = {
  version: '1.0.0',
  daemon: {
    enabled: true,
    autoStart: true,
    pidFile: '/var/run/claudeflow.pid',
    logFile: '/var/log/claudeflow.log',
    ipc: {
      transport: 'http',
      port: 8080,
      timeout: 15000,
      maxConnections: 100,
      retryOptions: {
        maxRetries: 10,
        retryDelay: 5000,
        backoffMultiplier: 1.5
      }
    },
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 5000
    }
  },
  registry: {
    backend: 'sqlite',
    path: '/var/lib/claudeflow/production.db',
    backup: {
      enabled: true,
      interval: 3600000, // 1 hour
      retention: 7,
      path: '/var/lib/claudeflow/backups/production',
      compression: true,
      encryption: true
    },
    cleanup: {
      orphanedProcessTimeout: 300000,
      heartbeatTimeout: 120000,
      maxProcessHistory: 1000,
      staleDataThreshold: 1800000
    },
    persistence: {
      enabled: true,
      flushInterval: 60000,
      compressionLevel: 9
    }
  },
  security: {
    authentication: {
      method: 'jwt',
      jwtSecret: process.env.JWT_SECRET || 'CHANGE_THIS_IN_PRODUCTION'
    },
    authorization: {
      enabled: true,
      rbac: true,
      policyFile: '/etc/claudeflow/rbac-policy.json'
    },
    encryption: {
      enabled: true,
      algorithm: 'aes-256-gcm',
      keyFile: '/etc/claudeflow/encryption.key'
    },
    audit: {
      enabled: true,
      logFile: '/var/log/claudeflow-audit.log',
      level: 'full'
    }
  },
  monitoring: {
    enabled: true,
    metrics: {
      enabled: true,
      port: 9090,
      exporters: ['prometheus', 'cloudwatch']
    },
    logging: {
      level: 'warn',
      format: 'json',
      outputs: ['file', 'syslog']
    },
    tracing: {
      enabled: true,
      samplingRate: 0.01,
      exporters: ['jaeger', 'zipkin']
    },
    alerting: {
      enabled: true,
      rules: '/etc/claudeflow/alert-rules.yaml',
      webhooks: [
        process.env.SLACK_WEBHOOK || '',
        process.env.PAGERDUTY_WEBHOOK || ''
      ].filter(Boolean)
    }
  },
  performance: {
    maxConcurrentAgents: 50,
    agentTimeoutMs: 300000,
    memoryLimit: '4GB',
    cpuLimit: 80,
    cache: {
      enabled: true,
      size: '1GB',
      ttl: 7200,
      strategy: 'lfu'
    },
    pooling: {
      enabled: true,
      minSize: 10,
      maxSize: 50,
      idleTimeoutMs: 600000
    }
  },
  runtime: {
    environment: 'production',
    processTitle: 'claude-flow',
    nodeOptions: [
      '--max-old-space-size=4096',
      '--enable-source-maps',
      '--no-warnings'
    ],
    features: {
      experimental: false,
      debug: false,
      profiling: false
    }
  }
};