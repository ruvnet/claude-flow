/**
 * LLM-specific hooks for agentic-flow integration
 * 
 * Provides pre/post operation hooks for all LLM calls with
 * memory persistence and performance optimization.
 */

import { agenticHookManager } from './hook-manager.js';
import type {
  AgenticHookContext,
  HookHandlerResult,
  LLMHookPayload,
  LLMMetrics,
  Pattern,
  SideEffect,
} from './types.js';

// ===== Pre-LLM Call Hook =====

export const preLLMCallHook = {
  id: 'agentic-pre-llm-call',
  type: 'pre-llm-call' as const,
  priority: 100,
  handler: async (
    payload: LLMHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { provider, model, operation, request } = payload;
    
    // Check memory for similar requests
    const cacheKey = generateCacheKey(provider, model, request);
    const cached = await checkMemoryCache(cacheKey, context);
    
    if (cached) {
      return {
        continue: false, // Skip LLM call
        modified: true,
        payload: {
          ...payload,
          response: cached.response,
          metrics: {
            ...cached.metrics,
            cacheHit: true,
          },
        },
        sideEffects: [
          {
            type: 'metric',
            action: 'increment',
            data: { name: 'llm.cache.hits' },
          },
        ],
      };
    }
    
    // Load provider-specific optimizations
    const optimizations = await loadProviderOptimizations(provider, context);
    
    // Apply request optimizations
    const optimizedRequest = applyRequestOptimizations(
      request,
      optimizations,
      context
    );
    
    // Track pre-call metrics
    const sideEffects: SideEffect[] = [
      {
        type: 'metric',
        action: 'increment',
        data: { name: `llm.calls.${provider}.${model}` },
      },
      {
        type: 'memory',
        action: 'store',
        data: {
          key: `llm:request:${context.correlationId}`,
          value: {
            provider,
            model,
            operation,
            request: optimizedRequest,
            timestamp: Date.now(),
          },
          ttl: 3600, // 1 hour
        },
      },
    ];
    
    return {
      continue: true,
      modified: true,
      payload: {
        ...payload,
        request: optimizedRequest,
      },
      sideEffects,
    };
  },
};

// ===== Post-LLM Call Hook =====

export const postLLMCallHook = {
  id: 'agentic-post-llm-call',
  type: 'post-llm-call' as const,
  priority: 100,
  handler: async (
    payload: LLMHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { provider, model, request, response, metrics } = payload;
    
    if (!response || !metrics) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Store response in memory for caching
    const cacheKey = generateCacheKey(provider, model, request);
    sideEffects.push({
      type: 'memory',
      action: 'store',
      data: {
        key: `llm:cache:${cacheKey}`,
        value: {
          response,
          metrics,
          timestamp: Date.now(),
        },
        ttl: determineCacheTTL(operation, response),
      },
    });
    
    // Extract patterns for neural training
    const patterns = extractResponsePatterns(request, response, metrics);
    if (patterns.length > 0) {
      sideEffects.push({
        type: 'neural',
        action: 'train',
        data: {
          patterns,
          modelId: `llm-optimizer-${provider}`,
        },
      });
    }
    
    // Update performance metrics
    sideEffects.push(
      {
        type: 'metric',
        action: 'update',
        data: {
          name: `llm.latency.${provider}.${model}`,
          value: metrics.latency,
        },
      },
      {
        type: 'metric',
        action: 'update',
        data: {
          name: `llm.tokens.${provider}.${model}`,
          value: response.usage.totalTokens,
        },
      },
      {
        type: 'metric',
        action: 'update',
        data: {
          name: `llm.cost.${provider}.${model}`,
          value: metrics.costEstimate,
        },
      }
    );
    
    // Check for performance issues
    if (metrics.latency > getLatencyThreshold(provider, model)) {
      sideEffects.push({
        type: 'notification',
        action: 'send',
        data: {
          level: 'warning',
          message: `High latency detected for ${provider}/${model}: ${metrics.latency}ms`,
        },
      });
    }
    
    // Store provider health score
    await updateProviderHealth(provider, metrics.providerHealth, context);
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== LLM Error Hook =====

export const llmErrorHook = {
  id: 'agentic-llm-error',
  type: 'llm-error' as const,
  priority: 100,
  handler: async (
    payload: LLMHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { provider, model, error } = payload;
    
    if (!error) {
      return { continue: true };
    }
    
    const sideEffects: SideEffect[] = [];
    
    // Log error details
    sideEffects.push({
      type: 'log',
      action: 'write',
      data: {
        level: 'error',
        message: `LLM error from ${provider}/${model}`,
        data: {
          error: error.message,
          stack: error.stack,
          request: payload.request,
        },
      },
    });
    
    // Update error metrics
    sideEffects.push({
      type: 'metric',
      action: 'increment',
      data: { name: `llm.errors.${provider}.${model}` },
    });
    
    // Check if we should fallback
    const fallbackProvider = await selectFallbackProvider(
      provider,
      model,
      error,
      context
    );
    
    if (fallbackProvider) {
      return {
        continue: false, // Don't propagate error
        modified: true,
        payload: {
          ...payload,
          provider: fallbackProvider.provider,
          model: fallbackProvider.model,
          error: undefined, // Clear error for retry
        },
        sideEffects: [
          ...sideEffects,
          {
            type: 'notification',
            action: 'send',
            data: {
              level: 'info',
              message: `Falling back from ${provider}/${model} to ${fallbackProvider.provider}/${fallbackProvider.model}`,
            },
          },
        ],
      };
    }
    
    return {
      continue: true,
      sideEffects,
    };
  },
};

// ===== LLM Retry Hook =====

export const llmRetryHook = {
  id: 'agentic-llm-retry',
  type: 'llm-retry' as const,
  priority: 90,
  handler: async (
    payload: LLMHookPayload,
    context: AgenticHookContext
  ): Promise<HookHandlerResult> => {
    const { provider, model, metrics } = payload;
    const retryCount = metrics?.retryCount || 0;
    
    // Adjust request parameters for retry
    const adjustedRequest = adjustRequestForRetry(
      payload.request,
      retryCount
    );
    
    const sideEffects: SideEffect[] = [
      {
        type: 'metric',
        action: 'increment',
        data: { name: `llm.retries.${provider}.${model}` },
      },
    ];
    
    // Apply exponential backoff
    const backoffMs = Math.min(1000 * Math.pow(2, retryCount), 10000);
    await new Promise(resolve => setTimeout(resolve, backoffMs));
    
    return {
      continue: true,
      modified: true,
      payload: {
        ...payload,
        request: adjustedRequest,
        metrics: {
          ...metrics,
          retryCount: retryCount + 1,
        },
      },
      sideEffects,
    };
  },
};

// ===== Helper Functions =====

function generateCacheKey(
  provider: string,
  model: string,
  request: LLMHookPayload['request']
): string {
  const normalized = {
    provider,
    model,
    messages: request.messages?.map(m => ({
      role: m.role,
      content: m.content.substring(0, 100), // First 100 chars
    })),
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  };
  
  return Buffer.from(JSON.stringify(normalized)).toString('base64');
}

async function checkMemoryCache(
  cacheKey: string,
  context: AgenticHookContext
): Promise<any | null> {
  // Implementation would integrate with memory service
  // This is a placeholder
  return null;
}

async function loadProviderOptimizations(
  provider: string,
  context: AgenticHookContext
): Promise<any> {
  // Load provider-specific optimizations from memory
  // This is a placeholder
  return {
    maxRetries: 3,
    timeout: 30000,
    rateLimit: 100,
  };
}

function applyRequestOptimizations(
  request: LLMHookPayload['request'],
  optimizations: any,
  context: AgenticHookContext
): LLMHookPayload['request'] {
  // Apply various optimizations
  const optimized = { ...request };
  
  // Optimize token usage
  if (optimized.maxTokens && optimized.maxTokens > 4000) {
    optimized.maxTokens = 4000; // Cap at reasonable limit
  }
  
  // Optimize temperature for consistency
  if (optimized.temperature === undefined) {
    optimized.temperature = 0.7;
  }
  
  // Add stop sequences if missing
  if (!optimized.stopSequences && optimized.messages) {
    optimized.stopSequences = ['\n\nHuman:', '\n\nAssistant:'];
  }
  
  return optimized;
}

function determineCacheTTL(
  operation: string,
  response: LLMHookPayload['response']
): number {
  // Determine cache TTL based on operation and response
  switch (operation) {
    case 'embedding':
      return 86400; // 24 hours for embeddings
    case 'completion':
      // Shorter TTL for completions
      return response?.usage?.totalTokens && response.usage.totalTokens > 1000
        ? 1800 // 30 minutes for long responses
        : 3600; // 1 hour for short responses
    default:
      return 3600; // 1 hour default
  }
}

function extractResponsePatterns(
  request: LLMHookPayload['request'],
  response: LLMHookPayload['response'],
  metrics: LLMMetrics
): Pattern[] {
  const patterns: Pattern[] = [];
  
  // Extract performance patterns
  if (metrics.latency > 1000) {
    patterns.push({
      id: `perf_${Date.now()}`,
      type: 'optimization',
      confidence: 0.8,
      occurrences: 1,
      context: {
        provider: metrics.providerHealth < 0.8 ? 'unhealthy' : 'healthy',
        requestSize: JSON.stringify(request).length,
        responseTokens: response?.usage?.totalTokens || 0,
        latency: metrics.latency,
      },
    });
  }
  
  // Extract success patterns
  if (response?.choices?.[0]?.finishReason === 'stop') {
    patterns.push({
      id: `success_${Date.now()}`,
      type: 'success',
      confidence: 0.9,
      occurrences: 1,
      context: {
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        actualTokens: response.usage?.totalTokens || 0,
      },
    });
  }
  
  return patterns;
}

function getLatencyThreshold(provider: string, model: string): number {
  // Provider/model specific thresholds
  const thresholds: Record<string, number> = {
    'openai:gpt-4': 5000,
    'openai:gpt-3.5-turbo': 2000,
    'anthropic:claude-3': 4000,
    'anthropic:claude-instant': 1500,
  };
  
  return thresholds[`${provider}:${model}`] || 3000;
}

async function updateProviderHealth(
  provider: string,
  health: number,
  context: AgenticHookContext
): Promise<void> {
  // Update provider health in memory
  const healthKey = `provider:health:${provider}`;
  const currentHealth = await context.memory.cache.get(healthKey) || [];
  
  currentHealth.push({
    timestamp: Date.now(),
    health,
  });
  
  // Keep last 100 health checks
  if (currentHealth.length > 100) {
    currentHealth.shift();
  }
  
  await context.memory.cache.set(healthKey, currentHealth);
}

async function selectFallbackProvider(
  provider: string,
  model: string,
  error: Error,
  context: AgenticHookContext
): Promise<{ provider: string; model: string } | null> {
  // Implement intelligent fallback selection
  const fallbacks: Record<string, { provider: string; model: string }[]> = {
    'openai': [
      { provider: 'anthropic', model: 'claude-3' },
      { provider: 'cohere', model: 'command' },
    ],
    'anthropic': [
      { provider: 'openai', model: 'gpt-4' },
      { provider: 'cohere', model: 'command' },
    ],
  };
  
  const candidates = fallbacks[provider] || [];
  
  // Select based on health scores
  for (const candidate of candidates) {
    const healthKey = `provider:health:${candidate.provider}`;
    const healthData = await context.memory.cache.get(healthKey) || [];
    
    if (healthData.length > 0) {
      const avgHealth = healthData.reduce((sum: number, h: any) => 
        sum + h.health, 0
      ) / healthData.length;
      
      if (avgHealth > 0.7) {
        return candidate;
      }
    }
  }
  
  return null;
}

function adjustRequestForRetry(
  request: LLMHookPayload['request'],
  retryCount: number
): LLMHookPayload['request'] {
  const adjusted = { ...request };
  
  // Increase temperature slightly for variety
  if (adjusted.temperature !== undefined) {
    adjusted.temperature = Math.min(
      adjusted.temperature + (0.1 * retryCount),
      1.0
    );
  }
  
  // Reduce max tokens to improve success rate
  if (adjusted.maxTokens !== undefined) {
    adjusted.maxTokens = Math.floor(
      adjusted.maxTokens * Math.pow(0.9, retryCount)
    );
  }
  
  return adjusted;
}

// ===== Register Hooks =====

export function registerLLMHooks(): void {
  agenticHookManager.register(preLLMCallHook);
  agenticHookManager.register(postLLMCallHook);
  agenticHookManager.register(llmErrorHook);
  agenticHookManager.register(llmRetryHook);
}