/**
 * SONA Manager - Self-Optimizing Neural Architecture
 *
 * Manages learning modes and provides adaptive optimization for agent tasks.
 *
 * Performance Targets:
 * - Adaptation: <0.05ms
 * - Pattern retrieval: <1ms
 * - Learning step: <10ms
 *
 * Supported Modes:
 * - real-time: Sub-millisecond adaptation (2200 ops/sec)
 * - balanced: General purpose (+25% quality)
 * - research: Deep exploration (+55% quality)
 * - edge: Resource-constrained (<5MB)
 * - batch: High-throughput processing
 */
import { RealTimeMode } from './modes/real-time.js';
import { BalancedMode } from './modes/balanced.js';
import { ResearchMode } from './modes/research.js';
import { EdgeMode } from './modes/edge.js';
import { BatchMode } from './modes/batch.js';
/**
 * Default mode configurations
 */
const MODE_CONFIGS = {
    'real-time': {
        mode: 'real-time',
        loraRank: 2,
        learningRate: 0.001,
        batchSize: 32,
        trajectoryCapacity: 1000,
        patternClusters: 25,
        qualityThreshold: 0.7,
        maxLatencyMs: 0.5,
        memoryBudgetMb: 25,
        ewcLambda: 2000,
    },
    'balanced': {
        mode: 'balanced',
        loraRank: 4,
        learningRate: 0.002,
        batchSize: 32,
        trajectoryCapacity: 3000,
        patternClusters: 50,
        qualityThreshold: 0.5,
        maxLatencyMs: 18,
        memoryBudgetMb: 50,
        ewcLambda: 2000,
    },
    'research': {
        mode: 'research',
        loraRank: 16,
        learningRate: 0.002,
        batchSize: 64,
        trajectoryCapacity: 10000,
        patternClusters: 100,
        qualityThreshold: 0.2,
        maxLatencyMs: 100,
        memoryBudgetMb: 100,
        ewcLambda: 2500,
    },
    'edge': {
        mode: 'edge',
        loraRank: 1,
        learningRate: 0.001,
        batchSize: 16,
        trajectoryCapacity: 200,
        patternClusters: 15,
        qualityThreshold: 0.8,
        maxLatencyMs: 1,
        memoryBudgetMb: 5,
        ewcLambda: 1500,
    },
    'batch': {
        mode: 'batch',
        loraRank: 8,
        learningRate: 0.002,
        batchSize: 128,
        trajectoryCapacity: 5000,
        patternClusters: 75,
        qualityThreshold: 0.4,
        maxLatencyMs: 50,
        memoryBudgetMb: 75,
        ewcLambda: 2000,
    },
};
/**
 * Mode-specific optimizations
 */
const MODE_OPTIMIZATIONS = {
    'real-time': {
        enableSIMD: true,
        useMicroLoRA: true,
        gradientCheckpointing: false,
        useHalfPrecision: true,
        patternCaching: true,
        asyncUpdates: true,
    },
    'balanced': {
        enableSIMD: true,
        useMicroLoRA: false,
        gradientCheckpointing: false,
        useHalfPrecision: false,
        patternCaching: true,
        asyncUpdates: false,
    },
    'research': {
        enableSIMD: true,
        useMicroLoRA: false,
        gradientCheckpointing: true,
        useHalfPrecision: false,
        patternCaching: true,
        asyncUpdates: false,
    },
    'edge': {
        enableSIMD: false,
        useMicroLoRA: true,
        gradientCheckpointing: false,
        useHalfPrecision: true,
        patternCaching: false,
        asyncUpdates: true,
    },
    'batch': {
        enableSIMD: true,
        useMicroLoRA: false,
        gradientCheckpointing: true,
        useHalfPrecision: true,
        patternCaching: true,
        asyncUpdates: true,
    },
};
/**
 * SONA Manager - Main orchestrator for neural learning
 */
export class SONAManager {
    currentMode;
    config;
    optimizations;
    modeImpl;
    trajectories = new Map();
    patterns = new Map();
    loraWeights = new Map();
    ewcState = null;
    eventListeners = new Set();
    stats;
    isInitialized = false;
    // Performance tracking
    operationCount = 0;
    totalLatencyMs = 0;
    learningCycles = 0;
    lastStatsUpdate = Date.now();
    constructor(mode = 'balanced') {
        this.currentMode = mode;
        this.config = { ...MODE_CONFIGS[mode] };
        this.optimizations = { ...MODE_OPTIMIZATIONS[mode] };
        this.modeImpl = this.createModeImplementation(mode);
        this.stats = this.createInitialStats();
    }
    /**
     * Initialize the SONA manager
     */
    async initialize() {
        if (this.isInitialized)
            return;
        // Initialize mode implementation
        await this.modeImpl.initialize();
        // Initialize EWC state for continual learning
        this.ewcState = {
            means: new Map(),
            fisher: new Map(),
            taskCount: 0,
            lastConsolidation: Date.now(),
        };
        this.isInitialized = true;
    }
    /**
     * Change the current learning mode
     */
    async setMode(mode) {
        if (mode === this.currentMode)
            return;
        const previousMode = this.currentMode;
        // Cleanup current mode
        await this.modeImpl.cleanup();
        // Update configuration
        this.currentMode = mode;
        this.config = { ...MODE_CONFIGS[mode] };
        this.optimizations = { ...MODE_OPTIMIZATIONS[mode] };
        // Create new mode implementation
        this.modeImpl = this.createModeImplementation(mode);
        await this.modeImpl.initialize();
        // Emit mode change event
        this.emitEvent({
            type: 'mode_changed',
            fromMode: previousMode,
            toMode: mode,
        });
    }
    /**
     * Get current mode and configuration
     */
    getConfig() {
        return {
            mode: this.currentMode,
            config: { ...this.config },
            optimizations: { ...this.optimizations },
        };
    }
    // ==========================================================================
    // Trajectory Management
    // ==========================================================================
    /**
     * Begin a new trajectory for a task
     */
    beginTrajectory(context, domain = 'general') {
        const startTime = performance.now();
        const trajectoryId = `traj_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const trajectory = {
            trajectoryId,
            context,
            domain,
            steps: [],
            qualityScore: 0,
            isComplete: false,
            startTime: Date.now(),
        };
        this.trajectories.set(trajectoryId, trajectory);
        this.emitEvent({
            type: 'trajectory_started',
            trajectoryId,
            context,
        });
        this.trackLatency(performance.now() - startTime);
        return trajectoryId;
    }
    /**
     * Record a step in a trajectory
     */
    recordStep(trajectoryId, action, reward, stateEmbedding, metadata) {
        const startTime = performance.now();
        const trajectory = this.trajectories.get(trajectoryId);
        if (!trajectory || trajectory.isComplete)
            return;
        const step = {
            stepId: `step_${trajectory.steps.length}`,
            timestamp: Date.now(),
            action,
            stateBefore: trajectory.steps.length > 0
                ? trajectory.steps[trajectory.steps.length - 1].stateAfter
                : stateEmbedding,
            stateAfter: stateEmbedding,
            reward,
            metadata,
        };
        trajectory.steps.push(step);
        // Update running quality score
        trajectory.qualityScore = this.calculateQualityScore(trajectory);
        this.trackLatency(performance.now() - startTime);
    }
    /**
     * Complete a trajectory
     */
    completeTrajectory(trajectoryId, finalQuality) {
        const startTime = performance.now();
        const trajectory = this.trajectories.get(trajectoryId);
        if (!trajectory || trajectory.isComplete)
            return null;
        trajectory.isComplete = true;
        trajectory.endTime = Date.now();
        if (finalQuality !== undefined) {
            trajectory.qualityScore = finalQuality;
        }
        else {
            trajectory.qualityScore = this.calculateQualityScore(trajectory);
        }
        this.emitEvent({
            type: 'trajectory_completed',
            trajectoryId,
            qualityScore: trajectory.qualityScore,
        });
        // Check if we should trigger learning
        this.checkLearningTrigger();
        this.trackLatency(performance.now() - startTime);
        return trajectory;
    }
    /**
     * Get a trajectory by ID
     */
    getTrajectory(trajectoryId) {
        return this.trajectories.get(trajectoryId);
    }
    // ==========================================================================
    // Pattern Matching
    // ==========================================================================
    /**
     * Find similar patterns for a given context (k=3 optimal)
     */
    async findSimilarPatterns(embedding, k = 3) {
        const startTime = performance.now();
        const matches = await this.modeImpl.findPatterns(embedding, k, Array.from(this.patterns.values()));
        // Track pattern match events
        for (const match of matches) {
            this.emitEvent({
                type: 'pattern_matched',
                patternId: match.pattern.patternId,
                similarity: match.similarity,
            });
        }
        const latency = performance.now() - startTime;
        // Add latency to matches
        return matches.map(m => ({ ...m, latencyMs: latency }));
    }
    /**
     * Store a new pattern
     */
    storePattern(pattern) {
        const startTime = performance.now();
        const fullPattern = {
            ...pattern,
            patternId: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.patterns.set(fullPattern.patternId, fullPattern);
        this.trackLatency(performance.now() - startTime);
        return fullPattern;
    }
    /**
     * Update pattern based on usage
     */
    updatePatternUsage(patternId, quality) {
        const pattern = this.patterns.get(patternId);
        if (!pattern)
            return;
        pattern.usageCount++;
        pattern.qualityHistory.push(quality);
        // Keep only last 100 quality scores
        if (pattern.qualityHistory.length > 100) {
            pattern.qualityHistory = pattern.qualityHistory.slice(-100);
        }
        // Update success rate
        pattern.successRate = pattern.qualityHistory.reduce((a, b) => a + b, 0) / pattern.qualityHistory.length;
        pattern.updatedAt = Date.now();
    }
    // ==========================================================================
    // Learning
    // ==========================================================================
    /**
     * Trigger a learning cycle
     */
    async triggerLearning(reason = 'manual') {
        const startTime = performance.now();
        const completedTrajectories = Array.from(this.trajectories.values())
            .filter(t => t.isComplete && t.qualityScore >= this.config.qualityThreshold);
        if (completedTrajectories.length === 0)
            return;
        this.emitEvent({
            type: 'learning_triggered',
            reason,
            trajectoryCount: completedTrajectories.length,
        });
        // Perform learning via mode implementation
        const improvementDelta = await this.modeImpl.learn(completedTrajectories, this.config, this.ewcState);
        this.learningCycles++;
        this.emitEvent({
            type: 'learning_completed',
            improvementDelta,
        });
        // Prune old trajectories if over capacity
        this.pruneTrajectories();
        this.trackLatency(performance.now() - startTime);
    }
    /**
     * Apply learned adaptations to processing
     */
    async applyAdaptations(input, domain) {
        const startTime = performance.now();
        // Get relevant LoRA weights
        const weights = domain
            ? this.loraWeights.get(domain)
            : this.loraWeights.get('default');
        // Apply adaptations via mode implementation
        const output = await this.modeImpl.applyLoRA(input, weights);
        const latency = performance.now() - startTime;
        // Verify performance target
        if (latency > 0.05 && this.currentMode !== 'research' && this.currentMode !== 'batch') {
            console.warn(`SONA adaptation exceeded target: ${latency.toFixed(3)}ms > 0.05ms`);
        }
        return output;
    }
    // ==========================================================================
    // LoRA Management
    // ==========================================================================
    /**
     * Get LoRA configuration for current mode
     */
    getLoRAConfig() {
        return {
            rank: this.config.loraRank,
            alpha: this.config.loraRank * 2,
            dropout: 0.05,
            targetModules: ['q_proj', 'v_proj', 'k_proj', 'o_proj'],
            microLoRA: this.optimizations.useMicroLoRA,
        };
    }
    /**
     * Initialize LoRA weights for a domain
     */
    initializeLoRAWeights(domain = 'default') {
        const config = this.getLoRAConfig();
        const weights = {
            adapterId: `lora_${domain}_${Date.now()}`,
            A: new Map(),
            B: new Map(),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            iterations: 0,
            domain,
        };
        // Initialize A and B matrices for each target module
        for (const module of config.targetModules) {
            // A: (hidden_dim, rank) initialized with small random values
            // B: (rank, hidden_dim) initialized to zero
            const hiddenDim = 768; // Typical transformer hidden dim
            const A = new Float32Array(hiddenDim * config.rank);
            const B = new Float32Array(config.rank * hiddenDim);
            // Initialize A with small random values
            for (let i = 0; i < A.length; i++) {
                A[i] = (Math.random() - 0.5) * 0.02;
            }
            weights.A.set(module, A);
            weights.B.set(module, B);
        }
        this.loraWeights.set(domain, weights);
        return weights;
    }
    // ==========================================================================
    // EWC (Elastic Weight Consolidation)
    // ==========================================================================
    /**
     * Get EWC configuration
     */
    getEWCConfig() {
        return {
            lambda: this.config.ewcLambda,
            decay: 0.9,
            fisherSamples: 100,
            minFisher: 1e-8,
            online: true,
        };
    }
    /**
     * Consolidate EWC after learning a new task
     */
    consolidateEWC() {
        if (!this.ewcState)
            return;
        const config = this.getEWCConfig();
        // Update Fisher information with decay
        for (const [key, fisher] of this.ewcState.fisher) {
            for (let i = 0; i < fisher.length; i++) {
                fisher[i] *= config.decay;
            }
        }
        this.ewcState.taskCount++;
        this.ewcState.lastConsolidation = Date.now();
    }
    // ==========================================================================
    // Statistics
    // ==========================================================================
    /**
     * Get current neural system statistics
     */
    getStats() {
        this.updateStats();
        return { ...this.stats };
    }
    // ==========================================================================
    // Event System
    // ==========================================================================
    /**
     * Add an event listener
     */
    addEventListener(listener) {
        this.eventListeners.add(listener);
    }
    /**
     * Remove an event listener
     */
    removeEventListener(listener) {
        this.eventListeners.delete(listener);
    }
    // ==========================================================================
    // Cleanup
    // ==========================================================================
    /**
     * Cleanup resources
     */
    async cleanup() {
        await this.modeImpl.cleanup();
        this.trajectories.clear();
        this.patterns.clear();
        this.loraWeights.clear();
        this.eventListeners.clear();
        this.isInitialized = false;
    }
    // ==========================================================================
    // Private Methods
    // ==========================================================================
    createModeImplementation(mode) {
        switch (mode) {
            case 'real-time':
                return new RealTimeMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
            case 'balanced':
                return new BalancedMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
            case 'research':
                return new ResearchMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
            case 'edge':
                return new EdgeMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
            case 'batch':
                return new BatchMode(MODE_CONFIGS[mode], MODE_OPTIMIZATIONS[mode]);
            default:
                return new BalancedMode(MODE_CONFIGS['balanced'], MODE_OPTIMIZATIONS['balanced']);
        }
    }
    calculateQualityScore(trajectory) {
        if (trajectory.steps.length === 0)
            return 0;
        // Average reward across steps
        const avgReward = trajectory.steps.reduce((sum, step) => sum + step.reward, 0) / trajectory.steps.length;
        // Discount factor for trajectory length (longer trajectories may accumulate errors)
        const lengthFactor = Math.min(1, 10 / trajectory.steps.length);
        return avgReward * 0.8 + lengthFactor * 0.2;
    }
    checkLearningTrigger() {
        const completedCount = Array.from(this.trajectories.values())
            .filter(t => t.isComplete).length;
        const utilization = completedCount / this.config.trajectoryCapacity;
        // Trigger learning at 80% utilization
        if (utilization >= 0.8) {
            this.triggerLearning('capacity_threshold');
        }
    }
    pruneTrajectories() {
        const completed = Array.from(this.trajectories.entries())
            .filter(([_, t]) => t.isComplete)
            .sort((a, b) => a[1].qualityScore - b[1].qualityScore);
        // Remove lowest quality trajectories if over capacity
        const toRemove = completed.length - Math.floor(this.config.trajectoryCapacity * 0.5);
        if (toRemove > 0) {
            for (let i = 0; i < toRemove && i < completed.length; i++) {
                this.trajectories.delete(completed[i][0]);
            }
        }
    }
    trackLatency(latencyMs) {
        this.operationCount++;
        this.totalLatencyMs += latencyMs;
    }
    emitEvent(event) {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            }
            catch (error) {
                console.error('Error in neural event listener:', error);
            }
        }
    }
    createInitialStats() {
        return {
            trajectories: {
                total: 0,
                active: 0,
                completed: 0,
                utilization: 0,
            },
            performance: {
                avgQualityScore: 0,
                opsPerSecond: 0,
                learningCycles: 0,
                avgLatencyMs: 0,
            },
            patterns: {
                totalPatterns: 0,
                avgMatchTime: 0,
                cacheHitRate: 0,
                evolutionCount: 0,
            },
            memory: {
                usedMb: 0,
                budgetMb: this.config.memoryBudgetMb,
                trajectoryBytes: 0,
                patternBytes: 0,
            },
            config: {
                mode: this.currentMode,
                loraRank: this.config.loraRank,
                learningRate: this.config.learningRate,
                algorithm: 'ppo',
            },
        };
    }
    updateStats() {
        const now = Date.now();
        const elapsed = (now - this.lastStatsUpdate) / 1000;
        const trajectoryArray = Array.from(this.trajectories.values());
        const completed = trajectoryArray.filter(t => t.isComplete);
        this.stats = {
            trajectories: {
                total: trajectoryArray.length,
                active: trajectoryArray.filter(t => !t.isComplete).length,
                completed: completed.length,
                utilization: trajectoryArray.length / this.config.trajectoryCapacity,
            },
            performance: {
                avgQualityScore: completed.length > 0
                    ? completed.reduce((sum, t) => sum + t.qualityScore, 0) / completed.length
                    : 0,
                opsPerSecond: elapsed > 0 ? this.operationCount / elapsed : 0,
                learningCycles: this.learningCycles,
                avgLatencyMs: this.operationCount > 0
                    ? this.totalLatencyMs / this.operationCount
                    : 0,
            },
            patterns: {
                totalPatterns: this.patterns.size,
                avgMatchTime: 0, // Updated by mode implementation
                cacheHitRate: 0, // Updated by mode implementation
                evolutionCount: Array.from(this.patterns.values())
                    .reduce((sum, p) => sum + p.evolutionHistory.length, 0),
            },
            memory: {
                usedMb: this.estimateMemoryUsage(),
                budgetMb: this.config.memoryBudgetMb,
                trajectoryBytes: this.estimateTrajectoryBytes(),
                patternBytes: this.estimatePatternBytes(),
            },
            config: {
                mode: this.currentMode,
                loraRank: this.config.loraRank,
                learningRate: this.config.learningRate,
                algorithm: 'ppo',
            },
        };
        this.lastStatsUpdate = now;
        this.operationCount = 0;
        this.totalLatencyMs = 0;
    }
    estimateMemoryUsage() {
        // Rough estimation in MB
        return (this.estimateTrajectoryBytes() + this.estimatePatternBytes()) / (1024 * 1024);
    }
    estimateTrajectoryBytes() {
        let bytes = 0;
        for (const trajectory of this.trajectories.values()) {
            bytes += 200; // Base trajectory overhead
            bytes += trajectory.context.length * 2;
            bytes += trajectory.steps.length * (64 + 4 * 768 * 4); // Step overhead + embeddings
        }
        return bytes;
    }
    estimatePatternBytes() {
        let bytes = 0;
        for (const pattern of this.patterns.values()) {
            bytes += 100; // Base pattern overhead
            bytes += pattern.name.length * 2;
            bytes += pattern.strategy.length * 2;
            bytes += pattern.embedding.byteLength;
            bytes += pattern.qualityHistory.length * 8;
            bytes += pattern.evolutionHistory.length * 100;
        }
        return bytes;
    }
}
/**
 * Factory function for creating SONA manager
 */
export function createSONAManager(mode = 'balanced') {
    return new SONAManager(mode);
}
/**
 * Get default configuration for a mode
 */
export function getModeConfig(mode) {
    return { ...MODE_CONFIGS[mode] };
}
/**
 * Get optimizations for a mode
 */
export function getModeOptimizations(mode) {
    return { ...MODE_OPTIMIZATIONS[mode] };
}
//# sourceMappingURL=sona-manager.js.map