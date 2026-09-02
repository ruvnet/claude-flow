/**
 * V3 Abstract Base Provider
 *
 * Provides common functionality for all LLM providers:
 * - Circuit breaker protection
 * - Health monitoring
 * - Cost tracking
 * - Request metrics
 *
 * @module @claude-flow/providers/base-provider
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

/**
 * Simple circuit breaker implementation
 */
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private readonly name: string,
    private readonly threshold: number = 5,
    private readonly resetTimeout: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.resetTimeout) {
        this.state = 'half-open';
      } else {
        throw new Error(`Circuit breaker ${this.name} is open`);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  getState(): string {
    return this.state;
  }
}

/**
 * Logger interface
 */
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: unknown): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Console logger implementation
 */
export const consoleLogger: ILogger = {
  info: (msg, meta) => console.log(`[INFO] ${msg}`, meta || ''),
  warn: (msg, meta) => console.warn(`[WARN] ${msg}`, meta || ''),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err || ''),
  debug: (msg, meta) => console.debug(`[DEBUG] ${msg}`, meta || ''),
};

/**
 * Base provider options
 */
export interface BaseProviderOptions {
  logger?: ILogger;
  config: LLMProviderConfig;
  cacheTTL?: number;
  circuitBreakerOptions?: {
    threshold?: number;
    resetTimeout?: number;
  };
}

/**
 * Abstract base class for LLM providers
 */
export abstract class BaseProvider extends EventEmitter implements ILLMProvider {
  abstract readonly name: LLMProvider;
  abstract readonly capabilities: ProviderCapabilities;

  protected logger: ILogger;
  protected circuitBreaker: CircuitBreaker;
  protected healthCheckInterval?: ReturnType<typeof setInterval>;
  protected lastHealthCheck?: HealthCheckResult;

  // Metrics
  protected requestCount = 0;
  protected errorCount = 0;
  protected totalTokens = 0;
  protected totalCost = 0;
  protected requestMetrics: Map<string, {
    timestamp: Date;
    model: string;
    tokens: number;
    cost?: number;
    latency: number;
  }> = new Map();

  public config: LLMProviderConfig;

  constructor(options: BaseProviderOptions) {
    super();
    this.logger = options.logger || consoleLogger;
    this.config = options.config;

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker(
      `llm-${this.config.provider}`,
      options.circuitBreakerOptions?.threshold || 5,
      options.circuitBreakerOptions?.resetTimeout || 60000
    );
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

    // Start health checks if caching enabled
    if (this.config.enableCaching) {
      this.startHealthChecks();
    }

    // Initial health check
    await this.healthCheck();
  }

  /**
   * Provider-specific initialization (override in subclass)
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
      this.logger.warn(`Model ${this.config.model} may not be supported by ${this.name}`);
    }

    if (this.config.temperature !== undefined) {
      if (this.config.temperature < 0 || this.config.temperature > 2) {
        throw new Error('Temperature must be between 0 and 2');
      }
    }
  }

  /**
   * Complete a request
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      const response = await this.circuitBreaker.execute(async () => {
        return await this.doComplete(request);
      });

      const latency = Date.now() - startTime;
      this.trackRequest(request, response, latency);

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

      const providerError = this.transformError(error);

      this.emit('error', {
        provider: this.name,
        error: providerError,
        request,
      });

      throw providerError;
    }
  }

  /**
   * Provider-specific completion (override in subclass)
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
      if (!this.capabilities.supportsStreaming) {
        throw new LLMProviderError(
          'Streaming not supported',
          'STREAMING_NOT_SUPPORTED',
          this.name,
          undefined,
          false
        );
      }

      const stream = await this.circuitBreaker.execute(async () => {
        return this.doStreamComplete(request);
      });

      for await (const event of stream) {
        if (event.usage) {
          totalTokens = event.usage.totalTokens;
        }
        if (event.cost) {
          totalCost = event.cost.totalCost;
        }
        yield event;
      }

      const latency = Date.now() - startTime;
      this.trackStreamRequest(request, totalTokens, totalCost, latency);
    } catch (error) {
      this.errorCount++;
      const providerError = this.transformError(error);

      yield { type: 'error', error: providerError };
      throw providerError;
    }
  }

  /**
   * Provider-specific stream completion (override in subclass)
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
   * Provider-specific health check (override in subclass)
   */
  protected abstract doHealthCheck(): Promise<HealthCheckResult>;

  /**
   * Get provider status
   */
  getStatus(): ProviderStatus {
    const queueLength = this.requestMetrics.size;

    return {
      available: this.lastHealthCheck?.healthy ?? false,
      currentLoad: Math.min(queueLength / 100, 1),
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
        estimatedCost: { prompt: 0, completion: 0, total: 0, currency: 'USD' },
        confidence: 0,
      };
    }

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
      confidence: 0.7,
    };
  }

  /**
   * Simple token estimation (4 chars ≈ 1 token)
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

    return {
      period: { start, end: now },
      requests: this.requestCount,
      tokens: {
        prompt: Math.floor(this.totalTokens * 0.7),
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
      modelBreakdown: {},
    };
  }

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
        start.setFullYear(2020);
        break;
    }
    return start;
  }

  private calculateAverageLatency(): number {
    if (this.requestMetrics.size === 0) return 0;

    let total = 0;
    let count = 0;

    this.requestMetrics.forEach((metrics) => {
      if (metrics.latency) {
        total += metrics.latency;
        count++;
      }
    });

    return count > 0 ? total / count : 0;
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

    this.requestMetrics.set(response.id, {
      timestamp: new Date(),
      model: response.model,
      tokens: response.usage.totalTokens,
      cost: response.cost?.totalCost,
      latency,
    });

    // Keep last 1000 metrics
    if (this.requestMetrics.size > 1000) {
      const oldestKey = this.requestMetrics.keys().next().value;
      if (oldestKey) this.requestMetrics.delete(oldestKey);
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

    this.requestMetrics.set(`stream-${Date.now()}`, {
      timestamp: new Date(),
      model: request.model || this.config.model,
      tokens: totalTokens,
      cost: totalCost,
      latency,
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
      if (error.message.includes('rate limit')) {
        return new RateLimitError(error.message, this.name);
      }

      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        return new LLMProviderError('Request timed out', 'TIMEOUT', this.name, undefined, true);
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
    const interval = this.config.cacheTimeout || 300000;

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
