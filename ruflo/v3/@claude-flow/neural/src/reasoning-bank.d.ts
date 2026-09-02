/**
 * ReasoningBank Integration with AgentDB
 *
 * Implements the 4-step learning pipeline with real vector storage:
 * 1. RETRIEVE - Top-k memory injection with MMR diversity (using AgentDB HNSW)
 * 2. JUDGE - LLM-as-judge trajectory evaluation
 * 3. DISTILL - Extract strategy memories from trajectories
 * 4. CONSOLIDATE - Dedup, detect contradictions, prune old patterns
 *
 * Performance Targets:
 * - Retrieval: <10ms with AgentDB HNSW (150x faster than brute-force)
 * - Learning step: <10ms
 * - Consolidation: <100ms
 *
 * @module reasoning-bank
 */
import type { Trajectory, TrajectoryVerdict, DistilledMemory, Pattern, NeuralEventListener } from './types.js';
/**
 * Configuration for ReasoningBank
 */
export interface ReasoningBankConfig {
    /** Maximum number of trajectories to store */
    maxTrajectories: number;
    /** Minimum quality threshold for distillation */
    distillationThreshold: number;
    /** Number of similar memories to retrieve */
    retrievalK: number;
    /** Diversity factor for MMR (0-1) */
    mmrLambda: number;
    /** Maximum age of patterns in days */
    maxPatternAgeDays: number;
    /** Similarity threshold for deduplication */
    dedupThreshold: number;
    /** Enable contradiction detection */
    enableContradictionDetection: boolean;
    /** Database path for persistent storage */
    dbPath?: string;
    /** Vector dimension for embeddings */
    vectorDimension: number;
    /** Namespace for AgentDB storage */
    namespace: string;
    /** Enable AgentDB vector storage */
    enableAgentDB: boolean;
}
/**
 * Retrieval result with diversity scoring
 */
export interface RetrievalResult {
    memory: DistilledMemory;
    relevanceScore: number;
    diversityScore: number;
    combinedScore: number;
}
/**
 * Consolidation result
 */
export interface ConsolidationResult {
    removedDuplicates: number;
    contradictionsDetected: number;
    prunedPatterns: number;
    mergedPatterns: number;
}
/**
 * ReasoningBank - Trajectory storage and learning pipeline with AgentDB
 *
 * This class implements a complete learning pipeline for AI agents:
 * - Store and retrieve trajectories using vector similarity
 * - Judge trajectory quality using rule-based evaluation
 * - Distill successful trajectories into reusable patterns
 * - Consolidate patterns to remove duplicates and contradictions
 */
export declare class ReasoningBank {
    private config;
    private trajectories;
    private memories;
    private patterns;
    private eventListeners;
    private agentdb;
    private agentdbAvailable;
    private initialized;
    private retrievalCount;
    private totalRetrievalTime;
    private distillationCount;
    private totalDistillationTime;
    private judgeCount;
    private totalJudgeTime;
    private consolidationCount;
    private totalConsolidationTime;
    constructor(config?: Partial<ReasoningBankConfig>);
    /**
     * Initialize ReasoningBank with AgentDB
     */
    initialize(): Promise<void>;
    /**
     * Shutdown and cleanup resources
     */
    shutdown(): Promise<void>;
    /**
     * Retrieve relevant memories using Maximal Marginal Relevance (MMR)
     *
     * Uses AgentDB HNSW index for 150x faster retrieval when available.
     *
     * @param queryEmbedding - Query vector for similarity search
     * @param k - Number of results to return (default: config.retrievalK)
     * @returns Retrieval results with relevance and diversity scores
     */
    retrieve(queryEmbedding: Float32Array, k?: number): Promise<RetrievalResult[]>;
    /**
     * Search for similar memories by content string
     *
     * @param content - Text content to search for
     * @param k - Number of results
     * @returns Retrieval results
     */
    retrieveByContent(content: string, k?: number): Promise<RetrievalResult[]>;
    /**
     * Judge a trajectory and produce a verdict
     *
     * Uses rule-based evaluation to assess trajectory quality.
     * In production, this could be enhanced with LLM-as-judge.
     *
     * @param trajectory - Completed trajectory to judge
     * @returns Verdict with success status and analysis
     */
    judge(trajectory: Trajectory): Promise<TrajectoryVerdict>;
    /**
     * Distill a trajectory into a reusable memory
     *
     * @param trajectory - Trajectory to distill
     * @returns Distilled memory or null if quality too low
     */
    distill(trajectory: Trajectory): Promise<DistilledMemory | null>;
    /**
     * Batch distill multiple trajectories
     *
     * @param trajectories - Array of trajectories to distill
     * @returns Array of distilled memories (excludes nulls)
     */
    distillBatch(trajectories: Trajectory[]): Promise<DistilledMemory[]>;
    /**
     * Consolidate memories: deduplicate, detect contradictions, prune old
     *
     * @returns Consolidation statistics
     */
    consolidate(): Promise<ConsolidationResult>;
    /**
     * Convert a distilled memory to a pattern
     */
    memoryToPattern(memory: DistilledMemory): Pattern;
    /**
     * Evolve a pattern based on new experience
     */
    evolvePattern(patternId: string, newExperience: Trajectory): void;
    /**
     * Get all patterns
     */
    getPatterns(): Pattern[];
    /**
     * Find patterns matching a query
     */
    findPatterns(queryEmbedding: Float32Array, k?: number): Promise<Pattern[]>;
    /**
     * Store a trajectory
     */
    storeTrajectory(trajectory: Trajectory): void;
    /**
     * Get trajectory by ID
     */
    getTrajectory(trajectoryId: string): Trajectory | undefined;
    /**
     * Get all trajectories
     */
    getTrajectories(): Trajectory[];
    /**
     * Get successful trajectories
     */
    getSuccessfulTrajectories(): Trajectory[];
    /**
     * Get failed trajectories
     */
    getFailedTrajectories(): Trajectory[];
    /**
     * Get ReasoningBank statistics
     */
    getStats(): Record<string, number>;
    /**
     * Get detailed metrics for hooks
     */
    getDetailedMetrics(): {
        routing: {
            totalRoutes: number;
            avgConfidence: number;
            topAgents: Array<{
                agent: string;
                count: number;
                successRate: number;
            }>;
        };
        edits: {
            totalEdits: number;
            successRate: number;
            commonPatterns: string[];
        };
        commands: {
            totalCommands: number;
            successRate: number;
            avgExecutionTime: number;
            commonCommands: string[];
        };
    };
    addEventListener(listener: NeuralEventListener): void;
    removeEventListener(listener: NeuralEventListener): void;
    private emitEvent;
    /**
     * Store memory in AgentDB for vector search
     */
    private storeInAgentDB;
    /**
     * Search using AgentDB HNSW index
     */
    private searchWithAgentDB;
    /**
     * Delete from AgentDB
     */
    private deleteFromAgentDB;
    private cosineSimilarity;
    private computeContentSimilarity;
    private computeMaxSimilarity;
    private analyzeSteps;
    private identifyStrengths;
    private identifyWeaknesses;
    private generateImprovements;
    private computeRelevanceScore;
    private computeConfidence;
    private extractStrategy;
    private extractKeyLearnings;
    private computeAggregateEmbedding;
    private deduplicateMemories;
    private detectContradictions;
    private pruneOldPatterns;
    private mergePatterns;
    private pruneTrajectories;
    private generatePatternName;
    private inferDomain;
    private determineEvolutionType;
    /**
     * Check if AgentDB is available and initialized
     */
    isAgentDBAvailable(): boolean;
}
/**
 * Factory function for creating ReasoningBank
 */
export declare function createReasoningBank(config?: Partial<ReasoningBankConfig>): ReasoningBank;
/**
 * Create and initialize a ReasoningBank instance
 */
export declare function createInitializedReasoningBank(config?: Partial<ReasoningBankConfig>): Promise<ReasoningBank>;
//# sourceMappingURL=reasoning-bank.d.ts.map