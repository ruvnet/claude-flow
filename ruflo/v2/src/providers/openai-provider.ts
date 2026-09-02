/**
 * OpenAI Provider Implementation
 * Supports GPT-4, GPT-3.5, and other OpenAI models
 */

import { BaseProvider } from './base-provider.js';
import {
  LLMProvider,
  LLMModel,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ModelInfo,
  ProviderCapabilities,
  HealthCheckResult,
  LLMProviderError,
  RateLimitError,
  AuthenticationError,
  ModelNotFoundError,
} from './types.js';

interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'function';
    content: string;
    name?: string;
    function_call?: {
      name: string;
      arguments: string;
    };
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  functions?: Array<{
    name: string;
    description: string;
    parameters: any;
  }>;
  function_call?: 'auto' | 'none' | { name: string };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      function_call?: {
        name: string;
        arguments: string;
      };
    };
    finish_reason: 'stop' | 'length' | 'function_call' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      function_call?: {
        name?: string;
        arguments?: string;
      };
    };
    finish_reason?: string;
  }>;
}

export class OpenAIProvider extends BaseProvider {
  readonly name: LLMProvider = 'openai';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'gpt-4-turbo-preview',
      'gpt-4',
      'gpt-4-32k',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k',
    ],
    maxContextLength: {
      'gpt-4-turbo-preview': 128000,
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-3.5-turbo': 4096,
      'gpt-3.5-turbo-16k': 16384,
    } as Record<LLMModel, number>,
    maxOutputTokens: {
      'gpt-4-turbo-preview': 4096,
      'gpt-4': 4096,
      'gpt-4-32k': 4096,
      'gpt-3.5-turbo': 4096,
      'gpt-3.5-turbo-16k': 4096,
    } as Record<LLMModel, number>,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsSystemMessages: true,
    supportsVision: true, // GPT-4 with vision
    supportsAudio: false,
    supportsTools: true,
    supportsFineTuning: true,
    supportsEmbeddings: true,
    supportsLogprobs: true,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 3500,
      tokensPerMinute: 90000,
      concurrentRequests: 100,
    },
    pricing: {
      'gpt-4-turbo-preview': {
        promptCostPer1k: 0.01,
        completionCostPer1k: 0.03,
        currency: 'USD',
      },
      'gpt-4': {
        promptCostPer1k: 0.03,
        completionCostPer1k: 0.06,
        currency: 'USD',
      },
      'gpt-4-32k': {
        promptCostPer1k: 0.06,
        completionCostPer1k: 0.12,
        currency: 'USD',
      },
      'gpt-3.5-turbo': {
        promptCostPer1k: 0.0005,
        completionCostPer1k: 0.0015,
        currency: 'USD',
      },
      'gpt-3.5-turbo-16k': {
        promptCostPer1k: 0.003,
        completionCostPer1k: 0.004,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string;
  private headers: Record<string, string>;

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('OpenAI API key is required', 'openai');
    }

    this.baseUrl = this.config.apiUrl || 'https://api.openai.com/v1';
    this.headers = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };

    // Add organization header if provided
    if (this.config.providerOptions?.organization) {
      this.headers['OpenAI-Organization'] = this.config.providerOptions.organization;
    }
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const openAIRequest: OpenAIRequest = {
      model: this.mapToOpenAIModel(request.model || this.config.model),
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name && { name: msg.name }),
        ...(msg.functionCall && { function_call: msg.functionCall }),
      })),
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      top_p: request.topP ?? this.config.topP,
      frequency_penalty: request.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty: request.presencePenalty ?? this.config.presencePenalty,
      stop: request.stopSequences ?? this.config.stopSequences,
      stream: false,
    };

    // Add function calling if present
    if (request.functions) {
      openAIRequest.functions = request.functions;
      openAIRequest.function_call = request.functionCall;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(openAIRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data: OpenAIResponse = await response.json();
      const choice = data.choices[0];

      // Calculate cost
      const model = request.model || this.config.model;
      const pricing = this.capabilities.pricing![model];
      const promptCost = (data.usage.prompt_tokens / 1000) * pricing.promptCostPer1k;
      const completionCost = (data.usage.completion_tokens / 1000) * pricing.completionCostPer1k;

      return {
        id: data.id,
        model: this.mapFromOpenAIModel(data.model),
        provider: 'openai',
        content: choice.message.content || '',
        functionCall: choice.message.function_call,
        usage: {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        },
        cost: {
          promptCost,
          completionCost,
          totalCost: promptCost + completionCost,
          currency: 'USD',
        },
        finishReason: choice.finish_reason,
      };
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const openAIRequest: OpenAIRequest = {
      model: this.mapToOpenAIModel(request.model || this.config.model),
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
        ...(msg.name && { name: msg.name }),
        ...(msg.functionCall && { function_call: msg.functionCall }),
      })),
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      top_p: request.topP ?? this.config.topP,
      frequency_penalty: request.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty: request.presencePenalty ?? this.config.presencePenalty,
      stop: request.stopSequences ?? this.config.stopSequences,
      stream: true,
    };

    if (request.functions) {
      openAIRequest.functions = request.functions;
      openAIRequest.function_call = request.functionCall;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(openAIRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const totalPromptTokens = 0;
      const totalCompletionTokens = 0;

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
              const chunk: OpenAIStreamChunk = JSON.parse(data);
              const delta = chunk.choices[0].delta;

              if (delta.content) {
                yield {
                  type: 'content',
                  delta: { content: delta.content },
                };
              }

              if (delta.function_call) {
                yield {
                  type: 'function_call',
                  delta: { functionCall: delta.function_call },
                };
              }

              if (chunk.choices[0].finish_reason) {
                // Estimate tokens for streaming
                const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
                const completionTokens = Math.max(totalCompletionTokens, 100); // Minimum estimate

                const model = request.model || this.config.model;
                const pricing = this.capabilities.pricing![model];
                const promptCost = (promptTokens / 1000) * pricing.promptCostPer1k;
                const completionCost = (completionTokens / 1000) * pricing.completionCostPer1k;

                yield {
                  type: 'done',
                  usage: {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens,
                  },
                  cost: {
                    promptCost,
                    completionCost,
                    totalCost: promptCost + completionCost,
                    currency: 'USD',
                  },
                };
              }
            } catch (e) {
              this.logger.warn('Failed to parse OpenAI stream chunk', { data, error: e });
            }
          }
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<LLMModel[]> {
    return this.capabilities.supportedModels;
  }

  async getModelInfo(model: LLMModel): Promise<ModelInfo> {
    return {
      model,
      name: model,
      description: this.getModelDescription(model),
      contextLength: this.capabilities.maxContextLength[model] || 4096,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: [
        'chat',
        'completion',
        'function_calling',
        ...(model.includes('gpt-4') ? ['vision'] : []),
      ],
      pricing: this.capabilities.pricing![model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
      });

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      return {
        healthy: true,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  private mapToOpenAIModel(model: LLMModel): string {
    // Map our model names to OpenAI model names if needed
    const modelMap: Record<string, string> = {
      'gpt-4-turbo-preview': 'gpt-4-turbo-preview',
      'gpt-4': 'gpt-4',
      'gpt-4-32k': 'gpt-4-32k',
      'gpt-3.5-turbo': 'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k': 'gpt-3.5-turbo-16k',
    };
    return modelMap[model] || model;
  }

  private mapFromOpenAIModel(model: string): LLMModel {
    // Ensure the model is in our supported list
    return this.capabilities.supportedModels.find((m) => m === model) || 'gpt-3.5-turbo';
  }

  private getModelDescription(model: LLMModel): string {
    const descriptions: Record<string, string> = {
      'gpt-4-turbo-preview': 'Latest GPT-4 Turbo model with improved performance',
      'gpt-4': 'Most capable GPT-4 model for complex tasks',
      'gpt-4-32k': 'GPT-4 with extended 32k context window',
      'gpt-3.5-turbo': 'Fast and efficient model for most tasks',
      'gpt-3.5-turbo-16k': 'GPT-3.5 Turbo with extended context',
    };
    return descriptions[model] || 'OpenAI language model';
  }

  private async handleErrorResponse(response: Response): Promise<void> {
    const errorText = await response.text();
    let errorData: any;

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: { message: errorText } };
    }

    const message = errorData.error?.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message, 'openai', errorData);
      case 429:
        const retryAfter = response.headers.get('retry-after');
        throw new RateLimitError(
          message,
          'openai',
          retryAfter ? parseInt(retryAfter) : undefined,
          errorData
        );
      case 404:
        throw new ModelNotFoundError(this.config.model, 'openai', errorData);
      default:
        throw new LLMProviderError(
          message,
          `OPENAI_${response.status}`,
          'openai',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}