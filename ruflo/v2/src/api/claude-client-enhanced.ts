/**
 * Enhanced Claude API client with comprehensive error handling
 * Implements exponential backoff, health checks, and improved error messages
 */

import { EventEmitter } from 'events';
import { ILogger } from '../core/logger.js';
import { ConfigManager } from '../config/config-manager.js';
import { 
  ClaudeAPIError,
  ClaudeInternalServerError,
  ClaudeServiceUnavailableError,
  ClaudeRateLimitError,
  ClaudeTimeoutError,
  ClaudeNetworkError,
  ClaudeAuthenticationError,
  ClaudeValidationError,
  HealthCheckResult,
  getUserFriendlyError,
} from './claude-api-errors.js';
import { circuitBreaker, CircuitBreaker } from '../utils/helpers.js';
import { 
  ClaudeAPIConfig, 
  ClaudeModel, 
  ClaudeMessage, 
  ClaudeRequest, 
  ClaudeResponse,
  ClaudeStreamEvent,
} from './claude-client.js';

export interface EnhancedClaudeAPIConfig extends ClaudeAPIConfig {
  enableHealthCheck?: boolean;
  healthCheckInterval?: number;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
  circuitBreakerResetTimeout?: number;
  maxRetries?: number;
  retryBaseDelay?: number;
  retryMaxDelay?: number;
  retryJitter?: boolean;
}

export class EnhancedClaudeAPIClient extends EventEmitter {
  private config: EnhancedClaudeAPIConfig;
  private logger: ILogger;
  private configManager: ConfigManager;
  private circuitBreaker: CircuitBreaker;
  private lastHealthCheck?: HealthCheckResult;
  private healthCheckTimer?: NodeJS.Timeout;

  constructor(logger: ILogger, configManager: ConfigManager, config?: Partial<EnhancedClaudeAPIConfig>) {
    super();
    this.logger = logger;
    this.configManager = configManager;
    this.config = this.loadConfiguration(config);
    
    // Initialize circuit breaker
    this.circuitBreaker = circuitBreaker('claude-api', {
      threshold: this.config.circuitBreakerThreshold || 5,
      timeout: this.config.circuitBreakerTimeout || 60000,
      resetTimeout: this.config.circuitBreakerResetTimeout || 300000,
    });

    // Start health check if enabled
    if (this.config.enableHealthCheck) {
      this.startHealthCheck();
    }
  }

  /**
   * Load configuration with enhanced defaults
   */
  private loadConfiguration(overrides?: Partial<EnhancedClaudeAPIConfig>): EnhancedClaudeAPIConfig {
    const config: EnhancedClaudeAPIConfig = {
      apiKey: '',
      apiUrl: 'https://api.anthropic.com/v1/messages',
      model: 'claude-3-sonnet-20240229',
      temperature: 0.7,
      maxTokens: 4096,
      topP: 1,
      topK: undefined,
      systemPrompt: undefined,
      timeout: 60000,
      retryAttempts: 3,
      retryDelay: 1000,
      // Enhanced configurations
      enableHealthCheck: true,
      healthCheckInterval: 300000, // 5 minutes
      circuitBreakerThreshold: 5,
      circuitBreakerTimeout: 60000,
      circuitBreakerResetTimeout: 300000,
      maxRetries: 3,
      retryBaseDelay: 1000,
      retryMaxDelay: 30000,
      retryJitter: true,
    };

    // Load from environment
    if (process.env.ANTHROPIC_API_KEY) {
      config.apiKey = process.env.ANTHROPIC_API_KEY;
    }

    // Load from config manager
    const claudeConfig = this.configManager.get('claude');
    if (claudeConfig) {
      Object.assign(config, claudeConfig);
    }

    // Apply overrides
    if (overrides) {
      Object.assign(config, overrides);
    }

    this.validateConfiguration(config);
    return config;
  }

  /**
   * Validate configuration
   */
  private validateConfiguration(config: EnhancedClaudeAPIConfig): void {
    if (!config.apiKey) {
      throw new ClaudeAuthenticationError('Claude API key is required. Set ANTHROPIC_API_KEY environment variable.');
    }

    if (config.temperature !== undefined && (config.temperature < 0 || config.temperature > 1)) {
      throw new ClaudeValidationError('Temperature must be between 0 and 1');
    }

    if (config.maxTokens !== undefined && (config.maxTokens < 1 || config.maxTokens > 100000)) {
      throw new ClaudeValidationError('Max tokens must be between 1 and 100000');
    }
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    this.performHealthCheck(); // Initial check
    
    this.healthCheckTimer = setInterval(
      () => this.performHealthCheck(),
      this.config.healthCheckInterval || 300000,
    );
  }

  /**
   * Perform a health check on the API
   */
  async performHealthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Simple health check request
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(this.config.apiUrl || '', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      
      const latency = Date.now() - startTime;
      const healthy = response.ok || response.status === 429; // Rate limit is still "healthy"
      
      this.lastHealthCheck = {
        healthy,
        latency,
        error: healthy ? undefined : `Status: ${response.status}`,
        timestamp: new Date(),
      };

      this.logger.debug('Claude API health check completed', this.lastHealthCheck);
      this.emit('health_check', this.lastHealthCheck);
      
      return this.lastHealthCheck;
    } catch (error) {
      const latency = Date.now() - startTime;
      
      this.lastHealthCheck = {
        healthy: false,
        latency,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };

      this.logger.warn('Claude API health check failed', this.lastHealthCheck);
      this.emit('health_check', this.lastHealthCheck);
      
      return this.lastHealthCheck;
    }
  }

  /**
   * Get last health check result
   */
  getHealthStatus(): HealthCheckResult | undefined {
    return this.lastHealthCheck;
  }

  /**
   * Send a message with enhanced error handling
   */
  async sendMessage(
    messages: ClaudeMessage[],
    options?: {
      model?: ClaudeModel;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      stream?: boolean;
    },
  ): Promise<ClaudeResponse | AsyncIterable<ClaudeStreamEvent>> {
    const request: ClaudeRequest = {
      model: options?.model || this.config.model || 'claude-3-sonnet-20240229',
      messages,
      system: options?.systemPrompt || this.config.systemPrompt,
      max_tokens: options?.maxTokens || this.config.maxTokens || 4096,
      temperature: options?.temperature ?? this.config.temperature,
      top_p: this.config.topP,
      top_k: this.config.topK,
      stream: options?.stream || false,
    };

    this.logger.debug('Sending Claude API request', {
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.max_tokens,
      messageCount: messages.length,
      stream: request.stream,
    });

    try {
      // Use circuit breaker for the request
      const result = await this.circuitBreaker.execute(async () => {
        if (request.stream) {
          return this.streamRequestWithRetry(request);
        } else {
          return this.sendRequestWithRetry(request);
        }
      });

      return result;
    } catch (error) {
      // Handle circuit breaker open state
      if (error instanceof Error && error.message.includes('Circuit breaker')) {
        const apiError = new ClaudeServiceUnavailableError(
          'Claude API is temporarily unavailable due to repeated failures. Please try again later.',
        );
        this.handleError(apiError);
        throw apiError;
      }
      throw error;
    }
  }

  /**
   * Send request with retry logic and enhanced error handling
   */
  private async sendRequestWithRetry(request: ClaudeRequest): Promise<ClaudeResponse> {
    let lastError: ClaudeAPIError | undefined;
    const maxRetries = this.config.maxRetries || 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await this.sendRequestOnce(request);
      } catch (error) {
        lastError = this.transformError(error);
        
        // Don't retry non-retryable errors
        if (!lastError.retryable) {
          this.handleError(lastError);
          throw lastError;
        }

        this.logger.warn(
          `Claude API request failed (attempt ${attempt + 1}/${maxRetries})`,
          {
            error: lastError.message,
            statusCode: lastError.statusCode,
            retryable: lastError.retryable,
          },
        );

        // Don't retry on the last attempt
        if (attempt < maxRetries - 1) {
          const delay = this.calculateRetryDelay(attempt, lastError);
          this.logger.info(`Retrying after ${delay}ms...`);
          await this.delay(delay);
        }
      }
    }

    this.handleError(lastError!);
    throw lastError;
  }

  /**
   * Send a single request
   */
  private async sendRequestOnce(request: ClaudeRequest): Promise<ClaudeResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(this.config.apiUrl || '', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle different error status codes
      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;
        
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        throw this.createAPIError(response.status, errorData);
      }

      const data = (await response.json()) as ClaudeResponse;

      this.logger.info('Claude API response received', {
        model: data.model,
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        stopReason: data.stop_reason,
      });

      this.emit('response', data);
      return data;
    } catch (error) {
      clearTimeout(timeout);
      
      // Handle abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ClaudeTimeoutError(
          'Request timed out',
          this.config.timeout || 60000,
        );
      }
      
      throw error;
    }
  }

  /**
   * Stream request with retry logic
   */
  private async *streamRequestWithRetry(request: ClaudeRequest): AsyncIterable<ClaudeStreamEvent> {
    let lastError: ClaudeAPIError | undefined;
    const maxRetries = this.config.maxRetries || 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        yield* this.streamRequestOnce(request);
        return;
      } catch (error) {
        lastError = this.transformError(error);
        
        if (!lastError.retryable) {
          this.handleError(lastError);
          throw lastError;
        }

        this.logger.warn(
          `Claude API stream request failed (attempt ${attempt + 1}/${maxRetries})`,
          { error: lastError.message },
        );

        if (attempt < maxRetries - 1) {
          const delay = this.calculateRetryDelay(attempt, lastError);
          await this.delay(delay);
        }
      }
    }

    this.handleError(lastError!);
    throw lastError;
  }

  /**
   * Send a single streaming request
   */
  private async *streamRequestOnce(request: ClaudeRequest): AsyncIterable<ClaudeStreamEvent> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(this.config.apiUrl || '', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.config.apiKey,
        },
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData: any;
        
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText };
        }

        throw this.createAPIError(response.status, errorData);
      }

      if (!response.body) {
        throw new ClaudeAPIError('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data) as ClaudeStreamEvent;
              this.emit('stream_event', event);
              yield event;
            } catch (e) {
              this.logger.warn('Failed to parse stream event', { data, error: e });
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Create appropriate error based on status code
   */
  private createAPIError(statusCode: number, errorData: any): ClaudeAPIError {
    const message = errorData.error?.message || errorData.message || 'Unknown error';

    switch (statusCode) {
      case 400:
        return new ClaudeValidationError(message, errorData);
      case 401:
      case 403:
        return new ClaudeAuthenticationError(message, errorData);
      case 429: {
        const retryAfter = errorData.error?.retry_after;
        return new ClaudeRateLimitError(message, retryAfter, errorData);
      }
      case 500:
        return new ClaudeInternalServerError(message, errorData);
      case 503:
        return new ClaudeServiceUnavailableError(message, errorData);
      default:
        return new ClaudeAPIError(message, statusCode, statusCode >= 500, errorData);
    }
  }

  /**
   * Transform generic errors to Claude API errors
   */
  private transformError(error: unknown): ClaudeAPIError {
    if (error instanceof ClaudeAPIError) {
      return error;
    }

    if (error instanceof Error) {
      // Network errors
      if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
        return new ClaudeNetworkError(error.message);
      }
      
      // Timeout errors
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return new ClaudeTimeoutError(error.message, this.config.timeout || 60000);
      }
    }

    return new ClaudeAPIError(
      error instanceof Error ? error.message : String(error),
      undefined,
      true, // Assume unknown errors are retryable
    );
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   */
  private calculateRetryDelay(attempt: number, error: ClaudeAPIError): number {
    // If rate limit error with retry-after header, use that
    if (error instanceof ClaudeRateLimitError && error.retryAfter) {
      return error.retryAfter * 1000; // Convert to milliseconds
    }

    const baseDelay = this.config.retryBaseDelay || 1000;
    const maxDelay = this.config.retryMaxDelay || 30000;
    
    // Exponential backoff: delay = baseDelay * (2 ^ attempt)
    let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    
    // Add jitter to prevent thundering herd
    if (this.config.retryJitter) {
      const jitter = Math.random() * 0.3 * delay; // Up to 30% jitter
      delay = delay + jitter;
    }

    return Math.floor(delay);
  }

  /**
   * Handle errors with user-friendly messages and logging
   */
  private handleError(error: ClaudeAPIError): void {
    const errorInfo = getUserFriendlyError(error);
    
    this.logger.error(`${errorInfo.title}: ${errorInfo.message}`, {
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      retryable: error.retryable,
      details: error.details,
    });

    // Log suggestions in debug mode
    if (this.logger.level === 'debug' && errorInfo.suggestions.length > 0) {
      this.logger.debug('Suggestions to resolve the issue:', errorInfo.suggestions);
    }

    this.emit('error', {
      error,
      userFriendly: errorInfo,
    });
  }

  /**
   * Helper method for simple completions with error handling
   */
  async complete(
    prompt: string,
    options?: {
      model?: ClaudeModel;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    },
  ): Promise<string> {
    try {
      const messages: ClaudeMessage[] = [{ role: 'user', content: prompt }];
      const response = (await this.sendMessage(messages, options)) as ClaudeResponse;
      return response.content[0].text;
    } catch (error) {
      if (error instanceof ClaudeAPIError) {
        const errorInfo = getUserFriendlyError(error);
        throw new Error(`${errorInfo.title}: ${errorInfo.message}`);
      }
      throw error;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    this.removeAllListeners();
  }
}