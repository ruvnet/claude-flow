/**
 * V3 OpenAI Provider
 *
 * Supports GPT-4o, GPT-4, o1, and other OpenAI models.
 *
 * @module @claude-flow/providers/openai-provider
 */

import { BaseProvider, BaseProviderOptions } from './base-provider.js';
import {
  LLMProvider,
  LLMModel,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  ModelInfo,
  ProviderCapabilities,
  HealthCheckResult,
  AuthenticationError,
  RateLimitError,
  ModelNotFoundError,
  LLMProviderError,
} from './types.js';

interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
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
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseProvider {
  readonly name: LLMProvider = 'openai';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4',
      'gpt-3.5-turbo',
      'o1-preview',
      'o1-mini',
      'o3-mini',
    ],
    maxContextLength: {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16384,
      'o1-preview': 128000,
      'o1-mini': 128000,
      'o3-mini': 200000,
    },
    maxOutputTokens: {
      'gpt-4o': 16384,
      'gpt-4o-mini': 16384,
      'gpt-4-turbo': 4096,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 4096,
      'o1-preview': 32768,
      'o1-mini': 65536,
      'o3-mini': 100000,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: true,
    supportsAudio: true,
    supportsFineTuning: true,
    supportsEmbeddings: true,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 10000,
      tokensPerMinute: 2000000,
      concurrentRequests: 500,
    },
    pricing: {
      'gpt-4o': {
        promptCostPer1k: 0.0025,
        completionCostPer1k: 0.01,
        currency: 'USD',
      },
      'gpt-4o-mini': {
        promptCostPer1k: 0.00015,
        completionCostPer1k: 0.0006,
        currency: 'USD',
      },
      'gpt-4-turbo': {
        promptCostPer1k: 0.01,
        completionCostPer1k: 0.03,
        currency: 'USD',
      },
      'gpt-4': {
        promptCostPer1k: 0.03,
        completionCostPer1k: 0.06,
        currency: 'USD',
      },
      'gpt-3.5-turbo': {
        promptCostPer1k: 0.0005,
        completionCostPer1k: 0.0015,
        currency: 'USD',
      },
      'o1-preview': {
        promptCostPer1k: 0.015,
        completionCostPer1k: 0.06,
        currency: 'USD',
      },
      'o1-mini': {
        promptCostPer1k: 0.003,
        completionCostPer1k: 0.012,
        currency: 'USD',
      },
      'o3-mini': {
        promptCostPer1k: 0.0011,
        completionCostPer1k: 0.0044,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string = 'https://api.openai.com/v1';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('OpenAI API key is required', 'openai');
    }

    this.baseUrl = this.config.apiUrl || 'https://api.openai.com/v1';
    this.headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };

    if (this.config.providerOptions?.organization) {
      this.headers['OpenAI-Organization'] = this.config.providerOptions.organization as string;
    }
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const openAIRequest = this.buildRequest(request);

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

      const data = await response.json() as OpenAIResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const openAIRequest = this.buildRequest(request, true);

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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              // Estimate final usage
              const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
              const model = request.model || this.config.model;
              const baseModel = model.includes('/') ? model.split('/').pop()! : model;
              const pricing = this.capabilities.pricing[model] || this.capabilities.pricing[baseModel];
              const promptCostPer1k = pricing?.promptCostPer1k ?? 0;
              const completionCostPer1k = pricing?.completionCostPer1k ?? 0;

              yield {
                type: 'done',
                usage: {
                  promptTokens,
                  completionTokens: 100, // Estimate
                  totalTokens: promptTokens + 100,
                },
                cost: {
                  promptCost: (promptTokens / 1000) * promptCostPer1k,
                  completionCost: (100 / 1000) * completionCostPer1k,
                  totalCost:
                    (promptTokens / 1000) * promptCostPer1k +
                    (100 / 1000) * completionCostPer1k,
                  currency: 'USD',
                },
              };
              continue;
            }

            try {
              const chunk = JSON.parse(data);
              const delta = chunk.choices?.[0]?.delta;

              if (delta?.content) {
                yield {
                  type: 'content',
                  delta: { content: delta.content },
                };
              }

              if (delta?.tool_calls) {
                for (const toolCall of delta.tool_calls) {
                  yield {
                    type: 'tool_call',
                    delta: {
                      toolCall: {
                        id: toolCall.id,
                        type: 'function',
                        function: toolCall.function,
                      },
                    },
                  };
                }
              }
            } catch {
              // Ignore parse errors
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
    const descriptions: Record<string, string> = {
      'gpt-4o': 'Most capable GPT-4 model with vision and audio',
      'gpt-4o-mini': 'Affordable and intelligent small model',
      'gpt-4-turbo': 'GPT-4 Turbo with vision',
      'gpt-4': 'High capability model',
      'gpt-3.5-turbo': 'Fast and efficient model',
      'o1-preview': 'Reasoning model for complex tasks',
      'o1-mini': 'Fast reasoning model',
      'o3-mini': 'Latest reasoning model',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'OpenAI language model',
      contextLength: this.capabilities.maxContextLength[model] || 8192,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: [
        'chat',
        'completion',
        'tool_calling',
        ...(model.includes('gpt-4') ? ['vision'] : []),
      ],
      pricing: this.capabilities.pricing[model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.headers,
      });

      return {
        healthy: response.ok,
        timestamp: new Date(),
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  private buildRequest(request: LLMRequest, stream = false): OpenAIRequest {
    const openAIRequest: OpenAIRequest = {
      model: request.model || this.config.model,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        ...(msg.name && { name: msg.name }),
        ...(msg.toolCallId && { tool_call_id: msg.toolCallId }),
        ...(msg.toolCalls && { tool_calls: msg.toolCalls }),
      })),
      stream,
    };

    if (request.temperature !== undefined || this.config.temperature !== undefined) {
      openAIRequest.temperature = request.temperature ?? this.config.temperature;
    }

    if (request.maxTokens || this.config.maxTokens) {
      openAIRequest.max_tokens = request.maxTokens || this.config.maxTokens;
    }

    if (request.topP !== undefined || this.config.topP !== undefined) {
      openAIRequest.top_p = request.topP ?? this.config.topP;
    }

    if (request.frequencyPenalty !== undefined || this.config.frequencyPenalty !== undefined) {
      openAIRequest.frequency_penalty = request.frequencyPenalty ?? this.config.frequencyPenalty;
    }

    if (request.presencePenalty !== undefined || this.config.presencePenalty !== undefined) {
      openAIRequest.presence_penalty = request.presencePenalty ?? this.config.presencePenalty;
    }

    if (request.stopSequences || this.config.stopSequences) {
      openAIRequest.stop = request.stopSequences || this.config.stopSequences;
    }

    if (request.tools) {
      openAIRequest.tools = request.tools;
      openAIRequest.tool_choice = request.toolChoice;
    }

    return openAIRequest;
  }

  private transformResponse(data: OpenAIResponse, request: LLMRequest): LLMResponse {
    const choice = data.choices[0];
    const model = request.model || this.config.model;
    // Handle OpenRouter and other compatible APIs with different model naming
    const baseModel = model.includes('/') ? model.split('/').pop()! : model;
    const pricing = this.capabilities.pricing[model] || this.capabilities.pricing[baseModel];

    // Default pricing if model not found
    const promptCostPer1k = pricing?.promptCostPer1k ?? 0;
    const completionCostPer1k = pricing?.completionCostPer1k ?? 0;

    const promptCost = (data.usage.prompt_tokens / 1000) * promptCostPer1k;
    const completionCost = (data.usage.completion_tokens / 1000) * completionCostPer1k;

    return {
      id: data.id,
      model: model as LLMModel,
      provider: 'openai',
      content: choice.message.content || '',
      toolCalls: choice.message.tool_calls,
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
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const errorText = await response.text();
    let errorData: { error?: { message?: string } };

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
