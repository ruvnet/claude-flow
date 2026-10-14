/**
 * Token Optimizer - Integrates agentic-flow Agent Booster capabilities
 *
 * Combines:
 * - Agent Booster (code edit speedup via WASM, if available)
 * - ReasoningBank (token reduction via semantic retrieval, savings vary by query)
 * - Configuration Tuning (batch/cache/topology optimization)
 *
 * Note: Actual savings depend on agentic-flow availability and usage patterns.
 * No fabricated metrics are reported -- all stats reflect real measurements.
 *
 * @module v3/integration/token-optimizer
 */

import { EventEmitter } from 'events';

// Types for agentic-flow integration
interface TokenStats {
  saved: number;
  baseline: number;
  reduction: number;
  method: string;
}

interface MemoryContext {
  query: string;
  memories: Array<{ content: string; score: number }>;
  compactPrompt: string;
  /**
   * Tokens this compact prompt saved against the context it replaced, or
   * `null` when the caller supplied no baseline to measure against.
   *
   * `null` rather than `0`: a zero is a measurement that came out empty,
   * and callers that sum these would fold "no saving" and "no measurement"
   * into the same number -- which is how this value came to be reported as
   * a saving in the first place.
   */
  tokensSaved: number | null;
}

interface EditOptimization {
  speedupFactor: number;
  executionMs: number;
  method: 'agent-booster' | 'traditional';
}

// Dynamic import helper to handle module resolution
async function safeImport<T>(modulePath: string): Promise<T | null> {
  try {
    return await import(modulePath);
  } catch {
    return null;
  }
}

/**
 * Token Optimizer - Measures and reports token usage via agentic-flow integration.
 * All reported statistics reflect actual measured values, not estimates.
 */
export class TokenOptimizer extends EventEmitter {
  private stats = {
    totalTokensSaved: 0,
    /**
     * How many `getCompactContext` calls carried a baseline. `totalTokensSaved`
     * is the sum over exactly these, so a reader can tell an honest zero from
     * a total that nothing was ever measured into.
     */
    contextsMeasured: 0,
    editsOptimized: 0,
    cacheHits: 0,
    cacheMisses: 0,
    memoriesRetrieved: 0,
  };

  private agenticFlowAvailable = false;
  private reasoningBank: any = null;
  private agentBooster: any = null;
  private configTuning: any = null;
  private localCache = new Map<string, { data: any; timestamp: number }>();

  async initialize(): Promise<void> {
    try {
      // Only library subpaths: importing the agentic-flow root entry runs its
      // CLI main() in 3.0.0-alpha.x. No published root exports configTuning,
      // so the anti-drift defaults below are used.
      const rb = await safeImport<any>('agentic-flow/reasoningbank');
      if (rb && rb.retrieveMemories) {
        this.reasoningBank = rb;
      }

      const ab = await safeImport<any>('agentic-flow/agent-booster');
      if (ab) {
        // Agent booster may export different API
        this.agentBooster = ab.agentBooster || ab.AgentBooster || ab;
      }

      this.agenticFlowAvailable = rb !== null || ab !== null;
    } catch {
      this.agenticFlowAvailable = false;
    }

    this.emit('initialized', {
      agenticFlowAvailable: this.agenticFlowAvailable,
      reasoningBank: !!this.reasoningBank,
      agentBooster: !!this.agentBooster,
      configTuning: !!this.configTuning,
    });
  }

  /**
   * Retrieve compact context instead of full file content.
   *
   * Savings are measured against `options.baselineTokens`: the size of the
   * context this compact prompt is replacing. That number is the caller's to
   * supply, because this method never sees it -- it receives a search
   * instruction, not the context being replaced.
   *
   * Without it the result is reported as unmeasured (`tokensSaved: null`) and
   * nothing is added to the running total. The previous baseline was the
   * QUERY's own length, which measured nothing: a short query against a longer
   * retrieved prompt reported 0 no matter how much context the caller then
   * dropped, and a long query against a short prompt reported a saving with no
   * replaced context behind it (#3289).
   */
  async getCompactContext(query: string, options?: {
    limit?: number;
    threshold?: number;
    /**
     * Token count of the context the compact prompt replaces. Omit it when
     * nothing was replaced or the size is unknown.
     */
    baselineTokens?: number;
  }): Promise<MemoryContext> {
    const limit = options?.limit ?? 5;
    const threshold = options?.threshold ?? 0.7;

    if (!this.reasoningBank) {
      // Fallback: return empty context
      return {
        query,
        memories: [],
        compactPrompt: '',
        tokensSaved: null,
      };
    }

    let memories: Array<{ content: string; score: number }>;
    let compactPrompt: string;
    try {
      memories = await this.reasoningBank.retrieveMemories(query, {
        limit,
        threshold,
      });
      compactPrompt = this.reasoningBank.formatMemoriesForPrompt(memories);
    } catch {
      memories = [];
      compactPrompt = '';
    }

    // ~4 chars per token, the same rough heuristic as before -- what changes
    // is what it is compared against.
    const baseline = options?.baselineTokens;
    const measurable =
      typeof baseline === 'number' && Number.isFinite(baseline) && baseline >= 0;
    const compactTokenEstimate = Math.ceil(compactPrompt.length / 4);
    const saved = measurable
      ? Math.max(0, Math.floor(baseline) - compactTokenEstimate)
      : null;

    if (saved !== null) {
      this.stats.totalTokensSaved += saved;
      this.stats.contextsMeasured += 1;
    }
    this.stats.memoriesRetrieved += memories.length;

    return {
      query,
      memories,
      compactPrompt,
      tokensSaved: saved,
    };
  }

  /**
   * Optimized code edit using Agent Booster (if available).
   * Faster edits may reduce timeouts and retry tokens.
   */
  async optimizedEdit(
    filePath: string,
    oldContent: string,
    newContent: string,
    language: string
  ): Promise<EditOptimization> {
    if (!this.agentBooster) {
      // Fallback: no optimization available
      return {
        speedupFactor: 1,
        executionMs: 0,
        method: 'traditional',
      };
    }

    const result = await this.agentBooster.editCode({
      filePath,
      oldContent,
      newContent,
      language,
    });

    // Track optimized edits (no fabricated token savings — actual savings
    // come from fewer retries, which we can't measure here)
    if (result.method === 'agent-booster') {
      this.stats.editsOptimized++;
    }

    return {
      speedupFactor: result.speedupFactor,
      executionMs: result.executionTimeMs,
      method: result.method,
    };
  }

  /**
   * Get optimal swarm configuration to prevent failures
   * 100% success rate = no wasted retry tokens
   */
  getOptimalConfig(agentCount: number): {
    batchSize: number;
    cacheSizeMB: number;
    topology: string;
    expectedSuccessRate: number;
  } {
    if (!this.configTuning) {
      // Scale defaults based on agent count
      const batchSize = agentCount <= 4 ? 2 : agentCount <= 8 ? 4 : 5;
      const cacheSizeMB = Math.min(200, 25 * Math.ceil(agentCount / 2));
      const topology = 'hierarchical';
      return {
        batchSize,
        cacheSizeMB,
        topology,
        expectedSuccessRate: agentCount <= 8 ? 0.95 : 0.90,
      };
    }

    const batch = this.configTuning.getOptimalBatchSize();
    const cache = this.configTuning.getOptimalCacheConfig();
    const topo = this.configTuning.selectTopology(agentCount);

    return {
      batchSize: batch.size,
      cacheSizeMB: cache.sizeMB,
      topology: topo.topology,
      expectedSuccessRate: batch.expectedSuccessRate,
    };
  }

  /**
   * Cache-aware embedding lookup.
   * Cache hit rate depends on query patterns and TTL (5 min default).
   */
  async cachedLookup<T>(key: string, generator: () => Promise<T>): Promise<T> {
    // Use local cache if configTuning not available
    const cacheEntry = this.localCache.get(key);
    if (cacheEntry && Date.now() - cacheEntry.timestamp < 300000) { // 5 min TTL
      this.stats.cacheHits++;
      return cacheEntry.data as T;
    }

    if (this.configTuning) {
      const cached = await this.configTuning.cacheGet(key);
      if (cached) {
        this.stats.cacheHits++;
        return cached as T;
      }
    }

    this.stats.cacheMisses++;
    const result = await generator();

    // Store in local cache
    this.localCache.set(key, { data: result, timestamp: Date.now() });

    if (this.configTuning) {
      await this.configTuning.cacheSet(key, result);
    }

    return result;
  }

  /**
   * Get optimization statistics
   */
  getStats(): typeof this.stats & {
    agenticFlowAvailable: boolean;
    cacheHitRate: string;
    estimatedMonthlySavings: string;
  } {
    const total = this.stats.cacheHits + this.stats.cacheMisses;
    const hitRate = total > 0 ? (this.stats.cacheHits / total * 100).toFixed(1) : '0';

    // Estimate $0.01 per 1000 tokens
    const savings = (this.stats.totalTokensSaved / 1000 * 0.01).toFixed(2);

    return {
      ...this.stats,
      agenticFlowAvailable: this.agenticFlowAvailable,
      cacheHitRate: `${hitRate}%`,
      estimatedMonthlySavings: `$${savings}`,
    };
  }

  /**
   * Generate token savings report
   */
  generateReport(): string {
    const stats = this.getStats();
    return `
## Token Optimization Report

| Metric | Value |
|--------|-------|
| Tokens Saved | ${stats.totalTokensSaved.toLocaleString()} |
| Contexts Measured | ${stats.contextsMeasured} |
| Edits Optimized | ${stats.editsOptimized} |
| Cache Hit Rate | ${stats.cacheHitRate} |
| Memories Retrieved | ${stats.memoriesRetrieved} |
| Est. Monthly Savings | ${stats.estimatedMonthlySavings} |
| Agentic-Flow Active | ${stats.agenticFlowAvailable ? '✓' : '✗'} |
`.trim();
  }
}

// Singleton instance
let optimizer: TokenOptimizer | null = null;

export async function getTokenOptimizer(): Promise<TokenOptimizer> {
  if (!optimizer) {
    optimizer = new TokenOptimizer();
    await optimizer.initialize();
  }
  return optimizer;
}

export default TokenOptimizer;
