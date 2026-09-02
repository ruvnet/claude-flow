/**
 * V3 LLM Hooks System
 *
 * Provides pre/post operation hooks for all LLM calls with:
 * - Request caching with memory persistence
 * - Provider-specific optimizations
 * - Cost tracking and optimization
 * - Performance metrics
 * - Pattern learning
 *
 * @module @claude-flow/hooks/llm/llm-hooks
 */

import { reasoningBank } from '../reasoningbank/index.js';

// ===== TYPES =====

export interface LLMHookContext {
  correlationId: string;
  sessionId?: string;
  agentId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface LLMHookPayload {
  provider: string;
  model: string;
  operation: 'complete' | 'stream' | 'embed';
  request: LLMRequestPayload;
  response?: LLMResponsePayload;
  metrics?: LLMMetrics;
}

export interface LLMRequestPayload {
  messages: Array<{
    role: string;
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

export interface LLMResponsePayload {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost?: {
    promptCost: number;
    completionCost: number;
    totalCost: number;
  };
  latency?: number;
  [key: string]: unknown;
}

export interface LLMMetrics {
  requestStart: number;
  responseEnd?: number;
  latency?: number;
  cacheHit?: boolean;
  tokenEstimate?: number;
  costEstimate?: number;
}

export interface LLMHookResult {
  continue: boolean;
  modified: boolean;
  payload?: LLMHookPayload;
  sideEffects?: LLMSideEffect[];
  cachedResponse?: LLMResponsePayload;
}

export interface LLMSideEffect {
  type: 'memory' | 'metric' | 'log' | 'pattern';
  action: string;
  data: Record<string, unknown>;
}

// ===== CACHE =====

interface CacheEntry {
  response: LLMResponsePayload;
  timestamp: number;
  hits: number;
  key: string;
}

const responseCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL = 3600000; // 1 hour
const MAX_CACHE_SIZE = 1000;

function generateCacheKey(provider: string, model: string, request: LLMRequestPayload): string {
  const normalized = {
    provider,
    model,
    messages: request.messages,
    temperature: request.temperature,
    maxTokens: request.maxTokens,
  };
  return Buffer.from(JSON.stringify(normalized)).toString('base64').slice(0, 64);
}

function getCached(key: string): CacheEntry | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.timestamp > DEFAULT_CACHE_TTL) {
    responseCache.delete(key);
    return undefined;
  }

  entry.hits++;
  return entry;
}

function setCache(key: string, response: LLMResponsePayload): void {
  // Enforce max size
  if (responseCache.size >= MAX_CACHE_SIZE) {
    const oldest = Array.from(responseCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }

  responseCache.set(key, {
    response,
    timestamp: Date.now(),
    hits: 0,
    key,
  });
}

// ===== OPTIMIZATION =====

interface ProviderOptimization {
  preferredTemperature?: number;
  preferredMaxTokens?: number;
  systemPromptOptimizations?: string[];
  costReductionStrategies?: string[];
}

const providerOptimizations: Record<string, ProviderOptimization> = {
  anthropic: {
    preferredTemperature: 0.7,
    systemPromptOptimizations: [
      'Be concise and direct',
      'Use structured output when appropriate',
    ],
    costReductionStrategies: [
      'Use claude-3-haiku for simple tasks',
      'Batch similar requests',
    ],
  },
  openai: {
    preferredTemperature: 0.8,
    systemPromptOptimizations: [
      'Respond in a structured format',
    ],
    costReductionStrategies: [
      'Use gpt-4o-mini for simple tasks',
      'Enable response caching',
    ],
  },
  google: {
    preferredTemperature: 0.7,
    costReductionStrategies: [
      'Use gemini-1.5-flash for simple tasks',
    ],
  },
  ollama: {
    preferredTemperature: 0.7,
    costReductionStrategies: [
      'Free - no cost optimization needed',
    ],
  },
};

function loadProviderOptimizations(provider: string): ProviderOptimization {
  return providerOptimizations[provider] || {};
}

function applyRequestOptimizations(
  request: LLMRequestPayload,
  optimizations: ProviderOptimization
): LLMRequestPayload {
  const optimized = { ...request };

  // Apply temperature if not set
  if (optimized.temperature === undefined && optimizations.preferredTemperature) {
    optimized.temperature = optimizations.preferredTemperature;
  }

  return optimized;
}

// ===== PRE-LLM HOOK =====

export async function preLLMCallHook(
  payload: LLMHookPayload,
  context: LLMHookContext
): Promise<LLMHookResult> {
  const { provider, model, request } = payload;
  const sideEffects: LLMSideEffect[] = [];

  // Check cache
  const cacheKey = generateCacheKey(provider, model, request);
  const cached = getCached(cacheKey);

  if (cached) {
    sideEffects.push({
      type: 'metric',
      action: 'increment',
      data: { name: 'llm.cache.hits', provider, model },
    });

    return {
      continue: false, // Skip LLM call
      modified: true,
      cachedResponse: cached.response,
      payload: {
        ...payload,
        metrics: {
          ...payload.metrics,
          requestStart: Date.now(),
          cacheHit: true,
        },
      },
      sideEffects,
    };
  }

  // Load and apply optimizations
  const optimizations = loadProviderOptimizations(provider);
  const optimizedRequest = applyRequestOptimizations(request, optimizations);

  // Track request
  sideEffects.push(
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
          request: optimizedRequest,
          timestamp: Date.now(),
        },
        ttl: 3600,
      },
    }
  );

  return {
    continue: true,
    modified: optimizedRequest !== request,
    payload: {
      ...payload,
      request: optimizedRequest,
      metrics: {
        ...payload.metrics,
        requestStart: Date.now(),
        cacheHit: false,
      },
    },
    sideEffects,
  };
}

// ===== POST-LLM HOOK =====

export async function postLLMCallHook(
  payload: LLMHookPayload,
  context: LLMHookContext
): Promise<LLMHookResult> {
  const { provider, model, request, response, metrics } = payload;
  const sideEffects: LLMSideEffect[] = [];

  if (!response) {
    return { continue: true, modified: false };
  }

  const latency = metrics?.requestStart
    ? Date.now() - metrics.requestStart
    : undefined;

  // Cache response
  const cacheKey = generateCacheKey(provider, model, request);
  setCache(cacheKey, response);

  // Track metrics
  sideEffects.push(
    {
      type: 'metric',
      action: 'record',
      data: {
        name: `llm.latency.${provider}`,
        value: latency,
      },
    },
    {
      type: 'metric',
      action: 'record',
      data: {
        name: `llm.tokens.${provider}`,
        value: response.usage?.totalTokens,
      },
    }
  );

  if (response.cost) {
    sideEffects.push({
      type: 'metric',
      action: 'record',
      data: {
        name: `llm.cost.${provider}`,
        value: response.cost.totalCost,
      },
    });
  }

  // Learn patterns from successful responses
  if (response.content && response.content.length > 100) {
    const pattern = extractPatternFromResponse(request, response);
    if (pattern) {
      sideEffects.push({
        type: 'pattern',
        action: 'learn',
        data: {
          strategy: pattern.strategy,
          domain: pattern.domain,
          quality: pattern.quality,
        },
      });

      // Store in reasoning bank
      try {
        await reasoningBank.storePattern(pattern.strategy, pattern.domain);
      } catch {
        // Ignore storage errors
      }
    }
  }

  // Store response in memory
  sideEffects.push({
    type: 'memory',
    action: 'store',
    data: {
      key: `llm:response:${context.correlationId}`,
      value: {
        provider,
        model,
        response: {
          content: response.content.slice(0, 500), // Truncate
          usage: response.usage,
          cost: response.cost,
          latency,
        },
        timestamp: Date.now(),
      },
      ttl: 86400, // 24 hours
    },
  });

  return {
    continue: true,
    modified: false,
    payload: {
      ...payload,
      metrics: {
        requestStart: metrics?.requestStart ?? Date.now(),
        responseEnd: Date.now(),
        latency,
        cacheHit: metrics?.cacheHit,
        tokenEstimate: metrics?.tokenEstimate,
        costEstimate: metrics?.costEstimate,
      },
    },
    sideEffects,
  };
}

// ===== ERROR HOOK =====

export async function errorLLMCallHook(
  payload: LLMHookPayload,
  error: Error,
  context: LLMHookContext
): Promise<LLMHookResult> {
  const { provider, model, metrics } = payload;
  const sideEffects: LLMSideEffect[] = [];

  const latency = metrics?.requestStart
    ? Date.now() - metrics.requestStart
    : undefined;

  // Track error metrics
  sideEffects.push(
    {
      type: 'metric',
      action: 'increment',
      data: {
        name: `llm.errors.${provider}`,
        errorType: error.name,
      },
    },
    {
      type: 'log',
      action: 'error',
      data: {
        message: `LLM call failed: ${error.message}`,
        provider,
        model,
        latency,
        errorType: error.name,
      },
    }
  );

  // Store error for learning
  sideEffects.push({
    type: 'memory',
    action: 'store',
    data: {
      key: `llm:error:${context.correlationId}`,
      value: {
        provider,
        model,
        error: {
          name: error.name,
          message: error.message,
        },
        timestamp: Date.now(),
      },
      ttl: 86400,
    },
  });

  return {
    continue: true,
    modified: false,
    sideEffects,
  };
}

// ===== PATTERN EXTRACTION =====

interface ExtractedPattern {
  strategy: string;
  domain: string;
  quality: number;
}

function extractPatternFromResponse(
  request: LLMRequestPayload,
  response: LLMResponsePayload
): ExtractedPattern | null {
  // Simple heuristic pattern extraction
  const lastUserMessage = [...request.messages]
    .reverse()
    .find((m) => m.role === 'user');

  if (!lastUserMessage) return null;

  // Detect domain from content
  const content = lastUserMessage.content.toLowerCase();
  let domain = 'general';

  if (content.includes('code') || content.includes('function') || content.includes('implement')) {
    domain = 'code';
  } else if (content.includes('security') || content.includes('vulnerability')) {
    domain = 'security';
  } else if (content.includes('test') || content.includes('spec')) {
    domain = 'testing';
  } else if (content.includes('architecture') || content.includes('design')) {
    domain = 'architecture';
  } else if (content.includes('performance') || content.includes('optimize')) {
    domain = 'performance';
  }

  // Extract strategy from response
  const responseContent = response.content;
  const strategy = responseContent.length > 500
    ? responseContent.slice(0, 500)
    : responseContent;

  // Quality based on response length and structure
  const hasCodeBlocks = responseContent.includes('```');
  const hasLists = responseContent.includes('\n- ') || responseContent.includes('\n1.');
  const quality = Math.min(
    0.9,
    0.5 + (hasCodeBlocks ? 0.2 : 0) + (hasLists ? 0.1 : 0) + (responseContent.length > 1000 ? 0.1 : 0)
  );

  return {
    strategy: `[${domain}] ${strategy.slice(0, 200)}...`,
    domain,
    quality,
  };
}

// ===== CACHE MANAGEMENT =====

export function clearLLMCache(): void {
  responseCache.clear();
}

export function getLLMCacheStats(): {
  size: number;
  totalHits: number;
  entries: Array<{ key: string; hits: number; age: number }>;
} {
  let totalHits = 0;
  const entries: Array<{ key: string; hits: number; age: number }> = [];

  for (const [key, entry] of responseCache) {
    totalHits += entry.hits;
    entries.push({
      key,
      hits: entry.hits,
      age: Date.now() - entry.timestamp,
    });
  }

  return {
    size: responseCache.size,
    totalHits,
    entries: entries.slice(0, 10), // Top 10
  };
}

// ===== EXPORTS =====

export const llmHooks = {
  preLLMCall: preLLMCallHook,
  postLLMCall: postLLMCallHook,
  errorLLMCall: errorLLMCallHook,
  clearCache: clearLLMCache,
  getCacheStats: getLLMCacheStats,
};

export default llmHooks;
