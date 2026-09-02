/**
 * Verification API Types
 * Core type definitions for verification system
 */

export interface VerificationStatus {
  id: string;
  timestamp: number;
  status: 'verified' | 'pending' | 'failed' | 'unknown';
  confidence: number; // 0-1 score
  source: string;
  target: string;
  metadata?: Record<string, any>;
}

export interface TruthMonitoringEvent {
  id: string;
  type: 'truth_change' | 'confidence_update' | 'verification_complete' | 'error';
  timestamp: number;
  data: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface VerificationQuery {
  id?: string;
  sources?: string[];
  targets?: string[];
  status?: VerificationStatus['status'][];
  confidence_min?: number;
  confidence_max?: number;
  timestamp_start?: number;
  timestamp_end?: number;
  limit?: number;
  offset?: number;
}

export interface VerificationMetrics {
  total_verifications: number;
  successful_verifications: number;
  failed_verifications: number;
  pending_verifications: number;
  average_confidence: number;
  success_rate: number;
  verification_rate: number; // per hour
  response_time: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
}

export interface AgentVerificationConfig {
  agent_id: string;
  verification_enabled: boolean;
  confidence_threshold: number;
  auto_verify: boolean;
  webhook_url?: string;
  rate_limit: {
    requests_per_minute: number;
    burst_capacity: number;
  };
}

export interface VerificationRule {
  id: string;
  name: string;
  description: string;
  condition: string; // JSON Logic or similar
  action: 'approve' | 'reject' | 'flag' | 'escalate';
  priority: number;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    timestamp: number;
    request_id: string;
    version: string;
  };
}

export interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'event' | 'error' | 'heartbeat';
  payload?: any;
  id?: string;
}

export interface SubscriptionFilter {
  event_types?: TruthMonitoringEvent['type'][];
  severity_levels?: TruthMonitoringEvent['severity'][];
  sources?: string[];
  targets?: string[];
}

export interface GraphQLContext {
  user_id?: string;
  agent_id?: string;
  api_key?: string;
  rate_limit_remaining?: number;
}

export interface VerificationBatch {
  id: string;
  items: VerificationRequest[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: number;
  completed_at?: number;
  results?: VerificationStatus[];
}

export interface VerificationRequest {
  source: string;
  target: string;
  metadata?: Record<string, any>;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  timeout?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  services: {
    api: ServiceHealth;
    websocket: ServiceHealth;
    graphql: ServiceHealth;
    database: ServiceHealth;
    cache: ServiceHealth;
  };
  metrics: {
    uptime: number;
    memory_usage: number;
    cpu_usage: number;
    active_connections: number;
  };
}

export interface ServiceHealth {
  status: 'up' | 'down' | 'degraded';
  response_time?: number;
  last_check: number;
  error_count: number;
}
