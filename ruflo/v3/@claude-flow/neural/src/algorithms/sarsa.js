/**
 * SARSA (State-Action-Reward-State-Action)
 *
 * On-policy TD learning algorithm with:
 * - Epsilon-greedy exploration
 * - State hashing for continuous states
 * - Expected SARSA variant (optional)
 * - Eligibility traces (SARSA-lambda)
 *
 * Performance Target: <1ms per update
 */
/**
 * Default SARSA configuration
 */
export const DEFAULT_SARSA_CONFIG = {
    algorithm: 'sarsa',
    learningRate: 0.1,
    gamma: 0.99,
    entropyCoef: 0,
    valueLossCoef: 1,
    maxGradNorm: 1,
    epochs: 1,
    miniBatchSize: 1,
    explorationInitial: 1.0,
    explorationFinal: 0.01,
    explorationDecay: 10000,
    maxStates: 10000,
    useExpectedSARSA: false,
    useEligibilityTraces: false,
    traceDecay: 0.9,
};
/**
 * SARSA Algorithm Implementation
 */
export class SARSAAlgorithm {
    config;
    // Q-table
    qTable = new Map();
    // Exploration
    epsilon;
    stepCount = 0;
    // Number of actions
    numActions = 4;
    // Eligibility traces
    traces = new Map();
    // Statistics
    updateCount = 0;
    avgTDError = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_SARSA_CONFIG, ...config };
        this.epsilon = this.config.explorationInitial;
    }
    /**
     * Update Q-values from trajectory using SARSA
     */
    update(trajectory) {
        const startTime = performance.now();
        if (trajectory.steps.length < 2) {
            return { tdError: 0 };
        }
        let totalTDError = 0;
        // Reset eligibility traces
        if (this.config.useEligibilityTraces) {
            this.traces.clear();
        }
        for (let i = 0; i < trajectory.steps.length - 1; i++) {
            const step = trajectory.steps[i];
            const nextStep = trajectory.steps[i + 1];
            const stateKey = this.hashState(step.stateBefore);
            const action = this.hashAction(step.action);
            const nextStateKey = this.hashState(step.stateAfter);
            const nextAction = this.hashAction(nextStep.action);
            // Get or create entries
            const qEntry = this.getOrCreateEntry(stateKey);
            const nextEntry = this.getOrCreateEntry(nextStateKey);
            // Current Q-value
            const currentQ = qEntry.qValues[action];
            // Compute target Q-value using SARSA update rule
            let targetQ;
            if (this.config.useExpectedSARSA) {
                // Expected SARSA: use expected value under current policy
                targetQ = step.reward + this.config.gamma * this.expectedValue(nextEntry.qValues);
            }
            else {
                // Standard SARSA: use actual next action
                targetQ = step.reward + this.config.gamma * nextEntry.qValues[nextAction];
            }
            // TD error
            const tdError = targetQ - currentQ;
            totalTDError += Math.abs(tdError);
            if (this.config.useEligibilityTraces) {
                this.updateTrace(stateKey, action);
                this.updateWithTraces(tdError);
            }
            else {
                qEntry.qValues[action] += this.config.learningRate * tdError;
                qEntry.visits++;
                qEntry.lastUpdate = Date.now();
            }
        }
        // Handle terminal state
        const lastStep = trajectory.steps[trajectory.steps.length - 1];
        const lastStateKey = this.hashState(lastStep.stateBefore);
        const lastAction = this.hashAction(lastStep.action);
        const lastEntry = this.getOrCreateEntry(lastStateKey);
        const terminalTDError = lastStep.reward - lastEntry.qValues[lastAction];
        lastEntry.qValues[lastAction] += this.config.learningRate * terminalTDError;
        totalTDError += Math.abs(terminalTDError);
        // Decay exploration
        this.stepCount += trajectory.steps.length;
        this.epsilon = Math.max(this.config.explorationFinal, this.config.explorationInitial - this.stepCount / this.config.explorationDecay);
        // Prune if needed
        if (this.qTable.size > this.config.maxStates) {
            this.pruneQTable();
        }
        this.updateCount++;
        this.avgTDError = totalTDError / trajectory.steps.length;
        const elapsed = performance.now() - startTime;
        if (elapsed > 1) {
            console.warn(`SARSA update exceeded target: ${elapsed.toFixed(2)}ms > 1ms`);
        }
        return { tdError: this.avgTDError };
    }
    /**
     * Get action using epsilon-greedy policy
     */
    getAction(state, explore = true) {
        if (explore && Math.random() < this.epsilon) {
            return Math.floor(Math.random() * this.numActions);
        }
        const stateKey = this.hashState(state);
        const entry = this.qTable.get(stateKey);
        if (!entry) {
            return Math.floor(Math.random() * this.numActions);
        }
        return this.argmax(entry.qValues);
    }
    /**
     * Get action probabilities for a state
     */
    getActionProbabilities(state) {
        const probs = new Float32Array(this.numActions);
        const stateKey = this.hashState(state);
        const entry = this.qTable.get(stateKey);
        if (!entry) {
            // Uniform distribution
            const uniform = 1 / this.numActions;
            for (let a = 0; a < this.numActions; a++) {
                probs[a] = uniform;
            }
            return probs;
        }
        // Epsilon-greedy probabilities
        const greedyAction = this.argmax(entry.qValues);
        const exploreProb = this.epsilon / this.numActions;
        for (let a = 0; a < this.numActions; a++) {
            probs[a] = exploreProb;
        }
        probs[greedyAction] += 1 - this.epsilon;
        return probs;
    }
    /**
     * Get Q-values for a state
     */
    getQValues(state) {
        const stateKey = this.hashState(state);
        const entry = this.qTable.get(stateKey);
        if (!entry) {
            return new Float32Array(this.numActions);
        }
        return new Float32Array(entry.qValues);
    }
    /**
     * Get statistics
     */
    getStats() {
        return {
            updateCount: this.updateCount,
            qTableSize: this.qTable.size,
            epsilon: this.epsilon,
            avgTDError: this.avgTDError,
            stepCount: this.stepCount,
        };
    }
    /**
     * Reset algorithm state
     */
    reset() {
        this.qTable.clear();
        this.traces.clear();
        this.epsilon = this.config.explorationInitial;
        this.stepCount = 0;
        this.updateCount = 0;
        this.avgTDError = 0;
    }
    // ==========================================================================
    // Private Methods
    // ==========================================================================
    hashState(state) {
        const bins = 10;
        const parts = [];
        for (let i = 0; i < Math.min(8, state.length); i++) {
            const normalized = (state[i] + 1) / 2;
            const bin = Math.floor(Math.max(0, Math.min(bins - 1, normalized * bins)));
            parts.push(bin);
        }
        return parts.join(',');
    }
    hashAction(action) {
        let hash = 0;
        for (let i = 0; i < action.length; i++) {
            hash = (hash * 31 + action.charCodeAt(i)) % this.numActions;
        }
        return hash;
    }
    getOrCreateEntry(stateKey) {
        let entry = this.qTable.get(stateKey);
        if (!entry) {
            entry = {
                qValues: new Float32Array(this.numActions),
                visits: 0,
                lastUpdate: Date.now(),
            };
            this.qTable.set(stateKey, entry);
        }
        return entry;
    }
    expectedValue(qValues) {
        // Expected value under epsilon-greedy policy
        const greedyAction = this.argmax(qValues);
        const exploreProb = this.epsilon / this.numActions;
        let expected = 0;
        for (let a = 0; a < this.numActions; a++) {
            const prob = exploreProb + (a === greedyAction ? 1 - this.epsilon : 0);
            expected += prob * qValues[a];
        }
        return expected;
    }
    updateTrace(stateKey, action) {
        // Decay all traces
        for (const [key, trace] of this.traces) {
            for (let a = 0; a < this.numActions; a++) {
                trace[a] *= this.config.gamma * this.config.traceDecay;
            }
            const maxTrace = Math.max(...trace);
            if (maxTrace < 0.001) {
                this.traces.delete(key);
            }
        }
        // Set current trace (replacing traces for same state-action)
        let trace = this.traces.get(stateKey);
        if (!trace) {
            trace = new Float32Array(this.numActions);
            this.traces.set(stateKey, trace);
        }
        trace[action] = 1.0;
    }
    updateWithTraces(tdError) {
        const lr = this.config.learningRate;
        for (const [stateKey, trace] of this.traces) {
            const entry = this.qTable.get(stateKey);
            if (entry) {
                for (let a = 0; a < this.numActions; a++) {
                    entry.qValues[a] += lr * tdError * trace[a];
                }
                entry.visits++;
                entry.lastUpdate = Date.now();
            }
        }
    }
    pruneQTable() {
        const entries = Array.from(this.qTable.entries())
            .sort((a, b) => a[1].lastUpdate - b[1].lastUpdate);
        const toRemove = entries.length - Math.floor(this.config.maxStates * 0.8);
        for (let i = 0; i < toRemove; i++) {
            this.qTable.delete(entries[i][0]);
        }
    }
    argmax(values) {
        let maxIdx = 0;
        let maxVal = values[0];
        for (let i = 1; i < values.length; i++) {
            if (values[i] > maxVal) {
                maxVal = values[i];
                maxIdx = i;
            }
        }
        return maxIdx;
    }
}
/**
 * Factory function
 */
export function createSARSA(config) {
    return new SARSAAlgorithm(config);
}
//# sourceMappingURL=sarsa.js.map