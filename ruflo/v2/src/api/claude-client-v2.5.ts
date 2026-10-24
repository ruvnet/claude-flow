/**
 * Claude Client v2.5 - SDK-Based Implementation
 * Claude-Flow v2.5-alpha.130
 *
 * Refactored to use Anthropic SDK instead of custom retry/error handling
 */

import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudeFlowSDKAdapter } from '../sdk/sdk-config.js';
import { SDKCompatibilityLayer } from '../sdk/compatibility-layer.js';
import { ILogger } from '../core/logger.js';
import {
  ClaudeAPIError,
  ClaudeRateLimitError,
  ClaudeAuthenticationError,
  ClaudeValidationError,
} from './claude-api-errors.js';

export interface ClaudeAPIConfig {
  apiKey: string;
  apiUrl?: string;
  model?: ClaudeModel;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  systemPrompt?: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableSwarmMode?: boolean;
}

export type ClaudeModel =
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307'
  | 'claude-2.1'
  | 'claude-2.0'
  | 'claude-instant-1.2';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeRequest {
  model: ClaudeModel;
  messages: ClaudeMessage[];
  system?: string;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  metadata?: {
    user_id?: string;
  };
  stop_sequences?: string[];
  stream?: boolean;
}

export interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: ClaudeModel;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence';
  stop_sequence?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Claude Client v2.5 using Anthropic SDK
 */
export class ClaudeClientV25 extends EventEmitter {
  private adapter: ClaudeFlowSDKAdapter;
  private compatibility: SDKCompatibilityLayer;
  private sdk: Anthropic;
  private config: ClaudeAPIConfig;
  private logger?: ILogger;

  constructor(config: ClaudeAPIConfig, logger?: ILogger) {
    super();
    this.config = config;
    this.logger = logger;

    // Initialize SDK adapter
    this.adapter = new ClaudeFlowSDKAdapter({
      apiKey: config.apiKey,
      maxRetries: config.retryAttempts || 3,
      timeout: config.timeout || 60000,
      swarmMode: config.enableSwarmMode,
      baseURL: config.apiUrl
    });

    this.sdk = this.adapter.getSDK();
    this.compatibility = new SDKCompatibilityLayer(this.adapter);

    this.logger?.info('Claude Client v2.5 initialized with SDK', {
      model: config.model,
      swarmMode: config.enableSwarmMode
    });
  }

  /**
   * Main request method using SDK
   */
  async makeRequest(request: ClaudeRequest): Promise<ClaudeResponse> {
    try {
      this.emit('request:start', request);

      // Convert to SDK format
      const sdkParams: Anthropic.MessageCreateParams = {
        model: request.model as Anthropic.Model,
        messages: request.messages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })),
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        top_k: request.top_k,
        system: request.system,
        stop_sequences: request.stop_sequences,
        metadata: request.metadata as Anthropic.Metadata | undefined
      };

      // SDK handles retry automatically
      const response = await this.adapter.createMessage(sdkParams);

      // Convert SDK response to legacy format for compatibility
      const legacyResponse = this.convertSDKResponse(response);

      this.emit('request:success', legacyResponse);
      this.logger?.info('Request successful', {
        model: request.model,
        tokensUsed: response.usage
      });

      return legacyResponse;

    } catch (error) {
      this.handleSDKError(error);
      throw error;
    }
  }

  /**
   * Streaming request using SDK
   */
  async makeStreamingRequest(
    request: ClaudeRequest,
    onChunk?: (chunk: Anthropic.MessageStreamEvent) => void
  ): Promise<ClaudeResponse> {
    try {
      this.emit('stream:start', request);

      const sdkParams: Anthropic.MessageCreateParams = {
        model: request.model as Anthropic.Model,
        messages: request.messages.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })),
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        system: request.system,
        stream: true
      };

      const response = await this.adapter.createStreamingMessage(
        sdkParams,
        {
          onChunk: (chunk) => {
            this.emit('stream:chunk', chunk);
            onChunk?.(chunk);
          }
        }
      );

      const legacyResponse = this.convertSDKResponse(response);
      this.emit('stream:complete', legacyResponse);

      return legacyResponse;

    } catch (error) {
      this.handleSDKError(error);
      throw error;
    }
  }

  /**
   * DEPRECATED: Legacy method for backward compatibility
   * SDK handles retry automatically
   */
  async executeWithRetry(request: ClaudeRequest): Promise<ClaudeResponse> {
    console.warn('[ClaudeClientV25] executeWithRetry is deprecated. SDK handles retry automatically.');
    return this.makeRequest(request);
  }

  /**
   * Convert SDK response to legacy format
   */
  private convertSDKResponse(sdkResponse: Anthropic.Message): ClaudeResponse {
    return {
      id: sdkResponse.id,
      type: 'message',
      role: 'assistant',
      content: sdkResponse.content.map((block) => ({
        type: block.type,
        text: block.type === 'text' ? block.text : ''
      })),
      model: sdkResponse.model as ClaudeModel,
      stop_reason: (sdkResponse.stop_reason || 'end_turn') as 'end_turn' | 'max_tokens' | 'stop_sequence',
      stop_sequence: sdkResponse.stop_sequence || undefined,
      usage: {
        input_tokens: sdkResponse.usage.input_tokens,
        output_tokens: sdkResponse.usage.output_tokens
      }
    };
  }

  /**
   * Handle SDK-specific errors
   */
  private handleSDKError(error: unknown): void {
    this.emit('request:error', error);

    let mappedError: ClaudeAPIError;

    if (error instanceof Anthropic.APIError) {
      if (error instanceof Anthropic.AuthenticationError) {
        mappedError = new ClaudeAuthenticationError('Invalid API key');
      } else if (error instanceof Anthropic.RateLimitError) {
        mappedError = new ClaudeRateLimitError('Rate limit exceeded');
      } else if (error instanceof Anthropic.BadRequestError) {
        mappedError = new ClaudeValidationError(error.message);
      } else {
        mappedError = new ClaudeAPIError(error.message, error.status || 500);
      }
    } else {
      mappedError = new ClaudeAPIError(
        error.message || 'Unknown error',
        500
      );
    }

    this.logger?.error('SDK request failed', {
      error: mappedError.message,
      status: mappedError.status
    });

    throw mappedError;
  }

  /**
   * Validate configuration
   */
  async validateConfiguration(): Promise<boolean> {
    return this.adapter.validateConfiguration();
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): { totalTokens: number; messageCount: number } {
    return this.adapter.getUsageStats();
  }

  /**
   * Get swarm metadata (if in swarm mode)
   */
  getSwarmMetadata(messageId: string): Record<string, unknown> | null {
    if (this.config.enableSwarmMode) {
      return this.adapter.getSwarmMetadata(messageId);
    }
    return null;
  }

  /**
   * Check health status
   */
  async checkHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, unknown>;
  }> {
    try {
      const isValid = await this.validateConfiguration();

      if (isValid) {
        return {
          status: 'healthy',
          details: {
            sdkVersion: '2.5.0',
            model: this.config.model,
            swarmMode: this.config.enableSwarmMode
          }
        };
      }

      return {
        status: 'unhealthy',
        details: { error: 'Invalid configuration' }
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      };
    }
  }

  /**
   * Get deprecation warnings
   */
  getDeprecationWarnings(): string[] {
    return this.compatibility.getDeprecationReport();
  }
}

// Export for backward compatibility
export { ClaudeClientV25 as ClaudeClient };