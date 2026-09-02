/**
 * Provider Manager - Central orchestration for multi-LLM providers
 * Handles provider selection, fallback, load balancing, and cost optimization
 */

import { EventEmitter } from 'events';
import { ILogger } from '../core/logger.js';
import { ConfigManager } from '../config/config-manager.js';
import {
  ILLMProvider,
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  LLMModel,
  FallbackStrategy,
  FallbackRule,
  LoadBalancer,
  ProviderMetrics,
  CostOptimizer,
  CostConstraints,
  OptimizationResult,
  RateLimiter,
  ProviderMonitor,
  CacheConfig,
  LLMProviderError,
  RateLimitError,
  isRateLimitError,
} from './types.js';

// Import providers
import { AnthropicProvider } from './anthropic-provider.js';
import { OpenAIProvider } from './openai-provider.js';
import { GoogleProvider } from './google-provider.js';
import { CohereProvider } from './cohere-provider.js';
import { OllamaProvider } from './ollama-provider.js';

export interface ProviderManagerConfig {
  providers: Record<LLMProvider, LLMProviderConfig>;
  defaultProvider: LLMProvider;
  fallbackStrategy?: FallbackStrategy;
  loadBalancing?: {
    enabled: boolean;
    strategy: 'round-robin' | 'least-loaded' | 'latency-based' | 'cost-based';
  };
  costOptimization?: {
    enabled: boolean;
    maxCostPerRequest?: number;
    preferredProviders?: LLMProvider[];
  };
  caching?: CacheConfig;
  monitoring?: {
    enabled: boolean;
    metricsInterval: number;
  };
}

export class ProviderManager extends EventEmitter {
  private providers: Map<LLMProvider, ILLMProvider> = new Map();
  private logger: ILogger;
  private config: ProviderManagerConfig;
  private requestCount: Map<LLMProvider, number> = new Map();
  private lastUsed: Map<LLMProvider, Date> = new Map();
  private providerMetrics: Map<LLMProvider, ProviderMetrics[]> = new Map();
  private cache: Map<string, { response: LLMResponse; timestamp: Date }> = new Map();
  private currentProviderIndex = 0;

  constructor(logger: ILogger, configManager: ConfigManager, config: ProviderManagerConfig) {
    super();
    this.logger = logger;
    this.config = config;

    // Initialize providers
    this.initializeProviders();

    // Start monitoring if enabled
    if (config.monitoring?.enabled) {
      this.startMonitoring();
    }
  }

  /**
   * Initialize all configured providers
   */
  private async initializeProviders(): Promise<void> {
    for (const [providerName, providerConfig] of Object.entries(this.config.providers)) {
      try {
        const provider = await this.createProvider(providerName as LLMProvider, providerConfig);
        if (provider) {
          this.providers.set(providerName as LLMProvider, provider);
          this.requestCount.set(providerName as LLMProvider, 0);
          this.logger.info(`Initialized ${providerName} provider`);
        }
      } catch (error) {
        this.logger.error(`Failed to initialize ${providerName} provider`, error);
      }
    }

    if (this.providers.size === 0) {
      throw new Error('No providers could be initialized');
    }
  }

  /**
   * Create a provider instance
   */
  private async createProvider(name: LLMProvider, config: LLMProviderConfig): Promise<ILLMProvider | null> {
    const providerOptions = {
      logger: this.logger,
      config,
    };

    try {
      let provider: ILLMProvider;

      switch (name) {
        case 'anthropic':
          provider = new AnthropicProvider(providerOptions);
          break;
        case 'openai':
          provider = new OpenAIProvider(providerOptions);
          break;
        case 'google':
          provider = new GoogleProvider(providerOptions);
          break;
        case 'cohere':
          provider = new CohereProvider(providerOptions);
          break;
        case 'ollama':
          provider = new OllamaProvider(providerOptions);
          break;
        default:
          this.logger.warn(`Unknown provider: ${name}`);
          return null;
      }

      await provider.initialize();
      
      // Set up event listeners
      provider.on('response', (data) => this.handleProviderResponse(name, data));
      provider.on('error', (error) => this.handleProviderError(name, error));
      provider.on('health_check', (result) => this.handleHealthCheck(name, result));

      return provider;
    } catch (error) {
      this.logger.error(`Failed to create ${name} provider`, error);
      return null;
    }
  }

  /**
   * Complete a request using the appropriate provider
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Check cache first
    if (this.config.caching?.enabled) {
      const cached = this.checkCache(request);
      if (cached) {
        this.logger.debug('Returning cached response');
        return cached;
      }
    }

    // Select provider based on strategy
    const provider = await this.selectProvider(request);
    
    try {
      const response = await provider.complete(request);
      
      // Cache successful response
      if (this.config.caching?.enabled) {
        this.cacheResponse(request, response);
      }
      
      // Update metrics
      this.updateProviderMetrics(provider.name, {
        success: true,
        latency: response.latency || 0,
        cost: response.cost?.totalCost || 0,
      });
      
      return response;
    } catch (error) {
      // Handle error and potentially fallback
      return this.handleRequestError(error, request, provider);
    }
  }

  /**
   * Stream complete a request
   */
  async *streamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const provider = await this.selectProvider(request);
    
    try {
      yield* provider.streamComplete(request);
      
      // Update metrics
      this.updateProviderMetrics(provider.name, {
        success: true,
        latency: 0, // Will be updated by stream events
        cost: 0, // Will be updated by stream events
      });
    } catch (error) {
      // Handle error and potentially fallback
      const fallbackProvider = await this.getFallbackProvider(error, provider);
      if (fallbackProvider) {
        this.logger.info(`Falling back to ${fallbackProvider.name} provider`);
        yield* fallbackProvider.streamComplete(request);
      } else {
        throw error;
      }
    }
  }

  /**
   * Select the best provider for a request
   */
  private async selectProvider(request: LLMRequest): Promise<ILLMProvider> {
    // If specific provider requested
    if (request.providerOptions?.preferredProvider) {
      const provider = this.providers.get(request.providerOptions.preferredProvider);
      if (provider && this.isProviderAvailable(provider)) {
        return provider;
      }
    }

    // Cost optimization
    if (this.config.costOptimization?.enabled && request.costConstraints) {
      const optimized = await this.selectOptimalProvider(request);
      if (optimized) {
        return optimized;
      }
    }

    // Load balancing
    if (this.config.loadBalancing?.enabled) {
      return this.selectLoadBalancedProvider();
    }

    // Default provider
    const defaultProvider = this.providers.get(this.config.defaultProvider);
    if (defaultProvider && this.isProviderAvailable(defaultProvider)) {
      return defaultProvider;
    }

    // First available provider
    for (const provider of this.providers.values()) {
      if (this.isProviderAvailable(provider)) {
        return provider;
      }
    }

    throw new Error('No available providers');
  }

  /**
   * Select provider based on cost optimization
   */
  private async selectOptimalProvider(request: LLMRequest): Promise<ILLMProvider | null> {
    let bestProvider: ILLMProvider | null = null;
    let bestCost = Infinity;

    for (const provider of this.providers.values()) {
      if (!this.isProviderAvailable(provider)) continue;

      try {
        const estimate = await provider.estimateCost(request);
        
        if (estimate.estimatedCost.total < bestCost &&
            (!request.costConstraints?.maxCostPerRequest || 
             estimate.estimatedCost.total <= request.costConstraints.maxCostPerRequest)) {
          bestCost = estimate.estimatedCost.total;
          bestProvider = provider;
        }
      } catch (error) {
        this.logger.warn(`Failed to estimate cost for ${provider.name}`, error);
      }
    }

    return bestProvider;
  }

  /**
   * Select provider using load balancing
   */
  private selectLoadBalancedProvider(): ILLMProvider {
    const availableProviders = Array.from(this.providers.values()).filter(p => 
      this.isProviderAvailable(p)
    );

    if (availableProviders.length === 0) {
      throw new Error('No available providers');
    }

    switch (this.config.loadBalancing?.strategy) {
      case 'round-robin':
        return this.roundRobinSelect(availableProviders);
        
      case 'least-loaded':
        return this.leastLoadedSelect(availableProviders);
        
      case 'latency-based':
        return this.latencyBasedSelect(availableProviders);
        
      case 'cost-based':
        return this.costBasedSelect(availableProviders);
        
      default:
        return availableProviders[0];
    }
  }

  /**
   * Round-robin provider selection
   */
  private roundRobinSelect(providers: ILLMProvider[]): ILLMProvider {
    const provider = providers[this.currentProviderIndex % providers.length];
    this.currentProviderIndex++;
    return provider;
  }

  /**
   * Select least loaded provider
   */
  private leastLoadedSelect(providers: ILLMProvider[]): ILLMProvider {
    let minLoad = Infinity;
    let selectedProvider = providers[0];

    for (const provider of providers) {
      const status = provider.getStatus();
      if (status.currentLoad < minLoad) {
        minLoad = status.currentLoad;
        selectedProvider = provider;
      }
    }

    return selectedProvider;
  }

  /**
   * Select provider with lowest latency
   */
  private latencyBasedSelect(providers: ILLMProvider[]): ILLMProvider {
    let minLatency = Infinity;
    let selectedProvider = providers[0];

    for (const provider of providers) {
      const metrics = this.providerMetrics.get(provider.name);
      if (metrics && metrics.length > 0) {
        const avgLatency = metrics.reduce((sum, m) => sum + m.latency, 0) / metrics.length;
        if (avgLatency < minLatency) {
          minLatency = avgLatency;
          selectedProvider = provider;
        }
      }
    }

    return selectedProvider;
  }

  /**
   * Select provider with lowest cost
   */
  private costBasedSelect(providers: ILLMProvider[]): ILLMProvider {
    let minCost = Infinity;
    let selectedProvider = providers[0];

    for (const provider of providers) {
      const metrics = this.providerMetrics.get(provider.name);
      if (metrics && metrics.length > 0) {
        const avgCost = metrics.reduce((sum, m) => sum + m.cost, 0) / metrics.length;
        if (avgCost < minCost) {
          minCost = avgCost;
          selectedProvider = provider;
        }
      }
    }

    return selectedProvider;
  }

  /**
   * Check if provider is available
   */
  private isProviderAvailable(provider: ILLMProvider): boolean {
    const status = provider.getStatus();
    return status.available;
  }

  /**
   * Handle request error with fallback
   */
  private async handleRequestError(
    error: unknown,
    request: LLMRequest,
    failedProvider: ILLMProvider
  ): Promise<LLMResponse> {
    this.logger.error(`Provider ${failedProvider.name} failed`, error);
    
    // Update metrics
    this.updateProviderMetrics(failedProvider.name, {
      success: false,
      latency: 0,
      cost: 0,
    });

    // Try fallback
    const fallbackProvider = await this.getFallbackProvider(error, failedProvider);
    if (fallbackProvider) {
      this.logger.info(`Falling back to ${fallbackProvider.name} provider`);
      return fallbackProvider.complete(request);
    }

    throw error;
  }

  /**
   * Get fallback provider based on error
   */
  private async getFallbackProvider(
    error: unknown,
    failedProvider: ILLMProvider
  ): Promise<ILLMProvider | null> {
    if (!this.config.fallbackStrategy?.enabled) {
      return null;
    }

    const errorCondition = this.getErrorCondition(error);
    const fallbackRule = this.config.fallbackStrategy.rules.find(rule => 
      rule.condition === errorCondition
    );

    if (!fallbackRule) {
      return null;
    }

    // Find first available fallback provider
    for (const providerName of fallbackRule.fallbackProviders) {
      const provider = this.providers.get(providerName);
      if (provider && provider !== failedProvider && this.isProviderAvailable(provider)) {
        return provider;
      }
    }

    return null;
  }

  /**
   * Determine error condition for fallback
   */
  private getErrorCondition(error: unknown): FallbackRule['condition'] {
    if (isRateLimitError(error)) {
      return 'rate_limit';
    }
    
    if (error instanceof LLMProviderError) {
      if (error.statusCode === 503) {
        return 'unavailable';
      }
      if (error.code === 'TIMEOUT') {
        return 'timeout';
      }
    }
    
    return 'error';
  }

  /**
   * Cache management
   */
  private checkCache(request: LLMRequest): LLMResponse | null {
    const cacheKey = this.generateCacheKey(request);
    const cached = this.cache.get(cacheKey);
    
    if (cached) {
      const age = Date.now() - cached.timestamp.getTime();
      if (age < (this.config.caching?.ttl || 3600) * 1000) {
        return cached.response;
      }
      // Remove expired entry
      this.cache.delete(cacheKey);
    }
    
    return null;
  }

  private cacheResponse(request: LLMRequest, response: LLMResponse): void {
    const cacheKey = this.generateCacheKey(request);
    this.cache.set(cacheKey, {
      response,
      timestamp: new Date(),
    });
    
    // Cleanup old cache entries
    if (this.cache.size > 1000) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
  }

  private generateCacheKey(request: LLMRequest): string {
    return JSON.stringify({
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
  }

  /**
   * Update provider metrics
   */
  private updateProviderMetrics(
    provider: LLMProvider,
    metrics: { success: boolean; latency: number; cost: number }
  ): void {
    const count = this.requestCount.get(provider) || 0;
    this.requestCount.set(provider, count + 1);
    this.lastUsed.set(provider, new Date());

    const providerMetricsList = this.providerMetrics.get(provider) || [];
    const errorRate = metrics.success ? 0 : 1;
    const successRate = metrics.success ? 1 : 0;

    providerMetricsList.push({
      provider,
      timestamp: new Date(),
      latency: metrics.latency,
      errorRate,
      successRate,
      load: this.providers.get(provider)?.getStatus().currentLoad || 0,
      cost: metrics.cost,
      availability: this.providers.get(provider)?.getStatus().available ? 1 : 0,
    });

    // Keep only recent metrics (last 100)
    if (providerMetricsList.length > 100) {
      providerMetricsList.shift();
    }

    this.providerMetrics.set(provider, providerMetricsList);
  }

  /**
   * Event handlers
   */
  private handleProviderResponse(provider: LLMProvider, data: any): void {
    this.emit('provider_response', { provider, ...data });
  }

  private handleProviderError(provider: LLMProvider, error: any): void {
    this.emit('provider_error', { provider, error });
  }

  private handleHealthCheck(provider: LLMProvider, result: any): void {
    this.emit('health_check', { provider, result });
  }

  /**
   * Start monitoring
   */
  private startMonitoring(): void {
    setInterval(() => {
      this.emitMetrics();
    }, this.config.monitoring?.metricsInterval || 60000);
  }

  /**
   * Emit aggregated metrics
   */
  private emitMetrics(): void {
    const metrics = {
      providers: {} as Record<LLMProvider, any>,
      totalRequests: 0,
      totalCost: 0,
      averageLatency: 0,
    };

    for (const [provider, count] of this.requestCount.entries()) {
      const providerMetricsList = this.providerMetrics.get(provider) || [];
      const avgLatency = providerMetricsList.length > 0
        ? providerMetricsList.reduce((sum, m) => sum + m.latency, 0) / providerMetricsList.length
        : 0;
      const totalCost = providerMetricsList.reduce((sum, m) => sum + m.cost, 0);

      metrics.providers[provider] = {
        requests: count,
        averageLatency: avgLatency,
        totalCost,
        lastUsed: this.lastUsed.get(provider),
        available: this.providers.get(provider)?.getStatus().available,
      };

      metrics.totalRequests += count;
      metrics.totalCost += totalCost;
    }

    if (metrics.totalRequests > 0) {
      let totalLatency = 0;
      let latencyCount = 0;
      
      for (const providerMetricsList of this.providerMetrics.values()) {
        for (const metric of providerMetricsList) {
          totalLatency += metric.latency;
          latencyCount++;
        }
      }
      
      metrics.averageLatency = latencyCount > 0 ? totalLatency / latencyCount : 0;
    }

    this.emit('metrics', metrics);
  }

  /**
   * Get available providers
   */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.providers.keys()).filter(name => {
      const provider = this.providers.get(name);
      return provider && this.isProviderAvailable(provider);
    });
  }

  /**
   * Get provider by name
   */
  getProvider(name: LLMProvider): ILLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all providers
   */
  getAllProviders(): Map<LLMProvider, ILLMProvider> {
    return new Map(this.providers);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    for (const provider of this.providers.values()) {
      provider.destroy();
    }
    
    this.providers.clear();
    this.cache.clear();
    this.providerMetrics.clear();
    this.removeAllListeners();
  }
}