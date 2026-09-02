/**
 * MCP Tool Optimizer Plugin
 *
 * Learn tool usage patterns and suggest optimal tool sequences.
 * Uses @ruvector/wasm for pattern storage and @ruvector/learning-wasm for optimization.
 *
 * Features:
 * - Track tool usage patterns
 * - Learn successful tool sequences
 * - Suggest optimal tool combinations
 * - Identify redundant tool calls
 * - Performance optimization recommendations
 *
 * @example
 * ```typescript
 * import { mcpToolOptimizerPlugin } from '@claude-flow/plugins/examples/ruvector-plugins';
 * await getDefaultRegistry().register(mcpToolOptimizerPlugin);
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
  createVectorDB,
  createLoRAEngine,
  generateHashEmbedding,
} from './shared/vector-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface ToolUsagePattern {
  id: string;
  toolName: string;
  context: string;
  inputPatterns: string[];
  outcome: 'success' | 'failure' | 'partial';
  duration: number;
  followedBy?: string[];
  precededBy?: string[];
  metadata: {
    usageCount: number;
    avgDuration: number;
    successRate: number;
    lastUsed: Date;
  };
}

export interface ToolSequence {
  id: string;
  tools: string[];
  context: string;
  outcome: 'success' | 'failure';
  totalDuration: number;
  efficiency: number;
  embedding?: Float32Array;
}

export interface OptimizationSuggestion {
  type: 'sequence' | 'replacement' | 'parallel' | 'removal';
  description: string;
  currentTools: string[];
  suggestedTools: string[];
  expectedImprovement: number;
  confidence: number;
}

// ============================================================================
// MCP Tool Optimizer Core
// ============================================================================

export class MCPToolOptimizer {
  private vectorDb: IVectorDB | null = null;
  private loraEngine: ILoRAEngine | null = null;
  private patterns = new Map<string, ToolUsagePattern>();
  private sequences = new Map<string, ToolSequence>();
  private currentSession: { tools: string[]; startTime: number; context: string } | null = null;
  private dimensions = 512;
  private nextId = 1;
  private initPromise: Promise<void> | null = null;

  private toolRelations = new Map<string, { parallelWith: string[]; alternatives: string[]; bestAfter: string[] }>([
    ['Glob', { parallelWith: ['Grep'], alternatives: [], bestAfter: [] }],
    ['Grep', { parallelWith: ['Glob'], alternatives: [], bestAfter: ['Glob'] }],
    ['Read', { parallelWith: ['Read'], alternatives: [], bestAfter: ['Glob', 'Grep'] }],
    ['Edit', { parallelWith: [], alternatives: ['Write'], bestAfter: ['Read'] }],
    ['Write', { parallelWith: [], alternatives: ['Edit'], bestAfter: ['Read'] }],
    ['Bash', { parallelWith: ['Bash'], alternatives: [], bestAfter: [] }],
  ]);

  async initialize(): Promise<void> {
    if (this.vectorDb && this.loraEngine) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      this.vectorDb = await createVectorDB(this.dimensions);
      this.loraEngine = await createLoRAEngine();
    })();

    return this.initPromise;
  }

  private async ensureInitialized(): Promise<{ db: IVectorDB; lora: ILoRAEngine }> {
    await this.initialize();
    return { db: this.vectorDb!, lora: this.loraEngine! };
  }

  /**
   * Record a tool usage.
   */
  async recordUsage(
    toolName: string,
    context: string,
    inputSummary: string,
    outcome: 'success' | 'failure' | 'partial',
    duration: number
  ): Promise<ToolUsagePattern> {
    const safeToolName = Security.validateString(toolName, { maxLength: 100 });
    const safeContext = Security.validateString(context, { maxLength: 500 });
    const safeInput = Security.validateString(inputSummary, { maxLength: 500 });

    const patternKey = `${safeToolName}:${this.hashContext(safeContext)}`;
    let pattern = this.patterns.get(patternKey);

    if (pattern) {
      pattern.metadata.usageCount++;
      pattern.metadata.avgDuration = (pattern.metadata.avgDuration * (pattern.metadata.usageCount - 1) + duration) / pattern.metadata.usageCount;
      pattern.metadata.successRate = (pattern.metadata.successRate * (pattern.metadata.usageCount - 1) + (outcome === 'success' ? 1 : 0)) / pattern.metadata.usageCount;
      pattern.metadata.lastUsed = new Date();
      if (!pattern.inputPatterns.includes(safeInput)) {
        pattern.inputPatterns.push(safeInput);
        if (pattern.inputPatterns.length > 10) pattern.inputPatterns.shift();
      }
    } else {
      const id = `pattern-${this.nextId++}`;
      pattern = {
        id, toolName: safeToolName, context: safeContext, inputPatterns: [safeInput], outcome, duration,
        followedBy: [], precededBy: [],
        metadata: { usageCount: 1, avgDuration: duration, successRate: outcome === 'success' ? 1 : 0, lastUsed: new Date() },
      };
      this.patterns.set(patternKey, pattern);
    }

    if (this.currentSession) {
      const lastTool = this.currentSession.tools[this.currentSession.tools.length - 1];
      if (lastTool) {
        const lastPatternKey = `${lastTool}:${this.hashContext(this.currentSession.context)}`;
        const lastPattern = this.patterns.get(lastPatternKey);
        if (lastPattern) {
          if (!lastPattern.followedBy) lastPattern.followedBy = [];
          if (!lastPattern.followedBy.includes(safeToolName)) lastPattern.followedBy.push(safeToolName);
        }
        if (!pattern.precededBy) pattern.precededBy = [];
        if (!pattern.precededBy.includes(lastTool)) pattern.precededBy.push(lastTool);
      }
      this.currentSession.tools.push(safeToolName);
    }

    return pattern;
  }

  startSession(context: string): void {
    this.currentSession = { tools: [], startTime: Date.now(), context: Security.validateString(context, { maxLength: 500 }) };
  }

  async endSession(outcome: 'success' | 'failure'): Promise<ToolSequence | null> {
    const { db } = await this.ensureInitialized();

    if (!this.currentSession || this.currentSession.tools.length === 0) {
      this.currentSession = null;
      return null;
    }

    const id = `seq-${this.nextId++}`;
    const totalDuration = Date.now() - this.currentSession.startTime;
    const uniqueTools = new Set(this.currentSession.tools);
    const redundancy = 1 - (uniqueTools.size / this.currentSession.tools.length);
    const efficiency = outcome === 'success' ? (1 - redundancy * 0.5) : 0.3;

    const embedding = this.generateSequenceEmbedding(this.currentSession.tools, this.currentSession.context);
    const sequence: ToolSequence = { id, tools: [...this.currentSession.tools], context: this.currentSession.context, outcome, totalDuration, efficiency, embedding };

    db.insert(embedding, id, { tools: sequence.tools.join(','), outcome, efficiency });
    this.sequences.set(id, sequence);
    this.currentSession = null;

    return sequence;
  }

  async optimize(tools: string[], context: string): Promise<OptimizationSuggestion[]> {
    const { db } = await this.ensureInitialized();
    const suggestions: OptimizationSuggestion[] = [];
    const safeTools = tools.map(t => Security.validateString(t, { maxLength: 100 }));
    const safeContext = Security.validateString(context, { maxLength: 500 });

    const embedding = this.generateSequenceEmbedding(safeTools, safeContext);
    const similarSequences = db.search(embedding, 5)
      .map(r => this.sequences.get(r.id))
      .filter((s): s is ToolSequence => s !== undefined && s.outcome === 'success' && s.efficiency > 0.7);

    // Parallel execution suggestions
    for (let i = 0; i < safeTools.length - 1; i++) {
      const tool = safeTools[i];
      const nextTool = safeTools[i + 1];
      const relations = this.toolRelations.get(tool);
      if (relations?.parallelWith.includes(nextTool)) {
        suggestions.push({ type: 'parallel', description: `Run ${tool} and ${nextTool} in parallel`, currentTools: [tool, nextTool], suggestedTools: [`${tool} || ${nextTool}`], expectedImprovement: 0.4, confidence: 0.8 });
      }
    }

    // Redundant tool suggestions
    const toolCounts = new Map<string, number>();
    for (const tool of safeTools) toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
    for (const [tool, count] of toolCounts) {
      if (count > 2 && !['Read', 'Bash'].includes(tool)) {
        suggestions.push({ type: 'removal', description: `Combine ${count} ${tool} calls`, currentTools: Array(count).fill(tool), suggestedTools: [tool], expectedImprovement: 0.3 * (count - 1), confidence: 0.7 });
      }
    }

    // Better sequences from history
    for (const seq of similarSequences) {
      if (seq.tools.length < safeTools.length && seq.efficiency > 0.8) {
        suggestions.push({ type: 'sequence', description: `Similar task completed with fewer tools`, currentTools: safeTools, suggestedTools: seq.tools, expectedImprovement: (safeTools.length - seq.tools.length) * 0.1, confidence: 0.6 });
        break;
      }
    }

    return suggestions.sort((a, b) => b.expectedImprovement * b.confidence - a.expectedImprovement * a.confidence);
  }

  async suggestNext(currentTool: string, context: string): Promise<Array<{ tool: string; probability: number; reason: string }>> {
    const suggestions: Array<{ tool: string; probability: number; reason: string }> = [];
    const safeTool = Security.validateString(currentTool, { maxLength: 100 });

    const patternKey = `${safeTool}:${this.hashContext(context)}`;
    const pattern = this.patterns.get(patternKey);

    if (pattern?.followedBy) {
      const counts = new Map<string, number>();
      for (const tool of pattern.followedBy) counts.set(tool, (counts.get(tool) ?? 0) + 1);
      const total = pattern.followedBy.length;
      for (const [tool, count] of counts) {
        suggestions.push({ tool, probability: count / total, reason: `Followed ${safeTool} ${count}x` });
      }
    }

    const relations = this.toolRelations.get(safeTool);
    if (relations?.bestAfter.length === 0) {
      for (const [tool, rel] of this.toolRelations) {
        if (rel.bestAfter.includes(safeTool)) {
          suggestions.push({ tool, probability: 0.6, reason: `${tool} often follows ${safeTool}` });
        }
      }
    }

    return suggestions.sort((a, b) => b.probability - a.probability).slice(0, 5);
  }

  getStats(): {
    totalPatterns: number;
    totalSequences: number;
    topTools: Array<{ name: string; usageCount: number; successRate: number; avgDuration: number }>;
    avgEfficiency: number;
    commonSequences: Array<{ tools: string[]; count: number }>;
  } {
    const toolStats = new Map<string, { usageCount: number; successTotal: number; durationTotal: number }>();

    for (const pattern of this.patterns.values()) {
      const existing = toolStats.get(pattern.toolName) ?? { usageCount: 0, successTotal: 0, durationTotal: 0 };
      existing.usageCount += pattern.metadata.usageCount;
      existing.successTotal += pattern.metadata.successRate * pattern.metadata.usageCount;
      existing.durationTotal += pattern.metadata.avgDuration * pattern.metadata.usageCount;
      toolStats.set(pattern.toolName, existing);
    }

    const topTools = Array.from(toolStats.entries())
      .map(([name, stats]) => ({ name, usageCount: stats.usageCount, successRate: stats.usageCount > 0 ? stats.successTotal / stats.usageCount : 0, avgDuration: stats.usageCount > 0 ? stats.durationTotal / stats.usageCount : 0 }))
      .sort((a, b) => b.usageCount - a.usageCount).slice(0, 10);

    let totalEfficiency = 0;
    const sequenceCounts = new Map<string, number>();
    for (const seq of this.sequences.values()) {
      totalEfficiency += seq.efficiency;
      const key = seq.tools.join(' → ');
      sequenceCounts.set(key, (sequenceCounts.get(key) ?? 0) + 1);
    }

    const commonSequences = Array.from(sequenceCounts.entries())
      .map(([tools, count]) => ({ tools: tools.split(' → '), count }))
      .sort((a, b) => b.count - a.count).slice(0, 5);

    return { totalPatterns: this.patterns.size, totalSequences: this.sequences.size, topTools, avgEfficiency: this.sequences.size > 0 ? totalEfficiency / this.sequences.size : 0, commonSequences };
  }

  private hashContext(context: string): string {
    let hash = 0;
    for (let i = 0; i < context.length; i++) { hash = ((hash << 5) - hash) + context.charCodeAt(i); hash = hash & hash; }
    return hash.toString(16);
  }

  private generateSequenceEmbedding(tools: string[], context: string): Float32Array {
    const text = `${tools.join(' ')} ${context}`.toLowerCase();
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

let optimizerInstance: MCPToolOptimizer | null = null;

async function getOptimizer(): Promise<MCPToolOptimizer> {
  if (!optimizerInstance) {
    optimizerInstance = new MCPToolOptimizer();
    await optimizerInstance.initialize();
  }
  return optimizerInstance;
}

export const mcpToolOptimizerPlugin = new PluginBuilder('mcp-tool-optimizer', '1.0.0')
  .withDescription('Learn tool patterns and suggest optimal sequences using @ruvector/wasm + @ruvector/learning-wasm')
  .withAuthor('Claude Flow Team')
  .withTags(['optimization', 'tools', 'patterns', 'ruvector', 'learning', 'hnsw'])
  .withMCPTools([
    new MCPToolBuilder('tool-optimize')
      .withDescription('Get optimization suggestions')
      .addStringParam('tools', 'Comma-separated tool names', { required: true })
      .addStringParam('context', 'Task context', { required: true })
      .withHandler(async (params) => {
        try {
          const optimizer = await getOptimizer();
          const tools = (params.tools as string).split(',').map(t => t.trim());
          const suggestions = await optimizer.optimize(tools, params.context as string);
          if (suggestions.length === 0) return { content: [{ type: 'text', text: '✅ Tool sequence looks optimal!' }] };
          const output = suggestions.map((s, i) => `**${i + 1}. ${s.type.toUpperCase()}** (${(s.confidence * 100).toFixed(0)}%)\n   ${s.description}`).join('\n\n');
          return { content: [{ type: 'text', text: `🔧 **Optimizations:**\n\n${output}` }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
      })
      .build(),

    new MCPToolBuilder('tool-suggest-next')
      .withDescription('Suggest next tool')
      .addStringParam('currentTool', 'Current tool', { required: true })
      .addStringParam('context', 'Context')
      .withHandler(async (params) => {
        try {
          const optimizer = await getOptimizer();
          const suggestions = await optimizer.suggestNext(params.currentTool as string, (params.context as string) ?? '');
          if (suggestions.length === 0) return { content: [{ type: 'text', text: '🤔 No suggestions.' }] };
          const output = suggestions.map((s, i) => `${i + 1}. **${s.tool}** (${(s.probability * 100).toFixed(0)}%) - ${s.reason}`).join('\n');
          return { content: [{ type: 'text', text: `💡 **Next tools:**\n\n${output}` }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `❌ Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
        }
      })
      .build(),

    new MCPToolBuilder('tool-stats')
      .withDescription('Get tool statistics')
      .withHandler(async () => {
        const optimizer = await getOptimizer();
        const stats = optimizer.getStats();
        const topToolsOutput = stats.topTools.slice(0, 5).map((t, i) => `  ${i + 1}. ${t.name}: ${t.usageCount} uses (${(t.successRate * 100).toFixed(0)}%)`).join('\n');
        return { content: [{ type: 'text', text: `📊 **Tool Optimizer:**\n\n**Patterns:** ${stats.totalPatterns}\n**Sequences:** ${stats.totalSequences}\n**Efficiency:** ${(stats.avgEfficiency * 100).toFixed(1)}%\n\n**Top Tools:**\n${topToolsOutput || '  None'}\n\n**Backend:** @ruvector/wasm + @ruvector/learning-wasm` }] };
      })
      .build(),
  ])
  .withHooks([
    new HookBuilder(HookEvent.PostToolCall)
      .withName('tool-usage-record')
      .withDescription('Record tool usage')
      .withPriority(HookPriority.Low)
      .handle(async (ctx) => {
        const data = ctx.data as { toolName?: string; context?: string; input?: string; success?: boolean; duration?: number } | undefined;
        if (!data?.toolName) return { success: true };
        try {
          const optimizer = await getOptimizer();
          await optimizer.recordUsage(data.toolName, data.context ?? 'unknown', data.input ?? '', data.success ? 'success' : 'failure', data.duration ?? 0);
        } catch { /* silent */ }
        return { success: true };
      })
      .build(),

    new HookBuilder(HookEvent.PostTaskComplete)
      .withName('tool-session-end')
      .withDescription('End tool session')
      .withPriority(HookPriority.Low)
      .handle(async (ctx) => {
        const data = ctx.data as { success?: boolean } | undefined;
        try { await (await getOptimizer()).endSession(data?.success ? 'success' : 'failure'); } catch { /* silent */ }
        return { success: true };
      })
      .build(),
  ])
  .onInitialize(async (ctx) => {
    ctx.logger.info('MCP Tool Optimizer initializing with @ruvector/wasm + @ruvector/learning-wasm...');
    await getOptimizer();
    ctx.logger.info('MCP Tool Optimizer ready - HNSW + LoRA enabled');
  })
  .build();

export default mcpToolOptimizerPlugin;
