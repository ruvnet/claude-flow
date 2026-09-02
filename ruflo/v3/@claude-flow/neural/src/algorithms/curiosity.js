/**
 * Curiosity-Driven Exploration
 *
 * Implements intrinsic motivation for exploration:
 * - Intrinsic Curiosity Module (ICM)
 * - Random Network Distillation (RND)
 * - Forward and inverse dynamics models
 * - Exploration bonus generation
 *
 * Performance Target: <5ms per forward pass
 */
/**
 * Default Curiosity configuration
 */
export const DEFAULT_CURIOSITY_CONFIG = {
    algorithm: 'curiosity',
    learningRate: 0.0001,
    gamma: 0.99,
    entropyCoef: 0.01,
    valueLossCoef: 0.5,
    maxGradNorm: 0.5,
    epochs: 1,
    miniBatchSize: 32,
    intrinsicCoef: 0.1,
    forwardLR: 0.001,
    inverseLR: 0.001,
    featureDim: 64,
    useRND: false,
};
/**
 * Curiosity-Driven Exploration Module
 */
export class CuriosityModule {
    config;
    // Feature encoder
    featureEncoder;
    // Forward dynamics model: predicts next feature from current feature + action
    forwardModel;
    // Inverse dynamics model: predicts action from current and next features
    inverseModel;
    // RND target and predictor networks
    rndTarget;
    rndPredictor;
    // Optimizer state
    forwardMomentum;
    inverseMomentum;
    rndMomentum;
    // Dimensions
    stateDim = 768;
    numActions = 4;
    // Running statistics for normalization
    intrinsicMean = 0;
    intrinsicVar = 1;
    updateCount = 0;
    // Statistics
    avgForwardLoss = 0;
    avgInverseLoss = 0;
    avgIntrinsicReward = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CURIOSITY_CONFIG, ...config };
        const featureDim = this.config.featureDim;
        // Initialize feature encoder: state_dim -> feature_dim
        this.featureEncoder = this.initWeight(this.stateDim, featureDim);
        // Forward model: (feature_dim + num_actions) -> feature_dim
        this.forwardModel = this.initWeight(featureDim + this.numActions, featureDim);
        // Inverse model: (2 * feature_dim) -> num_actions
        this.inverseModel = this.initWeight(2 * featureDim, this.numActions);
        // RND networks
        this.rndTarget = this.initWeight(this.stateDim, featureDim);
        this.rndPredictor = this.initWeight(this.stateDim, featureDim);
        // Momentum buffers
        this.forwardMomentum = new Float32Array(this.forwardModel.length);
        this.inverseMomentum = new Float32Array(this.inverseModel.length);
        this.rndMomentum = new Float32Array(this.rndPredictor.length);
    }
    /**
     * Compute intrinsic reward for a transition
     */
    computeIntrinsicReward(state, action, nextState) {
        if (this.config.useRND) {
            return this.computeRNDReward(nextState);
        }
        else {
            return this.computeICMReward(state, action, nextState);
        }
    }
    /**
     * Compute ICM-based intrinsic reward (prediction error)
     */
    computeICMReward(state, action, nextState) {
        const startTime = performance.now();
        // Encode states to features
        const stateFeature = this.encodeState(state);
        const nextStateFeature = this.encodeState(nextState);
        // Predict next state feature
        const actionIdx = this.hashAction(action);
        const predictedFeature = this.forwardPredict(stateFeature, actionIdx);
        // Compute prediction error as intrinsic reward
        let error = 0;
        for (let i = 0; i < this.config.featureDim; i++) {
            error += (predictedFeature[i] - nextStateFeature[i]) ** 2;
        }
        // Normalize intrinsic reward
        const intrinsic = this.normalizeIntrinsic(error);
        const elapsed = performance.now() - startTime;
        if (elapsed > 5) {
            console.warn(`ICM reward exceeded target: ${elapsed.toFixed(2)}ms > 5ms`);
        }
        return intrinsic * this.config.intrinsicCoef;
    }
    /**
     * Compute RND-based intrinsic reward
     */
    computeRNDReward(state) {
        const startTime = performance.now();
        // Target network output (fixed random features)
        const targetOutput = this.rndForward(state, this.rndTarget);
        // Predictor network output (trained to match target)
        const predictorOutput = this.rndForward(state, this.rndPredictor);
        // Compute prediction error
        let error = 0;
        for (let i = 0; i < this.config.featureDim; i++) {
            error += (predictorOutput[i] - targetOutput[i]) ** 2;
        }
        // Normalize
        const intrinsic = this.normalizeIntrinsic(error);
        const elapsed = performance.now() - startTime;
        if (elapsed > 5) {
            console.warn(`RND reward exceeded target: ${elapsed.toFixed(2)}ms > 5ms`);
        }
        return intrinsic * this.config.intrinsicCoef;
    }
    /**
     * Update curiosity models from trajectory
     */
    update(trajectory) {
        const startTime = performance.now();
        if (trajectory.steps.length < 2) {
            return { forwardLoss: 0, inverseLoss: 0 };
        }
        let totalForwardLoss = 0;
        let totalInverseLoss = 0;
        let count = 0;
        for (let i = 0; i < trajectory.steps.length - 1; i++) {
            const step = trajectory.steps[i];
            const nextStep = trajectory.steps[i + 1];
            const stateFeature = this.encodeState(step.stateAfter);
            const nextStateFeature = this.encodeState(nextStep.stateAfter);
            const actionIdx = this.hashAction(step.action);
            // Update forward model
            const forwardLoss = this.updateForwardModel(stateFeature, actionIdx, nextStateFeature);
            totalForwardLoss += forwardLoss;
            // Update inverse model
            const inverseLoss = this.updateInverseModel(stateFeature, nextStateFeature, actionIdx);
            totalInverseLoss += inverseLoss;
            // Update RND predictor if using RND
            if (this.config.useRND) {
                this.updateRNDPredictor(nextStep.stateAfter);
            }
            count++;
        }
        this.updateCount++;
        this.avgForwardLoss = count > 0 ? totalForwardLoss / count : 0;
        this.avgInverseLoss = count > 0 ? totalInverseLoss / count : 0;
        const elapsed = performance.now() - startTime;
        if (elapsed > 10) {
            console.warn(`Curiosity update exceeded target: ${elapsed.toFixed(2)}ms > 10ms`);
        }
        return {
            forwardLoss: this.avgForwardLoss,
            inverseLoss: this.avgInverseLoss,
        };
    }
    /**
     * Add intrinsic rewards to trajectory
     */
    augmentTrajectory(trajectory) {
        const augmented = { ...trajectory, steps: [...trajectory.steps] };
        for (let i = 0; i < augmented.steps.length - 1; i++) {
            const step = augmented.steps[i];
            const nextStep = augmented.steps[i + 1];
            const intrinsic = this.computeIntrinsicReward(step.stateAfter, step.action, nextStep.stateAfter);
            // Augment reward
            augmented.steps[i] = {
                ...step,
                reward: step.reward + intrinsic,
            };
        }
        return augmented;
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            updateCount: this.updateCount,
            avgForwardLoss: this.avgForwardLoss,
            avgInverseLoss: this.avgInverseLoss,
            avgIntrinsicReward: this.avgIntrinsicReward,
            intrinsicMean: this.intrinsicMean,
            intrinsicStd: Math.sqrt(this.intrinsicVar),
        };
    }
    // ==========================================================================
    // Private Methods
    // ==========================================================================
    initWeight(inputDim, outputDim) {
        const weight = new Float32Array(inputDim * outputDim);
        const scale = Math.sqrt(2 / inputDim);
        for (let i = 0; i < weight.length; i++) {
            weight[i] = (Math.random() - 0.5) * scale;
        }
        return weight;
    }
    encodeState(state) {
        const featureDim = this.config.featureDim;
        const feature = new Float32Array(featureDim);
        for (let f = 0; f < featureDim; f++) {
            let sum = 0;
            for (let s = 0; s < Math.min(state.length, this.stateDim); s++) {
                sum += state[s] * this.featureEncoder[s * featureDim + f];
            }
            feature[f] = Math.max(0, sum); // ReLU
        }
        return feature;
    }
    forwardPredict(stateFeature, action) {
        const featureDim = this.config.featureDim;
        const inputDim = featureDim + this.numActions;
        const predicted = new Float32Array(featureDim);
        // Concatenate feature and one-hot action
        const input = new Float32Array(inputDim);
        input.set(stateFeature);
        input[featureDim + action] = 1;
        // Forward pass
        for (let f = 0; f < featureDim; f++) {
            let sum = 0;
            for (let i = 0; i < inputDim; i++) {
                sum += input[i] * this.forwardModel[i * featureDim + f];
            }
            predicted[f] = sum;
        }
        return predicted;
    }
    inversePredict(stateFeature, nextStateFeature) {
        const featureDim = this.config.featureDim;
        const logits = new Float32Array(this.numActions);
        // Concatenate features
        const input = new Float32Array(2 * featureDim);
        input.set(stateFeature);
        input.set(nextStateFeature, featureDim);
        // Forward pass
        for (let a = 0; a < this.numActions; a++) {
            let sum = 0;
            for (let i = 0; i < 2 * featureDim; i++) {
                sum += input[i] * this.inverseModel[i * this.numActions + a];
            }
            logits[a] = sum;
        }
        return this.softmax(logits);
    }
    rndForward(state, weights) {
        const featureDim = this.config.featureDim;
        const output = new Float32Array(featureDim);
        for (let f = 0; f < featureDim; f++) {
            let sum = 0;
            for (let s = 0; s < Math.min(state.length, this.stateDim); s++) {
                sum += state[s] * weights[s * featureDim + f];
            }
            output[f] = Math.max(0, sum); // ReLU
        }
        return output;
    }
    updateForwardModel(stateFeature, action, targetFeature) {
        const featureDim = this.config.featureDim;
        const inputDim = featureDim + this.numActions;
        const lr = this.config.forwardLR;
        const beta = 0.9;
        // Forward pass
        const predicted = this.forwardPredict(stateFeature, action);
        // Compute loss and gradient
        let loss = 0;
        const grad = new Float32Array(predicted.length);
        for (let f = 0; f < featureDim; f++) {
            const diff = predicted[f] - targetFeature[f];
            loss += diff * diff;
            grad[f] = 2 * diff;
        }
        // Backprop to weights
        const input = new Float32Array(inputDim);
        input.set(stateFeature);
        input[featureDim + action] = 1;
        for (let i = 0; i < inputDim; i++) {
            for (let f = 0; f < featureDim; f++) {
                const weightGrad = input[i] * grad[f];
                const idx = i * featureDim + f;
                this.forwardMomentum[idx] = beta * this.forwardMomentum[idx] + (1 - beta) * weightGrad;
                this.forwardModel[idx] -= lr * this.forwardMomentum[idx];
            }
        }
        return loss;
    }
    updateInverseModel(stateFeature, nextStateFeature, targetAction) {
        const featureDim = this.config.featureDim;
        const lr = this.config.inverseLR;
        const beta = 0.9;
        // Forward pass
        const probs = this.inversePredict(stateFeature, nextStateFeature);
        // Cross-entropy loss
        const loss = -Math.log(probs[targetAction] + 1e-8);
        // Gradient
        const grad = new Float32Array(this.numActions);
        for (let a = 0; a < this.numActions; a++) {
            grad[a] = probs[a] - (a === targetAction ? 1 : 0);
        }
        // Backprop to weights
        const input = new Float32Array(2 * featureDim);
        input.set(stateFeature);
        input.set(nextStateFeature, featureDim);
        for (let i = 0; i < 2 * featureDim; i++) {
            for (let a = 0; a < this.numActions; a++) {
                const weightGrad = input[i] * grad[a];
                const idx = i * this.numActions + a;
                this.inverseMomentum[idx] = beta * this.inverseMomentum[idx] + (1 - beta) * weightGrad;
                this.inverseModel[idx] -= lr * this.inverseMomentum[idx];
            }
        }
        return loss;
    }
    updateRNDPredictor(state) {
        const featureDim = this.config.featureDim;
        const lr = this.config.learningRate;
        const beta = 0.9;
        // Target output (fixed)
        const targetOutput = this.rndForward(state, this.rndTarget);
        // Predictor output
        const predictorOutput = this.rndForward(state, this.rndPredictor);
        // Gradient
        const grad = new Float32Array(featureDim);
        for (let f = 0; f < featureDim; f++) {
            grad[f] = 2 * (predictorOutput[f] - targetOutput[f]);
        }
        // Update predictor weights
        for (let s = 0; s < Math.min(state.length, this.stateDim); s++) {
            for (let f = 0; f < featureDim; f++) {
                if (predictorOutput[f] > 0) { // ReLU gradient
                    const weightGrad = state[s] * grad[f];
                    const idx = s * featureDim + f;
                    this.rndMomentum[idx] = beta * this.rndMomentum[idx] + (1 - beta) * weightGrad;
                    this.rndPredictor[idx] -= lr * this.rndMomentum[idx];
                }
            }
        }
    }
    normalizeIntrinsic(raw) {
        // Update running statistics
        const alpha = 0.01;
        this.intrinsicMean = (1 - alpha) * this.intrinsicMean + alpha * raw;
        this.intrinsicVar = (1 - alpha) * this.intrinsicVar + alpha * (raw - this.intrinsicMean) ** 2;
        // Normalize
        const normalized = (raw - this.intrinsicMean) / (Math.sqrt(this.intrinsicVar) + 1e-8);
        // Clip to reasonable range
        return Math.max(-5, Math.min(5, normalized));
    }
    softmax(logits) {
        const max = Math.max(...logits);
        const exps = new Float32Array(logits.length);
        let sum = 0;
        for (let i = 0; i < logits.length; i++) {
            exps[i] = Math.exp(logits[i] - max);
            sum += exps[i];
        }
        for (let i = 0; i < exps.length; i++) {
            exps[i] /= sum;
        }
        return exps;
    }
    hashAction(action) {
        let hash = 0;
        for (let i = 0; i < action.length; i++) {
            hash = (hash * 31 + action.charCodeAt(i)) % this.numActions;
        }
        return hash;
    }
}
/**
 * Factory function
 */
export function createCuriosity(config) {
    return new CuriosityModule(config);
}
//# sourceMappingURL=curiosity.js.map