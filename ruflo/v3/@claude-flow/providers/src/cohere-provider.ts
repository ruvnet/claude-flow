/**
 * V3 Cohere Provider
 *
 * Supports Command R+, Command R, and Command Light models.
 *
 * @module @claude-flow/providers/cohere-provider
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

interface CohereRequest {
  model: string;
  message: string;
  chat_history?: Array<{
    role: 'USER' | 'CHATBOT' | 'SYSTEM';
    message: string;
  }>;
  preamble?: string;
  temperature?: number;
  p?: number;
  k?: number;
  max_tokens?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: Array<{
    name: string;
    description: string;
    parameter_definitions: Record<string, unknown>;
  }>;
}

interface CohereResponse {
  response_id: string;
  text: string;
  generation_id: string;
  chat_history: Array<{ role: string; message: string }>;
  finish_reason: string;
  meta: {
    api_version: { version: string };
    billed_units: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  tool_calls?: Array<{
    name: string;
    parameters: unknown;
  }>;
}

export class CohereProvider extends BaseProvider {
  readonly name: LLMProvider = 'cohere';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'command-r-plus',
      'command-r',
      'command-light',
      'command',
    ],
    maxContextLength: {
      'command-r-plus': 128000,
      'command-r': 128000,
      'command-light': 4096,
      'command': 4096,
    },
    maxOutputTokens: {
      'command-r-plus': 4096,
      'command-r': 4096,
      'command-light': 4096,
      'command': 4096,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: false,
    supportsAudio: false,
    supportsFineTuning: true,
    supportsEmbeddings: true,
    supportsBatching: false,
    rateLimit: {
      requestsPerMinute: 1000,
      tokensPerMinute: 100000,
      concurrentRequests: 100,
    },
    pricing: {
      'command-r-plus': {
        promptCostPer1k: 0.003,
        completionCostPer1k: 0.015,
        currency: 'USD',
      },
      'command-r': {
        promptCostPer1k: 0.0005,
        completionCostPer1k: 0.0015,
        currency: 'USD',
      },
      'command-light': {
        promptCostPer1k: 0.0003,
        completionCostPer1k: 0.0006,
        currency: 'USD',
      },
      'command': {
        promptCostPer1k: 0.001,
        completionCostPer1k: 0.002,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string = 'https://api.cohere.ai/v1';
  private headers: Record<string, string> = {};

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('Cohere API key is required', 'cohere');
    }

    this.baseUrl = this.config.apiUrl || 'https://api.cohere.ai/v1';
    this.headers = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const cohereRequest = this.buildRequest(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(cohereRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json() as CohereResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const cohereRequest = this.buildRequest(request, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(cohereRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let inputTokens = 0;
      let outputTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            if (event.event_type === 'text-generation' && event.text) {
              yield {
                type: 'content',
                delta: { content: event.text },
              };
            } else if (event.event_type === 'stream-end') {
              if (event.response?.meta?.billed_units) {
                inputTokens = event.response.meta.billed_units.input_tokens;
                outputTokens = event.response.meta.billed_units.output_tokens;
              }

              const model = request.model || this.config.model;
              const pricing = this.capabilities.pricing[model];

              yield {
                type: 'done',
                usage: {
                  promptTokens: inputTokens,
                  completionTokens: outputTokens,
                  totalTokens: inputTokens + outputTokens,
                },
                cost: {
                  promptCost: (inputTokens / 1000) * pricing.promptCostPer1k,
                  completionCost: (outputTokens / 1000) * pricing.completionCostPer1k,
                  totalCost:
                    (inputTokens / 1000) * pricing.promptCostPer1k +
                    (outputTokens / 1000) * pricing.completionCostPer1k,
                  currency: 'USD',
                },
              };
            }
          } catch {
            // Ignore parse errors
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
      'command-r-plus': 'Most capable Cohere model with 128K context',
      'command-r': 'Balanced Cohere model with 128K context',
      'command-light': 'Fast and efficient Cohere model',
      'command': 'Standard Cohere model',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'Cohere language model',
      contextLength: this.capabilities.maxContextLength[model] || 4096,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: ['chat', 'completion', 'tool_calling', 'rag'],
      pricing: this.capabilities.pricing[model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/check-api-key`, {
        method: 'POST',
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

  private buildRequest(request: LLMRequest, stream = false): CohereRequest {
    // Get the last user message
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
    const systemMessage = request.messages.find((m) => m.role === 'system');

    // Build chat history (exclude last user message)
    const chatHistory = request.messages
      .filter((m) => m !== lastUserMessage && m.role !== 'system')
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'CHATBOT' as const : 'USER' as const,
        message: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      }));

    const cohereRequest: CohereRequest = {
      model: request.model || this.config.model,
      message: lastUserMessage
        ? (typeof lastUserMessage.content === 'string'
          ? lastUserMessage.content
          : JSON.stringify(lastUserMessage.content))
        : '',
      stream,
    };

    if (chatHistory.length > 0) {
      cohereRequest.chat_history = chatHistory;
    }

    if (systemMessage) {
      cohereRequest.preamble = typeof systemMessage.content === 'string'
        ? systemMessage.content
        : JSON.stringify(systemMessage.content);
    }

    if (request.temperature !== undefined || this.config.temperature !== undefined) {
      cohereRequest.temperature = request.temperature ?? this.config.temperature;
    }
    if (request.topP !== undefined || this.config.topP !== undefined) {
      cohereRequest.p = request.topP ?? this.config.topP;
    }
    if (request.topK !== undefined || this.config.topK !== undefined) {
      cohereRequest.k = request.topK ?? this.config.topK;
    }
    if (request.maxTokens || this.config.maxTokens) {
      cohereRequest.max_tokens = request.maxTokens || this.config.maxTokens;
    }
    if (request.stopSequences || this.config.stopSequences) {
      cohereRequest.stop_sequences = request.stopSequences || this.config.stopSequences;
    }

    if (request.tools) {
      cohereRequest.tools = request.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameter_definitions: tool.function.parameters.properties as Record<string, unknown>,
      }));
    }

    return cohereRequest;
  }

  private transformResponse(data: CohereResponse, request: LLMRequest): LLMResponse {
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing[model];

    const inputTokens = data.meta.billed_units.input_tokens;
    const outputTokens = data.meta.billed_units.output_tokens;

    const promptCost = (inputTokens / 1000) * pricing.promptCostPer1k;
    const completionCost = (outputTokens / 1000) * pricing.completionCostPer1k;

    const toolCalls = data.tool_calls?.map((tc) => ({
      id: `tool_${Date.now()}`,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: JSON.stringify(tc.parameters),
      },
    }));

    return {
      id: data.response_id,
      model: model as LLMModel,
      provider: 'cohere',
      content: data.text,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: 'USD',
      },
      finishReason: data.finish_reason === 'COMPLETE' ? 'stop' : 'length',
    };
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const errorText = await response.text();
    let errorData: { message?: string };

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { message: errorText };
    }

    const message = errorData.message || 'Unknown error';

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message, 'cohere', errorData);
      case 429:
        throw new RateLimitError(message, 'cohere', undefined, errorData);
      default:
        throw new LLMProviderError(
          message,
          `COHERE_${response.status}`,
          'cohere',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
