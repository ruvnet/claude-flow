/**
 * Claude Agent SDK Configuration Adapter
 * Claude-Flow v2.5-alpha.130
 *
 * This module provides the configuration adapter for integrating
 * the Anthropic SDK as the foundation layer for Claude-Flow.
 */

import Anthropic from '@anthropic-ai/sdk';

export interface SDKConfiguration {
  apiKey?: string;
  baseURL?: string;
  maxRetries?: number;
  timeout?: number;
  defaultHeaders?: Record<string, string>;

  // Claude-Flow specific extensions
  swarmMode?: boolean;
  persistenceEnabled?: boolean;
  checkpointInterval?: number;
  memoryNamespace?: string;
}

/**
 * Claude-Flow SDK Adapter
 * Wraps the Anthropic SDK with Claude-Flow extensions
 */
export class ClaudeFlowSDKAdapter {
  private sdk: Anthropic;
  private config: SDKConfiguration;
  private swarmMetadata: Map<string, Record<string, unknown>> = new Map();

  constructor(config: SDKConfiguration = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries || 3,
      timeout: config.timeout || 60000,
      defaultHeaders: config.defaultHeaders || {},
      swarmMode: config.swarmMode !== false,
      persistenceEnabled: config.persistenceEnabled !== false,
      checkpointInterval: config.checkpointInterval || 60000,
      memoryNamespace: config.memoryNamespace || 'claude-flow'
    };

    // Initialize Anthropic SDK with configuration
    this.sdk = new Anthropic({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout,
      defaultHeaders: this.config.defaultHeaders
    });
  }

  /**
   * Get the underlying Anthropic SDK instance
   */
  getSDK(): Anthropic {
    return this.sdk;
  }

  /**
   * Get the current configuration
   */
  getConfig(): SDKConfiguration {
    return { ...this.config };
  }

  /**
   * Create a message with automatic retry handling
   */
  async createMessage(params: Anthropic.MessageCreateParams): Promise<Anthropic.Message> {
    try {
      // SDK handles retry automatically based on configuration
      const message = await this.sdk.messages.create(params);

      // Store in swarm metadata if in swarm mode
      if (this.config.swarmMode && message.id) {
        this.swarmMetadata.set(message.id, {
          timestamp: Date.now(),
          model: params.model,
          tokensUsed: message.usage
        });
      }

      return message;
    } catch (error) {
      // Enhanced error handling for swarm mode
      if (this.config.swarmMode) {
        console.error('[SDK] Message creation failed in swarm mode:', error);
        this.logSwarmError(error);
      }
      throw error;
    }
  }

  /**
   * Create a streaming message
   */
  async createStreamingMessage(
    params: Anthropic.MessageCreateParams,
    options?: { onChunk?: (chunk: any) => void }
  ): Promise<Anthropic.Message> {
    const stream = await this.sdk.messages.create({
      ...params,
      stream: true
    });

    let fullMessage: Partial<Anthropic.Message> = {};

    for await (const chunk of stream) {
      if (options?.onChunk) {
        options.onChunk(chunk);
      }

      // Accumulate the message
      if (chunk.type === 'message_start') {
        fullMessage = chunk.message;
      } else if (chunk.type === 'content_block_delta') {
        // Handle content updates
      } else if (chunk.type === 'message_delta') {
        // Handle message updates
        if (chunk.delta?.stop_reason) {
          fullMessage.stop_reason = chunk.delta.stop_reason;
        }
      }
    }

    return fullMessage as Anthropic.Message;
  }

  /**
   * Check if the SDK is properly configured
   */
  async validateConfiguration(): Promise<boolean> {
    try {
      // Test the configuration with a minimal request
      await this.sdk.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }]
      });
      return true;
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        console.error('[SDK] Invalid API key');
        return false;
      }
      if (error instanceof Anthropic.RateLimitError) {
        console.warn('[SDK] Rate limit reached but configuration is valid');
        return true;
      }
      console.error('[SDK] Configuration validation failed:', error);
      return false;
    }
  }

  /**
   * Get swarm metadata for a message
   */
  getSwarmMetadata(messageId: string): Record<string, unknown> | undefined {
    return this.swarmMetadata.get(messageId);
  }

  /**
   * Clear swarm metadata
   */
  clearSwarmMetadata(): void {
    this.swarmMetadata.clear();
  }

  /**
   * Log error to swarm coordination system
   */
  private logSwarmError(error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    this.swarmMetadata.set(`error-${Date.now()}`, {
      timestamp: Date.now(),
      error: errorMessage,
      stack: errorStack
    });
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): { totalTokens: number; messageCount: number } {
    let totalTokens = 0;
    let messageCount = 0;

    this.swarmMetadata.forEach((metadata) => {
      if (metadata.tokensUsed) {
        totalTokens += metadata.tokensUsed.total_tokens || 0;
        messageCount++;
      }
    });

    return { totalTokens, messageCount };
  }
}

// Export a singleton instance for convenience
export const defaultSDKAdapter = new ClaudeFlowSDKAdapter();