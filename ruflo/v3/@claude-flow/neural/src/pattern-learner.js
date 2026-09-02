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
/**
 * Default Pattern Learner configuration
 */
const DEFAULT_CONFIG = {
    maxPatterns: 1000,
    matchThreshold: 0.7,
    minUsagesForStable: 5,
    qualityThreshold: 0.5,
    enableClustering: true,
    numClusters: 50,
    evolutionLearningRate: 0.1,
};
/**
 * Pattern Learner - Manages pattern extraction, matching, and evolution
 */
export class PatternLearner {
    config;
    patterns = new Map();
    clusters = [];
    patternToCluster = new Map();
    // Performance tracking
    matchCount = 0;
    totalMatchTime = 0;
    extractionCount = 0;
    totalExtractionTime = 0;
    evolutionCount = 0;
    totalEvolutionTime = 0;
    // Event listeners
    eventListeners = new Set();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    // ==========================================================================
    // Pattern Matching
    // ==========================================================================
    /**
     * Find matching patterns for a query embedding
     * Target: <1ms
     */
    findMatches(queryEmbedding, k = 3) {
        const startTime = performance.now();
        if (this.patterns.size === 0) {
            return [];
        }
        let candidates;
        // Use clustering for faster search if enabled and clusters exist
        if (this.config.enableClustering && this.clusters.length > 0) {
            candidates = this.getCandidatesFromClusters(queryEmbedding);
        }
        else {
            candidates = Array.from(this.patterns.values());
        }
        // Compute similarities
        const matches = [];
        for (const pattern of candidates) {
            const similarity = this.cosineSimilarity(queryEmbedding, pattern.embedding);
            if (similarity >= this.config.matchThreshold) {
                matches.push({
                    pattern,
                    similarity,
                    confidence: this.computeMatchConfidence(pattern, similarity),
                    latencyMs: 0,
                });
            }
        }
        // Sort by similarity
        matches.sort((a, b) => b.similarity - a.similarity);
        const result = matches.slice(0, k);
        // Track performance
        const elapsed = performance.now() - startTime;
        this.matchCount++;
        this.totalMatchTime += elapsed;
        // Warn if over target
        if (elapsed > 1) {
            console.warn(`Pattern matching exceeded target: ${elapsed.toFixed(2)}ms > 1ms`);
        }
        return result;
    }
    /**
     * Find best single match
     */
    findBestMatch(queryEmbedding) {
        const matches = this.findMatches(queryEmbedding, 1);
        return matches.length > 0 ? matches[0] : null;
    }
    // ==========================================================================
    // Pattern Extraction
    // ==========================================================================
    /**
     * Extract a pattern from a trajectory
     * Target: <5ms
     */
    extractPattern(trajectory, memory) {
        const startTime = performance.now();
        // Validate trajectory
        if (!trajectory.isComplete || trajectory.qualityScore < this.config.qualityThreshold) {
            return null;
        }
        // Check for duplicates
        const embedding = this.computePatternEmbedding(trajectory);
        const existing = this.findSimilarPattern(embedding, 0.95);
        if (existing) {
            // Update existing pattern instead
            this.updatePatternFromTrajectory(existing, trajectory);
            return existing;
        }
        // Create new pattern
        const pattern = {
            patternId: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            name: this.generatePatternName(trajectory),
            domain: trajectory.domain,
            embedding,
            strategy: this.extractStrategy(trajectory),
            successRate: trajectory.qualityScore,
            usageCount: 1,
            qualityHistory: [trajectory.qualityScore],
            evolutionHistory: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        // Store pattern
        this.patterns.set(pattern.patternId, pattern);
        // Update clusters if enabled
        if (this.config.enableClustering) {
            this.assignToCluster(pattern);
        }
        // Prune if over capacity
        if (this.patterns.size > this.config.maxPatterns) {
            this.prunePatterns();
        }
        // Track performance
        const elapsed = performance.now() - startTime;
        this.extractionCount++;
        this.totalExtractionTime += elapsed;
        return pattern;
    }
    /**
     * Extract patterns from multiple trajectories in batch
     */
    extractPatternsBatch(trajectories) {
        const patterns = [];
        for (const trajectory of trajectories) {
            const pattern = this.extractPattern(trajectory);
            if (pattern) {
                patterns.push(pattern);
            }
        }
        // Rebuild clusters after batch extraction
        if (this.config.enableClustering && patterns.length > 10) {
            this.rebuildClusters();
        }
        return patterns;
    }
    // ==========================================================================
    // Pattern Evolution
    // ==========================================================================
    /**
     * Evolve a pattern based on new experience
     * Target: <2ms
     */
    evolvePattern(patternId, quality, context) {
        const startTime = performance.now();
        const pattern = this.patterns.get(patternId);
        if (!pattern)
            return;
        const previousQuality = pattern.successRate;
        const lr = this.config.evolutionLearningRate;
        // Update quality history
        pattern.qualityHistory.push(quality);
        if (pattern.qualityHistory.length > 100) {
            pattern.qualityHistory = pattern.qualityHistory.slice(-100);
        }
        // Exponential moving average for success rate
        pattern.successRate = pattern.successRate * (1 - lr) + quality * lr;
        pattern.usageCount++;
        pattern.updatedAt = Date.now();
        // Record evolution
        const evolutionType = this.determineEvolutionType(previousQuality, pattern.successRate);
        pattern.evolutionHistory.push({
            timestamp: Date.now(),
            type: evolutionType,
            previousQuality,
            newQuality: pattern.successRate,
            description: context || 'Updated from new experience',
        });
        // Keep evolution history bounded
        if (pattern.evolutionHistory.length > 50) {
            pattern.evolutionHistory = pattern.evolutionHistory.slice(-50);
        }
        // Emit event
        this.emitEvent({
            type: 'pattern_evolved',
            patternId,
            evolutionType,
        });
        // Track performance
        const elapsed = performance.now() - startTime;
        this.evolutionCount++;
        this.totalEvolutionTime += elapsed;
    }
    /**
     * Merge two similar patterns
     */
    mergePatterns(patternId1, patternId2) {
        const p1 = this.patterns.get(patternId1);
        const p2 = this.patterns.get(patternId2);
        if (!p1 || !p2)
            return null;
        // Keep the higher quality pattern as base
        const [keep, remove] = p1.successRate >= p2.successRate ? [p1, p2] : [p2, p1];
        // Merge embeddings (weighted average)
        const totalUsage = keep.usageCount + remove.usageCount;
        const w1 = keep.usageCount / totalUsage;
        const w2 = remove.usageCount / totalUsage;
        for (let i = 0; i < keep.embedding.length; i++) {
            keep.embedding[i] = keep.embedding[i] * w1 + remove.embedding[i] * w2;
        }
        // Merge statistics
        keep.usageCount += remove.usageCount;
        keep.qualityHistory.push(...remove.qualityHistory);
        keep.successRate = keep.qualityHistory.reduce((a, b) => a + b, 0) / keep.qualityHistory.length;
        // Record merge
        keep.evolutionHistory.push({
            timestamp: Date.now(),
            type: 'merge',
            previousQuality: p1.successRate,
            newQuality: keep.successRate,
            description: `Merged with pattern ${remove.patternId}`,
        });
        // Remove the merged pattern
        this.patterns.delete(remove.patternId);
        this.patternToCluster.delete(remove.patternId);
        return keep;
    }
    /**
     * Split a pattern into more specific sub-patterns
     */
    splitPattern(patternId, numSplits = 2) {
        const pattern = this.patterns.get(patternId);
        if (!pattern || numSplits < 2)
            return [];
        const splits = [];
        for (let i = 0; i < numSplits; i++) {
            // Create variation of embedding with noise
            const newEmbedding = new Float32Array(pattern.embedding.length);
            for (let j = 0; j < newEmbedding.length; j++) {
                const noise = (Math.random() - 0.5) * 0.1;
                newEmbedding[j] = pattern.embedding[j] + noise;
            }
            const newPattern = {
                patternId: `pat_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
                name: `${pattern.name}_split_${i}`,
                domain: pattern.domain,
                embedding: newEmbedding,
                strategy: pattern.strategy,
                successRate: pattern.successRate * 0.9, // Slight penalty for uncertainty
                usageCount: 0,
                qualityHistory: [],
                evolutionHistory: [{
                        timestamp: Date.now(),
                        type: 'split',
                        previousQuality: pattern.successRate,
                        newQuality: pattern.successRate * 0.9,
                        description: `Split from pattern ${patternId}`,
                    }],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            this.patterns.set(newPattern.patternId, newPattern);
            splits.push(newPattern);
        }
        // Remove original pattern
        this.patterns.delete(patternId);
        this.patternToCluster.delete(patternId);
        // Rebuild clusters
        if (this.config.enableClustering) {
            this.rebuildClusters();
        }
        return splits;
    }
    // ==========================================================================
    // Pattern Access
    // ==========================================================================
    /**
     * Get all patterns
     */
    getPatterns() {
        return Array.from(this.patterns.values());
    }
    /**
     * Get pattern by ID
     */
    getPattern(patternId) {
        return this.patterns.get(patternId);
    }
    /**
     * Get patterns by domain
     */
    getPatternsByDomain(domain) {
        return Array.from(this.patterns.values()).filter(p => p.domain === domain);
    }
    /**
     * Get stable patterns (sufficient usage)
     */
    getStablePatterns() {
        return Array.from(this.patterns.values())
            .filter(p => p.usageCount >= this.config.minUsagesForStable);
    }
    // ==========================================================================
    // Statistics
    // ==========================================================================
    getStats() {
        const patterns = Array.from(this.patterns.values());
        return {
            totalPatterns: this.patterns.size,
            stablePatterns: patterns.filter(p => p.usageCount >= this.config.minUsagesForStable).length,
            avgSuccessRate: patterns.length > 0
                ? patterns.reduce((s, p) => s + p.successRate, 0) / patterns.length
                : 0,
            avgUsageCount: patterns.length > 0
                ? patterns.reduce((s, p) => s + p.usageCount, 0) / patterns.length
                : 0,
            numClusters: this.clusters.length,
            avgMatchTimeMs: this.matchCount > 0 ? this.totalMatchTime / this.matchCount : 0,
            avgExtractionTimeMs: this.extractionCount > 0 ? this.totalExtractionTime / this.extractionCount : 0,
            avgEvolutionTimeMs: this.evolutionCount > 0 ? this.totalEvolutionTime / this.evolutionCount : 0,
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
                console.error('Error in PatternLearner event listener:', error);
            }
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
        return denom > 0 ? dot / denom : 0;
    }
    computeMatchConfidence(pattern, similarity) {
        // Combine similarity with pattern reliability
        const usageWeight = Math.min(pattern.usageCount / 10, 1);
        const qualityWeight = pattern.successRate;
        return similarity * (1 - usageWeight * 0.2 - qualityWeight * 0.2) +
            usageWeight * 0.1 +
            qualityWeight * 0.1;
    }
    getCandidatesFromClusters(queryEmbedding) {
        // Find nearest clusters
        const clusterScores = [];
        for (const cluster of this.clusters) {
            const score = this.cosineSimilarity(queryEmbedding, cluster.centroid);
            clusterScores.push({ cluster, score });
        }
        clusterScores.sort((a, b) => b.score - a.score);
        // Get patterns from top 3 clusters
        const candidates = [];
        for (const { cluster } of clusterScores.slice(0, 3)) {
            for (const patternId of cluster.patternIds) {
                const pattern = this.patterns.get(patternId);
                if (pattern) {
                    candidates.push(pattern);
                }
            }
        }
        return candidates;
    }
    findSimilarPattern(embedding, threshold) {
        for (const pattern of this.patterns.values()) {
            const sim = this.cosineSimilarity(embedding, pattern.embedding);
            if (sim >= threshold) {
                return pattern;
            }
        }
        return null;
    }
    updatePatternFromTrajectory(pattern, trajectory) {
        // Update quality
        pattern.qualityHistory.push(trajectory.qualityScore);
        if (pattern.qualityHistory.length > 100) {
            pattern.qualityHistory = pattern.qualityHistory.slice(-100);
        }
        // EMA for success rate
        const lr = this.config.evolutionLearningRate;
        pattern.successRate = pattern.successRate * (1 - lr) + trajectory.qualityScore * lr;
        pattern.usageCount++;
        pattern.updatedAt = Date.now();
    }
    computePatternEmbedding(trajectory) {
        if (trajectory.steps.length === 0) {
            return new Float32Array(768);
        }
        const dim = trajectory.steps[0].stateAfter.length;
        const embedding = new Float32Array(dim);
        // Weighted average (higher weight for later steps)
        let totalWeight = 0;
        for (let i = 0; i < trajectory.steps.length; i++) {
            const weight = (i + 1) / trajectory.steps.length;
            totalWeight += weight;
            for (let j = 0; j < dim; j++) {
                embedding[j] += trajectory.steps[i].stateAfter[j] * weight;
            }
        }
        for (let j = 0; j < dim; j++) {
            embedding[j] /= totalWeight;
        }
        return embedding;
    }
    generatePatternName(trajectory) {
        const domain = trajectory.domain;
        const quality = trajectory.qualityScore > 0.7 ? 'high' : 'mid';
        const steps = trajectory.steps.length > 5 ? 'complex' : 'simple';
        return `${domain}_${quality}_${steps}_${Date.now() % 10000}`;
    }
    extractStrategy(trajectory) {
        const actions = trajectory.steps.map(s => s.action);
        if (actions.length === 0)
            return 'empty';
        if (actions.length <= 3)
            return actions.join(' -> ');
        return `${actions.slice(0, 2).join(' -> ')} ... ${actions[actions.length - 1]}`;
    }
    assignToCluster(pattern) {
        if (this.clusters.length === 0) {
            // Create first cluster
            this.clusters.push({
                clusterId: 0,
                centroid: new Float32Array(pattern.embedding),
                patternIds: new Set([pattern.patternId]),
            });
            this.patternToCluster.set(pattern.patternId, 0);
            return;
        }
        // Find nearest cluster
        let bestCluster = 0;
        let bestSim = -1;
        for (let i = 0; i < this.clusters.length; i++) {
            const sim = this.cosineSimilarity(pattern.embedding, this.clusters[i].centroid);
            if (sim > bestSim) {
                bestSim = sim;
                bestCluster = i;
            }
        }
        // Create new cluster if not similar enough and under limit
        if (bestSim < 0.7 && this.clusters.length < this.config.numClusters) {
            const newId = this.clusters.length;
            this.clusters.push({
                clusterId: newId,
                centroid: new Float32Array(pattern.embedding),
                patternIds: new Set([pattern.patternId]),
            });
            this.patternToCluster.set(pattern.patternId, newId);
        }
        else {
            // Add to existing cluster and update centroid
            const cluster = this.clusters[bestCluster];
            cluster.patternIds.add(pattern.patternId);
            this.patternToCluster.set(pattern.patternId, bestCluster);
            this.updateClusterCentroid(cluster);
        }
    }
    updateClusterCentroid(cluster) {
        const dim = cluster.centroid.length;
        const newCentroid = new Float32Array(dim);
        let count = 0;
        for (const patternId of cluster.patternIds) {
            const pattern = this.patterns.get(patternId);
            if (pattern) {
                for (let i = 0; i < dim; i++) {
                    newCentroid[i] += pattern.embedding[i];
                }
                count++;
            }
        }
        if (count > 0) {
            for (let i = 0; i < dim; i++) {
                newCentroid[i] /= count;
            }
            cluster.centroid = newCentroid;
        }
    }
    rebuildClusters() {
        if (this.patterns.size === 0) {
            this.clusters = [];
            this.patternToCluster.clear();
            return;
        }
        const patterns = Array.from(this.patterns.values());
        const k = Math.min(this.config.numClusters, Math.ceil(patterns.length / 5));
        const dim = patterns[0].embedding.length;
        // Initialize clusters with random patterns
        this.clusters = [];
        this.patternToCluster.clear();
        const indices = new Set();
        while (indices.size < k && indices.size < patterns.length) {
            indices.add(Math.floor(Math.random() * patterns.length));
        }
        let clusterId = 0;
        for (const idx of indices) {
            this.clusters.push({
                clusterId: clusterId++,
                centroid: new Float32Array(patterns[idx].embedding),
                patternIds: new Set(),
            });
        }
        // K-means iterations
        for (let iter = 0; iter < 10; iter++) {
            // Clear assignments
            for (const cluster of this.clusters) {
                cluster.patternIds.clear();
            }
            // Assign patterns to nearest cluster
            for (const pattern of patterns) {
                let bestCluster = 0;
                let bestSim = -1;
                for (let c = 0; c < this.clusters.length; c++) {
                    const sim = this.cosineSimilarity(pattern.embedding, this.clusters[c].centroid);
                    if (sim > bestSim) {
                        bestSim = sim;
                        bestCluster = c;
                    }
                }
                this.clusters[bestCluster].patternIds.add(pattern.patternId);
                this.patternToCluster.set(pattern.patternId, bestCluster);
            }
            // Update centroids
            for (const cluster of this.clusters) {
                this.updateClusterCentroid(cluster);
            }
        }
        // Remove empty clusters
        this.clusters = this.clusters.filter(c => c.patternIds.size > 0);
    }
    prunePatterns() {
        // Sort by score (quality * log(usage))
        const scored = Array.from(this.patterns.entries())
            .map(([id, pattern]) => ({
            id,
            pattern,
            score: pattern.successRate * Math.log(pattern.usageCount + 1),
        }))
            .sort((a, b) => a.score - b.score);
        // Remove lowest scoring patterns
        const toRemove = scored.length - Math.floor(this.config.maxPatterns * 0.8);
        for (let i = 0; i < toRemove && i < scored.length; i++) {
            this.patterns.delete(scored[i].id);
            this.patternToCluster.delete(scored[i].id);
        }
        // Rebuild clusters
        if (this.config.enableClustering) {
            this.rebuildClusters();
        }
    }
    determineEvolutionType(prev, curr) {
        const delta = curr - prev;
        if (delta > 0.05)
            return 'improvement';
        if (delta < -0.15)
            return 'prune';
        return 'improvement';
    }
}
/**
 * Factory function for creating PatternLearner
 */
export function createPatternLearner(config) {
    return new PatternLearner(config);
}
//# sourceMappingURL=pattern-learner.js.map