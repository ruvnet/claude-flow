/**
 * AgentDB Test Utilities and Helpers
 * Provides common test utilities, mocks, and helpers for AgentDB testing
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Generate random embedding vector
 * @param {number} dimension - Embedding dimension (default 384)
 * @returns {number[]} Random normalized embedding
 */
export function generateRandomEmbedding(dimension = 384) {
  const embedding = new Array(dimension).fill(0).map(() => Math.random() - 0.5);

  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  return embedding.map(val => val / norm);
}

/**
 * Generate test dataset with embeddings
 * @param {number} count - Number of items to generate
 * @param {Object} options - Generation options
 * @returns {Array} Test dataset
 */
export function generateTestDataset(count = 100, options = {}) {
  const {
    keyPrefix = 'test',
    dimension = 384,
    includeMetadata = true,
    includeNamespaces = false,
    namespaces = ['ns1', 'ns2', 'ns3']
  } = options;

  return Array(count).fill(null).map((_, i) => {
    const item = {
      key: `${keyPrefix}-${i}`,
      value: {
        content: `Test content ${i}`,
        index: i,
        timestamp: Date.now(),
        category: `cat-${i % 10}`
      },
      embedding: generateRandomEmbedding(dimension)
    };

    if (includeMetadata) {
      item.metadata = {
        type: 'test',
        category: i % 5,
        tags: [`tag-${i % 3}`, `tag-${i % 7}`],
        priority: i % 3
      };
    }

    if (includeNamespaces) {
      item.namespace = namespaces[i % namespaces.length];
    }

    return item;
  });
}

/**
 * Create temporary test database
 * @param {string} prefix - Database file prefix
 * @returns {string} Database path
 */
export function createTempDbPath(prefix = 'test') {
  return path.join('/tmp', `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

/**
 * Clean up test database
 * @param {string} dbPath - Database path to clean up
 */
export async function cleanupTestDb(dbPath) {
  try {
    await fs.unlink(dbPath);
    await fs.unlink(`${dbPath}-shm`).catch(() => {});
    await fs.unlink(`${dbPath}-wal`).catch(() => {});
  } catch (error) {
    // Ignore errors
  }
}

/**
 * Populate database with test data
 * @param {Object} backend - Database backend instance
 * @param {number} count - Number of items
 * @param {Object} options - Population options
 */
export async function populateDatabase(backend, count = 100, options = {}) {
  const dataset = generateTestDataset(count, options);

  if (backend.batchInsert) {
    // Use batch insert if available
    await backend.batchInsert(dataset);
  } else {
    // Fall back to individual inserts
    for (const item of dataset) {
      if (backend.storeWithEmbedding && item.embedding) {
        await backend.storeWithEmbedding(
          item.key,
          item.value,
          item.embedding,
          { metadata: item.metadata, namespace: item.namespace }
        );
      } else {
        await backend.store(
          item.key,
          item.value,
          { metadata: item.metadata, namespace: item.namespace }
        );
      }
    }
  }
}

/**
 * Compare two objects for equality (deep comparison)
 * @param {*} obj1 - First object
 * @param {*} obj2 - Second object
 * @returns {boolean} True if equal
 */
export function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;

  if (typeof obj1 !== 'object' || typeof obj2 !== 'object' || obj1 == null || obj2 == null) {
    return false;
  }

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!keys2.includes(key)) return false;
    if (!deepEqual(obj1[key], obj2[key])) return false;
  }

  return true;
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vec1 - First vector
 * @param {number[]} vec2 - Second vector
 * @returns {number} Cosine similarity (-1 to 1)
 */
export function cosineSimilarity(vec1, vec2) {
  if (vec1.length !== vec2.length) {
    throw new Error('Vectors must have same dimension');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Measure execution time of async function
 * @param {Function} fn - Async function to measure
 * @returns {Promise<Object>} Result and duration
 */
export async function measureTime(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();

  const durationMs = Number(end - start) / 1_000_000;

  return {
    result,
    duration: durationMs,
    durationUs: durationMs * 1000
  };
}

/**
 * Run benchmark iterations and calculate statistics
 * @param {Function} fn - Function to benchmark
 * @param {number} iterations - Number of iterations
 * @returns {Promise<Object>} Benchmark statistics
 */
export async function runBenchmark(fn, iterations = 100) {
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const { duration } = await measureTime(fn);
    times.push(duration);
  }

  times.sort((a, b) => a - b);

  return {
    iterations,
    min: times[0],
    max: times[times.length - 1],
    avg: times.reduce((sum, t) => sum + t, 0) / times.length,
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
    times
  };
}

/**
 * Validate database schema
 * @param {Object} backend - Database backend
 * @returns {Promise<Object>} Validation result
 */
export async function validateSchema(backend) {
  const requiredTables = ['embeddings', 'metadata', 'hnsw_index'];
  const tables = await backend.getTables?.() || [];

  const missing = requiredTables.filter(t => !tables.includes(t));

  return {
    valid: missing.length === 0,
    missing,
    tables
  };
}

/**
 * Create mock embedding function for testing
 * @param {number} dimension - Embedding dimension
 * @returns {Function} Mock embedding function
 */
export function createMockEmbeddingFunction(dimension = 384) {
  return function(text) {
    // Simple hash-based mock embedding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }

    const embedding = new Array(dimension).fill(0).map((_, i) => {
      const seed = hash + i;
      return Math.sin(seed) * Math.cos(seed * 2);
    });

    // Normalize
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
  };
}

/**
 * Assert performance threshold
 * @param {number} actualTime - Actual execution time (ms)
 * @param {number} threshold - Maximum allowed time (ms)
 * @param {string} operation - Operation name
 * @throws {Error} If threshold exceeded
 */
export function assertPerformance(actualTime, threshold, operation) {
  if (actualTime > threshold) {
    throw new Error(
      `Performance threshold exceeded for ${operation}: ${actualTime.toFixed(3)}ms > ${threshold}ms`
    );
  }
}

/**
 * Create test data with specific patterns
 * @param {Object} patterns - Data patterns
 * @returns {Array} Patterned test data
 */
export function createPatternedData(patterns = {}) {
  const {
    duplicateKeys = false,
    specialChars = false,
    largeValues = false,
    missingFields = false,
    nestedObjects = true
  } = patterns;

  const data = [];

  // Normal data
  for (let i = 0; i < 10; i++) {
    const item = {
      key: `pattern-${i}`,
      value: {
        content: `Content ${i}`,
        index: i
      },
      embedding: generateRandomEmbedding()
    };

    if (nestedObjects) {
      item.value.nested = {
        level1: {
          level2: {
            value: i
          }
        }
      };
    }

    data.push(item);
  }

  // Add special patterns
  if (specialChars) {
    data.push({
      key: 'special-chars',
      value: {
        content: '🚀 Special™ Chars® 中文 Ñoño'
      },
      embedding: generateRandomEmbedding()
    });
  }

  if (largeValues) {
    data.push({
      key: 'large-value',
      value: {
        content: 'x'.repeat(100000),
        largeArray: new Array(1000).fill('data')
      },
      embedding: generateRandomEmbedding()
    });
  }

  if (duplicateKeys) {
    data.push({
      key: 'pattern-0', // Duplicate
      value: {
        content: 'Duplicate key'
      },
      embedding: generateRandomEmbedding()
    });
  }

  if (missingFields) {
    data.push({
      key: 'missing-fields',
      value: {
        // Only partial data
        index: 999
      },
      embedding: generateRandomEmbedding()
    });
  }

  return data;
}

/**
 * Mock AgentDB backend for unit testing
 */
export class MockAgentDBBackend {
  constructor() {
    this.store = new Map();
    this.embeddings = new Map();
  }

  async initialize() {
    return true;
  }

  async store(key, value, embedding, options = {}) {
    this.store.set(key, { value, metadata: options.metadata, namespace: options.namespace });
    if (embedding) {
      this.embeddings.set(key, embedding);
    }
    return true;
  }

  async retrieve(key, options = {}) {
    const item = this.store.get(key);
    return item ? item.value : null;
  }

  async search(pattern, options = {}) {
    const results = [];
    for (const [key, item] of this.store.entries()) {
      if (key.includes(pattern.replace('*', ''))) {
        results.push({ key, value: item.value });
      }
    }
    return results;
  }

  async delete(key) {
    this.store.delete(key);
    this.embeddings.delete(key);
    return true;
  }

  async vectorSearch(query, limit = 10) {
    // Simple mock: return random items
    const items = Array.from(this.store.entries()).slice(0, limit);
    return items.map(([key, item]) => ({
      key,
      value: item.value,
      similarity: Math.random()
    }));
  }

  async close() {
    return true;
  }
}

/**
 * Wait for async operation with timeout
 * @param {Promise} promise - Promise to await
 * @param {number} timeout - Timeout in ms
 * @returns {Promise} Result or timeout error
 */
export function withTimeout(promise, timeout = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)
    )
  ]);
}

/**
 * Retry operation with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} Result
 */
export async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    initialDelay = 100,
    backoffFactor = 2,
    maxDelay = 5000
  } = options;

  let lastError;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * backoffFactor, maxDelay);
      }
    }
  }

  throw lastError;
}

export default {
  generateRandomEmbedding,
  generateTestDataset,
  createTempDbPath,
  cleanupTestDb,
  populateDatabase,
  deepEqual,
  cosineSimilarity,
  measureTime,
  runBenchmark,
  validateSchema,
  createMockEmbeddingFunction,
  assertPerformance,
  createPatternedData,
  MockAgentDBBackend,
  withTimeout,
  retry
};
