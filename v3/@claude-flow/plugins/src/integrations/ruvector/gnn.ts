/**
 * RuVector PostgreSQL Bridge - Graph Neural Network (GNN) Layers Module
 *
 * Comprehensive GNN support for RuVector PostgreSQL vector database integration.
 * Implements GCN, GAT, GraphSAGE, GIN, MPNN, EdgeConv, and more.
 *
 * @module @claude-flow/plugins/integrations/ruvector/gnn
 * @version 1.0.0
 */

import type {
  GNNLayerType,
  GNNLayer,
  GraphData,
  GNNOutput,
  GNNAggregation,
  GNNStats,
  ActivationFunction,
} from './types.js';

// ============================================================================
// Constants and Configuration
// ============================================================================

/**
 * Default configuration values for GNN layers.
 */
export const GNN_DEFAULTS = {
  dropout: 0.0,
  addSelfLoops: true,
  normalize: true,
  useBias: true,
  activation: 'relu' as ActivationFunction,
  aggregation: 'mean' as GNNAggregation,
  numHeads: 1,
  negativeSlope: 0.2, // For LeakyReLU in GAT
  eps: 0.0, // For GIN
  sampleSize: 10, // For GraphSAGE
  k: 20, // For EdgeConv k-NN
} as const;

/**
 * SQL function mapping for GNN operations.
 */
export const GNN_SQL_FUNCTIONS = {
  gcn: 'ruvector.gcn_layer',
  gat: 'ruvector.gat_layer',
  gat_v2: 'ruvector.gat_v2_layer',
  sage: 'ruvector.sage_layer',
  gin: 'ruvector.gin_layer',
  mpnn: 'ruvector.mpnn_layer',
  edge_conv: 'ruvector.edge_conv_layer',
  point_conv: 'ruvector.point_conv_layer',
  transformer: 'ruvector.graph_transformer_layer',
  pna: 'ruvector.pna_layer',
  film: 'ruvector.film_layer',
  rgcn: 'ruvector.rgcn_layer',
  hgt: 'ruvector.hgt_layer',
  han: 'ruvector.han_layer',
  metapath: 'ruvector.metapath_layer',
} as const;

// ============================================================================
// Core Interfaces
// ============================================================================

/**
 * Node identifier type.
 */
export type NodeId = string | number;

/**
 * Node features representation.
 */
export interface NodeFeatures {
  /** Node IDs */
  readonly ids: NodeId[];
  /** Feature vectors [num_nodes, feature_dim] */
  readonly features: number[][];
  /** Optional node types for heterogeneous graphs */
  readonly types?: string[];
  /** Optional node labels */
  readonly labels?: number[];
}

/**
 * Edge features representation.
 */
export interface EdgeFeatures {
  /** Source node IDs */
  readonly sources: NodeId[];
  /** Target node IDs */
  readonly targets: NodeId[];
  /** Edge feature vectors [num_edges, edge_dim] (optional) */
  readonly features?: number[][];
  /** Edge weights (optional) */
  readonly weights?: number[];
  /** Edge types for heterogeneous graphs (optional) */
  readonly types?: string[];
}

/**
 * Message representation for message passing.
 */
export interface Message {
  /** Source node ID */
  readonly source: NodeId;
  /** Target node ID */
  readonly target: NodeId;
  /** Message vector */
  readonly vector: number[];
  /** Edge features (if applicable) */
  readonly edgeFeatures?: number[];
  /** Message weight */
  readonly weight?: number;
}

/**
 * Aggregation method type with extended options.
 */
export type AggregationMethod =
  | GNNAggregation
  | 'concat'
  | 'weighted_mean'
  | 'multi_head';

/**
 * Path representation for graph traversal.
 */
export interface Path {
  /** Ordered list of node IDs */
  readonly nodes: NodeId[];
  /** Total path weight/distance */
  readonly weight: number;
  /** Edge types along the path (for heterogeneous graphs) */
  readonly edgeTypes?: string[];
}

/**
 * Community detection result.
 */
export interface Community {
  /** Community identifier */
  readonly id: number;
  /** Member node IDs */
  readonly members: NodeId[];
  /** Community centroid (average features) */
  readonly centroid?: number[];
  /** Modularity score */
  readonly modularity?: number;
  /** Internal edge density */
  readonly density?: number;
}

/**
 * PageRank computation options.
 */
export interface PageRankOptions {
  /** Damping factor (default: 0.85) */
  readonly damping?: number;
  /** Maximum iterations (default: 100) */
  readonly maxIterations?: number;
  /** Convergence tolerance (default: 1e-6) */
  readonly tolerance?: number;
  /** Personalization vector (teleport probabilities) */
  readonly personalization?: Map<NodeId, number>;
  /** Whether to use weighted edges */
  readonly weighted?: boolean;
}

/**
 * Community detection options.
 */
export interface CommunityOptions {
  /** Detection algorithm */
  readonly algorithm: 'louvain' | 'label_propagation' | 'girvan_newman' | 'spectral';
  /** Resolution parameter (for Louvain) */
  readonly resolution?: number;
  /** Maximum iterations */
  readonly maxIterations?: number;
  /** Minimum community size */
  readonly minSize?: number;
  /** Random seed for reproducibility */
  readonly seed?: number;
}

/**
 * GNN layer configuration with validation.
 */
export interface GNNLayerConfig extends GNNLayer {
  /** Layer name/identifier */
  readonly name?: string;
  /** Whether to cache intermediate results */
  readonly cache?: boolean;
  /** Quantization bits for memory efficiency */
  readonly quantizeBits?: 8 | 16 | 32;
}

/**
 * Factory function type for creating GNN layers.
 */
export type GNNLayerFactory = (config: GNNLayerConfig) => IGNNLayer;

/**
 * Interface for GNN layer implementations.
 */
export interface IGNNLayer {
  /** Layer type */
  readonly type: GNNLayerType;
  /** Layer configuration */
  readonly config: GNNLayerConfig;

  /**
   * Forward pass through the GNN layer.
   * @param graph - Input graph data
   * @returns Promise resolving to GNN output
   */
  forward(graph: GraphData): Promise<GNNOutput>;

  /**
   * Message passing step.
   * @param nodes - Node features
   * @param edges - Edge features
   * @returns Promise resolving to updated node features
   */
  messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures>;

  /**
   * Aggregate messages using the specified method.
   * @param messages - Array of messages to aggregate
   * @param method - Aggregation method
   * @returns Promise resolving to aggregated vector
   */
  aggregate(messages: Message[], method: AggregationMethod): Promise<number[]>;

  /**
   * Reset layer state (if stateful).
   */
  reset(): void;

  /**
   * Generate SQL for this layer.
   * @param tableName - Target table name
   * @param options - SQL generation options
   * @returns SQL string
   */
  toSQL(tableName: string, options?: SQLGenerationOptions): string;
}

/**
 * SQL generation options.
 */
export interface SQLGenerationOptions {
  /** Schema name */
  readonly schema?: string;
  /** Node features column */
  readonly nodeColumn?: string;
  /** Edge table name */
  readonly edgeTable?: string;
  /** Whether to use prepared statements */
  readonly prepared?: boolean;
  /** Parameter prefix for prepared statements */
  readonly paramPrefix?: string;
}

// ============================================================================
// SQL Safety Helpers
// ============================================================================
//
// The toSQL()/*SQL() methods below build SQL executed verbatim by a caller's
// query executor. TypeScript types are erased at runtime, so every value
// interpolated into a query string must be validated here: an identifier
// (schema/table/column) that contains `"` or a value that contains `'` would
// otherwise let a caller break out of the surrounding quotes.

/** Identifiers (schema/table/column names) must be plain SQL identifiers. */
const SQL_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate and double-quote a SQL identifier (schema, table, or column name). */
function sqlIdent(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SQL_IDENT_RE.test(value)) {
    throw new TypeError(
      `gnn SQL: ${name} must match ${SQL_IDENT_RE} (got ${JSON.stringify(value)})`
    );
  }
  return `"${value}"`;
}

/** Validate a string and render it as a single-quoted SQL literal. */
function sqlLiteral(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`gnn SQL: ${name} must be a string (got ${JSON.stringify(value)})`);
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Validate a finite number and render it as a bare SQL numeric literal. */
function sqlNumber(value: unknown, name: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`gnn SQL: ${name} must be a finite number (got ${JSON.stringify(value)})`);
  }
  return String(value);
}

/** Validate a finite integer (optionally bounded) and render it as a bare SQL numeric literal. */
function sqlInt(value: unknown, name: string, opts: { min?: number } = {}): string {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new TypeError(`gnn SQL: ${name} must be an integer (got ${JSON.stringify(value)})`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new TypeError(`gnn SQL: ${name} must be >= ${opts.min} (got ${value})`);
  }
  return String(value);
}

/** Serialize a value to JSON and render it as a single-quoted SQL jsonb literal body. */
function sqlJson(value: unknown, name: string): string {
  let json: string;
  try {
    json = JSON.stringify(value) ?? 'null';
  } catch {
    throw new TypeError(`gnn SQL: ${name} could not be serialized to JSON`);
  }
  return `'${json.replace(/'/g, "''")}'`;
}

/** Validate a bind-parameter prefix used in prepared-statement placeholders (e.g. `$`). */
function sqlParamPrefix(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_$:]{1,16}$/.test(value)) {
    throw new TypeError(`gnn SQL: ${name} must be a short alphanumeric token (got ${JSON.stringify(value)})`);
  }
  return value;
}

// ============================================================================
// GNN Layer Registry
// ============================================================================

/**
 * Registry for managing GNN layer types and factories.
 *
 * @example
 * ```typescript
 * const registry = new GNNLayerRegistry();
 * registry.registerLayer('custom_gnn', CustomGNNFactory);
 * const layer = registry.createLayer('gcn', { inputDim: 64, outputDim: 32 });
 * ```
 */
export class GNNLayerRegistry {
  private readonly factories: Map<GNNLayerType | string, GNNLayerFactory> = new Map();
  private readonly defaultConfigs: Map<GNNLayerType | string, Partial<GNNLayerConfig>> = new Map();

  constructor() {
    // Register built-in layer factories
    this.registerBuiltinLayers();
  }

  /**
   * Register a GNN layer factory.
   * @param type - Layer type identifier
   * @param factory - Factory function
   * @param defaultConfig - Optional default configuration
   */
  registerLayer(
    type: GNNLayerType | string,
    factory: GNNLayerFactory,
    defaultConfig?: Partial<GNNLayerConfig>
  ): void {
    this.factories.set(type, factory);
    if (defaultConfig) {
      this.defaultConfigs.set(type, defaultConfig);
    }
  }

  /**
   * Unregister a GNN layer factory.
   * @param type - Layer type to remove
   * @returns Whether the layer was removed
   */
  unregisterLayer(type: GNNLayerType | string): boolean {
    this.defaultConfigs.delete(type);
    return this.factories.delete(type);
  }

  /**
   * Create a GNN layer instance.
   * @param type - Layer type
   * @param config - Layer configuration
   * @returns IGNNLayer instance
   * @throws Error if layer type is not registered
   */
  createLayer(type: GNNLayerType, config: Partial<GNNLayerConfig>): IGNNLayer {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`Unknown GNN layer type: ${type}. Available types: ${this.getLayerTypes().join(', ')}`);
    }

    const defaultConfig = this.defaultConfigs.get(type) ?? {};
    const fullConfig: GNNLayerConfig = {
      type,
      inputDim: config.inputDim ?? 64,
      outputDim: config.outputDim ?? 64,
      dropout: config.dropout ?? defaultConfig.dropout ?? GNN_DEFAULTS.dropout,
      aggregation: config.aggregation ?? defaultConfig.aggregation ?? GNN_DEFAULTS.aggregation,
      addSelfLoops: config.addSelfLoops ?? defaultConfig.addSelfLoops ?? GNN_DEFAULTS.addSelfLoops,
      normalize: config.normalize ?? defaultConfig.normalize ?? GNN_DEFAULTS.normalize,
      useBias: config.useBias ?? defaultConfig.useBias ?? GNN_DEFAULTS.useBias,
      activation: config.activation ?? defaultConfig.activation ?? GNN_DEFAULTS.activation,
      ...config,
    };

    return factory(fullConfig);
  }

  /**
   * Check if a layer type is registered.
   * @param type - Layer type to check
   * @returns Whether the layer is registered
   */
  hasLayer(type: GNNLayerType | string): boolean {
    return this.factories.has(type);
  }

  /**
   * Get all registered layer types.
   * @returns Array of layer type identifiers
   */
  getLayerTypes(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * Get default configuration for a layer type.
   * @param type - Layer type
   * @returns Default configuration or undefined
   */
  getDefaultConfig(type: GNNLayerType | string): Partial<GNNLayerConfig> | undefined {
    return this.defaultConfigs.get(type);
  }

  /**
   * Register all built-in GNN layer factories.
   */
  private registerBuiltinLayers(): void {
    // GCN - Graph Convolutional Network
    this.registerLayer('gcn', (config) => new GCNLayer(config), {
      normalize: true,
      addSelfLoops: true,
    });

    // GAT - Graph Attention Network
    this.registerLayer('gat', (config) => new GATLayer(config), {
      numHeads: 8,
      params: { negativeSlope: 0.2, concat: true },
    });

    // GAT v2 - Improved Graph Attention
    this.registerLayer('gat_v2', (config) => new GATv2Layer(config), {
      numHeads: 8,
      params: { negativeSlope: 0.2, concat: true },
    });

    // GraphSAGE - Sampling and Aggregation
    this.registerLayer('sage', (config) => new GraphSAGELayer(config), {
      aggregation: 'mean',
      params: { sampleSize: 10, samplingStrategy: 'uniform' },
    });

    // GIN - Graph Isomorphism Network
    this.registerLayer('gin', (config) => new GINLayer(config), {
      params: { eps: 0, trainEps: false },
    });

    // MPNN - Message Passing Neural Network
    this.registerLayer('mpnn', (config) => new MPNNLayer(config), {
      aggregation: 'sum',
    });

    // EdgeConv - Dynamic Edge Convolution
    this.registerLayer('edge_conv', (config) => new EdgeConvLayer(config), {
      params: { k: 20, dynamic: true },
    });

    // Point Convolution
    this.registerLayer('point_conv', (config) => new PointConvLayer(config), {
      params: { k: 16 },
    });

    // Graph Transformer
    this.registerLayer('transformer', (config) => new GraphTransformerLayer(config), {
      numHeads: 8,
      params: { numLayers: 1 },
    });

    // PNA - Principal Neighbourhood Aggregation
    this.registerLayer('pna', (config) => new PNALayer(config), {
      params: {
        aggregators: ['mean', 'sum', 'max', 'min'],
        scalers: ['identity', 'amplification', 'attenuation'],
      },
    });

    // FiLM - Feature-wise Linear Modulation
    this.registerLayer('film', (config) => new FiLMLayer(config), {});

    // RGCN - Relational Graph Convolutional Network
    this.registerLayer('rgcn', (config) => new RGCNLayer(config), {
      params: { numRelations: 1 },
    });

    // HGT - Heterogeneous Graph Transformer
    this.registerLayer('hgt', (config) => new HGTLayer(config), {
      numHeads: 8,
    });

    // HAN - Heterogeneous Attention Network
    this.registerLayer('han', (config) => new HANLayer(config), {
      numHeads: 8,
    });

    // MetaPath aggregation
    this.registerLayer('metapath', (config) => new MetaPathLayer(config), {
      params: { metapaths: [] },
    });
  }
}

// ============================================================================
// Base GNN Layer Implementation
// ============================================================================

/**
 * Abstract base class for GNN layer implementations.
 */
export abstract class BaseGNNLayer implements IGNNLayer {
  readonly type: GNNLayerType;
  readonly config: GNNLayerConfig;

  constructor(config: GNNLayerConfig) {
    this.type = config.type;
    this.config = config;
    this.validateConfig();
  }

  /**
   * Validate layer configuration.
   * @throws Error if configuration is invalid
   */
  protected validateConfig(): void {
    if (this.config.inputDim <= 0) {
      throw new Error(`Invalid inputDim: ${this.config.inputDim}. Must be positive.`);
    }
    if (this.config.outputDim <= 0) {
      throw new Error(`Invalid outputDim: ${this.config.outputDim}. Must be positive.`);
    }
    if (this.config.dropout !== undefined && (this.config.dropout < 0 || this.config.dropout > 1)) {
      throw new Error(`Invalid dropout: ${this.config.dropout}. Must be between 0 and 1.`);
    }
    if (this.config.numHeads !== undefined && this.config.numHeads <= 0) {
      throw new Error(`Invalid numHeads: ${this.config.numHeads}. Must be positive.`);
    }
  }

  abstract forward(graph: GraphData): Promise<GNNOutput>;
  abstract messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures>;

  /**
   * Aggregate messages using the specified method.
   */
  async aggregate(messages: Message[], method: AggregationMethod): Promise<number[]> {
    if (messages.length === 0) {
      return new Array(this.config.outputDim).fill(0);
    }

    const vectors = messages.map((m) => m.vector);
    const weights = messages.map((m) => m.weight ?? 1);

    switch (method) {
      case 'sum':
        return this.aggregateSum(vectors);
      case 'mean':
        return this.aggregateMean(vectors);
      case 'max':
        return this.aggregateMax(vectors);
      case 'min':
        return this.aggregateMin(vectors);
      case 'attention':
        return this.aggregateAttention(vectors, weights);
      case 'weighted_mean':
        return this.aggregateWeightedMean(vectors, weights);
      case 'softmax':
        return this.aggregateSoftmax(vectors);
      case 'power_mean':
        return this.aggregatePowerMean(vectors, 2);
      case 'std':
        return this.aggregateStd(vectors);
      case 'var':
        return this.aggregateVar(vectors);
      case 'concat':
        return this.aggregateConcat(vectors);
      case 'lstm':
        return this.aggregateLSTM(vectors);
      case 'multi_head':
        return this.aggregateMultiHead(vectors);
      default:
        return this.aggregateMean(vectors);
    }
  }

  /**
   * Reset layer state.
   */
  reset(): void {
    // Override in stateful layers
  }

  /**
   * Generate SQL for this layer.
   */
  toSQL(tableName: string, options: SQLGenerationOptions = {}): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const nodeColumn = sqlIdent(options.nodeColumn ?? 'embedding', 'nodeColumn');
    const table = sqlIdent(tableName, 'tableName');
    const edgeTable = sqlIdent(options.edgeTable ?? `${tableName}_edges`, 'edgeTable');
    // Not attacker-reachable: `this.type` is always a key of GNN_SQL_FUNCTIONS
    // (or falls back to the fixed literal below), never caller-supplied text.
    const sqlFunction = GNN_SQL_FUNCTIONS[this.type] ?? 'ruvector.gnn_layer';

    const configObj = {
      type: this.type,
      input_dim: this.config.inputDim,
      output_dim: this.config.outputDim,
      num_heads: this.config.numHeads,
      dropout: this.config.dropout,
      aggregation: this.config.aggregation,
      add_self_loops: this.config.addSelfLoops,
      normalize: this.config.normalize,
      use_bias: this.config.useBias,
      activation: this.config.activation,
      params: this.config.params,
    };

    if (options.prepared) {
      const prefix = sqlParamPrefix(options.paramPrefix ?? '$', 'paramPrefix');
      return `
SELECT ${sqlFunction}(
  (SELECT array_agg(${nodeColumn}) FROM ${schema}.${table}),
  (SELECT array_agg(ARRAY[source_id, target_id]) FROM ${schema}.${edgeTable}),
  ${prefix}1::jsonb
);`.trim();
    }

    return `
SELECT ${sqlFunction}(
  (SELECT array_agg(${nodeColumn}) FROM ${schema}.${table}),
  (SELECT array_agg(ARRAY[source_id, target_id]) FROM ${schema}.${edgeTable}),
  ${sqlJson(configObj, 'config')}::jsonb
);`.trim();
  }

  // Aggregation implementations
  protected aggregateSum(vectors: number[][]): number[] {
    const dim = vectors[0]?.length ?? 0;
    const result = new Array(dim).fill(0);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        result[i] += vec[i] ?? 0;
      }
    }
    return result;
  }

  protected aggregateMean(vectors: number[][]): number[] {
    const sum = this.aggregateSum(vectors);
    return sum.map((v) => v / vectors.length);
  }

  protected aggregateMax(vectors: number[][]): number[] {
    const dim = vectors[0]?.length ?? 0;
    const result = new Array(dim).fill(-Infinity);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        result[i] = Math.max(result[i], vec[i] ?? -Infinity);
      }
    }
    return result;
  }

  protected aggregateMin(vectors: number[][]): number[] {
    const dim = vectors[0]?.length ?? 0;
    const result = new Array(dim).fill(Infinity);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        result[i] = Math.min(result[i], vec[i] ?? Infinity);
      }
    }
    return result;
  }

  protected aggregateWeightedMean(vectors: number[][], weights: number[]): number[] {
    const dim = vectors[0]?.length ?? 0;
    const result = new Array(dim).fill(0);
    let totalWeight = 0;

    for (let j = 0; j < vectors.length; j++) {
      const w = weights[j] ?? 1;
      totalWeight += w;
      for (let i = 0; i < dim; i++) {
        result[i] += (vectors[j]?.[i] ?? 0) * w;
      }
    }

    return result.map((v) => (totalWeight > 0 ? v / totalWeight : 0));
  }

  protected aggregateAttention(vectors: number[][], weights: number[]): number[] {
    // Softmax over weights then weighted mean
    const maxWeight = Math.max(...weights);
    const expWeights = weights.map((w) => Math.exp(w - maxWeight));
    const sumExp = expWeights.reduce((a, b) => a + b, 0);
    const attentionWeights = expWeights.map((w) => w / sumExp);
    return this.aggregateWeightedMean(vectors, attentionWeights);
  }

  protected aggregateSoftmax(vectors: number[][]): number[] {
    // Softmax aggregation across vectors
    const dim = vectors[0]?.length ?? 0;
    const result = new Array(dim).fill(0);

    for (let i = 0; i < dim; i++) {
      const values = vectors.map((v) => v[i] ?? 0);
      const maxVal = Math.max(...values);
      const expValues = values.map((v) => Math.exp(v - maxVal));
      const sumExp = expValues.reduce((a, b) => a + b, 0);
      result[i] = expValues.reduce((sum, exp, j) => sum + (exp / sumExp) * values[j], 0);
    }

    return result;
  }

  protected aggregatePowerMean(vectors: number[][], p: number): number[] {
    const dim = vectors[0]?.length ?? 0;
    const result = new Array(dim).fill(0);

    for (let i = 0; i < dim; i++) {
      let sum = 0;
      for (const vec of vectors) {
        sum += Math.pow(Math.abs(vec[i] ?? 0), p);
      }
      result[i] = Math.pow(sum / vectors.length, 1 / p);
    }

    return result;
  }

  protected aggregateStd(vectors: number[][]): number[] {
    const mean = this.aggregateMean(vectors);
    const dim = mean.length;
    const variance = new Array(dim).fill(0);

    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        variance[i] += Math.pow((vec[i] ?? 0) - mean[i], 2);
      }
    }

    return variance.map((v) => Math.sqrt(v / vectors.length));
  }

  protected aggregateVar(vectors: number[][]): number[] {
    const mean = this.aggregateMean(vectors);
    const dim = mean.length;
    const variance = new Array(dim).fill(0);

    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        variance[i] += Math.pow((vec[i] ?? 0) - mean[i], 2);
      }
    }

    return variance.map((v) => v / vectors.length);
  }

  protected aggregateConcat(vectors: number[][]): number[] {
    return vectors.flat();
  }

  protected aggregateLSTM(vectors: number[][]): number[] {
    // Simplified LSTM-style aggregation (sequential processing)
    let hidden = new Array(this.config.outputDim).fill(0);
    for (const vec of vectors) {
      hidden = this.lstmCell(vec, hidden);
    }
    return hidden;
  }

  protected aggregateMultiHead(vectors: number[][]): number[] {
    // Split into heads, aggregate each, then combine
    const numHeads = this.config.numHeads ?? 1;
    const headDim = Math.floor((vectors[0]?.length ?? 0) / numHeads);
    const results: number[][] = [];

    for (let h = 0; h < numHeads; h++) {
      const headVectors = vectors.map((v) =>
        v.slice(h * headDim, (h + 1) * headDim)
      );
      results.push(this.aggregateMean(headVectors));
    }

    return results.flat();
  }

  private lstmCell(input: number[], hidden: number[]): number[] {
    // Simplified LSTM update (no learned parameters)
    const dim = hidden.length;
    const inputDim = input.length;
    const result = new Array(dim).fill(0);

    for (let i = 0; i < dim; i++) {
      const inputVal = input[i % inputDim] ?? 0;
      const hiddenVal = hidden[i] ?? 0;
      // Simple gated update
      const gate = 1 / (1 + Math.exp(-(inputVal + hiddenVal)));
      result[i] = gate * inputVal + (1 - gate) * hiddenVal;
    }

    return result;
  }

  /**
   * Apply activation function.
   */
  protected applyActivation(x: number): number {
    switch (this.config.activation) {
      case 'relu':
        return Math.max(0, x);
      case 'gelu':
        return 0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * Math.pow(x, 3))));
      case 'silu':
      case 'swish':
        return x / (1 + Math.exp(-x));
      case 'leaky_relu':
        return x >= 0 ? x : 0.01 * x;
      case 'elu':
        return x >= 0 ? x : Math.exp(x) - 1;
      case 'selu':
        const alpha = 1.6732632423543772;
        const scale = 1.0507009873554805;
        return scale * (x >= 0 ? x : alpha * (Math.exp(x) - 1));
      case 'tanh':
        return Math.tanh(x);
      case 'sigmoid':
        return 1 / (1 + Math.exp(-x));
      case 'softmax':
      case 'none':
      default:
        return x;
    }
  }

  /**
   * Apply dropout (during training).
   */
  protected applyDropout(vector: number[], training: boolean = false): number[] {
    if (!training || !this.config.dropout || this.config.dropout === 0) {
      return vector;
    }

    const scale = 1 / (1 - this.config.dropout);
    return vector.map((v) => (Math.random() > this.config.dropout! ? v * scale : 0));
  }

  /**
   * Normalize vector (L2 normalization).
   */
  protected normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? vector.map((v) => v / norm) : vector;
  }

  /**
   * Create statistics for GNN computation.
   */
  protected createStats(
    startTime: number,
    numNodes: number,
    numEdges: number,
    numIterations: number = 1
  ): GNNStats {
    return {
      forwardTimeMs: Date.now() - startTime,
      numNodes,
      numEdges,
      memoryBytes: numNodes * this.config.outputDim * 4 + numEdges * 8,
      numIterations,
    };
  }
}

// ============================================================================
// GCN Layer Implementation
// ============================================================================

/**
 * Graph Convolutional Network (GCN) layer.
 *
 * Implements spectral graph convolution with first-order approximation.
 * Reference: Kipf & Welling, "Semi-Supervised Classification with Graph Convolutional Networks" (2017)
 */
export class GCNLayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex, edgeWeights } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;

    // Build adjacency with self-loops
    const adj = this.buildAdjacency(numNodes, edgeIndex, edgeWeights);

    // Normalize adjacency (D^-0.5 * A * D^-0.5)
    const normAdj = this.config.normalize ? this.symmetricNormalize(adj, numNodes) : adj;

    // Message passing: H' = sigma(A_norm * H * W)
    const outputFeatures = this.convolve(nodeFeatures, normAdj);

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.poolGraph(outputFeatures),
      stats: this.createStats(startTime, numNodes, numEdges),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const numNodes = nodes.ids.length;
    const edgeIndex: [number[], number[]] = [
      edges.sources.map((s) => nodes.ids.indexOf(s)),
      edges.targets.map((t) => nodes.ids.indexOf(t)),
    ];

    const adj = this.buildAdjacency(numNodes, edgeIndex, edges.weights);
    const normAdj = this.config.normalize ? this.symmetricNormalize(adj, numNodes) : adj;
    const outputFeatures = this.convolve(nodes.features, normAdj);

    return {
      ids: nodes.ids,
      features: outputFeatures,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private buildAdjacency(
    numNodes: number,
    edgeIndex: [number[], number[]],
    weights?: number[]
  ): Map<number, Map<number, number>> {
    const adj = new Map<number, Map<number, number>>();

    // Initialize with self-loops if configured
    for (let i = 0; i < numNodes; i++) {
      adj.set(i, new Map());
      if (this.config.addSelfLoops) {
        adj.get(i)!.set(i, 1);
      }
    }

    // Add edges
    const [sources, targets] = edgeIndex;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const tgt = targets[i];
      const weight = weights?.[i] ?? 1;
      if (src >= 0 && src < numNodes && tgt >= 0 && tgt < numNodes) {
        adj.get(src)!.set(tgt, weight);
        // Undirected: add reverse edge
        adj.get(tgt)!.set(src, weight);
      }
    }

    return adj;
  }

  private symmetricNormalize(
    adj: Map<number, Map<number, number>>,
    numNodes: number
  ): Map<number, Map<number, number>> {
    // Compute degree
    const degree = new Array(numNodes).fill(0);
    for (let i = 0; i < numNodes; i++) {
      for (const weight of adj.get(i)!.values()) {
        degree[i] += weight;
      }
    }

    // D^-0.5 * A * D^-0.5
    const normAdj = new Map<number, Map<number, number>>();
    for (let i = 0; i < numNodes; i++) {
      normAdj.set(i, new Map());
      for (const [j, weight] of adj.get(i)!.entries()) {
        const normWeight = weight / Math.sqrt(degree[i] * degree[j] + 1e-10);
        normAdj.get(i)!.set(j, normWeight);
      }
    }

    return normAdj;
  }

  private convolve(features: number[][], adj: Map<number, Map<number, number>>): number[][] {
    const numNodes = features.length;
    const inputDim = this.config.inputDim;
    const outputDim = this.config.outputDim;
    const output: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      const aggregated = new Array(inputDim).fill(0);

      // Aggregate neighbor features
      for (const [j, weight] of adj.get(i)!.entries()) {
        const neighborFeatures = features[j] ?? new Array(inputDim).fill(0);
        for (let k = 0; k < inputDim; k++) {
          aggregated[k] += weight * (neighborFeatures[k] ?? 0);
        }
      }

      // Project to output dimension
      const projected = this.projectFeatures(aggregated, inputDim, outputDim);

      // Apply activation
      const activated = projected.map((x) => this.applyActivation(x));

      // Apply dropout
      output.push(this.applyDropout(activated));
    }

    return output;
  }

  private projectFeatures(input: number[], inputDim: number, outputDim: number): number[] {
    // Simple linear projection (in practice, this would use learned weights)
    const output = new Array(outputDim).fill(0);
    for (let i = 0; i < outputDim; i++) {
      for (let j = 0; j < inputDim; j++) {
        // Use a deterministic pseudo-weight based on position
        const weight = Math.sin((i * inputDim + j) * 0.1) * 0.5;
        output[i] += input[j] * weight;
      }
      if (this.config.useBias) {
        output[i] += 0.01; // Small bias term
      }
    }
    return output;
  }

  private poolGraph(features: number[][]): number[] {
    if (features.length === 0) return [];
    return this.aggregateMean(features);
  }
}

// ============================================================================
// GAT Layer Implementation
// ============================================================================

/**
 * Graph Attention Network (GAT) layer.
 *
 * Implements attention-based message passing.
 * Reference: Veličković et al., "Graph Attention Networks" (2018)
 */
export class GATLayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;
    const numHeads = this.config.numHeads ?? 1;
    const negativeSlope = this.config.params?.negativeSlope ?? 0.2;

    // Compute attention for each head
    const headOutputs: number[][][] = [];

    for (let h = 0; h < numHeads; h++) {
      const headDim = Math.floor(this.config.outputDim / numHeads);
      const headFeatures: number[][] = [];

      for (let i = 0; i < numNodes; i++) {
        const neighbors = this.getNeighbors(i, edgeIndex, numNodes);
        const messages: { feature: number[]; attention: number }[] = [];

        // Compute attention for each neighbor
        for (const j of neighbors) {
          const attention = this.computeAttention(
            nodeFeatures[i],
            nodeFeatures[j],
            h,
            negativeSlope
          );
          messages.push({
            feature: this.projectHead(nodeFeatures[j], h, headDim),
            attention,
          });
        }

        // Softmax attention weights
        const attentionSum = messages.reduce(
          (sum, m) => sum + Math.exp(m.attention),
          0
        );
        const normalizedMessages = messages.map((m) => ({
          feature: m.feature,
          weight: Math.exp(m.attention) / (attentionSum + 1e-10),
        }));

        // Aggregate with attention weights
        const aggregated = new Array(headDim).fill(0);
        for (const m of normalizedMessages) {
          for (let k = 0; k < headDim; k++) {
            aggregated[k] += m.weight * (m.feature[k] ?? 0);
          }
        }

        headFeatures.push(aggregated);
      }

      headOutputs.push(headFeatures);
    }

    // Combine heads (concat or average)
    const concat = this.config.params?.concat ?? true;
    const outputFeatures = this.combineHeads(headOutputs, concat);

    // Apply activation and dropout
    const finalFeatures = outputFeatures.map((f) =>
      this.applyDropout(f.map((x) => this.applyActivation(x)))
    );

    return {
      nodeEmbeddings: finalFeatures,
      graphEmbedding: this.aggregateMean(finalFeatures),
      attentionWeights: this.extractAttentionWeights(headOutputs),
      stats: this.createStats(startTime, numNodes, numEdges),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const graph: GraphData = {
      nodeFeatures: nodes.features,
      edgeIndex: [
        edges.sources.map((s) => nodes.ids.indexOf(s)),
        edges.targets.map((t) => nodes.ids.indexOf(t)),
      ],
    };

    const output = await this.forward(graph);

    return {
      ids: nodes.ids,
      features: output.nodeEmbeddings,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private getNeighbors(
    nodeIdx: number,
    edgeIndex: [number[], number[]],
    numNodes: number
  ): number[] {
    const neighbors = new Set<number>();

    // Add self-loop
    if (this.config.addSelfLoops) {
      neighbors.add(nodeIdx);
    }

    // Find neighbors from edges
    const [sources, targets] = edgeIndex;
    for (let i = 0; i < sources.length; i++) {
      if (sources[i] === nodeIdx && targets[i] < numNodes) {
        neighbors.add(targets[i]);
      }
      if (targets[i] === nodeIdx && sources[i] < numNodes) {
        neighbors.add(sources[i]);
      }
    }

    return Array.from(neighbors);
  }

  protected computeAttention(
    nodeI: number[],
    nodeJ: number[],
    head: number,
    negativeSlope: number
  ): number {
    // Compute attention score using concatenation of features
    let score = 0;
    const dim = nodeI.length;

    for (let k = 0; k < dim; k++) {
      // Simple attention mechanism (in practice, uses learned attention weights)
      const combined = (nodeI[k] ?? 0) + (nodeJ[k] ?? 0);
      score += combined * Math.sin((head * dim + k) * 0.1);
    }

    // LeakyReLU
    return score >= 0 ? score : negativeSlope * score;
  }

  private projectHead(features: number[], head: number, headDim: number): number[] {
    const output = new Array(headDim).fill(0);
    const inputDim = features.length;

    for (let i = 0; i < headDim; i++) {
      for (let j = 0; j < inputDim; j++) {
        const weight = Math.cos((head * headDim * inputDim + i * inputDim + j) * 0.05);
        output[i] += (features[j] ?? 0) * weight;
      }
    }

    return output;
  }

  private combineHeads(heads: number[][][], concat: boolean): number[][] {
    const numNodes = heads[0]?.length ?? 0;
    const result: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      if (concat) {
        // Concatenate all head outputs
        result.push(heads.flatMap((h) => h[i] ?? []));
      } else {
        // Average head outputs
        const headDim = heads[0]?.[0]?.length ?? 0;
        const averaged = new Array(headDim).fill(0);
        for (const head of heads) {
          for (let j = 0; j < headDim; j++) {
            averaged[j] += (head[i]?.[j] ?? 0) / heads.length;
          }
        }
        result.push(averaged);
      }
    }

    return result;
  }

  private extractAttentionWeights(heads: number[][][]): number[][] {
    // Return simplified attention representation
    return heads.map((h) => h.map((node) => node.reduce((a, b) => a + b, 0) / node.length));
  }
}

// ============================================================================
// GAT v2 Layer Implementation
// ============================================================================

/**
 * Graph Attention Network v2 layer.
 *
 * Improved attention mechanism with dynamic attention.
 * Reference: Brody et al., "How Attentive are Graph Attention Networks?" (2022)
 */
export class GATv2Layer extends GATLayer {
  protected override computeAttention(
    nodeI: number[],
    nodeJ: number[],
    head: number,
    negativeSlope: number
  ): number {
    // GAT v2: Apply attention AFTER concatenation and transformation
    const dim = nodeI.length;
    const combined = new Array(dim).fill(0);

    // First, transform and combine
    for (let k = 0; k < dim; k++) {
      combined[k] = (nodeI[k] ?? 0) + (nodeJ[k] ?? 0);
    }

    // Apply LeakyReLU
    for (let k = 0; k < dim; k++) {
      combined[k] = combined[k] >= 0 ? combined[k] : negativeSlope * combined[k];
    }

    // Then compute attention
    let score = 0;
    for (let k = 0; k < dim; k++) {
      score += combined[k] * Math.sin((head * dim + k) * 0.1);
    }

    return score;
  }
}

// ============================================================================
// GraphSAGE Layer Implementation
// ============================================================================

/**
 * GraphSAGE (Sample and Aggregate) layer.
 *
 * Implements inductive representation learning with neighbor sampling.
 * Reference: Hamilton et al., "Inductive Representation Learning on Large Graphs" (2017)
 */
export class GraphSAGELayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;
    const sampleSize = this.config.params?.sampleSize ?? 10;

    const outputFeatures: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      // Sample neighbors
      const allNeighbors = this.getNeighbors(i, edgeIndex, numNodes);
      const sampledNeighbors = this.sampleNeighbors(allNeighbors, sampleSize);

      // Aggregate neighbor features
      const neighborFeatures = sampledNeighbors.map((j) => nodeFeatures[j] ?? []);
      const aggregated = await this.aggregate(
        neighborFeatures.map((f) => ({ source: i, target: i, vector: f })),
        this.config.aggregation ?? 'mean'
      );

      // Concatenate with self features and project
      const selfFeatures = nodeFeatures[i] ?? [];
      const combined = [...selfFeatures, ...aggregated];
      const projected = this.projectFeatures(combined, combined.length, this.config.outputDim);

      // Normalize, activate, and apply dropout
      const normalized = this.config.normalize ? this.normalizeVector(projected) : projected;
      const activated = normalized.map((x) => this.applyActivation(x));
      outputFeatures.push(this.applyDropout(activated));
    }

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.aggregateMean(outputFeatures),
      stats: this.createStats(startTime, numNodes, numEdges),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const graph: GraphData = {
      nodeFeatures: nodes.features,
      edgeIndex: [
        edges.sources.map((s) => nodes.ids.indexOf(s)),
        edges.targets.map((t) => nodes.ids.indexOf(t)),
      ],
    };

    const output = await this.forward(graph);

    return {
      ids: nodes.ids,
      features: output.nodeEmbeddings,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private getNeighbors(
    nodeIdx: number,
    edgeIndex: [number[], number[]],
    numNodes: number
  ): number[] {
    const neighbors = new Set<number>();
    const [sources, targets] = edgeIndex;

    for (let i = 0; i < sources.length; i++) {
      if (sources[i] === nodeIdx && targets[i] < numNodes) {
        neighbors.add(targets[i]);
      }
      if (targets[i] === nodeIdx && sources[i] < numNodes) {
        neighbors.add(sources[i]);
      }
    }

    return Array.from(neighbors);
  }

  private sampleNeighbors(neighbors: number[], k: number): number[] {
    if (neighbors.length <= k) {
      return neighbors;
    }

    // Random sampling
    const sampled: number[] = [];
    const available = [...neighbors];

    for (let i = 0; i < k && available.length > 0; i++) {
      const idx = Math.floor(Math.random() * available.length);
      sampled.push(available[idx]);
      available.splice(idx, 1);
    }

    return sampled;
  }

  private projectFeatures(input: number[], inputDim: number, outputDim: number): number[] {
    const output = new Array(outputDim).fill(0);
    for (let i = 0; i < outputDim; i++) {
      for (let j = 0; j < inputDim; j++) {
        const weight = Math.sin((i * inputDim + j) * 0.1) * Math.sqrt(2 / (inputDim + outputDim));
        output[i] += (input[j] ?? 0) * weight;
      }
      if (this.config.useBias) {
        output[i] += 0.01;
      }
    }
    return output;
  }
}

// ============================================================================
// GIN Layer Implementation
// ============================================================================

/**
 * Graph Isomorphism Network (GIN) layer.
 *
 * Maximally powerful GNN for graph classification.
 * Reference: Xu et al., "How Powerful are Graph Neural Networks?" (2019)
 */
export class GINLayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;
    const eps = this.config.params?.eps ?? 0;

    const outputFeatures: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      const neighbors = this.getNeighbors(i, edgeIndex, numNodes);

      // Sum neighbor features
      const neighborSum = new Array(this.config.inputDim).fill(0);
      for (const j of neighbors) {
        const neighborFeatures = nodeFeatures[j] ?? [];
        for (let k = 0; k < this.config.inputDim; k++) {
          neighborSum[k] += neighborFeatures[k] ?? 0;
        }
      }

      // GIN update: h_v = MLP((1 + eps) * h_v + sum(h_u))
      const selfFeatures = nodeFeatures[i] ?? [];
      const combined = new Array(this.config.inputDim).fill(0);
      for (let k = 0; k < this.config.inputDim; k++) {
        combined[k] = (1 + eps) * (selfFeatures[k] ?? 0) + neighborSum[k];
      }

      // MLP (2-layer)
      const hidden = this.mlpLayer1(combined);
      const output = this.mlpLayer2(hidden);
      outputFeatures.push(this.applyDropout(output));
    }

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.aggregateSum(outputFeatures), // Sum pooling for graph classification
      stats: this.createStats(startTime, numNodes, numEdges),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const graph: GraphData = {
      nodeFeatures: nodes.features,
      edgeIndex: [
        edges.sources.map((s) => nodes.ids.indexOf(s)),
        edges.targets.map((t) => nodes.ids.indexOf(t)),
      ],
    };

    const output = await this.forward(graph);

    return {
      ids: nodes.ids,
      features: output.nodeEmbeddings,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private getNeighbors(
    nodeIdx: number,
    edgeIndex: [number[], number[]],
    numNodes: number
  ): number[] {
    const neighbors = new Set<number>();
    const [sources, targets] = edgeIndex;

    for (let i = 0; i < sources.length; i++) {
      if (sources[i] === nodeIdx && targets[i] < numNodes) {
        neighbors.add(targets[i]);
      }
      if (targets[i] === nodeIdx && sources[i] < numNodes) {
        neighbors.add(sources[i]);
      }
    }

    return Array.from(neighbors);
  }

  private mlpLayer1(input: number[]): number[] {
    const hiddenDim = this.config.hiddenDim ?? this.config.inputDim;
    const output = new Array(hiddenDim).fill(0);

    for (let i = 0; i < hiddenDim; i++) {
      for (let j = 0; j < input.length; j++) {
        const weight = Math.sin((i * input.length + j) * 0.1) * 0.5;
        output[i] += (input[j] ?? 0) * weight;
      }
      output[i] = this.applyActivation(output[i]);
    }

    return output;
  }

  private mlpLayer2(input: number[]): number[] {
    const output = new Array(this.config.outputDim).fill(0);

    for (let i = 0; i < this.config.outputDim; i++) {
      for (let j = 0; j < input.length; j++) {
        const weight = Math.cos((i * input.length + j) * 0.1) * 0.5;
        output[i] += (input[j] ?? 0) * weight;
      }
    }

    return output;
  }
}

// ============================================================================
// MPNN Layer Implementation
// ============================================================================

/**
 * Message Passing Neural Network (MPNN) layer.
 *
 * General framework for GNN with customizable message and update functions.
 * Reference: Gilmer et al., "Neural Message Passing for Quantum Chemistry" (2017)
 */
export class MPNNLayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex, edgeFeatures } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;

    let currentFeatures = nodeFeatures.map((f) => [...f]);

    // Multiple rounds of message passing
    const numIterations = this.config.params?.numLayers ?? 1;

    for (let t = 0; t < numIterations; t++) {
      const newFeatures: number[][] = [];

      for (let i = 0; i < numNodes; i++) {
        // Collect messages from neighbors
        const messages: Message[] = [];
        const [sources, targets] = edgeIndex;

        for (let e = 0; e < sources.length; e++) {
          if (targets[e] === i) {
            const j = sources[e];
            const edgeFeat = edgeFeatures?.[e];
            const message = this.messageFunction(
              currentFeatures[j] ?? [],
              currentFeatures[i] ?? [],
              edgeFeat
            );
            messages.push({
              source: j,
              target: i,
              vector: message,
              edgeFeatures: edgeFeat,
            });
          }
          if (sources[e] === i) {
            const j = targets[e];
            const edgeFeat = edgeFeatures?.[e];
            const message = this.messageFunction(
              currentFeatures[j] ?? [],
              currentFeatures[i] ?? [],
              edgeFeat
            );
            messages.push({
              source: j,
              target: i,
              vector: message,
              edgeFeatures: edgeFeat,
            });
          }
        }

        // Aggregate messages
        const aggregated = await this.aggregate(messages, this.config.aggregation ?? 'sum');

        // Update node features
        const updated = this.updateFunction(currentFeatures[i] ?? [], aggregated);
        newFeatures.push(this.applyDropout(updated));
      }

      currentFeatures = newFeatures;
    }

    return {
      nodeEmbeddings: currentFeatures,
      graphEmbedding: this.aggregateMean(currentFeatures),
      stats: this.createStats(startTime, numNodes, numEdges, numIterations),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const graph: GraphData = {
      nodeFeatures: nodes.features,
      edgeIndex: [
        edges.sources.map((s) => nodes.ids.indexOf(s)),
        edges.targets.map((t) => nodes.ids.indexOf(t)),
      ],
      edgeFeatures: edges.features,
    };

    const output = await this.forward(graph);

    return {
      ids: nodes.ids,
      features: output.nodeEmbeddings,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private messageFunction(
    sourceFeatures: number[],
    targetFeatures: number[],
    edgeFeatures?: number[]
  ): number[] {
    const dim = this.config.inputDim;
    const message = new Array(dim).fill(0);

    for (let i = 0; i < dim; i++) {
      message[i] = (sourceFeatures[i] ?? 0) * 0.5 + (targetFeatures[i] ?? 0) * 0.3;
      if (edgeFeatures && edgeFeatures[i] !== undefined) {
        message[i] += edgeFeatures[i] * 0.2;
      }
    }

    return message;
  }

  private updateFunction(nodeFeatures: number[], aggregated: number[]): number[] {
    const output = new Array(this.config.outputDim).fill(0);

    // GRU-like update
    for (let i = 0; i < this.config.outputDim; i++) {
      const nodeVal = nodeFeatures[i % nodeFeatures.length] ?? 0;
      const aggVal = aggregated[i % aggregated.length] ?? 0;
      const gate = 1 / (1 + Math.exp(-(nodeVal + aggVal)));
      output[i] = this.applyActivation(gate * aggVal + (1 - gate) * nodeVal);
    }

    return output;
  }
}

// ============================================================================
// EdgeConv Layer Implementation
// ============================================================================

/**
 * EdgeConv layer for dynamic graph convolution.
 *
 * Uses k-NN graph construction and edge features.
 * Reference: Wang et al., "Dynamic Graph CNN for Learning on Point Clouds" (2019)
 */
export class EdgeConvLayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures } = graph;
    const numNodes = nodeFeatures.length;
    const k = this.config.params?.k ?? 20;
    const dynamic = this.config.params?.dynamic ?? true;

    // Build k-NN graph
    const knnGraph = dynamic
      ? this.buildKNNGraph(nodeFeatures, k)
      : graph.edgeIndex;

    const outputFeatures: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      const neighbors = this.getKNNNeighbors(i, knnGraph);
      const selfFeatures = nodeFeatures[i] ?? [];

      // Edge features: (x_j - x_i) || x_i
      const edgeFeatures: number[][] = [];
      for (const j of neighbors) {
        const neighborFeatures = nodeFeatures[j] ?? [];
        const diff = selfFeatures.map((v, idx) => (neighborFeatures[idx] ?? 0) - v);
        edgeFeatures.push([...diff, ...selfFeatures]);
      }

      // Max pooling over edge features
      const pooled = this.maxPoolEdges(edgeFeatures);

      // MLP on pooled features
      const output = this.edgeMLP(pooled);
      outputFeatures.push(this.applyDropout(output));
    }

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.aggregateMean(outputFeatures),
      stats: this.createStats(startTime, numNodes, numNodes * k),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const graph: GraphData = {
      nodeFeatures: nodes.features,
      edgeIndex: [
        edges.sources.map((s) => nodes.ids.indexOf(s)),
        edges.targets.map((t) => nodes.ids.indexOf(t)),
      ],
    };

    const output = await this.forward(graph);

    return {
      ids: nodes.ids,
      features: output.nodeEmbeddings,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private buildKNNGraph(features: number[][], k: number): [number[], number[]] {
    const sources: number[] = [];
    const targets: number[] = [];

    for (let i = 0; i < features.length; i++) {
      const distances: { idx: number; dist: number }[] = [];

      for (let j = 0; j < features.length; j++) {
        if (i !== j) {
          const dist = this.euclideanDistance(features[i], features[j]);
          distances.push({ idx: j, dist });
        }
      }

      distances.sort((a, b) => a.dist - b.dist);
      const neighbors = distances.slice(0, k);

      for (const neighbor of neighbors) {
        sources.push(i);
        targets.push(neighbor.idx);
      }
    }

    return [sources, targets];
  }

  private euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  private getKNNNeighbors(nodeIdx: number, edgeIndex: [number[], number[]]): number[] {
    const neighbors: number[] = [];
    const [sources, targets] = edgeIndex;

    for (let i = 0; i < sources.length; i++) {
      if (sources[i] === nodeIdx) {
        neighbors.push(targets[i]);
      }
    }

    return neighbors;
  }

  private maxPoolEdges(edgeFeatures: number[][]): number[] {
    if (edgeFeatures.length === 0) {
      return new Array(this.config.inputDim * 2).fill(0);
    }
    return this.aggregateMax(edgeFeatures);
  }

  private edgeMLP(input: number[]): number[] {
    const output = new Array(this.config.outputDim).fill(0);

    for (let i = 0; i < this.config.outputDim; i++) {
      for (let j = 0; j < input.length; j++) {
        const weight = Math.sin((i * input.length + j) * 0.08) * 0.4;
        output[i] += (input[j] ?? 0) * weight;
      }
      output[i] = this.applyActivation(output[i]);
    }

    return output;
  }
}

// ============================================================================
// Additional GNN Layer Implementations (Stubs)
// ============================================================================

/**
 * Point Convolution layer for point cloud data.
 */
export class PointConvLayer extends EdgeConvLayer {
  // Extends EdgeConv with point-specific operations
}

/**
 * Graph Transformer layer.
 */
export class GraphTransformerLayer extends GATLayer {
  override async forward(graph: GraphData): Promise<GNNOutput> {
    // Add positional encoding and full attention
    const result = await super.forward(graph);

    // Apply transformer-specific operations (layer norm, residual)
    const normalizedEmbeddings = result.nodeEmbeddings.map((f) =>
      this.layerNorm(f)
    );

    return {
      ...result,
      nodeEmbeddings: normalizedEmbeddings,
    };
  }

  private layerNorm(features: number[]): number[] {
    const mean = features.reduce((a, b) => a + b, 0) / features.length;
    const variance =
      features.reduce((sum, x) => sum + (x - mean) ** 2, 0) / features.length;
    const std = Math.sqrt(variance + 1e-6);
    return features.map((x) => (x - mean) / std);
  }
}

/**
 * Principal Neighbourhood Aggregation (PNA) layer.
 */
export class PNALayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;

    const aggregators = this.config.params?.aggregators ?? ['mean', 'sum', 'max', 'min'];
    const scalers = this.config.params?.scalers ?? ['identity', 'amplification', 'attenuation'];

    const outputFeatures: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      const neighbors = this.getNeighbors(i, edgeIndex, numNodes);
      const neighborFeatures = neighbors.map((j) => nodeFeatures[j] ?? []);
      const degree = neighbors.length || 1;

      // Apply multiple aggregators
      const aggregatedResults: number[][] = [];
      for (const agg of aggregators) {
        const messages = neighborFeatures.map((f) => ({
          source: 0,
          target: i,
          vector: f,
        }));
        const result = await this.aggregate(messages, agg as AggregationMethod);
        aggregatedResults.push(result);
      }

      // Apply scalers
      const scaledResults: number[][] = [];
      for (const aggregated of aggregatedResults) {
        for (const scaler of scalers) {
          scaledResults.push(this.applyScaler(aggregated, scaler, degree));
        }
      }

      // Concatenate and project
      const combined = scaledResults.flat();
      const projected = this.projectFeatures(combined);
      outputFeatures.push(this.applyDropout(projected.map((x) => this.applyActivation(x))));
    }

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.aggregateMean(outputFeatures),
      stats: this.createStats(startTime, numNodes, numEdges),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const graph: GraphData = {
      nodeFeatures: nodes.features,
      edgeIndex: [
        edges.sources.map((s) => nodes.ids.indexOf(s)),
        edges.targets.map((t) => nodes.ids.indexOf(t)),
      ],
    };

    const output = await this.forward(graph);

    return {
      ids: nodes.ids,
      features: output.nodeEmbeddings,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private getNeighbors(
    nodeIdx: number,
    edgeIndex: [number[], number[]],
    numNodes: number
  ): number[] {
    const neighbors = new Set<number>();
    const [sources, targets] = edgeIndex;

    for (let i = 0; i < sources.length; i++) {
      if (sources[i] === nodeIdx && targets[i] < numNodes) {
        neighbors.add(targets[i]);
      }
      if (targets[i] === nodeIdx && sources[i] < numNodes) {
        neighbors.add(sources[i]);
      }
    }

    return Array.from(neighbors);
  }

  private applyScaler(
    features: number[],
    scaler: string,
    degree: number
  ): number[] {
    switch (scaler) {
      case 'amplification':
        return features.map((x) => x * Math.log(degree + 1));
      case 'attenuation':
        return features.map((x) => x / Math.log(degree + 1));
      case 'identity':
      default:
        return features;
    }
  }

  private projectFeatures(input: number[]): number[] {
    const output = new Array(this.config.outputDim).fill(0);
    for (let i = 0; i < this.config.outputDim; i++) {
      for (let j = 0; j < Math.min(input.length, 100); j++) {
        const weight = Math.sin((i * 100 + j) * 0.1) * 0.3;
        output[i] += (input[j] ?? 0) * weight;
      }
    }
    return output;
  }
}

/**
 * FiLM (Feature-wise Linear Modulation) layer.
 */
export class FiLMLayer extends BaseGNNLayer {
  async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex, edgeFeatures } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;

    const outputFeatures: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      const selfFeatures = nodeFeatures[i] ?? [];

      // Compute modulation parameters from edge features
      const { gamma, beta } = this.computeModulation(edgeFeatures ?? []);

      // Apply FiLM: gamma * x + beta
      const modulated = selfFeatures.map((x, idx) =>
        (gamma[idx % gamma.length] ?? 1) * x + (beta[idx % beta.length] ?? 0)
      );

      outputFeatures.push(this.applyDropout(modulated.map((x) => this.applyActivation(x))));
    }

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.aggregateMean(outputFeatures),
      stats: this.createStats(startTime, numNodes, numEdges),
    };
  }

  async messagePass(nodes: NodeFeatures, edges: EdgeFeatures): Promise<NodeFeatures> {
    const graph: GraphData = {
      nodeFeatures: nodes.features,
      edgeIndex: [
        edges.sources.map((s) => nodes.ids.indexOf(s)),
        edges.targets.map((t) => nodes.ids.indexOf(t)),
      ],
      edgeFeatures: edges.features,
    };

    const output = await this.forward(graph);

    return {
      ids: nodes.ids,
      features: output.nodeEmbeddings,
      types: nodes.types,
      labels: nodes.labels,
    };
  }

  private computeModulation(edgeFeatures: number[][]): { gamma: number[]; beta: number[] } {
    const dim = this.config.outputDim;
    const gamma = new Array(dim).fill(1);
    const beta = new Array(dim).fill(0);

    if (edgeFeatures.length > 0) {
      const meanEdge = this.aggregateMean(edgeFeatures);
      for (let i = 0; i < dim; i++) {
        gamma[i] = 1 + 0.1 * (meanEdge[i % meanEdge.length] ?? 0);
        beta[i] = 0.1 * (meanEdge[(i + dim / 2) % meanEdge.length] ?? 0);
      }
    }

    return { gamma, beta };
  }
}

/**
 * Relational Graph Convolutional Network (RGCN) layer.
 */
export class RGCNLayer extends GCNLayer {
  override async forward(graph: GraphData): Promise<GNNOutput> {
    const startTime = Date.now();
    const { nodeFeatures, edgeIndex, edgeTypes } = graph;
    const numNodes = nodeFeatures.length;
    const numEdges = edgeIndex[0].length;
    const numRelations = this.config.params?.numRelations ?? 1;

    // Process each relation type separately
    const relationOutputs: number[][][] = [];

    for (let r = 0; r < numRelations; r++) {
      // Filter edges by relation type
      const relationEdges = this.filterEdgesByType(edgeIndex, edgeTypes ?? [], r);

      // Apply GCN for this relation
      const relationGraph: GraphData = {
        nodeFeatures,
        edgeIndex: relationEdges,
      };

      const result = await super.forward(relationGraph);
      relationOutputs.push(result.nodeEmbeddings);
    }

    // Combine relation outputs
    const outputFeatures = this.combineRelationOutputs(relationOutputs);

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.aggregateMean(outputFeatures),
      stats: this.createStats(startTime, numNodes, numEdges),
    };
  }

  private filterEdgesByType(
    edgeIndex: [number[], number[]],
    edgeTypes: number[],
    targetType: number
  ): [number[], number[]] {
    const sources: number[] = [];
    const targets: number[] = [];
    const [srcArr, tgtArr] = edgeIndex;

    for (let i = 0; i < srcArr.length; i++) {
      if (edgeTypes[i] === targetType || edgeTypes.length === 0) {
        sources.push(srcArr[i]);
        targets.push(tgtArr[i]);
      }
    }

    return [sources, targets];
  }

  private combineRelationOutputs(outputs: number[][][]): number[][] {
    if (outputs.length === 0) return [];
    if (outputs.length === 1) return outputs[0];

    const numNodes = outputs[0].length;
    const result: number[][] = [];

    for (let i = 0; i < numNodes; i++) {
      const nodeOutputs = outputs.map((o) => o[i] ?? []);
      result.push(this.aggregateMean(nodeOutputs));
    }

    return result;
  }
}

/**
 * Heterogeneous Graph Transformer (HGT) layer.
 */
export class HGTLayer extends GATLayer {
  override async forward(graph: GraphData): Promise<GNNOutput> {
    // HGT uses type-specific transformations
    const { nodeFeatures, nodeTypes } = graph;

    // Transform features based on node types
    const transformedFeatures = nodeFeatures.map((f, i) => {
      const nodeType = nodeTypes?.[i] ?? 0;
      return this.typeSpecificTransform(f, nodeType);
    });

    const transformedGraph: GraphData = {
      ...graph,
      nodeFeatures: transformedFeatures,
    };

    return super.forward(transformedGraph);
  }

  private typeSpecificTransform(features: number[], nodeType: number): number[] {
    // Apply type-specific transformation
    return features.map((x, i) => {
      const weight = Math.sin((nodeType * this.config.inputDim + i) * 0.1);
      return x * (1 + 0.1 * weight);
    });
  }
}

/**
 * Heterogeneous Attention Network (HAN) layer.
 */
export class HANLayer extends GATLayer {
  override async forward(graph: GraphData): Promise<GNNOutput> {
    const metapaths = this.config.params?.metapaths ?? [];

    if (metapaths.length === 0) {
      return super.forward(graph);
    }

    // Process each metapath
    const metapathOutputs: number[][][] = [];

    for (const metapath of metapaths) {
      const metapathGraph = this.extractMetapathSubgraph(graph, metapath);
      const result = await super.forward(metapathGraph);
      metapathOutputs.push(result.nodeEmbeddings);
    }

    // Attention over metapaths
    const outputFeatures = this.attentionOverMetapaths(metapathOutputs);

    return {
      nodeEmbeddings: outputFeatures,
      graphEmbedding: this.aggregateMean(outputFeatures),
      stats: {
        forwardTimeMs: 0,
        numNodes: graph.nodeFeatures.length,
        numEdges: graph.edgeIndex[0].length,
        memoryBytes: 0,
        numIterations: metapaths.length,
      },
    };
  }

  private extractMetapathSubgraph(graph: GraphData, _metapath: string[]): GraphData {
    // Simplified: return original graph
    // In practice, would filter edges based on metapath
    // The _metapath parameter would be used to filter edge types
    return graph;
  }

  private attentionOverMetapaths(outputs: number[][][]): number[][] {
    if (outputs.length === 0) return [];
    if (outputs.length === 1) return outputs[0];

    const numNodes = outputs[0].length;
    const result: number[][] = [];

    // Compute attention weights for metapaths
    const metapathWeights = outputs.map((o) => {
      const importance = o.reduce(
        (sum, node) => sum + node.reduce((s, v) => s + Math.abs(v), 0),
        0
      );
      return importance;
    });

    const maxWeight = Math.max(...metapathWeights);
    const expWeights = metapathWeights.map((w) => Math.exp((w - maxWeight) / 10));
    const sumExp = expWeights.reduce((a, b) => a + b, 0);
    const normalizedWeights = expWeights.map((w) => w / sumExp);

    for (let i = 0; i < numNodes; i++) {
      const dim = outputs[0][i]?.length ?? 0;
      const combined = new Array(dim).fill(0);

      for (let m = 0; m < outputs.length; m++) {
        const nodeFeatures = outputs[m][i] ?? [];
        for (let j = 0; j < dim; j++) {
          combined[j] += normalizedWeights[m] * (nodeFeatures[j] ?? 0);
        }
      }

      result.push(combined);
    }

    return result;
  }
}

/**
 * MetaPath-based aggregation layer.
 */
export class MetaPathLayer extends HANLayer {
  // Extends HAN with metapath-specific functionality
}

// ============================================================================
// Graph Operations
// ============================================================================

/**
 * Graph operations for advanced graph analytics.
 *
 * @example
 * ```typescript
 * const ops = new GraphOperations();
 * const neighbors = await ops.kHopNeighbors('node1', 2);
 * const path = await ops.shortestPath('source', 'target');
 * const ranks = await ops.pageRank({ damping: 0.85 });
 * const communities = await ops.communityDetection({ algorithm: 'louvain' });
 * ```
 */
export class GraphOperations {
  private adjacencyList: Map<NodeId, Set<NodeId>> = new Map();
  private weights: Map<string, number> = new Map();
  private nodeFeatures: Map<NodeId, number[]> = new Map();

  /**
   * Load graph data.
   */
  loadGraph(graph: GraphData): void {
    this.adjacencyList.clear();
    this.weights.clear();
    this.nodeFeatures.clear();

    const { nodeFeatures, edgeIndex, edgeWeights } = graph;
    const [sources, targets] = edgeIndex;

    // Initialize nodes
    for (let i = 0; i < nodeFeatures.length; i++) {
      this.adjacencyList.set(i, new Set());
      this.nodeFeatures.set(i, nodeFeatures[i]);
    }

    // Add edges
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const tgt = targets[i];
      const weight = edgeWeights?.[i] ?? 1;

      this.adjacencyList.get(src)?.add(tgt);
      this.adjacencyList.get(tgt)?.add(src);
      this.weights.set(`${src}-${tgt}`, weight);
      this.weights.set(`${tgt}-${src}`, weight);
    }
  }

  /**
   * Find k-hop neighbors of a node.
   */
  async kHopNeighbors(nodeId: NodeId, k: number): Promise<NodeId[]> {
    const visited = new Set<NodeId>();
    const queue: { node: NodeId; depth: number }[] = [{ node: nodeId, depth: 0 }];
    const result: NodeId[] = [];

    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;

      if (visited.has(node)) continue;
      visited.add(node);

      if (depth > 0) {
        result.push(node);
      }

      if (depth < k) {
        const neighbors = this.adjacencyList.get(node) ?? new Set();
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            queue.push({ node: neighbor, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  /**
   * Find shortest path between two nodes using Dijkstra's algorithm.
   */
  async shortestPath(source: NodeId, target: NodeId): Promise<Path> {
    const distances = new Map<NodeId, number>();
    const previous = new Map<NodeId, NodeId | null>();
    const unvisited = new Set<NodeId>(this.adjacencyList.keys());

    for (const node of this.adjacencyList.keys()) {
      distances.set(node, Infinity);
      previous.set(node, null);
    }
    distances.set(source, 0);

    while (unvisited.size > 0) {
      // Find minimum distance node
      let current: NodeId | null = null;
      let minDist = Infinity;

      for (const node of unvisited) {
        const dist = distances.get(node) ?? Infinity;
        if (dist < minDist) {
          minDist = dist;
          current = node;
        }
      }

      if (current === null || current === target) break;

      unvisited.delete(current);

      // Update neighbors
      const neighbors = this.adjacencyList.get(current) ?? new Set();
      for (const neighbor of neighbors) {
        if (!unvisited.has(neighbor)) continue;

        const edgeWeight = this.weights.get(`${current}-${neighbor}`) ?? 1;
        const alt = (distances.get(current) ?? Infinity) + edgeWeight;

        if (alt < (distances.get(neighbor) ?? Infinity)) {
          distances.set(neighbor, alt);
          previous.set(neighbor, current);
        }
      }
    }

    // Reconstruct path
    const nodes: NodeId[] = [];
    let current: NodeId | null = target;

    while (current !== null) {
      nodes.unshift(current);
      current = previous.get(current) ?? null;
    }

    if (nodes[0] !== source) {
      return { nodes: [], weight: Infinity };
    }

    return {
      nodes,
      weight: distances.get(target) ?? Infinity,
    };
  }

  /**
   * Compute PageRank scores for all nodes.
   */
  async pageRank(options: PageRankOptions = {}): Promise<Map<NodeId, number>> {
    const damping = options.damping ?? 0.85;
    const maxIterations = options.maxIterations ?? 100;
    const tolerance = options.tolerance ?? 1e-6;

    const nodes = Array.from(this.adjacencyList.keys());
    const n = nodes.length;

    if (n === 0) return new Map();

    // Initialize ranks
    let ranks = new Map<NodeId, number>();
    const initialRank = 1 / n;

    for (const node of nodes) {
      ranks.set(node, options.personalization?.get(node) ?? initialRank);
    }

    // Power iteration
    for (let iter = 0; iter < maxIterations; iter++) {
      const newRanks = new Map<NodeId, number>();
      let diff = 0;

      for (const node of nodes) {
        let sum = 0;
        const neighbors = this.adjacencyList.get(node) ?? new Set();

        for (const neighbor of neighbors) {
          const neighborOutDegree = this.adjacencyList.get(neighbor)?.size ?? 1;
          const neighborRank = ranks.get(neighbor) ?? 0;

          if (options.weighted) {
            const weight = this.weights.get(`${neighbor}-${node}`) ?? 1;
            sum += (neighborRank * weight) / neighborOutDegree;
          } else {
            sum += neighborRank / neighborOutDegree;
          }
        }

        const teleport = options.personalization?.get(node) ?? 1 / n;
        const newRank = (1 - damping) * teleport + damping * sum;
        newRanks.set(node, newRank);

        diff += Math.abs(newRank - (ranks.get(node) ?? 0));
      }

      ranks = newRanks;

      if (diff < tolerance) break;
    }

    return ranks;
  }

  /**
   * Detect communities in the graph.
   */
  async communityDetection(options: CommunityOptions): Promise<Community[]> {
    switch (options.algorithm) {
      case 'louvain':
        return this.louvainCommunityDetection(options);
      case 'label_propagation':
        return this.labelPropagationCommunityDetection(options);
      case 'girvan_newman':
        return this.girvanNewmanCommunityDetection(options);
      case 'spectral':
        return this.spectralCommunityDetection(options);
      default:
        return this.louvainCommunityDetection(options);
    }
  }

  private async louvainCommunityDetection(options: CommunityOptions): Promise<Community[]> {
    const nodes = Array.from(this.adjacencyList.keys());
    const resolution = options.resolution ?? 1.0;
    const maxIterations = options.maxIterations ?? 100;

    // Initialize: each node is its own community
    const community = new Map<NodeId, number>();
    let nextCommunityId = 0;

    for (const node of nodes) {
      community.set(node, nextCommunityId++);
    }

    // Compute total edge weight
    let totalWeight = 0;
    for (const weight of this.weights.values()) {
      totalWeight += weight;
    }
    totalWeight /= 2; // Undirected edges counted twice

    // Phase 1: Local moving
    for (let iter = 0; iter < maxIterations; iter++) {
      let improved = false;

      for (const node of nodes) {
        const currentCommunity = community.get(node)!;
        const neighbors = this.adjacencyList.get(node) ?? new Set();

        // Find neighbor communities
        const neighborCommunities = new Set<number>();
        for (const neighbor of neighbors) {
          neighborCommunities.add(community.get(neighbor)!);
        }

        // Find best community
        let bestCommunity = currentCommunity;
        let bestModularityGain = 0;

        for (const targetCommunity of neighborCommunities) {
          if (targetCommunity === currentCommunity) continue;

          const gain = this.modularityGain(
            node,
            currentCommunity,
            targetCommunity,
            community,
            resolution,
            totalWeight
          );

          if (gain > bestModularityGain) {
            bestModularityGain = gain;
            bestCommunity = targetCommunity;
          }
        }

        if (bestCommunity !== currentCommunity) {
          community.set(node, bestCommunity);
          improved = true;
        }
      }

      if (!improved) break;
    }

    // Build communities
    const communityMembers = new Map<number, NodeId[]>();
    for (const [node, commId] of community.entries()) {
      if (!communityMembers.has(commId)) {
        communityMembers.set(commId, []);
      }
      communityMembers.get(commId)!.push(node);
    }

    // Filter by minimum size
    const minSize = options.minSize ?? 1;
    const communities: Community[] = [];

    for (const [id, members] of communityMembers.entries()) {
      if (members.length >= minSize) {
        communities.push({
          id,
          members,
          centroid: this.computeCentroid(members),
          modularity: this.computeModularity(members, community, totalWeight),
          density: this.computeDensity(members),
        });
      }
    }

    return communities;
  }

  private modularityGain(
    node: NodeId,
    fromCommunity: number,
    toCommunity: number,
    community: Map<NodeId, number>,
    resolution: number,
    totalWeight: number
  ): number {
    const neighbors = this.adjacencyList.get(node) ?? new Set();
    let linksToCommunity = 0;
    let linksFromCommunity = 0;

    for (const neighbor of neighbors) {
      const neighborCommunity = community.get(neighbor)!;
      const weight = this.weights.get(`${node}-${neighbor}`) ?? 1;

      if (neighborCommunity === toCommunity) {
        linksToCommunity += weight;
      }
      if (neighborCommunity === fromCommunity) {
        linksFromCommunity += weight;
      }
    }

    const nodeDegree = neighbors.size;

    return (
      (linksToCommunity - linksFromCommunity) / totalWeight -
      (resolution * nodeDegree * (linksToCommunity - linksFromCommunity)) /
        (2 * totalWeight * totalWeight)
    );
  }

  private computeCentroid(members: NodeId[]): number[] | undefined {
    if (members.length === 0) return undefined;

    const features = members.map((m) => this.nodeFeatures.get(m) ?? []);
    if (features[0]?.length === 0) return undefined;

    const dim = features[0].length;
    const centroid = new Array(dim).fill(0);

    for (const f of features) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += (f[i] ?? 0) / members.length;
      }
    }

    return centroid;
  }

  private computeModularity(
    members: NodeId[],
    _community: Map<NodeId, number>,
    totalWeight: number
  ): number {
    // Note: _community is passed for potential future use in computing inter-community edges
    let internalEdges = 0;
    let totalDegree = 0;

    for (const node of members) {
      const neighbors = this.adjacencyList.get(node) ?? new Set();
      totalDegree += neighbors.size;

      for (const neighbor of neighbors) {
        if (members.includes(neighbor)) {
          internalEdges += this.weights.get(`${node}-${neighbor}`) ?? 1;
        }
      }
    }

    internalEdges /= 2; // Counted twice
    const expected = (totalDegree * totalDegree) / (4 * totalWeight);

    return (internalEdges - expected) / totalWeight;
  }

  private computeDensity(members: NodeId[]): number {
    if (members.length <= 1) return 1;

    let edges = 0;
    for (const node of members) {
      const neighbors = this.adjacencyList.get(node) ?? new Set();
      for (const neighbor of neighbors) {
        if (members.includes(neighbor)) {
          edges++;
        }
      }
    }

    edges /= 2;
    const maxEdges = (members.length * (members.length - 1)) / 2;

    return edges / maxEdges;
  }

  private async labelPropagationCommunityDetection(options: CommunityOptions): Promise<Community[]> {
    const nodes = Array.from(this.adjacencyList.keys());
    const maxIterations = options.maxIterations ?? 100;

    // Initialize labels
    const labels = new Map<NodeId, number>();
    let nextLabel = 0;
    for (const node of nodes) {
      labels.set(node, nextLabel++);
    }

    // Iterate
    for (let iter = 0; iter < maxIterations; iter++) {
      let changed = false;

      // Shuffle nodes
      const shuffled = [...nodes].sort(() => Math.random() - 0.5);

      for (const node of shuffled) {
        const neighbors = this.adjacencyList.get(node) ?? new Set();
        if (neighbors.size === 0) continue;

        // Count neighbor labels
        const labelCounts = new Map<number, number>();
        for (const neighbor of neighbors) {
          const label = labels.get(neighbor)!;
          labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
        }

        // Find most common label
        let maxCount = 0;
        let bestLabel = labels.get(node)!;
        for (const [label, count] of labelCounts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            bestLabel = label;
          }
        }

        if (bestLabel !== labels.get(node)) {
          labels.set(node, bestLabel);
          changed = true;
        }
      }

      if (!changed) break;
    }

    // Build communities
    const communityMembers = new Map<number, NodeId[]>();
    for (const [node, label] of labels.entries()) {
      if (!communityMembers.has(label)) {
        communityMembers.set(label, []);
      }
      communityMembers.get(label)!.push(node);
    }

    return Array.from(communityMembers.entries()).map(([id, members]) => ({
      id,
      members,
      centroid: this.computeCentroid(members),
      density: this.computeDensity(members),
    }));
  }

  private async girvanNewmanCommunityDetection(options: CommunityOptions): Promise<Community[]> {
    // Simplified Girvan-Newman (edge betweenness)
    // In practice, this would iteratively remove high-betweenness edges
    return this.labelPropagationCommunityDetection(options);
  }

  private async spectralCommunityDetection(options: CommunityOptions): Promise<Community[]> {
    // Simplified spectral clustering
    // In practice, would use eigendecomposition of Laplacian
    return this.labelPropagationCommunityDetection(options);
  }

  /**
   * Generate SQL for k-hop neighbors query.
   */
  kHopNeighborsSQL(nodeId: string, k: number, tableName: string, options: SQLGenerationOptions = {}): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const edgeTable = sqlIdent(options.edgeTable ?? `${tableName}_edges`, 'edgeTable');
    const nodeIdLit = sqlLiteral(nodeId, 'nodeId');
    const depth = sqlInt(k, 'k', { min: 0 });

    return `
WITH RECURSIVE k_hop AS (
  SELECT source_id AS node_id, 1 AS depth
  FROM ${schema}.${edgeTable}
  WHERE target_id = ${nodeIdLit}
  UNION
  SELECT target_id AS node_id, 1 AS depth
  FROM ${schema}.${edgeTable}
  WHERE source_id = ${nodeIdLit}
  UNION ALL
  SELECT e.target_id AS node_id, kh.depth + 1
  FROM k_hop kh
  JOIN ${schema}.${edgeTable} e ON kh.node_id = e.source_id
  WHERE kh.depth < ${depth}
  UNION ALL
  SELECT e.source_id AS node_id, kh.depth + 1
  FROM k_hop kh
  JOIN ${schema}.${edgeTable} e ON kh.node_id = e.target_id
  WHERE kh.depth < ${depth}
)
SELECT DISTINCT node_id FROM k_hop WHERE node_id != ${nodeIdLit};`.trim();
  }

  /**
   * Generate SQL for shortest path query.
   */
  shortestPathSQL(source: string, target: string, tableName: string, options: SQLGenerationOptions = {}): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const edgeTable = sqlIdent(options.edgeTable ?? `${tableName}_edges`, 'edgeTable');
    const sourceLit = sqlLiteral(source, 'source');
    const targetLit = sqlLiteral(target, 'target');

    return `
WITH RECURSIVE path AS (
  SELECT
    source_id,
    target_id,
    ARRAY[source_id, target_id] AS path,
    weight AS total_weight,
    1 AS depth
  FROM ${schema}.${edgeTable}
  WHERE source_id = ${sourceLit}
  UNION ALL
  SELECT
    p.source_id,
    e.target_id,
    p.path || e.target_id,
    p.total_weight + e.weight,
    p.depth + 1
  FROM path p
  JOIN ${schema}.${edgeTable} e ON p.target_id = e.source_id
  WHERE NOT e.target_id = ANY(p.path)
    AND p.depth < 10
)
SELECT path, total_weight
FROM path
WHERE target_id = ${targetLit}
ORDER BY total_weight
LIMIT 1;`.trim();
  }

  /**
   * Generate SQL for PageRank computation.
   */
  pageRankSQL(tableName: string, options: PageRankOptions & SQLGenerationOptions = {}): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const edgeTable = sqlIdent(options.edgeTable ?? `${tableName}_edges`, 'edgeTable');
    const damping = sqlNumber(options.damping ?? 0.85, 'damping');
    const maxIterations = sqlInt(options.maxIterations ?? 100, 'maxIterations', { min: 1 });

    return `
SELECT ruvector.page_rank(
  (SELECT array_agg(ARRAY[source_id::text, target_id::text]) FROM ${schema}.${edgeTable}),
  ${damping},
  ${maxIterations}
);`.trim();
  }

  /**
   * Generate SQL for community detection.
   */
  communityDetectionSQL(tableName: string, options: CommunityOptions & SQLGenerationOptions): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const edgeTable = sqlIdent(options.edgeTable ?? `${tableName}_edges`, 'edgeTable');
    const algorithm = sqlLiteral(options.algorithm ?? 'louvain', 'algorithm');
    const resolution = sqlNumber(options.resolution ?? 1.0, 'resolution');

    return `
SELECT ruvector.community_detection(
  (SELECT array_agg(ARRAY[source_id::text, target_id::text]) FROM ${schema}.${edgeTable}),
  ${algorithm},
  ${resolution}
);`.trim();
  }
}

// ============================================================================
// SQL Generator for GNN Operations
// ============================================================================

/**
 * SQL generator for GNN operations in PostgreSQL with RuVector.
 */
export class GNNSQLGenerator {
  /**
   * Generate SQL for GNN layer forward pass.
   */
  static layerForwardSQL(
    layer: IGNNLayer,
    tableName: string,
    options: SQLGenerationOptions = {}
  ): string {
    return layer.toSQL(tableName, options);
  }

  /**
   * Generate SQL for batch GNN operations.
   */
  static batchGNNSQL(
    layers: IGNNLayer[],
    tableName: string,
    options: SQLGenerationOptions = {}
  ): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const nodeColumn = sqlIdent(options.nodeColumn ?? 'embedding', 'nodeColumn');
    const table = sqlIdent(tableName, 'tableName');
    const edgeTable = sqlIdent(options.edgeTable ?? `${tableName}_edges`, 'edgeTable');

    const layerConfigs = layers.map((l) => ({
      type: l.type,
      input_dim: l.config.inputDim,
      output_dim: l.config.outputDim,
      num_heads: l.config.numHeads,
      dropout: l.config.dropout,
      aggregation: l.config.aggregation,
      params: l.config.params,
    }));

    return `
SELECT ruvector.batch_gnn_forward(
  (SELECT array_agg(${nodeColumn}) FROM ${schema}.${table}),
  (SELECT array_agg(ARRAY[source_id, target_id]) FROM ${schema}.${edgeTable}),
  ${sqlJson(layerConfigs, 'layerConfigs')}::jsonb
);`.trim();
  }

  /**
   * Generate SQL for caching computed embeddings.
   */
  static cacheEmbeddingsSQL(
    tableName: string,
    cacheTable: string,
    options: SQLGenerationOptions = {}
  ): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const table = sqlIdent(tableName, 'tableName');
    const cache = sqlIdent(cacheTable, 'cacheTable');
    const nodeColumn = sqlIdent(options.nodeColumn ?? 'embedding', 'nodeColumn');

    return `
INSERT INTO ${schema}.${cache} (node_id, embedding, computed_at)
SELECT
  id,
  ${nodeColumn},
  NOW()
FROM ${schema}.${table}
ON CONFLICT (node_id)
DO UPDATE SET
  embedding = EXCLUDED.embedding,
  computed_at = NOW();`.trim();
  }

  /**
   * Generate SQL for creating GNN cache table.
   */
  static createCacheTableSQL(
    cacheTable: string,
    dimension: number,
    options: SQLGenerationOptions = {}
  ): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const cache = sqlIdent(cacheTable, 'cacheTable');
    const dim = sqlInt(dimension, 'dimension', { min: 1 });

    return `
CREATE TABLE IF NOT EXISTS ${schema}.${cache} (
  node_id TEXT PRIMARY KEY,
  embedding vector(${dim}) NOT NULL,
  computed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  layer_config JSONB,
  version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ${sqlIdent(`${cacheTable}_computed_at_idx`, 'cacheTable')}
ON ${schema}.${cache} (computed_at);`.trim();
  }

  /**
   * Generate SQL for message passing operation.
   */
  static messagePassingSQL(
    tableName: string,
    aggregation: GNNAggregation,
    options: SQLGenerationOptions = {}
  ): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const nodeColumn = sqlIdent(options.nodeColumn ?? 'embedding', 'nodeColumn');
    const table = sqlIdent(tableName, 'tableName');
    const edgeTable = sqlIdent(options.edgeTable ?? `${tableName}_edges`, 'edgeTable');

    const aggFunctionMap: Record<GNNAggregation, string> = {
      mean: 'avg',
      sum: 'sum',
      max: 'max',
      min: 'min',
      attention: 'attention_avg',
      lstm: 'lstm_agg',
      softmax: 'softmax_avg',
      power_mean: 'power_mean',
      std: 'std',
      var: 'var',
    };
    // Not attacker-reachable: `aggregation` is a GNNAggregation union member
    // (or falls back to the fixed 'avg' literal), never caller-supplied text.
    const aggFunction = aggFunctionMap[aggregation] ?? 'avg';

    return `
SELECT
  n.id,
  ruvector.vector_${aggFunction}(array_agg(neighbor.${nodeColumn})) AS aggregated_embedding
FROM ${schema}.${table} n
LEFT JOIN ${schema}.${edgeTable} e ON n.id = e.target_id
LEFT JOIN ${schema}.${table} neighbor ON e.source_id = neighbor.id
GROUP BY n.id;`.trim();
  }

  /**
   * Generate SQL for graph pooling.
   */
  static graphPoolingSQL(
    tableName: string,
    poolingMethod: 'mean' | 'sum' | 'max' | 'attention',
    options: SQLGenerationOptions = {}
  ): string {
    const schema = sqlIdent(options.schema ?? 'public', 'schema');
    const nodeColumn = sqlIdent(options.nodeColumn ?? 'embedding', 'nodeColumn');
    const table = sqlIdent(tableName, 'tableName');

    // Not attacker-reachable: `poolingMethod` maps through a fixed literal
    // table (or falls back to 'vector_avg'), never caller-supplied text.
    const poolFunction = {
      mean: 'vector_avg',
      sum: 'vector_sum',
      max: 'vector_max',
      attention: 'vector_attention_pool',
    }[poolingMethod] ?? 'vector_avg';

    return `
SELECT ruvector.${poolFunction}(
  (SELECT array_agg(${nodeColumn}) FROM ${schema}.${table})
) AS graph_embedding;`.trim();
  }
}

// ============================================================================
// Embedding Cache Manager
// ============================================================================

/**
 * Manager for caching computed GNN embeddings.
 */
export class GNNEmbeddingCache {
  private cache: Map<string, { embedding: number[]; timestamp: number; version: number }> =
    new Map();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number = 10000, ttlMs: number = 3600000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get cached embedding.
   */
  get(nodeId: NodeId, version?: number): number[] | undefined {
    const key = String(nodeId);
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Check version
    if (version !== undefined && entry.version !== version) {
      return undefined;
    }

    return entry.embedding;
  }

  /**
   * Set cached embedding.
   */
  set(nodeId: NodeId, embedding: number[], version: number = 1): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(String(nodeId), {
      embedding,
      timestamp: Date.now(),
      version,
    });
  }

  /**
   * Batch get embeddings.
   */
  getBatch(nodeIds: NodeId[], version?: number): Map<NodeId, number[]> {
    const result = new Map<NodeId, number[]>();

    for (const id of nodeIds) {
      const embedding = this.get(id, version);
      if (embedding) {
        result.set(id, embedding);
      }
    }

    return result;
  }

  /**
   * Batch set embeddings.
   */
  setBatch(embeddings: Map<NodeId, number[]>, version: number = 1): void {
    for (const [id, embedding] of embeddings.entries()) {
      this.set(id, embedding, version);
    }
  }

  /**
   * Clear cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: 0, // Would need to track hits/misses
    };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

// ============================================================================
// Factory and Default Instance
// ============================================================================

/**
 * Create a default GNN layer registry with all built-in layers.
 */
export function createGNNLayerRegistry(): GNNLayerRegistry {
  return new GNNLayerRegistry();
}

/**
 * Create a GNN layer with the default registry.
 */
export function createGNNLayer(type: GNNLayerType, config: Partial<GNNLayerConfig>): IGNNLayer {
  const registry = createGNNLayerRegistry();
  return registry.createLayer(type, config);
}

/**
 * Create graph operations instance.
 */
export function createGraphOperations(): GraphOperations {
  return new GraphOperations();
}

// GNN_DEFAULTS and GNN_SQL_FUNCTIONS are already exported via export const above
