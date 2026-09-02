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
import type { SONAMode, SONAModeConfig, ModeOptimizations, Trajectory, Pattern, PatternMatch, NeuralStats, NeuralEventListener, LoRAConfig, LoRAWeights, EWCConfig } from './types.js';
/**
 * SONA Manager - Main orchestrator for neural learning
 */
export declare class SONAManager {
    private currentMode;
    private config;
    private optimizations;
    private modeImpl;
    private trajectories;
    private patterns;
    private loraWeights;
    private ewcState;
    private eventListeners;
    private stats;
    private isInitialized;
    private operationCount;
    private totalLatencyMs;
    private learningCycles;
    private lastStatsUpdate;
    constructor(mode?: SONAMode);
    /**
     * Initialize the SONA manager
     */
    initialize(): Promise<void>;
    /**
     * Change the current learning mode
     */
    setMode(mode: SONAMode): Promise<void>;
    /**
     * Get current mode and configuration
     */
    getConfig(): {
        mode: SONAMode;
        config: SONAModeConfig;
        optimizations: ModeOptimizations;
    };
    /**
     * Begin a new trajectory for a task
     */
    beginTrajectory(context: string, domain?: Trajectory['domain']): string;
    /**
     * Record a step in a trajectory
     */
    recordStep(trajectoryId: string, action: string, reward: number, stateEmbedding: Float32Array, metadata?: Record<string, unknown>): void;
    /**
     * Complete a trajectory
     */
    completeTrajectory(trajectoryId: string, finalQuality?: number): Trajectory | null;
    /**
     * Get a trajectory by ID
     */
    getTrajectory(trajectoryId: string): Trajectory | undefined;
    /**
     * Find similar patterns for a given context (k=3 optimal)
     */
    findSimilarPatterns(embedding: Float32Array, k?: number): Promise<PatternMatch[]>;
    /**
     * Store a new pattern
     */
    storePattern(pattern: Omit<Pattern, 'patternId' | 'createdAt' | 'updatedAt'>): Pattern;
    /**
     * Update pattern based on usage
     */
    updatePatternUsage(patternId: string, quality: number): void;
    /**
     * Trigger a learning cycle
     */
    triggerLearning(reason?: string): Promise<void>;
    /**
     * Apply learned adaptations to processing
     */
    applyAdaptations(input: Float32Array, domain?: string): Promise<Float32Array>;
    /**
     * Get LoRA configuration for current mode
     */
    getLoRAConfig(): LoRAConfig;
    /**
     * Initialize LoRA weights for a domain
     */
    initializeLoRAWeights(domain?: string): LoRAWeights;
    /**
     * Get EWC configuration
     */
    getEWCConfig(): EWCConfig;
    /**
     * Consolidate EWC after learning a new task
     */
    consolidateEWC(): void;
    /**
     * Get current neural system statistics
     */
    getStats(): NeuralStats;
    /**
     * Add an event listener
     */
    addEventListener(listener: NeuralEventListener): void;
    /**
     * Remove an event listener
     */
    removeEventListener(listener: NeuralEventListener): void;
    /**
     * Cleanup resources
     */
    cleanup(): Promise<void>;
    private createModeImplementation;
    private calculateQualityScore;
    private checkLearningTrigger;
    private pruneTrajectories;
    private trackLatency;
    private emitEvent;
    private createInitialStats;
    private updateStats;
    private estimateMemoryUsage;
    private estimateTrajectoryBytes;
    private estimatePatternBytes;
}
/**
 * Factory function for creating SONA manager
 */
export declare function createSONAManager(mode?: SONAMode): SONAManager;
/**
 * Get default configuration for a mode
 */
export declare function getModeConfig(mode: SONAMode): SONAModeConfig;
/**
 * Get optimizations for a mode
 */
export declare function getModeOptimizations(mode: SONAMode): ModeOptimizations;
//# sourceMappingURL=sona-manager.d.ts.map