/**
 * RuVector PostgreSQL Bridge - Attention Mechanisms Module
 *
 * Comprehensive implementation of all 39 attention mechanisms for the
 * RuVector PostgreSQL vector database integration.
 *
 * @module @claude-flow/plugins/integrations/ruvector/attention
 * @version 1.0.0
 */

import type {
  AttentionMechanism,
  AttentionConfig,
  AttentionInput,
  AttentionOutput,
  AttentionParams,
  AttentionStats,
  KVCache,
} from './types.js';

// ============================================================================
// Attention Mechanism Interface
// ============================================================================

/**
 * Options for configuring attention computation.
 */
export interface AttentionOptions {
  /** Number of attention heads */
  numHeads?: number;
  /** Dimension per head */
  headDim?: number;
  /** Dropout rate */
  dropout?: number;
  /** Whether to use causal masking */
  causal?: boolean;
  /** Scale factor for attention scores */
  scale?: number;
  /** Maximum sequence length */
  maxSeqLen?: number;
  /** Mechanism-specific parameters */
  params?: AttentionParams;
}

/**
 * Interface for attention mechanism implementations.
 */
export interface IAttentionMechanism {
  /** Attention mechanism type */
  readonly type: AttentionMechanism;
  /** Human-readable name */
  readonly name: string;
  /** Description of the mechanism */
  readonly description: string;
  /** Category of the mechanism */
  readonly category: AttentionCategory;

  /**
   * Compute attention output from query, keys, and values.
   */
  compute(
    query: number[],
    keys: number[][],
    values: number[][]
  ): Promise<number[]>;

  /**
   * Compute batched attention.
   */
  computeBatch(
    queries: number[][],
    keys: number[][],
    values: number[][]
  ): Promise<number[][]>;

  /**
   * Configure the attention mechanism with options.
   */
  configure(options: AttentionOptions): void;

  /**
   * Generate SQL query for PostgreSQL execution.
   */
  toSQL(input: AttentionInput): string;

  /**
   * Get current configuration.
   */
  getConfig(): AttentionConfig;
}

/**
 * Categories of attention mechanisms.
 */
export type AttentionCategory =
  | 'core'
  | 'efficient'
  | 'positional'
  | 'sparse'
  | 'linear'
  | 'graph'
  | 'temporal'
  | 'multimodal'
  | 'retrieval';

// ============================================================================
// Attention Registry
// ============================================================================

/**
 * Registry for managing attention mechanism implementations.
 */
export class AttentionRegistry {
  private mechanisms: Map<AttentionMechanism, IAttentionMechanism> = new Map();
  private categoryIndex: Map<AttentionCategory, Set<AttentionMechanism>> = new Map();

  constructor() {
    // Initialize category index
    const categories: AttentionCategory[] = [
      'core', 'efficient', 'positional', 'sparse',
      'linear', 'graph', 'temporal', 'multimodal', 'retrieval'
    ];
    categories.forEach(cat => this.categoryIndex.set(cat, new Set()));
  }

  /**
   * Register an attention mechanism implementation.
   */
  register(impl: IAttentionMechanism): void {
    this.mechanisms.set(impl.type, impl);
    this.categoryIndex.get(impl.category)?.add(impl.type);
  }

  /**
   * Get an attention mechanism by type.
   */
  get(type: AttentionMechanism): IAttentionMechanism {
    const mechanism = this.mechanisms.get(type);
    if (!mechanism) {
      throw new Error(`Attention mechanism '${type}' not registered`);
    }
    return mechanism;
  }

  /**
   * Check if a mechanism is registered.
   */
  has(type: AttentionMechanism): boolean {
    return this.mechanisms.has(type);
  }

  /**
   * List all registered attention mechanisms.
   */
  listAvailable(): AttentionMechanism[] {
    return Array.from(this.mechanisms.keys());
  }

  /**
   * List mechanisms by category.
   */
  listByCategory(category: AttentionCategory): AttentionMechanism[] {
    return Array.from(this.categoryIndex.get(category) || []);
  }

  /**
   * Get all mechanisms with metadata.
   */
  getAllWithMetadata(): Array<{
    type: AttentionMechanism;
    name: string;
    description: string;
    category: AttentionCategory;
  }> {
    return Array.from(this.mechanisms.values()).map(m => ({
      type: m.type,
      name: m.name,
      description: m.description,
      category: m.category,
    }));
  }

  /**
   * Unregister a mechanism.
   */
  unregister(type: AttentionMechanism): boolean {
    const mechanism = this.mechanisms.get(type);
    if (mechanism) {
      this.categoryIndex.get(mechanism.category)?.delete(type);
      return this.mechanisms.delete(type);
    }
    return false;
  }

  /**
   * Clear all registered mechanisms.
   */
  clear(): void {
    this.mechanisms.clear();
    this.categoryIndex.forEach(set => set.clear());
  }
}

// ============================================================================
// Base Attention Implementation
// ============================================================================

/**
 * Base class for attention mechanism implementations.
 */
export abstract class BaseAttentionMechanism implements IAttentionMechanism {
  abstract readonly type: AttentionMechanism;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly category: AttentionCategory;

  protected config: AttentionConfig;

  constructor(config?: Partial<AttentionConfig>) {
    // Note: mechanism will be set correctly via getConfig() which uses this.type
    this.config = {
      mechanism: 'multi_head' as AttentionMechanism, // Placeholder, overridden by getConfig
      numHeads: config?.numHeads ?? 8,
      headDim: config?.headDim ?? 64,
      embedDim: config?.embedDim ?? 512,
      dropout: config?.dropout ?? 0.0,
      useBias: config?.useBias ?? true,
      scale: config?.scale,
      causal: config?.causal ?? false,
      maxSeqLen: config?.maxSeqLen ?? 2048,
      params: config?.params,
    };
  }

  configure(options: AttentionOptions): void {
    if (options.numHeads !== undefined) this.config = { ...this.config, numHeads: options.numHeads };
    if (options.headDim !== undefined) this.config = { ...this.config, headDim: options.headDim };
    if (options.dropout !== undefined) this.config = { ...this.config, dropout: options.dropout };
    if (options.causal !== undefined) this.config = { ...this.config, causal: options.causal };
    if (options.scale !== undefined) this.config = { ...this.config, scale: options.scale };
    if (options.maxSeqLen !== undefined) this.config = { ...this.config, maxSeqLen: options.maxSeqLen };
    if (options.params !== undefined) this.config = { ...this.config, params: { ...this.config.params, ...options.params } };
  }

  getConfig(): AttentionConfig {
    return { ...this.config, mechanism: this.type };
  }

  abstract compute(query: number[], keys: number[][], values: number[][]): Promise<number[]>;
  abstract computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]>;
  abstract toSQL(input: AttentionInput): string;

  /**
   * Compute attention scale factor.
   */
  protected getScale(): number {
    return this.config.scale ?? Math.sqrt(this.config.headDim);
  }

  // toSQL output is executed verbatim by AttentionExecutor when a query
  // executor is configured. TypeScript types are erased at runtime, so any
  // value interpolated below must be proven numeric/boolean here: a string
  // element such as "1]'::vector); DROP TABLE t; --" would otherwise break out
  // of the quoted vector literal.
  protected sqlNumber(value: unknown, name: string): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`attention SQL: ${name} must be a finite number`);
    }
    return String(value);
  }

  protected sqlBool(value: unknown, name: string): string {
    if (typeof value !== 'boolean') {
      throw new TypeError(`attention SQL: ${name} must be a boolean`);
    }
    return value ? 'true' : 'false';
  }

  /**
   * Format vector for SQL.
   */
  protected formatVector(v: number[] | Float32Array): string {
    if (!Array.isArray(v) && !(v instanceof Float32Array)) {
      throw new TypeError('attention SQL: vector must be an array of numbers');
    }
    const arr = Array.isArray(v) ? v : Array.from(v);
    return `'[${arr.map((x, i) => this.sqlNumber(x, `vector[${i}]`)).join(',')}]'::vector`;
  }

  /**
   * Format matrix for SQL.
   */
  protected formatMatrix(m: number[][] | Float32Array[]): string {
    if (!Array.isArray(m)) {
      throw new TypeError('attention SQL: matrix must be an array of vectors');
    }
    return `ARRAY[${m.map(row => this.formatVector(row)).join(',')}]`;
  }
}

// ============================================================================
// Core Attention Implementations
// ============================================================================

/**
 * Multi-Head Attention (Transformer standard).
 */
export class MultiHeadAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'multi_head';
  readonly name = 'Multi-Head Attention';
  readonly description = 'Standard Transformer multi-head attention with parallel attention heads';
  readonly category: AttentionCategory = 'core';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    // Compute attention scores
    const scale = this.getScale();
    const scores = keys.map(k => this.dotProduct(query, k) / scale);
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    return `SELECT ruvector.multi_head_attention(${q}, ${k}, ${v}, ${this.sqlNumber(this.config.numHeads, 'numHeads')}, ${this.sqlNumber(this.getScale(), 'scale')}, ${this.sqlBool(this.config.causal, 'causal')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const max = Math.max(...x);
    const exp = x.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Self-Attention mechanism.
 */
export class SelfAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'self_attention';
  readonly name = 'Self-Attention';
  readonly description = 'Self-attention where queries, keys, and values come from the same sequence';
  readonly category: AttentionCategory = 'core';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const scale = this.getScale();
    const scores = keys.map(k => this.dotProduct(query, k) / scale);
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    return `SELECT ruvector.self_attention(${q}, ${k}, ${v}, ${this.sqlNumber(this.getScale(), 'scale')}, ${this.sqlBool(this.config.causal, 'causal')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const max = Math.max(...x);
    const exp = x.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Cross-Attention mechanism.
 */
export class CrossAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'cross_attention';
  readonly name = 'Cross-Attention';
  readonly description = 'Cross-attention between two different sequences (encoder-decoder)';
  readonly category: AttentionCategory = 'core';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const scale = this.getScale();
    const scores = keys.map(k => this.dotProduct(query, k) / scale);
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    return `SELECT ruvector.cross_attention(${q}, ${k}, ${v}, ${this.sqlNumber(this.config.numHeads, 'numHeads')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const max = Math.max(...x);
    const exp = x.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Causal (Masked) Attention for autoregressive models.
 */
export class CausalAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'causal';
  readonly name = 'Causal Attention';
  readonly description = 'Causal/masked attention for autoregressive generation (GPT-style)';
  readonly category: AttentionCategory = 'core';

  constructor(config?: Partial<AttentionConfig>) {
    super({ ...config, causal: true });
  }

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const scale = this.getScale();
    const queryIdx = keys.length - 1; // Assume query is for last position
    const scores = keys.map((k, i) => {
      if (i > queryIdx) return -Infinity; // Mask future tokens
      return this.dotProduct(query, k) / scale;
    });
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < queries.length; i++) {
      const maskedKeys = keys.slice(0, i + 1);
      const maskedValues = values.slice(0, i + 1);
      results.push(await this.compute(queries[i], maskedKeys, maskedValues));
    }
    return results;
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    return `SELECT ruvector.causal_attention(${q}, ${k}, ${v}, ${this.sqlNumber(this.config.numHeads, 'numHeads')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const filtered = x.filter(v => v !== -Infinity);
    if (filtered.length === 0) return x.map(() => 0);
    const max = Math.max(...filtered);
    const exp = x.map(v => v === -Infinity ? 0 : Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return sum > 0 ? exp.map(v => v / sum) : exp;
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Bidirectional Attention (BERT-style).
 */
export class BidirectionalAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'bidirectional';
  readonly name = 'Bidirectional Attention';
  readonly description = 'Bidirectional attention attending to all tokens (BERT-style)';
  readonly category: AttentionCategory = 'core';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const scale = this.getScale();
    const scores = keys.map(k => this.dotProduct(query, k) / scale);
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    return `SELECT ruvector.bidirectional_attention(${q}, ${k}, ${v}, ${this.sqlNumber(this.config.numHeads, 'numHeads')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const max = Math.max(...x);
    const exp = x.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Local Attention with sliding window.
 */
export class LocalAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'local_attention';
  readonly name = 'Local Attention';
  readonly description = 'Local attention with fixed window size around each position';
  readonly category: AttentionCategory = 'core';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const windowSize = this.config.params?.windowSize ?? 256;
    const scale = this.getScale();
    const queryIdx = keys.length - 1;
    const start = Math.max(0, queryIdx - Math.floor(windowSize / 2));
    const end = Math.min(keys.length, queryIdx + Math.floor(windowSize / 2) + 1);

    const scores = keys.map((k, i) => {
      if (i < start || i >= end) return -Infinity;
      return this.dotProduct(query, k) / scale;
    });
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map((q, i) => {
      const windowSize = this.config.params?.windowSize ?? 256;
      const start = Math.max(0, i - Math.floor(windowSize / 2));
      const end = Math.min(keys.length, i + Math.floor(windowSize / 2) + 1);
      return this.compute(q, keys.slice(start, end), values.slice(start, end));
    }));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    const windowSize = this.config.params?.windowSize ?? 256;
    return `SELECT ruvector.local_attention(${q}, ${k}, ${v}, ${this.sqlNumber(windowSize, 'windowSize')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const filtered = x.filter(v => v !== -Infinity);
    if (filtered.length === 0) return x.map(() => 0);
    const max = Math.max(...filtered);
    const exp = x.map(v => v === -Infinity ? 0 : Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return sum > 0 ? exp.map(v => v / sum) : exp;
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Global Attention with special global tokens.
 */
export class GlobalAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'global_attention';
  readonly name = 'Global Attention';
  readonly description = 'Global attention tokens that attend to and are attended by all positions';
  readonly category: AttentionCategory = 'core';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const scale = this.getScale();
    const scores = keys.map(k => this.dotProduct(query, k) / scale);
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    const numGlobal = this.config.params?.numGlobalTokens ?? 1;
    return `SELECT ruvector.global_attention(${q}, ${k}, ${v}, ${this.sqlNumber(numGlobal, 'numGlobal')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const max = Math.max(...x);
    const exp = x.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

// ============================================================================
// Efficient Attention Implementations
// ============================================================================

/**
 * Flash Attention - memory efficient O(N) attention.
 */
export class FlashAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'flash_attention';
  readonly name = 'Flash Attention';
  readonly description = 'Memory-efficient attention using tiling and recomputation';
  readonly category: AttentionCategory = 'efficient';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const blockSize = this.config.params?.flashBlockSize ?? 64;
    const scale = this.getScale();
    const seqLen = keys.length;
    const dim = values[0].length;

    let output = new Array(dim).fill(0);
    let maxScore = -Infinity;
    let sumExp = 0;

    // Process in blocks for memory efficiency
    for (let blockStart = 0; blockStart < seqLen; blockStart += blockSize) {
      const blockEnd = Math.min(blockStart + blockSize, seqLen);

      // Compute scores for this block
      const blockScores: number[] = [];
      for (let i = blockStart; i < blockEnd; i++) {
        blockScores.push(this.dotProduct(query, keys[i]) / scale);
      }

      // Update running max and sum
      const blockMax = Math.max(...blockScores);
      if (blockMax > maxScore) {
        const correction = Math.exp(maxScore - blockMax);
        output = output.map(v => v * correction);
        sumExp *= correction;
        maxScore = blockMax;
      }

      // Accumulate weighted values
      for (let i = 0; i < blockScores.length; i++) {
        const weight = Math.exp(blockScores[i] - maxScore);
        sumExp += weight;
        for (let j = 0; j < dim; j++) {
          output[j] += weight * values[blockStart + i][j];
        }
      }
    }

    // Normalize
    return output.map(v => v / sumExp);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    const blockSize = this.config.params?.flashBlockSize ?? 64;
    return `SELECT ruvector.flash_attention(${q}, ${k}, ${v}, ${this.sqlNumber(blockSize, 'blockSize')}, ${this.sqlNumber(this.getScale(), 'scale')}, ${this.sqlBool(this.config.causal, 'causal')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }
}

/**
 * Flash Attention V2 - improved memory efficiency.
 */
export class FlashAttentionV2 extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'flash_attention_v2';
  readonly name = 'Flash Attention V2';
  readonly description = 'Improved Flash Attention with better parallelism and reduced memory';
  readonly category: AttentionCategory = 'efficient';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    // Similar to Flash Attention but with improved block scheduling
    const blockSize = this.config.params?.flashBlockSize ?? 128;
    const scale = this.getScale();
    const seqLen = keys.length;
    const dim = values[0].length;

    let output = new Array(dim).fill(0);
    let maxScore = -Infinity;
    let sumExp = 0;

    for (let blockStart = 0; blockStart < seqLen; blockStart += blockSize) {
      const blockEnd = Math.min(blockStart + blockSize, seqLen);

      const blockScores: number[] = [];
      for (let i = blockStart; i < blockEnd; i++) {
        blockScores.push(this.dotProduct(query, keys[i]) / scale);
      }

      const blockMax = Math.max(...blockScores);
      if (blockMax > maxScore) {
        const correction = Math.exp(maxScore - blockMax);
        output = output.map(v => v * correction);
        sumExp *= correction;
        maxScore = blockMax;
      }

      for (let i = 0; i < blockScores.length; i++) {
        const weight = Math.exp(blockScores[i] - maxScore);
        sumExp += weight;
        for (let j = 0; j < dim; j++) {
          output[j] += weight * values[blockStart + i][j];
        }
      }
    }

    return output.map(v => v / sumExp);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    const blockSize = this.config.params?.flashBlockSize ?? 128;
    return `SELECT ruvector.flash_attention_v2(${q}, ${k}, ${v}, ${this.sqlNumber(blockSize, 'blockSize')}, ${this.sqlNumber(this.getScale(), 'scale')}, ${this.sqlBool(this.config.causal, 'causal')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }
}

/**
 * Memory Efficient Attention.
 */
export class MemoryEfficientAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'memory_efficient';
  readonly name = 'Memory Efficient Attention';
  readonly description = 'Attention optimized for reduced memory footprint';
  readonly category: AttentionCategory = 'efficient';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const scale = this.getScale();
    const scores = keys.map(k => this.dotProduct(query, k) / scale);
    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    // Process one at a time to minimize memory
    const results: number[][] = [];
    for (const q of queries) {
      results.push(await this.compute(q, keys, values));
    }
    return results;
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    return `SELECT ruvector.memory_efficient_attention(${q}, ${k}, ${v}, ${this.sqlNumber(this.getScale(), 'scale')}, ${this.sqlBool(this.config.params?.checkpointing ?? false, 'checkpointing')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const max = Math.max(...x);
    const exp = x.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Chunk Attention - process in chunks.
 */
export class ChunkAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'chunk_attention';
  readonly name = 'Chunk Attention';
  readonly description = 'Chunked attention processing for very long sequences';
  readonly category: AttentionCategory = 'efficient';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const chunkSize = this.config.params?.blockSize ?? 512;
    const scale = this.getScale();
    const dim = values[0].length;

    const outputs: number[][] = [];
    const chunkWeights: number[] = [];

    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunkKeys = keys.slice(i, i + chunkSize);
      const chunkValues = values.slice(i, i + chunkSize);
      const scores = chunkKeys.map(k => this.dotProduct(query, k) / scale);
      const weights = this.softmax(scores);
      const chunkOutput = this.weightedSum(chunkValues, weights);
      outputs.push(chunkOutput);
      chunkWeights.push(weights.reduce((a, b) => a + b, 0));
    }

    // Combine chunk outputs
    const totalWeight = chunkWeights.reduce((a, b) => a + b, 0);
    const result = new Array(dim).fill(0);
    for (let c = 0; c < outputs.length; c++) {
      const w = chunkWeights[c] / totalWeight;
      for (let j = 0; j < dim; j++) {
        result[j] += w * outputs[c][j];
      }
    }
    return result;
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    const chunkSize = this.config.params?.blockSize ?? 512;
    return `SELECT ruvector.chunk_attention(${q}, ${k}, ${v}, ${this.sqlNumber(chunkSize, 'chunkSize')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const max = Math.max(...x);
    const exp = x.map(v => Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(v => v / sum);
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Sliding Window Attention.
 */
export class SlidingWindowAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'sliding_window';
  readonly name = 'Sliding Window Attention';
  readonly description = 'Attention with a sliding window for each position';
  readonly category: AttentionCategory = 'efficient';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const windowSize = this.config.params?.windowSize ?? 256;
    const scale = this.getScale();
    const queryIdx = keys.length - 1;
    const halfWindow = Math.floor(windowSize / 2);

    const scores = keys.map((k, i) => {
      if (Math.abs(i - queryIdx) > halfWindow) return -Infinity;
      return this.dotProduct(query, k) / scale;
    });

    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    const windowSize = this.config.params?.windowSize ?? 256;
    const halfWindow = Math.floor(windowSize / 2);

    return Promise.all(queries.map((q, idx) => {
      const start = Math.max(0, idx - halfWindow);
      const end = Math.min(keys.length, idx + halfWindow + 1);
      const windowKeys = keys.slice(start, end);
      const windowValues = values.slice(start, end);
      return this.compute(q, windowKeys, windowValues);
    }));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    const windowSize = this.config.params?.windowSize ?? 256;
    return `SELECT ruvector.sliding_window_attention(${q}, ${k}, ${v}, ${this.sqlNumber(windowSize, 'windowSize')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const filtered = x.filter(v => v !== -Infinity);
    if (filtered.length === 0) return x.map(() => 0);
    const max = Math.max(...filtered);
    const exp = x.map(v => v === -Infinity ? 0 : Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return sum > 0 ? exp.map(v => v / sum) : exp;
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

/**
 * Dilated Attention with strided access.
 */
export class DilatedAttention extends BaseAttentionMechanism {
  readonly type: AttentionMechanism = 'dilated_attention';
  readonly name = 'Dilated Attention';
  readonly description = 'Dilated/strided attention for capturing long-range dependencies';
  readonly category: AttentionCategory = 'efficient';

  async compute(query: number[], keys: number[][], values: number[][]): Promise<number[]> {
    const dilationRate = this.config.params?.dilationRate ?? 2;
    const scale = this.getScale();

    const scores = keys.map((k, i) => {
      if (i % dilationRate !== 0) return -Infinity;
      return this.dotProduct(query, k) / scale;
    });

    const weights = this.softmax(scores);
    return this.weightedSum(values, weights);
  }

  async computeBatch(queries: number[][], keys: number[][], values: number[][]): Promise<number[][]> {
    return Promise.all(queries.map(q => this.compute(q, keys, values)));
  }

  toSQL(input: AttentionInput): string {
    const q = this.formatMatrix(input.query);
    const k = this.formatMatrix(input.key);
    const v = this.formatMatrix(input.value);
    const dilationRate = this.config.params?.dilationRate ?? 2;
    return `SELECT ruvector.dilated_attention(${q}, ${k}, ${v}, ${this.sqlNumber(dilationRate, 'dilationRate')}, ${this.sqlNumber(this.getScale(), 'scale')})`;
  }

  private dotProduct(a: number[], b: number[]): number {
    return a.reduce((sum, val, i) => sum + val * b[i], 0);
  }

  private softmax(x: number[]): number[] {
    const filtered = x.filter(v => v !== -Infinity);
    if (filtered.length === 0) return x.map(() => 0);
    const max = Math.max(...filtered);
    const exp = x.map(v => v === -Infinity ? 0 : Math.exp(v - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return sum > 0 ? exp.map(v => v / sum) : exp;
  }

  private weightedSum(values: number[][], weights: number[]): number[] {
    const dim = values[0].length;
    const result = new Array(dim).fill(0);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < dim; j++) {
        result[j] += weights[i] * values[i][j];
      }
    }
    return result;
  }
}

