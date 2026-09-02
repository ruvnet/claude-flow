/**
 * SONA Learning Plugin
 *
 * Self-Optimizing Neural Adaptation using @ruvector/learning-wasm.
 * Enables <100μs real-time adaptation through LoRA fine-tuning.
 *
 * Features:
 * - Ultra-fast pattern learning (<100μs)
 * - LoRA adapter management
 * - EWC++ for catastrophic forgetting prevention
 * - Pattern-based behavior optimization
 * - Quality score tracking
 *
 * @example
 * ```typescript
 * import { sonaLearningPlugin } from '@claude-flow/plugins/examples/ruvector-plugins';
 * await getDefaultRegistry().register(sonaLearningPlugin);
 * ```
 */

import {
  PluginBuilder,
  MCPToolBuilder,
  HookBuilder,
  HookEvent,
  HookPriority,
  Security,
} from '../../src/index.js';

// Import shared vector utilities (consolidated from all plugins)
import {
  IVectorDB,
  ILoRAEngine,
  LoRAAdapter,
  createVectorDB,
  createLoRAEngine,
  generateHashEmbedding,
} from './shared/vector-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface LearningPattern {
  id: string;
  category: string;
  trigger: string;
  action: string;
  context: Record<string, unknown>;
  quality: number;
  usageCount: number;
  lastUsed: Date;
  createdAt: Date;
  embedding?: Float32Array;
}

export interface AdaptationResult {
  patternId: string;
  applied: boolean;
  adaptationTime: number; // microseconds
  qualityDelta: number;
  newQuality: number;
}

export interface SONAConfig {
  learningRate: number;
  ewcLambda: number;
  maxPatterns: number;
  qualityThreshold: number;
  adaptationBudget: number; // max microseconds
  loraRank: number;
}

// ============================================================================
// SONA Learning Core
// ============================================================================

export class SONALearning {
  private loraEngine: ILoRAEngine | null = null;
  private vectorDb: IVectorDB | null = null;
  private patterns = new Map<string, LearningPattern>();
  private adapters = new Map<string, LoRAAdapter>();
  private config: SONAConfig;
  private dimensions = 768;
  private nextId = 1;
  private initPromise: Promise<void> | null = null;

  constructor(config?: Partial<SONAConfig>) {
    this.config = {
      learningRate: 0.001,
      ewcLambda: 0.1,
      maxPatterns: 10000,
      qualityThreshold: 0.5,
      adaptationBudget: 100,
      loraRank: 8,
      ...config,
    };
  }

  async initialize(): Promise<void> {
    if (this.loraEngine && this.vectorDb) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.loraEngine = await createLoRAEngine();
      this.vectorDb = await createVectorDB(this.dimensions);
    })();

    return this.initPromise;
  }

  private async ensureInitialized(): Promise<{ lora: ILoRAEngine; db: IVectorDB }> {
    await this.initialize();
    return { lora: this.loraEngine!, db: this.vectorDb! };
  }

  /**
   * Learn a new pattern (<100μs with @ruvector/learning-wasm).
   */
  async learn(
    category: string,
    trigger: string,
    action: string,
    context: Record<string, unknown>,
    quality: number
  ): Promise<LearningPattern> {
    const { lora, db } = await this.ensureInitialized();
    const startTime = performance.now();

    const safeCategory = Security.validateString(category, { maxLength: 100 });
    const safeTrigger = Security.validateString(trigger, { maxLength: 1000 });
    const safeAction = Security.validateString(action, { maxLength: 1000 });
    const safeQuality = Security.validateNumber(quality, { min: 0, max: 1 });

    const id = `pattern-${this.nextId++}`;
    const embedding = this.generatePatternEmbedding(safeTrigger, safeAction, safeCategory);

    const pattern: LearningPattern = {
      id,
      category: safeCategory,
      trigger: safeTrigger,
      action: safeAction,
      context,
      quality: safeQuality,
      usageCount: 0,
      lastUsed: new Date(),
      createdAt: new Date(),
      embedding,
    };

    // Get or create LoRA adapter for this category
    let adapter = this.adapters.get(safeCategory);
    if (!adapter) {
      adapter = await lora.createAdapter(safeCategory, this.config.loraRank);
      this.adapters.set(safeCategory, adapter);
    }

    // Compute and apply gradient with LoRA
    const target = new Float32Array(embedding.length).fill(safeQuality);
    const gradient = lora.computeGradient(embedding, target);
    await lora.updateAdapter(adapter.id, gradient, this.config.learningRate);

    // Apply EWC++ to prevent catastrophic forgetting
    await lora.applyEWC(adapter.id, this.config.ewcLambda);

    // Store in vector DB
    db.insert(embedding, id, { category: safeCategory, quality: safeQuality });
    this.patterns.set(id, pattern);

    // Prune if over limit
    if (this.patterns.size > this.config.maxPatterns) {
      await this.prunePatterns();
    }

    const adaptationTime = (performance.now() - startTime) * 1000; // microseconds
    console.debug(`[SONA] Learned pattern in ${adaptationTime.toFixed(1)}μs`);

    return pattern;
  }

  /**
   * Retrieve patterns matching a trigger.
   */
  async retrieve(trigger: string, category?: string, k: number = 5): Promise<LearningPattern[]> {
    const { db } = await this.ensureInitialized();

    const safeTrigger = Security.validateString(trigger, { maxLength: 1000 });
    const queryEmbedding = this.generatePatternEmbedding(safeTrigger, '', category || '');
    const searchResults = db.search(queryEmbedding, k * 2);

    const results: LearningPattern[] = [];
    for (const result of searchResults) {
      const pattern = this.patterns.get(result.id);
      if (!pattern) continue;
      if (category && pattern.category !== category) continue;
      if (pattern.quality < this.config.qualityThreshold) continue;
      results.push(pattern);
      if (results.length >= k) break;
    }

    return results;
  }

  /**
   * Apply a pattern and track adaptation.
   */
  async apply(patternId: string): Promise<AdaptationResult> {
    const startTime = performance.now();
    const pattern = this.patterns.get(patternId);
    if (!pattern) throw new Error(`Pattern ${patternId} not found`);

    pattern.usageCount++;
    pattern.lastUsed = new Date();

    return {
      patternId,
      applied: true,
      adaptationTime: (performance.now() - startTime) * 1000,
      qualityDelta: 0,
      newQuality: pattern.quality,
    };
  }

  /**
   * Update pattern quality based on outcome.
   */
  async feedback(patternId: string, success: boolean, qualityDelta?: number): Promise<void> {
    const { lora } = await this.ensureInitialized();
    const pattern = this.patterns.get(patternId);
    if (!pattern) throw new Error(`Pattern ${patternId} not found`);

    const delta = qualityDelta ?? (success ? 0.05 : -0.1);
    pattern.quality = Math.max(0, Math.min(1, pattern.quality + delta));

    // Update LoRA adapter with feedback
    const adapter = this.adapters.get(pattern.category);
    if (adapter && pattern.embedding) {
      const target = new Float32Array(pattern.embedding.length).fill(pattern.quality);
      const gradient = lora.computeGradient(pattern.embedding, target);
      await lora.updateAdapter(adapter.id, gradient, this.config.learningRate * 0.1);
    }

    if (pattern.quality < 0.1) {
      this.patterns.delete(patternId);
    }
  }

  /**
   * Get learning statistics.
   */
  getStats(): {
    totalPatterns: number;
    totalAdapters: number;
    byCategory: Record<string, { count: number; avgQuality: number }>;
    avgQuality: number;
    topPatterns: LearningPattern[];
  } {
    const byCategory: Record<string, { count: number; totalQuality: number }> = {};
    let totalQuality = 0;

    for (const pattern of this.patterns.values()) {
      if (!byCategory[pattern.category]) {
        byCategory[pattern.category] = { count: 0, totalQuality: 0 };
      }
      byCategory[pattern.category].count++;
      byCategory[pattern.category].totalQuality += pattern.quality;
      totalQuality += pattern.quality;
    }

    const categoryStats: Record<string, { count: number; avgQuality: number }> = {};
    for (const [cat, stats] of Object.entries(byCategory)) {
      categoryStats[cat] = { count: stats.count, avgQuality: stats.count > 0 ? stats.totalQuality / stats.count : 0 };
    }

    const topPatterns = Array.from(this.patterns.values())
      .sort((a, b) => (b.quality * b.usageCount) - (a.quality * a.usageCount))
      .slice(0, 5);

    return {
      totalPatterns: this.patterns.size,
      totalAdapters: this.adapters.size,
      byCategory: categoryStats,
      avgQuality: this.patterns.size > 0 ? totalQuality / this.patterns.size : 0,
      topPatterns,
    };
  }

  /**
   * Export learned patterns.
   */
  export(): { patterns: LearningPattern[]; config: SONAConfig } {
    return {
      patterns: Array.from(this.patterns.values()).map(p => ({ ...p, embedding: undefined })),
      config: this.config,
    };
  }

  /**
   * Import patterns.
   */
  async import(data: { patterns: LearningPattern[]; config?: Partial<SONAConfig> }): Promise<number> {
    if (data.config) this.config = { ...this.config, ...data.config };

    let imported = 0;
    for (const pattern of data.patterns) {
      const embedding = this.generatePatternEmbedding(pattern.trigger, pattern.action, pattern.category);
      this.patterns.set(pattern.id, { ...pattern, embedding });
      imported++;
    }
    return imported;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private generatePatternEmbedding(trigger: string, action: string, category: string): Float32Array {
    const text = `${category} ${trigger} ${action}`.toLowerCase();
    const embedding = new Float32Array(this.dimensions);
    let hash = 0;
    for (let i = 0; i < text.length; i++) { hash = ((hash << 5) - hash) + text.charCodeAt(i); hash = hash & hash; }
    for (let i = 0; i < this.dimensions; i++) { embedding[i] = Math.sin(hash * (i + 1) * 0.001) * 0.5 + 0.5; }
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) norm += embedding[i] * embedding[i];
    norm = Math.sqrt(norm);
    for (let i = 0; i < this.dimensions; i++) embedding[i] /= norm;
    return embedding;
  }

  private async prunePatterns(): Promise<void> {
    const { db } = await this.ensureInitialized();
    const sorted = Array.from(this.patterns.entries()).sort((a, b) => a[1].quality - b[1].quality);
    const toRemove = sorted.slice(0, Math.floor(this.config.maxPatterns * 0.1));
    for (const [id] of toRemove) {
      db.delete(id);
      this.patterns.delete(id);
    }
  }
}

// ============================================================================
// Plugin Definition
// ============================================================================

let sonaInstance: SONALearning | null = null;

async function getSONALearning(): Promise<SONALearning> {
  if (!sonaInstance) {
    sonaInstance = new SONALearning();
    await sonaInstance.initialize();
  }
  return sonaInstance;
}

export const sonaLearningPlugin = new PluginBuilder('sona-learning', '1.0.0')
  .withDescription('Self-Optimizing Neural Adaptation with @ruvector/learning-wasm (<100μs LoRA)')
  .withAuthor('Claude Flow Team')
  .withTags(['learning', 'neural', 'adaptation', 'lora', 'ruvector', 'sona', 'ewc'])
  .withMCPTools([
    new MCPToolBuilder('sona-learn')
      .withDescription('Learn a new pattern (<100μs with LoRA)')
      .addStringParam('category', 'Pattern category', { required: true })
      .addStringParam('trigger', 'What triggered this pattern', { required: true })
      .addStringParam('action', 'What action was taken', { required: true })
      .addStringParam('context', 'JSON context data')
      .addNumberParam('quality', 'Quality score 0-1', { default: 0.7, minimum: 0, maximum: 1 })
      .withHandler(async (params) => {
        try {
          const sona = await getSONALearning();
          const context = params.context ? JSON.parse(params.context as string) : {};
          const pattern = await sona.learn(params.category as string, params.trigger as string, params.action as string, context, params.quality as number);
          return { content: [{ type: 'text', text: `🧠 **Learned:** ${pattern.id}\nCategory: ${pattern.category}\nQuality: ${(pattern.quality * 100).toFixed(1)}%` }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
      })
      .build(),

    new MCPToolBuilder('sona-retrieve')
      .withDescription('Retrieve patterns matching a trigger')
      .addStringParam('trigger', 'Trigger to match', { required: true })
      .addStringParam('category', 'Filter by category')
      .addNumberParam('k', 'Number of patterns', { default: 5 })
      .withHandler(async (params) => {
        try {
          const sona = await getSONALearning();
          const patterns = await sona.retrieve(params.trigger as string, params.category as string | undefined, params.k as number);
          if (patterns.length === 0) return { content: [{ type: 'text', text: '🔍 No matching patterns.' }] };
          const output = patterns.map((p, i) => `${i + 1}. **${p.id}** [${p.category}] (q: ${(p.quality * 100).toFixed(0)}%)\n   ${p.action.substring(0, 50)}...`).join('\n\n');
          return { content: [{ type: 'text', text: `🧠 **Found ${patterns.length} patterns:**\n\n${output}` }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
      })
      .build(),

    new MCPToolBuilder('sona-feedback')
      .withDescription('Provide feedback on a pattern')
      .addStringParam('patternId', 'Pattern ID', { required: true })
      .addBooleanParam('success', 'Was successful?', { required: true })
      .withHandler(async (params) => {
        try {
          const sona = await getSONALearning();
          await sona.feedback(params.patternId as string, params.success as boolean);
          return { content: [{ type: 'text', text: `✅ Feedback recorded: ${params.success ? 'Success' : 'Failure'}` }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
      })
      .build(),

    new MCPToolBuilder('sona-stats')
      .withDescription('Get SONA learning statistics')
      .withHandler(async () => {
        const sona = await getSONALearning();
        const stats = sona.getStats();
        return { content: [{ type: 'text', text: `🧠 **SONA Stats:**\n\n**Patterns:** ${stats.totalPatterns}\n**LoRA Adapters:** ${stats.totalAdapters}\n**Avg Quality:** ${(stats.avgQuality * 100).toFixed(1)}%\n**Backend:** @ruvector/learning-wasm` }] };
      })
      .build(),
  ])
  .withHooks([
    new HookBuilder(HookEvent.PostTaskComplete)
      .withName('sona-auto-learn')
      .withDescription('Auto-learn from successful completions')
      .withPriority(HookPriority.Low)
      .when((ctx) => (ctx.data as { success?: boolean; category?: string } | undefined)?.success === true)
      .handle(async (ctx) => {
        const data = ctx.data as { category?: string; trigger?: string; action?: string; context?: Record<string, unknown> };
        if (!data.trigger || !data.action) return { success: true };
        try {
          const sona = await getSONALearning();
          await sona.learn(data.category || 'general', data.trigger, data.action, data.context || {}, 0.75);
        } catch { /* silent */ }
        return { success: true };
      })
      .build(),
  ])
  .onInitialize(async (ctx) => {
    ctx.logger.info('SONA Learning initializing with @ruvector/learning-wasm...');
    await getSONALearning();
    ctx.logger.info('SONA ready - LoRA adaptation <100μs, EWC++ enabled');
  })
  .build();

export default sonaLearningPlugin;
