/**
 * V3 Anthropic (Claude) Provider
 *
 * Supports Claude 3.5, 3 Opus, Sonnet, and Haiku models.
 *
 * @module @claude-flow/providers/anthropic-provider
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
  LLMProviderError,
} from './types.js';

interface AnthropicRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; source?: unknown }>;
  }>;
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }>;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider extends BaseProvider {
  readonly name: LLMProvider = 'anthropic';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'claude-3-5-sonnet-20241022',
      'claude-3-5-sonnet-latest',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
    ],
    maxContextLength: {
      'claude-3-5-sonnet-20241022': 200000,
      'claude-3-5-sonnet-latest': 200000,
      'claude-3-opus-20240229': 200000,
      'claude-3-sonnet-20240229': 200000,
      'claude-3-haiku-20240307': 200000,
    },
    maxOutputTokens: {
      'claude-3-5-sonnet-20241022': 8192,
      'claude-3-5-sonnet-latest': 8192,
      'claude-3-opus-20240229': 4096,
      'claude-3-sonnet-20240229': 4096,
      'claude-3-haiku-20240307': 4096,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: true,
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: false,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 1000,
      tokensPerMinute: 100000,
      concurrentRequests: 100,
    },
    pricing: {
      'claude-3-5-sonnet-20241022': {
        promptCostPer1k: 0.003,
        completionCostPer1k: 0.015,
        currency: 'USD',
      },
      'claude-3-5-sonnet-latest': {
        promptCostPer1k: 0.003,
        completionCostPer1k: 0.015,
        currency: 'USD',
      },
      'claude-3-opus-20240229': {
        promptCostPer1k: 0.015,
        completionCostPer1k: 0.075,
        currency: 'USD',
      },
      'claude-3-sonnet-20240229': {
        promptCostPer1k: 0.003,
        completionCostPer1k: 0.015,
        currency: 'USD',
      },
      'claude-3-haiku-20240307': {
        promptCostPer1k: 0.00025,
        completionCostPer1k: 0.00125,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string = 'https://api.anthropic.com/v1';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('Anthropic API key is required', 'anthropic');
    }

    this.baseUrl = this.config.apiUrl || 'https://api.anthropic.com/v1';
    this.headers = {
      'x-api-key': this.config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const anthropicRequest = this.buildRequest(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(anthropicRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json() as AnthropicResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const anthropicRequest = this.buildRequest(request, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(anthropicRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalOutputTokens = 0;
      let inputTokens = 0;

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
              const event = JSON.parse(data);

              if (event.type === 'content_block_delta' && event.delta?.text) {
                yield {
                  type: 'content',
                  delta: { content: event.delta.text },
                };
              } else if (event.type === 'message_delta' && event.usage) {
                totalOutputTokens = event.usage.output_tokens;
              } else if (event.type === 'message_start' && event.message?.usage) {
                inputTokens = event.message.usage.input_tokens;
              } else if (event.type === 'message_stop') {
                const model = request.model || this.config.model;
                const pricing = this.capabilities.pricing[model];

                const promptCost = (inputTokens / 1000) * pricing.promptCostPer1k;
                const completionCost = (totalOutputTokens / 1000) * pricing.completionCostPer1k;

                yield {
                  type: 'done',
                  usage: {
                    promptTokens: inputTokens,
                    completionTokens: totalOutputTokens,
                    totalTokens: inputTokens + totalOutputTokens,
                  },
                  cost: {
                    promptCost,
                    completionCost,
                    totalCost: promptCost + completionCost,
                    currency: 'USD',
                  },
                };
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
      'claude-3-5-sonnet-20241022': 'Latest Claude 3.5 Sonnet - Best balance of intelligence and speed',
      'claude-3-5-sonnet-latest': 'Claude 3.5 Sonnet latest version',
      'claude-3-opus-20240229': 'Most capable Claude model for complex tasks',
      'claude-3-sonnet-20240229': 'Balanced Claude 3 model',
      'claude-3-haiku-20240307': 'Fastest Claude 3 model for simple tasks',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'Anthropic Claude model',
      contextLength: this.capabilities.maxContextLength[model] || 200000,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: ['chat', 'completion', 'vision', 'tool_calling'],
      pricing: this.capabilities.pricing[model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      // Use a minimal request to check API availability
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
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

  private buildRequest(request: LLMRequest, stream = false): AnthropicRequest {
    // Extract system message
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    // Transform messages
    const messages = otherMessages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    }));

    const anthropicRequest: AnthropicRequest = {
      model: request.model || this.config.model,
      messages,
      max_tokens: request.maxTokens || this.config.maxTokens || 4096,
      stream,
    };

    if (systemMessage) {
      anthropicRequest.system = typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content);
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    } else if (this.config.temperature !== undefined) {
      anthropicRequest.temperature = this.config.temperature;
    }

    if (request.topP !== undefined || this.config.topP !== undefined) {
      anthropicRequest.top_p = request.topP ?? this.config.topP;
    }

    if (request.topK !== undefined || this.config.topK !== undefined) {
      anthropicRequest.top_k = request.topK ?? this.config.topK;
    }

    if (request.stopSequences || this.config.stopSequences) {
      anthropicRequest.stop_sequences = request.stopSequences || this.config.stopSequences;
    }

    // Add tools if present
    if (request.tools) {
      anthropicRequest.tools = request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));
    }

    return anthropicRequest;
  }

  private transformResponse(data: AnthropicResponse, request: LLMRequest): LLMResponse {
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing[model];

    const promptCost = (data.usage.input_tokens / 1000) * pricing.promptCostPer1k;
    const completionCost = (data.usage.output_tokens / 1000) * pricing.completionCostPer1k;

    // Extract text content
    const textContent = data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    // Extract tool calls
    const toolCalls = data.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({
        id: `tool_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: c.name || '',
          arguments: JSON.stringify(c.input || {}),
        },
      }));

    return {
      id: data.id,
      model: model as LLMModel,
      provider: 'anthropic',
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: 'USD',
      },
      finishReason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
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
        throw new AuthenticationError(message, 'anthropic', errorData);
      case 429:
        throw new RateLimitError(message, 'anthropic', undefined, errorData);
      default:
        throw new LLMProviderError(
          message,
          `ANTHROPIC_${response.status}`,
          'anthropic',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
