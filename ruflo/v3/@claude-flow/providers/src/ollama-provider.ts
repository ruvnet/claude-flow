/**
 * V3 Ollama Provider (Local Models)
 *
 * Supports Llama, Mistral, CodeLlama, Phi, and other local models.
 * Zero cost - runs entirely locally.
 *
 * @module @claude-flow/providers/ollama-provider
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
  ProviderUnavailableError,
  LLMProviderError,
} from './types.js';

interface OllamaRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    stop?: string[];
  };
  stream?: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: unknown };
    }>;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class OllamaProvider extends BaseProvider {
  readonly name: LLMProvider = 'ollama';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'llama3.2',
      'llama3.1',
      'mistral',
      'mixtral',
      'codellama',
      'phi-4',
      'deepseek-coder',
    ],
    maxContextLength: {
      'llama3.2': 128000,
      'llama3.1': 128000,
      'mistral': 32000,
      'mixtral': 32000,
      'codellama': 16000,
      'phi-4': 16000,
      'deepseek-coder': 16000,
    },
    maxOutputTokens: {
      'llama3.2': 8192,
      'llama3.1': 8192,
      'mistral': 8192,
      'mixtral': 8192,
      'codellama': 8192,
      'phi-4': 8192,
      'deepseek-coder': 8192,
    },
    supportsStreaming: true,
    supportsToolCalling: true,
    supportsSystemMessages: true,
    supportsVision: true, // Some models
    supportsAudio: false,
    supportsFineTuning: false,
    supportsEmbeddings: true,
    supportsBatching: false,
    rateLimit: {
      requestsPerMinute: 10000, // Local - no rate limit
      tokensPerMinute: 10000000,
      concurrentRequests: 10,
    },
    // All free - local execution
    pricing: {
      'llama3.2': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'llama3.1': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'mistral': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'mixtral': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'codellama': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'phi-4': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'deepseek-coder': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
    },
  };

  private baseUrl: string = 'http://localhost:11434';

  constructor(options: BaseProviderOptions) {
    super(options);
  }

  protected async doInitialize(): Promise<void> {
    this.baseUrl = this.config.apiUrl || 'http://localhost:11434';

    // Check if Ollama is running
    const health = await this.doHealthCheck();
    if (!health.healthy) {
      this.logger.warn('Ollama server not detected. Ensure Ollama is running locally.');
    }
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const ollamaRequest = this.buildRequest(request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 120000);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data = await response.json() as OllamaResponse;
      return this.transformResponse(data, request);
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const ollamaRequest = this.buildRequest(request, true);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 120000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let promptTokens = 0;
      let completionTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk: OllamaResponse = JSON.parse(line);

            if (chunk.message?.content) {
              yield {
                type: 'content',
                delta: { content: chunk.message.content },
              };
            }

            if (chunk.done) {
              promptTokens = chunk.prompt_eval_count || 0;
              completionTokens = chunk.eval_count || 0;

              yield {
                type: 'done',
                usage: {
                  promptTokens,
                  completionTokens,
                  totalTokens: promptTokens + completionTokens,
                },
                cost: {
                  promptCost: 0,
                  completionCost: 0,
                  totalCost: 0,
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
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return this.capabilities.supportedModels;
      }

      const data = await response.json() as { models?: Array<{ name: string }> };
      return data.models?.map((m) => m.name as LLMModel) || this.capabilities.supportedModels;
    } catch {
      return this.capabilities.supportedModels;
    }
  }

  async getModelInfo(model: LLMModel): Promise<ModelInfo> {
    const descriptions: Record<string, string> = {
      'llama3.2': 'Meta Llama 3.2 - Fast and capable',
      'llama3.1': 'Meta Llama 3.1 - High performance',
      'mistral': 'Mistral 7B - Efficient and fast',
      'mixtral': 'Mixtral 8x7B - Mixture of experts',
      'codellama': 'Code Llama - Optimized for code',
      'phi-4': 'Microsoft Phi-4 - Small but powerful',
      'deepseek-coder': 'DeepSeek Coder - Code specialist',
    };

    return {
      model,
      name: model,
      description: descriptions[model] || 'Local Ollama model',
      contextLength: this.capabilities.maxContextLength[model] || 8192,
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 4096,
      supportedFeatures: ['chat', 'completion', 'local'],
      pricing: { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);

      return {
        healthy: response.ok,
        timestamp: new Date(),
        details: {
          server: 'ollama',
          local: true,
        },
        ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Ollama server not reachable',
        timestamp: new Date(),
        details: {
          hint: 'Ensure Ollama is running: ollama serve',
        },
      };
    }
  }

  private buildRequest(request: LLMRequest, stream = false): OllamaRequest {
    const ollamaRequest: OllamaRequest = {
      model: request.model || this.config.model,
      messages: request.messages.map((msg) => ({
        role: msg.role === 'tool' ? 'assistant' : msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      })),
      stream,
    };

    const options: OllamaRequest['options'] = {};

    if (request.temperature !== undefined || this.config.temperature !== undefined) {
      options.temperature = request.temperature ?? this.config.temperature;
    }
    if (request.topP !== undefined || this.config.topP !== undefined) {
      options.top_p = request.topP ?? this.config.topP;
    }
    if (request.topK !== undefined || this.config.topK !== undefined) {
      options.top_k = request.topK ?? this.config.topK;
    }
    if (request.maxTokens || this.config.maxTokens) {
      options.num_predict = request.maxTokens || this.config.maxTokens;
    }
    if (request.stopSequences || this.config.stopSequences) {
      options.stop = request.stopSequences || this.config.stopSequences;
    }

    if (Object.keys(options).length > 0) {
      ollamaRequest.options = options;
    }

    if (request.tools) {
      ollamaRequest.tools = request.tools;
    }

    return ollamaRequest;
  }

  private transformResponse(data: OllamaResponse, request: LLMRequest): LLMResponse {
    const model = request.model || this.config.model;

    const promptTokens = data.prompt_eval_count || 0;
    const completionTokens = data.eval_count || 0;

    const toolCalls = data.message.tool_calls?.map((tc) => ({
      id: `tool_${Date.now()}`,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: JSON.stringify(tc.function.arguments),
      },
    }));

    return {
      id: `ollama-${Date.now()}`,
      model: model as LLMModel,
      provider: 'ollama',
      content: data.message.content,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      cost: {
        promptCost: 0,
        completionCost: 0,
        totalCost: 0,
        currency: 'USD',
      },
      finishReason: data.done ? 'stop' : 'length',
      latency: data.total_duration ? data.total_duration / 1e6 : undefined, // Convert ns to ms
    };
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    const errorText = await response.text();
    let errorData: { error?: string };

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: errorText };
    }

    const message = errorData.error || 'Unknown error';

    if (response.status === 0 || message.includes('connection')) {
      throw new ProviderUnavailableError('ollama', {
        message,
        hint: 'Ensure Ollama is running: ollama serve',
      });
    }

    throw new LLMProviderError(
      message,
      `OLLAMA_${response.status}`,
      'ollama',
      response.status,
      true,
      errorData
    );
  }
}
