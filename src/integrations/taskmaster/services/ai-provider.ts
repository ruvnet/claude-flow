import { EventEmitter } from 'node:events';
import {
  AIProvider,
  AIModel,
  AIRequest,
  AIResponse,
  ProviderConfig,
  ModelSelector,
  PerformanceMetrics,
  RateLimitResult,
  HealthStatus,
  ProviderError,
  CircuitBreakerState
} from '../types/ai-types.ts';

export interface AIProviderManagerConfig {
  defaultRetries: number;
  circuitBreakerThreshold: number;
  fallbackStrategy: 'sequential' | 'parallel' | 'cost-optimized';
  maxConcurrentRequests: number;
  requestTimeout: number;
}

export class AIProviderManager extends EventEmitter {
  private providers: Map<string, AIProvider> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private performanceHistory: Map<string, PerformanceMetrics[]> = new Map();
  private config: AIProviderManagerConfig;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<AIProviderManagerConfig> = {}) {
    super();
    this.config = {
      defaultRetries: 3,
      circuitBreakerThreshold: 5,
      fallbackStrategy: 'cost-optimized',
      maxConcurrentRequests: 10,
      requestTimeout: 30000,
      ...config
    };
    this.initializeHealthChecking();
  }

  async registerProvider(provider: AIProvider): Promise<void> {
    await this.validateProvider(provider);
    this.providers.set(provider.id, provider);
    this.circuitBreakers.set(provider.id, {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: null,
      nextRetryTime: null
    });
    this.emit('providerRegistered', provider);
  }

  async removeProvider(providerId: string): Promise<void> {
    this.providers.delete(providerId);
    this.circuitBreakers.delete(providerId);
    this.performanceHistory.delete(providerId);
    this.emit('providerRemoved', providerId);
  }

  async getAvailableProviders(): Promise<AIProvider[]> {
    const healthyProviders: AIProvider[] = [];
    
    for (const [id, provider] of this.providers) {
      const health = await this.checkProviderHealth(id);
      if (health.status === 'healthy') {
        healthyProviders.push(provider);
      }
    }
    
    return healthyProviders;
  }

  async executeWithFallback(request: AIRequest): Promise<AIResponse> {
    const providers = await this.selectProviders(request);
    let lastError: ProviderError | null = null;

    for (const provider of providers) {
      try {
        const response = await this.executeWithProvider(provider, request);
        this.recordSuccess(provider.id, request);
        return response;
      } catch (error) {
        lastError = this.handleProviderError(provider.id, error as Error);
        this.emit('providerError', { providerId: provider.id, error, request });
      }
    }

    throw new ProviderError(
      'All providers exhausted',
      'PROVIDERS_EXHAUSTED',
      lastError
    );
  }

  private async selectProviders(request: AIRequest): Promise<AIProvider[]> {
    const availableProviders = await this.getAvailableProviders();
    const scoredProviders = availableProviders
      .map(provider => ({
        provider,
        score: this.calculateProviderScore(provider, request)
      }))
      .sort((a, b) => b.score - a.score);

    return scoredProviders.map(item => item.provider);
  }

  private calculateProviderScore(provider: AIProvider, request: AIRequest): number {
    const capabilities = provider.capabilities[request.type] || 0;
    const performance = this.getAveragePerformance(provider.id);
    const cost = this.calculateCostScore(provider.costPerToken);
    const reliability = this.getReliabilityScore(provider.id);

    return capabilities * 0.3 + performance * 0.25 + cost * 0.2 + reliability * 0.25;
  }

  private async executeWithProvider(
    provider: AIProvider, 
    request: AIRequest
  ): Promise<AIResponse> {
    if (!this.isProviderAvailable(provider.id)) {
      throw new ProviderError(
        'Provider circuit breaker is open',
        'CIRCUIT_BREAKER_OPEN',
        null
      );
    }

    const startTime = Date.now();
    
    try {
      const response = await Promise.race([
        this.callProvider(provider, request),
        this.createTimeoutPromise(this.config.requestTimeout)
      ]);

      const duration = Date.now() - startTime;
      this.recordPerformance(provider.id, duration, true);
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.recordPerformance(provider.id, duration, false);
      this.handleCircuitBreaker(provider.id);
      throw error;
    }
  }

  private async callProvider(provider: AIProvider, request: AIRequest): Promise<AIResponse> {
    switch (provider.type) {
      case 'anthropic':
        return await this.callAnthropic(provider, request);
      case 'openai':
        return await this.callOpenAI(provider, request);
      case 'google':
        return await this.callGoogle(provider, request);
      case 'perplexity':
        return await this.callPerplexity(provider, request);
      case 'xai':
        return await this.callXAI(provider, request);
      case 'mistral':
        return await this.callMistral(provider, request);
      default:
        throw new ProviderError(
          `Unsupported provider type: ${provider.type}`,
          'UNSUPPORTED_PROVIDER',
          null
        );
    }
  }

  private async callAnthropic(provider: AIProvider, request: AIRequest): Promise<AIResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': provider.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: request.model || 'claude-3-sonnet-20240229',
        max_tokens: request.maxTokens || 4000,
        messages: [{ role: 'user', content: request.content }],
        system: request.systemPrompt
      })
    });

    if (!response.ok) {
      throw new ProviderError(
        `Anthropic API error: ${response.statusText}`,
        'API_ERROR',
        null
      );
    }

    const data = await response.json();
    return {
      content: data.content[0].text,
      model: data.model,
      usage: {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens
      },
      metadata: {
        providerId: provider.id,
        requestId: data.id
      }
    };
  }

  private async callOpenAI(provider: AIProvider, request: AIRequest): Promise<AIResponse> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: request.model || 'gpt-4',
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          { role: 'user', content: request.content }
        ],
        max_tokens: request.maxTokens || 4000
      })
    });

    if (!response.ok) {
      throw new ProviderError(
        `OpenAI API error: ${response.statusText}`,
        'API_ERROR',
        null
      );
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      },
      metadata: {
        providerId: provider.id,
        requestId: data.id
      }
    };
  }

  private async callGoogle(provider: AIProvider, request: AIRequest): Promise<AIResponse> {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${request.model || 'gemini-pro'}:generateContent?key=${provider.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.content }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens || 4000
        }
      })
    });

    if (!response.ok) {
      throw new ProviderError(
        `Google API error: ${response.statusText}`,
        'API_ERROR',
        null
      );
    }

    const data = await response.json();
    return {
      content: data.candidates[0].content.parts[0].text,
      model: request.model || 'gemini-pro',
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount || 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
        totalTokens: data.usageMetadata?.totalTokenCount || 0
      },
      metadata: {
        providerId: provider.id,
        requestId: 'google-' + Date.now()
      }
    };
  }

  private async callPerplexity(provider: AIProvider, request: AIRequest): Promise<AIResponse> {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: request.model || 'llama-3.1-sonar-small-128k-online',
        messages: [{ role: 'user', content: request.content }],
        max_tokens: request.maxTokens || 4000
      })
    });

    if (!response.ok) {
      throw new ProviderError(
        `Perplexity API error: ${response.statusText}`,
        'API_ERROR',
        null
      );
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      metadata: {
        providerId: provider.id,
        requestId: data.id
      }
    };
  }

  private async callXAI(provider: AIProvider, request: AIRequest): Promise<AIResponse> {
    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: request.model || 'grok-beta',
        messages: [{ role: 'user', content: request.content }],
        max_tokens: request.maxTokens || 4000
      })
    });

    if (!response.ok) {
      throw new ProviderError(
        `xAI API error: ${response.statusText}`,
        'API_ERROR',
        null
      );
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      metadata: {
        providerId: provider.id,
        requestId: data.id
      }
    };
  }

  private async callMistral(provider: AIProvider, request: AIRequest): Promise<AIResponse> {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: request.model || 'mistral-large-latest',
        messages: [{ role: 'user', content: request.content }],
        max_tokens: request.maxTokens || 4000
      })
    });

    if (!response.ok) {
      throw new ProviderError(
        `Mistral API error: ${response.statusText}`,
        'API_ERROR',
        null
      );
    }

    const data = await response.json();
    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0
      },
      metadata: {
        providerId: provider.id,
        requestId: data.id
      }
    };
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new ProviderError('Request timeout', 'TIMEOUT', null)), timeout);
    });
  }

  private isProviderAvailable(providerId: string): boolean {
    const circuitBreaker = this.circuitBreakers.get(providerId);
    if (!circuitBreaker) return false;

    if (circuitBreaker.state === 'open') {
      if (circuitBreaker.nextRetryTime && Date.now() > circuitBreaker.nextRetryTime) {
        circuitBreaker.state = 'half-open';
        return true;
      }
      return false;
    }

    return true;
  }

  private handleCircuitBreaker(providerId: string): void {
    const circuitBreaker = this.circuitBreakers.get(providerId);
    if (!circuitBreaker) return;

    circuitBreaker.failureCount++;
    circuitBreaker.lastFailureTime = Date.now();

    if (circuitBreaker.failureCount >= this.config.circuitBreakerThreshold) {
      circuitBreaker.state = 'open';
      circuitBreaker.nextRetryTime = Date.now() + (60000 * circuitBreaker.failureCount); // Exponential backoff
      this.emit('circuitBreakerOpen', providerId);
    }
  }

  private recordSuccess(providerId: string, request: AIRequest): void {
    const circuitBreaker = this.circuitBreakers.get(providerId);
    if (circuitBreaker) {
      circuitBreaker.failureCount = 0;
      circuitBreaker.state = 'closed';
      circuitBreaker.lastFailureTime = null;
      circuitBreaker.nextRetryTime = null;
    }
    this.emit('providerSuccess', { providerId, request });
  }

  private recordPerformance(providerId: string, duration: number, success: boolean): void {
    const history = this.performanceHistory.get(providerId) || [];
    const metric: PerformanceMetrics = {
      duration,
      success,
      timestamp: Date.now()
    };
    
    history.push(metric);
    if (history.length > 100) {
      history.shift(); // Keep only last 100 metrics
    }
    
    this.performanceHistory.set(providerId, history);
  }

  private getAveragePerformance(providerId: string): number {
    const history = this.performanceHistory.get(providerId) || [];
    if (history.length === 0) return 0.5; // Default score

    const avgDuration = history.reduce((sum, metric) => sum + metric.duration, 0) / history.length;
    const successRate = history.filter(metric => metric.success).length / history.length;
    
    // Normalize and combine metrics (lower duration = better score)
    const durationScore = Math.max(0, 1 - (avgDuration / 30000)); // 30s max
    return (durationScore + successRate) / 2;
  }

  private calculateCostScore(costPerToken: number): number {
    const maxCost = 0.001; // $0.001 per token as expensive
    return Math.max(0, 1 - (costPerToken / maxCost));
  }

  private getReliabilityScore(providerId: string): number {
    const circuitBreaker = this.circuitBreakers.get(providerId);
    if (!circuitBreaker) return 0.5;

    if (circuitBreaker.state === 'open') return 0;
    if (circuitBreaker.state === 'half-open') return 0.3;
    
    const failureRatio = circuitBreaker.failureCount / this.config.circuitBreakerThreshold;
    return Math.max(0, 1 - failureRatio);
  }

  private async validateProvider(provider: AIProvider): Promise<void> {
    if (!provider.id || !provider.apiKey || !provider.type) {
      throw new Error('Provider must have id, apiKey, and type');
    }

    try {
      await this.testProviderConnectivity(provider);
    } catch (error) {
      throw new Error(`Provider validation failed: ${error}`);
    }
  }

  private async testProviderConnectivity(provider: AIProvider): Promise<void> {
    const testRequest: AIRequest = {
      type: 'text-generation',
      content: 'Test connectivity',
      maxTokens: 10
    };

    await this.callProvider(provider, testRequest);
  }

  private async checkProviderHealth(providerId: string): Promise<HealthStatus> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { status: 'unhealthy', message: 'Provider not found' };
    }

    const circuitBreaker = this.circuitBreakers.get(providerId);
    if (circuitBreaker?.state === 'open') {
      return { status: 'unhealthy', message: 'Circuit breaker open' };
    }

    try {
      await this.testProviderConnectivity(provider);
      return { status: 'healthy', message: 'Provider operational' };
    } catch (error) {
      return { status: 'unhealthy', message: `Health check failed: ${error}` };
    }
  }

  private handleProviderError(providerId: string, error: Error): ProviderError {
    return new ProviderError(
      error.message,
      this.classifyErrorType(error),
      error
    );
  }

  private classifyErrorType(error: Error): string {
    const message = error.message.toLowerCase();
    
    if (message.includes('rate limit') || message.includes('429')) {
      return 'RATE_LIMIT_EXCEEDED';
    }
    if (message.includes('unauthorized') || message.includes('401')) {
      return 'AUTHENTICATION_FAILED';
    }
    if (message.includes('timeout')) {
      return 'TIMEOUT';
    }
    if (message.includes('quota') || message.includes('billing')) {
      return 'QUOTA_EXCEEDED';
    }
    if (message.includes('model') && message.includes('unavailable')) {
      return 'MODEL_UNAVAILABLE';
    }
    
    return 'UNKNOWN_ERROR';
  }

  private initializeHealthChecking(): void {
    this.healthCheckInterval = setInterval(async () => {
      for (const [providerId] of this.providers) {
        const health = await this.checkProviderHealth(providerId);
        this.emit('healthCheck', { providerId, health });
      }
    }, 60000); // Check every minute
  }

  async shutdown(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    this.removeAllListeners();
  }
}

export class ModelSelector {
  constructor(private providerManager: AIProviderManager) {}

  async selectForPRDParsing(documentSize: number, complexity: string): Promise<string> {
    if (documentSize > 50000 || complexity === 'high') {
      return 'claude-3-opus-20240229'; // High capability model
    } else if (documentSize > 10000 || complexity === 'medium') {
      return 'claude-3-sonnet-20240229'; // Balanced model
    } else {
      return 'claude-3-haiku-20240307'; // Fast, cost-effective model
    }
  }

  async selectForTaskGeneration(requirementCount: number, domain: string): Promise<string> {
    if (requirementCount > 50 || domain === 'enterprise') {
      return 'gpt-4-turbo'; // Complex reasoning
    } else if (requirementCount > 20) {
      return 'claude-3-sonnet-20240229'; // Good balance
    } else {
      return 'gpt-3.5-turbo'; // Quick generation
    }
  }

  async selectForComplexityAnalysis(projectType: string): Promise<string> {
    if (projectType === 'machine-learning' || projectType === 'distributed-systems') {
      return 'claude-3-opus-20240229'; // Deep analysis capability
    } else {
      return 'claude-3-sonnet-20240229'; // Standard analysis
    }
  }
}