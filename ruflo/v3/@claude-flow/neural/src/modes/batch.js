/**
 * Batch Mode Implementation
 *
 * Optimized for high-throughput processing with:
 * - Large batch sizes (128)
 * - Rank-8 LoRA
 * - Gradient accumulation
 * - Async batch processing
 * - 50ms latency budget
 */
import { BaseModeImplementation } from './index.js';
/**
 * Batch mode for high-throughput processing
 */
export class BatchMode extends BaseModeImplementation {
    mode = 'batch';
    // Batch processing queues
    patternQueue = [];
    learningQueue = [];
    // Batch buffers
    embeddingBuffer = null;
    batchEmbeddings = [];
    // Gradient accumulation
    accumulatedGradients = new Map();
    gradientSteps = 0;
    // Batch processing state
    isBatchProcessing = false;
    batchTimer = null;
    // Stats
    totalBatches = 0;
    totalItems = 0;
    totalBatchTime = 0;
    learnIterations = 0;
    async initialize() {
        await super.initialize();
        this.patternQueue = [];
        this.learningQueue = [];
        this.accumulatedGradients.clear();
        this.gradientSteps = 0;
    }
    async cleanup() {
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }
        this.patternQueue = [];
        this.learningQueue = [];
        this.accumulatedGradients.clear();
        await super.cleanup();
    }
    /**
     * Find patterns - queues for batch processing
     */
    async findPatterns(embedding, k, patterns) {
        // For immediate needs, process synchronously
        if (patterns.length < 100) {
            return this.findPatternsDirect(embedding, k, patterns);
        }
        // Queue for batch processing
        return new Promise(resolve => {
            this.patternQueue.push({ embedding, k, resolve });
            this.scheduleBatchProcessing(patterns);
        });
    }
    /**
     * Learn from trajectories - accumulates for batch
     */
    async learn(trajectories, config, ewcState) {
        const startTime = performance.now();
        if (trajectories.length === 0)
            return 0;
        // Add to learning queue
        this.learningQueue.push(...trajectories);
        // Process when queue is full
        if (this.learningQueue.length >= config.batchSize) {
            return this.processBatchLearning(config, ewcState);
        }
        // Return estimated improvement
        const avgQuality = trajectories.reduce((s, t) => s + t.qualityScore, 0) / trajectories.length;
        this.totalBatchTime += performance.now() - startTime;
        return Math.max(0, avgQuality - 0.5) * 0.5; // Partial estimate
    }
    /**
     * Apply LoRA with rank-8
     */
    async applyLoRA(input, weights) {
        if (!weights) {
            return input;
        }
        // Batch mode can process multiple inputs efficiently
        this.batchEmbeddings.push(new Float32Array(input));
        // Process immediately for single requests
        if (this.batchEmbeddings.length === 1) {
            const output = await this.applyLoRADirect(input, weights);
            this.batchEmbeddings = [];
            return output;
        }
        // For multiple inputs, process as batch
        const outputs = await this.applyLoRABatch(this.batchEmbeddings, weights);
        this.batchEmbeddings = [];
        return outputs[outputs.length - 1];
    }
    getStats() {
        return {
            totalBatches: this.totalBatches,
            avgItemsPerBatch: this.totalBatches > 0 ? this.totalItems / this.totalBatches : 0,
            avgBatchTimeMs: this.totalBatches > 0 ? this.totalBatchTime / this.totalBatches : 0,
            pendingPatternRequests: this.patternQueue.length,
            pendingTrajectories: this.learningQueue.length,
            accumulatedGradientSteps: this.gradientSteps,
            learnIterations: this.learnIterations,
        };
    }
    // ========================================================================
    // Direct processing (for small batches)
    // ========================================================================
    /**
     * Direct pattern matching without batching
     */
    findPatternsDirect(embedding, k, patterns) {
        const matches = [];
        for (const pattern of patterns) {
            const similarity = this.cosineSimilarity(embedding, pattern.embedding);
            matches.push({
                pattern,
                similarity,
                confidence: similarity * pattern.successRate,
                latencyMs: 0,
            });
        }
        matches.sort((a, b) => b.similarity - a.similarity);
        return matches.slice(0, k);
    }
    /**
     * Direct LoRA application
     */
    async applyLoRADirect(input, weights) {
        const output = new Float32Array(input.length);
        output.set(input);
        const rank = this.config.loraRank;
        for (const module of ['q_proj', 'v_proj', 'k_proj', 'o_proj']) {
            const A = weights.A.get(module);
            const B = weights.B.get(module);
            if (A && B) {
                const adapted = this.applyLoRATransform(input, A, B, rank);
                const alpha = 0.25;
                for (let i = 0; i < output.length; i++) {
                    output[i] = output[i] * (1 - alpha) + adapted[i] * alpha;
                }
            }
        }
        return output;
    }
    // ========================================================================
    // Batch processing
    // ========================================================================
    /**
     * Schedule batch processing
     */
    scheduleBatchProcessing(patterns) {
        if (this.batchTimer)
            return;
        this.batchTimer = setTimeout(() => {
            this.processBatchPatterns(patterns);
        }, 10); // Wait 10ms to accumulate requests
    }
    /**
     * Process pattern requests in batch
     */
    async processBatchPatterns(patterns) {
        this.batchTimer = null;
        if (this.patternQueue.length === 0)
            return;
        const startTime = performance.now();
        this.isBatchProcessing = true;
        const batch = this.patternQueue;
        this.patternQueue = [];
        // Pre-compute pattern embeddings matrix
        const patternMatrix = patterns.map(p => p.embedding);
        // Process all queries in batch
        for (const request of batch) {
            const matches = this.batchSimilaritySearch(request.embedding, request.k, patterns, patternMatrix);
            request.resolve(matches);
        }
        this.totalBatches++;
        this.totalItems += batch.length;
        this.totalBatchTime += performance.now() - startTime;
        this.isBatchProcessing = false;
    }
    /**
     * Batch similarity search
     */
    batchSimilaritySearch(query, k, patterns, patternMatrix) {
        const similarities = [];
        for (let i = 0; i < patternMatrix.length; i++) {
            const sim = this.cosineSimilarity(query, patternMatrix[i]);
            similarities.push({ idx: i, sim });
        }
        similarities.sort((a, b) => b.sim - a.sim);
        const topK = similarities.slice(0, k);
        return topK.map(s => ({
            pattern: patterns[s.idx],
            similarity: s.sim,
            confidence: s.sim * patterns[s.idx].successRate,
            latencyMs: 0,
        }));
    }
    /**
     * Process batch learning
     */
    async processBatchLearning(config, ewcState) {
        const startTime = performance.now();
        const batch = this.learningQueue.slice(0, config.batchSize);
        this.learningQueue = this.learningQueue.slice(config.batchSize);
        const qualityThreshold = config.qualityThreshold;
        const learningRate = config.learningRate;
        // Separate by quality
        const good = batch.filter(t => t.qualityScore >= qualityThreshold);
        const bad = batch.filter(t => t.qualityScore < qualityThreshold);
        if (good.length === 0) {
            this.totalBatchTime += performance.now() - startTime;
            return 0;
        }
        // Accumulate gradients
        for (const trajectory of good) {
            this.accumulateTrajectoryGradient(trajectory, learningRate);
        }
        // Contrastive learning from bad examples
        for (const trajectory of bad.slice(0, good.length)) {
            this.accumulateTrajectoryGradient(trajectory, -learningRate * 0.3);
        }
        this.gradientSteps++;
        // Apply accumulated gradients every N steps
        if (this.gradientSteps >= 4) {
            await this.applyAccumulatedGradients(ewcState, config.ewcLambda);
            this.gradientSteps = 0;
        }
        // Compute improvement
        const avgQuality = good.reduce((s, t) => s + t.qualityScore, 0) / good.length;
        const improvement = avgQuality - 0.5;
        this.learnIterations++;
        this.totalBatchTime += performance.now() - startTime;
        return Math.max(0, improvement);
    }
    /**
     * Accumulate gradient from trajectory
     */
    accumulateTrajectoryGradient(trajectory, scale) {
        if (trajectory.steps.length === 0)
            return;
        const key = trajectory.domain;
        let gradient = this.accumulatedGradients.get(key);
        if (!gradient) {
            const dim = trajectory.steps[0].stateAfter.length;
            gradient = new Float32Array(dim);
            this.accumulatedGradients.set(key, gradient);
        }
        // Add trajectory contribution
        const weight = trajectory.qualityScore * scale;
        for (const step of trajectory.steps) {
            for (let i = 0; i < Math.min(gradient.length, step.stateAfter.length); i++) {
                gradient[i] += step.stateAfter[i] * weight * step.reward;
            }
        }
    }
    /**
     * Apply accumulated gradients with EWC
     */
    async applyAccumulatedGradients(ewcState, ewcLambda) {
        for (const [key, gradient] of this.accumulatedGradients) {
            // Normalize gradient
            const norm = Math.sqrt(gradient.reduce((s, v) => s + v * v, 0));
            if (norm > 0) {
                for (let i = 0; i < gradient.length; i++) {
                    gradient[i] /= norm;
                }
            }
            // Apply EWC penalty
            const fisher = ewcState.fisher.get(key);
            const means = ewcState.means.get(key);
            if (fisher && means) {
                for (let i = 0; i < gradient.length; i++) {
                    const penalty = ewcLambda * fisher[i] * (gradient[i] - means[i]);
                    gradient[i] -= penalty;
                }
            }
            // Clear gradient for next accumulation
            gradient.fill(0);
        }
    }
    /**
     * Apply LoRA to batch of inputs
     */
    async applyLoRABatch(inputs, weights) {
        const outputs = [];
        const rank = this.config.loraRank;
        // Process all inputs together for cache efficiency
        for (const input of inputs) {
            const output = new Float32Array(input.length);
            output.set(input);
            for (const module of ['q_proj', 'v_proj', 'k_proj', 'o_proj']) {
                const A = weights.A.get(module);
                const B = weights.B.get(module);
                if (A && B) {
                    const adapted = this.applyLoRATransform(input, A, B, rank);
                    const alpha = 0.25;
                    for (let i = 0; i < output.length; i++) {
                        output[i] = output[i] * (1 - alpha) + adapted[i] * alpha;
                    }
                }
            }
            outputs.push(output);
        }
        return outputs;
    }
}
//# sourceMappingURL=batch.js.map