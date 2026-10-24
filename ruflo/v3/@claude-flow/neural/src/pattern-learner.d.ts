/**
 * Pattern Learner
 *
 * Implements pattern extraction, matching, and evolution for
 * continuous learning from agent experiences.
 *
 * Performance Targets:
 * - Pattern matching: <1ms
 * - Pattern extraction: <5ms
 * - Evolution step: <2ms
 */
import type { Pattern, PatternMatch, Trajectory, DistilledMemory, NeuralEventListener } from './types.js';
/**
 * Configuration for Pattern Learner
 */
export interface PatternLearnerConfig {
    /** Maximum number of patterns to store */
    maxPatterns: number;
    /** Similarity threshold for matching */
    matchThreshold: number;
    /** Minimum usages before pattern is stable */
    minUsagesForStable: number;
    /** Quality threshold for pattern inclusion */
    qualityThreshold: number;
    /** Enable pattern clustering */
    enableClustering: boolean;
    /** Number of clusters (if clustering enabled) */
    numClusters: number;
    /** Evolution learning rate */
    evolutionLearningRate: number;
}
/**
 * Pattern Learner - Manages pattern extraction, matching, and evolution
 */
export declare class PatternLearner {
    private config;
    private patterns;
    private clusters;
    private patternToCluster;
    private matchCount;
    private totalMatchTime;
    private extractionCount;
    private totalExtractionTime;
    private evolutionCount;
    private totalEvolutionTime;
    private eventListeners;
    constructor(config?: Partial<PatternLearnerConfig>);
    /**
     * Find matching patterns for a query embedding
     * Target: <1ms
     */
    findMatches(queryEmbedding: Float32Array, k?: number): PatternMatch[];
    /**
     * Find best single match
     */
    findBestMatch(queryEmbedding: Float32Array): PatternMatch | null;
    /**
     * Extract a pattern from a trajectory
     * Target: <5ms
     */
    extractPattern(trajectory: Trajectory, memory?: DistilledMemory): Pattern | null;
    /**
     * Extract patterns from multiple trajectories in batch
     */
    extractPatternsBatch(trajectories: Trajectory[]): Pattern[];
    /**
     * Evolve a pattern based on new experience
     * Target: <2ms
     */
    evolvePattern(patternId: string, quality: number, context?: string): void;
    /**
     * Merge two similar patterns
     */
    mergePatterns(patternId1: string, patternId2: string): Pattern | null;
    /**
     * Split a pattern into more specific sub-patterns
     */
    splitPattern(patternId: string, numSplits?: number): Pattern[];
    /**
     * Get all patterns
     */
    getPatterns(): Pattern[];
    /**
     * Get pattern by ID
     */
    getPattern(patternId: string): Pattern | undefined;
    /**
     * Get patterns by domain
     */
    getPatternsByDomain(domain: string): Pattern[];
    /**
     * Get stable patterns (sufficient usage)
     */
    getStablePatterns(): Pattern[];
    getStats(): Record<string, number>;
    addEventListener(listener: NeuralEventListener): void;
    removeEventListener(listener: NeuralEventListener): void;
    private emitEvent;
    private cosineSimilarity;
    private computeMatchConfidence;
    private getCandidatesFromClusters;
    private findSimilarPattern;
    private updatePatternFromTrajectory;
    private computePatternEmbedding;
    private generatePatternName;
    private extractStrategy;
    private assignToCluster;
    private updateClusterCentroid;
    private rebuildClusters;
    private prunePatterns;
    private determineEvolutionType;
}
/**
 * Factory function for creating PatternLearner
 */
export declare function createPatternLearner(config?: Partial<PatternLearnerConfig>): PatternLearner;
//# sourceMappingURL=pattern-learner.d.ts.map