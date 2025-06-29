import { ClaudeFlowConfig, ConfigValidationResult } from './types.js';

/**
 * Validate configuration against schema
 */
export function validateConfig(config: any): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required fields
  if (!config.version) {
    errors.push('Configuration must have a version field');
  }

  // Validate daemon configuration
  if (config.daemon) {
    validateDaemonConfig(config.daemon, errors, warnings);
  } else {
    errors.push('Daemon configuration is required');
  }

  // Validate registry configuration
  if (config.registry) {
    validateRegistryConfig(config.registry, errors, warnings);
  } else {
    errors.push('Registry configuration is required');
  }

  // Validate security configuration
  if (config.security) {
    validateSecurityConfig(config.security, errors, warnings);
  } else {
    errors.push('Security configuration is required');
  }

  // Validate monitoring configuration
  if (config.monitoring) {
    validateMonitoringConfig(config.monitoring, errors, warnings);
  } else {
    errors.push('Monitoring configuration is required');
  }

  // Validate performance configuration
  if (config.performance) {
    validatePerformanceConfig(config.performance, errors, warnings);
  } else {
    errors.push('Performance configuration is required');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

function validateDaemonConfig(daemon: any, errors: string[], warnings: string[]): void {
  if (typeof daemon.enabled !== 'boolean') {
    errors.push('daemon.enabled must be a boolean');
  }

  if (typeof daemon.autoStart !== 'boolean') {
    errors.push('daemon.autoStart must be a boolean');
  }

  if (!daemon.pidFile || typeof daemon.pidFile !== 'string') {
    errors.push('daemon.pidFile must be a string');
  }

  if (!daemon.logFile || typeof daemon.logFile !== 'string') {
    errors.push('daemon.logFile must be a string');
  }

  // Validate IPC configuration
  if (!daemon.ipc) {
    errors.push('daemon.ipc configuration is required');
  } else {
    if (!['unix', 'named-pipe', 'http'].includes(daemon.ipc.transport)) {
      errors.push('daemon.ipc.transport must be one of: unix, named-pipe, http');
    }

    if (daemon.ipc.transport === 'unix' && !daemon.ipc.path) {
      errors.push('daemon.ipc.path is required for unix transport');
    }

    if (daemon.ipc.transport === 'http' && !daemon.ipc.port) {
      errors.push('daemon.ipc.port is required for http transport');
    }

    if (typeof daemon.ipc.timeout !== 'number' || daemon.ipc.timeout <= 0) {
      errors.push('daemon.ipc.timeout must be a positive number');
    }
  }

  // Validate health check
  if (daemon.healthCheck) {
    if (typeof daemon.healthCheck.enabled !== 'boolean') {
      errors.push('daemon.healthCheck.enabled must be a boolean');
    }

    if (daemon.healthCheck.enabled) {
      if (typeof daemon.healthCheck.interval !== 'number' || daemon.healthCheck.interval <= 0) {
        errors.push('daemon.healthCheck.interval must be a positive number');
      }

      if (typeof daemon.healthCheck.timeout !== 'number' || daemon.healthCheck.timeout <= 0) {
        errors.push('daemon.healthCheck.timeout must be a positive number');
      }

      if (daemon.healthCheck.timeout >= daemon.healthCheck.interval) {
        warnings.push('daemon.healthCheck.timeout should be less than interval');
      }
    }
  }
}

function validateRegistryConfig(registry: any, errors: string[], warnings: string[]): void {
  if (!['memory', 'sqlite', 'file'].includes(registry.backend)) {
    errors.push('registry.backend must be one of: memory, sqlite, file');
  }

  if ((registry.backend === 'sqlite' || registry.backend === 'file') && !registry.path) {
    errors.push(`registry.path is required for ${registry.backend} backend`);
  }

  // Validate backup configuration
  if (registry.backup) {
    if (typeof registry.backup.enabled !== 'boolean') {
      errors.push('registry.backup.enabled must be a boolean');
    }

    if (registry.backup.enabled) {
      if (typeof registry.backup.interval !== 'number' || registry.backup.interval <= 0) {
        errors.push('registry.backup.interval must be a positive number');
      }

      if (typeof registry.backup.retention !== 'number' || registry.backup.retention <= 0) {
        errors.push('registry.backup.retention must be a positive number');
      }

      if (!registry.backup.path || typeof registry.backup.path !== 'string') {
        errors.push('registry.backup.path must be a string');
      }

      if (registry.backup.interval < 60000) {
        warnings.push('registry.backup.interval is very short (< 1 minute)');
      }
    }
  }

  // Validate cleanup configuration
  if (registry.cleanup) {
    if (typeof registry.cleanup.orphanedProcessTimeout !== 'number' || registry.cleanup.orphanedProcessTimeout <= 0) {
      errors.push('registry.cleanup.orphanedProcessTimeout must be a positive number');
    }

    if (typeof registry.cleanup.heartbeatTimeout !== 'number' || registry.cleanup.heartbeatTimeout <= 0) {
      errors.push('registry.cleanup.heartbeatTimeout must be a positive number');
    }

    if (typeof registry.cleanup.maxProcessHistory !== 'number' || registry.cleanup.maxProcessHistory <= 0) {
      errors.push('registry.cleanup.maxProcessHistory must be a positive number');
    }
  } else {
    errors.push('registry.cleanup configuration is required');
  }
}

function validateSecurityConfig(security: any, errors: string[], warnings: string[]): void {
  // Validate authentication
  if (!security.authentication) {
    errors.push('security.authentication configuration is required');
  } else {
    if (!['none', 'token', 'jwt', 'oauth'].includes(security.authentication.method)) {
      errors.push('security.authentication.method must be one of: none, token, jwt, oauth');
    }

    if (security.authentication.method === 'token' && !security.authentication.tokenFile) {
      errors.push('security.authentication.tokenFile is required for token method');
    }

    if (security.authentication.method === 'jwt' && !security.authentication.jwtSecret) {
      errors.push('security.authentication.jwtSecret is required for jwt method');
    }

    if (security.authentication.method === 'oauth' && !security.authentication.oauthProvider) {
      errors.push('security.authentication.oauthProvider is required for oauth method');
    }

    if (security.authentication.method === 'none') {
      warnings.push('Authentication is disabled - not recommended for production');
    }
  }

  // Validate authorization
  if (security.authorization) {
    if (typeof security.authorization.enabled !== 'boolean') {
      errors.push('security.authorization.enabled must be a boolean');
    }

    if (security.authorization.enabled && security.authorization.rbac && !security.authorization.policyFile) {
      errors.push('security.authorization.policyFile is required when RBAC is enabled');
    }
  }

  // Validate encryption
  if (security.encryption && security.encryption.enabled) {
    if (!security.encryption.algorithm) {
      errors.push('security.encryption.algorithm is required when encryption is enabled');
    }

    if (!security.encryption.keyFile) {
      errors.push('security.encryption.keyFile is required when encryption is enabled');
    }
  }

  // Validate audit
  if (security.audit && security.audit.enabled) {
    if (!['basic', 'detailed', 'full'].includes(security.audit.level)) {
      errors.push('security.audit.level must be one of: basic, detailed, full');
    }
  }
}

function validateMonitoringConfig(monitoring: any, errors: string[], warnings: string[]): void {
  if (typeof monitoring.enabled !== 'boolean') {
    errors.push('monitoring.enabled must be a boolean');
  }

  // Validate metrics
  if (monitoring.metrics && monitoring.metrics.enabled) {
    if (monitoring.metrics.port && (typeof monitoring.metrics.port !== 'number' || monitoring.metrics.port <= 0 || monitoring.metrics.port > 65535)) {
      errors.push('monitoring.metrics.port must be a valid port number');
    }

    if (monitoring.metrics.exporters && !Array.isArray(monitoring.metrics.exporters)) {
      errors.push('monitoring.metrics.exporters must be an array');
    }
  }

  // Validate logging
  if (!monitoring.logging) {
    errors.push('monitoring.logging configuration is required');
  } else {
    if (!['debug', 'info', 'warn', 'error'].includes(monitoring.logging.level)) {
      errors.push('monitoring.logging.level must be one of: debug, info, warn, error');
    }

    if (!['json', 'text', 'pretty'].includes(monitoring.logging.format)) {
      errors.push('monitoring.logging.format must be one of: json, text, pretty');
    }

    if (monitoring.logging.outputs && !Array.isArray(monitoring.logging.outputs)) {
      errors.push('monitoring.logging.outputs must be an array');
    }
  }

  // Validate tracing
  if (monitoring.tracing && monitoring.tracing.enabled) {
    if (monitoring.tracing.samplingRate !== undefined) {
      if (typeof monitoring.tracing.samplingRate !== 'number' || 
          monitoring.tracing.samplingRate < 0 || 
          monitoring.tracing.samplingRate > 1) {
        errors.push('monitoring.tracing.samplingRate must be between 0 and 1');
      }
    }

    if (monitoring.tracing.exporters && !Array.isArray(monitoring.tracing.exporters)) {
      errors.push('monitoring.tracing.exporters must be an array');
    }
  }

  // Validate alerting
  if (monitoring.alerting && monitoring.alerting.enabled) {
    if (monitoring.alerting.webhooks && !Array.isArray(monitoring.alerting.webhooks)) {
      errors.push('monitoring.alerting.webhooks must be an array');
    }
  }
}

function validatePerformanceConfig(performance: any, errors: string[], warnings: string[]): void {
  if (typeof performance.maxConcurrentAgents !== 'number' || performance.maxConcurrentAgents <= 0) {
    errors.push('performance.maxConcurrentAgents must be a positive number');
  }

  if (typeof performance.agentTimeoutMs !== 'number' || performance.agentTimeoutMs <= 0) {
    errors.push('performance.agentTimeoutMs must be a positive number');
  }

  if (!performance.memoryLimit || typeof performance.memoryLimit !== 'string') {
    errors.push('performance.memoryLimit must be a string (e.g., "1GB")');
  } else if (!isValidMemoryLimit(performance.memoryLimit)) {
    errors.push('performance.memoryLimit must be in format: <number><unit> (e.g., "1GB", "512MB")');
  }

  if (typeof performance.cpuLimit !== 'number' || performance.cpuLimit <= 0 || performance.cpuLimit > 100) {
    errors.push('performance.cpuLimit must be between 1 and 100');
  }

  // Validate cache configuration
  if (performance.cache && performance.cache.enabled) {
    if (!isValidMemoryLimit(performance.cache.size)) {
      errors.push('performance.cache.size must be in format: <number><unit>');
    }

    if (typeof performance.cache.ttl !== 'number' || performance.cache.ttl <= 0) {
      errors.push('performance.cache.ttl must be a positive number');
    }

    if (performance.cache.strategy && !['lru', 'lfu', 'fifo'].includes(performance.cache.strategy)) {
      errors.push('performance.cache.strategy must be one of: lru, lfu, fifo');
    }
  }

  // Validate pooling configuration
  if (performance.pooling && performance.pooling.enabled) {
    if (typeof performance.pooling.minSize !== 'number' || performance.pooling.minSize < 0) {
      errors.push('performance.pooling.minSize must be a non-negative number');
    }

    if (typeof performance.pooling.maxSize !== 'number' || performance.pooling.maxSize <= 0) {
      errors.push('performance.pooling.maxSize must be a positive number');
    }

    if (performance.pooling.minSize > performance.pooling.maxSize) {
      errors.push('performance.pooling.minSize cannot be greater than maxSize');
    }

    if (typeof performance.pooling.idleTimeoutMs !== 'number' || performance.pooling.idleTimeoutMs < 0) {
      errors.push('performance.pooling.idleTimeoutMs must be a non-negative number');
    }
  }

  // Warnings
  if (performance.maxConcurrentAgents > 50) {
    warnings.push('performance.maxConcurrentAgents is very high (> 50)');
  }

  if (performance.agentTimeoutMs < 10000) {
    warnings.push('performance.agentTimeoutMs is very short (< 10 seconds)');
  }
}

function isValidMemoryLimit(limit: string): boolean {
  const regex = /^\d+(\.\d+)?(B|KB|MB|GB|TB)$/i;
  return regex.test(limit);
}