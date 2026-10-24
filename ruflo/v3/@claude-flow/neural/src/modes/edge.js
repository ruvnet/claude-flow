/**
 * Edge Mode Implementation
 *
 * Optimized for resource-constrained environments with:
 * - <5MB memory footprint
 * - Minimal latency (<1ms)
 * - Micro-LoRA (rank-1)
 * - Aggressive pruning
 * - Async updates
 */
import { BaseModeImplementation } from './index.js';
/**
 * Edge mode for resource-constrained devices
 */
export class EdgeMode extends BaseModeImplementation {
    mode = 'edge';
    // Minimal pattern storage (compressed)
    compressedPatterns = new Map();
    // Quantized LoRA weights (int8)
    quantizedWeights = new Map();
    quantizationScale = 1.0;
    // Pending async updates
    pendingUpdates = [];
    updateTimer = null;
    // Stats
    totalOps = 0;
    totalTime = 0;
    async initialize() {
        await super.initialize();
        this.compressedPatterns.clear();
        this.quantizedWeights.clear();
        this.pendingUpdates = [];
    }
    async cleanup() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
        }
        this.compressedPatterns.clear();
        this.quantizedWeights.clear();
        this.pendingUpdates = [];
        await super.cleanup();
    }
    /**
     * Find patterns using compressed embeddings
     */
    async findPatterns(embedding, k, patterns) {
        const startTime = performance.now();
        // Compress input embedding for comparison
        const compressedInput = this.compressEmbedding(embedding);
        // Fast similarity on compressed representations
        const matches = [];
        for (const pattern of patterns) {
            let compressed = this.compressedPatterns.get(pattern.patternId);
            if (!compressed) {
                compressed = this.createCompressedPattern(pattern);
                this.compressedPatterns.set(pattern.patternId, compressed);
            }
            // Use compressed similarity (faster but less accurate)
            const score = this.compressedSimilarity(compressedInput, compressed.embedding);
            matches.push({ pattern, score });
        }
        // Quick partial sort
        matches.sort((a, b) => b.score - a.score);
        const topK = matches.slice(0, k);
        this.totalOps++;
        this.totalTime += performance.now() - startTime;
        return topK.map(m => ({
            pattern: m.pattern,
            similarity: m.score,
            confidence: m.score * m.pattern.successRate,
            latencyMs: 0,
        }));
    }
    /**
     * Lightweight learning with async updates
     */
    async learn(trajectories, config, ewcState) {
        const startTime = performance.now();
        if (trajectories.length === 0)
            return 0;
        // Edge mode: only learn from high-quality trajectories
        const threshold = config.qualityThreshold;
        const good = trajectories.filter(t => t.qualityScore >= threshold);
        if (good.length === 0)
            return 0;
        const avgQuality = good.reduce((s, t) => s + t.qualityScore, 0) / good.length;
        // Queue async update for later processing
        this.queueAsyncUpdate(async () => {
            await this.performLightweightUpdate(good, config.learningRate);
        });
        this.totalOps++;
        this.totalTime += performance.now() - startTime;
        return Math.max(0, avgQuality - 0.5);
    }
    /**
     * Apply quantized LoRA
     */
    async applyLoRA(input, weights) {
        if (!weights) {
            return input;
        }
        const output = new Float32Array(input.length);
        output.set(input);
        // Quantize weights if not already done
        for (const module of ['q_proj', 'v_proj']) {
            const A = weights.A.get(module);
            const B = weights.B.get(module);
            if (A && B) {
                const qA = this.getOrQuantize(`A_${module}`, A);
                const qB = this.getOrQuantize(`B_${module}`, B);
                // Apply quantized LoRA
                const adapted = this.applyQuantizedLoRA(input, qA, qB);
                const alpha = 0.05; // Very small blending for edge
                for (let i = 0; i < output.length; i++) {
                    output[i] = output[i] * (1 - alpha) + adapted[i] * alpha;
                }
            }
        }
        return output;
    }
    getStats() {
        return {
            avgLatencyMs: this.totalOps > 0 ? this.totalTime / this.totalOps : 0,
            compressedPatterns: this.compressedPatterns.size,
            quantizedWeights: this.quantizedWeights.size,
            pendingUpdates: this.pendingUpdates.length,
            memoryEstimateMb: this.estimateMemoryUsage(),
        };
    }
    // ========================================================================
    // Compression utilities
    // ========================================================================
    /**
     * Compress embedding to 8-bit representation
     */
    compressEmbedding(embedding) {
        const compressed = new Int8Array(embedding.length);
        const max = Math.max(...embedding.map(Math.abs));
        const scale = max > 0 ? 127 / max : 1;
        for (let i = 0; i < embedding.length; i++) {
            compressed[i] = Math.round(embedding[i] * scale);
        }
        return compressed;
    }
    /**
     * Create compressed pattern representation
     */
    createCompressedPattern(pattern) {
        return {
            id: pattern.patternId,
            embedding: this.compressEmbedding(pattern.embedding),
            successRate: Math.round(pattern.successRate * 255),
            usageCount: Math.min(pattern.usageCount, 255),
        };
    }
    /**
     * Fast similarity on compressed embeddings
     */
    compressedSimilarity(a, b) {
        if (a.length !== b.length)
            return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        // Process in chunks of 8 for better cache utilization
        const len = a.length;
        for (let i = 0; i < len; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA * normB);
        return denom > 0 ? dot / denom : 0;
    }
    /**
     * Get or create quantized weights
     */
    getOrQuantize(key, weights) {
        let quantized = this.quantizedWeights.get(key);
        if (!quantized) {
            quantized = this.quantizeWeights(weights);
            this.quantizedWeights.set(key, quantized);
        }
        return quantized;
    }
    /**
     * Quantize float weights to int8
     */
    quantizeWeights(weights) {
        const max = Math.max(...weights.map(Math.abs));
        this.quantizationScale = max > 0 ? 127 / max : 1;
        const quantized = new Int8Array(weights.length);
        for (let i = 0; i < weights.length; i++) {
            quantized[i] = Math.round(weights[i] * this.quantizationScale);
        }
        return quantized;
    }
    /**
     * Apply LoRA with quantized weights
     */
    applyQuantizedLoRA(input, qA, qB) {
        const dim = input.length;
        const rank = 1; // Edge mode uses rank-1
        const output = new Float32Array(dim);
        const dequantScale = 1 / this.quantizationScale;
        // A * input -> intermediate (scalar for rank-1)
        let intermediate = 0;
        for (let d = 0; d < dim; d++) {
            intermediate += (qA[d] * dequantScale) * input[d];
        }
        // B * intermediate -> output
        for (let d = 0; d < dim; d++) {
            output[d] = (qB[d] * dequantScale) * intermediate;
        }
        return output;
    }
    // ========================================================================
    // Async updates
    // ========================================================================
    /**
     * Queue an async update
     */
    queueAsyncUpdate(update) {
        this.pendingUpdates.push(update);
        // Schedule processing if not already scheduled
        if (!this.updateTimer) {
            this.updateTimer = setTimeout(() => {
                this.processAsyncUpdates();
            }, 100); // Process updates every 100ms
        }
    }
    /**
     * Process pending async updates
     */
    async processAsyncUpdates() {
        this.updateTimer = null;
        const updates = this.pendingUpdates;
        this.pendingUpdates = [];
        // Process up to 5 updates at a time
        for (const update of updates.slice(0, 5)) {
            try {
                await update();
            }
            catch (error) {
                console.error('Edge mode async update failed:', error);
            }
        }
        // Re-queue remaining updates
        if (updates.length > 5) {
            this.pendingUpdates = updates.slice(5);
            this.updateTimer = setTimeout(() => {
                this.processAsyncUpdates();
            }, 100);
        }
    }
    /**
     * Perform lightweight parameter update
     */
    async performLightweightUpdate(trajectories, learningRate) {
        // Simple exponential moving average update
        const alpha = learningRate;
        for (const trajectory of trajectories) {
            if (trajectory.steps.length === 0)
                continue;
            // Update compressed patterns based on trajectory success
            const lastStep = trajectory.steps[trajectory.steps.length - 1];
            const pattern = this.findSimilarCompressedPattern(lastStep.stateAfter);
            if (pattern) {
                // Update success rate with EMA
                const newRate = alpha * trajectory.qualityScore + (1 - alpha) * (pattern.successRate / 255);
                pattern.successRate = Math.round(newRate * 255);
                pattern.usageCount = Math.min(255, pattern.usageCount + 1);
            }
        }
    }
    /**
     * Find most similar compressed pattern
     */
    findSimilarCompressedPattern(embedding) {
        const compressed = this.compressEmbedding(embedding);
        let best = null;
        let bestSim = -1;
        for (const pattern of this.compressedPatterns.values()) {
            const sim = this.compressedSimilarity(compressed, pattern.embedding);
            if (sim > bestSim) {
                bestSim = sim;
                best = pattern;
            }
        }
        return best;
    }
    /**
     * Estimate memory usage in MB
     */
    estimateMemoryUsage() {
        let bytes = 0;
        // Compressed patterns
        for (const pattern of this.compressedPatterns.values()) {
            bytes += pattern.embedding.byteLength + 8; // embedding + overhead
        }
        // Quantized weights
        for (const weights of this.quantizedWeights.values()) {
            bytes += weights.byteLength;
        }
        // Pending updates (minimal)
        bytes += this.pendingUpdates.length * 100;
        return bytes / (1024 * 1024);
    }
}
//# sourceMappingURL=edge.js.map