/**
 * Configuration types for Claude-Flow
 */

export interface ClaudeFlowConfig {
  version: string;
  daemon: DaemonConfig;
  registry: RegistryConfig;
  security: SecurityConfig;
  monitoring: MonitoringConfig;
  performance: PerformanceConfig;
  runtime: RuntimeConfig;
}

export interface DaemonConfig {
  enabled: boolean;
  autoStart: boolean;
  pidFile: string;
  logFile: string;
  ipc: IPCConfig;
  healthCheck: {
    enabled: boolean;
    interval: number;
    timeout: number;
  };
}

export interface IPCConfig {
  transport: 'unix' | 'named-pipe' | 'http';
  path?: string;
  port?: number;
  timeout: number;
  maxConnections?: number;
  retryOptions?: {
    maxRetries: number;
    retryDelay: number;
    backoffMultiplier: number;
  };
}

export interface RegistryConfig {
  backend: 'memory' | 'sqlite' | 'file';
  path?: string;
  backup: BackupConfig;
  cleanup: CleanupConfig;
  persistence: {
    enabled: boolean;
    flushInterval?: number;
    compressionLevel?: number;
  };
}

export interface BackupConfig {
  enabled: boolean;
  interval: number;
  retention: number;
  path: string;
  compression?: boolean;
  encryption?: boolean;
}

export interface CleanupConfig {
  orphanedProcessTimeout: number;
  heartbeatTimeout: number;
  maxProcessHistory: number;
  staleDataThreshold?: number;
}

export interface SecurityConfig {
  authentication: {
    method: 'none' | 'token' | 'jwt' | 'oauth';
    tokenFile?: string;
    jwtSecret?: string;
    oauthProvider?: string;
  };
  authorization: {
    enabled: boolean;
    rbac?: boolean;
    policyFile?: string;
  };
  encryption: {
    enabled: boolean;
    algorithm?: string;
    keyFile?: string;
  };
  audit: {
    enabled: boolean;
    logFile?: string;
    level?: 'basic' | 'detailed' | 'full';
  };
}

export interface MonitoringConfig {
  enabled: boolean;
  metrics: {
    enabled: boolean;
    port?: number;
    exporters?: string[];
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'text' | 'pretty';
    outputs?: string[];
  };
  tracing: {
    enabled: boolean;
    samplingRate?: number;
    exporters?: string[];
  };
  alerting: {
    enabled: boolean;
    rules?: string;
    webhooks?: string[];
  };
}

export interface PerformanceConfig {
  maxConcurrentAgents: number;
  agentTimeoutMs: number;
  memoryLimit: string;
  cpuLimit: number;
  cache: {
    enabled: boolean;
    size?: string;
    ttl?: number;
    strategy?: 'lru' | 'lfu' | 'fifo';
  };
  pooling: {
    enabled: boolean;
    minSize?: number;
    maxSize?: number;
    idleTimeoutMs?: number;
  };
}

export interface RuntimeConfig {
  environment: 'development' | 'staging' | 'production' | 'test';
  nodeOptions?: string[];
  processTitle?: string;
  workDir?: string;
  features: {
    experimental?: boolean;
    debug?: boolean;
    profiling?: boolean;
  };
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigMigration {
  from: string;
  to: string;
  description: string;
  migrate: (config: any) => ClaudeFlowConfig;
}