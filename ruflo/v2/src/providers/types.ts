/**
 * Multi-LLM Provider Types and Interfaces
 * Unified type system for all LLM providers
 */

import { EventEmitter } from 'events';

// ===== PROVIDER TYPES =====

export type LLMProvider = 
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'cohere'
  | 'ollama'
  | 'llama-cpp'
  | 'custom';

export type LLMModel =
  // OpenAI Models
  | 'gpt-4-turbo-preview'
  | 'gpt-4'
  | 'gpt-4-32k'
  | 'gpt-3.5-turbo'
  | 'gpt-3.5-turbo-16k'
  // Anthropic Models
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307'
  | 'claude-2.1'
  | 'claude-2.0'
  | 'claude-instant-1.2'
  // Google Models
  | 'gemini-pro'
  | 'gemini-pro-vision'
  | 'palm-2'
  | 'bison'
  // Cohere Models
  | 'command'
  | 'command-light'
  | 'command-nightly'
  | 'generate-xlarge'
  | 'generate-medium'
  // Local Models
  | 'llama-2-7b'
  | 'llama-2-13b'
  | 'llama-2-70b'
  | 'mistral-7b'
  | 'mixtral-8x7b'
  | 'custom-model';

// ===== BASE INTERFACES =====

export interface LLMProviderConfig {
  provider: LLMProvider;
  apiKey?: string;
  apiUrl?: string;
  model: LLMModel;
  
  // Common parameters
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  
  // Provider-specific settings
  providerOptions?: Record<string, any>;
  
  // Performance settings
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  
  // Advanced features
  enableStreaming?: boolean;
  enableCaching?: boolean;
  cacheTimeout?: number;
  
  // Cost optimization
  enableCostOptimization?: boolean;
  maxCostPerRequest?: number;
  fallbackModels?: LLMModel[];
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string; // For function messages
  functionCall?: {
    name: string;
    arguments: string;
  };
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: LLMModel;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  stream?: boolean;
  
  // Function calling
  functions?: LLMFunction[];
  functionCall?: 'auto' | 'none' | { name: string };
  
  // Provider-specific options
  providerOptions?: Record<string, any>;
  
  // Cost optimization
  costConstraints?: {
    maxCost?: number;
    preferredModels?: LLMModel[];
  };
}

export interface LLMFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface LLMResponse {
  id: string;
  model: LLMModel;
  provider: LLMProvider;
  
  // Content
  content: string;
  functionCall?: {
    name: string;
    arguments: string;
  };
  
  // Metadata
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  
  // Cost tracking
  cost?: {
    promptCost: number;
    completionCost: number;
    totalCost: number;
    currency: string;
  };
  
  // Performance metrics
  latency?: number;
  
  // Additional info
  finishReason?: 'stop' | 'length' | 'function_call' | 'content_filter';
  metadata?: Record<string, any>;
}

export interface LLMStreamEvent {
  type: 'content' | 'function_call' | 'error' | 'done';
  delta?: {
    content?: string;
    functionCall?: {
      name?: string;
      arguments?: string;
    };
  };
  error?: Error;
  usage?: LLMResponse['usage'];
  cost?: LLMResponse['cost'];
}

// ===== PROVIDER CAPABILITIES =====

export interface ProviderCapabilities {
  // Model features
  supportedModels: LLMModel[];
  maxContextLength: Record<LLMModel, number>;
  maxOutputTokens: Record<LLMModel, number>;
  
  // Feature support
  supportsStreaming: boolean;
  supportsFunctionCalling: boolean;
  supportsSystemMessages: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;
  supportsTools: boolean;
  
  // Advanced features
  supportsFineTuning: boolean;
  supportsEmbeddings: boolean;
  supportsLogprobs: boolean;
  supportsBatching: boolean;
  
  // Constraints
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    concurrentRequests: number;
  };
  
  // Cost information
  pricing?: {
    [model: string]: {
      promptCostPer1k: number;
      completionCostPer1k: number;
      currency: string;
    };
  };
}

// ===== ERROR HANDLING =====

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider: LLMProvider,
    public statusCode?: number,
    public retryable: boolean = true,
    public details?: any
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

export class RateLimitError extends LLMProviderError {
  constructor(
    message: string,
    provider: LLMProvider,
    public retryAfter?: number,
    details?: any
  ) {
    super(message, 'RATE_LIMIT', provider, 429, true, details);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends LLMProviderError {
  constructor(message: string, provider: LLMProvider, details?: any) {
    super(message, 'AUTHENTICATION', provider, 401, false, details);
    this.name = 'AuthenticationError';
  }
}

export class ModelNotFoundError extends LLMProviderError {
  constructor(model: string, provider: LLMProvider, details?: any) {
    super(`Model ${model} not found`, 'MODEL_NOT_FOUND', provider, 404, false, details);
    this.name = 'ModelNotFoundError';
  }
}

export class ProviderUnavailableError extends LLMProviderError {
  constructor(provider: LLMProvider, details?: any) {
    super(`Provider ${provider} is unavailable`, 'PROVIDER_UNAVAILABLE', provider, 503, true, details);
    this.name = 'ProviderUnavailableError';
  }
}

// ===== ABSTRACT PROVIDER INTERFACE =====

export interface ILLMProvider extends EventEmitter {
  // Properties
  readonly name: LLMProvider;
  readonly capabilities: ProviderCapabilities;
  config: LLMProviderConfig;
  
  // Core methods
  initialize(): Promise<void>;
  complete(request: LLMRequest): Promise<LLMResponse>;
  streamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent>;
  
  // Model management
  listModels(): Promise<LLMModel[]>;
  getModelInfo(model: LLMModel): Promise<ModelInfo>;
  validateModel(model: LLMModel): boolean;
  
  // Health and status
  healthCheck(): Promise<HealthCheckResult>;
  getStatus(): ProviderStatus;
  
  // Cost management
  estimateCost(request: LLMRequest): Promise<CostEstimate>;
  getUsage(period?: UsagePeriod): Promise<UsageStats>;
  
  // Cleanup
  destroy(): void;
}

export interface ModelInfo {
  model: LLMModel;
  name: string;
  description: string;
  contextLength: number;
  maxOutputTokens: number;
  supportedFeatures: string[];
  pricing?: {
    promptCostPer1k: number;
    completionCostPer1k: number;
    currency: string;
  };
  deprecated?: boolean;
  deprecationDate?: Date;
  recommendedReplacement?: LLMModel;
}

export interface HealthCheckResult {
  healthy: boolean;
  latency?: number;
  error?: string;
  timestamp: Date;
  details?: Record<string, any>;
}

export interface ProviderStatus {
  available: boolean;
  currentLoad: number;
  queueLength: number;
  activeRequests: number;
  rateLimitRemaining?: number;
  rateLimitReset?: Date;
}

export interface CostEstimate {
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens: number;
  estimatedCost: {
    prompt: number;
    completion: number;
    total: number;
    currency: string;
  };
  confidence: number; // 0-1
}

export interface UsageStats {
  period: {
    start: Date;
    end: Date;
  };
  requests: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  cost: {
    prompt: number;
    completion: number;
    total: number;
    currency: string;
  };
  errors: number;
  averageLatency: number;
  modelBreakdown: Record<LLMModel, {
    requests: number;
    tokens: number;
    cost: number;
  }>;
}

export type UsagePeriod = 'hour' | 'day' | 'week' | 'month' | 'all';

// ===== FALLBACK AND RETRY STRATEGIES =====

export interface FallbackStrategy {
  name: string;
  enabled: boolean;
  rules: FallbackRule[];
  maxAttempts: number;
}

export interface FallbackRule {
  condition: 'error' | 'rate_limit' | 'timeout' | 'cost' | 'unavailable';
  errorCodes?: string[];
  fallbackProviders: LLMProvider[];
  fallbackModels?: LLMModel[];
  retryOriginal: boolean;
  retryDelay?: number;
}

export interface RetryStrategy {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors: string[];
}

// ===== CACHING INTERFACES =====

export interface CacheConfig {
  enabled: boolean;
  ttl: number; // Time to live in seconds
  maxSize: number; // Max cache size in MB
  strategy: 'lru' | 'lfu' | 'ttl';
  keyGenerator?: (request: LLMRequest) => string;
}

export interface CacheEntry {
  key: string;
  request: LLMRequest;
  response: LLMResponse;
  timestamp: Date;
  hits: number;
  size: number;
}

// ===== RATE LIMITING =====

export interface RateLimiter {
  checkLimit(provider: LLMProvider, model?: LLMModel): Promise<boolean>;
  consumeToken(provider: LLMProvider, tokens: number): Promise<void>;
  getRemainingTokens(provider: LLMProvider): Promise<number>;
  getResetTime(provider: LLMProvider): Promise<Date | null>;
  waitForCapacity(provider: LLMProvider, tokens: number): Promise<void>;
}

// ===== LOAD BALANCING =====

export interface LoadBalancer {
  selectProvider(request: LLMRequest, availableProviders: ILLMProvider[]): Promise<ILLMProvider>;
  updateProviderMetrics(provider: LLMProvider, metrics: ProviderMetrics): void;
  rebalance(): Promise<void>;
}

export interface ProviderMetrics {
  provider: LLMProvider;
  timestamp: Date;
  latency: number;
  errorRate: number;
  successRate: number;
  load: number;
  cost: number;
  availability: number;
}

// ===== MONITORING AND ANALYTICS =====

export interface ProviderMonitor {
  trackRequest(provider: LLMProvider, request: LLMRequest, response: LLMResponse | Error): void;
  getMetrics(provider?: LLMProvider, period?: UsagePeriod): Promise<ProviderMetrics[]>;
  getAlerts(): Alert[];
  setAlertThreshold(metric: string, threshold: number): void;
}

export interface Alert {
  id: string;
  timestamp: Date;
  provider: LLMProvider;
  type: 'error_rate' | 'latency' | 'cost' | 'rate_limit' | 'availability';
  severity: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  value: number;
  threshold: number;
}

// ===== COST OPTIMIZATION =====

export interface CostOptimizer {
  selectOptimalModel(request: LLMRequest, constraints: CostConstraints): Promise<OptimizationResult>;
  analyzeCostTrends(period: UsagePeriod): Promise<CostAnalysis>;
  suggestOptimizations(): Promise<OptimizationSuggestion[]>;
}

export interface CostConstraints {
  maxCostPerRequest?: number;
  maxCostPerToken?: number;
  preferredProviders?: LLMProvider[];
  requiredFeatures?: string[];
  minQuality?: number; // 0-1
}

export interface OptimizationResult {
  provider: LLMProvider;
  model: LLMModel;
  estimatedCost: number;
  estimatedQuality: number; // 0-1
  reasoning: string;
}

export interface CostAnalysis {
  period: UsagePeriod;
  totalCost: number;
  costByProvider: Record<LLMProvider, number>;
  costByModel: Record<LLMModel, number>;
  trends: {
    dailyAverage: number;
    weeklyGrowth: number;
    projection30Days: number;
  };
}

export interface OptimizationSuggestion {
  type: 'model_switch' | 'provider_switch' | 'parameter_tuning' | 'caching' | 'batching';
  description: string;
  estimatedSavings: number;
  implementation: string;
  impact: 'low' | 'medium' | 'high';
}

// ===== TYPE GUARDS =====

export function isLLMResponse(obj: any): obj is LLMResponse {
  return obj && typeof obj.id === 'string' && typeof obj.content === 'string';
}

export function isLLMStreamEvent(obj: any): obj is LLMStreamEvent {
  return obj && typeof obj.type === 'string';
}

export function isLLMProviderError(error: any): error is LLMProviderError {
  return error instanceof LLMProviderError;
}

export function isRateLimitError(error: any): error is RateLimitError {
  return error instanceof RateLimitError;
}