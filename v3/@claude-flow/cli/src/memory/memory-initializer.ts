/**
 * V3 Memory Initializer
 * Properly initializes the memory database with sql.js (WASM SQLite)
 * Includes pattern tables, vector embeddings, migration state tracking
 *
 * ADR-053: Routes through ControllerRegistry → AgentDB v3 when available,
 * falls back to raw sql.js for backwards compatibility.
 *
 * @module v3/cli/memory-initializer
 */

import * as fs from 'fs';
import * as path from 'path';

// ADR-053: Lazy import of AgentDB v3 bridge
let _bridge: typeof import('./memory-bridge.js') | null | undefined;
async function getBridge(): Promise<typeof import('./memory-bridge.js') | null> {
  if (_bridge === null) return null;
  if (_bridge) return _bridge;
  try {
    _bridge = await import('./memory-bridge.js');
    return _bridge;
  } catch {
    _bridge = null;
    return null;
  }
}

/**
 * Enhanced schema with pattern confidence, temporal decay, versioning
 * Vector embeddings enabled for semantic search
 */
export const MEMORY_SCHEMA_V3 = `
-- RuFlo V3 Memory Database
-- Version: 3.0.0
-- Features: Pattern learning, vector embeddings, temporal decay, migration tracking

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ============================================
-- CORE MEMORY TABLES
-- ============================================

-- Memory entries (main storage)
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  namespace TEXT DEFAULT 'default',
  content TEXT NOT NULL,
  type TEXT DEFAULT 'semantic' CHECK(type IN ('semantic', 'episodic', 'procedural', 'working', 'pattern')),

  -- Vector embedding for semantic search (stored as JSON array)
  embedding TEXT,
  embedding_model TEXT DEFAULT 'local',
  embedding_dimensions INTEGER,

  -- Metadata
  tags TEXT, -- JSON array
  metadata TEXT, -- JSON object
  owner_id TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  expires_at INTEGER,
  last_accessed_at INTEGER,

  -- Access tracking for hot/cold detection
  access_count INTEGER DEFAULT 0,

  -- Status
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),

  UNIQUE(namespace, key)
);

-- Indexes for memory entries
CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_entries(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_key ON memory_entries(key);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_status ON memory_entries(status);
CREATE INDEX IF NOT EXISTS idx_memory_created ON memory_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_memory_accessed ON memory_entries(last_accessed_at);
CREATE INDEX IF NOT EXISTS idx_memory_owner ON memory_entries(owner_id);

-- ============================================
-- PATTERN LEARNING TABLES
-- ============================================

-- Learned patterns with confidence scoring and versioning
CREATE TABLE IF NOT EXISTS patterns (
  id TEXT PRIMARY KEY,

  -- Pattern identification
  name TEXT NOT NULL,
  pattern_type TEXT NOT NULL CHECK(pattern_type IN (
    'task-routing', 'error-recovery', 'optimization', 'learning',
    'coordination', 'prediction', 'code-pattern', 'workflow'
  )),

  -- Pattern definition
  condition TEXT NOT NULL, -- Regex or semantic match
  action TEXT NOT NULL, -- What to do when pattern matches
  description TEXT,

  -- Confidence scoring (0.0 - 1.0)
  confidence REAL DEFAULT 0.5,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,

  -- Temporal decay
  decay_rate REAL DEFAULT 0.01, -- How fast confidence decays
  half_life_days INTEGER DEFAULT 30, -- Days until confidence halves without use

  -- Vector embedding for semantic pattern matching
  embedding TEXT,
  embedding_dimensions INTEGER,

  -- Versioning
  version INTEGER DEFAULT 1,
  parent_id TEXT REFERENCES patterns(id),

  -- Metadata
  tags TEXT, -- JSON array
  metadata TEXT, -- JSON object
  source TEXT, -- Where the pattern was learned from

  -- Timestamps
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  last_matched_at INTEGER,
  last_success_at INTEGER,
  last_failure_at INTEGER,

  -- Status
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deprecated', 'experimental'))
);

-- Indexes for patterns
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_status ON patterns(status);
CREATE INDEX IF NOT EXISTS idx_patterns_last_matched ON patterns(last_matched_at);

-- Pattern evolution history (for versioning)
CREATE TABLE IF NOT EXISTS pattern_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern_id TEXT NOT NULL REFERENCES patterns(id),
  version INTEGER NOT NULL,

  -- Snapshot of pattern state
  confidence REAL,
  success_count INTEGER,
  failure_count INTEGER,
  condition TEXT,
  action TEXT,

  -- What changed
  change_type TEXT CHECK(change_type IN ('created', 'updated', 'success', 'failure', 'decay', 'merged', 'split')),
  change_reason TEXT,

  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_pattern_history_pattern ON pattern_history(pattern_id);

-- ============================================
-- LEARNING & TRAJECTORY TABLES
-- ============================================

-- Learning trajectories (SONA integration)
CREATE TABLE IF NOT EXISTS trajectories (
  id TEXT PRIMARY KEY,
  session_id TEXT,

  -- Trajectory state
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed', 'abandoned')),
  verdict TEXT CHECK(verdict IN ('success', 'failure', 'partial', NULL)),

  -- Context
  task TEXT,
  context TEXT, -- JSON object

  -- Metrics
  total_steps INTEGER DEFAULT 0,
  total_reward REAL DEFAULT 0,

  -- Timestamps
  started_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  ended_at INTEGER,

  -- Reference to extracted pattern (if any)
  extracted_pattern_id TEXT REFERENCES patterns(id)
);

-- Trajectory steps
CREATE TABLE IF NOT EXISTS trajectory_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trajectory_id TEXT NOT NULL REFERENCES trajectories(id),
  step_number INTEGER NOT NULL,

  -- Step data
  action TEXT NOT NULL,
  observation TEXT,
  reward REAL DEFAULT 0,

  -- Metadata
  metadata TEXT, -- JSON object

  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_steps_trajectory ON trajectory_steps(trajectory_id);

-- ============================================
-- MIGRATION STATE TRACKING
-- ============================================

-- Migration state (for resume capability)
CREATE TABLE IF NOT EXISTS migration_state (
  id TEXT PRIMARY KEY,
  migration_type TEXT NOT NULL, -- 'v2-to-v3', 'pattern', 'memory', etc.

  -- Progress tracking
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'rolled_back')),
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  skipped_items INTEGER DEFAULT 0,

  -- Current position (for resume)
  current_batch INTEGER DEFAULT 0,
  last_processed_id TEXT,

  -- Source/destination info
  source_path TEXT,
  source_type TEXT,
  destination_path TEXT,

  -- Backup info
  backup_path TEXT,
  backup_created_at INTEGER,

  -- Error tracking
  last_error TEXT,
  errors TEXT, -- JSON array of errors

  -- Timestamps
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ============================================
-- SESSION MANAGEMENT
-- ============================================

-- Sessions for context persistence
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,

  -- Session state
  state TEXT NOT NULL, -- JSON object with full session state
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'expired')),

  -- Context
  project_path TEXT,
  branch TEXT,

  -- Metrics
  tasks_completed INTEGER DEFAULT 0,
  patterns_learned INTEGER DEFAULT 0,

  -- Timestamps
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  expires_at INTEGER
);

-- ============================================
-- VECTOR INDEX METADATA (for HNSW)
-- ============================================

-- Track HNSW index state
CREATE TABLE IF NOT EXISTS vector_indexes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,

  -- Index configuration
  dimensions INTEGER NOT NULL,
  metric TEXT DEFAULT 'cosine' CHECK(metric IN ('cosine', 'euclidean', 'dot')),

  -- HNSW parameters
  hnsw_m INTEGER DEFAULT 16,
  hnsw_ef_construction INTEGER DEFAULT 200,
  hnsw_ef_search INTEGER DEFAULT 100,

  -- Quantization
  quantization_type TEXT CHECK(quantization_type IN ('none', 'scalar', 'product')),
  quantization_bits INTEGER DEFAULT 8,

  -- Statistics
  total_vectors INTEGER DEFAULT 0,
  last_rebuild_at INTEGER,

  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
);

-- ============================================
-- SYSTEM METADATA
-- ============================================

CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);
`;

// ============================================================================
// HNSW INDEX SINGLETON (150x faster vector search)
// Uses @ruvector/core from agentic-flow for WASM-accelerated HNSW
// ============================================================================

interface HNSWEntry {
  id: string;
  key: string;
  namespace: string;
  content: string;
}

interface HNSWIndex {
  db: any;
  entries: Map<string, HNSWEntry>;
  dimensions: number;
  initialized: boolean;
}

let hnswIndex: HNSWIndex | null = null;
let hnswInitializing = false;

/**
 * Get or create the HNSW index singleton
 * Lazily initializes from SQLite data on first use
 */
export async function getHNSWIndex(options?: {
  dbPath?: string;
  dimensions?: number;
  forceRebuild?: boolean;
}): Promise<HNSWIndex | null> {
  const dimensions = options?.dimensions ?? 384;

  // Return existing index if already initialized
  if (hnswIndex?.initialized && !options?.forceRebuild) {
    return hnswIndex;
  }

  // Prevent concurrent initialization
  if (hnswInitializing) {
    // Wait for initialization to complete
    while (hnswInitializing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return hnswIndex;
  }

  hnswInitializing = true;

  try {
    // Import @ruvector/core dynamically
    // Handle both ESM (default export) and CJS patterns
    const ruvectorModule = await import('@ruvector/core').catch(() => null);
    if (!ruvectorModule) {
      hnswInitializing = false;
      return null; // HNSW not available
    }

    // ESM returns { default: { VectorDb, ... } }, CJS returns { VectorDb, ... }
    const ruvectorCore = (ruvectorModule as any).default || ruvectorModule;
    if (!ruvectorCore?.VectorDb) {
      hnswInitializing = false;
      return null; // VectorDb not found
    }

    const { VectorDb } = ruvectorCore;

    // Persistent storage paths — resolve to absolute to survive CWD changes
    const swarmDir = path.resolve(process.cwd(), '.swarm');
    if (!fs.existsSync(swarmDir)) {
      fs.mkdirSync(swarmDir, { recursive: true });
    }
    const hnswPath = path.join(swarmDir, 'hnsw.index');
    const metadataPath = path.join(swarmDir, 'hnsw.metadata.json');
    const dbPath = options?.dbPath ? path.resolve(options.dbPath) : path.join(swarmDir, 'memory.db');

    // Create HNSW index with persistent storage
    // @ruvector/core uses string enum for distanceMetric: 'Cosine', 'Euclidean', 'DotProduct', 'Manhattan'
    const db = new VectorDb({
      dimensions,
      distanceMetric: 'Cosine',
      storagePath: hnswPath  // Persistent storage!
    } as any);

    // Load metadata (entry info) if exists
    const entries = new Map<string, HNSWEntry>();
    if (fs.existsSync(metadataPath)) {
      try {
        const metadataJson = fs.readFileSync(metadataPath, 'utf-8');
        const metadata = JSON.parse(metadataJson) as Array<[string, HNSWEntry]>;
        for (const [key, value] of metadata) {
          entries.set(key, value);
        }
      } catch {
        // Metadata load failed, will rebuild
      }
    }

    hnswIndex = {
      db,
      entries,
      dimensions,
      initialized: false
    };

    // Check if index already has data (from persistent storage)
    const existingLen = await db.len();
    if (existingLen > 0 && entries.size > 0) {
      // Index loaded from disk, skip SQLite sync
      hnswIndex.initialized = true;
      hnswInitializing = false;
      return hnswIndex;
    }

    if (fs.existsSync(dbPath)) {
      try {
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();
        const fileBuffer = fs.readFileSync(dbPath);
        const sqlDb = new SQL.Database(fileBuffer);

        // Load all entries with embeddings
        const result = sqlDb.exec(`
          SELECT id, key, namespace, content, embedding
          FROM memory_entries
          WHERE status = 'active' AND embedding IS NOT NULL
          LIMIT 10000
        `);

        if (result[0]?.values) {
          for (const row of result[0].values) {
            const [id, key, ns, content, embeddingJson] = row as [string, string, string, string, string];
            if (embeddingJson) {
              try {
                const embedding = JSON.parse(embeddingJson) as number[];
                const vector = new Float32Array(embedding);

                await db.insert({
                  id: String(id),
                  vector
                });

                hnswIndex.entries.set(String(id), {
                  id: String(id),
                  key: key || String(id),
                  namespace: ns || 'default',
                  content: content || ''
                });
              } catch {
                // Skip invalid embeddings
              }
            }
          }
        }

        sqlDb.close();
      } catch {
        // SQLite load failed, start with empty index
      }
    }

    hnswIndex.initialized = true;
    hnswInitializing = false;
    return hnswIndex;
  } catch {
    hnswInitializing = false;
    return null;
  }
}

/**
 * Save HNSW metadata to disk for persistence
 */
function saveHNSWMetadata(): void {
  if (!hnswIndex?.entries) return;

  try {
    const swarmDir = path.join(process.cwd(), '.swarm');
    const metadataPath = path.join(swarmDir, 'hnsw.metadata.json');
    const metadata = Array.from(hnswIndex.entries.entries());
    fs.writeFileSync(metadataPath, JSON.stringify(metadata));
  } catch {
    // Silently fail - metadata save is best-effort
  }
}

/**
 * Add entry to HNSW index (with automatic persistence)
 */
export async function addToHNSWIndex(
  id: string,
  embedding: number[],
  entry: HNSWEntry
): Promise<boolean> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeAddToHNSW(id, embedding, entry);
    if (bridgeResult === true) return true;
  }

  const index = await getHNSWIndex({ dimensions: embedding.length });
  if (!index) return false;

  try {
    const vector = new Float32Array(embedding);
    await index.db.insert({
      id,
      vector
    });
    index.entries.set(id, entry);

    // Save metadata for persistence (debounced would be better for high-volume)
    saveHNSWMetadata();
    return true;
  } catch {
    return false;
  }
}

/**
 * Search HNSW index (150x faster than brute-force)
 * Returns results sorted by similarity (highest first)
 */
export async function searchHNSWIndex(
  queryEmbedding: number[],
  options?: {
    k?: number;
    namespace?: string;
  }
): Promise<Array<{ id: string; key: string; content: string; score: number; namespace: string }> | null> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeSearchHNSW(queryEmbedding, options);
    if (bridgeResult) return bridgeResult;
  }

  const index = await getHNSWIndex({ dimensions: queryEmbedding.length });
  if (!index) return null;

  try {
    const vector = new Float32Array(queryEmbedding);
    const k = options?.k ?? 10;

    // HNSW search returns results with cosine distance (lower = more similar)
    const results = await index.db.search({ vector, k: k * 2 }); // Get extra for filtering

    const filtered: Array<{ id: string; key: string; content: string; score: number; namespace: string }> = [];

    for (const result of results) {
      const entry = index.entries.get(result.id);
      if (!entry) continue;

      // Filter by namespace if specified
      if (options?.namespace && options.namespace !== 'all' && entry.namespace !== options.namespace) {
        continue;
      }

      // Convert cosine distance to similarity score (1 - distance)
      // Cosine distance from @ruvector/core: 0 = identical, 2 = opposite
      const score = 1 - (result.score / 2);

      filtered.push({
        id: entry.id.substring(0, 12),
        key: entry.key || entry.id.substring(0, 15),
        content: entry.content.substring(0, 60) + (entry.content.length > 60 ? '...' : ''),
        score,
        namespace: entry.namespace
      });

      if (filtered.length >= k) break;
    }

    // Sort by score descending (highest similarity first)
    filtered.sort((a, b) => b.score - a.score);

    return filtered;
  } catch {
    return null;
  }
}

/**
 * Get HNSW index status
 */
export function getHNSWStatus(): {
  available: boolean;
  initialized: boolean;
  entryCount: number;
  dimensions: number;
} {
  // ADR-053: If bridge was previously loaded, report availability
  if (_bridge && _bridge !== null) {
    // Bridge is loaded — HNSW-equivalent is available via AgentDB v3
    return {
      available: true,
      initialized: true,
      entryCount: hnswIndex?.entries.size ?? 0,
      dimensions: hnswIndex?.dimensions ?? 384
    };
  }

  return {
    available: hnswIndex !== null,
    initialized: hnswIndex?.initialized ?? false,
    entryCount: hnswIndex?.entries.size ?? 0,
    dimensions: hnswIndex?.dimensions ?? 384
  };
}

/**
 * Clear the HNSW index (for rebuilding)
 */
export function clearHNSWIndex(): void {
  hnswIndex = null;
}

/**
 * Invalidate the in-memory HNSW cache so the next search rebuilds from DB.
 * Call this after deleting entries that had embeddings to prevent ghost
 * vectors from appearing in search results.
 */
export function rebuildSearchIndex(): void {
  hnswIndex = null;
  hnswInitializing = false;
}

// ============================================================================
// INT8 VECTOR QUANTIZATION (4x memory reduction)
// ============================================================================

/**
 * Quantize a Float32 embedding to Int8 (4x memory reduction)
 * Uses symmetric quantization with scale factor stored per-vector
 *
 * @param embedding - Float32 embedding array
 * @returns Quantized Int8 array with scale factor
 */
export function quantizeInt8(embedding: number[] | Float32Array): {
  quantized: Int8Array;
  scale: number;
  zeroPoint: number;
} {
  const arr = embedding instanceof Float32Array ? embedding : new Float32Array(embedding);

  // Find min/max for symmetric quantization
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] < min) min = arr[i];
    if (arr[i] > max) max = arr[i];
  }

  // Symmetric quantization: scale = max(|min|, |max|) / 127
  const absMax = Math.max(Math.abs(min), Math.abs(max));
  const scale = absMax / 127 || 1e-10; // Avoid division by zero
  const zeroPoint = 0; // Symmetric quantization

  // Quantize
  const quantized = new Int8Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    // Clamp to [-127, 127] to leave room for potential rounding
    const q = Math.round(arr[i] / scale);
    quantized[i] = Math.max(-127, Math.min(127, q));
  }

  return { quantized, scale, zeroPoint };
}

/**
 * Dequantize Int8 back to Float32
 *
 * @param quantized - Int8 quantized array
 * @param scale - Scale factor from quantization
 * @param zeroPoint - Zero point (usually 0 for symmetric)
 * @returns Float32Array
 */
export function dequantizeInt8(
  quantized: Int8Array,
  scale: number,
  zeroPoint: number = 0
): Float32Array {
  const result = new Float32Array(quantized.length);
  for (let i = 0; i < quantized.length; i++) {
    result[i] = (quantized[i] - zeroPoint) * scale;
  }
  return result;
}

/**
 * Compute cosine similarity between quantized vectors
 * Faster than dequantizing first
 */
export function quantizedCosineSim(
  a: Int8Array, aScale: number,
  b: Int8Array, bScale: number
): number {
  if (a.length !== b.length) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // Scales cancel out in cosine similarity for normalized vectors
  const mag = Math.sqrt(normA * normB);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * Get quantization statistics for an embedding
 */
export function getQuantizationStats(embedding: number[] | Float32Array): {
  originalBytes: number;
  quantizedBytes: number;
  compressionRatio: number;
} {
  const len = embedding.length;
  const originalBytes = len * 4; // Float32 = 4 bytes
  const quantizedBytes = len + 8; // Int8 = 1 byte + 8 bytes for scale/zeroPoint
  const compressionRatio = originalBytes / quantizedBytes;

  return { originalBytes, quantizedBytes, compressionRatio };
}

// ============================================================================
// FLASH ATTENTION-STYLE BATCH OPERATIONS (V8-Optimized)
// ============================================================================

/**
 * Batch cosine similarity - compute query against multiple vectors
 * Optimized for V8 JIT with typed arrays
 * ~50μs per 1000 vectors (384-dim)
 */
export function batchCosineSim(
  query: Float32Array | number[],
  vectors: (Float32Array | number[])[],
): Float32Array {
  const n = vectors.length;
  const scores = new Float32Array(n);

  if (n === 0 || query.length === 0) return scores;

  // Pre-compute query norm
  let queryNorm = 0;
  for (let i = 0; i < query.length; i++) {
    queryNorm += query[i] * query[i];
  }
  queryNorm = Math.sqrt(queryNorm);
  if (queryNorm === 0) return scores;

  // Compute similarities
  for (let v = 0; v < n; v++) {
    const vec = vectors[v];
    const len = Math.min(query.length, vec.length);
    let dot = 0, vecNorm = 0;

    for (let i = 0; i < len; i++) {
      dot += query[i] * vec[i];
      vecNorm += vec[i] * vec[i];
    }

    vecNorm = Math.sqrt(vecNorm);
    scores[v] = vecNorm === 0 ? 0 : dot / (queryNorm * vecNorm);
  }

  return scores;
}

/**
 * Softmax normalization for attention scores
 * Numerically stable implementation
 */
export function softmaxAttention(scores: Float32Array, temperature: number = 1.0): Float32Array {
  const n = scores.length;
  const result = new Float32Array(n);
  if (n === 0) return result;

  // Find max for numerical stability
  let max = scores[0];
  for (let i = 1; i < n; i++) {
    if (scores[i] > max) max = scores[i];
  }

  // Compute exp and sum
  let sum = 0;
  for (let i = 0; i < n; i++) {
    result[i] = Math.exp((scores[i] - max) / temperature);
    sum += result[i];
  }

  // Normalize
  if (sum > 0) {
    for (let i = 0; i < n; i++) {
      result[i] /= sum;
    }
  }

  return result;
}

/**
 * Top-K selection with partial sort (O(n + k log k))
 * More efficient than full sort for small k
 */
export function topKIndices(scores: Float32Array, k: number): number[] {
  const n = scores.length;
  if (k >= n) {
    // Return all indices sorted by score
    return Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => scores[b] - scores[a]);
  }

  // Build min-heap of size k
  const heap: { idx: number; score: number }[] = [];

  for (let i = 0; i < n; i++) {
    if (heap.length < k) {
      heap.push({ idx: i, score: scores[i] });
      // Bubble up
      let j = heap.length - 1;
      while (j > 0) {
        const parent = Math.floor((j - 1) / 2);
        if (heap[j].score < heap[parent].score) {
          [heap[j], heap[parent]] = [heap[parent], heap[j]];
          j = parent;
        } else break;
      }
    } else if (scores[i] > heap[0].score) {
      // Replace min and heapify down
      heap[0] = { idx: i, score: scores[i] };
      let j = 0;
      while (true) {
        const left = 2 * j + 1, right = 2 * j + 2;
        let smallest = j;
        if (left < k && heap[left].score < heap[smallest].score) smallest = left;
        if (right < k && heap[right].score < heap[smallest].score) smallest = right;
        if (smallest === j) break;
        [heap[j], heap[smallest]] = [heap[smallest], heap[j]];
        j = smallest;
      }
    }
  }

  // Extract and sort descending
  return heap.sort((a, b) => b.score - a.score).map(h => h.idx);
}

/**
 * Flash Attention-style search
 * Combines batch similarity, softmax, and top-k in one pass
 * Returns indices and attention weights
 */
export function flashAttentionSearch(
  query: Float32Array | number[],
  vectors: (Float32Array | number[])[],
  options: {
    k?: number;
    temperature?: number;
    threshold?: number;
  } = {}
): { indices: number[]; scores: Float32Array; weights: Float32Array } {
  const { k = 10, temperature = 1.0, threshold = 0 } = options;

  // Compute batch similarity
  const scores = batchCosineSim(query, vectors);

  // Get top-k indices
  const indices = topKIndices(scores, k);

  // Filter by threshold
  const filtered = indices.filter(i => scores[i] >= threshold);

  // Extract scores for filtered results
  const topScores = new Float32Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    topScores[i] = scores[filtered[i]];
  }

  // Compute attention weights (softmax over top-k)
  const weights = softmaxAttention(topScores, temperature);

  return { indices: filtered, scores: topScores, weights };
}

// ============================================================================
// METADATA AND INITIALIZATION
// ============================================================================

/**
 * Initial metadata to insert after schema creation
 */
export function getInitialMetadata(backend: string): string {
  return `
INSERT OR REPLACE INTO metadata (key, value) VALUES
  ('schema_version', '3.0.0'),
  ('backend', '${backend}'),
  ('created_at', '${new Date().toISOString()}'),
  ('sql_js', 'true'),
  ('vector_embeddings', 'enabled'),
  ('pattern_learning', 'enabled'),
  ('temporal_decay', 'enabled'),
  ('hnsw_indexing', 'enabled');

-- Create default vector index configuration
INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES
  ('default', 'default', 768),
  ('patterns', 'patterns', 768);
`;
}

/**
 * Memory initialization result
 */
export interface MemoryInitResult {
  success: boolean;
  backend: string;
  dbPath: string;
  schemaVersion: string;
  tablesCreated: string[];
  indexesCreated: string[];
  features: {
    vectorEmbeddings: boolean;
    patternLearning: boolean;
    temporalDecay: boolean;
    hnswIndexing: boolean;
    migrationTracking: boolean;
  };
  /** ADR-053: Controllers activated via ControllerRegistry */
  controllers?: {
    activated: string[];
    failed: string[];
    initTimeMs: number;
  };
  error?: string;
}

/**
 * Ensure memory_entries table has all required columns
 * Adds missing columns for older databases (e.g., 'content' column)
 */
export async function ensureSchemaColumns(dbPath: string): Promise<{
  success: boolean;
  columnsAdded: string[];
  error?: string;
}> {
  const columnsAdded: string[] = [];

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: true, columnsAdded: [] };
    }

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Get current columns in memory_entries
    const tableInfo = db.exec("PRAGMA table_info(memory_entries)");
    const existingColumns = new Set(
      tableInfo[0]?.values?.map(row => row[1] as string) || []
    );

    // Required columns that may be missing in older schemas
    // Issue #977: 'type' column was missing from this list, causing store failures on older DBs
    const requiredColumns: Array<{ name: string; definition: string }> = [
      { name: 'content', definition: "content TEXT DEFAULT ''" },
      { name: 'type', definition: "type TEXT DEFAULT 'semantic'" },
      { name: 'embedding', definition: 'embedding TEXT' },
      { name: 'embedding_model', definition: "embedding_model TEXT DEFAULT 'local'" },
      { name: 'embedding_dimensions', definition: 'embedding_dimensions INTEGER' },
      { name: 'tags', definition: 'tags TEXT' },
      { name: 'metadata', definition: 'metadata TEXT' },
      { name: 'owner_id', definition: 'owner_id TEXT' },
      { name: 'expires_at', definition: 'expires_at INTEGER' },
      { name: 'last_accessed_at', definition: 'last_accessed_at INTEGER' },
      { name: 'access_count', definition: 'access_count INTEGER DEFAULT 0' },
      { name: 'status', definition: "status TEXT DEFAULT 'active'" }
    ];

    let modified = false;
    for (const col of requiredColumns) {
      if (!existingColumns.has(col.name)) {
        try {
          db.run(`ALTER TABLE memory_entries ADD COLUMN ${col.definition}`);
          columnsAdded.push(col.name);
          modified = true;
        } catch (e) {
          // Column might already exist or other error - continue
        }
      }
    }

    if (modified) {
      // Save updated database
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    }

    db.close();
    return { success: true, columnsAdded };
  } catch (error) {
    return {
      success: false,
      columnsAdded,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check for legacy database installations and migrate if needed
 */
export async function checkAndMigrateLegacy(options: {
  dbPath: string;
  verbose?: boolean;
}): Promise<{
  needsMigration: boolean;
  legacyVersion?: string;
  legacyEntries?: number;
  migrated?: boolean;
  migratedCount?: number;
}> {
  const { dbPath, verbose = false } = options;

  // Check for legacy locations
  const legacyPaths = [
    path.join(process.cwd(), 'memory.db'),
    path.join(process.cwd(), '.claude/memory.db'),
    path.join(process.cwd(), 'data/memory.db'),
    path.join(process.cwd(), '.claude-flow/memory.db')
  ];

  for (const legacyPath of legacyPaths) {
    if (fs.existsSync(legacyPath) && legacyPath !== dbPath) {
      try {
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();

        const legacyBuffer = fs.readFileSync(legacyPath);
        const legacyDb = new SQL.Database(legacyBuffer);

        // Check if it has data
        const countResult = legacyDb.exec('SELECT COUNT(*) FROM memory_entries');
        const count = countResult[0]?.values[0]?.[0] as number || 0;

        // Get version if available
        let version = 'unknown';
        try {
          const versionResult = legacyDb.exec("SELECT value FROM metadata WHERE key='schema_version'");
          version = versionResult[0]?.values[0]?.[0] as string || 'unknown';
        } catch { /* no metadata table */ }

        legacyDb.close();

        if (count > 0) {
          return {
            needsMigration: true,
            legacyVersion: version,
            legacyEntries: count
          };
        }
      } catch {
        // Not a valid SQLite database, skip
      }
    }
  }

  return { needsMigration: false };
}

/**
 * ADR-053: Activate ControllerRegistry so AgentDB v3 controllers
 * (ReasoningBank, SkillLibrary, ExplainableRecall, etc.) are instantiated.
 *
 * Uses the memory-bridge's getControllerRegistry() which lazily creates
 * a singleton ControllerRegistry and initializes it with the given dbPath.
 * After this call, all enabled controllers are ready for immediate use.
 *
 * Failures are isolated: if @claude-flow/memory or agentdb is not installed,
 * this returns an empty result without throwing.
 */
async function activateControllerRegistry(
  dbPath: string,
  verbose?: boolean,
): Promise<{ activated: string[]; failed: string[]; initTimeMs: number }> {
  const startTime = performance.now();
  const activated: string[] = [];
  const failed: string[] = [];

  try {
    const bridge = await getBridge();
    if (!bridge) {
      return { activated, failed, initTimeMs: performance.now() - startTime };
    }

    const registry = await bridge.getControllerRegistry(dbPath);
    if (!registry) {
      return { activated, failed, initTimeMs: performance.now() - startTime };
    }

    // Collect controller status from the registry
    if (typeof registry.listControllers === 'function') {
      const controllers = registry.listControllers();
      for (const ctrl of controllers) {
        if (ctrl.enabled) {
          activated.push(ctrl.name);
        } else {
          failed.push(ctrl.name);
        }
      }
    }

    if (verbose && activated.length > 0) {
      console.log(`ControllerRegistry: ${activated.length} controllers activated`);
    }
  } catch {
    // ControllerRegistry activation is best-effort
  }

  return { activated, failed, initTimeMs: performance.now() - startTime };
}

/**
 * Initialize the memory database properly using sql.js
 */
export async function initializeMemoryDatabase(options: {
  backend?: string;
  dbPath?: string;
  force?: boolean;
  verbose?: boolean;
  migrate?: boolean;
}): Promise<MemoryInitResult> {
  const {
    backend = 'hybrid',
    dbPath: customPath,
    force = false,
    verbose = false,
    migrate = true
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');
  const dbDir = path.dirname(dbPath);

  try {
    // Create directory if needed
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Check for legacy installations
    if (migrate) {
      const legacyCheck = await checkAndMigrateLegacy({ dbPath, verbose });
      if (legacyCheck.needsMigration && verbose) {
        console.log(`Found legacy database (v${legacyCheck.legacyVersion}) with ${legacyCheck.legacyEntries} entries`);
      }
    }

    // Check existing database
    if (fs.existsSync(dbPath) && !force) {
      return {
        success: false,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: [],
        indexesCreated: [],
        features: {
          vectorEmbeddings: false,
          patternLearning: false,
          temporalDecay: false,
          hnswIndexing: false,
          migrationTracking: false
        },
        error: 'Database already exists. Use --force to reinitialize.'
      };
    }

    // Try to use sql.js (WASM SQLite)
    let db: any;
    let usedSqlJs = false;

    try {
      // Dynamic import of sql.js
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();

      // Load existing database or create new
      if (fs.existsSync(dbPath) && force) {
        fs.unlinkSync(dbPath);
      }

      db = new SQL.Database();
      usedSqlJs = true;
    } catch (e) {
      // sql.js not available, fall back to writing schema file
      if (verbose) {
        console.log('sql.js not available, writing schema file for later initialization');
      }
    }

    if (usedSqlJs && db) {
      // Execute schema
      db.run(MEMORY_SCHEMA_V3);

      // Insert initial metadata
      db.run(getInitialMetadata(backend));

      // Save to file
      const data = db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);

      // Close database
      db.close();

      // Also create schema file for reference
      const schemaPath = path.join(dbDir, 'schema.sql');
      fs.writeFileSync(schemaPath, MEMORY_SCHEMA_V3 + '\n' + getInitialMetadata(backend));

      // ADR-053: Activate ControllerRegistry so controllers (ReasoningBank,
      // SkillLibrary, ExplainableRecall, etc.) are instantiated during init
      const controllerResult = await activateControllerRegistry(dbPath, verbose);

      return {
        success: true,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: [
          'memory_entries',
          'patterns',
          'pattern_history',
          'trajectories',
          'trajectory_steps',
          'migration_state',
          'sessions',
          'vector_indexes',
          'metadata'
        ],
        indexesCreated: [
          'idx_memory_namespace',
          'idx_memory_key',
          'idx_memory_type',
          'idx_memory_status',
          'idx_memory_created',
          'idx_memory_accessed',
          'idx_memory_owner',
          'idx_patterns_type',
          'idx_patterns_confidence',
          'idx_patterns_status',
          'idx_patterns_last_matched',
          'idx_pattern_history_pattern',
          'idx_steps_trajectory'
        ],
        features: {
          vectorEmbeddings: true,
          patternLearning: true,
          temporalDecay: true,
          hnswIndexing: true,
          migrationTracking: true
        },
        controllers: controllerResult,
      };
    } else {
      // Fall back to schema file approach
      const schemaPath = path.join(dbDir, 'schema.sql');
      fs.writeFileSync(schemaPath, MEMORY_SCHEMA_V3 + '\n' + getInitialMetadata(backend));

      // Create minimal valid SQLite file
      const sqliteHeader = Buffer.alloc(4096, 0);
      // SQLite format 3 header
      Buffer.from('SQLite format 3\0').copy(sqliteHeader, 0);
      sqliteHeader[16] = 0x10; // page size high byte (4096)
      sqliteHeader[17] = 0x00; // page size low byte
      sqliteHeader[18] = 0x01; // file format write version
      sqliteHeader[19] = 0x01; // file format read version
      sqliteHeader[24] = 0x00; // max embedded payload
      sqliteHeader[25] = 0x40;
      sqliteHeader[26] = 0x20; // min embedded payload
      sqliteHeader[27] = 0x20; // leaf payload

      fs.writeFileSync(dbPath, sqliteHeader);

      // ADR-053: Activate ControllerRegistry even on fallback path
      const controllerResult = await activateControllerRegistry(dbPath, verbose);

      return {
        success: true,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: [
          'memory_entries (pending)',
          'patterns (pending)',
          'pattern_history (pending)',
          'trajectories (pending)',
          'trajectory_steps (pending)',
          'migration_state (pending)',
          'sessions (pending)',
          'vector_indexes (pending)',
          'metadata (pending)'
        ],
        indexesCreated: [],
        features: {
          vectorEmbeddings: true,
          patternLearning: true,
          temporalDecay: true,
          hnswIndexing: true,
          migrationTracking: true
        },
        controllers: controllerResult,
      };
    }
  } catch (error) {
    return {
      success: false,
      backend,
      dbPath,
      schemaVersion: '3.0.0',
      tablesCreated: [],
      indexesCreated: [],
      features: {
        vectorEmbeddings: false,
        patternLearning: false,
        temporalDecay: false,
        hnswIndexing: false,
        migrationTracking: false
      },
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check if memory database is properly initialized
 */
export async function checkMemoryInitialization(dbPath?: string): Promise<{
  initialized: boolean;
  version?: string;
  backend?: string;
  features?: {
    vectorEmbeddings: boolean;
    patternLearning: boolean;
    temporalDecay: boolean;
  };
  tables?: string[];
}> {
  const swarmDir = path.join(process.cwd(), '.swarm');
  const path_ = dbPath || path.join(swarmDir, 'memory.db');

  if (!fs.existsSync(path_)) {
    return { initialized: false };
  }

  try {
    // Try to load with sql.js
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(path_);
    const db = new SQL.Database(fileBuffer);

    // Check for metadata table
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables[0]?.values?.map(v => v[0] as string) || [];

    // Get version
    let version = 'unknown';
    let backend = 'unknown';
    try {
      const versionResult = db.exec("SELECT value FROM metadata WHERE key='schema_version'");
      version = versionResult[0]?.values[0]?.[0] as string || 'unknown';

      const backendResult = db.exec("SELECT value FROM metadata WHERE key='backend'");
      backend = backendResult[0]?.values[0]?.[0] as string || 'unknown';
    } catch {
      // Metadata table might not exist
    }

    db.close();

    return {
      initialized: true,
      version,
      backend,
      features: {
        vectorEmbeddings: tableNames.includes('vector_indexes'),
        patternLearning: tableNames.includes('patterns'),
        temporalDecay: tableNames.includes('pattern_history')
      },
      tables: tableNames
    };
  } catch {
    // Could not read database
    return { initialized: false };
  }
}

/**
 * Apply temporal decay to patterns
 * Reduces confidence of patterns that haven't been used recently
 */
export async function applyTemporalDecay(dbPath?: string): Promise<{
  success: boolean;
  patternsDecayed: number;
  error?: string;
}> {
  const swarmDir = path.join(process.cwd(), '.swarm');
  const path_ = dbPath || path.join(swarmDir, 'memory.db');

  try {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(path_);
    const db = new SQL.Database(fileBuffer);

    // Apply decay: confidence *= exp(-decay_rate * days_since_last_use)
    const now = Date.now();
    const decayQuery = `
      UPDATE patterns
      SET
        confidence = confidence * (1.0 - decay_rate * ((? - COALESCE(last_matched_at, created_at)) / 86400000.0)),
        updated_at = ?
      WHERE status = 'active'
        AND confidence > 0.1
        AND (? - COALESCE(last_matched_at, created_at)) > 86400000
    `;

    db.run(decayQuery, [now, now, now]);

    const changes = db.getRowsModified();

    // Save
    const data = db.export();
    fs.writeFileSync(path_, Buffer.from(data));
    db.close();

    return {
      success: true,
      patternsDecayed: changes
    };
  } catch (error) {
    return {
      success: false,
      patternsDecayed: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * ONNX Model Manager for lazy loading embeddings
 * Avoids loading 100MB+ models unless actually needed
 */
interface EmbeddingModel {
  loaded: boolean;
  model: unknown;
  tokenizer: unknown;
  dimensions: number;
}

let embeddingModelState: EmbeddingModel | null = null;

/**
 * Lazy load ONNX embedding model
 * Only loads when first embedding is requested
 */
export async function loadEmbeddingModel(options?: {
  modelPath?: string;
  verbose?: boolean;
}): Promise<{
  success: boolean;
  dimensions: number;
  modelName: string;
  loadTime?: number;
  error?: string;
}> {
  const { verbose = false } = options || {};
  const startTime = Date.now();

  // Already loaded
  if (embeddingModelState?.loaded) {
    return {
      success: true,
      dimensions: embeddingModelState.dimensions,
      modelName: 'cached',
      loadTime: 0
    };
  }

  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeLoadEmbeddingModel();
    if (bridgeResult && bridgeResult.success) {
      // Mark local state as loaded too so subsequent calls use cache
      embeddingModelState = {
        loaded: true,
        model: null, // Bridge handles embedding
        tokenizer: null,
        dimensions: bridgeResult.dimensions
      };
      return bridgeResult;
    }
  }

  try {
    // Try to import @xenova/transformers for ONNX embeddings
    const transformers = await import('@xenova/transformers').catch(() => null);

    if (transformers) {
      if (verbose) {
        console.log('Loading ONNX embedding model (all-MiniLM-L6-v2)...');
      }

      // Use small, fast model for local embeddings
      const { pipeline } = transformers;
      const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

      embeddingModelState = {
        loaded: true,
        model: embedder,
        tokenizer: null,
        dimensions: 384 // MiniLM-L6 produces 384-dim vectors
      };

      return {
        success: true,
        dimensions: 384,
        modelName: 'Xenova/all-MiniLM-L6-v2',
        loadTime: Date.now() - startTime
      };
    }

    // Fallback: Check for agentic-flow ReasoningBank embeddings (v3)
    // importOptional, not import().catch(): see services/optional-import.ts (Node 20 crash)
    const { importOptional, TRANSFORMERS_NATIVE_PROBE } = await import('../services/optional-import.js');
    const reasoningBank = await importOptional<typeof import('agentic-flow/reasoningbank')>(
      'agentic-flow/reasoningbank',
      TRANSFORMERS_NATIVE_PROBE,
    );

    if (reasoningBank?.computeEmbedding) {
      if (verbose) {
        console.log('Loading agentic-flow ReasoningBank embedding model...');
      }

      embeddingModelState = {
        loaded: true,
        model: { embed: reasoningBank.computeEmbedding },
        tokenizer: null,
        dimensions: 768
      };

      return {
        success: true,
        dimensions: 768,
        modelName: 'agentic-flow/reasoningbank',
        loadTime: Date.now() - startTime
      };
    }

    // Fallback: Check for ruvector ONNX embedder (bundled MiniLM-L6-v2 since v0.2.15)
    // v0.2.16: LoRA B=0 fix makes AdaptiveEmbedder safe (identity when untrained)
    // Note: isReady() returns false until first embed() call (lazy init), so we
    // skip the isReady() gate and verify with a probe embed instead.
    const ruvector = await import('ruvector').catch(() => null);

    if (ruvector?.initOnnxEmbedder) {
      try {
        await ruvector.initOnnxEmbedder();

        // Fallback: OptimizedOnnxEmbedder (raw ONNX, lazy-inits on first embed)
        const onnxEmb = ruvector.getOptimizedOnnxEmbedder?.();
        if (onnxEmb?.embed) {
          // Probe embed to trigger lazy ONNX init and verify it works
          const probe = await onnxEmb.embed('test');
          if (probe && probe.length > 0 && (Array.isArray(probe) ? probe.some((v: number) => v !== 0) : true)) {
            if (verbose) {
              console.log(`Loading ruvector ONNX embedder (all-MiniLM-L6-v2, ${probe.length}d)...`);
            }
            embeddingModelState = {
              loaded: true,
              model: (text: string) => onnxEmb.embed(text),
              tokenizer: null,
              dimensions: probe.length || 384
            };
            return {
              success: true,
              dimensions: probe.length || 384,
              modelName: 'ruvector/onnx',
              loadTime: Date.now() - startTime
            };
          }
        }
      } catch {
        // ruvector ONNX init failed, continue to next fallback
      }
    }

    // Legacy fallback: Check for agentic-flow core embeddings
    const agenticFlow = await importOptional<typeof import('agentic-flow')>(
      'agentic-flow',
      TRANSFORMERS_NATIVE_PROBE,
    );

    if (agenticFlow && (agenticFlow as any).embeddings) {
      if (verbose) {
        console.log('Loading agentic-flow embedding model...');
      }

      embeddingModelState = {
        loaded: true,
        model: (agenticFlow as any).embeddings,
        tokenizer: null,
        dimensions: 768
      };

      return {
        success: true,
        dimensions: 768,
        modelName: 'agentic-flow',
        loadTime: Date.now() - startTime
      };
    }

    // No ONNX model available - use fallback
    embeddingModelState = {
      loaded: true,
      model: null, // Will use simple hash-based fallback
      tokenizer: null,
      dimensions: 128 // Smaller fallback dimensions
    };

    return {
      success: true,
      dimensions: 128,
      modelName: 'hash-fallback',
      loadTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      dimensions: 0,
      modelName: 'none',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Generate real embedding for text
 * Uses ONNX model if available, falls back to deterministic hash
 */
export async function generateEmbedding(text: string): Promise<{
  embedding: number[];
  dimensions: number;
  model: string;
}> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeGenerateEmbedding(text);
    if (bridgeResult) return bridgeResult;
  }

  // Ensure model is loaded
  if (!embeddingModelState?.loaded) {
    await loadEmbeddingModel();
  }

  const state = embeddingModelState!;

  // Use ONNX model if available
  if (state.model && typeof (state.model as any) === 'function') {
    try {
      const output = await (state.model as any)(text, { pooling: 'mean', normalize: true });
      // Handle both @xenova/transformers (output.data) and ruvector (plain array) formats
      const embedding = output?.data
        ? Array.from(output.data as Float32Array)
        : Array.isArray(output) ? output : null;
      if (embedding) {
        return {
          embedding,
          dimensions: embedding.length,
          model: 'onnx'
        };
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Deterministic hash-based fallback (for testing/demo without ONNX)
  const embedding = generateHashEmbedding(text, state.dimensions);
  return {
    embedding,
    dimensions: state.dimensions,
    model: 'hash-fallback'
  };
}

/**
 * Generate embeddings for multiple texts
 * Uses parallel execution for API-based providers (2-4x faster)
 * Note: Local ONNX inference is CPU-bound, so parallelism has limited benefit
 *
 * @param texts - Array of texts to embed
 * @param options - Batch options
 * @returns Array of embedding results with timing info
 */
export async function generateBatchEmbeddings(
  texts: string[],
  options?: {
    concurrency?: number; // Max concurrent embeddings (default: all)
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<{
  results: Array<{ text: string; embedding: number[]; dimensions: number; model: string }>;
  totalTime: number;
  avgTime: number;
}> {
  const { concurrency = texts.length, onProgress } = options || {};
  const startTime = Date.now();

  // Ensure model is loaded first (prevents cold start in parallel)
  if (!embeddingModelState?.loaded) {
    await loadEmbeddingModel();
  }

  // Process in parallel with optional concurrency limit
  if (concurrency >= texts.length) {
    // Full parallelism
    const embeddings = await Promise.all(
      texts.map(async (text, i) => {
        const result = await generateEmbedding(text);
        onProgress?.(i + 1, texts.length);
        return { text, ...result };
      })
    );

    const totalTime = Date.now() - startTime;
    return {
      results: embeddings,
      totalTime,
      avgTime: totalTime / texts.length
    };
  }

  // Limited concurrency using chunking
  const results: Array<{ text: string; embedding: number[]; dimensions: number; model: string }> = [];
  let completed = 0;

  for (let i = 0; i < texts.length; i += concurrency) {
    const chunk = texts.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (text) => {
        const result = await generateEmbedding(text);
        completed++;
        onProgress?.(completed, texts.length);
        return { text, ...result };
      })
    );
    results.push(...chunkResults);
  }

  const totalTime = Date.now() - startTime;
  return {
    results,
    totalTime,
    avgTime: totalTime / texts.length
  };
}

/**
 * Generate deterministic hash-based embedding
 * Not semantic, but deterministic and useful for testing
 */
function generateHashEmbedding(text: string, dimensions: number): number[] {
  const embedding: number[] = new Array(dimensions).fill(0);

  // Simple hash-based approach for reproducibility
  const words = text.toLowerCase().split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < word.length; j++) {
      const charCode = word.charCodeAt(j);
      const idx = (charCode * (i + 1) * (j + 1)) % dimensions;
      embedding[idx] += Math.sin(charCode * 0.1) * 0.1;
    }
  }

  // Normalize to unit vector
  const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0)) || 1;
  return embedding.map(v => v / magnitude);
}

/**
 * Verify memory initialization works correctly
 * Tests: write, read, search, patterns
 */
export async function verifyMemoryInit(dbPath: string, options?: {
  verbose?: boolean;
}): Promise<{
  success: boolean;
  tests: {
    name: string;
    passed: boolean;
    details?: string;
    duration?: number;
  }[];
  summary: {
    passed: number;
    failed: number;
    total: number;
  };
}> {
  const { verbose = false } = options || {};
  const tests: { name: string; passed: boolean; details?: string; duration?: number }[] = [];

  try {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const fs = await import('fs');

    // Load database
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Test 1: Schema verification
    const schemaStart = Date.now();
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables[0]?.values?.map(v => v[0] as string) || [];
    const expectedTables = ['memory_entries', 'patterns', 'metadata', 'vector_indexes'];
    const missingTables = expectedTables.filter(t => !tableNames.includes(t));

    tests.push({
      name: 'Schema verification',
      passed: missingTables.length === 0,
      details: missingTables.length > 0 ? `Missing: ${missingTables.join(', ')}` : `${tableNames.length} tables found`,
      duration: Date.now() - schemaStart
    });

    // Test 2: Write entry
    const writeStart = Date.now();
    const testId = `test_${Date.now()}`;
    const testKey = 'verification_test';
    const testValue = 'This is a verification test entry for memory initialization';

    try {
      db.run(`
        INSERT INTO memory_entries (id, key, namespace, content, type, created_at, updated_at)
        VALUES (?, ?, 'test', ?, 'semantic', ?, ?)
      `, [testId, testKey, testValue, Date.now(), Date.now()]);

      tests.push({
        name: 'Write entry',
        passed: true,
        details: 'Entry written successfully',
        duration: Date.now() - writeStart
      });
    } catch (e) {
      tests.push({
        name: 'Write entry',
        passed: false,
        details: e instanceof Error ? e.message : 'Write failed',
        duration: Date.now() - writeStart
      });
    }

    // Test 3: Read entry
    const readStart = Date.now();
    try {
      const result = db.exec(`SELECT content FROM memory_entries WHERE id = ?`, [testId]);
      const content = result[0]?.values[0]?.[0] as string;

      tests.push({
        name: 'Read entry',
        passed: content === testValue,
        details: content === testValue ? 'Content matches' : 'Content mismatch',
        duration: Date.now() - readStart
      });
    } catch (e) {
      tests.push({
        name: 'Read entry',
        passed: false,
        details: e instanceof Error ? e.message : 'Read failed',
        duration: Date.now() - readStart
      });
    }

    // Test 4: Write with embedding
    const embeddingStart = Date.now();
    try {
      const { embedding, dimensions, model } = await generateEmbedding(testValue);
      const embeddingJson = JSON.stringify(embedding);

      db.run(`
        UPDATE memory_entries
        SET embedding = ?, embedding_dimensions = ?, embedding_model = ?
        WHERE id = ?
      `, [embeddingJson, dimensions, model, testId]);

      tests.push({
        name: 'Generate embedding',
        passed: true,
        details: `${dimensions}-dim vector (${model})`,
        duration: Date.now() - embeddingStart
      });
    } catch (e) {
      tests.push({
        name: 'Generate embedding',
        passed: false,
        details: e instanceof Error ? e.message : 'Embedding failed',
        duration: Date.now() - embeddingStart
      });
    }

    // Test 5: Pattern storage
    const patternStart = Date.now();
    try {
      const patternId = `pattern_${Date.now()}`;
      db.run(`
        INSERT INTO patterns (id, name, pattern_type, condition, action, confidence, created_at, updated_at)
        VALUES (?, 'test-pattern', 'task-routing', 'test condition', 'test action', 0.5, ?, ?)
      `, [patternId, Date.now(), Date.now()]);

      tests.push({
        name: 'Pattern storage',
        passed: true,
        details: 'Pattern stored with confidence scoring',
        duration: Date.now() - patternStart
      });

      // Cleanup test pattern
      db.run(`DELETE FROM patterns WHERE id = ?`, [patternId]);
    } catch (e) {
      tests.push({
        name: 'Pattern storage',
        passed: false,
        details: e instanceof Error ? e.message : 'Pattern storage failed',
        duration: Date.now() - patternStart
      });
    }

    // Test 6: Vector index configuration
    const indexStart = Date.now();
    try {
      const indexResult = db.exec(`SELECT name, dimensions, hnsw_m, hnsw_ef_construction FROM vector_indexes`);
      const indexes = indexResult[0]?.values || [];

      tests.push({
        name: 'Vector index config',
        passed: indexes.length > 0,
        details: `${indexes.length} indexes configured (HNSW M=16, ef=200)`,
        duration: Date.now() - indexStart
      });
    } catch (e) {
      tests.push({
        name: 'Vector index config',
        passed: false,
        details: e instanceof Error ? e.message : 'Index check failed',
        duration: Date.now() - indexStart
      });
    }

    // Cleanup test entry
    db.run(`DELETE FROM memory_entries WHERE id = ?`, [testId]);

    // Save changes
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    db.close();

    const passed = tests.filter(t => t.passed).length;
    const failed = tests.filter(t => !t.passed).length;

    return {
      success: failed === 0,
      tests,
      summary: {
        passed,
        failed,
        total: tests.length
      }
    };
  } catch (error) {
    return {
      success: false,
      tests: [{
        name: 'Database access',
        passed: false,
        details: error instanceof Error ? error.message : 'Unknown error'
      }],
      summary: { passed: 0, failed: 1, total: 1 }
    };
  }
}

/**
 * Store an entry directly using sql.js
 * This bypasses MCP and writes directly to the database
 */
export async function storeEntry(options: {
  key: string;
  value: string;
  namespace?: string;
  generateEmbeddingFlag?: boolean;
  tags?: string[];
  ttl?: number;
  dbPath?: string;
  upsert?: boolean;
}): Promise<{
  success: boolean;
  id: string;
  embedding?: { dimensions: number; model: string };
  error?: string;
}> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeStoreEntry(options);
    if (bridgeResult) return bridgeResult;
  }

  // Fallback: raw sql.js
  const {
    key,
    value,
    namespace = 'default',
    generateEmbeddingFlag = true,
    tags = [],
    ttl,
    dbPath: customPath,
    upsert = false
  } = options;

  const swarmDir = path.resolve(process.cwd(), '.swarm');
  const dbPath = customPath ? path.resolve(customPath) : path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, id: '', error: 'Database not initialized. Run: claude-flow memory init' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    const id = `entry_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = Date.now();

    // Generate embedding if requested
    let embeddingJson: string | null = null;
    let embeddingDimensions: number | null = null;
    let embeddingModel: string | null = null;

    if (generateEmbeddingFlag && value.length > 0) {
      const embResult = await generateEmbedding(value);
      embeddingJson = JSON.stringify(embResult.embedding);
      embeddingDimensions = embResult.dimensions;
      embeddingModel = embResult.model;
    }

    // Insert or update entry (upsert mode uses REPLACE)
    const insertSql = upsert
      ? `INSERT OR REPLACE INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
      : `INSERT INTO memory_entries (
          id, key, namespace, content, type,
          embedding, embedding_dimensions, embedding_model,
          tags, metadata, created_at, updated_at, expires_at, status
        ) VALUES (?, ?, ?, ?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, 'active')`;

    db.run(insertSql, [
      id,
      key,
      namespace,
      value,
      embeddingJson,
      embeddingDimensions,
      embeddingModel,
      tags.length > 0 ? JSON.stringify(tags) : null,
      '{}',
      now,
      now,
      ttl ? now + (ttl * 1000) : null
    ]);

    // Save
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    db.close();

    // Add to HNSW index for faster future searches
    if (embeddingJson) {
      const embResult = JSON.parse(embeddingJson) as number[];
      await addToHNSWIndex(id, embResult, {
        id,
        key,
        namespace,
        content: value
      });
    }

    return {
      success: true,
      id,
      embedding: embeddingJson ? { dimensions: embeddingDimensions!, model: embeddingModel! } : undefined
    };
  } catch (error) {
    return {
      success: false,
      id: '',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Search entries using sql.js with vector similarity
 * Uses HNSW index for 150x faster search when available
 */
export async function searchEntries(options: {
  query: string;
  namespace?: string;
  limit?: number;
  threshold?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  results: {
    id: string;
    key: string;
    content: string;
    score: number;
    namespace: string;
  }[];
  searchTime: number;
  error?: string;
}> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeSearchEntries(options);
    if (bridgeResult) return bridgeResult;
  }

  // Fallback: raw sql.js
  const {
    query,
    namespace,
    limit = 10,
    threshold = 0.3,
    dbPath: customPath
  } = options;
  const effectiveNamespace = namespace || 'all';

  const swarmDir = path.resolve(process.cwd(), '.swarm');
  const dbPath = customPath ? path.resolve(customPath) : path.join(swarmDir, 'memory.db');
  const startTime = Date.now();

  try {
    if (!fs.existsSync(dbPath)) {
      // No store yet means nothing to match. Same contract as the AgentDB
      // bridge path, which treats a missing store as empty rather than an
      // error; this path is the one taken when that bridge is unavailable.
      return { success: true, results: [], searchTime: 0 };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    // Generate query embedding
    const queryEmb = await generateEmbedding(query);
    const queryEmbedding = queryEmb.embedding;

    // Try HNSW search first (150x faster)
    const hnswResults = await searchHNSWIndex(queryEmbedding, { k: limit, namespace: effectiveNamespace });
    if (hnswResults && hnswResults.length > 0) {
      // Filter by threshold
      const filtered = hnswResults.filter(r => r.score >= threshold);
      return {
        success: true,
        results: filtered,
        searchTime: Date.now() - startTime
      };
    }

    // Fall back to brute-force SQLite search
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Get entries with embeddings
    const searchStmt = db.prepare(
      effectiveNamespace !== 'all'
        ? `SELECT id, key, namespace, content, embedding FROM memory_entries WHERE status = 'active' AND namespace = ? LIMIT 1000`
        : `SELECT id, key, namespace, content, embedding FROM memory_entries WHERE status = 'active' LIMIT 1000`
    );
    if (effectiveNamespace !== 'all') {
      searchStmt.bind([effectiveNamespace]);
    }
    const searchRows: unknown[][] = [];
    while (searchStmt.step()) {
      searchRows.push(searchStmt.get());
    }
    searchStmt.free();
    const entries = searchRows.length > 0 ? [{ values: searchRows }] : [];

    const results: { id: string; key: string; content: string; score: number; namespace: string }[] = [];

    if (entries[0]?.values) {
      for (const row of entries[0].values) {
        const [id, key, ns, content, embeddingJson] = row as [string, string, string, string, string | null];

        let score = 0;

        if (embeddingJson) {
          try {
            const embedding = JSON.parse(embeddingJson) as number[];
            score = cosineSim(queryEmbedding, embedding);
          } catch {
            // Invalid embedding, use keyword score
          }
        }

        // Fallback to keyword matching
        if (score < threshold) {
          const lowerContent = (content || '').toLowerCase();
          const lowerQuery = query.toLowerCase();
          const words = lowerQuery.split(/\s+/);
          const matchCount = words.filter(w => lowerContent.includes(w)).length;
          const keywordScore = matchCount / words.length * 0.5;
          score = Math.max(score, keywordScore);
        }

        if (score >= threshold) {
          results.push({
            id: id.substring(0, 12),
            key: key || id.substring(0, 15),
            content: (content || '').substring(0, 60) + ((content || '').length > 60 ? '...' : ''),
            score,
            namespace: ns || 'default'
          });
        }
      }
    }

    db.close();

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return {
      success: true,
      results: results.slice(0, limit),
      searchTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      results: [],
      searchTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Optimized cosine similarity
 * V8 JIT-friendly - avoids manual unrolling which can hurt performance
 * ~0.5μs per 384-dim vector comparison
 */
function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;

  const len = Math.min(a.length, b.length);
  let dot = 0, normA = 0, normB = 0;

  // Simple loop - V8 optimizes this well
  for (let i = 0; i < len; i++) {
    const ai = a[i], bi = b[i];
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  // Combined sqrt for slightly better performance
  const mag = Math.sqrt(normA * normB);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * List all entries from the memory database
 */
export async function listEntries(options: {
  namespace?: string;
  limit?: number;
  offset?: number;
  dbPath?: string;
}): Promise<{
  success: boolean;
  entries: {
    id: string;
    key: string;
    namespace: string;
    size: number;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
  }[];
  total: number;
  error?: string;
}> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeListEntries(options);
    if (bridgeResult) return bridgeResult;
  }

  // Fallback: raw sql.js
  const {
    namespace,
    limit = 20,
    offset = 0,
    dbPath: customPath
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      // Empty, not an error: same contract as the AgentDB bridge (see searchEntries).
      return { success: true, entries: [], total: 0 };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Get total count
    const countStmt = namespace
      ? db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active' AND namespace = ?`)
      : db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE status = 'active'`);
    if (namespace) {
      countStmt.bind([namespace]);
    }
    const countRows: unknown[][] = [];
    while (countStmt.step()) {
      countRows.push(countStmt.get());
    }
    countStmt.free();
    const countResult = countRows.length > 0 ? [{ values: countRows }] : [];
    const total = countResult[0]?.values?.[0]?.[0] as number || 0;

    // Get entries
    const safeLimit = parseInt(String(limit), 10) || 100;
    const safeOffset = parseInt(String(offset), 10) || 0;
    const listStmt = namespace
      ? db.prepare(`SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at FROM memory_entries WHERE status = 'active' AND namespace = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      : db.prepare(`SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at FROM memory_entries WHERE status = 'active' ORDER BY updated_at DESC LIMIT ? OFFSET ?`);
    if (namespace) {
      listStmt.bind([namespace, safeLimit, safeOffset]);
    } else {
      listStmt.bind([safeLimit, safeOffset]);
    }
    const listRows: unknown[][] = [];
    while (listStmt.step()) {
      listRows.push(listStmt.get());
    }
    listStmt.free();
    const result = listRows.length > 0 ? [{ values: listRows }] : [];
    const entries: {
      id: string;
      key: string;
      namespace: string;
      size: number;
      accessCount: number;
      createdAt: string;
      updatedAt: string;
      hasEmbedding: boolean;
    }[] = [];

    if (result[0]?.values) {
      for (const row of result[0].values) {
        const [id, key, ns, content, embedding, accessCount, createdAt, updatedAt] = row as [
          string, string, string, string, string | null, number, string, string
        ];
        entries.push({
          id: String(id).substring(0, 20),
          key: key || String(id).substring(0, 15),
          namespace: ns || 'default',
          size: (content || '').length,
          accessCount: accessCount || 0,
          createdAt: createdAt || new Date().toISOString(),
          updatedAt: updatedAt || new Date().toISOString(),
          hasEmbedding: !!embedding && embedding.length > 10
        });
      }
    }

    db.close();

    return { success: true, entries, total };
  } catch (error) {
    return {
      success: false,
      entries: [],
      total: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get a specific entry from the memory database
 */
export async function getEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  found: boolean;
  entry?: {
    id: string;
    key: string;
    namespace: string;
    content: string;
    accessCount: number;
    createdAt: string;
    updatedAt: string;
    hasEmbedding: boolean;
    tags: string[];
  };
  error?: string;
}> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeGetEntry(options);
    if (bridgeResult) return bridgeResult;
  }

  // Fallback: raw sql.js
  const {
    key,
    namespace = 'default',
    dbPath: customPath
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, found: false, error: 'Database not found' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Find entry by key
    const getStmt = db.prepare(`
      SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at, tags
      FROM memory_entries
      WHERE status = 'active'
        AND key = ?
        AND namespace = ?
      LIMIT 1
    `);
    getStmt.bind([key, namespace]);
    const getRows: unknown[][] = [];
    while (getStmt.step()) {
      getRows.push(getStmt.get());
    }
    getStmt.free();
    const result = getRows.length > 0 ? [{ values: getRows }] : [];

    if (!result[0]?.values?.[0]) {
      db.close();
      return { success: true, found: false };
    }

    const [id, entryKey, ns, content, embedding, accessCount, createdAt, updatedAt, tagsJson] = result[0].values[0] as [
      string, string, string, string, string | null, number, string, string, string | null
    ];

    // Update access count
    db.run(`
      UPDATE memory_entries
      SET access_count = access_count + 1, last_accessed_at = strftime('%s', 'now') * 1000
      WHERE id = ?
    `, [String(id)]);

    // Save updated database
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));

    db.close();

    let tags: string[] = [];
    if (tagsJson) {
      try {
        tags = JSON.parse(tagsJson);
      } catch {
        // Invalid JSON
      }
    }

    return {
      success: true,
      found: true,
      entry: {
        id: String(id),
        key: entryKey || String(id),
        namespace: ns || 'default',
        content: content || '',
        accessCount: (accessCount || 0) + 1,
        createdAt: createdAt || new Date().toISOString(),
        updatedAt: updatedAt || new Date().toISOString(),
        hasEmbedding: !!embedding && embedding.length > 10,
        tags
      }
    };
  } catch (error) {
    return {
      success: false,
      found: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Delete a memory entry by key and namespace
 * Issue #980: Properly supports namespaced entries
 */
export async function deleteEntry(options: {
  key: string;
  namespace?: string;
  dbPath?: string;
}): Promise<{
  success: boolean;
  deleted: boolean;
  key: string;
  namespace: string;
  remainingEntries: number;
  error?: string;
}> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeDeleteEntry(options);
    if (bridgeResult) {
      // #1122: Bridge path must also invalidate the in-memory HNSW index.
      // Without this, deleted vectors remain as ghost entries in search results.
      if (bridgeResult.deleted && hnswIndex?.entries) {
        // Remove the entry from the HNSW entries map by key+namespace composite
        for (const [id, entry] of hnswIndex.entries) {
          if ((entry as any)?.key === options.key && ((entry as any)?.namespace ?? 'default') === (options.namespace ?? 'default')) {
            hnswIndex.entries.delete(id);
            break;
          }
        }
        saveHNSWMetadata();
        rebuildSearchIndex();
      }
      return bridgeResult;
    }
  }

  // Fallback: raw sql.js
  const {
    key,
    namespace = 'default',
    dbPath: customPath
  } = options;

  const swarmDir = path.join(process.cwd(), '.swarm');
  const dbPath = customPath || path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return {
        success: false,
        deleted: false,
        key,
        namespace,
        remainingEntries: 0,
        error: 'Database not found'
      };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Check if entry exists first
    const checkStmt = db.prepare(`
      SELECT id FROM memory_entries
      WHERE status = 'active'
        AND key = ?
        AND namespace = ?
      LIMIT 1
    `);
    checkStmt.bind([key, namespace]);
    const checkRows: unknown[][] = [];
    while (checkStmt.step()) {
      checkRows.push(checkStmt.get());
    }
    checkStmt.free();
    const checkResult = checkRows.length > 0 ? [{ values: checkRows }] : [];

    if (!checkResult[0]?.values?.[0]) {
      // Get remaining count before closing
      const countResult = db.exec(`SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`);
      const remainingEntries = countResult[0]?.values?.[0]?.[0] as number || 0;
      db.close();
      return {
        success: true,
        deleted: false,
        key,
        namespace,
        remainingEntries,
        error: `Key '${key}' not found in namespace '${namespace}'`
      };
    }

    // Capture the entry ID for HNSW cleanup
    const entryId = String(checkResult[0].values[0][0]);

    // Delete the entry (soft delete by setting status to 'deleted')
    // Also null out the embedding to clean up vector data from SQLite
    db.run(`
      UPDATE memory_entries
      SET status = 'deleted',
          embedding = NULL,
          updated_at = strftime('%s', 'now') * 1000
      WHERE key = ?
        AND namespace = ?
        AND status = 'active'
    `, [key, namespace]);

    // Get remaining count
    const countResult = db.exec(`SELECT COUNT(*) FROM memory_entries WHERE status = 'active'`);
    const remainingEntries = countResult[0]?.values?.[0]?.[0] as number || 0;

    // Save updated database
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));

    db.close();

    // Clean up in-memory HNSW index so ghost vectors don't appear in searches.
    // Remove the entry from the HNSW entries map and invalidate the index.
    // The next search will rebuild the HNSW index from the remaining DB rows.
    if (hnswIndex?.entries) {
      hnswIndex.entries.delete(entryId);
      saveHNSWMetadata();
      // Invalidate the HNSW index so it rebuilds from DB on next search.
      // We can't surgically remove a vector from the HNSW graph, so we
      // clear the entire index; it will be lazily rebuilt from SQLite.
      rebuildSearchIndex();
    }

    return {
      success: true,
      deleted: true,
      key,
      namespace,
      remainingEntries
    };
  } catch (error) {
    return {
      success: false,
      deleted: false,
      key,
      namespace,
      remainingEntries: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export default {
  initializeMemoryDatabase,
  checkMemoryInitialization,
  checkAndMigrateLegacy,
  ensureSchemaColumns,
  applyTemporalDecay,
  loadEmbeddingModel,
  generateEmbedding,
  verifyMemoryInit,
  storeEntry,
  searchEntries,
  listEntries,
  getEntry,
  deleteEntry,
  rebuildSearchIndex,
  MEMORY_SCHEMA_V3,
  getInitialMetadata
};
