/**
 * Hyperbolic Embedding Utilities
 *
 * Convert Euclidean embeddings to hyperbolic (Poincaré ball) space
 * for better representation of hierarchical relationships.
 *
 * Features:
 * - Euclidean to Poincaré ball conversion
 * - Hyperbolic distance metrics
 * - Mobius operations (addition, scalar multiplication)
 * - Exponential and logarithmic maps
 *
 * References:
 * - Nickel & Kiela (2017): "Poincaré Embeddings for Learning Hierarchical Representations"
 * - Ganea et al. (2018): "Hyperbolic Neural Networks"
 */

/**
 * Hyperbolic geometry configuration
 */
export interface HyperbolicConfig {
  /** Curvature of hyperbolic space (default: -1) */
  curvature?: number;
  /** Epsilon for numerical stability (default: 1e-15) */
  epsilon?: number;
  /** Maximum norm to prevent numerical issues (default: 1 - 1e-5) */
  maxNorm?: number;
}

const DEFAULT_CONFIG: Required<HyperbolicConfig> = {
  curvature: -1,
  epsilon: 1e-15,
  maxNorm: 1 - 1e-5,
};

/**
 * Compute L2 norm of vector
 */
function l2Norm(v: Float32Array | number[]): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i] * v[i];
  }
  return Math.sqrt(sum);
}

/**
 * Clamp vector norm to stay within Poincaré ball
 */
function clampNorm(
  v: Float32Array,
  maxNorm: number,
  epsilon: number
): Float32Array {
  const norm = l2Norm(v);
  if (norm > maxNorm) {
    const scale = (maxNorm - epsilon) / norm;
    for (let i = 0; i < v.length; i++) {
      v[i] *= scale;
    }
  }
  return v;
}

/**
 * Convert Euclidean embedding to Poincaré ball
 *
 * Uses exponential map at origin to project Euclidean vectors
 * into the Poincaré ball model of hyperbolic space.
 *
 * @param euclidean - Euclidean embedding vector
 * @param config - Hyperbolic geometry configuration
 * @returns Poincaré ball embedding
 */
export function euclideanToPoincare(
  euclidean: Float32Array | number[],
  config: HyperbolicConfig = {}
): Float32Array {
  const { curvature, epsilon, maxNorm } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);
  const sqrtC = Math.sqrt(c);

  const result = new Float32Array(euclidean.length);
  const norm = l2Norm(euclidean);

  if (norm < epsilon) {
    // Near origin, return as-is (origin maps to origin)
    for (let i = 0; i < euclidean.length; i++) {
      result[i] = euclidean[i];
    }
    return result;
  }

  // Exponential map at origin: exp_0(v) = tanh(sqrt(c) * ||v|| / 2) * v / (sqrt(c) * ||v||)
  const factor = Math.tanh(sqrtC * norm / 2) / (sqrtC * norm);

  for (let i = 0; i < euclidean.length; i++) {
    result[i] = euclidean[i] * factor;
  }

  return clampNorm(result, maxNorm, epsilon);
}

/**
 * Convert Poincaré ball embedding back to Euclidean
 *
 * Uses logarithmic map at origin to project back to Euclidean space.
 *
 * @param poincare - Poincaré ball embedding
 * @param config - Hyperbolic geometry configuration
 * @returns Euclidean embedding vector
 */
export function poincareToEuclidean(
  poincare: Float32Array | number[],
  config: HyperbolicConfig = {}
): Float32Array {
  const { curvature, epsilon } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);
  const sqrtC = Math.sqrt(c);

  const result = new Float32Array(poincare.length);
  const norm = l2Norm(poincare);

  if (norm < epsilon) {
    for (let i = 0; i < poincare.length; i++) {
      result[i] = poincare[i];
    }
    return result;
  }

  // Logarithmic map at origin: log_0(y) = 2 * arctanh(sqrt(c) * ||y||) * y / (sqrt(c) * ||y||)
  const factor = 2 * Math.atanh(sqrtC * norm) / (sqrtC * norm);

  for (let i = 0; i < poincare.length; i++) {
    result[i] = poincare[i] * factor;
  }

  return result;
}

/**
 * Compute hyperbolic distance in Poincaré ball
 *
 * The geodesic distance between two points in the Poincaré ball.
 *
 * @param a - First Poincaré embedding
 * @param b - Second Poincaré embedding
 * @param config - Hyperbolic geometry configuration
 * @returns Hyperbolic distance
 */
export function hyperbolicDistance(
  a: Float32Array | number[],
  b: Float32Array | number[],
  config: HyperbolicConfig = {}
): number {
  const { curvature, epsilon } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);
  const sqrtC = Math.sqrt(c);

  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimension');
  }

  // ||a - b||^2
  let diffNormSq = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    diffNormSq += d * d;
  }

  // ||a||^2 and ||b||^2
  let normASq = 0;
  let normBSq = 0;
  for (let i = 0; i < a.length; i++) {
    normASq += a[i] * a[i];
    normBSq += b[i] * b[i];
  }

  // Poincaré distance formula:
  // d(a, b) = (1/sqrt(c)) * arcosh(1 + 2c * ||a-b||^2 / ((1 - c*||a||^2)(1 - c*||b||^2)))
  const numerator = 2 * c * diffNormSq;
  const denominator = (1 - c * normASq) * (1 - c * normBSq);

  // Clamp to prevent numerical issues
  const arg = Math.max(1, 1 + numerator / Math.max(denominator, epsilon));

  return Math.acosh(arg) / sqrtC;
}

/**
 * Möbius addition in Poincaré ball
 *
 * Hyperbolic "addition" operation that respects the ball geometry.
 *
 * @param a - First vector
 * @param b - Second vector
 * @param config - Configuration
 * @returns a ⊕ b in hyperbolic space
 */
export function mobiusAdd(
  a: Float32Array | number[],
  b: Float32Array | number[],
  config: HyperbolicConfig = {}
): Float32Array {
  const { curvature, epsilon, maxNorm } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);

  if (a.length !== b.length) {
    throw new Error('Vectors must have same dimension');
  }

  let normASq = 0;
  let normBSq = 0;
  for (let i = 0; i < a.length; i++) {
    normASq += a[i] * a[i];
    normBSq += b[i] * b[i];
  }

  // <a, b>
  let dotAB = 0;
  for (let i = 0; i < a.length; i++) {
    dotAB += a[i] * b[i];
  }

  // Möbius addition formula
  const numeratorCoeffA = 1 + 2 * c * dotAB + c * normBSq;
  const numeratorCoeffB = 1 - c * normASq;
  const denominator = 1 + 2 * c * dotAB + c * c * normASq * normBSq;

  const result = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = (numeratorCoeffA * a[i] + numeratorCoeffB * b[i]) / Math.max(denominator, epsilon);
  }

  return clampNorm(result, maxNorm, epsilon);
}

/**
 * Möbius scalar multiplication in Poincaré ball
 *
 * @param r - Scalar
 * @param v - Vector in Poincaré ball
 * @param config - Configuration
 * @returns r ⊗ v in hyperbolic space
 */
export function mobiusScalarMul(
  r: number,
  v: Float32Array | number[],
  config: HyperbolicConfig = {}
): Float32Array {
  const { curvature, epsilon, maxNorm } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);
  const sqrtC = Math.sqrt(c);

  const norm = l2Norm(v);

  if (norm < epsilon) {
    return new Float32Array(v.length);
  }

  // r ⊗ v = tanh(r * arctanh(sqrt(c) * ||v||)) * v / (sqrt(c) * ||v||)
  const factor = Math.tanh(r * Math.atanh(sqrtC * norm)) / (sqrtC * norm);

  const result = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] * factor;
  }

  return clampNorm(result, maxNorm, epsilon);
}

/**
 * Compute hyperbolic centroid (Fréchet mean) of multiple points
 *
 * Uses iterative optimization to find the centroid in Poincaré ball.
 *
 * @param points - Array of Poincaré embeddings
 * @param config - Configuration
 * @param maxIter - Maximum iterations (default: 100)
 * @returns Hyperbolic centroid
 */
export function hyperbolicCentroid(
  points: Array<Float32Array | number[]>,
  config: HyperbolicConfig = {},
  maxIter = 100
): Float32Array {
  if (points.length === 0) {
    throw new Error('Need at least one point');
  }
  if (points.length === 1) {
    const arr = new Float32Array(points[0].length);
    for (let i = 0; i < points[0].length; i++) {
      arr[i] = points[0][i];
    }
    return arr;
  }

  const { epsilon } = { ...DEFAULT_CONFIG, ...config };
  const dim = points[0].length;

  // Initialize centroid at Euclidean mean projected to ball
  const centroidInit = new Float32Array(dim);
  for (const p of points) {
    for (let i = 0; i < dim; i++) {
      centroidInit[i] += p[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroidInit[i] /= points.length;
  }

  // Project to Poincaré ball
  const projectedInit = euclideanToPoincare(centroidInit, config);
  let centroid = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    centroid[i] = projectedInit[i];
  }

  // Iterative refinement using Karcher mean algorithm
  for (let iter = 0; iter < maxIter; iter++) {
    const gradient = new Float32Array(dim);

    for (const p of points) {
      // Log map from centroid to point
      const pArr = p instanceof Float32Array ? p : new Float32Array(p);
      const logMap = logMapAt(centroid, pArr, config);
      for (let i = 0; i < dim; i++) {
        gradient[i] += logMap[i];
      }
    }

    // Check convergence
    const gradNorm = l2Norm(gradient);
    if (gradNorm < epsilon) break;

    // Update centroid using exponential map
    for (let i = 0; i < dim; i++) {
      gradient[i] /= points.length;
    }
    const updated = expMapAt(centroid, gradient, config);
    for (let i = 0; i < dim; i++) {
      centroid[i] = updated[i];
    }
  }

  return centroid;
}

/**
 * Exponential map at point p
 */
function expMapAt(
  p: Float32Array,
  v: Float32Array,
  config: HyperbolicConfig = {}
): Float32Array {
  const { curvature, epsilon, maxNorm } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);

  const normP = l2Norm(p);
  const lambdaP = 2 / (1 - c * normP * normP);
  const normV = l2Norm(v);

  if (normV < epsilon) {
    return new Float32Array(p);
  }

  const sqrtC = Math.sqrt(c);
  const tanhArg = sqrtC * lambdaP * normV / 2;
  const coeff = Math.tanh(tanhArg) / (sqrtC * normV);

  const scaledV = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    scaledV[i] = v[i] * coeff;
  }

  return clampNorm(mobiusAdd(p, scaledV, config), maxNorm, epsilon);
}

/**
 * Logarithmic map at point p
 */
function logMapAt(
  p: Float32Array,
  q: Float32Array,
  config: HyperbolicConfig = {}
): Float32Array {
  const { curvature, epsilon } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);
  const sqrtC = Math.sqrt(c);

  // -p ⊕ q
  const negP = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) {
    negP[i] = -p[i];
  }
  const diff = mobiusAdd(negP, q, config);

  const normP = l2Norm(p);
  const normDiff = l2Norm(diff);
  const lambdaP = 2 / (1 - c * normP * normP);

  if (normDiff < epsilon) {
    return new Float32Array(p.length);
  }

  const coeff = (2 / (sqrtC * lambdaP)) * Math.atanh(sqrtC * normDiff) / normDiff;

  const result = new Float32Array(diff.length);
  for (let i = 0; i < diff.length; i++) {
    result[i] = diff[i] * coeff;
  }

  return result;
}

/**
 * Batch convert Euclidean embeddings to Poincaré ball
 */
export function batchEuclideanToPoincare(
  embeddings: Array<Float32Array | number[]>,
  config: HyperbolicConfig = {}
): Float32Array[] {
  return embeddings.map(e => euclideanToPoincare(e, config));
}

/**
 * Compute pairwise hyperbolic distances
 */
export function pairwiseHyperbolicDistances(
  embeddings: Float32Array[],
  config: HyperbolicConfig = {}
): Float32Array {
  const n = embeddings.length;
  const distances = new Float32Array((n * (n - 1)) / 2);

  let idx = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      distances[idx++] = hyperbolicDistance(embeddings[i], embeddings[j], config);
    }
  }

  return distances;
}

/**
 * Check if point is inside Poincaré ball
 */
export function isInPoincareBall(
  v: Float32Array | number[],
  config: HyperbolicConfig = {}
): boolean {
  const { curvature } = { ...DEFAULT_CONFIG, ...config };
  const c = Math.abs(curvature);
  const norm = l2Norm(v);
  return norm < 1 / Math.sqrt(c);
}
