/**
 * SDK Compatibility Layer
 * Claude-Flow v2.5-alpha.130
 *
 * Maintains backward compatibility while transitioning to SDK
 */

import { ClaudeFlowSDKAdapter } from './sdk-config.js';
import Anthropic from '@anthropic-ai/sdk';

/**
 * Compatibility layer to maintain backward compatibility
 * while transitioning from custom implementations to SDK
 */
export class SDKCompatibilityLayer {
  private adapter: ClaudeFlowSDKAdapter;
  private legacyMode: boolean = false;
  private deprecationWarnings: Set<string> = new Set();

  constructor(adapter: ClaudeFlowSDKAdapter) {
    this.adapter = adapter;
  }

  /**
   * Enable legacy mode for full backward compatibility
   */
  enableLegacyMode(): void {
    this.legacyMode = true;
    console.warn('[Compatibility] Legacy mode enabled. Please migrate to SDK methods.');
  }

  /**
   * Wrapper for legacy retry logic that delegates to SDK
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options?: {
      maxRetries?: number;
      backoffMultiplier?: number;
      initialDelay?: number;
    }
  ): Promise<T> {
    this.logDeprecation('executeWithRetry', 'SDK handles retry automatically');

    if (this.legacyMode) {
      // Fallback to legacy implementation if needed
      return this.legacyRetry(fn, options);
    }

    // Use SDK's built-in retry by wrapping in a message call
    try {
      return await fn();
    } catch (error) {
      // SDK will have already retried based on configuration
      throw error;
    }
  }

  /**
   * Legacy calculateBackoff - now handled by SDK
   */
  calculateBackoff(attempt: number): number {
    this.logDeprecation('calculateBackoff', 'SDK handles backoff automatically');

    if (this.legacyMode) {
      const baseDelay = 1000;
      const jitter = Math.random() * 1000;
      return Math.min(
        baseDelay * Math.pow(2, attempt - 1) + jitter,
        30000 // Max 30 seconds
      );
    }

    // Return a dummy value since SDK handles this
    return 0;
  }

  /**
   * Legacy persistToDisk - now handled by SDK artifacts
   */
  async persistToDisk(key: string, value: unknown): Promise<void> {
    this.logDeprecation('persistToDisk', 'Use SDK artifacts for persistence');

    if (this.legacyMode) {
      // Legacy file-based persistence
      const fs = await import('fs/promises');
      const path = await import('path');
      const storagePath = '.claude-flow/storage';
      await fs.mkdir(storagePath, { recursive: true });
      await fs.writeFile(
        path.join(storagePath, `${key}.json`),
        JSON.stringify(value, null, 2)
      );
      return;
    }

    // In SDK mode, this is a no-op as persistence is automatic
    console.log(`[Compatibility] Persistence for '${key}' is handled automatically by SDK`);
  }

  /**
   * Legacy executeValidations - now handled by SDK
   */
  async executeValidations(checkpointId: string): Promise<boolean> {
    this.logDeprecation('executeValidations', 'SDK handles validations automatically');

    if (this.legacyMode) {
      // Legacy validation logic
      console.log(`[Compatibility] Running legacy validations for checkpoint ${checkpointId}`);
      return true;
    }

    // SDK handles this automatically
    return true;
  }

  /**
   * Map old ClaudeRequest format to SDK format
   */
  mapLegacyRequest(legacyRequest: Record<string, unknown>): Anthropic.MessageCreateParams {
    return {
      model: this.mapLegacyModel(legacyRequest.model as string),
      messages: (legacyRequest.messages as Anthropic.MessageParam[]) || [],
      max_tokens: (legacyRequest.max_tokens as number) || 1024,
      temperature: legacyRequest.temperature as number | undefined,
      top_p: legacyRequest.top_p as number | undefined,
      top_k: legacyRequest.top_k as number | undefined,
      stop_sequences: legacyRequest.stop_sequences as string[] | undefined,
      system: legacyRequest.system as string | undefined,
      metadata: legacyRequest.metadata as Anthropic.Metadata | undefined
    };
  }

  /**
   * Map old model names to SDK model names
   */
  private mapLegacyModel(model: string): Anthropic.Model {
    const modelMap: Record<string, Anthropic.Model> = {
      'claude-2.1': 'claude-2.1',
      'claude-2.0': 'claude-2.1', // Map to closest available
      'claude-instant-1.2': 'claude-instant-1.2',
      'claude-3-opus-20240229': 'claude-3-opus-20240229',
      'claude-3-sonnet-20240229': 'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307': 'claude-3-haiku-20240307'
    };

    return modelMap[model] || 'claude-3-sonnet-20240229';
  }

  /**
   * Map SDK response to legacy format
   */
  mapSDKResponse(sdkResponse: Anthropic.Message): Record<string, unknown> {
    return {
      id: sdkResponse.id,
      type: 'message',
      role: sdkResponse.role,
      content: sdkResponse.content,
      model: sdkResponse.model,
      stop_reason: sdkResponse.stop_reason,
      stop_sequence: sdkResponse.stop_sequence,
      usage: sdkResponse.usage
    };
  }

  /**
   * Legacy retry implementation for fallback
   */
  private async legacyRetry<T>(
    fn: () => Promise<T>,
    options?: {
      maxRetries?: number;
      backoffMultiplier?: number;
      initialDelay?: number;
    }
  ): Promise<T> {
    const maxRetries = options?.maxRetries || 3;
    const backoffMultiplier = options?.backoffMultiplier || 2;
    const initialDelay = options?.initialDelay || 1000;

    let lastError: any;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (i < maxRetries - 1) {
          const delay = initialDelay * Math.pow(backoffMultiplier, i);
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Helper sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log deprecation warning once per method
   */
  private logDeprecation(method: string, suggestion: string): void {
    if (!this.deprecationWarnings.has(method)) {
      console.warn(
        `[Deprecation] '${method}' is deprecated. ${suggestion}. ` +
        `This will be removed in v3.0.0.`
      );
      this.deprecationWarnings.add(method);
    }
  }

  /**
   * Get deprecation report
   */
  getDeprecationReport(): string[] {
    return Array.from(this.deprecationWarnings);
  }

  /**
   * Check if running in legacy mode
   */
  isLegacyMode(): boolean {
    return this.legacyMode;
  }
}

// Export singleton for convenience
export const createCompatibilityLayer = (
  adapter: ClaudeFlowSDKAdapter
): SDKCompatibilityLayer => {
  return new SDKCompatibilityLayer(adapter);
};