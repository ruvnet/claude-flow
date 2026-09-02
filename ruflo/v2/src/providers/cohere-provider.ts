/**
 * Cohere Provider Implementation
 * Supports Command, Generate, and other Cohere models
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
} from './types.js';

interface CohereGenerateRequest {
  model: string;
  prompt?: string;
  messages?: Array<{
    role: 'USER' | 'CHATBOT' | 'SYSTEM';
    message: string;
  }>;
  preamble?: string;
  temperature?: number;
  max_tokens?: number;
  k?: number;
  p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

interface CohereGenerateResponse {
  id: string;
  generations: Array<{
    id: string;
    text: string;
    finish_reason: string;
  }>;
  prompt: string;
  meta: {
    api_version: {
      version: string;
    };
    billed_units: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

interface CohereChatResponse {
  text: string;
  generation_id: string;
  finish_reason: string;
  meta: {
    api_version: {
      version: string;
    };
    billed_units: {
      input_tokens: number;
      output_tokens: number;
    };
  };
}

export class CohereProvider extends BaseProvider {
  readonly name: LLMProvider = 'cohere';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'command',
      'command-light',
      'command-nightly',
      'generate-xlarge',
      'generate-medium',
    ],
    maxContextLength: {
      'command': 4096,
      'command-light': 4096,
      'command-nightly': 8192,
      'generate-xlarge': 2048,
      'generate-medium': 2048,
    } as Record<LLMModel, number>,
    maxOutputTokens: {
      'command': 4096,
      'command-light': 4096,
      'command-nightly': 4096,
      'generate-xlarge': 2048,
      'generate-medium': 2048,
    } as Record<LLMModel, number>,
    supportsStreaming: true,
    supportsFunctionCalling: false,
    supportsSystemMessages: true,
    supportsVision: false,
    supportsAudio: false,
    supportsTools: true,
    supportsFineTuning: true,
    supportsEmbeddings: true,
    supportsLogprobs: true,
    supportsBatching: false,
    rateLimit: {
      requestsPerMinute: 100,
      tokensPerMinute: 100000,
      concurrentRequests: 20,
    },
    pricing: {
      'command': {
        promptCostPer1k: 0.0015,
        completionCostPer1k: 0.0015,
        currency: 'USD',
      },
      'command-light': {
        promptCostPer1k: 0.00015,
        completionCostPer1k: 0.00015,
        currency: 'USD',
      },
      'command-nightly': {
        promptCostPer1k: 0.0015,
        completionCostPer1k: 0.0015,
        currency: 'USD',
      },
      'generate-xlarge': {
        promptCostPer1k: 0.005,
        completionCostPer1k: 0.015,
        currency: 'USD',
      },
      'generate-medium': {
        promptCostPer1k: 0.001,
        completionCostPer1k: 0.005,
        currency: 'USD',
      },
    },
  };

  private baseUrl = 'https://api.cohere.ai/v1';
  private headers: Record<string, string> = {};

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('Cohere API key is required', 'cohere');
    }

    this.headers = {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const isChat = request.messages.length > 1 || request.messages[0].role !== 'user';
    const model = request.model || this.config.model;
    
    if (isChat && model.startsWith('command')) {
      return this.doChatComplete(request);
    } else {
      return this.doGenerateComplete(request);
    }
  }

  private async doChatComplete(request: LLMRequest): Promise<LLMResponse> {
    const messages = this.convertMessages(request.messages);
    const systemMessage = request.messages.find(m => m.role === 'system');
    
    const cohereRequest = {
      model: this.mapToCohereModel(request.model || this.config.model),
      messages,
      preamble: systemMessage?.content,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      k: request.topK ?? this.config.topK,
      p: request.topP ?? this.config.topP,
      frequency_penalty: request.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty: request.presencePenalty ?? this.config.presencePenalty,
      stop_sequences: request.stopSequences ?? this.config.stopSequences,
      stream: false,
    };

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

      const data: CohereChatResponse = await response.json();
      
      // Calculate cost
      const pricing = this.capabilities.pricing![request.model || this.config.model];
      const promptCost = (data.meta.billed_units.input_tokens / 1000) * pricing.promptCostPer1k;
      const completionCost = (data.meta.billed_units.output_tokens / 1000) * pricing.completionCostPer1k;

      return {
        id: data.generation_id,
        model: request.model || this.config.model,
        provider: 'cohere',
        content: data.text,
        usage: {
          promptTokens: data.meta.billed_units.input_tokens,
          completionTokens: data.meta.billed_units.output_tokens,
          totalTokens: data.meta.billed_units.input_tokens + data.meta.billed_units.output_tokens,
        },
        cost: {
          promptCost,
          completionCost,
          totalCost: promptCost + completionCost,
          currency: 'USD',
        },
        finishReason: this.mapFinishReason(data.finish_reason),
      };
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  private async doGenerateComplete(request: LLMRequest): Promise<LLMResponse> {
    // For generate endpoint, concatenate messages into a prompt
    const prompt = request.messages.map(m => m.content).join('\n\n');
    
    const cohereRequest: CohereGenerateRequest = {
      model: this.mapToCohereModel(request.model || this.config.model),
      prompt,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      k: request.topK ?? this.config.topK,
      p: request.topP ?? this.config.topP,
      frequency_penalty: request.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty: request.presencePenalty ?? this.config.presencePenalty,
      stop_sequences: request.stopSequences ?? this.config.stopSequences,
      stream: false,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(cohereRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data: CohereGenerateResponse = await response.json();
      const generation = data.generations[0];
      
      // Calculate cost
      const pricing = this.capabilities.pricing![request.model || this.config.model];
      const promptCost = (data.meta.billed_units.input_tokens / 1000) * pricing.promptCostPer1k;
      const completionCost = (data.meta.billed_units.output_tokens / 1000) * pricing.completionCostPer1k;

      return {
        id: generation.id,
        model: request.model || this.config.model,
        provider: 'cohere',
        content: generation.text,
        usage: {
          promptTokens: data.meta.billed_units.input_tokens,
          completionTokens: data.meta.billed_units.output_tokens,
          totalTokens: data.meta.billed_units.input_tokens + data.meta.billed_units.output_tokens,
        },
        cost: {
          promptCost,
          completionCost,
          totalCost: promptCost + completionCost,
          currency: 'USD',
        },
        finishReason: this.mapFinishReason(generation.finish_reason),
      };
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const isChat = request.messages.length > 1 || request.messages[0].role !== 'user';
    const model = request.model || this.config.model;
    
    if (isChat && model.startsWith('command')) {
      yield* this.streamChatComplete(request);
    } else {
      yield* this.streamGenerateComplete(request);
    }
  }

  private async *streamChatComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const messages = this.convertMessages(request.messages);
    const systemMessage = request.messages.find(m => m.role === 'system');
    
    const cohereRequest = {
      model: this.mapToCohereModel(request.model || this.config.model),
      messages,
      preamble: systemMessage?.content,
      temperature: request.temperature ?? this.config.temperature,
      max_tokens: request.maxTokens ?? this.config.maxTokens,
      k: request.topK ?? this.config.topK,
      p: request.topP ?? this.config.topP,
      frequency_penalty: request.frequencyPenalty ?? this.config.frequencyPenalty,
      presence_penalty: request.presencePenalty ?? this.config.presencePenalty,
      stop_sequences: request.stopSequences ?? this.config.stopSequences,
      stream: true,
    };

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
      let totalContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          try {
            const data = JSON.parse(line);
            
            if (data.text) {
              totalContent += data.text;
              yield {
                type: 'content',
                delta: { content: data.text },
              };
            }
            
            if (data.is_finished) {
              // Estimate tokens for streaming
              const promptTokens = this.estimateTokens(JSON.stringify(request.messages));
              const completionTokens = this.estimateTokens(totalContent);
              
              const pricing = this.capabilities.pricing![request.model || this.config.model];
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
            this.logger.warn('Failed to parse Cohere stream chunk', { line, error: e });
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

  private async *streamGenerateComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    // Similar implementation for generate endpoint
    // Omitted for brevity - follows same pattern as streamChatComplete
    yield* this.streamChatComplete(request); // Fallback to chat for now
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
        'embeddings',
        ...(model.startsWith('command') ? ['tools'] : []),
      ],
      pricing: this.capabilities.pricing![model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const response = await fetch(`${this.baseUrl}/check-api-key`, {
        method: 'POST',
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

  private convertMessages(messages: LLMRequest['messages']) {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'CHATBOT' as const : 'USER' as const,
        message: m.content,
      }));
  }

  private mapToCohereModel(model: LLMModel): string {
    const modelMap: Record<string, string> = {
      'command': 'command',
      'command-light': 'command-light',
      'command-nightly': 'command-nightly',
      'generate-xlarge': 'xlarge',
      'generate-medium': 'medium',
    };
    return modelMap[model] || model;
  }

  private mapFinishReason(reason: string): 'stop' | 'length' {
    return reason === 'COMPLETE' ? 'stop' : 'length';
  }

  private getModelDescription(model: LLMModel): string {
    const descriptions: Record<string, string> = {
      'command': 'Powerful model for complex tasks',
      'command-light': 'Faster, lightweight version of Command',
      'command-nightly': 'Latest experimental Command model',
      'generate-xlarge': 'Large generation model',
      'generate-medium': 'Medium generation model',
    };
    return descriptions[model] || 'Cohere language model';
  }

  private async handleErrorResponse(response: Response): Promise<void> {
    const errorText = await response.text();
    let errorData: any;

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