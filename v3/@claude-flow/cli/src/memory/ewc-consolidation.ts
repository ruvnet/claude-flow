/**
 * EWC++ (Elastic Weight Consolidation) Implementation
 * Prevents catastrophic forgetting of important patterns during continual learning
 *
 * Algorithm:
 * L_total = L_new + (lambda/2) * sum_i(F_i * (theta_i - theta_old_i)^2)
 *
 * Where:
 * - L_new is the loss on new data
 * - lambda is the importance weight (ewcLambda)
 * - F_i is the Fisher information for parameter i
 * - theta_i is the current parameter value
 * - theta_old_i is the previous parameter value
 *
 * Features:
 * - Fisher Information Matrix computation from gradient history
 * - Online EWC updates for streaming patterns
 * - Selective consolidation based on pattern importance
 * - Persistent storage in .swarm/ewc-fisher.json
 *
 * IMPLEMENTATION NOTE (honesty — see docs/reviews/intelligence-system-audit-2026-05-29.md):
 * The penalty math above is real, but `F_i` here is NOT true Fisher information
 * (the expectation of squared log-likelihood gradients). There are no model
 * gradients in this pattern-memory context, so `F_i` is a HEURISTIC IMPORTANCE
 * PROXY: accumulated squared embedding magnitude per dimension
 * (`F_i += embedding_i^2`, see computeFisherMatrix). It protects high-magnitude
 * embedding dimensions during consolidation — a reasonable importance signal —
 * but "Fisher information" overstates it; read `F_i` as "embedding-importance
 * weight", not gradient curvature.
 *
 * @module v3/cli/memory/ewc-consolidation
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

/**
 * Pattern weight vector for EWC consolidation
 */
export interface PatternWeights {
  /** Unique pattern identifier */
  id: string;
  /** Weight vector (embedding or learned parameters) */
  weights: number[];
  /** Fisher information values per weight */
  fisherDiagonal: number[];
  /** Importance score (0-1) */
  importance: number;
  /** Number of successful uses */
  successCount: number;
  /** Number of failed uses */
  failureCount: number;
  /** Timestamp of last update */
  lastUpdated: number;
  /** Pattern type for categorization */
  type: string;
  /** Pattern description */
  description?: string;
}

/**
 * Fisher Information Matrix entry (diagonal approximation)
 */
export interface FisherEntry {
  /** Parameter index */
  index: number;
  /** Fisher information value (importance) */
  value: number;
  /** Number of samples used to compute this value */
  sampleCount: number;
  /** Exponential moving average decay rate */
  decayRate: number;
}

/**
 * EWC consolidation configuration
 */
export interface EWCConfig {
  /** Regularization strength (lambda) */
  lambda: number;
  /** Number of patterns to keep for Fisher computation */
  maxPatterns: number;
  /** Decay rate for online Fisher updates */
  fisherDecayRate: number;
  /** Minimum importance threshold for consolidation */
  importanceThreshold: number;
  /** Path to persist Fisher matrix */
  storagePath: string;
  /** Enable online updates (EWC++) */
  onlineMode: boolean;
  /** Dimensions of weight vectors */
  dimensions: number;
}

/**
 * Consolidation result
 */
export interface ConsolidationResult {
  /** Whether consolidation was successful */
  success: boolean;
  /** Number of patterns consolidated */
  patternsConsolidated: number;
  /** Total penalty applied */
  totalPenalty: number;
  /** Patterns that were modified */
  modifiedPatterns: string[];
  /** Patterns that were protected (high Fisher) */
  protectedPatterns: string[];
  /** Time taken in milliseconds */
  duration: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Statistics about EWC consolidation state
 */
export interface EWCStats {
  /** Total patterns tracked */
  totalPatterns: number;
  /** Patterns with high importance (above threshold) */
  highImportancePatterns: number;
  /** Average Fisher information across all parameters */
  avgFisherValue: number;
  /** Maximum Fisher information value */
  maxFisherValue: number;
  /** Total successful consolidations */
  consolidationCount: number;
  /** Last consolidation timestamp */
  lastConsolidation: number | null;
  /** Average penalty per consolidation */
  avgPenalty: number;
  /** Storage size in bytes */
  storageSizeBytes: number;
}

/**
 * Gradient sample for Fisher computation
 */
interface GradientSample {
  patternId: string;
  gradients: number[];
  timestamp: number;
  success: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_EWC_CONFIG: EWCConfig = {
  lambda: 0.4,
  maxPatterns: 1000,
  fisherDecayRate: 0.01,
  importanceThreshold: 0.3,
  storagePath: path.join(process.cwd(), '.swarm', 'ewc-fisher.json'),
  onlineMode: true,
  dimensions: 384
};

// ============================================================================
// EWC Consolidator Class
// ============================================================================

/**
 * EWC++ Consolidator
 * Implements Elastic Weight Consolidation with online updates
 * for preventing catastrophic forgetting in continual learning
 */
export class EWCConsolidator {
  private config: EWCConfig;
  private patterns: Map<string, PatternWeights> = new Map();
  private gradientHistory: GradientSample[] = [];
  private globalFisher: number[] = [];
  private consolidationHistory: { timestamp: number; penalty: number; patterns: number }[] = [];
  private initialized: boolean = false;

  constructor(config?: Partial<EWCConfig>) {
    this.config = { ...DEFAULT_EWC_CONFIG, ...config };
    this.globalFisher = new Array(this.config.dimensions).fill(0);
  }

  /**
   * Initialize the consolidator by loading persisted state
   */
  async initialize(): Promise<boolean> {
    if (this.initialized) return true;

    try {
      await this.loadFromDisk();
      this.initialized = true;
      return true;
    } catch {
      // Start fresh if no persisted state
      this.initialized = true;
      return true;
    }
  }

  /**
   * Compute Fisher Information Matrix from gradient history
   * Uses diagonal approximation for efficiency: F_i = E[g_i^2]
   *
   * @param patterns - Array of patterns with their gradients/embeddings
   * @returns Fisher information diagonal
   */
  computeFisherMatrix(patterns: { id: string; embedding: number[]; success: boolean }[]): number[] {
    const fisher = new Array(this.config.dimensions).fill(0);
    let sampleCount = 0;

    for (const pattern of patterns) {
      if (!pattern.embedding || pattern.embedding.length === 0) continue;

      // Only use successful patterns for Fisher computation
      // (we want to preserve what worked)
      if (!pattern.success) continue;

      sampleCount++;

      // Fisher diagonal is expectation of squared gradients
      // For embeddings, we use the embedding values as proxy for gradients
      const len = Math.min(pattern.embedding.length, this.config.dimensions);
      for (let i = 0; i < len; i++) {
        // Accumulate squared values (gradient proxy)
        fisher[i] += pattern.embedding[i] * pattern.embedding[i];
      }
    }

    // Normalize by sample count
    if (sampleCount > 0) {
      for (let i = 0; i < this.config.dimensions; i++) {
        fisher[i] /= sampleCount;
      }
    }

    // Update global Fisher with exponential moving average (EWC++)
    if (this.config.onlineMode) {
      const decay = this.config.fisherDecayRate;
      for (let i = 0; i < this.config.dimensions; i++) {
        this.globalFisher[i] = (1 - decay) * this.globalFisher[i] + decay * fisher[i];
      }
    }

    return fisher;
  }

  /**
   * Consolidate new patterns with old patterns without forgetting
   * Applies EWC penalty to preserve important weights
   *
   * @param newPatterns - New patterns to incorporate
   * @param oldPatterns - Existing patterns to preserve
   * @returns Consolidated patterns with modified weights
   */
  consolidate(
    newPatterns: { id: string; embedding: number[]; type: string; description?: string }[],
    oldPatterns?: PatternWeights[]
  ): ConsolidationResult {
    const startTime = performance.now();
    const result: ConsolidationResult = {
      success: false,
      patternsConsolidated: 0,
      totalPenalty: 0,
      modifiedPatterns: [],
      protectedPatterns: [],
      duration: 0
    };

    try {
      // Use stored patterns if no old patterns provided
      const existingPatterns = oldPatterns || Array.from(this.patterns.values());

      // Compute Fisher from successful existing patterns
      const fisherInput = existingPatterns
        .filter(p => p.successCount > p.failureCount)
        .map(p => ({
          id: p.id,
          embedding: p.weights,
          success: true
        }));

      const fisher = this.computeFisherMatrix(fisherInput);

      // Process each new pattern
      for (const newPattern of newPatterns) {
        if (!newPattern.embedding || newPattern.embedding.length === 0) continue;

        const existingPattern = this.patterns.get(newPattern.id);

        if (existingPattern) {
          // Calculate EWC penalty for updating existing pattern
          const penalty = this.getPenalty(existingPattern.weights, newPattern.embedding, fisher);

          // Determine if update is allowed based on penalty
          const importanceScore = this.calculateImportance(existingPattern);

          if (importanceScore > this.config.importanceThreshold && penalty > this.config.lambda) {
            // Protect high-importance patterns with high penalty
            result.protectedPatterns.push(newPattern.id);

            // Apply constrained update: blend old and new based on importance
            const blendFactor = 1 - importanceScore;
            const blendedWeights = this.blendWeights(
              existingPattern.weights,
              newPattern.embedding,
              blendFactor,
              fisher
            );

            existingPattern.weights = blendedWeights;
            existingPattern.lastUpdated = Date.now();
            result.modifiedPatterns.push(newPattern.id);
          } else {
            // Low importance or low penalty: allow full update
            existingPattern.weights = newPattern.embedding.slice(0, this.config.dimensions);
            existingPattern.lastUpdated = Date.now();
            result.modifiedPatterns.push(newPattern.id);
          }

          // Update Fisher diagonal for this pattern
          existingPattern.fisherDiagonal = fisher;
          result.totalPenalty += penalty;
        } else {
          // New pattern: add directly
          const weights: PatternWeights = {
            id: newPattern.id,
            weights: newPattern.embedding.slice(0, this.config.dimensions),
            fisherDiagonal: fisher,
            importance: 0.5,
            successCount: 0,
            failureCount: 0,
            lastUpdated: Date.now(),
            type: newPattern.type,
            description: newPattern.description
          };

          this.patterns.set(newPattern.id, weights);
          result.modifiedPatterns.push(newPattern.id);
        }

        result.patternsConsolidated++;
      }

      // Prune old patterns if exceeding limit
      if (this.patterns.size > this.config.maxPatterns) {
        this.pruneOldPatterns();
      }

      // Record consolidation
      this.consolidationHistory.push({
        timestamp: Date.now(),
        penalty: result.totalPenalty,
        patterns: result.patternsConsolidated
      });

      // Persist to disk
      this.saveToDisk();

      result.success = true;
      result.duration = performance.now() - startTime;

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      result.duration = performance.now() - startTime;
      return result;
    }
  }

  /**
   * Calculate EWC regularization penalty
   *
   * L_ewc = (lambda/2) * sum_i(F_i * (theta_i - theta_old_i)^2)
   *
   * @param oldWeights - Previous weight values
   * @param newWeights - New weight values
   * @param fisher - Fisher information diagonal (optional, uses global if not provided)
   * @returns Regularization penalty value
   */
  getPenalty(
    oldWeights: number[],
    newWeights: number[],
    fisher?: number[]
  ): number {
    const fisherDiag = fisher || this.globalFisher;
    const len = Math.min(oldWeights.length, newWeights.length, fisherDiag.length);

    let penalty = 0;
    for (let i = 0; i < len; i++) {
      const diff = newWeights[i] - oldWeights[i];
      penalty += fisherDiag[i] * diff * diff;
    }

    return (this.config.lambda / 2) * penalty;
  }

  /**
   * Get consolidation statistics
   */
  getConsolidationStats(): EWCStats {
    let totalFisher = 0;
    let maxFisher = 0;
    let highImportance = 0;

    for (let i = 0; i < this.globalFisher.length; i++) {
      totalFisher += this.globalFisher[i];
      if (this.globalFisher[i] > maxFisher) {
        maxFisher = this.globalFisher[i];
      }
    }

    for (const pattern of this.patterns.values()) {
      if (this.calculateImportance(pattern) > this.config.importanceThreshold) {
        highImportance++;
      }
    }

    const totalPenalty = this.consolidationHistory.reduce((sum, h) => sum + h.penalty, 0);
    const avgPenalty = this.consolidationHistory.length > 0
      ? totalPenalty / this.consolidationHistory.length
      : 0;

    // Estimate storage size
    let storageSizeBytes = 0;
    try {
      if (fs.existsSync(this.config.storagePath)) {
        const stats = fs.statSync(this.config.storagePath);
        storageSizeBytes = stats.size;
      }
    } catch {
      // Ignore stat errors
    }

    return {
      totalPatterns: this.patterns.size,
      highImportancePatterns: highImportance,
      avgFisherValue: this.globalFisher.length > 0 ? totalFisher / this.globalFisher.length : 0,
      maxFisherValue: maxFisher,
      consolidationCount: this.consolidationHistory.length,
      lastConsolidation: this.consolidationHistory.length > 0
        ? this.consolidationHistory[this.consolidationHistory.length - 1].timestamp
        : null,
      avgPenalty,
      storageSizeBytes
    };
  }

  /**
   * Record a gradient sample for Fisher computation
   */
  recordGradient(patternId: string, gradients: number[], success: boolean): void {
    this.gradientHistory.push({
      patternId,
      gradients,
      timestamp: Date.now(),
      success
    });

    // Keep only recent gradients
    const maxGradients = this.config.maxPatterns * 2;
    if (this.gradientHistory.length > maxGradients) {
      this.gradientHistory = this.gradientHistory.slice(-maxGradients);
    }

    // Update pattern success/failure counts
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      if (success) {
        pattern.successCount++;
      } else {
        pattern.failureCount++;
      }
      pattern.importance = this.calculateImportance(pattern);
    }

    // Online Fisher update from this gradient
    if (this.config.onlineMode && success) {
      const decay = this.config.fisherDecayRate;
      const len = Math.min(gradients.length, this.config.dimensions);
      for (let i = 0; i < len; i++) {
        this.globalFisher[i] = (1 - decay) * this.globalFisher[i] + decay * gradients[i] * gradients[i];
      }
    }
  }

  /**
   * Get pattern weights by ID
   */
  getPatternWeights(id: string): PatternWeights | undefined {
    return this.patterns.get(id);
  }

  /**
   * Get all stored patterns
   */
  getAllPatterns(): PatternWeights[] {
    return Array.from(this.patterns.values());
  }

  /**
   * Update EWC lambda (regularization strength)
   */
  setLambda(lambda: number): void {
    this.config.lambda = lambda;
  }

  /**
   * Get current lambda value
   */
  getLambda(): number {
    return this.config.lambda;
  }

  /**
   * Reset Fisher matrix (use with caution - allows forgetting)
   */
  resetFisher(): void {
    this.globalFisher = new Array(this.config.dimensions).fill(0);
  }

  /**
   * Update Fisher matrix from pattern confidence changes.
   * Called by SONA after distillLearning to track which patterns
   * are important and should be protected from forgetting.
   *
   * Uses online averaging: F_new = alpha * F_old + (1-alpha) * F_current
   *
   * @param confidenceChanges - Array of {id, embedding, oldConf, newConf}
   */
  updateFisherFromConfidences(
    confidenceChanges: { id: string; embedding: number[]; oldConf: number; newConf: number }[]
  ): void {
    if (confidenceChanges.length === 0) return;

    const alpha = this.config.fisherDecayRate;
    const currentFisher = new Array(this.config.dimensions).fill(0);
    let sampleCount = 0;

    for (const change of confidenceChanges) {
      if (!change.embedding || change.embedding.length === 0) continue;

      const confDelta = Math.abs(change.newConf - change.oldConf);
      if (confDelta === 0) continue;

      sampleCount++;
      const len = Math.min(change.embedding.length, this.config.dimensions);

      // Squared gradient proxy: embedding scaled by confidence change magnitude
      for (let i = 0; i < len; i++) {
        const grad = change.embedding[i] * confDelta;
        currentFisher[i] += grad * grad;
      }
    }

    if (sampleCount > 0) {
      for (let i = 0; i < this.config.dimensions; i++) {
        currentFisher[i] /= sampleCount;
      }
    }

    // Online EMA: F_new = alpha * F_old + (1-alpha) * F_current
    for (let i = 0; i < this.config.dimensions; i++) {
      this.globalFisher[i] = alpha * this.globalFisher[i] + (1 - alpha) * currentFisher[i];
    }

    this.saveToDisk();
  }

  /**
   * Compute consolidation penalty for a proposed confidence update.
   * Used by SONA to check whether a pattern update would cause forgetting.
   *
   * @param oldConfidence - Current confidence value
   * @param newConfidence - Proposed new confidence value
   * @returns Penalty value (higher = more forgetting risk)
   */
  computeConfidencePenalty(oldConfidence: number, newConfidence: number): number {
    // Use the global Fisher to estimate penalty for scalar confidence change
    // Average Fisher value represents overall importance
    let avgFisher = 0;
    for (let i = 0; i < this.globalFisher.length; i++) {
      avgFisher += this.globalFisher[i];
    }
    avgFisher = this.globalFisher.length > 0 ? avgFisher / this.globalFisher.length : 0;

    const diff = newConfidence - oldConfidence;
    return (this.config.lambda / 2) * avgFisher * diff * diff;
  }

  /**
   * Clear all patterns and history (full reset)
   */
  clear(): void {
    this.patterns.clear();
    this.gradientHistory = [];
    this.globalFisher = new Array(this.config.dimensions).fill(0);
    this.consolidationHistory = [];

    // Remove persisted file
    try {
      if (fs.existsSync(this.config.storagePath)) {
        fs.unlinkSync(this.config.storagePath);
      }
    } catch {
      // Ignore deletion errors
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Calculate importance score for a pattern based on usage
   */
  private calculateImportance(pattern: PatternWeights): number {
    const total = pattern.successCount + pattern.failureCount;
    if (total === 0) return 0.5;

    // Success rate with Laplace smoothing
    const successRate = (pattern.successCount + 1) / (total + 2);

    // Recency factor: recent patterns are more important
    const hoursSinceUpdate = (Date.now() - pattern.lastUpdated) / (1000 * 60 * 60);
    const recencyFactor = Math.exp(-hoursSinceUpdate / 168); // 1 week half-life

    // Combine factors
    return successRate * 0.7 + recencyFactor * 0.3;
  }

  /**
   * Blend old and new weights using Fisher-weighted interpolation
   */
  private blendWeights(
    oldWeights: number[],
    newWeights: number[],
    blendFactor: number,
    fisher: number[]
  ): number[] {
    const len = Math.min(oldWeights.length, newWeights.length, this.config.dimensions);
    const result = new Array(len);

    // Normalize Fisher for per-weight blend factors
    let maxF = 0;
    for (let i = 0; i < len; i++) {
      if (fisher[i] > maxF) maxF = fisher[i];
    }
    const normFactor = maxF > 0 ? 1 / maxF : 1;

    for (let i = 0; i < len; i++) {
      // Higher Fisher = more weight on old value
      const fisherWeight = fisher[i] * normFactor;
      const adjustedBlend = blendFactor * (1 - fisherWeight * 0.5);

      result[i] = oldWeights[i] * (1 - adjustedBlend) + newWeights[i] * adjustedBlend;
    }

    return result;
  }

  /**
   * Prune old, low-importance patterns to stay within limit
   */
  private pruneOldPatterns(): void {
    if (this.patterns.size <= this.config.maxPatterns) return;

    // Sort by importance (ascending)
    const sortedPatterns = Array.from(this.patterns.entries())
      .map(([id, pattern]) => ({ id, importance: this.calculateImportance(pattern) }))
      .sort((a, b) => a.importance - b.importance);

    // Remove lowest importance patterns
    const toRemove = this.patterns.size - this.config.maxPatterns;
    for (let i = 0; i < toRemove; i++) {
      this.patterns.delete(sortedPatterns[i].id);
    }
  }

  /**
   * Save state to disk
   */
  private saveToDisk(): void {
    try {
      const dir = path.dirname(this.config.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const state = {
        version: '1.0.0',
        config: {
          lambda: this.config.lambda,
          dimensions: this.config.dimensions,
          fisherDecayRate: this.config.fisherDecayRate
        },
        globalFisher: this.globalFisher,
        patterns: Array.from(this.patterns.entries()),
        consolidationHistory: this.consolidationHistory.slice(-100),
        savedAt: Date.now()
      };

      fs.writeFileSync(this.config.storagePath, JSON.stringify(state, null, 2));
    } catch {
      // Silently fail - persistence is best-effort
    }
  }

  /**
   * Load state from disk
   */
  private async loadFromDisk(): Promise<void> {
    if (!fs.existsSync(this.config.storagePath)) {
      throw new Error('No persisted state found');
    }

    const content = fs.readFileSync(this.config.storagePath, 'utf-8');
    const state = JSON.parse(content);

    // Validate version
    if (state.version !== '1.0.0') {
      throw new Error(`Unsupported state version: ${state.version}`);
    }

    // Restore state
    this.globalFisher = state.globalFisher || new Array(this.config.dimensions).fill(0);

    // Restore patterns
    this.patterns.clear();
    if (state.patterns) {
      for (const [id, pattern] of state.patterns) {
        this.patterns.set(id, pattern);
      }
    }

    // Restore history
    this.consolidationHistory = state.consolidationHistory || [];

    // Update config from persisted values
    if (state.config) {
      this.config.lambda = state.config.lambda ?? this.config.lambda;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let ewcConsolidatorInstance: EWCConsolidator | null = null;

/**
 * Get the singleton EWC Consolidator instance
 *
 * @param config - Optional configuration overrides
 * @returns EWC Consolidator instance
 */
export async function getEWCConsolidator(config?: Partial<EWCConfig>): Promise<EWCConsolidator> {
  if (!ewcConsolidatorInstance) {
    ewcConsolidatorInstance = new EWCConsolidator(config);
    await ewcConsolidatorInstance.initialize();
  }
  return ewcConsolidatorInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetEWCConsolidator(): void {
  if (ewcConsolidatorInstance) {
    ewcConsolidatorInstance.clear();
    ewcConsolidatorInstance = null;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick consolidation helper for common use case
 * Consolidates new patterns with existing ones using EWC
 *
 * @param newPatterns - New patterns to add
 * @returns Consolidation result
 */
export async function consolidatePatterns(
  newPatterns: { id: string; embedding: number[]; type: string; description?: string }[]
): Promise<ConsolidationResult> {
  const consolidator = await getEWCConsolidator();
  return consolidator.consolidate(newPatterns);
}

/**
 * Record pattern usage outcome
 * Updates Fisher information and pattern importance
 *
 * @param patternId - Pattern identifier
 * @param embedding - Pattern embedding (used as gradient proxy)
 * @param success - Whether the pattern was successful
 */
export async function recordPatternOutcome(
  patternId: string,
  embedding: number[],
  success: boolean
): Promise<void> {
  const consolidator = await getEWCConsolidator();
  consolidator.recordGradient(patternId, embedding, success);
}

/**
 * Get EWC statistics
 */
export async function getEWCStats(): Promise<EWCStats> {
  const consolidator = await getEWCConsolidator();
  return consolidator.getConsolidationStats();
}

export default {
  EWCConsolidator,
  getEWCConsolidator,
  resetEWCConsolidator,
  consolidatePatterns,
  recordPatternOutcome,
  getEWCStats
};
