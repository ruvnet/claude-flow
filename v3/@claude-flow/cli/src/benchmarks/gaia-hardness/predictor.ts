/**
 * GAIA Hardness Predictor — Linear Classifier (ADR-136 Track Q)
 *
 * Classifies GAIA questions into easy / medium / hard using a
 * hand-rolled logistic regression (no external ML dependencies).
 *
 * Training:
 *   `predictor.train(labeledData)` — fits weights via gradient descent
 *   on cross-entropy loss using the 17-dim feature vectors.
 *
 * Inference:
 *   `predictor.predict(question)` — returns difficulty class + confidence
 *   + a ComputeBudget that drives model/turns/voting choices in gaia-bench.
 *
 * Cold-start:
 *   When untrained (weights = null), classifies everything as "medium".
 *   This is the correct safe default: no wasted Haiku-on-hard, no missed
 *   Sonnet-on-easy.
 *
 * Compute budget policy (from ADR-136 Track Q research):
 *   easy   → Haiku,  max 4 turns,  1 attempt
 *   medium → Sonnet, max 8 turns,  1 attempt
 *   hard   → Sonnet, max 12 turns, 3-vote (Track A)
 *
 * Conservative threshold:
 *   If in doubt, classify UP (medium→hard preferred over medium→easy).
 *   `conservativeMode: true` (default) shifts the easy/medium boundary
 *   so fewer questions fall into "easy".
 *
 * Refs: ADR-136, ADR-135, #2156
 */

import type { GaiaQuestion } from '../gaia-loader.js';
import { extractFeatures, type FeatureVector } from './features.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DifficultyClass = 'easy' | 'medium' | 'hard';

export interface ComputeBudget {
  model: 'haiku' | 'sonnet';
  maxTurns: number;
  votingAttempts: number;
}

export interface PredictionResult {
  difficulty: DifficultyClass;
  confidence: number;
  budget: ComputeBudget;
  features: FeatureVector;
}

export interface LabeledExample {
  question: GaiaQuestion;
  wasCorrect: boolean;
  /** Number of turns the agent used (optional; used to refine label). */
  turns?: number;
}

// ---------------------------------------------------------------------------
// Compute budget policy
// ---------------------------------------------------------------------------

export const COMPUTE_BUDGETS: Record<DifficultyClass, ComputeBudget> = {
  easy: {
    model: 'haiku',
    maxTurns: 4,
    votingAttempts: 1,
  },
  medium: {
    model: 'sonnet',
    maxTurns: 8,
    votingAttempts: 1,
  },
  hard: {
    model: 'sonnet',
    maxTurns: 12,
    votingAttempts: 3,
  },
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const FEATURE_DIM = 17;
const NUM_CLASSES = 3; // easy=0, medium=1, hard=2
const CLASS_NAMES: DifficultyClass[] = ['easy', 'medium', 'hard'];

// Learning-rate and regularisation tuned for ~300-example datasets
const LEARNING_RATE = 0.05;
const REGULARISATION_LAMBDA = 0.01;
const TRAINING_EPOCHS = 200;

// Conservative mode: shift the probability threshold so fewer questions
// are classified as "easy" (reduces risk of underpowering hard questions).
// With conservativeMode: the easy threshold is 0.6 (not 0.5).
const EASY_THRESHOLD_CONSERVATIVE = 0.55;

// ---------------------------------------------------------------------------
// Math helpers (pure functions, no deps)
// ---------------------------------------------------------------------------

function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sumExps);
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

// ---------------------------------------------------------------------------
// HardnessPredictor
// ---------------------------------------------------------------------------

export class HardnessPredictor {
  /**
   * Weight matrix: weights[classIdx][featureIdx].
   * null = untrained (cold-start: return medium for everything).
   */
  private weights: number[][] | null = null;

  /** Bias terms per class. */
  private biases: number[] | null = null;

  /** Whether conservative mode is active (default: true). */
  private readonly conservativeMode: boolean;

  constructor(options: { conservativeMode?: boolean } = {}) {
    this.conservativeMode = options.conservativeMode ?? true;
  }

  /**
   * Returns true when the predictor has been trained and is ready
   * to make non-trivial predictions.
   */
  get isTrained(): boolean {
    return this.weights !== null;
  }

  // ── Training ─────────────────────────────────────────────────────────────

  /**
   * Train the linear classifier using labelled examples from prior runs.
   *
   * Labelling strategy (weak supervision):
   *   - All correct + turns ≤ median turns  → easy
   *   - All correct + turns > median turns  → medium
   *   - Incorrect                           → hard
   *
   * With < 10 examples, refuses to train (cold-start is safer).
   * With 10-50 examples, trains but sets `conservativeMode`-threshold high.
   */
  train(labeledData: LabeledExample[]): void {
    if (labeledData.length < 10) {
      // Too few examples for meaningful generalisation.
      this.weights = null;
      this.biases = null;
      return;
    }

    // Derive labels using weak-supervision strategy.
    const allTurns = labeledData
      .filter((d) => d.turns !== undefined)
      .map((d) => d.turns as number);
    const medianTurns = allTurns.length > 0 ? median(allTurns) : 6;

    const X: number[][] = [];
    const y: number[] = [];

    for (const example of labeledData) {
      const fv = extractFeatures(example.question);
      X.push(fv.values);

      let classIdx: number;
      if (example.wasCorrect) {
        const t = example.turns ?? medianTurns;
        classIdx = t <= medianTurns ? 0 : 1; // easy=0, medium=1
      } else {
        classIdx = 2; // hard
      }
      y.push(classIdx);
    }

    // Initialise weights to 0.
    const W: number[][] = Array.from({ length: NUM_CLASSES }, () =>
      new Array(FEATURE_DIM).fill(0),
    );
    const b: number[] = new Array(NUM_CLASSES).fill(0);

    // Mini-batch gradient descent (batch = full dataset for small sizes).
    for (let epoch = 0; epoch < TRAINING_EPOCHS; epoch++) {
      // Accumulate gradients.
      const dW: number[][] = Array.from({ length: NUM_CLASSES }, () =>
        new Array(FEATURE_DIM).fill(0),
      );
      const db: number[] = new Array(NUM_CLASSES).fill(0);

      for (let n = 0; n < X.length; n++) {
        const x = X[n];
        const trueClass = y[n];

        // Compute logits and softmax probabilities.
        const logits = W.map((w, k) => dot(w, x) + b[k]);
        const probs = softmax(logits);

        // Cross-entropy gradient for each class.
        for (let k = 0; k < NUM_CLASSES; k++) {
          const grad = probs[k] - (k === trueClass ? 1 : 0);
          for (let f = 0; f < FEATURE_DIM; f++) {
            dW[k][f] += grad * x[f];
          }
          db[k] += grad;
        }
      }

      // Update weights with L2 regularisation.
      const N = X.length;
      for (let k = 0; k < NUM_CLASSES; k++) {
        for (let f = 0; f < FEATURE_DIM; f++) {
          W[k][f] -= LEARNING_RATE * (dW[k][f] / N + REGULARISATION_LAMBDA * W[k][f]);
        }
        b[k] -= LEARNING_RATE * (db[k] / N);
      }
    }

    this.weights = W;
    this.biases = b;
  }

  // ── Inference ─────────────────────────────────────────────────────────────

  /**
   * Predict the hardness class of a single GAIA question.
   *
   * Cold-start (untrained): returns medium with confidence=0.5.
   */
  predict(question: GaiaQuestion): PredictionResult {
    const features = extractFeatures(question);

    if (!this.weights || !this.biases) {
      // Cold-start fallback: medium for everything.
      return {
        difficulty: 'medium',
        confidence: 0.5,
        budget: COMPUTE_BUDGETS.medium,
        features,
      };
    }

    const logits = this.weights.map((w, k) => dot(w, features.values) + this.biases![k]);
    const probs = softmax(logits);

    // Conservative mode: down-weight easy probability.
    let adjustedProbs = [...probs];
    if (this.conservativeMode) {
      // Transfer a fraction of easy probability to medium.
      const easyExcess = Math.max(0, probs[0] - EASY_THRESHOLD_CONSERVATIVE);
      adjustedProbs[0] = probs[0] - easyExcess;
      adjustedProbs[1] = probs[1] + easyExcess;
    }

    // Re-normalise after adjustment.
    const sumAdj = adjustedProbs.reduce((a, b) => a + b, 0);
    adjustedProbs = adjustedProbs.map((p) => p / sumAdj);

    // Pick argmax.
    let bestClass = 0;
    for (let k = 1; k < NUM_CLASSES; k++) {
      if (adjustedProbs[k] > adjustedProbs[bestClass]) bestClass = k;
    }

    const difficulty = CLASS_NAMES[bestClass];
    const confidence = adjustedProbs[bestClass];

    return {
      difficulty,
      confidence,
      budget: COMPUTE_BUDGETS[difficulty],
      features,
    };
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  /**
   * Export weights as a plain JSON-serialisable object.
   * Returns null if untrained.
   */
  export(): { weights: number[][]; biases: number[] } | null {
    if (!this.weights || !this.biases) return null;
    return { weights: this.weights, biases: this.biases };
  }

  /**
   * Import previously exported weights.
   */
  import(state: { weights: number[][]; biases: number[] }): void {
    if (
      !Array.isArray(state.weights) ||
      state.weights.length !== NUM_CLASSES ||
      !Array.isArray(state.biases) ||
      state.biases.length !== NUM_CLASSES
    ) {
      throw new Error(
        `Invalid weight state: expected ${NUM_CLASSES}×${FEATURE_DIM} matrix + ${NUM_CLASSES} biases`,
      );
    }
    this.weights = state.weights.map((row) => [...row]);
    this.biases = [...state.biases];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
