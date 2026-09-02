/**
 * Integration Types for Claude Flow v2.0.0
 */

export interface IntegrationConfig {
  // Core configuration
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  environment?: 'development' | 'production' | 'testing';

  // Component-specific configuration
  orchestrator?: {
    maxConcurrency?: number;
    timeout?: number;
  };

  agents?: {
    maxAgents?: number;
    defaultStrategy?: string;
  };

  swarm?: {
    topology?: 'centralized' | 'distributed' | 'hierarchical' | 'mesh';
    maxDepth?: number;
    enablePersistence?: boolean;
  };

  memory?: {
    backend?: 'memory' | 'file' | 'redis';
    ttl?: number;
    maxSize?: number;
  };

  monitoring?: {
    enabled?: boolean;
    metrics?: boolean;
    realTime?: boolean;
  };

  mcp?: {
    port?: number;
    host?: string;
    enableAuth?: boolean;
  };
}

export interface ComponentStatus {
  component: string;
  status: 'healthy' | 'unhealthy' | 'warning';
  message: string;
  timestamp: number;
  lastHealthCheck: number;
  metrics?: Record<string, any>;
}

export interface SystemHealth {
  overall: 'healthy' | 'unhealthy' | 'warning';
  components: Record<string, ComponentStatus>;
  metrics: {
    totalComponents: number;
    healthyComponents: number;
    unhealthyComponents: number;
    warningComponents: number;
    uptime: number;
  };
  timestamp: number;
}

export interface IntegrationEvent {
  type: string;
  component: string;
  data: any;
  timestamp: number;
}

export interface HealthCheckResult {
  component: string;
  healthy: boolean;
  message?: string;
  metrics?: Record<string, any>;
  timestamp: number;
}

export interface ComponentDependency {
  component: string;
  depends: string[];
  optional?: boolean;
}

export interface InitializationPhase {
  phase: number;
  name: string;
  description: string;
  components: string[];
  dependencies?: string[];
  timeout?: number;
}

export interface SystemMetrics {
  cpu: number;
  memory: number;
  network: number;
  disk: number;
  activeAgents: number;
  activeTasks: number;
  queuedTasks: number;
  completedTasks: number;
  errorCount: number;
  uptime: number;
  timestamp: number;
}

export interface ComponentInterface {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getStatus(): ComponentStatus;
  healthCheck(): Promise<HealthCheckResult>;
}

export interface WiringConfig {
  source: string;
  target: string;
  relationship: 'uses' | 'depends' | 'observes' | 'controls';
  bidirectional?: boolean;
}

export interface FallbackConfig {
  component: string;
  fallback: string;
  condition: string;
  timeout?: number;
}

export interface EdgeCaseHandler {
  scenario: string;
  handler: string;
  priority: number;
  timeout?: number;
}
