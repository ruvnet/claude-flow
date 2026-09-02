/**
 * Abstract Base Provider for LLM integrations
 * Provides common functionality for all LLM providers
 */

import { EventEmitter } from 'events';
import { ILogger } from '../core/logger.js';
import { circuitBreaker, CircuitBreaker } from '../utils/helpers.js';
import {
  ILLMProvider,
  LLMProvider,
  LLMProviderConfig,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  LLMModel,
  ModelInfo,
  ProviderCapabilities,
  HealthCheckResult,
  ProviderStatus,
  CostEstimate,
  UsageStats,
  UsagePeriod,
  LLMProviderError,
  RateLimitError,
  ProviderUnavailableError,
} from './types.js';

export interface BaseProviderOptions {
  logger: ILogger;
  config: LLMProviderConfig;
  cacheTTL?: number;
  circuitBreakerOptions?: {
    threshold?: number;
    timeout?: number;
    resetTimeout?: number;
  };
}

export abstract class BaseProvider extends EventEmitter implements ILLMProvider {
  abstract readonly name: LLMProvider;
  abstract readonly capabilities: ProviderCapabilities;
  
  protected logger: ILogger;
  protected circuitBreaker: CircuitBreaker;
  protected healthCheckInterval?: NodeJS.Timeout;
  protected lastHealthCheck?: HealthCheckResult;
  protected requestCount = 0;
  protected errorCount = 0;
  protected totalTokens = 0;
  protected totalCost = 0;
  protected requestMetrics: Map<string, any> = new Map();
  
  public config: LLMProviderConfig;

  constructor(options: BaseProviderOptions) {
    super();
    this.logger = options.logger;
    this.config = options.config;
    
    // Initialize circuit breaker
    this.circuitBreaker = circuitBreaker(`llm-${this.name}`, {
      threshold: options.circuitBreakerOptions?.threshold || 5,
      timeout: options.circuitBreakerOptions?.timeout || 60000,
      resetTimeout: options.circuitBreakerOptions?.resetTimeout || 300000,
    });
    
    // Start health checks if enabled
    if (this.config.enableCaching) {
      this.startHealthChecks();
    }
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    this.logger.info(`Initializing ${this.name} provider`, {
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
    
    // Validate configuration
    this.validateConfig();
    
    // Provider-specific initialization
    await this.doInitialize();
    
    // Perform initial health check
    await this.healthCheck();
  }

  /**
   * Provider-specific initialization
   */
  protected abstract doInitialize(): Promise<void>;

  /**
   * Validate provider configuration
   */
  protected validateConfig(): void {
    if (!this.config.model) {
      throw new Error(`Model is required for ${this.name} provider`);
    }
    
    if (!this.validateModel(this.config.model)) {
      throw new Error(`Model ${this.config.model} is not supported by ${this.name} provider`);
    }
    
    if (this.config.temperature !== undefined) {
      if (this.config.temperature < 0 || this.config.temperature > 2) {
        throw new Error('Temperature must be between 0 and 2');
      }
    }
    
    if (this.config.maxTokens !== undefined) {
      const maxAllowed = this.capabilities.maxOutputTokens[this.config.model] || 4096;
      if (this.config.maxTokens > maxAllowed) {
        throw new Error(`Max tokens exceeds limit of ${maxAllowed} for model ${this.config.model}`);
      }
    }
  }

  /**
   * Complete a request
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    
    try {
      // Use circuit breaker
      const response = await this.circuitBreaker.execute(async () => {
        return await this.doComplete(request);
      });
      
      // Track metrics
      const latency = Date.now() - startTime;
      this.trackRequest(request, response, latency);
      
      // Emit events
      this.emit('response', {
        provider: this.name,
        model: response.model,
        latency,
        tokens: response.usage.totalTokens,
        cost: response.cost?.totalCost,
      });
      
      return response;
    } catch (error) {
      this.errorCount++;
      
      // Transform to provider error
      const providerError = this.transformError(error);
      
      // Track error
      this.emit('error', {
        provider: this.name,
        error: providerError,
        request,
      });
      
      throw providerError;
    }
  }

  /**
   * Provider-specific completion implementation
   */
  protected abstract doComplete(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Stream complete a request
   */
  async *streamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const startTime = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    
    try {
      // Check if streaming is supported
      if (!this.capabilities.supportsStreaming) {
        throw new LLMProviderError(
          'Streaming not supported',
          'STREAMING_NOT_SUPPORTED',
          this.name,
          undefined,
          false
        );
      }
      
      // Use circuit breaker
      const stream = await this.circuitBreaker.execute(async () => {
        return this.doStreamComplete(request);
      });
      
      // Process stream
      for await (const event of stream) {
        if (event.usage) {
          totalTokens = event.usage.totalTokens;
        }
        if (event.cost) {
          totalCost = event.cost.totalCost;
        }
        
        yield event;
      }
      
      // Track metrics
      const latency = Date.now() - startTime;
      this.trackStreamRequest(request, totalTokens, totalCost, latency);
      
    } catch (error) {
      this.errorCount++;
      
      // Transform to provider error
      const providerError = this.transformError(error);
      
      // Yield error event
      yield {
        type: 'error',
        error: providerError,
      };
      
      throw providerError;
    }
  }

  /**
   * Provider-specific stream completion implementation
   */
  protected abstract doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent>;

  /**
   * List available models
   */
  abstract listModels(): Promise<LLMModel[]>;

  /**
   * Get model information
   */
  abstract getModelInfo(model: LLMModel): Promise<ModelInfo>;

  /**
   * Validate if a model is supported
   */
  validateModel(model: LLMModel): boolean {
    return this.capabilities.supportedModels.includes(model);
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Provider-specific health check
      const result = await this.doHealthCheck();
      
      this.lastHealthCheck = {
        ...result,
        latency: Date.now() - startTime,
        timestamp: new Date(),
      };
      
      this.emit('health_check', this.lastHealthCheck);
      return this.lastHealthCheck;
      
    } catch (error) {
      this.lastHealthCheck = {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        latency: Date.now() - startTime,
        timestamp: new Date(),
      };
      
      this.emit('health_check', this.lastHealthCheck);
      return this.lastHealthCheck;
    }
  }

  /**
   * Provider-specific health check implementation
   */
  protected abstract doHealthCheck(): Promise<HealthCheckResult>;

  /**
   * Get provider status
   */
  getStatus(): ProviderStatus {
    const queueLength = this.requestMetrics.size;
    const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
    
    return {
      available: this.lastHealthCheck?.healthy ?? false,
      currentLoad: queueLength / 100, // Normalize to 0-1
      queueLength,
      activeRequests: queueLength,
      rateLimitRemaining: this.getRateLimitRemaining(),
      rateLimitReset: this.getRateLimitReset(),
    };
  }

  /**
   * Get remaining rate limit (override in provider)
   */
  protected getRateLimitRemaining(): number | undefined {
    return undefined;
  }

  /**
   * Get rate limit reset time (override in provider)
   */
  protected getRateLimitReset(): Date | undefined {
    return undefined;
  }

  /**
   * Estimate cost for a request
   */
  async estimateCost(request: LLMRequest): Promise<CostEstimate> {
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing?.[model];
    
    if (!pricing) {
      return {
        estimatedPromptTokens: 0,
        estimatedCompletionTokens: 0,
        estimatedTotalTokens: 0,
        estimatedCost: {
          prompt: 0,
          completion: 0,
          total: 0,
          currency: 'USD',
        },
        confidence: 0,
      };
    }
    
    // Estimate tokens (simple approximation, providers should override)
    const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
    const completionTokens = request.maxTokens || this.config.maxTokens || 1000;
    
    const promptCost = (promptTokens / 1000) * pricing.promptCostPer1k;
    const completionCost = (completionTokens / 1000) * pricing.completionCostPer1k;
    
    return {
      estimatedPromptTokens: promptTokens,
      estimatedCompletionTokens: completionTokens,
      estimatedTotalTokens: promptTokens + completionTokens,
      estimatedCost: {
        prompt: promptCost,
        completion: completionCost,
        total: promptCost + completionCost,
        currency: pricing.currency,
      },
      confidence: 0.7, // 70% confidence in estimation
    };
  }

  /**
   * Simple token estimation (4 chars = 1 token approximation)
   */
  protected estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Get usage statistics
   */
  async getUsage(period: UsagePeriod = 'day'): Promise<UsageStats> {
    const now = new Date();
    const start = this.getStartDate(now, period);
    
    // In a real implementation, this would query a database
    // For now, return current session stats
    return {
      period: { start, end: now },
      requests: this.requestCount,
      tokens: {
        prompt: Math.floor(this.totalTokens * 0.7), // Estimate
        completion: Math.floor(this.totalTokens * 0.3),
        total: this.totalTokens,
      },
      cost: {
        prompt: this.totalCost * 0.7,
        completion: this.totalCost * 0.3,
        total: this.totalCost,
        currency: 'USD',
      },
      errors: this.errorCount,
      averageLatency: this.calculateAverageLatency(),
      modelBreakdown: {}, // Would need to track per model
    };
  }

  /**
   * Get start date for period
   */
  private getStartDate(end: Date, period: UsagePeriod): Date {
    const start = new Date(end);
    switch (period) {
      case 'hour':
        start.setHours(start.getHours() - 1);
        break;
      case 'day':
        start.setDate(start.getDate() - 1);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'all':
        start.setFullYear(2020); // Arbitrary old date
        break;
    }
    return start;
  }

  /**
   * Calculate average latency
   */
  private calculateAverageLatency(): number {
    if (this.requestMetrics.size === 0) return 0;
    
    let totalLatency = 0;
    let count = 0;
    
    this.requestMetrics.forEach((metrics) => {
      if (metrics.latency) {
        totalLatency += metrics.latency;
        count++;
      }
    });
    
    return count > 0 ? totalLatency / count : 0;
  }

  /**
   * Track successful request
   */
  protected trackRequest(request: LLMRequest, response: LLMResponse, latency: number): void {
    this.requestCount++;
    this.totalTokens += response.usage.totalTokens;
    
    if (response.cost) {
      this.totalCost += response.cost.totalCost;
    }
    
    // Store metrics (in memory for now)
    const requestId = response.id;
    this.requestMetrics.set(requestId, {
      timestamp: new Date(),
      model: response.model,
      tokens: response.usage.totalTokens,
      cost: response.cost?.totalCost,
      latency,
    });
    
    // Clean up old metrics (keep last 1000)
    if (this.requestMetrics.size > 1000) {
      const oldestKey = this.requestMetrics.keys().next().value;
      this.requestMetrics.delete(oldestKey);
    }
  }

  /**
   * Track streaming request
   */
  protected trackStreamRequest(
    request: LLMRequest,
    totalTokens: number,
    totalCost: number,
    latency: number
  ): void {
    this.requestCount++;
    this.totalTokens += totalTokens;
    this.totalCost += totalCost;
    
    // Store metrics
    const requestId = `stream-${Date.now()}`;
    this.requestMetrics.set(requestId, {
      timestamp: new Date(),
      model: request.model || this.config.model,
      tokens: totalTokens,
      cost: totalCost,
      latency,
      stream: true,
    });
  }

  /**
   * Transform errors to provider errors
   */
  protected transformError(error: unknown): LLMProviderError {
    if (error instanceof LLMProviderError) {
      return error;
    }
    
    if (error instanceof Error) {
      // Check for common error patterns
      if (error.message.includes('rate limit')) {
        return new RateLimitError(error.message, this.name);
      }
      
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        return new LLMProviderError(
          'Request timed out',
          'TIMEOUT',
          this.name,
          undefined,
          true
        );
      }
      
      if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        return new ProviderUnavailableError(this.name, { originalError: error.message });
      }
    }
    
    return new LLMProviderError(
      error instanceof Error ? error.message : String(error),
      'UNKNOWN',
      this.name,
      undefined,
      true
    );
  }

  /**
   * Start periodic health checks
   */
  protected startHealthChecks(): void {
    const interval = this.config.cacheTimeout || 300000; // 5 minutes default
    
    this.healthCheckInterval = setInterval(() => {
      this.healthCheck().catch((error) => {
        this.logger.error(`Health check failed for ${this.name}`, error);
      });
    }, interval);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.requestMetrics.clear();
    this.removeAllListeners();
    
    this.logger.info(`${this.name} provider destroyed`);
  }
}