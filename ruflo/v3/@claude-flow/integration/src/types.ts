/**
 * V3 Integration Module Types
 *
 * Type definitions for deep integration with agentic-flow@alpha.
 * Implements ADR-001: Adopt agentic-flow as Core Foundation
 *
 * @module v3/integration/types
 * @version 3.0.0-alpha.1
 */

// ===== SONA Learning Mode Types =====

/**
 * SONA (Self-Optimizing Neural Architecture) learning modes.
 * Each mode optimizes for different performance characteristics.
 */
export type SONALearningMode =
  | 'real-time'   // ~0.05ms adaptation, sub-millisecond response
  | 'balanced'    // General purpose learning, moderate latency
  | 'research'    // Deep exploration mode, higher accuracy
  | 'edge'        // Resource-constrained environments
  | 'batch';      // High-throughput processing

export interface SONAConfiguration {
  /** Active learning mode */
  mode: SONALearningMode;
  /** Learning rate for adaptation (0.0001 - 0.1) */
  learningRate: number;
  /** Pattern similarity threshold (0.0 - 1.0) */
  similarityThreshold: number;
  /** Maximum patterns to retain in memory */
  maxPatterns: number;
  /** Enable trajectory tracking for experience replay */
  enableTrajectoryTracking: boolean;
  /** Consolidation interval in milliseconds */
  consolidationInterval: number;
  /** Enable auto-mode selection based on workload */
  autoModeSelection: boolean;
}

export interface SONATrajectory {
  /** Unique trajectory identifier */
  id: string;
  /** Associated task identifier */
  taskId: string;
  /** Trajectory steps */
  steps: SONATrajectoryStep[];
  /** Start timestamp */
  startTime: number;
  /** End timestamp (if completed) */
  endTime?: number;
  /** Final verdict */
  verdict?: 'positive' | 'negative' | 'neutral';
  /** Total reward accumulated */
  totalReward: number;
  /** Metadata */
  metadata: Record<string, unknown>;
}

export interface SONATrajectoryStep {
  /** Step identifier */
  stepId: string;
  /** Action taken */
  action: string;
  /** Observation/result */
  observation: string;
  /** Step reward */
  reward: number;
  /** Step timestamp */
  timestamp: number;
  /** Embedding vector (optional) */
  embedding?: number[];
}

export interface SONAPattern {
  /** Pattern identifier */
  id: string;
  /** Pattern content/description */
  pattern: string;
  /** Solution or approach */
  solution: string;
  /** Category for classification */
  category: string;
  /** Confidence score (0.0 - 1.0) */
  confidence: number;
  /** Usage count */
  usageCount: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last used timestamp */
  lastUsedAt: number;
  /** Embedding vector */
  embedding?: number[];
  /** Associated metadata */
  metadata: Record<string, unknown>;
}

export interface SONALearningStats {
  /** Total patterns stored */
  totalPatterns: number;
  /** Active trajectories */
  activeTrajectories: number;
  /** Completed trajectories */
  completedTrajectories: number;
  /** Average pattern confidence */
  averageConfidence: number;
  /** Learning cycles completed */
  learningCycles: number;
  /** Last consolidation timestamp */
  lastConsolidation: number;
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Current learning mode */
  currentMode: SONALearningMode;
}

// ===== Flash Attention Types =====

/**
 * Attention mechanism types supported by agentic-flow.
 * Flash Attention provides 2.49x-7.47x speedup with 50-75% memory reduction.
 */
export type AttentionMechanism =
  | 'flash'       // Flash Attention - fastest, 75% memory reduction
  | 'multi-head'  // Standard multi-head attention
  | 'linear'      // Linear attention for long sequences
  | 'hyperbolic'  // Hyperbolic attention for hierarchical data
  | 'moe'         // Mixture of Experts attention
  | 'local'       // Local/windowed attention
  | 'global'      // Global attention
  | 'sparse';     // Sparse attention patterns

export interface AttentionConfiguration {
  /** Primary attention mechanism */
  mechanism: AttentionMechanism;
  /** Number of attention heads */
  numHeads: number;
  /** Dimension per head */
  headDim: number;
  /** Dropout rate (0.0 - 1.0) */
  dropoutRate: number;
  /** Enable causal masking */
  causalMask: boolean;
  /** Use rotary position embeddings */
  useRoPE: boolean;
  /** Flash attention optimization level (0-3) */
  flashOptLevel: number;
  /** Memory optimization mode */
  memoryOptimization: 'none' | 'moderate' | 'aggressive';
}

export interface AttentionResult {
  /** Output tensor/array */
  output: number[] | Float32Array;
  /** Attention weights (optional, for debugging) */
  attentionWeights?: number[][];
  /** Execution latency in milliseconds */
  latencyMs: number;
  /** Memory used in bytes */
  memoryBytes: number;
  /** Mechanism used */
  mechanism: AttentionMechanism;
  /** Cache hit indicator */
  cacheHit: boolean;
}

export interface AttentionMetrics {
  /** Average latency in milliseconds */
  avgLatencyMs: number;
  /** Throughput (tokens per second) */
  throughputTps: number;
  /** Memory efficiency (0.0 - 1.0) */
  memoryEfficiency: number;
  /** Cache hit rate (0.0 - 1.0) */
  cacheHitRate: number;
  /** Total operations performed */
  totalOperations: number;
  /** Speedup vs baseline */
  speedupFactor: number;
}

// ===== AgentDB Types =====

/**
 * AgentDB provides 150x-12,500x faster search via HNSW indexing.
 */
export interface AgentDBConfiguration {
  /** Vector dimension */
  dimension: number;
  /** Index type */
  indexType: 'hnsw' | 'flat' | 'ivf' | 'pq';
  /** HNSW M parameter (connections per layer) */
  hnswM: number;
  /** HNSW ef_construction parameter */
  hnswEfConstruction: number;
  /** HNSW ef_search parameter */
  hnswEfSearch: number;
  /** Distance metric */
  metric: 'cosine' | 'euclidean' | 'dot_product';
  /** Enable caching */
  enableCache: boolean;
  /** Cache size in MB */
  cacheSizeMb: number;
  /** Database path (for persistent storage) */
  dbPath?: string;
  /** Enable WAL mode for SQLite */
  enableWAL: boolean;
}

export interface AgentDBVector {
  /** Vector identifier */
  id: string;
  /** Vector data */
  vector: number[] | Float32Array;
  /** Associated metadata */
  metadata: Record<string, unknown>;
  /** Namespace for isolation */
  namespace: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
}

export interface AgentDBSearchResult {
  /** Vector identifier */
  id: string;
  /** Similarity score (0.0 - 1.0 for cosine) */
  score: number;
  /** Distance (for euclidean metric) */
  distance?: number;
  /** Associated metadata */
  metadata: Record<string, unknown>;
  /** Original vector (optional) */
  vector?: number[];
}

export interface AgentDBStats {
  /** Total vectors stored */
  totalVectors: number;
  /** Index size in bytes */
  indexSizeBytes: number;
  /** Average search latency in milliseconds */
  avgSearchLatencyMs: number;
  /** Average insert latency in milliseconds */
  avgInsertLatencyMs: number;
  /** Cache hit rate (0.0 - 1.0) */
  cacheHitRate: number;
  /** Memory usage in bytes */
  memoryUsage: number;
  /** Namespaces count */
  namespaceCount: number;
}

// ===== Integration Bridge Types =====

export interface IntegrationConfig {
  /** SONA configuration */
  sona: Partial<SONAConfiguration>;
  /** Attention configuration */
  attention: Partial<AttentionConfiguration>;
  /** AgentDB configuration */
  agentdb: Partial<AgentDBConfiguration>;
  /** Feature flags */
  features: FeatureFlags;
  /** Runtime preference (auto-detection order) */
  runtimePreference: ('napi' | 'wasm' | 'js')[];
  /** Lazy loading for performance */
  lazyLoad: boolean;
  /** Debug mode */
  debug: boolean;
}

export interface FeatureFlags {
  /** Enable SONA learning */
  enableSONA: boolean;
  /** Enable Flash Attention */
  enableFlashAttention: boolean;
  /** Enable AgentDB vector search */
  enableAgentDB: boolean;
  /** Enable trajectory tracking */
  enableTrajectoryTracking: boolean;
  /** Enable GNN query refinement (+12.4% recall) */
  enableGNN: boolean;
  /** Enable intelligence bridge tools */
  enableIntelligenceBridge: boolean;
  /** Enable QUIC transport */
  enableQUICTransport: boolean;
  /** Enable nightly learning */
  enableNightlyLearning: boolean;
  /** Enable auto-consolidation */
  enableAutoConsolidation: boolean;
}

export interface RuntimeInfo {
  /** Current runtime (napi, wasm, or js) */
  runtime: 'napi' | 'wasm' | 'js';
  /** Platform */
  platform: 'linux' | 'darwin' | 'win32' | 'browser';
  /** Architecture */
  arch: 'x64' | 'arm64' | 'ia32';
  /** Node.js version */
  nodeVersion: string;
  /** WASM support */
  wasmSupport: boolean;
  /** NAPI support */
  napiSupport: boolean;
  /** Performance tier */
  performanceTier: 'optimal' | 'good' | 'fallback';
}

export interface IntegrationStatus {
  /** Initialization complete */
  initialized: boolean;
  /** Connected components */
  connectedComponents: string[];
  /** Runtime information */
  runtime: RuntimeInfo;
  /** Feature availability */
  features: Record<string, boolean>;
  /** Component health */
  health: Record<string, ComponentHealth>;
  /** Last health check timestamp */
  lastHealthCheck: number;
}

export interface ComponentHealth {
  /** Component name */
  name: string;
  /** Health status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Last error (if any) */
  lastError?: string;
  /** Response latency in milliseconds */
  latencyMs: number;
  /** Uptime percentage (0.0 - 1.0) */
  uptime: number;
}

// ===== SDK Bridge Types =====

export interface SDKVersion {
  /** Major version */
  major: number;
  /** Minor version */
  minor: number;
  /** Patch version */
  patch: number;
  /** Pre-release tag */
  prerelease?: string;
  /** Full version string */
  full: string;
}

export interface SDKCompatibility {
  /** Minimum supported version */
  minVersion: SDKVersion;
  /** Maximum supported version */
  maxVersion: SDKVersion;
  /** Current version */
  currentVersion: SDKVersion;
  /** Compatibility status */
  compatible: boolean;
  /** Required features */
  requiredFeatures: string[];
  /** Optional features */
  optionalFeatures: string[];
}

export interface SDKBridgeConfig {
  /** Target SDK version */
  targetVersion: string;
  /** Enable version negotiation */
  enableVersionNegotiation: boolean;
  /** Fallback behavior */
  fallbackBehavior: 'error' | 'warn' | 'silent';
  /** API compatibility layer */
  enableCompatibilityLayer: boolean;
  /** Deprecated API support */
  supportDeprecatedAPIs: boolean;
}

// ===== Event Types =====

export interface IntegrationEvent {
  /** Event type */
  type: IntegrationEventType;
  /** Event timestamp */
  timestamp: number;
  /** Event data */
  data: Record<string, unknown>;
  /** Source component */
  source: string;
  /** Correlation ID */
  correlationId: string;
}

export type IntegrationEventType =
  | 'initialized'
  | 'component-connected'
  | 'component-disconnected'
  | 'pattern-stored'
  | 'pattern-retrieved'
  | 'trajectory-started'
  | 'trajectory-completed'
  | 'learning-cycle-completed'
  | 'attention-computed'
  | 'search-performed'
  | 'error'
  | 'warning'
  | 'health-check';

// ===== Error Types =====

export class IntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: IntegrationErrorCode,
    public readonly component: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'IntegrationError';
  }
}

export type IntegrationErrorCode =
  | 'INITIALIZATION_FAILED'
  | 'COMPONENT_UNAVAILABLE'
  | 'VERSION_MISMATCH'
  | 'FEATURE_DISABLED'
  | 'RUNTIME_ERROR'
  | 'TIMEOUT'
  | 'CONFIGURATION_INVALID'
  | 'MEMORY_EXHAUSTED'
  | 'SEARCH_FAILED'
  | 'LEARNING_FAILED';

// ===== Default Configurations =====

export const DEFAULT_SONA_CONFIG: SONAConfiguration = {
  mode: 'balanced',
  learningRate: 0.001,
  similarityThreshold: 0.7,
  maxPatterns: 10000,
  enableTrajectoryTracking: true,
  consolidationInterval: 3600000, // 1 hour
  autoModeSelection: true,
};

export const DEFAULT_ATTENTION_CONFIG: AttentionConfiguration = {
  mechanism: 'flash',
  numHeads: 8,
  headDim: 64,
  dropoutRate: 0.0,
  causalMask: false,
  useRoPE: true,
  flashOptLevel: 2,
  memoryOptimization: 'moderate',
};

export const DEFAULT_AGENTDB_CONFIG: AgentDBConfiguration = {
  dimension: 1536, // OpenAI embedding dimension
  indexType: 'hnsw',
  hnswM: 16,
  hnswEfConstruction: 200,
  hnswEfSearch: 50,
  metric: 'cosine',
  enableCache: true,
  cacheSizeMb: 256,
  enableWAL: true,
};

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  enableSONA: true,
  enableFlashAttention: true,
  enableAgentDB: true,
  enableTrajectoryTracking: true,
  enableGNN: true,
  enableIntelligenceBridge: true,
  enableQUICTransport: false, // Disabled by default (requires additional setup)
  enableNightlyLearning: false, // Disabled by default (resource intensive)
  enableAutoConsolidation: true,
};

export const DEFAULT_INTEGRATION_CONFIG: IntegrationConfig = {
  sona: DEFAULT_SONA_CONFIG,
  attention: DEFAULT_ATTENTION_CONFIG,
  agentdb: DEFAULT_AGENTDB_CONFIG,
  features: DEFAULT_FEATURE_FLAGS,
  runtimePreference: ['napi', 'wasm', 'js'],
  lazyLoad: true,
  debug: false,
};
