/**
 * SONA Integration for V3 Neural Module
 *
 * Wraps @ruvector/sona package for V3 usage with:
 * - Trajectory tracking and verdict judgment
 * - Pattern extraction and memory distillation
 * - Sub-0.05ms learning performance target
 * - Clean TypeScript API with proper types
 *
 * @module sona-integration
 */
import { type JsSonaConfig, type JsLearnedPattern } from '@ruvector/sona';
import type { Trajectory, SONAMode, SONAModeConfig } from './types.js';
/**
 * Context for SONA learning adaptation
 */
export interface Context {
    /** Task domain */
    domain: 'code' | 'creative' | 'reasoning' | 'chat' | 'math' | 'general';
    /** Current query embedding */
    queryEmbedding: Float32Array;
    /** Additional context metadata */
    metadata?: Record<string, unknown>;
}
/**
 * Adapted behavior result from SONA
 */
export interface AdaptedBehavior {
    /** Transformed query embedding after micro-LoRA */
    transformedQuery: Float32Array;
    /** Similar learned patterns */
    patterns: JsLearnedPattern[];
    /** Suggested route/model */
    suggestedRoute?: string;
    /** Confidence score */
    confidence: number;
}
/**
 * SONA engine statistics
 */
export interface SONAStats {
    /** Total trajectories recorded */
    totalTrajectories: number;
    /** Patterns learned */
    patternsLearned: number;
    /** Average quality */
    avgQuality: number;
    /** Last learning time (ms) */
    lastLearningMs: number;
    /** Engine enabled state */
    enabled: boolean;
}
/**
 * SONA Learning Engine - wraps @ruvector/sona for V3 usage
 *
 * Performance targets:
 * - learn(): <0.05ms
 * - adapt(): <0.1ms
 * - Full learning cycle: <10ms
 */
export declare class SONALearningEngine {
    private engine;
    private trajectoryMap;
    private adaptationTimeMs;
    private learningTimeMs;
    private mode;
    private modeConfig;
    constructor(mode: SONAMode, modeConfig: SONAModeConfig);
    /**
     * Learn from a trajectory
     *
     * Performance target: <0.05ms
     *
     * @param trajectory - Trajectory to learn from
     */
    learn(trajectory: Trajectory): Promise<void>;
    /**
     * Adapt behavior based on context
     *
     * @param context - Current context for adaptation
     * @returns Adapted behavior with transformed embeddings
     */
    adapt(context: Context): Promise<AdaptedBehavior>;
    /**
     * Get last adaptation time
     *
     * @returns Adaptation time in milliseconds
     */
    getAdaptationTime(): number;
    /**
     * Get last learning time
     *
     * @returns Learning time in milliseconds
     */
    getLearningTime(): number;
    /**
     * Reset learning state
     */
    resetLearning(): void;
    /**
     * Force immediate learning cycle
     *
     * @returns Status message
     */
    forceLearning(): string;
    /**
     * Tick background learning (call periodically)
     *
     * @returns Status message if learning occurred
     */
    tick(): string | null;
    /**
     * Get engine statistics
     *
     * @returns SONA engine statistics
     */
    getStats(): SONAStats;
    /**
     * Enable or disable the engine
     *
     * @param enabled - Whether to enable the engine
     */
    setEnabled(enabled: boolean): void;
    /**
     * Check if engine is enabled
     *
     * @returns Whether the engine is enabled
     */
    isEnabled(): boolean;
    /**
     * Find learned patterns similar to query
     *
     * @param queryEmbedding - Query embedding
     * @param k - Number of patterns to return
     * @returns Learned patterns
     */
    findPatterns(queryEmbedding: Float32Array, k?: number): JsLearnedPattern[];
    /**
     * Convert trajectory to query embedding
     */
    private trajectoryToQueryEmbedding;
    /**
     * Convert state embedding to activations
     */
    private stateToActivations;
    /**
     * Convert state embedding to attention weights
     */
    private stateToAttentionWeights;
    /**
     * Calculate quality score for trajectory
     */
    private calculateQuality;
    /**
     * Infer suggested route from patterns and context
     */
    private inferRoute;
}
/**
 * Create a SONA learning engine
 *
 * @param mode - SONA learning mode
 * @param modeConfig - Mode configuration
 * @returns SONA learning engine instance
 */
export declare function createSONALearningEngine(mode: SONAMode, modeConfig: SONAModeConfig): SONALearningEngine;
export type { JsLearnedPattern, JsSonaConfig };
//# sourceMappingURL=sona-integration.d.ts.map