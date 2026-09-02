/**
 * V3 LLM Provider Types
 *
 * Unified type system for all LLM providers with enhanced
 * cost tracking, model capabilities, and error handling.
 *
 * @module @claude-flow/providers/types
 */

import { EventEmitter } from 'events';

// ===== PROVIDER TYPES =====

export type LLMProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'cohere'
  | 'ollama'
  | 'ruvector'
  | 'openrouter'
  | 'litellm'
  | 'custom';

export type LLMModel =
  // Anthropic Models (2024-2025)
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-sonnet-latest'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307'
  // OpenAI Models (2024-2025)
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-4'
  | 'gpt-3.5-turbo'
  | 'o1-preview'
  | 'o1-mini'
  | 'o3-mini'
  // Google Models
  | 'gemini-2.0-flash'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash'
  | 'gemini-pro'
  // Cohere Models
  | 'command-r-plus'
  | 'command-r'
  | 'command-light'
  | 'command'
  // Ollama (Local) Models
  | 'llama3.2'
  | 'llama3.1'
  | 'mistral'
  | 'mixtral'
  | 'codellama'
  | 'phi-4'
  | 'deepseek-coder'
  // Generic
  | 'custom-model'
  | string;

// ===== MESSAGE TYPES =====

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | LLMContentPart[];
  name?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMContentPart {
  type: 'text' | 'image' | 'audio';
  text?: string;
  imageUrl?: string;
  imageBase64?: string;
  audioUrl?: string;
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

// ===== REQUEST/RESPONSE =====

export interface LLMProviderConfig {
  provider: LLMProvider;
  apiKey?: string;
  apiUrl?: string;
  model: LLMModel;

  // Generation parameters
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];

  // Provider-specific options
  providerOptions?: Record<string, unknown>;

  // Performance settings
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;

  // Features
  enableStreaming?: boolean;
  enableCaching?: boolean;
  cacheTimeout?: number;

  // Cost optimization
  enableCostOptimization?: boolean;
  maxCostPerRequest?: number;
  fallbackModels?: LLMModel[];
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

  // Tool calling
  tools?: LLMTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };

  // Provider-specific options
  providerOptions?: Record<string, unknown>;

  // Cost constraints
  costConstraints?: {
    maxCost?: number;
    preferredModels?: LLMModel[];
  };

  // Request metadata
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export interface LLMResponse {
  id: string;
  model: LLMModel;
  provider: LLMProvider;

  // Content
  content: string;
  toolCalls?: LLMToolCall[];

  // Usage
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

  // Performance
  latency?: number;

  // Metadata
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  metadata?: Record<string, unknown>;
}

export interface LLMStreamEvent {
  type: 'content' | 'tool_call' | 'error' | 'done';
  delta?: {
    content?: string;
    toolCall?: Partial<LLMToolCall>;
  };
  error?: Error;
  usage?: LLMResponse['usage'];
  cost?: LLMResponse['cost'];
}

// ===== PROVIDER CAPABILITIES =====

export interface ProviderCapabilities {
  supportedModels: LLMModel[];
  maxContextLength: Record<string, number>;
  maxOutputTokens: Record<string, number>;

  // Feature support
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  supportsSystemMessages: boolean;
  supportsVision: boolean;
  supportsAudio: boolean;

  // Advanced features
  supportsFineTuning: boolean;
  supportsEmbeddings: boolean;
  supportsBatching: boolean;

  // Rate limits
  rateLimit?: {
    requestsPerMinute: number;
    tokensPerMinute: number;
    concurrentRequests: number;
  };

  // Pricing (per 1K tokens)
  pricing: Record<string, {
    promptCostPer1k: number;
    completionCostPer1k: number;
    currency: string;
  }>;
}

// ===== ERROR TYPES =====

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider: LLMProvider,
    public statusCode?: number,
    public retryable: boolean = true,
    public details?: unknown
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
    details?: unknown
  ) {
    super(message, 'RATE_LIMIT', provider, 429, true, details);
    this.name = 'RateLimitError';
  }
}

export class AuthenticationError extends LLMProviderError {
  constructor(message: string, provider: LLMProvider, details?: unknown) {
    super(message, 'AUTHENTICATION', provider, 401, false, details);
    this.name = 'AuthenticationError';
  }
}

export class ModelNotFoundError extends LLMProviderError {
  constructor(model: string, provider: LLMProvider, details?: unknown) {
    super(`Model ${model} not found`, 'MODEL_NOT_FOUND', provider, 404, false, details);
    this.name = 'ModelNotFoundError';
  }
}

export class ProviderUnavailableError extends LLMProviderError {
  constructor(provider: LLMProvider, details?: unknown) {
    super(`Provider ${provider} is unavailable`, 'PROVIDER_UNAVAILABLE', provider, 503, true, details);
    this.name = 'ProviderUnavailableError';
  }
}

// ===== PROVIDER INTERFACE =====

export interface ILLMProvider extends EventEmitter {
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
  recommendedReplacement?: LLMModel;
}

export interface HealthCheckResult {
  healthy: boolean;
  latency?: number;
  error?: string;
  timestamp: Date;
  details?: Record<string, unknown>;
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
  confidence: number;
}

export interface UsageStats {
  period: { start: Date; end: Date };
  requests: number;
  tokens: { prompt: number; completion: number; total: number };
  cost: { prompt: number; completion: number; total: number; currency: string };
  errors: number;
  averageLatency: number;
  modelBreakdown: Record<string, { requests: number; tokens: number; cost: number }>;
}

export type UsagePeriod = 'hour' | 'day' | 'week' | 'month' | 'all';

// ===== MANAGER TYPES =====

export type LoadBalancingStrategy = 'round-robin' | 'least-loaded' | 'latency-based' | 'cost-based';

export interface ProviderManagerConfig {
  providers: LLMProviderConfig[];
  defaultProvider?: LLMProvider;
  loadBalancing?: {
    enabled: boolean;
    strategy: LoadBalancingStrategy;
  };
  fallback?: {
    enabled: boolean;
    maxAttempts: number;
  };
  cache?: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  costOptimization?: {
    enabled: boolean;
    maxCostPerRequest?: number;
  };
}

// ===== TYPE GUARDS =====

export function isLLMResponse(obj: unknown): obj is LLMResponse {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'content' in obj &&
    'provider' in obj
  );
}

export function isLLMStreamEvent(obj: unknown): obj is LLMStreamEvent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'type' in obj &&
    ['content', 'tool_call', 'error', 'done'].includes((obj as LLMStreamEvent).type)
  );
}

export function isLLMProviderError(error: unknown): error is LLMProviderError {
  return error instanceof LLMProviderError;
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}
