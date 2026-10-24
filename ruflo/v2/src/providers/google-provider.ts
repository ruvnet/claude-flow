/**
 * Google AI Provider Implementation
 * Supports Gemini Pro, PaLM, and other Google models
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

interface GoogleAIRequest {
  contents: Array<{
    role: 'user' | 'model';
    parts: Array<{
      text?: string;
      inlineData?: {
        mimeType: string;
        data: string;
      };
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
  };
  safetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
}

interface GoogleAIResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
      role: string;
    };
    finishReason: string;
    index: number;
    safetyRatings: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  promptFeedback?: {
    safetyRatings: Array<{
      category: string;
      probability: string;
    }>;
  };
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GoogleProvider extends BaseProvider {
  readonly name: LLMProvider = 'google';
  readonly capabilities: ProviderCapabilities = {
    supportedModels: [
      'gemini-pro',
      'gemini-pro-vision',
      'palm-2',
      'bison',
    ],
    maxContextLength: {
      'gemini-pro': 32768,
      'gemini-pro-vision': 16384,
      'palm-2': 8192,
      'bison': 4096,
    } as Record<LLMModel, number>,
    maxOutputTokens: {
      'gemini-pro': 2048,
      'gemini-pro-vision': 2048,
      'palm-2': 1024,
      'bison': 1024,
    } as Record<LLMModel, number>,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsSystemMessages: false, // Google AI doesn't have explicit system messages
    supportsVision: true, // Gemini Pro Vision
    supportsAudio: false,
    supportsTools: true,
    supportsFineTuning: false,
    supportsEmbeddings: true,
    supportsLogprobs: false,
    supportsBatching: true,
    rateLimit: {
      requestsPerMinute: 60,
      tokensPerMinute: 60000,
      concurrentRequests: 10,
    },
    pricing: {
      'gemini-pro': {
        promptCostPer1k: 0.00025,
        completionCostPer1k: 0.0005,
        currency: 'USD',
      },
      'gemini-pro-vision': {
        promptCostPer1k: 0.00025,
        completionCostPer1k: 0.0005,
        currency: 'USD',
      },
      'palm-2': {
        promptCostPer1k: 0.0005,
        completionCostPer1k: 0.001,
        currency: 'USD',
      },
      'bison': {
        promptCostPer1k: 0.0005,
        completionCostPer1k: 0.001,
        currency: 'USD',
      },
    },
  };

  private baseUrl: string;

  protected async doInitialize(): Promise<void> {
    if (!this.config.apiKey) {
      throw new AuthenticationError('Google AI API key is required', 'google');
    }

    // Use Gemini API for newer models, PaLM API for older ones
    const model = this.config.model;
    if (model.startsWith('gemini')) {
      this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    } else {
      this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta2';
    }
  }

  protected async doComplete(request: LLMRequest): Promise<LLMResponse> {
    const googleRequest = this.buildGoogleRequest(request);
    const model = this.mapToGoogleModel(request.model || this.config.model);
    
    const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.config.apiKey}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeout || 60000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(googleRequest),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        await this.handleErrorResponse(response);
      }

      const data: GoogleAIResponse = await response.json();
      
      if (!data.candidates || data.candidates.length === 0) {
        throw new LLMProviderError(
          'No response generated',
          'NO_RESPONSE',
          'google',
          undefined,
          false
        );
      }

      const candidate = data.candidates[0];
      const content = candidate.content.parts.map(part => part.text).join('');
      
      // Calculate cost
      const usageData = data.usageMetadata || {
        promptTokenCount: this.estimateTokens(JSON.stringify(request.messages)),
        candidatesTokenCount: this.estimateTokens(content),
        totalTokenCount: 0,
      };
      usageData.totalTokenCount = usageData.promptTokenCount + usageData.candidatesTokenCount;

      const pricing = this.capabilities.pricing![request.model || this.config.model];
      const promptCost = (usageData.promptTokenCount / 1000) * pricing.promptCostPer1k;
      const completionCost = (usageData.candidatesTokenCount / 1000) * pricing.completionCostPer1k;

      return {
        id: `google-${Date.now()}`,
        model: request.model || this.config.model,
        provider: 'google',
        content,
        usage: {
          promptTokens: usageData.promptTokenCount,
          completionTokens: usageData.candidatesTokenCount,
          totalTokens: usageData.totalTokenCount,
        },
        cost: {
          promptCost,
          completionCost,
          totalCost: promptCost + completionCost,
          currency: 'USD',
        },
        finishReason: this.mapFinishReason(candidate.finishReason),
      };
    } catch (error) {
      clearTimeout(timeout);
      throw this.transformError(error);
    }
  }

  protected async *doStreamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const googleRequest = this.buildGoogleRequest(request);
    const model = this.mapToGoogleModel(request.model || this.config.model);
    
    const url = `${this.baseUrl}/models/${model}:streamGenerateContent?key=${this.config.apiKey}`;
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (this.config.timeout || 60000) * 2);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(googleRequest),
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
            const data: GoogleAIResponse = JSON.parse(line);
            
            if (data.candidates && data.candidates.length > 0) {
              const candidate = data.candidates[0];
              const content = candidate.content.parts.map(part => part.text).join('');
              
              if (content) {
                totalContent += content;
                yield {
                  type: 'content',
                  delta: { content },
                };
              }
              
              if (data.usageMetadata) {
                promptTokens = data.usageMetadata.promptTokenCount;
                completionTokens = data.usageMetadata.candidatesTokenCount;
              }
            }
          } catch (e) {
            this.logger.warn('Failed to parse Google AI stream chunk', { line, error: e });
          }
        }
      }

      // Final event with usage and cost
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
      maxOutputTokens: this.capabilities.maxOutputTokens[model] || 2048,
      supportedFeatures: [
        'chat',
        'completion',
        ...(model.includes('vision') ? ['vision'] : []),
        ...(model.startsWith('gemini') ? ['function_calling'] : []),
      ],
      pricing: this.capabilities.pricing![model],
    };
  }

  protected async doHealthCheck(): Promise<HealthCheckResult> {
    try {
      const url = `${this.baseUrl}/models?key=${this.config.apiKey}`;
      const response = await fetch(url);

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

  private buildGoogleRequest(request: LLMRequest): GoogleAIRequest {
    // Convert messages to Google format
    const contents: GoogleAIRequest['contents'] = [];
    
    for (const message of request.messages) {
      // Skip system messages or prepend to first user message
      if (message.role === 'system') {
        if (contents.length === 0) {
          contents.push({
            role: 'user',
            parts: [{ text: `Instructions: ${message.content}` }],
          });
        }
        continue;
      }
      
      contents.push({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      });
    }

    return {
      contents,
      generationConfig: {
        temperature: request.temperature ?? this.config.temperature,
        topK: request.topK ?? this.config.topK,
        topP: request.topP ?? this.config.topP,
        maxOutputTokens: request.maxTokens ?? this.config.maxTokens,
        stopSequences: request.stopSequences ?? this.config.stopSequences,
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE',
        },
      ],
    };
  }

  private mapToGoogleModel(model: LLMModel): string {
    const modelMap: Record<string, string> = {
      'gemini-pro': 'gemini-pro',
      'gemini-pro-vision': 'gemini-pro-vision',
      'palm-2': 'text-bison-001',
      'bison': 'text-bison-001',
    };
    return modelMap[model] || model;
  }

  private mapFinishReason(reason: string): 'stop' | 'length' | 'content_filter' {
    switch (reason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  private getModelDescription(model: LLMModel): string {
    const descriptions: Record<string, string> = {
      'gemini-pro': 'Google\'s most capable text model',
      'gemini-pro-vision': 'Gemini Pro with vision capabilities',
      'palm-2': 'Previous generation large language model',
      'bison': 'Efficient model for various tasks',
    };
    return descriptions[model] || 'Google AI language model';
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