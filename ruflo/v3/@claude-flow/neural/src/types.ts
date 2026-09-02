/**
 * V3 Neural/Learning System Types
 * Core type definitions for SONA learning modes and ReasoningBank integration
 *
 * Performance Targets:
 * - SONA adaptation: <0.05ms
 * - Pattern matching: <1ms
 * - Learning step: <10ms
 */

// ============================================================================
// SONA Learning Mode Types
// ============================================================================

/**
 * Available SONA learning modes with their characteristics
 */
export type SONAMode = 'real-time' | 'balanced' | 'research' | 'edge' | 'batch';

/**
 * Configuration for each SONA mode
 */
export interface SONAModeConfig {
  /** Mode identifier */
  mode: SONAMode;

  /** LoRA rank (1-16, higher = more expressive but slower) */
  loraRank: number;

  /** Learning rate (0.001-0.01, sweet spot is 0.002) */
  learningRate: number;

  /** Batch size for updates */
  batchSize: number;

  /** Maximum trajectory capacity */
  trajectoryCapacity: number;

  /** Number of pattern clusters */
  patternClusters: number;

  /** Quality threshold (0-1) for accepting patterns */
  qualityThreshold: number;

  /** Maximum latency allowed in milliseconds */
  maxLatencyMs: number;

  /** Memory budget in MB */
  memoryBudgetMb: number;

  /** EWC lambda for catastrophic forgetting prevention */
  ewcLambda: number;
}

/**
 * Mode-specific optimizations
 */
export interface ModeOptimizations {
  /** Enable SIMD vectorization */
  enableSIMD: boolean;

  /** Use micro-LoRA (reduced parameter count) */
  useMicroLoRA: boolean;

  /** Enable gradient checkpointing */
  gradientCheckpointing: boolean;

  /** Use half-precision (FP16) */
  useHalfPrecision: boolean;

  /** Enable pattern caching */
  patternCaching: boolean;

  /** Async learning updates */
  asyncUpdates: boolean;
}

// ============================================================================
// Trajectory Types (ReasoningBank)
// ============================================================================

/**
 * A single step in a reasoning trajectory
 */
export interface TrajectoryStep {
  /** Unique step identifier */
  stepId: string;

  /** Timestamp of the step */
  timestamp: number;

  /** Action taken */
  action: string;

  /** State before action (embedding) */
  stateBefore: Float32Array;

  /** State after action (embedding) */
  stateAfter: Float32Array;

  /** Reward/quality signal (0-1) */
  reward: number;

  /** Attention weights from model */
  attentionWeights?: Float32Array;

  /** Layer activations (optional) */
  layerActivations?: Float32Array[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Complete reasoning trajectory
 */
export interface Trajectory {
  /** Unique trajectory identifier */
  trajectoryId: string;

  /** Task context/description */
  context: string;

  /** Domain classification */
  domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general';

  /** Sequence of steps */
  steps: TrajectoryStep[];

  /** Overall quality score (0-1) */
  qualityScore: number;

  /** Whether trajectory is complete */
  isComplete: boolean;

  /** Start timestamp */
  startTime: number;

  /** End timestamp (if complete) */
  endTime?: number;

  /** Verdict from judgment */
  verdict?: TrajectoryVerdict;

  /** Distilled memory (if processed) */
  distilledMemory?: DistilledMemory;
}

/**
 * Verdict from trajectory judgment
 */
export interface TrajectoryVerdict {
  /** Whether trajectory was successful */
  success: boolean;

  /** Confidence in the verdict (0-1) */
  confidence: number;

  /** Identified strengths */
  strengths: string[];

  /** Identified weaknesses */
  weaknesses: string[];

  /** Suggested improvements */
  improvements: string[];

  /** Relevance score for similar tasks */
  relevanceScore: number;
}

/**
 * Distilled memory from trajectory
 */
export interface DistilledMemory {
  /** Unique memory identifier */
  memoryId: string;

  /** Source trajectory ID */
  trajectoryId: string;

  /** Extracted strategy pattern */
  strategy: string;

  /** Key learnings */
  keyLearnings: string[];

  /** Embedding for similarity search */
  embedding: Float32Array;

  /** Quality score */
  quality: number;

  /** Usage count */
  usageCount: number;

  /** Last used timestamp */
  lastUsed: number;
}

// ============================================================================
// Pattern Learning Types
// ============================================================================

/**
 * A learned pattern from experience
 */
export interface Pattern {
  /** Unique pattern identifier */
  patternId: string;

  /** Pattern name/description */
  name: string;

  /** Domain this pattern applies to */
  domain: string;

  /** Pattern embedding for similarity */
  embedding: Float32Array;

  /** Strategy this pattern represents */
  strategy: string;

  /** Success rate when applying this pattern */
  successRate: number;

  /** Number of times pattern was used */
  usageCount: number;

  /** Quality scores from applications */
  qualityHistory: number[];

  /** Evolution history */
  evolutionHistory: PatternEvolution[];

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;
}

/**
 * Pattern evolution record
 */
export interface PatternEvolution {
  /** When evolution occurred */
  timestamp: number;

  /** Type of evolution */
  type: 'improvement' | 'merge' | 'split' | 'prune';

  /** Previous quality */
  previousQuality: number;

  /** New quality */
  newQuality: number;

  /** Description of change */
  description: string;
}

/**
 * Pattern match result
 */
export interface PatternMatch {
  /** Matched pattern */
  pattern: Pattern;

  /** Similarity score (0-1) */
  similarity: number;

  /** Confidence in match */
  confidence: number;

  /** Retrieval latency in ms */
  latencyMs: number;
}

// ============================================================================
// RL Algorithm Types
// ============================================================================

/**
 * Supported RL algorithms
 */
export type RLAlgorithm =
  | 'ppo'
  | 'dqn'
  | 'a2c'
  | 'decision-transformer'
  | 'q-learning'
  | 'sarsa'
  | 'curiosity';

/**
 * Base RL algorithm configuration
 */
export interface RLConfig {
  /** Algorithm identifier */
  algorithm: RLAlgorithm;

  /** Learning rate */
  learningRate: number;

  /** Discount factor (gamma) */
  gamma: number;

  /** Entropy coefficient */
  entropyCoef: number;

  /** Value loss coefficient */
  valueLossCoef: number;

  /** Maximum gradient norm */
  maxGradNorm: number;

  /** Number of epochs per update */
  epochs: number;

  /** Mini-batch size */
  miniBatchSize: number;
}

/**
 * PPO-specific configuration
 */
export interface PPOConfig extends RLConfig {
  algorithm: 'ppo';

  /** Clip range for policy */
  clipRange: number;

  /** Clip range for value function */
  clipRangeVf: number | null;

  /** Target KL divergence */
  targetKL: number;

  /** GAE lambda */
  gaeLambda: number;
}

/**
 * DQN-specific configuration
 */
export interface DQNConfig extends RLConfig {
  algorithm: 'dqn';

  /** Replay buffer size */
  bufferSize: number;

  /** Initial exploration rate */
  explorationInitial: number;

  /** Final exploration rate */
  explorationFinal: number;

  /** Exploration decay steps */
  explorationDecay: number;

  /** Target network update frequency */
  targetUpdateFreq: number;

  /** Use double DQN */
  doubleDQN: boolean;

  /** Use dueling network */
  duelingNetwork: boolean;
}

/**
 * Decision Transformer configuration
 */
export interface DecisionTransformerConfig extends RLConfig {
  algorithm: 'decision-transformer';

  /** Context length */
  contextLength: number;

  /** Number of attention heads */
  numHeads: number;

  /** Number of transformer layers */
  numLayers: number;

  /** Hidden dimension */
  hiddenDim: number;

  /** Embedding dimension */
  embeddingDim: number;

  /** Dropout rate */
  dropout: number;
}

/**
 * Curiosity-driven exploration configuration
 */
export interface CuriosityConfig extends RLConfig {
  algorithm: 'curiosity';

  /** Intrinsic reward coefficient */
  intrinsicCoef: number;

  /** Forward model learning rate */
  forwardLR: number;

  /** Inverse model learning rate */
  inverseLR: number;

  /** Feature dimension */
  featureDim: number;

  /** Use random network distillation */
  useRND: boolean;
}

// ============================================================================
// LoRA Types
// ============================================================================

/**
 * LoRA adapter configuration
 */
export interface LoRAConfig {
  /** Adapter rank (1, 2, 4, 8, 16) */
  rank: number;

  /** Alpha scaling factor */
  alpha: number;

  /** Dropout rate */
  dropout: number;

  /** Target modules to adapt */
  targetModules: string[];

  /** Use micro-LoRA (optimized for speed) */
  microLoRA: boolean;
}

/**
 * LoRA adapter weights
 */
export interface LoRAWeights {
  /** Adapter identifier */
  adapterId: string;

  /** A matrices (down projection) */
  A: Map<string, Float32Array>;

  /** B matrices (up projection) */
  B: Map<string, Float32Array>;

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;

  /** Training iterations */
  iterations: number;

  /** Associated domain */
  domain?: string;
}

// ============================================================================
// EWC Types (Elastic Weight Consolidation)
// ============================================================================

/**
 * EWC++ configuration for continual learning
 */
export interface EWCConfig {
  /** Lambda (importance weight) */
  lambda: number;

  /** Decay rate for old Fisher information */
  decay: number;

  /** Number of samples for Fisher estimation */
  fisherSamples: number;

  /** Minimum Fisher value (for stability) */
  minFisher: number;

  /** Use online EWC (EWC++) */
  online: boolean;
}

/**
 * EWC state for a parameter set
 */
export interface EWCState {
  /** Parameter means (optimal values) */
  means: Map<string, Float32Array>;

  /** Fisher information (importance weights) */
  fisher: Map<string, Float32Array>;

  /** Number of tasks learned */
  taskCount: number;

  /** Last consolidation timestamp */
  lastConsolidation: number;
}

// ============================================================================
// Neural System Statistics
// ============================================================================

/**
 * Statistics for the neural/learning system
 */
export interface NeuralStats {
  /** Trajectory statistics */
  trajectories: {
    total: number;
    active: number;
    completed: number;
    utilization: number;
  };

  /** Performance metrics */
  performance: {
    avgQualityScore: number;
    opsPerSecond: number;
    learningCycles: number;
    avgLatencyMs: number;
  };

  /** Pattern statistics */
  patterns: {
    totalPatterns: number;
    avgMatchTime: number;
    cacheHitRate: number;
    evolutionCount: number;
  };

  /** Memory usage */
  memory: {
    usedMb: number;
    budgetMb: number;
    trajectoryBytes: number;
    patternBytes: number;
  };

  /** Current configuration */
  config: {
    mode: SONAMode;
    loraRank: number;
    learningRate: number;
    algorithm: RLAlgorithm;
  };
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Neural system events for monitoring and hooks
 */
export type NeuralEvent =
  | { type: 'trajectory_started'; trajectoryId: string; context: string }
  | { type: 'trajectory_completed'; trajectoryId: string; qualityScore: number }
  | { type: 'pattern_matched'; patternId: string; similarity: number }
  | { type: 'pattern_evolved'; patternId: string; evolutionType: string }
  | { type: 'learning_triggered'; reason: string; trajectoryCount: number }
  | { type: 'learning_completed'; improvementDelta: number }
  | { type: 'mode_changed'; fromMode: SONAMode; toMode: SONAMode }
  | { type: 'memory_consolidated'; memoriesCount: number };

/**
 * Event listener type
 */
export type NeuralEventListener = (event: NeuralEvent) => void | Promise<void>;

// ============================================================================
// Module Exports
// ============================================================================

export type {
  SONAMode as LearningMode,
  SONAModeConfig as ModeConfig,
  Pattern as LearnedPattern,
  PatternMatch as PatternSearchResult,
};
