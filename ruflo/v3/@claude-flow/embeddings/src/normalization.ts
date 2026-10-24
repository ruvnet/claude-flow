/**
 * Embedding Normalization Utilities
 *
 * Features:
 * - L2 (Euclidean) normalization
 * - L1 (Manhattan) normalization
 * - Min-max normalization
 * - Z-score standardization
 * - Batch normalization
 */

/**
 * Normalization type
 */
export type NormalizationType = 'l2' | 'l1' | 'minmax' | 'zscore' | 'none';

/**
 * Normalization options
 */
export interface NormalizationOptions {
  /** Normalization type (default: 'l2') */
  type?: NormalizationType;
  /** Epsilon for numerical stability (default: 1e-12) */
  epsilon?: number;
  /** In-place modification (default: false) */
  inPlace?: boolean;
}

/**
 * L2 (Euclidean) normalize embedding to unit length
 * Most common for cosine similarity
 *
 * @param embedding - Input embedding vector
 * @param epsilon - Small value to prevent division by zero
 * @returns Normalized embedding with ||v|| = 1
 */
export function l2Normalize(
  embedding: Float32Array | number[],
  epsilon = 1e-12
): Float32Array {
  const result = embedding instanceof Float32Array
    ? new Float32Array(embedding.length)
    : new Float32Array(embedding.length);

  // Calculate L2 norm (Euclidean length)
  let sumSquares = 0;
  for (let i = 0; i < embedding.length; i++) {
    sumSquares += embedding[i] * embedding[i];
  }

  const norm = Math.sqrt(sumSquares);
  const scale = norm > epsilon ? 1 / norm : 0;

  // Normalize
  for (let i = 0; i < embedding.length; i++) {
    result[i] = embedding[i] * scale;
  }

  return result;
}

/**
 * L2 normalize embedding in-place (modifies original array)
 */
export function l2NormalizeInPlace(
  embedding: Float32Array,
  epsilon = 1e-12
): Float32Array {
  let sumSquares = 0;
  for (let i = 0; i < embedding.length; i++) {
    sumSquares += embedding[i] * embedding[i];
  }

  const norm = Math.sqrt(sumSquares);
  const scale = norm > epsilon ? 1 / norm : 0;

  for (let i = 0; i < embedding.length; i++) {
    embedding[i] *= scale;
  }

  return embedding;
}

/**
 * L1 (Manhattan) normalize embedding
 * Sum of absolute values = 1
 */
export function l1Normalize(
  embedding: Float32Array | number[],
  epsilon = 1e-12
): Float32Array {
  const result = new Float32Array(embedding.length);

  // Calculate L1 norm (sum of absolute values)
  let sumAbs = 0;
  for (let i = 0; i < embedding.length; i++) {
    sumAbs += Math.abs(embedding[i]);
  }

  const scale = sumAbs > epsilon ? 1 / sumAbs : 0;

  for (let i = 0; i < embedding.length; i++) {
    result[i] = embedding[i] * scale;
  }

  return result;
}

/**
 * Min-max normalize embedding to [0, 1] range
 */
export function minMaxNormalize(
  embedding: Float32Array | number[],
  epsilon = 1e-12
): Float32Array {
  const result = new Float32Array(embedding.length);

  // Find min and max
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < embedding.length; i++) {
    if (embedding[i] < min) min = embedding[i];
    if (embedding[i] > max) max = embedding[i];
  }

  const range = max - min;
  const scale = range > epsilon ? 1 / range : 0;

  for (let i = 0; i < embedding.length; i++) {
    result[i] = (embedding[i] - min) * scale;
  }

  return result;
}

/**
 * Z-score standardize embedding (mean=0, std=1)
 */
export function zScoreNormalize(
  embedding: Float32Array | number[],
  epsilon = 1e-12
): Float32Array {
  const result = new Float32Array(embedding.length);
  const n = embedding.length;

  // Calculate mean
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += embedding[i];
  }
  const mean = sum / n;

  // Calculate standard deviation
  let sumSquaredDiff = 0;
  for (let i = 0; i < n; i++) {
    const diff = embedding[i] - mean;
    sumSquaredDiff += diff * diff;
  }
  const std = Math.sqrt(sumSquaredDiff / n);
  const scale = std > epsilon ? 1 / std : 0;

  // Standardize
  for (let i = 0; i < n; i++) {
    result[i] = (embedding[i] - mean) * scale;
  }

  return result;
}

/**
 * Normalize embedding using specified method
 */
export function normalize(
  embedding: Float32Array | number[],
  options: NormalizationOptions = {}
): Float32Array {
  const { type = 'l2', epsilon = 1e-12, inPlace = false } = options;

  if (type === 'none') {
    return embedding instanceof Float32Array
      ? embedding
      : new Float32Array(embedding);
  }

  if (inPlace && embedding instanceof Float32Array && type === 'l2') {
    return l2NormalizeInPlace(embedding, epsilon);
  }

  switch (type) {
    case 'l2':
      return l2Normalize(embedding, epsilon);
    case 'l1':
      return l1Normalize(embedding, epsilon);
    case 'minmax':
      return minMaxNormalize(embedding, epsilon);
    case 'zscore':
      return zScoreNormalize(embedding, epsilon);
    default:
      return l2Normalize(embedding, epsilon);
  }
}

/**
 * Batch normalize multiple embeddings
 */
export function normalizeBatch(
  embeddings: Array<Float32Array | number[]>,
  options: NormalizationOptions = {}
): Float32Array[] {
  return embeddings.map(emb => normalize(emb, options));
}

/**
 * Calculate L2 norm of embedding
 */
export function l2Norm(embedding: Float32Array | number[]): number {
  let sumSquares = 0;
  for (let i = 0; i < embedding.length; i++) {
    sumSquares += embedding[i] * embedding[i];
  }
  return Math.sqrt(sumSquares);
}

/**
 * Check if embedding is already normalized (L2 norm ≈ 1)
 */
export function isNormalized(
  embedding: Float32Array | number[],
  tolerance = 1e-6
): boolean {
  const norm = l2Norm(embedding);
  return Math.abs(norm - 1) < tolerance;
}

/**
 * Center embeddings by subtracting mean across batch
 * Useful for improving similarity metrics
 */
export function centerEmbeddings(
  embeddings: Array<Float32Array | number[]>
): Float32Array[] {
  if (embeddings.length === 0) return [];

  const dim = embeddings[0].length;
  const n = embeddings.length;

  // Calculate mean for each dimension
  const mean = new Float32Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      mean[i] += emb[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    mean[i] /= n;
  }

  // Subtract mean from each embedding
  return embeddings.map(emb => {
    const centered = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      centered[i] = emb[i] - mean[i];
    }
    return centered;
  });
}
