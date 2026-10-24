/**
 * LLM Provider Integration Module
 *
 * Provides unified interface for LLM providers in the plugin system.
 * Enables multi-provider support, fallback chains, and cost optimization.
 */

import { EventEmitter } from 'events';
import type {
  LLMProviderDefinition,
  LLMCapability,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  RateLimitConfig,
  CostConfig,
  ILogger,
  IEventBus,
} from '../types/index.js';

// ============================================================================
// Provider Events
// ============================================================================

export const PROVIDER_EVENTS = {
  REGISTERED: 'provider:registered',
  UNREGISTERED: 'provider:unregistered',
  REQUEST_START: 'provider:request-start',
  REQUEST_COMPLETE: 'provider:request-complete',
  REQUEST_ERROR: 'provider:request-error',
  RATE_LIMITED: 'provider:rate-limited',
  FALLBACK: 'provider:fallback',
} as const;

export type ProviderEvent = typeof PROVIDER_EVENTS[keyof typeof PROVIDER_EVENTS];

// ============================================================================
// Provider Interface
// ============================================================================

export interface ILLMProvider {
  readonly definition: LLMProviderDefinition;

  complete(request: LLMRequest): Promise<LLMResponse>;
  stream?(request: LLMRequest): AsyncIterable<Partial<LLMResponse>>;
  embed?(texts: string[]): Promise<number[][]>;

  healthCheck(): Promise<{ healthy: boolean; latencyMs: number }>;
  getRateLimitStatus(): RateLimitStatus;
  getCostEstimate(request: LLMRequest): number;
}

export interface RateLimitStatus {
  requestsRemaining: number;
  tokensRemaining: number;
  resetAt: Date;
  isLimited: boolean;
}

// ============================================================================
// Provider Registry
// ============================================================================

export interface ProviderRegistryConfig {
  logger?: ILogger;
  eventBus?: IEventBus;
  defaultProvider?: string;
  fallbackChain?: string[];
  costOptimization?: boolean;
  retryConfig?: RetryConfig;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface ProviderEntry {
  readonly provider: ILLMProvider;
  readonly registeredAt: Date;
  requestCount: number;
  errorCount: number;
  totalTokensUsed: number;
  totalCost: number;
  lastUsed?: Date;
}

export interface ProviderRegistryStats {
  totalProviders: number;
  totalRequests: number;
  totalErrors: number;
  totalTokensUsed: number;
  totalCost: number;
  providerStats: Record<string, {
    requests: number;
    errors: number;
    tokensUsed: number;
    cost: number;
    avgLatency: number;
  }>;
}

/**
 * Central registry for LLM provider management.
 */
export class ProviderRegistry extends EventEmitter {
  private readonly providers = new Map<string, ProviderEntry>();
  private readonly config: ProviderRegistryConfig;
  private readonly latencyTracking = new Map<string, number[]>();

  constructor(config?: ProviderRegistryConfig) {
    super();
    this.config = {
      costOptimization: false,
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
      },
      ...config,
    };
  }

  /**
   * Register a provider.
   */
  register(provider: ILLMProvider): void {
    const name = provider.definition.name;

    if (this.providers.has(name)) {
      throw new Error(`Provider ${name} already registered`);
    }

    const entry: ProviderEntry = {
      provider,
      registeredAt: new Date(),
      requestCount: 0,
      errorCount: 0,
      totalTokensUsed: 0,
      totalCost: 0,
    };

    this.providers.set(name, entry);
    this.latencyTracking.set(name, []);
    this.emit(PROVIDER_EVENTS.REGISTERED, { provider: name });
  }

  /**
   * Unregister a provider.
   */
  unregister(name: string): boolean {
    const removed = this.providers.delete(name);
    if (removed) {
      this.latencyTracking.delete(name);
      this.emit(PROVIDER_EVENTS.UNREGISTERED, { provider: name });
    }
    return removed;
  }

  /**
   * Get a provider by name.
   */
  get(name: string): ILLMProvider | undefined {
    return this.providers.get(name)?.provider;
  }

  /**
   * Get the best available provider based on criteria.
   */
  getBest(options?: {
    capabilities?: LLMCapability[];
    model?: string;
    preferCheaper?: boolean;
  }): ILLMProvider | undefined {
    let candidates = Array.from(this.providers.values());

    // Filter by capabilities
    if (options?.capabilities) {
      candidates = candidates.filter(e =>
        options.capabilities!.every(cap =>
          e.provider.definition.capabilities.includes(cap)
        )
      );
    }

    // Filter by model support
    if (options?.model) {
      candidates = candidates.filter(e =>
        e.provider.definition.models.includes(options.model!)
      );
    }

    // Filter by rate limit availability
    candidates = candidates.filter(e => !e.provider.getRateLimitStatus().isLimited);

    if (candidates.length === 0) {
      return undefined;
    }

    // Sort by preference
    if (options?.preferCheaper || this.config.costOptimization) {
      candidates.sort((a, b) => {
        const costA = a.provider.definition.costPerToken?.input ?? 0;
        const costB = b.provider.definition.costPerToken?.input ?? 0;
        return costA - costB;
      });
    } else {
      // Sort by success rate
      candidates.sort((a, b) => {
        const rateA = a.requestCount > 0 ? (a.requestCount - a.errorCount) / a.requestCount : 1;
        const rateB = b.requestCount > 0 ? (b.requestCount - b.errorCount) / b.requestCount : 1;
        return rateB - rateA;
      });
    }

    return candidates[0]?.provider;
  }

  /**
   * Execute a request with automatic provider selection and fallback.
   */
  async execute(request: LLMRequest): Promise<LLMResponse> {
    const provider = this.getBest({ model: request.model });

    if (!provider) {
      throw new Error(`No available provider for model ${request.model}`);
    }

    return this.executeWithProvider(provider.definition.name, request);
  }

  /**
   * Execute a request on a specific provider with retry.
   */
  async executeWithProvider(providerName: string, request: LLMRequest): Promise<LLMResponse> {
    const entry = this.providers.get(providerName);
    if (!entry) {
      throw new Error(`Provider ${providerName} not found`);
    }

    const retryConfig = this.config.retryConfig!;
    let lastError: Error | null = null;
    let delay = retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      if (attempt > 0) {
        await this.delay(delay);
        delay = Math.min(delay * retryConfig.backoffMultiplier, retryConfig.maxDelayMs);
      }

      try {
        this.emit(PROVIDER_EVENTS.REQUEST_START, {
          provider: providerName,
          model: request.model,
          attempt,
        });

        const startTime = Date.now();
        const response = await entry.provider.complete(request);
        const latency = Date.now() - startTime;

        // Update metrics
        entry.requestCount++;
        entry.lastUsed = new Date();
        entry.totalTokensUsed += response.usage.totalTokens;
        entry.totalCost += entry.provider.getCostEstimate(request);

        // Track latency
        const latencies = this.latencyTracking.get(providerName)!;
        latencies.push(latency);
        if (latencies.length > 100) latencies.shift();

        this.emit(PROVIDER_EVENTS.REQUEST_COMPLETE, {
          provider: providerName,
          model: request.model,
          latencyMs: latency,
          tokensUsed: response.usage.totalTokens,
        });

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        entry.errorCount++;

        this.emit(PROVIDER_EVENTS.REQUEST_ERROR, {
          provider: providerName,
          model: request.model,
          error: lastError.message,
          attempt,
        });

        // Check if we should try fallback
        if (attempt === retryConfig.maxRetries && this.config.fallbackChain) {
          const fallbackResult = await this.tryFallback(request, providerName);
          if (fallbackResult) {
            return fallbackResult;
          }
        }
      }
    }

    throw lastError ?? new Error('Unknown error during provider execution');
  }

  private async tryFallback(
    request: LLMRequest,
    failedProvider: string
  ): Promise<LLMResponse | null> {
    const fallbackChain = this.config.fallbackChain ?? [];

    for (const fallbackName of fallbackChain) {
      if (fallbackName === failedProvider) continue;

      const fallbackEntry = this.providers.get(fallbackName);
      if (!fallbackEntry) continue;

      // Check if fallback supports the model
      if (!fallbackEntry.provider.definition.models.includes(request.model)) {
        continue;
      }

      // Check rate limit
      if (fallbackEntry.provider.getRateLimitStatus().isLimited) {
        continue;
      }

      try {
        this.emit(PROVIDER_EVENTS.FALLBACK, {
          from: failedProvider,
          to: fallbackName,
        });

        return await this.executeWithProvider(fallbackName, request);
      } catch {
        // Try next fallback
        continue;
      }
    }

    return null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * List all registered providers.
   */
  list(): LLMProviderDefinition[] {
    return Array.from(this.providers.values()).map(e => e.provider.definition);
  }

  /**
   * Get provider statistics.
   */
  getStats(): ProviderRegistryStats {
    let totalRequests = 0;
    let totalErrors = 0;
    let totalTokensUsed = 0;
    let totalCost = 0;
    const providerStats: ProviderRegistryStats['providerStats'] = {};

    for (const [name, entry] of this.providers) {
      totalRequests += entry.requestCount;
      totalErrors += entry.errorCount;
      totalTokensUsed += entry.totalTokensUsed;
      totalCost += entry.totalCost;

      const latencies = this.latencyTracking.get(name) ?? [];
      const avgLatency = latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;

      providerStats[name] = {
        requests: entry.requestCount,
        errors: entry.errorCount,
        tokensUsed: entry.totalTokensUsed,
        cost: entry.totalCost,
        avgLatency,
      };
    }

    return {
      totalProviders: this.providers.size,
      totalRequests,
      totalErrors,
      totalTokensUsed,
      totalCost,
      providerStats,
    };
  }

  /**
   * Health check all providers.
   */
  async healthCheck(): Promise<Map<string, { healthy: boolean; latencyMs: number }>> {
    const results = new Map<string, { healthy: boolean; latencyMs: number }>();

    for (const [name, entry] of this.providers) {
      try {
        results.set(name, await entry.provider.healthCheck());
      } catch {
        results.set(name, { healthy: false, latencyMs: -1 });
      }
    }

    return results;
  }
}

// ============================================================================
// Base Provider Implementation
// ============================================================================

/**
 * Abstract base class for LLM providers.
 */
export abstract class BaseLLMProvider implements ILLMProvider {
  readonly definition: LLMProviderDefinition;
  protected rateLimitState: {
    requestsInWindow: number;
    tokensInWindow: number;
    windowStart: Date;
  };

  constructor(definition: LLMProviderDefinition) {
    this.definition = definition;
    this.rateLimitState = {
      requestsInWindow: 0,
      tokensInWindow: 0,
      windowStart: new Date(),
    };
  }

  abstract complete(request: LLMRequest): Promise<LLMResponse>;

  stream?(request: LLMRequest): AsyncIterable<Partial<LLMResponse>>;
  embed?(texts: string[]): Promise<number[][]>;

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      // Simple ping test
      await this.complete({
        model: this.definition.models[0],
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 5,
      });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  getRateLimitStatus(): RateLimitStatus {
    const config = this.definition.rateLimit;
    if (!config) {
      return {
        requestsRemaining: Infinity,
        tokensRemaining: Infinity,
        resetAt: new Date(Date.now() + 60000),
        isLimited: false,
      };
    }

    // Check if window has reset
    const windowMs = 60000; // 1 minute window
    const now = new Date();
    if (now.getTime() - this.rateLimitState.windowStart.getTime() > windowMs) {
      this.rateLimitState = {
        requestsInWindow: 0,
        tokensInWindow: 0,
        windowStart: now,
      };
    }

    const requestsRemaining = config.requestsPerMinute - this.rateLimitState.requestsInWindow;
    const tokensRemaining = config.tokensPerMinute - this.rateLimitState.tokensInWindow;
    const resetAt = new Date(this.rateLimitState.windowStart.getTime() + windowMs);

    return {
      requestsRemaining,
      tokensRemaining,
      resetAt,
      isLimited: requestsRemaining <= 0 || tokensRemaining <= 0,
    };
  }

  getCostEstimate(request: LLMRequest): number {
    const costConfig = this.definition.costPerToken;
    if (!costConfig) return 0;

    // Rough token estimate: ~4 chars per token
    const inputTokens = request.messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0
    );
    const outputTokens = request.maxTokens ?? 1000;

    return (inputTokens * costConfig.input) + (outputTokens * costConfig.output);
  }

  protected updateRateLimits(tokensUsed: number): void {
    this.rateLimitState.requestsInWindow++;
    this.rateLimitState.tokensInWindow += tokensUsed;
  }
}

// ============================================================================
// Provider Factory
// ============================================================================

/**
 * Factory for creating provider definitions.
 */
export class ProviderFactory {
  /**
   * Create an Anthropic Claude provider definition.
   */
  static createClaude(options?: {
    displayName?: string;
    models?: string[];
    rateLimit?: RateLimitConfig;
    costPerToken?: CostConfig;
  }): LLMProviderDefinition {
    return {
      name: 'anthropic',
      displayName: options?.displayName ?? 'Anthropic Claude',
      models: options?.models ?? [
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-20250514',
        'claude-3-5-haiku-20241022',
      ],
      capabilities: [
        'completion',
        'chat',
        'streaming',
        'function-calling',
        'vision',
        'code-generation',
      ],
      rateLimit: options?.rateLimit ?? {
        requestsPerMinute: 50,
        tokensPerMinute: 100000,
      },
      costPerToken: options?.costPerToken ?? {
        input: 0.000003,
        output: 0.000015,
        currency: 'USD',
      },
    };
  }

  /**
   * Create an OpenAI provider definition.
   */
  static createOpenAI(options?: {
    displayName?: string;
    models?: string[];
    rateLimit?: RateLimitConfig;
    costPerToken?: CostConfig;
  }): LLMProviderDefinition {
    return {
      name: 'openai',
      displayName: options?.displayName ?? 'OpenAI',
      models: options?.models ?? [
        'gpt-4o',
        'gpt-4o-mini',
        'gpt-4-turbo',
        'gpt-3.5-turbo',
      ],
      capabilities: [
        'completion',
        'chat',
        'streaming',
        'function-calling',
        'vision',
        'embeddings',
        'code-generation',
      ],
      rateLimit: options?.rateLimit ?? {
        requestsPerMinute: 60,
        tokensPerMinute: 150000,
      },
      costPerToken: options?.costPerToken ?? {
        input: 0.00001,
        output: 0.00003,
        currency: 'USD',
      },
    };
  }

  /**
   * Create a local/self-hosted provider definition.
   */
  static createLocal(options: {
    name: string;
    displayName: string;
    models: string[];
    capabilities: LLMCapability[];
    endpoint?: string;
  }): LLMProviderDefinition {
    return {
      name: options.name,
      displayName: options.displayName,
      models: options.models,
      capabilities: options.capabilities,
      // No rate limits for local
      rateLimit: undefined,
      // No cost for local
      costPerToken: undefined,
    };
  }

  /**
   * Create a custom provider definition.
   */
  static createCustom(definition: LLMProviderDefinition): LLMProviderDefinition {
    return { ...definition };
  }
}

// ============================================================================
// Exports
// ============================================================================

export type {
  LLMProviderDefinition,
  LLMCapability,
  LLMRequest,
  LLMResponse,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  RateLimitConfig,
  CostConfig,
};
