export interface AIProvider {
  id: string;
  name: string;
  type: 'anthropic' | 'openai' | 'google' | 'perplexity' | 'xai' | 'mistral';
  apiKey: string;
  baseUrl?: string;
  models: AIModel[];
  capabilities: Record<AICapability, number>; // 0-1 capability score
  rateLimits: RateLimit;
  costPerToken: number;
  metadata?: Record<string, any>;
}

export interface AIModel {
  id: string;
  name: string;
  providerId: string;
  maxTokens: number;
  contextWindow: number;
  costPer1kTokens: {
    input: number;
    output: number;
  };
  capabilities: AICapability[];
  isActive: boolean;
}

export type AICapability = 
  | 'text-generation'
  | 'code-generation' 
  | 'analysis'
  | 'reasoning'
  | 'structured-output'
  | 'long-context'
  | 'multi-language'
  | 'function-calling';

export interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerMinute: number;
  tokensPerHour: number;
  tokensPerDay: number;
}

export interface AIRequest {
  type: AICapability;
  content: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  metadata?: Record<string, any>;
}

export interface AIResponse {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metadata: {
    providerId: string;
    requestId: string;
    [key: string]: any;
  };
}

export interface PerformanceMetrics {
  duration: number;
  success: boolean;
  timestamp: number;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  lastChecked?: number;
  responseTime?: number;
}

export interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailureTime: number | null;
  nextRetryTime: number | null;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining: number;
  resetTime: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public cause: Error | null
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: AIProvider['type'];
  apiKey: string;
  baseUrl?: string;
  enabled: boolean;
  priority: number;
  rateLimits: Partial<RateLimit>;
  costPerToken: number;
  models: string[];
}

export interface ModelSelector {
  selectForPRDParsing(documentSize: number, complexity: string): Promise<string>;
  selectForTaskGeneration(requirementCount: number, domain: string): Promise<string>;
  selectForComplexityAnalysis(projectType: string): Promise<string>;
}

export interface CacheEntry {
  key: string;
  value: AIResponse;
  timestamp: number;
  expiresAt: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheStrategy {
  get(key: string): Promise<AIResponse | null>;
  set(key: string, value: AIResponse, ttl?: number): Promise<void>;
  invalidate(pattern: string): Promise<void>;
  clear(): Promise<void>;
  getStats(): Promise<CacheStats>;
}

export interface CacheStats {
  size: number;
  hitRate: number;
  missRate: number;
  evictionCount: number;
  averageAccessTime: number;
}

export interface RequestContext {
  userId?: string;
  sessionId?: string;
  projectId?: string;
  priority: 'low' | 'medium' | 'high';
  budget?: {
    maxCost: number;
    currency: string;
  };
  timeouts?: {
    request: number;
    total: number;
  };
  retryPolicy?: {
    maxRetries: number;
    backoffStrategy: 'linear' | 'exponential';
    backoffMultiplier: number;
  };
}

export interface SelectionConstraints {
  maxCost?: number;
  maxLatency?: number;
  preferredProviders?: string[];
  excludedProviders?: string[];
  requiredCapabilities?: AICapability[];
  minReliability?: number;
}

export interface SelectedModel {
  modelId: string;
  providerId: string;
  estimatedCost: number;
  estimatedLatency: number;
  confidence: number;
  reasoning: string;
}

export interface UsageMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalTokens: number;
  totalCost: number;
  averageLatency: number;
  providerDistribution: Record<string, number>;
  modelDistribution: Record<string, number>;
  timeRange: {
    start: number;
    end: number;
  };
}

export interface BatchRequest {
  requests: AIRequest[];
  batchId: string;
  priority: number;
  maxConcurrency?: number;
  failFast?: boolean;
}

export interface BatchResponse {
  batchId: string;
  responses: (AIResponse | ProviderError)[];
  summary: {
    successful: number;
    failed: number;
    totalCost: number;
    totalTime: number;
  };
}

export interface StreamingRequest extends AIRequest {
  onProgress?: (partial: Partial<AIResponse>) => void;
  onError?: (error: ProviderError) => void;
  onComplete?: (response: AIResponse) => void;
}

export interface ModelPerformanceData {
  modelId: string;
  providerId: string;
  metrics: {
    averageLatency: number;
    successRate: number;
    costEfficiency: number;
    qualityScore: number;
    lastUpdated: number;
  };
  recentRequests: {
    timestamp: number;
    latency: number;
    success: boolean;
    cost: number;
  }[];
}

export interface ProviderHealthCheck {
  providerId: string;
  endpoint: string;
  method: 'GET' | 'POST';
  expectedStatus: number;
  timeout: number;
  headers?: Record<string, string>;
  body?: any;
}

export interface AlertConfig {
  type: 'error-rate' | 'latency' | 'cost' | 'availability';
  threshold: number;
  window: number; // Time window in seconds
  cooldown: number; // Cooldown period in seconds
  channels: ('email' | 'webhook' | 'log')[];
  enabled: boolean;
}

export interface Alert {
  id: string;
  type: AlertConfig['type'];
  title: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: number;
  providerId?: string;
  modelId?: string;
  metadata?: Record<string, any>;
}

export interface FallbackStrategy {
  type: 'sequential' | 'parallel' | 'cost-optimized' | 'latency-optimized';
  maxProviders: number;
  timeoutPerProvider: number;
  costThreshold?: number;
  latencyThreshold?: number;
}

export interface LoadBalancingStrategy {
  type: 'round-robin' | 'weighted' | 'least-connections' | 'random';
  weights?: Record<string, number>;
  stickySession?: boolean;
}

export interface ProviderRegistry {
  providers: Map<string, AIProvider>;
  register(provider: AIProvider): Promise<void>;
  unregister(providerId: string): Promise<void>;
  getProvider(providerId: string): AIProvider | null;
  getAllProviders(): AIProvider[];
  getHealthyProviders(): Promise<AIProvider[]>;
  updateProvider(providerId: string, updates: Partial<AIProvider>): Promise<void>;
}