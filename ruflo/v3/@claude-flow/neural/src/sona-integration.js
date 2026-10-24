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
import { SonaEngine } from '@ruvector/sona';
// =============================================================================
// Mode Configuration Mapping
// =============================================================================
/**
 * Convert V3 SONA mode to @ruvector/sona config
 */
function modeToConfig(mode, modeConfig) {
    const baseConfig = {
        hiddenDim: 768, // Standard transformer dimension
        embeddingDim: 768,
        microLoraRank: modeConfig.loraRank <= 2 ? modeConfig.loraRank : 1,
        baseLoraRank: modeConfig.loraRank,
        microLoraLr: modeConfig.learningRate,
        baseLoraLr: modeConfig.learningRate * 0.1,
        ewcLambda: modeConfig.ewcLambda,
        patternClusters: modeConfig.patternClusters,
        trajectoryCapacity: modeConfig.trajectoryCapacity,
        qualityThreshold: modeConfig.qualityThreshold,
        enableSimd: true,
    };
    // Mode-specific adjustments
    switch (mode) {
        case 'real-time':
            return {
                ...baseConfig,
                microLoraRank: 1,
                backgroundIntervalMs: 60000, // 1 minute
            };
        case 'edge':
            return {
                ...baseConfig,
                hiddenDim: 384, // Smaller for edge devices
                embeddingDim: 384,
                microLoraRank: 1,
                patternClusters: 25,
                backgroundIntervalMs: 300000, // 5 minutes
            };
        case 'research':
            return {
                ...baseConfig,
                baseLoraRank: 16,
                backgroundIntervalMs: 3600000, // 1 hour
            };
        case 'batch':
            return {
                ...baseConfig,
                backgroundIntervalMs: 7200000, // 2 hours
            };
        case 'balanced':
        default:
            return {
                ...baseConfig,
                backgroundIntervalMs: 1800000, // 30 minutes
            };
    }
}
// =============================================================================
// SONA Learning Engine
// =============================================================================
/**
 * SONA Learning Engine - wraps @ruvector/sona for V3 usage
 *
 * Performance targets:
 * - learn(): <0.05ms
 * - adapt(): <0.1ms
 * - Full learning cycle: <10ms
 */
export class SONALearningEngine {
    engine;
    trajectoryMap = new Map();
    adaptationTimeMs = 0;
    learningTimeMs = 0;
    mode;
    modeConfig;
    constructor(mode, modeConfig) {
        this.mode = mode;
        this.modeConfig = modeConfig;
        const config = modeToConfig(mode, modeConfig);
        this.engine = SonaEngine.withConfig(config);
    }
    /**
     * Learn from a trajectory
     *
     * Performance target: <0.05ms
     *
     * @param trajectory - Trajectory to learn from
     */
    async learn(trajectory) {
        const startTime = performance.now();
        try {
            // Begin trajectory recording
            const queryEmbedding = this.trajectoryToQueryEmbedding(trajectory);
            const trajectoryId = this.engine.beginTrajectory(Array.from(queryEmbedding));
            // Add trajectory steps
            for (const step of trajectory.steps) {
                const activations = this.stateToActivations(step.stateBefore);
                const attentionWeights = this.stateToAttentionWeights(step.stateAfter);
                this.engine.addTrajectoryStep(trajectoryId, Array.from(activations), Array.from(attentionWeights), step.reward);
            }
            // Set context if available
            if (trajectory.domain) {
                this.engine.addTrajectoryContext(trajectoryId, trajectory.domain);
            }
            // Complete trajectory with quality score
            const quality = this.calculateQuality(trajectory);
            this.engine.endTrajectory(trajectoryId, quality);
            // Flush instant updates
            this.engine.flush();
            this.learningTimeMs = performance.now() - startTime;
        }
        catch (error) {
            throw new Error(`SONA learning failed: ${error}`);
        }
    }
    /**
     * Adapt behavior based on context
     *
     * @param context - Current context for adaptation
     * @returns Adapted behavior with transformed embeddings
     */
    async adapt(context) {
        const startTime = performance.now();
        try {
            // Apply micro-LoRA transformation
            const transformedQuery = this.engine.applyMicroLora(Array.from(context.queryEmbedding));
            // Find similar patterns
            const patterns = this.engine.findPatterns(Array.from(context.queryEmbedding), 5);
            // Determine suggested route from patterns
            const suggestedRoute = this.inferRoute(patterns, context);
            const confidence = patterns.length > 0 ? patterns[0].avgQuality : 0.5;
            this.adaptationTimeMs = performance.now() - startTime;
            return {
                transformedQuery: new Float32Array(transformedQuery),
                patterns,
                suggestedRoute,
                confidence,
            };
        }
        catch (error) {
            throw new Error(`SONA adaptation failed: ${error}`);
        }
    }
    /**
     * Get last adaptation time
     *
     * @returns Adaptation time in milliseconds
     */
    getAdaptationTime() {
        return this.adaptationTimeMs;
    }
    /**
     * Get last learning time
     *
     * @returns Learning time in milliseconds
     */
    getLearningTime() {
        return this.learningTimeMs;
    }
    /**
     * Reset learning state
     */
    resetLearning() {
        // Create a new engine with the same config
        const config = modeToConfig(this.mode, this.modeConfig);
        this.engine = SonaEngine.withConfig(config);
        this.trajectoryMap.clear();
        this.adaptationTimeMs = 0;
        this.learningTimeMs = 0;
    }
    /**
     * Force immediate learning cycle
     *
     * @returns Status message
     */
    forceLearning() {
        return this.engine.forceLearn();
    }
    /**
     * Tick background learning (call periodically)
     *
     * @returns Status message if learning occurred
     */
    tick() {
        return this.engine.tick();
    }
    /**
     * Get engine statistics
     *
     * @returns SONA engine statistics
     */
    getStats() {
        const statsJson = this.engine.getStats();
        const stats = JSON.parse(statsJson);
        return {
            totalTrajectories: stats.total_trajectories || 0,
            patternsLearned: stats.patterns_learned || 0,
            avgQuality: stats.avg_quality || 0,
            lastLearningMs: this.learningTimeMs,
            enabled: this.engine.isEnabled(),
        };
    }
    /**
     * Enable or disable the engine
     *
     * @param enabled - Whether to enable the engine
     */
    setEnabled(enabled) {
        this.engine.setEnabled(enabled);
    }
    /**
     * Check if engine is enabled
     *
     * @returns Whether the engine is enabled
     */
    isEnabled() {
        return this.engine.isEnabled();
    }
    /**
     * Find learned patterns similar to query
     *
     * @param queryEmbedding - Query embedding
     * @param k - Number of patterns to return
     * @returns Learned patterns
     */
    findPatterns(queryEmbedding, k = 5) {
        return this.engine.findPatterns(Array.from(queryEmbedding), k);
    }
    // =============================================================================
    // Private Helpers
    // =============================================================================
    /**
     * Convert trajectory to query embedding
     */
    trajectoryToQueryEmbedding(trajectory) {
        // Use the first step's state as query
        if (trajectory.steps.length > 0) {
            return trajectory.steps[0].stateBefore;
        }
        // Fallback to zero embedding
        return new Float32Array(768);
    }
    /**
     * Convert state embedding to activations
     */
    stateToActivations(state) {
        // For now, use state directly as activations
        // In a real implementation, this would extract layer activations
        return state;
    }
    /**
     * Convert state embedding to attention weights
     */
    stateToAttentionWeights(state) {
        // For now, use normalized state as attention weights
        // In a real implementation, this would extract attention patterns
        const sum = state.reduce((acc, val) => acc + Math.abs(val), 0);
        if (sum === 0)
            return state;
        const weights = new Float32Array(state.length);
        for (let i = 0; i < state.length; i++) {
            weights[i] = Math.abs(state[i]) / sum;
        }
        return weights;
    }
    /**
     * Calculate quality score for trajectory
     */
    calculateQuality(trajectory) {
        if (trajectory.qualityScore !== undefined) {
            return trajectory.qualityScore;
        }
        // Calculate from steps
        if (trajectory.steps.length === 0)
            return 0.5;
        const avgReward = trajectory.steps.reduce((sum, step) => sum + step.reward, 0) /
            trajectory.steps.length;
        // Normalize to [0, 1]
        return Math.max(0, Math.min(1, (avgReward + 1) / 2));
    }
    /**
     * Infer suggested route from patterns and context
     */
    inferRoute(patterns, context) {
        if (patterns.length === 0)
            return undefined;
        // Use the highest quality pattern's type as route
        const bestPattern = patterns.reduce((best, pattern) => pattern.avgQuality > best.avgQuality ? pattern : best);
        return bestPattern.patternType || `${context.domain}-default`;
    }
}
// =============================================================================
// Factory Functions
// =============================================================================
/**
 * Create a SONA learning engine
 *
 * @param mode - SONA learning mode
 * @param modeConfig - Mode configuration
 * @returns SONA learning engine instance
 */
export function createSONALearningEngine(mode, modeConfig) {
    return new SONALearningEngine(mode, modeConfig);
}
//# sourceMappingURL=sona-integration.js.map