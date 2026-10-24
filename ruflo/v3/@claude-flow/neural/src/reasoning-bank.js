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
// ============================================================================
// AgentDB Integration
// ============================================================================
let AgentDB;
let agentdbImportPromise;
async function ensureAgentDBImport() {
    if (!agentdbImportPromise) {
        agentdbImportPromise = (async () => {
            try {
                const agentdbModule = await import('agentdb');
                AgentDB = agentdbModule.AgentDB || agentdbModule.default;
            }
            catch {
                // AgentDB not available - will use fallback
                AgentDB = undefined;
            }
        })();
    }
    return agentdbImportPromise;
}
/**
 * Default ReasoningBank configuration
 */
const DEFAULT_CONFIG = {
    maxTrajectories: 5000,
    distillationThreshold: 0.6,
    retrievalK: 3,
    mmrLambda: 0.7,
    maxPatternAgeDays: 30,
    dedupThreshold: 0.95,
    enableContradictionDetection: true,
    dbPath: undefined,
    vectorDimension: 768,
    namespace: 'reasoning-bank',
    enableAgentDB: true,
};
// ============================================================================
// ReasoningBank Class
// ============================================================================
/**
 * ReasoningBank - Trajectory storage and learning pipeline with AgentDB
 *
 * This class implements a complete learning pipeline for AI agents:
 * - Store and retrieve trajectories using vector similarity
 * - Judge trajectory quality using rule-based evaluation
 * - Distill successful trajectories into reusable patterns
 * - Consolidate patterns to remove duplicates and contradictions
 */
export class ReasoningBank {
    config;
    trajectories = new Map();
    memories = new Map();
    patterns = new Map();
    eventListeners = new Set();
    // AgentDB instance for vector storage
    agentdb = null;
    agentdbAvailable = false;
    initialized = false;
    // Performance tracking
    retrievalCount = 0;
    totalRetrievalTime = 0;
    distillationCount = 0;
    totalDistillationTime = 0;
    judgeCount = 0;
    totalJudgeTime = 0;
    consolidationCount = 0;
    totalConsolidationTime = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ==========================================================================
    // Initialization
    // ==========================================================================
    /**
     * Initialize ReasoningBank with AgentDB
     */
    async initialize() {
        if (this.initialized)
            return;
        if (this.config.enableAgentDB) {
            await ensureAgentDBImport();
            this.agentdbAvailable = AgentDB !== undefined;
            if (this.agentdbAvailable) {
                try {
                    this.agentdb = new AgentDB({
                        dbPath: this.config.dbPath || ':memory:',
                        namespace: this.config.namespace,
                        vectorDimension: this.config.vectorDimension,
                        vectorBackend: 'auto',
                    });
                    await this.agentdb.initialize();
                    this.emitEvent({ type: 'memory_consolidated', memoriesCount: 0 });
                }
                catch (error) {
                    console.warn('AgentDB initialization failed, using fallback:', error);
                    this.agentdbAvailable = false;
                }
            }
        }
        this.initialized = true;
    }
    /**
     * Shutdown and cleanup resources
     */
    async shutdown() {
        if (this.agentdb) {
            await this.agentdb.close?.();
        }
        this.initialized = false;
    }
    // ==========================================================================
    // STEP 1: RETRIEVE - Top-k memory injection with MMR diversity
    // ==========================================================================
    /**
     * Retrieve relevant memories using Maximal Marginal Relevance (MMR)
     *
     * Uses AgentDB HNSW index for 150x faster retrieval when available.
     *
     * @param queryEmbedding - Query vector for similarity search
     * @param k - Number of results to return (default: config.retrievalK)
     * @returns Retrieval results with relevance and diversity scores
     */
    async retrieve(queryEmbedding, k) {
        const startTime = performance.now();
        const retrieveK = k ?? this.config.retrievalK;
        if (this.memories.size === 0) {
            return [];
        }
        let candidates = [];
        // Try AgentDB HNSW search first
        if (this.agentdb && this.agentdbAvailable) {
            try {
                const results = await this.searchWithAgentDB(queryEmbedding, retrieveK * 3);
                candidates = results
                    .map(r => {
                    const entry = this.memories.get(r.id);
                    return entry ? { entry, relevance: r.similarity } : null;
                })
                    .filter((c) => c !== null);
            }
            catch {
                // Fall through to brute-force
            }
        }
        // Fallback: brute-force search
        if (candidates.length === 0) {
            for (const entry of this.memories.values()) {
                const relevance = this.cosineSimilarity(queryEmbedding, entry.memory.embedding);
                candidates.push({ entry, relevance });
            }
            candidates.sort((a, b) => b.relevance - a.relevance);
        }
        // Apply MMR for diversity
        const results = [];
        const selected = [];
        while (results.length < retrieveK && candidates.length > 0) {
            let bestIdx = 0;
            let bestScore = -Infinity;
            for (let i = 0; i < candidates.length; i++) {
                const candidate = candidates[i];
                // Compute MMR score: lambda * relevance - (1 - lambda) * max_similarity_to_selected
                const relevance = candidate.relevance;
                let maxSimilarity = 0;
                for (const sel of selected) {
                    const sim = this.cosineSimilarity(candidate.entry.memory.embedding, sel.memory.embedding);
                    maxSimilarity = Math.max(maxSimilarity, sim);
                }
                const diversityScore = 1 - maxSimilarity;
                const mmrScore = this.config.mmrLambda * relevance +
                    (1 - this.config.mmrLambda) * diversityScore;
                if (mmrScore > bestScore) {
                    bestScore = mmrScore;
                    bestIdx = i;
                }
            }
            // Add best candidate
            const best = candidates[bestIdx];
            selected.push(best.entry);
            results.push({
                memory: best.entry.memory,
                relevanceScore: best.relevance,
                diversityScore: 1 - this.computeMaxSimilarity(best.entry, selected.slice(0, -1)),
                combinedScore: bestScore,
            });
            // Remove from candidates
            candidates.splice(bestIdx, 1);
        }
        // Update stats
        this.retrievalCount++;
        this.totalRetrievalTime += performance.now() - startTime;
        return results;
    }
    /**
     * Search for similar memories by content string
     *
     * @param content - Text content to search for
     * @param k - Number of results
     * @returns Retrieval results
     */
    async retrieveByContent(content, k) {
        // Simple content-based retrieval using memory strategies
        const retrieveK = k ?? this.config.retrievalK;
        const results = [];
        const contentLower = content.toLowerCase();
        const entries = Array.from(this.memories.values());
        // Score by content similarity
        const scored = entries.map(entry => ({
            entry,
            score: this.computeContentSimilarity(contentLower, entry.memory.strategy),
        }));
        scored.sort((a, b) => b.score - a.score);
        for (let i = 0; i < Math.min(retrieveK, scored.length); i++) {
            const { entry, score } = scored[i];
            if (score > 0) {
                results.push({
                    memory: entry.memory,
                    relevanceScore: score,
                    diversityScore: 1,
                    combinedScore: score,
                });
            }
        }
        return results;
    }
    // ==========================================================================
    // STEP 2: JUDGE - LLM-as-judge trajectory evaluation
    // ==========================================================================
    /**
     * Judge a trajectory and produce a verdict
     *
     * Uses rule-based evaluation to assess trajectory quality.
     * In production, this could be enhanced with LLM-as-judge.
     *
     * @param trajectory - Completed trajectory to judge
     * @returns Verdict with success status and analysis
     */
    async judge(trajectory) {
        const startTime = performance.now();
        if (!trajectory.isComplete) {
            throw new Error('Cannot judge incomplete trajectory');
        }
        // Analyze trajectory steps
        const stepAnalysis = this.analyzeSteps(trajectory.steps);
        // Compute success based on quality and step analysis
        const success = trajectory.qualityScore >= this.config.distillationThreshold &&
            stepAnalysis.positiveRatio > 0.6;
        // Identify strengths and weaknesses
        const strengths = this.identifyStrengths(trajectory, stepAnalysis);
        const weaknesses = this.identifyWeaknesses(trajectory, stepAnalysis);
        // Generate improvement suggestions
        const improvements = this.generateImprovements(weaknesses);
        // Compute relevance for similar future tasks
        const relevanceScore = this.computeRelevanceScore(trajectory);
        const verdict = {
            success,
            confidence: this.computeConfidence(trajectory, stepAnalysis),
            strengths,
            weaknesses,
            improvements,
            relevanceScore,
        };
        // Store verdict with trajectory
        trajectory.verdict = verdict;
        // Update stats
        this.judgeCount++;
        this.totalJudgeTime += performance.now() - startTime;
        return verdict;
    }
    // ==========================================================================
    // STEP 3: DISTILL - Extract strategy memories from trajectories
    // ==========================================================================
    /**
     * Distill a trajectory into a reusable memory
     *
     * @param trajectory - Trajectory to distill
     * @returns Distilled memory or null if quality too low
     */
    async distill(trajectory) {
        const startTime = performance.now();
        // Must be judged first
        if (!trajectory.verdict) {
            await this.judge(trajectory);
        }
        // Only distill successful trajectories
        if (!trajectory.verdict.success ||
            trajectory.qualityScore < this.config.distillationThreshold) {
            return null;
        }
        // Extract strategy from trajectory
        const strategy = this.extractStrategy(trajectory);
        // Extract key learnings
        const keyLearnings = this.extractKeyLearnings(trajectory);
        // Compute aggregated embedding
        const embedding = this.computeAggregateEmbedding(trajectory);
        const memory = {
            memoryId: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            trajectoryId: trajectory.trajectoryId,
            strategy,
            keyLearnings,
            embedding,
            quality: trajectory.qualityScore,
            usageCount: 0,
            lastUsed: Date.now(),
        };
        // Store the memory
        const entry = {
            memory,
            trajectory,
            verdict: trajectory.verdict,
            consolidated: false,
        };
        this.memories.set(memory.memoryId, entry);
        // Store in AgentDB for vector search
        if (this.agentdb && this.agentdbAvailable) {
            await this.storeInAgentDB(memory);
        }
        // Also store trajectory reference
        trajectory.distilledMemory = memory;
        // Update stats
        this.distillationCount++;
        this.totalDistillationTime += performance.now() - startTime;
        this.emitEvent({
            type: 'trajectory_completed',
            trajectoryId: trajectory.trajectoryId,
            qualityScore: trajectory.qualityScore,
        });
        return memory;
    }
    /**
     * Batch distill multiple trajectories
     *
     * @param trajectories - Array of trajectories to distill
     * @returns Array of distilled memories (excludes nulls)
     */
    async distillBatch(trajectories) {
        const memories = [];
        for (const trajectory of trajectories) {
            const memory = await this.distill(trajectory);
            if (memory) {
                memories.push(memory);
            }
        }
        return memories;
    }
    // ==========================================================================
    // STEP 4: CONSOLIDATE - Dedup, detect contradictions, prune old patterns
    // ==========================================================================
    /**
     * Consolidate memories: deduplicate, detect contradictions, prune old
     *
     * @returns Consolidation statistics
     */
    async consolidate() {
        const startTime = performance.now();
        const result = {
            removedDuplicates: 0,
            contradictionsDetected: 0,
            prunedPatterns: 0,
            mergedPatterns: 0,
        };
        // 1. Deduplicate similar memories
        result.removedDuplicates = await this.deduplicateMemories();
        // 2. Detect contradictions
        if (this.config.enableContradictionDetection) {
            result.contradictionsDetected = await this.detectContradictions();
        }
        // 3. Prune old patterns
        result.prunedPatterns = await this.pruneOldPatterns();
        // 4. Merge similar patterns
        result.mergedPatterns = await this.mergePatterns();
        // Update stats
        this.consolidationCount++;
        this.totalConsolidationTime += performance.now() - startTime;
        // Emit consolidation event
        this.emitEvent({
            type: 'memory_consolidated',
            memoriesCount: this.memories.size,
        });
        return result;
    }
    // ==========================================================================
    // Pattern Management
    // ==========================================================================
    /**
     * Convert a distilled memory to a pattern
     */
    memoryToPattern(memory) {
        const pattern = {
            patternId: `pat_${memory.memoryId}`,
            name: this.generatePatternName(memory),
            domain: this.inferDomain(memory),
            embedding: memory.embedding,
            strategy: memory.strategy,
            successRate: memory.quality,
            usageCount: memory.usageCount,
            qualityHistory: [memory.quality],
            evolutionHistory: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.patterns.set(pattern.patternId, pattern);
        return pattern;
    }
    /**
     * Evolve a pattern based on new experience
     */
    evolvePattern(patternId, newExperience) {
        const pattern = this.patterns.get(patternId);
        if (!pattern)
            return;
        const previousQuality = pattern.successRate;
        // Update quality history
        pattern.qualityHistory.push(newExperience.qualityScore);
        if (pattern.qualityHistory.length > 100) {
            pattern.qualityHistory = pattern.qualityHistory.slice(-100);
        }
        // Update success rate
        pattern.successRate = pattern.qualityHistory.reduce((a, b) => a + b, 0) /
            pattern.qualityHistory.length;
        pattern.usageCount++;
        pattern.updatedAt = Date.now();
        // Record evolution
        const evolutionType = this.determineEvolutionType(previousQuality, pattern.successRate);
        pattern.evolutionHistory.push({
            timestamp: Date.now(),
            type: evolutionType,
            previousQuality,
            newQuality: pattern.successRate,
            description: `Updated based on trajectory ${newExperience.trajectoryId}`,
        });
        // Emit event
        this.emitEvent({
            type: 'pattern_evolved',
            patternId,
            evolutionType,
        });
    }
    /**
     * Get all patterns
     */
    getPatterns() {
        return Array.from(this.patterns.values());
    }
    /**
     * Find patterns matching a query
     */
    async findPatterns(queryEmbedding, k = 5) {
        const results = [];
        for (const pattern of this.patterns.values()) {
            const score = this.cosineSimilarity(queryEmbedding, pattern.embedding);
            results.push({ pattern, score });
        }
        results.sort((a, b) => b.score - a.score);
        return results.slice(0, k).map(r => r.pattern);
    }
    // ==========================================================================
    // Trajectory Management
    // ==========================================================================
    /**
     * Store a trajectory
     */
    storeTrajectory(trajectory) {
        this.trajectories.set(trajectory.trajectoryId, trajectory);
        // Prune if over capacity
        if (this.trajectories.size > this.config.maxTrajectories) {
            this.pruneTrajectories();
        }
    }
    /**
     * Get trajectory by ID
     */
    getTrajectory(trajectoryId) {
        return this.trajectories.get(trajectoryId);
    }
    /**
     * Get all trajectories
     */
    getTrajectories() {
        return Array.from(this.trajectories.values());
    }
    /**
     * Get successful trajectories
     */
    getSuccessfulTrajectories() {
        return Array.from(this.trajectories.values())
            .filter(t => t.verdict?.success);
    }
    /**
     * Get failed trajectories
     */
    getFailedTrajectories() {
        return Array.from(this.trajectories.values())
            .filter(t => t.isComplete && !t.verdict?.success);
    }
    // ==========================================================================
    // Statistics
    // ==========================================================================
    /**
     * Get ReasoningBank statistics
     */
    getStats() {
        return {
            trajectoryCount: this.trajectories.size,
            memoryCount: this.memories.size,
            patternCount: this.patterns.size,
            avgRetrievalTimeMs: this.retrievalCount > 0
                ? this.totalRetrievalTime / this.retrievalCount
                : 0,
            avgDistillationTimeMs: this.distillationCount > 0
                ? this.totalDistillationTime / this.distillationCount
                : 0,
            avgJudgeTimeMs: this.judgeCount > 0
                ? this.totalJudgeTime / this.judgeCount
                : 0,
            avgConsolidationTimeMs: this.consolidationCount > 0
                ? this.totalConsolidationTime / this.consolidationCount
                : 0,
            consolidatedMemories: Array.from(this.memories.values())
                .filter(e => e.consolidated).length,
            successfulTrajectories: this.getSuccessfulTrajectories().length,
            failedTrajectories: this.getFailedTrajectories().length,
            agentdbEnabled: this.agentdbAvailable ? 1 : 0,
            retrievalCount: this.retrievalCount,
            distillationCount: this.distillationCount,
            judgeCount: this.judgeCount,
            consolidationCount: this.consolidationCount,
        };
    }
    /**
     * Get detailed metrics for hooks
     */
    getDetailedMetrics() {
        const successfulTrajectories = this.getSuccessfulTrajectories();
        const allTrajectories = this.getTrajectories();
        const successRate = allTrajectories.length > 0
            ? successfulTrajectories.length / allTrajectories.length
            : 0;
        // Extract domain-based routing stats
        const domainStats = new Map();
        for (const t of allTrajectories) {
            const domain = t.domain || 'general';
            const stats = domainStats.get(domain) || { count: 0, successes: 0 };
            stats.count++;
            if (t.verdict?.success)
                stats.successes++;
            domainStats.set(domain, stats);
        }
        const topAgents = Array.from(domainStats.entries())
            .map(([agent, stats]) => ({
            agent,
            count: stats.count,
            successRate: stats.count > 0 ? stats.successes / stats.count : 0,
        }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        // Extract common patterns
        const patternStrategies = Array.from(this.patterns.values())
            .sort((a, b) => b.usageCount - a.usageCount)
            .slice(0, 5)
            .map(p => p.strategy);
        return {
            routing: {
                totalRoutes: allTrajectories.length,
                avgConfidence: successfulTrajectories.length > 0
                    ? successfulTrajectories.reduce((sum, t) => sum + (t.verdict?.confidence || 0), 0) / successfulTrajectories.length
                    : 0,
                topAgents,
            },
            edits: {
                totalEdits: this.memories.size,
                successRate,
                commonPatterns: patternStrategies.slice(0, 4),
            },
            commands: {
                totalCommands: this.distillationCount,
                successRate,
                avgExecutionTime: this.totalDistillationTime / Math.max(this.distillationCount, 1),
                commonCommands: patternStrategies.slice(0, 4),
            },
        };
    }
    // ==========================================================================
    // Event System
    // ==========================================================================
    addEventListener(listener) {
        this.eventListeners.add(listener);
    }
    removeEventListener(listener) {
        this.eventListeners.delete(listener);
    }
    emitEvent(event) {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            }
            catch (error) {
                console.error('Error in ReasoningBank event listener:', error);
            }
        }
    }
    // ==========================================================================
    // AgentDB Integration Helpers
    // ==========================================================================
    /**
     * Store memory in AgentDB for vector search
     */
    async storeInAgentDB(memory) {
        if (!this.agentdb)
            return;
        try {
            if (typeof this.agentdb.store === 'function') {
                await this.agentdb.store(memory.memoryId, {
                    content: memory.strategy,
                    embedding: memory.embedding,
                    metadata: {
                        trajectoryId: memory.trajectoryId,
                        quality: memory.quality,
                        keyLearnings: memory.keyLearnings,
                        usageCount: memory.usageCount,
                        lastUsed: memory.lastUsed,
                    },
                });
            }
        }
        catch (error) {
            console.warn('Failed to store in AgentDB:', error);
        }
    }
    /**
     * Search using AgentDB HNSW index
     */
    async searchWithAgentDB(queryEmbedding, k) {
        if (!this.agentdb)
            return [];
        try {
            if (typeof this.agentdb.search === 'function') {
                return await this.agentdb.search(queryEmbedding, k);
            }
            // Try HNSW controller if available
            const hnsw = this.agentdb.getController?.('hnsw');
            if (hnsw) {
                const results = await hnsw.search(queryEmbedding, k);
                return results.map((r) => ({
                    id: String(r.id),
                    similarity: r.similarity || 1 - r.distance,
                }));
            }
        }
        catch {
            // Fall through to return empty
        }
        return [];
    }
    /**
     * Delete from AgentDB
     */
    async deleteFromAgentDB(memoryId) {
        if (!this.agentdb)
            return;
        try {
            if (typeof this.agentdb.delete === 'function') {
                await this.agentdb.delete(memoryId);
            }
        }
        catch {
            // Ignore deletion errors
        }
    }
    // ==========================================================================
    // Private Helper Methods
    // ==========================================================================
    cosineSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        // Clamp to [0, 1] to handle floating point precision issues
        const similarity = denom > 0 ? dot / denom : 0;
        return Math.max(0, Math.min(1, similarity));
    }
    computeContentSimilarity(query, content) {
        const queryWords = new Set(query.toLowerCase().split(/\s+/));
        const contentWords = content.toLowerCase().split(/\s+/);
        let matches = 0;
        for (const word of contentWords) {
            if (queryWords.has(word))
                matches++;
        }
        return contentWords.length > 0 ? matches / contentWords.length : 0;
    }
    computeMaxSimilarity(entry, selected) {
        let maxSim = 0;
        for (const sel of selected) {
            const sim = this.cosineSimilarity(entry.memory.embedding, sel.memory.embedding);
            maxSim = Math.max(maxSim, sim);
        }
        return maxSim;
    }
    analyzeSteps(steps) {
        const rewardSum = steps.reduce((s, step) => s + step.reward, 0);
        const positiveSteps = steps.filter(s => s.reward > 0.5).length;
        return {
            totalSteps: steps.length,
            avgReward: steps.length > 0 ? rewardSum / steps.length : 0,
            positiveRatio: steps.length > 0 ? positiveSteps / steps.length : 0,
            trajectory: steps.length > 1
                ? (steps[steps.length - 1].reward - steps[0].reward)
                : 0,
        };
    }
    identifyStrengths(trajectory, analysis) {
        const strengths = [];
        if (analysis.avgReward > 0.7) {
            strengths.push('High average reward across steps');
        }
        if (analysis.trajectory > 0.2) {
            strengths.push('Positive reward trajectory');
        }
        if (trajectory.qualityScore > 0.8) {
            strengths.push('High overall quality');
        }
        if (analysis.totalSteps < 5 && trajectory.qualityScore > 0.6) {
            strengths.push('Efficient solution (few steps)');
        }
        return strengths;
    }
    identifyWeaknesses(trajectory, analysis) {
        const weaknesses = [];
        if (analysis.avgReward < 0.4) {
            weaknesses.push('Low average reward');
        }
        if (analysis.trajectory < -0.1) {
            weaknesses.push('Declining reward trajectory');
        }
        if (analysis.positiveRatio < 0.5) {
            weaknesses.push('Many negative/neutral steps');
        }
        if (analysis.totalSteps > 10 && trajectory.qualityScore < 0.7) {
            weaknesses.push('Long trajectory with mediocre outcome');
        }
        return weaknesses;
    }
    generateImprovements(weaknesses) {
        const improvements = [];
        for (const weakness of weaknesses) {
            if (weakness.includes('Low average reward')) {
                improvements.push('Consider alternative strategies for each step');
            }
            if (weakness.includes('Declining')) {
                improvements.push('Re-evaluate approach when reward decreases');
            }
            if (weakness.includes('negative/neutral')) {
                improvements.push('Focus on steps with clearer positive signals');
            }
            if (weakness.includes('Long trajectory')) {
                improvements.push('Look for shortcuts or more direct approaches');
            }
        }
        return improvements;
    }
    computeRelevanceScore(trajectory) {
        // Base relevance on quality and recency
        const qualityFactor = trajectory.qualityScore;
        const ageDays = (Date.now() - trajectory.startTime) / (1000 * 60 * 60 * 24);
        const recencyFactor = Math.exp(-ageDays / 30); // Decay over 30 days
        return qualityFactor * 0.7 + recencyFactor * 0.3;
    }
    computeConfidence(trajectory, analysis) {
        // More steps = more confidence
        const stepFactor = Math.min(analysis.totalSteps / 10, 1);
        // Consistent rewards = more confidence
        const consistencyFactor = analysis.positiveRatio;
        // Clear outcome = more confidence
        const outcomeFactor = Math.abs(trajectory.qualityScore - 0.5) * 2;
        return (stepFactor * 0.3 + consistencyFactor * 0.4 + outcomeFactor * 0.3);
    }
    extractStrategy(trajectory) {
        const actions = trajectory.steps.map(s => s.action);
        const uniqueActions = [...new Set(actions)];
        if (uniqueActions.length <= 3) {
            return `Apply ${uniqueActions.join(' -> ')}`;
        }
        return `Multi-step approach: ${uniqueActions.slice(0, 3).join(', ')}...`;
    }
    extractKeyLearnings(trajectory) {
        const learnings = [];
        const verdict = trajectory.verdict;
        // Add key success factors
        if (verdict.success) {
            learnings.push(`Successful approach for ${trajectory.domain} domain`);
            for (const strength of verdict.strengths.slice(0, 2)) {
                learnings.push(`Strength: ${strength}`);
            }
        }
        else {
            learnings.push(`Approach needs refinement`);
            for (const improvement of verdict.improvements.slice(0, 2)) {
                learnings.push(`Improvement: ${improvement}`);
            }
        }
        return learnings;
    }
    computeAggregateEmbedding(trajectory) {
        if (trajectory.steps.length === 0) {
            return new Float32Array(this.config.vectorDimension);
        }
        const dim = trajectory.steps[0].stateAfter.length;
        const aggregate = new Float32Array(dim);
        // Weighted average of step embeddings (higher weight for later steps)
        let totalWeight = 0;
        for (let i = 0; i < trajectory.steps.length; i++) {
            const weight = (i + 1) / trajectory.steps.length;
            totalWeight += weight;
            const step = trajectory.steps[i];
            for (let j = 0; j < dim; j++) {
                aggregate[j] += step.stateAfter[j] * weight;
            }
        }
        // Normalize
        for (let j = 0; j < dim; j++) {
            aggregate[j] /= totalWeight;
        }
        return aggregate;
    }
    async deduplicateMemories() {
        let removed = 0;
        const entries = Array.from(this.memories.entries());
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                const sim = this.cosineSimilarity(entries[i][1].memory.embedding, entries[j][1].memory.embedding);
                if (sim > this.config.dedupThreshold) {
                    // Keep the higher quality one
                    if (entries[i][1].memory.quality >= entries[j][1].memory.quality) {
                        this.memories.delete(entries[j][0]);
                        await this.deleteFromAgentDB(entries[j][0]);
                    }
                    else {
                        this.memories.delete(entries[i][0]);
                        await this.deleteFromAgentDB(entries[i][0]);
                    }
                    removed++;
                }
            }
        }
        return removed;
    }
    async detectContradictions() {
        let contradictions = 0;
        const entries = Array.from(this.memories.values());
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                // Similar context but opposite outcomes
                const sim = this.cosineSimilarity(entries[i].memory.embedding, entries[j].memory.embedding);
                if (sim > 0.8) {
                    const qualityDiff = Math.abs(entries[i].memory.quality - entries[j].memory.quality);
                    if (qualityDiff > 0.4) {
                        contradictions++;
                        // Mark lower quality as consolidated (to exclude from retrieval)
                        if (entries[i].memory.quality < entries[j].memory.quality) {
                            entries[i].consolidated = true;
                        }
                        else {
                            entries[j].consolidated = true;
                        }
                    }
                }
            }
        }
        return contradictions;
    }
    async pruneOldPatterns() {
        const now = Date.now();
        const maxAge = this.config.maxPatternAgeDays * 24 * 60 * 60 * 1000;
        let pruned = 0;
        for (const [id, pattern] of this.patterns) {
            const age = now - pattern.updatedAt;
            if (age > maxAge && pattern.usageCount < 5) {
                this.patterns.delete(id);
                pruned++;
            }
        }
        return pruned;
    }
    async mergePatterns() {
        let merged = 0;
        const patterns = Array.from(this.patterns.entries());
        for (let i = 0; i < patterns.length; i++) {
            for (let j = i + 1; j < patterns.length; j++) {
                const sim = this.cosineSimilarity(patterns[i][1].embedding, patterns[j][1].embedding);
                if (sim > 0.9 && patterns[i][1].domain === patterns[j][1].domain) {
                    // Merge into higher quality pattern
                    const [keepId, keep] = patterns[i][1].successRate >= patterns[j][1].successRate
                        ? patterns[i]
                        : patterns[j];
                    const [removeId, remove] = patterns[i][1].successRate < patterns[j][1].successRate
                        ? patterns[i]
                        : patterns[j];
                    // Combine statistics
                    keep.usageCount += remove.usageCount;
                    keep.qualityHistory.push(...remove.qualityHistory);
                    keep.evolutionHistory.push({
                        timestamp: Date.now(),
                        type: 'merge',
                        previousQuality: keep.successRate,
                        newQuality: (keep.successRate + remove.successRate) / 2,
                        description: `Merged with pattern ${removeId}`,
                    });
                    this.patterns.delete(removeId);
                    merged++;
                }
            }
        }
        return merged;
    }
    pruneTrajectories() {
        const entries = Array.from(this.trajectories.entries())
            .sort((a, b) => a[1].qualityScore - b[1].qualityScore);
        const toRemove = entries.length - Math.floor(this.config.maxTrajectories * 0.8);
        for (let i = 0; i < toRemove && i < entries.length; i++) {
            this.trajectories.delete(entries[i][0]);
        }
    }
    generatePatternName(memory) {
        const words = memory.strategy.split(' ').slice(0, 4);
        return words.join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
    }
    inferDomain(memory) {
        // First check if we have the trajectory directly in our store
        const trajectory = this.trajectories.get(memory.trajectoryId);
        if (trajectory?.domain) {
            return trajectory.domain;
        }
        // Check if the memory entry has the trajectory with domain info
        const memoryEntry = this.memories.get(memory.memoryId);
        if (memoryEntry?.trajectory?.domain) {
            return memoryEntry.trajectory.domain;
        }
        return 'general';
    }
    determineEvolutionType(prev, curr) {
        const delta = curr - prev;
        if (delta > 0.05)
            return 'improvement';
        if (delta < -0.1)
            return 'prune';
        return 'improvement';
    }
    /**
     * Check if AgentDB is available and initialized
     */
    isAgentDBAvailable() {
        return this.agentdbAvailable;
    }
}
// ============================================================================
// Factory Function
// ============================================================================
/**
 * Factory function for creating ReasoningBank
 */
export function createReasoningBank(config) {
    return new ReasoningBank(config);
}
/**
 * Create and initialize a ReasoningBank instance
 */
export async function createInitializedReasoningBank(config) {
    const bank = new ReasoningBank(config);
    await bank.initialize();
    return bank;
}
//# sourceMappingURL=reasoning-bank.js.map