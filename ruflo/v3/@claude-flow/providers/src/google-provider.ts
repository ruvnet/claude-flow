/**
 * V3 Google (Gemini) Provider
 *
 * Supports Gemini 2.0, 1.5 Pro, and Flash models.
 *
 * @module @claude-flow/providers/google-provider
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

interface GeminiRequest {
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: unknown;
    }>;
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text?: string; functionCall?: { name: string; args: unknown } }>;
      role: string;
    };
    finishReason: string;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GoogleProvider extends BaseProvider {
  readonly name: LLMProvider = 'google';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'gemini-pro',
    ],
    maxContextLength: {
      'gemini-2.0-flash': 1000000,
      'gemini-1.5-pro': 2000000,
      'gemini-1.5-flash': 1000000,
      'gemini-pro': 32000,
    },
    maxOutputTokens: {
      'gemini-2.0-flash': 8192,
      'gemini-1.5-pro': 8192,
      'gemini-1.5-flash': 8192,
      'gemini-pro': 8192,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: true,
    supportsAudio: true,
    supportsFineTuning: false,
    supportsEmbeddings: true,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 1000,
      tokensPerMinute: 4000000,
      concurrentRequests: 100,
    },
    pricing: {
      'gemini-2.0-flash': {
        promptCostPer1k: 0.0,  // Free tier available
        completionCostPer1k: 0.0,
        currency: 'USD',
      },
      'gemini-1.5-pro': {
        promptCostPer1k: 0.00125,
        completionCostPer1k: 0.005,
        currency: 'USD',
      },
      'gemini-1.5-flash': {
        promptCostPer1k: 0.000075,
        completionCostPer1k: 0.0003,
        currency: 'USD',
      },
      'gemini-pro': {
        promptCostPer1k: 0.0005,
        completionCostPer1k: 0.0015,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string = 'https://generativelanguage.googleapis.com/v1beta';

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('Google API key is required', 'google');
    }

    this.baseUrl = this.config.apiUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const geminiRequest = this.buildRequest(request);
    const model = request.model || this.config.model;
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.config.apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json() as GeminiResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const geminiRequest = this.buildRequest(request);
    const model = request.model || this.config.model;
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.config.apiKey}&alt=sse`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (!data || data === '[DONE]') continue;

            try {
              const chunk: GeminiResponse = JSON.parse(data);
              const candidate = chunk.candidates?.[0];

              if (candidate?.content?.parts) {
                for (const part of candidate.content.parts) {
                  if (part.text) {
                    yield {
                      type: 'content',
                      delta: { content: part.text },
                    };
                  }
                }
              }

              if (chunk.usageMetadata) {
                totalTokens = chunk.usageMetadata.totalTokenCount;
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      // Final event
      const pricing = this.capabilities.pricing[model];
      const promptTokens = this.estimateTokens(JSON.stringify(request.messages));

      yield {
        type: 'done',
        usage: {
          promptTokens,
          completionTokens: totalTokens - promptTokens,
          totalTokens,
        },
        cost: {
          promptCost: (promptTokens / 1000) * pricing.promptCostPer1k,
          completionCost: ((totalTokens - promptTokens) / 1000) * pricing.completionCostPer1k,
          totalCost:
            (promptTokens / 1000) * pricing.promptCostPer1k +
            ((totalTokens - promptTokens) / 1000) * pricing.completionCostPer1k,
          currency: 'USD',
        },
      };
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
      'gemini-2.0-flash': 'Latest Gemini 2.0 with multimodal capabilities',
      'gemini-1.5-pro': 'Most capable Gemini model with 2M context',
      'gemini-1.5-flash': 'Fast and efficient Gemini model',
      'gemini-pro': 'Balanced Gemini model',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'Google Gemini model',
      contextLength: this.capabilities.maxContextLength[model] || 32000,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 8192,
      supportedFeatures: ['chat', 'completion', 'vision', 'audio', 'tool_calling'],
      pricing: this.capabilities.pricing[model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const url = `${this.baseUrl}/models?key=${this.config.apiKey}`;
      const response = await fetch(url);

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

  private buildRequest(request: LLMRequest): GeminiRequest {
    // Extract system message
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const otherMessages = request.messages.filter((m) => m.role !== 'system');

    // Transform messages
    const contents = otherMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
    }));

    const geminiRequest: GeminiRequest = { contents };

    if (systemMessage) {
      geminiRequest.systemInstruction = {
        parts: [{
          text: typeof systemMessage.content === 'string'
            ? systemMessage.content
            : JSON.stringify(systemMessage.content),
        }],
      };
    }

    const generationConfig: GeminiRequest['generationConfig'] = {};

    if (request.temperature !== undefined || this.config.temperature !== undefined) {
      generationConfig.temperature = request.temperature ?? this.config.temperature;
    }
    if (request.topP !== undefined || this.config.topP !== undefined) {
      generationConfig.topP = request.topP ?? this.config.topP;
    }
    if (request.topK !== undefined || this.config.topK !== undefined) {
      generationConfig.topK = request.topK ?? this.config.topK;
    }
    if (request.maxTokens || this.config.maxTokens) {
      generationConfig.maxOutputTokens = request.maxTokens || this.config.maxTokens;
    }
    if (request.stopSequences || this.config.stopSequences) {
      generationConfig.stopSequences = request.stopSequences || this.config.stopSequences;
    }

    if (Object.keys(generationConfig).length > 0) {
      geminiRequest.generationConfig = generationConfig;
    }

    if (request.tools) {
      geminiRequest.tools = [{
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        })),
      }];
    }

    return geminiRequest;
  }

  private transformResponse(data: GeminiResponse, request: LLMRequest): LLMResponse {
    const candidate = data.candidates[0];
    const model = request.model || this.config.model;
    const pricing = this.capabilities.pricing[model];

    const textParts = candidate.content.parts.filter((p) => p.text);
    const content = textParts.map((p) => p.text).join('');

    const toolCalls = candidate.content.parts
      .filter((p) => p.functionCall)
      .map((p) => ({
        id: `tool_${Date.now()}`,
        type: 'function' as const,
        function: {
          name: p.functionCall!.name,
          arguments: JSON.stringify(p.functionCall!.args),
        },
      }));

    const promptCost = (data.usageMetadata.promptTokenCount / 1000) * pricing.promptCostPer1k;
    const completionCost =
      (data.usageMetadata.candidatesTokenCount / 1000) * pricing.completionCostPer1k;

    return {
      id: `gemini-${Date.now()}`,
      model: model as LLMModel,
      provider: 'google',
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        totalTokens: data.usageMetadata.totalTokenCount,
      },
      cost: {
        promptCost,
        completionCost,
        totalCost: promptCost + completionCost,
        currency: 'USD',
      },
      finishReason: candidate.finishReason === 'STOP' ? 'stop' : 'length',
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
      case 403:
        throw new AuthenticationError(message, 'google', errorData);
      case 429:
        throw new RateLimitError(message, 'google', undefined, errorData);
      default:
        throw new LLMProviderError(
          message,
          `GOOGLE_${response.status}`,
          'google',
          response.status,
          response.status >= 500,
          errorData
        );
    }
  }
}
