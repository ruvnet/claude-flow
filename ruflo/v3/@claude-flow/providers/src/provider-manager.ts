/**
 * V3 Provider Manager
 *
 * Orchestrates multiple LLM providers with:
 * - Load balancing (round-robin, latency-based, cost-based)
 * - Automatic failover
 * - Request caching
 * - Cost optimization
 *
 * @module @claude-flow/providers/provider-manager
 */

import { EventEmitter } from 'events';
import {
  ILLMProvider,
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  LLMModel,
  ProviderManagerConfig,
  LoadBalancingStrategy,
  HealthCheckResult,
  CostEstimate,
  UsageStats,
  UsagePeriod,
  LLMProviderError,
  isLLMProviderError,
} from './types.js';
import { BaseProviderOptions, ILogger, consoleLogger } from './base-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { GoogleProvider } from './google-provider.js';
import { CohereProvider } from './cohere-provider.js';
import { OllamaProvider } from './ollama-provider.js';
import { RuVectorProvider } from './ruvector-provider.js';

/**
 * Cache entry for request caching
 */
interface CacheEntry {
  response: LLMResponse;
  timestamp: number;
  hits: number;
}

/**
 * Provider metrics for load balancing
 */
interface ProviderMetrics {
  latency: number;
  errorRate: number;
  cost: number;
  lastUsed: number;
}

/**
 * Provider Manager - Orchestrates multiple LLM providers
 */
export class ProviderManager extends EventEmitter {
  private providers: Map<LLMProvider, ILLMProvider> = new Map();
  private cache: Map<string, CacheEntry> = new Map();
  private metrics: Map<LLMProvider, ProviderMetrics> = new Map();
  private roundRobinIndex = 0;
  private logger: ILogger;

  constructor(
    private config: ProviderManagerConfig,
    logger?: ILogger
  ) {
    super();
    this.logger = logger || consoleLogger;
  }

  /**
   * Initialize all configured providers
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing provider manager', {
      providerCount: this.config.providers.length,
    });

    const initPromises = this.config.providers.map(async (providerConfig) => {
      try {
        const provider = this.createProvider(providerConfig);
        await provider.initialize();
        this.providers.set(providerConfig.provider, provider);
        this.metrics.set(providerConfig.provider, {
          latency: 0,
          errorRate: 0,
          cost: 0,
          lastUsed: 0,
        });
        this.logger.info(`Provider ${providerConfig.provider} initialized`);
      } catch (error) {
        this.logger.error(`Failed to initialize ${providerConfig.provider}`, error);
      }
    });

    await Promise.all(initPromises);

    this.logger.info('Provider manager initialized', {
      activeProviders: Array.from(this.providers.keys()),
    });
  }

  /**
   * Create a provider instance
   */
  private createProvider(config: LLMProviderConfig): ILLMProvider {
    const options: BaseProviderOptions = {
      config,
      logger: this.logger,
    };

    switch (config.provider) {
      case 'anthropic':
        return new AnthropicProvider(options);
      case 'openai':
        return new OpenAIProvider(options);
      case 'google':
        return new GoogleProvider(options);
      case 'cohere':
        return new CohereProvider(options);
      case 'ollama':
        return new OllamaProvider(options);
      case 'ruvector':
        return new RuVectorProvider(options);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  /**
   * Complete a request with automatic provider selection
   */
  async complete(request: LLMRequest, preferredProvider?: LLMProvider): Promise<LLMResponse> {
    // Check cache first
    if (this.config.cache?.enabled) {
      const cached = this.getCached(request);
      if (cached) {
        this.logger.debug('Cache hit', { requestId: request.requestId });
        return cached;
      }
    }

    // Select provider
    const provider = preferredProvider
      ? this.providers.get(preferredProvider)
      : await this.selectProvider(request);

    if (!provider) {
      throw new Error('No available providers');
    }

    const startTime = Date.now();

    try {
      const response = await provider.complete(request);
      this.updateMetrics(provider.name, Date.now() - startTime, false, response.cost?.totalCost || 0);

      // Cache response
      if (this.config.cache?.enabled) {
        this.setCached(request, response);
      }

      this.emit('complete', { provider: provider.name, response });
      return response;
    } catch (error) {
      this.updateMetrics(provider.name, Date.now() - startTime, true, 0);

      // Try fallback
      if (this.config.fallback?.enabled && isLLMProviderError(error)) {
        return this.completWithFallback(request, provider.name, error);
      }

      throw error;
    }
  }

  /**
   * Stream complete with automatic provider selection
   */
  async *streamComplete(
    request: LLMRequest,
    preferredProvider?: LLMProvider
  ): AsyncIterable<LLMStreamEvent> {
    const provider = preferredProvider
      ? this.providers.get(preferredProvider)
      : await this.selectProvider(request);

    if (!provider) {
      throw new Error('No available providers');
    }

    const startTime = Date.now();

    try {
      for await (const event of provider.streamComplete(request)) {
        yield event;
      }

      this.updateMetrics(provider.name, Date.now() - startTime, false, 0);
    } catch (error) {
      this.updateMetrics(provider.name, Date.now() - startTime, true, 0);
      throw error;
    }
  }

  /**
   * Select provider based on load balancing strategy
   */
  private async selectProvider(request: LLMRequest): Promise<ILLMProvider | undefined> {
    const availableProviders = Array.from(this.providers.values()).filter(
      (p) => p.getStatus().available
    );

    if (availableProviders.length === 0) {
      // Try to use any provider
      return this.providers.values().next().value;
    }

    const strategy = this.config.loadBalancing?.strategy || 'round-robin';

    switch (strategy) {
      case 'round-robin':
        return this.selectRoundRobin(availableProviders);
      case 'least-loaded':
        return this.selectLeastLoaded(availableProviders);
      case 'latency-based':
        return this.selectByLatency(availableProviders);
      case 'cost-based':
        return this.selectByCost(availableProviders, request);
      default:
        return availableProviders[0];
    }
  }

  private selectRoundRobin(providers: ILLMProvider[]): ILLMProvider {
    const provider = providers[this.roundRobinIndex % providers.length];
    this.roundRobinIndex++;
    return provider;
  }

  private selectLeastLoaded(providers: ILLMProvider[]): ILLMProvider {
    return providers.reduce((best, current) =>
      current.getStatus().currentLoad < best.getStatus().currentLoad ? current : best
    );
  }

  private selectByLatency(providers: ILLMProvider[]): ILLMProvider {
    return providers.reduce((best, current) => {
      const bestMetrics = this.metrics.get(best.name);
      const currentMetrics = this.metrics.get(current.name);
      return (currentMetrics?.latency || Infinity) < (bestMetrics?.latency || Infinity)
        ? current
        : best;
    });
  }

  private async selectByCost(
    providers: ILLMProvider[],
    request: LLMRequest
  ): Promise<ILLMProvider> {
    const estimates = await Promise.all(
      providers.map(async (p) => ({
        provider: p,
        cost: (await p.estimateCost(request)).estimatedCost.total,
      }))
    );

    return estimates.reduce((best, current) =>
      current.cost < best.cost ? current : best
    ).provider;
  }

  /**
   * Complete with fallback on failure
   */
  private async completWithFallback(
    request: LLMRequest,
    failedProvider: LLMProvider,
    originalError: LLMProviderError
  ): Promise<LLMResponse> {
    const maxAttempts = this.config.fallback?.maxAttempts || 2;
    let attempts = 0;
    let lastError = originalError;

    const remainingProviders = Array.from(this.providers.values()).filter(
      (p) => p.name !== failedProvider
    );

    for (const provider of remainingProviders) {
      if (attempts >= maxAttempts) break;
      attempts++;

      this.logger.info(`Attempting fallback to ${provider.name}`, {
        attempt: attempts,
        originalProvider: failedProvider,
      });

      try {
        const response = await provider.complete(request);
        this.emit('fallback_success', {
          originalProvider: failedProvider,
          fallbackProvider: provider.name,
          attempts,
        });
        return response;
      } catch (error) {
        if (isLLMProviderError(error)) {
          lastError = error;
        }
      }
    }

    this.emit('fallback_exhausted', {
      originalProvider: failedProvider,
      attempts,
    });

    throw lastError;
  }

  /**
   * Update provider metrics
   */
  private updateMetrics(
    provider: LLMProvider,
    latency: number,
    error: boolean,
    cost: number
  ): void {
    const current = this.metrics.get(provider) || {
      latency: 0,
      errorRate: 0,
      cost: 0,
      lastUsed: 0,
    };

    // Exponential moving average for latency
    const alpha = 0.3;
    const newLatency = current.latency === 0 ? latency : alpha * latency + (1 - alpha) * current.latency;

    // Update error rate
    const errorWeight = error ? 1 : 0;
    const newErrorRate = alpha * errorWeight + (1 - alpha) * current.errorRate;

    this.metrics.set(provider, {
      latency: newLatency,
      errorRate: newErrorRate,
      cost: current.cost + cost,
      lastUsed: Date.now(),
    });
  }

  /**
   * Get cached response
   */
  private getCached(request: LLMRequest): LLMResponse | undefined {
    const key = this.getCacheKey(request);
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    const ttl = this.config.cache?.ttl || 300000;
    if (Date.now() - entry.timestamp > ttl) {
      this.cache.delete(key);
      return undefined;
    }

    entry.hits++;
    return entry.response;
  }

  /**
   * Set cached response
   */
  private setCached(request: LLMRequest, response: LLMResponse): void {
    const key = this.getCacheKey(request);

    // Enforce max size
    const maxSize = this.config.cache?.maxSize || 1000;
    if (this.cache.size >= maxSize) {
      // Remove oldest entry
      const oldest = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp
      )[0];
      if (oldest) this.cache.delete(oldest[0]);
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      hits: 0,
    });
  }

  /**
   * Generate cache key
   */
  private getCacheKey(request: LLMRequest): string {
    return JSON.stringify({
      messages: request.messages,
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
  }

  /**
   * Get a specific provider
   */
  getProvider(name: LLMProvider): ILLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * List all available providers
   */
  listProviders(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Health check all providers
   */
  async healthCheck(): Promise<Map<LLMProvider, HealthCheckResult>> {
    const results = new Map<LLMProvider, HealthCheckResult>();

    await Promise.all(
      Array.from(this.providers.entries()).map(async ([name, provider]) => {
        const result = await provider.healthCheck();
        results.set(name, result);
      })
    );

    return results;
  }

  /**
   * Estimate cost across providers
   */
  async estimateCost(request: LLMRequest): Promise<Map<LLMProvider, CostEstimate>> {
    const estimates = new Map<LLMProvider, CostEstimate>();

    await Promise.all(
      Array.from(this.providers.entries()).map(async ([name, provider]) => {
        const estimate = await provider.estimateCost(request);
        estimates.set(name, estimate);
      })
    );

    return estimates;
  }

  /**
   * Get aggregated usage statistics
   */
  async getUsage(period: UsagePeriod = 'day'): Promise<UsageStats> {
    let totalRequests = 0;
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    let totalCost = { prompt: 0, completion: 0, total: 0 };
    let totalErrors = 0;
    let totalLatency = 0;
    let count = 0;

    for (const provider of this.providers.values()) {
      const usage = await provider.getUsage(period);
      totalRequests += usage.requests;
      totalTokens.prompt += usage.tokens.prompt;
      totalTokens.completion += usage.tokens.completion;
      totalTokens.total += usage.tokens.total;
      totalCost.prompt += usage.cost.prompt;
      totalCost.completion += usage.cost.completion;
      totalCost.total += usage.cost.total;
      totalErrors += usage.errors;
      totalLatency += usage.averageLatency;
      count++;
    }

    const now = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 1);

    return {
      period: { start, end: now },
      requests: totalRequests,
      tokens: totalTokens,
      cost: { ...totalCost, currency: 'USD' },
      errors: totalErrors,
      averageLatency: count > 0 ? totalLatency / count : 0,
      modelBreakdown: {},
    };
  }

  /**
   * Get provider metrics
   */
  getMetrics(): Map<LLMProvider, ProviderMetrics> {
    return new Map(this.metrics);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.info('Cache cleared');
  }

  /**
   * Destroy all providers
   */
  destroy(): void {
    for (const provider of this.providers.values()) {
      provider.destroy();
    }
    this.providers.clear();
    this.cache.clear();
    this.metrics.clear();
    this.removeAllListeners();
    this.logger.info('Provider manager destroyed');
  }
}

/**
 * Create and initialize a provider manager
 */
export async function createProviderManager(
  config: ProviderManagerConfig,
  logger?: ILogger
): Promise<ProviderManager> {
  const manager = new ProviderManager(config, logger);
  await manager.initialize();
  return manager;
}
