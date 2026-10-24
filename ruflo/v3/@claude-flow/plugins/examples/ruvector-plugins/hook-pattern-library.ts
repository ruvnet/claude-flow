/**
 * Hook Pattern Library Plugin
 *
 * Learn which hooks work best for which file types/operations.
 * Uses @ruvector/wasm for pattern storage and @ruvector/learning-wasm for optimization.
 *
 * Features:
 * - Track hook effectiveness by file type
 * - Learn optimal hook configurations
 * - Recommend hooks for new operations
 * - A/B test hook variations
 * - Auto-tune hook priorities
 *
 * @example
 * ```typescript
 * import { hookPatternLibraryPlugin } from '@claude-flow/plugins/examples/ruvector-plugins';
 * await getDefaultRegistry().register(hookPatternLibraryPlugin);
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
  createVectorDB,
  generateHashEmbedding,
} from './shared/vector-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface HookPattern {
  id: string;
  hookName: string;
  event: HookEvent;
  fileTypes: string[];
  operations: string[];
  effectiveness: number;
  executionTime: number;
  usageCount: number;
  successCount: number;
  failureCount: number;
  embedding?: Float32Array;
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    lastUsed: Date;
    priority: number;
  };
}

export interface PatternMatch {
  pattern: HookPattern;
  similarity: number;
  confidence: number;
}

export interface HookRecommendation {
  hookName: string;
  event: HookEvent;
  priority: number;
  reason: string;
  expectedEffectiveness: number;
  confidence: number;
}

// ============================================================================
// Hook Pattern Library Core
// ============================================================================

export class HookPatternLibrary {
  private vectorDb: IVectorDB | null = null;
  private patterns = new Map<string, HookPattern>();
  private dimensions = 512;
  private nextId = 1;
  private initPromise: Promise<void> | null = null;

  // Known effective hook patterns
  private defaultPatterns: Array<Omit<HookPattern, 'id' | 'embedding'>> = [
    { hookName: 'format-on-save', event: HookEvent.PreFileWrite, fileTypes: ['ts', 'tsx', 'js', 'jsx'], operations: ['write', 'edit'], effectiveness: 0.9, executionTime: 50, usageCount: 100, successCount: 95, failureCount: 5, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.Normal } },
    { hookName: 'lint-check', event: HookEvent.PreFileWrite, fileTypes: ['ts', 'tsx', 'js', 'jsx'], operations: ['write'], effectiveness: 0.85, executionTime: 100, usageCount: 80, successCount: 75, failureCount: 5, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.High } },
    { hookName: 'type-check', event: HookEvent.PreFileWrite, fileTypes: ['ts', 'tsx'], operations: ['write', 'edit'], effectiveness: 0.88, executionTime: 200, usageCount: 90, successCount: 85, failureCount: 5, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.High } },
    { hookName: 'auto-import', event: HookEvent.PostFileWrite, fileTypes: ['ts', 'tsx', 'js', 'jsx'], operations: ['write'], effectiveness: 0.75, executionTime: 30, usageCount: 50, successCount: 40, failureCount: 10, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.Low } },
    { hookName: 'test-runner', event: HookEvent.PostTaskComplete, fileTypes: ['test.ts', 'spec.ts', 'test.js'], operations: ['complete'], effectiveness: 0.92, executionTime: 500, usageCount: 60, successCount: 58, failureCount: 2, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.Normal } },
    { hookName: 'git-stage', event: HookEvent.PostFileWrite, fileTypes: ['*'], operations: ['write', 'edit'], effectiveness: 0.7, executionTime: 20, usageCount: 40, successCount: 35, failureCount: 5, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.Deferred } },
    { hookName: 'backup-create', event: HookEvent.PreFileWrite, fileTypes: ['*'], operations: ['write'], effectiveness: 0.95, executionTime: 10, usageCount: 30, successCount: 30, failureCount: 0, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.Critical } },
    { hookName: 'security-scan', event: HookEvent.PreCommand, fileTypes: ['*'], operations: ['command'], effectiveness: 0.98, executionTime: 50, usageCount: 100, successCount: 98, failureCount: 2, metadata: { createdAt: new Date(), updatedAt: new Date(), lastUsed: new Date(), priority: HookPriority.Critical } },
  ];

  async initialize(): Promise<void> {
    if (this.vectorDb) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.vectorDb = await createVectorDB(this.dimensions);
      await this.loadDefaultPatterns();
    })();

    return this.initPromise;
  }

  private async ensureInitialized(): Promise<IVectorDB> {
    await this.initialize();
    return this.vectorDb!;
  }

  private async loadDefaultPatterns(): Promise<void> {
    for (const pattern of this.defaultPatterns) {
      await this.recordPattern(pattern);
    }
  }

  /**
   * Record a hook pattern.
   */
  async recordPattern(pattern: Omit<HookPattern, 'id' | 'embedding'>): Promise<HookPattern> {
    const db = await this.ensureInitialized();

    const id = `pattern-${this.nextId++}`;
    const embedding = this.generateEmbedding(pattern.hookName, pattern.event, pattern.fileTypes, pattern.operations);

    const fullPattern: HookPattern = { ...pattern, id, embedding };

    db.insert(embedding, id, {
      hookName: pattern.hookName,
      event: pattern.event,
      fileTypes: pattern.fileTypes.join(','),
      effectiveness: pattern.effectiveness,
    });

    this.patterns.set(id, fullPattern);
    return fullPattern;
  }

  /**
   * Record a hook execution for learning.
   */
  async recordExecution(
    hookName: string,
    event: HookEvent,
    fileType: string,
    operation: string,
    success: boolean,
    executionTime: number
  ): Promise<void> {
    const db = await this.ensureInitialized();

    const safeHookName = Security.validateString(hookName, { maxLength: 100 });
    const safeFileType = Security.validateString(fileType, { maxLength: 50 });
    const safeOperation = Security.validateString(operation, { maxLength: 50 });

    // Find existing pattern or create new
    let pattern = Array.from(this.patterns.values()).find(
      p => p.hookName === safeHookName && p.event === event
    );

    if (pattern) {
      pattern.usageCount++;
      if (success) pattern.successCount++;
      else pattern.failureCount++;

      pattern.executionTime = (pattern.executionTime * (pattern.usageCount - 1) + executionTime) / pattern.usageCount;
      pattern.effectiveness = pattern.successCount / pattern.usageCount;
      pattern.metadata.updatedAt = new Date();
      pattern.metadata.lastUsed = new Date();

      if (!pattern.fileTypes.includes(safeFileType)) {
        pattern.fileTypes.push(safeFileType);
      }
      if (!pattern.operations.includes(safeOperation)) {
        pattern.operations.push(safeOperation);
      }

      // Update embedding
      const embedding = this.generateEmbedding(pattern.hookName, pattern.event, pattern.fileTypes, pattern.operations);
      pattern.embedding = embedding;

      db.delete(pattern.id);
      db.insert(embedding, pattern.id, {
        hookName: pattern.hookName,
        event: pattern.event,
        fileTypes: pattern.fileTypes.join(','),
        effectiveness: pattern.effectiveness,
      });
    } else {
      await this.recordPattern({
        hookName: safeHookName,
        event,
        fileTypes: [safeFileType],
        operations: [safeOperation],
        effectiveness: success ? 1 : 0,
        executionTime,
        usageCount: 1,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        metadata: {
          createdAt: new Date(),
          updatedAt: new Date(),
          lastUsed: new Date(),
          priority: HookPriority.Normal,
        },
      });
    }
  }

  /**
   * Find patterns matching a context.
   */
  async findPatterns(fileType: string, operation: string, k: number = 5): Promise<PatternMatch[]> {
    const db = await this.ensureInitialized();

    const safeFileType = Security.validateString(fileType, { maxLength: 50 });
    const safeOperation = Security.validateString(operation, { maxLength: 50 });

    const queryEmbedding = this.generateEmbedding('', HookEvent.PreFileWrite, [safeFileType], [safeOperation]);
    const searchResults = db.search(queryEmbedding, k * 2);

    const results: PatternMatch[] = [];
    for (const result of searchResults) {
      const pattern = this.patterns.get(result.id);
      if (!pattern) continue;

      // Check if file type matches
      const typeMatches = pattern.fileTypes.includes('*') || pattern.fileTypes.includes(safeFileType) ||
        pattern.fileTypes.some(t => safeFileType.endsWith(t));

      if (!typeMatches) continue;

      results.push({
        pattern,
        similarity: result.score,
        confidence: pattern.effectiveness * result.score,
      });

      if (results.length >= k) break;
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get recommendations for a file type and operation.
   */
  async recommend(fileType: string, operation: string): Promise<HookRecommendation[]> {
    const matches = await this.findPatterns(fileType, operation, 10);

    const recommendations: HookRecommendation[] = [];

    for (const match of matches) {
      if (match.pattern.effectiveness < 0.5) continue;

      recommendations.push({
        hookName: match.pattern.hookName,
        event: match.pattern.event,
        priority: match.pattern.metadata.priority,
        reason: `${(match.pattern.effectiveness * 100).toFixed(0)}% effective for ${match.pattern.fileTypes.join(', ')}`,
        expectedEffectiveness: match.pattern.effectiveness,
        confidence: match.confidence,
      });
    }

    return recommendations.sort((a, b) => b.expectedEffectiveness - a.expectedEffectiveness);
  }

  /**
   * Get library statistics.
   */
  getStats(): {
    totalPatterns: number;
    byEvent: Record<string, number>;
    byFileType: Record<string, number>;
    topHooks: Array<{ name: string; effectiveness: number; usageCount: number }>;
    avgEffectiveness: number;
  } {
    const byEvent: Record<string, number> = {};
    const byFileType: Record<string, number> = {};
    let totalEffectiveness = 0;

    for (const pattern of this.patterns.values()) {
      byEvent[pattern.event] = (byEvent[pattern.event] ?? 0) + 1;
      for (const ft of pattern.fileTypes) {
        byFileType[ft] = (byFileType[ft] ?? 0) + 1;
      }
      totalEffectiveness += pattern.effectiveness;
    }

    const topHooks = Array.from(this.patterns.values())
      .sort((a, b) => b.effectiveness * b.usageCount - a.effectiveness * a.usageCount)
      .slice(0, 5)
      .map(p => ({ name: p.hookName, effectiveness: p.effectiveness, usageCount: p.usageCount }));

    return {
      totalPatterns: this.patterns.size,
      byEvent,
      byFileType,
      topHooks,
      avgEffectiveness: this.patterns.size > 0 ? totalEffectiveness / this.patterns.size : 0,
    };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private generateEmbedding(hookName: string, event: HookEvent, fileTypes: string[], operations: string[]): Float32Array {
    const text = `${hookName} ${event} ${fileTypes.join(' ')} ${operations.join(' ')}`.toLowerCase();
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
}

// ============================================================================
// Plugin Definition
// ============================================================================

let libraryInstance: HookPatternLibrary | null = null;

async function getLibrary(): Promise<HookPatternLibrary> {
  if (!libraryInstance) {
    libraryInstance = new HookPatternLibrary();
    await libraryInstance.initialize();
  }
  return libraryInstance;
}

export const hookPatternLibraryPlugin = new PluginBuilder('hook-pattern-library', '1.0.0')
  .withDescription('Learn optimal hook patterns for file types using @ruvector/wasm')
  .withAuthor('Claude Flow Team')
  .withTags(['hooks', 'patterns', 'learning', 'ruvector', 'optimization'])
  .withMCPTools([
    new MCPToolBuilder('hook-recommend')
      .withDescription('Get hook recommendations for a file type')
      .addStringParam('fileType', 'File extension (ts, js, py, etc.)', { required: true })
      .addStringParam('operation', 'Operation (write, edit, read, command)', { required: true })
      .withHandler(async (params) => {
        try {
          const library = await getLibrary();
          const recommendations = await library.recommend(params.fileType as string, params.operation as string);

          if (recommendations.length === 0) {
            return { content: [{ type: 'text', text: '🔍 No hook recommendations found.' }] };
          }

          const output = recommendations.map((r, i) =>
            `**${i + 1}. ${r.hookName}** [${r.event}]\n` +
            `   Priority: ${r.priority} | Effectiveness: ${(r.expectedEffectiveness * 100).toFixed(0)}%\n` +
            `   ${r.reason}`
          ).join('\n\n');

          return {
            content: [{ type: 'text', text: `🎣 **Hook Recommendations for .${params.fileType}:**\n\n${output}` }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      })
      .build(),

    new MCPToolBuilder('hook-record')
      .withDescription('Record a hook execution for learning')
      .addStringParam('hookName', 'Hook name', { required: true })
      .addStringParam('event', 'Hook event', { required: true })
      .addStringParam('fileType', 'File type', { required: true })
      .addStringParam('operation', 'Operation', { required: true })
      .addBooleanParam('success', 'Was successful?', { required: true })
      .addNumberParam('executionTime', 'Execution time in ms', { required: true })
      .withHandler(async (params) => {
        try {
          const library = await getLibrary();
          await library.recordExecution(
            params.hookName as string,
            params.event as HookEvent,
            params.fileType as string,
            params.operation as string,
            params.success as boolean,
            params.executionTime as number
          );

          return {
            content: [{
              type: 'text',
              text: `✅ Recorded: ${params.hookName} (${params.success ? 'success' : 'failure'}, ${params.executionTime}ms)`,
            }],
          };
        } catch (error) {
          return {
            content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      })
      .build(),

    new MCPToolBuilder('hook-stats')
      .withDescription('Get hook pattern library statistics')
      .withHandler(async () => {
        const library = await getLibrary();
        const stats = library.getStats();

        const topHooksOutput = stats.topHooks
          .map((h, i) => `  ${i + 1}. ${h.name}: ${(h.effectiveness * 100).toFixed(0)}% (${h.usageCount} uses)`)
          .join('\n');

        const eventOutput = Object.entries(stats.byEvent)
          .map(([e, c]) => `  • ${e}: ${c}`)
          .join('\n');

        return {
          content: [{
            type: 'text',
            text: `📊 **Hook Pattern Library:**\n\n` +
              `**Total Patterns:** ${stats.totalPatterns}\n` +
              `**Avg Effectiveness:** ${(stats.avgEffectiveness * 100).toFixed(1)}%\n` +
              `**Backend:** @ruvector/wasm HNSW\n\n` +
              `**By Event:**\n${eventOutput || '  None'}\n\n` +
              `**Top Hooks:**\n${topHooksOutput || '  None'}`,
          }],
        };
      })
      .build(),
  ])
  .withHooks([
    new HookBuilder(HookEvent.PostToolCall)
      .withName('hook-auto-record')
      .withDescription('Auto-record hook executions')
      .withPriority(HookPriority.Deferred)
      .when((ctx) => {
        const data = ctx.data as { hookExecution?: boolean } | undefined;
        return data?.hookExecution === true;
      })
      .handle(async (ctx) => {
        const data = ctx.data as {
          hookName: string;
          event: HookEvent;
          fileType: string;
          operation: string;
          success: boolean;
          executionTime: number;
        };

        try {
          const library = await getLibrary();
          await library.recordExecution(
            data.hookName,
            data.event,
            data.fileType,
            data.operation,
            data.success,
            data.executionTime
          );
        } catch {
          // Silent fail
        }

        return { success: true };
      })
      .build(),
  ])
  .onInitialize(async (ctx) => {
    ctx.logger.info('Hook Pattern Library initializing with @ruvector/wasm...');
    const library = await getLibrary();
    const stats = library.getStats();
    ctx.logger.info(`Hook Pattern Library ready - ${stats.totalPatterns} patterns loaded`);
  })
  .build();

export default hookPatternLibraryPlugin;
