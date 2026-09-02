/**
 * Ollama Provider Implementation
 * Supports local models running via Ollama
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
  ProviderUnavailableError,
} from './types.js';

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  system?: string;
  template?: string;
  context?: number[];
  stream?: boolean;
  raw?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    top_k?: number;
    top_p?: number;
    num_predict?: number;
    stop?: string[];
    seed?: number;
    num_ctx?: number;
  };
}

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  stream?: boolean;
  format?: 'json';
  options?: OllamaGenerateRequest['options'];
}

interface OllamaResponse {
  model: string;
  created_at: string;
  response?: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

export class OllamaProvider extends BaseProvider {
  readonly name: LLMProvider = 'ollama';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'llama-2-7b',
      'llama-2-13b',
      'llama-2-70b',
      'mistral-7b',
      'mixtral-8x7b',
      'custom-model',
    ],
    maxContextLength: {
      'llama-2-7b': 4096,
      'llama-2-13b': 4096,
      'llama-2-70b': 4096,
      'mistral-7b': 8192,
      'mixtral-8x7b': 32768,
      'custom-model': 4096,
    } as Record<LLMModel, number>,
    maxOutputTokens: {
      'llama-2-7b': 2048,
      'llama-2-13b': 2048,
      'llama-2-70b': 2048,
      'mistral-7b': 4096,
      'mixtral-8x7b': 4096,
      'custom-model': 2048,
    } as Record<LLMModel, number>,
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsSystemMessages: true,
    supportsVision: false,
    supportsAudio: false,
    supportsTools: false,
    supportsFineTuning: false,
    supportsEmbeddings: true,
    supportsLogprobs: false,
    supportsBatching: false,
    pricing: {
      // Local models have no API cost
      'llama-2-7b': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'llama-2-13b': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'llama-2-70b': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'mistral-7b': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'mixtral-8x7b': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
      'custom-model': { promptCostPer1k: 0, completionCostPer1k: 0, currency: 'USD' },
    },
  };

  private baseUrl: string;
  private availableModels: Set<string> = new Set();

  protected async doInitialize(): Promise<void> {
    this.baseUrl = this.config.apiUrl || 'http://localhost:11434';
    
    // Check if Ollama is running and get available models
    try {
      await this.fetchAvailableModels();
    } catch (error) {
      this.logger.warn('Failed to fetch Ollama models, will retry on first request', error);
    }
  }

  private async fetchAvailableModels(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      
      const data = await response.json();
      this.availableModels.clear();
      
      if (data.models && Array.isArray(data.models)) {
        data.models.forEach((model: OllamaModelInfo) => {
          this.availableModels.add(model.name);
          // Map common model names
          if (model.name.includes('llama2:7b')) {
            this.availableModels.add('llama-2-7b');
          } else if (model.name.includes('llama2:13b')) {
            this.availableModels.add('llama-2-13b');
          } else if (model.name.includes('llama2:70b')) {
            this.availableModels.add('llama-2-70b');
          } else if (model.name.includes('mistral')) {
            this.availableModels.add('mistral-7b');
          } else if (model.name.includes('mixtral')) {
            this.availableModels.add('mixtral-8x7b');
          }
        });
      }
    } catch (error) {
      throw new ProviderUnavailableError('ollama', {
        message: 'Ollama service is not available',
        details: error,
      });
    }
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    // Use chat endpoint for multi-turn conversations
    const ollamaRequest: OllamaChatRequest = {
      model: this.mapToOllamaModel(request.model || this.config.model),
      messages: request.messages.map(msg => ({
        role: msg.role === 'system' ? 'system' : msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? this.config.temperature,
        top_k: request.topK ?? this.config.topK,
        top_p: request.topP ?? this.config.topP,
        num_predict: request.maxTokens ?? this.config.maxTokens,
        stop: request.stopSequences ?? this.config.stopSequences,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 120000); // Longer timeout for local models

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data: OllamaResponse = await response.json();
      
      // Calculate metrics
      const promptTokens = data.prompt_eval_count || this.estimateTokens(JSON.stringify(request.messages));
      const completionTokens = data.eval_count || this.estimateTokens(data.message?.content || '');
      const totalDuration = data.total_duration ? data.total_duration / 1000000 : 0; // Convert nanoseconds to milliseconds

      return {
        id: `ollama-${Date.now()}`,
        model: request.model || this.config.model,
        provider: 'ollama',
        content: data.message?.content || '',
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
        latency: totalDuration,
        finishReason: data.done ? 'stop' : 'length',
        metadata: {
          loadDuration: data.load_duration,
          promptEvalDuration: data.prompt_eval_duration,
          evalDuration: data.eval_duration,
        },
      };
    } catch (error) {
      clearTimeout(timeout);
      
      // Check if Ollama is running
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new ProviderUnavailableError('ollama', {
          message: 'Cannot connect to Ollama. Make sure Ollama is running on ' + this.baseUrl,
        });
      }
      
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const ollamaRequest: OllamaChatRequest = {
      model: this.mapToOllamaModel(request.model || this.config.model),
      messages: request.messages.map(msg => ({
        role: msg.role === 'system' ? 'system' : msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
      stream: true,
      options: {
        temperature: request.temperature ?? this.config.temperature,
        top_k: request.topK ?? this.config.topK,
        top_p: request.topP ?? this.config.topP,
        num_predict: request.maxTokens ?? this.config.maxTokens,
        stop: request.stopSequences ?? this.config.stopSequences,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 120000) * 2);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ollamaRequest),
        signal: controller.signal,
      });

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalContent = '';
      let promptTokens = 0;
      let completionTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          try {
            const data: OllamaResponse = JSON.parse(line);
            
            if (data.message?.content) {
              totalContent += data.message.content;
              yield {
                type: 'content',
                delta: { content: data.message.content },
              };
            }
            
            if (data.done) {
              promptTokens = data.prompt_eval_count || this.estimateTokens(JSON.stringify(request.messages));
              completionTokens = data.eval_count || this.estimateTokens(totalContent);
              
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
          } catch (e) {
            this.logger.warn('Failed to parse Ollama stream chunk', { line, error: e });
          }
        }
      }
    } catch (error) {
      clearTimeout(timeout);
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new ProviderUnavailableError('ollama', {
          message: 'Cannot connect to Ollama. Make sure Ollama is running on ' + this.baseUrl,
        });
      }
      
      throw this.transformError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async listModels(): Promise<LLMModel[]> {
    // Refresh available models
    await this.fetchAvailableModels();
    
    // Return intersection of supported models and available models
    return this.capabilities.supportedModels.filter(model => 
      this.availableModels.has(this.mapToOllamaModel(model))
    );
  }

  async getModelInfo(model: LLMModel): Promise<ModelInfo> {
    const ollamaModel = this.mapToOllamaModel(model);
    
    try {
      const response = await fetch(`${this.baseUrl}/api/show`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: ollamaModel }),
      });

      if (!response.ok) {
        throw new Error('Model not found');
      }

      const data = await response.json();
      
      return {
        model,
        name: data.name || model,
        description: data.description || this.getModelDescription(model),
        contextLength: this.capabilities.maxContextLength[model] || 4096,
        maxOutputTokens: this.capabilities.maxOutputTokens[model] || 2048,
        supportedFeatures: ['chat', 'completion'],
        pricing: this.capabilities.pricing![model],
        metadata: {
          parameterSize: data.details?.parameter_size,
          quantization: data.details?.quantization_level,
          format: data.details?.format,
        },
      };
    } catch (error) {
      // Fallback to default info
      return {
        model,
        name: model,
        description: this.getModelDescription(model),
        contextLength: this.capabilities.maxContextLength[model] || 4096,
        maxOutputTokens: this.capabilities.maxOutputTokens[model] || 2048,
        supportedFeatures: ['chat', 'completion'],
        pricing: this.capabilities.pricing![model],
      };
    }
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      return {
        healthy: true,
        timestamp: new Date(),
        details: {
          modelsAvailable: this.availableModels.size,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : 'Cannot connect to Ollama',
        timestamp: new Date(),
      };
    }
  }

  private mapToOllamaModel(model: LLMModel): string {
    const modelMap: Record<string, string> = {
      'llama-2-7b': 'llama2:7b',
      'llama-2-13b': 'llama2:13b',
      'llama-2-70b': 'llama2:70b',
      'mistral-7b': 'mistral:7b',
      'mixtral-8x7b': 'mixtral:8x7b',
      'custom-model': this.config.providerOptions?.customModel || 'llama2:latest',
    };
    return modelMap[model] || model;
  }

  private getModelDescription(model: LLMModel): string {
    const descriptions: Record<string, string> = {
      'llama-2-7b': 'Llama 2 7B - Efficient open-source model',
      'llama-2-13b': 'Llama 2 13B - Balanced performance model',
      'llama-2-70b': 'Llama 2 70B - Large open-source model',
      'mistral-7b': 'Mistral 7B - Fast and efficient model',
      'mixtral-8x7b': 'Mixtral 8x7B - Mixture of experts model',
      'custom-model': 'Custom local model',
    };
    return descriptions[model] || 'Local language model via Ollama';
  }

  private async handleErrorResponse(response: Response): Promise<void> {
    const errorText = await response.text();
    let errorData: any;

    try {
      errorData = JSON.parse(errorText);
    } catch {
      errorData = { error: errorText };
    }

    const message = errorData.error || 'Unknown error';

    throw new LLMProviderError(
      message,
      `OLLAMA_${response.status}`,
      'ollama',
      response.status,
      response.status >= 500,
      errorData
    );
  }
}