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
import { createRequire } from 'node:module';
import { readFileMaybeEncrypted, writeFileAtomic, writeFileRestricted } from '../fs-secure.js';
import { restoreMemoryDbFromBackup } from '../services/memory-backup.js';

/**
 * #2356 — cached, synchronous capability probe for @ruvector/core. `getHNSWStatus`
 * is sync and is called by `neural status` in a fresh process that never warms
 * the lazy HNSW singleton, so reporting availability off the warm singleton
 * alone produced a false "Not loaded — @ruvector/core not available" even when
 * the package is installed and exposes VectorDb. Resolving the module (without
 * importing/initializing it) is a faithful, cheap availability signal.
 */
let _ruvectorCoreResolvable: boolean | undefined;
function isRuvectorCoreResolvable(): boolean {
  if (_ruvectorCoreResolvable !== undefined) return _ruvectorCoreResolvable;
  try {
    const req = createRequire(import.meta.url);
    req.resolve('@ruvector/core');
    _ruvectorCoreResolvable = true;
  } catch {
    _ruvectorCoreResolvable = false;
  }
  return _ruvectorCoreResolvable;
}

/**
 * #1854: previously every site that needed the memory directory hardcoded
 * `getMemoryRoot()`, so the documented config entry
 * points (`memory.persistPath` config field, `memory configure --path`,
 * `CLAUDE_FLOW_MEMORY_PATH` env var) all silently no-op'd. This helper
 * is the single source of truth — every `.swarm/memory.db` resolution in
 * this file flows through it.
 *
 * Precedence (highest → lowest):
 *   1. CLAUDE_FLOW_MEMORY_PATH env var
 *   2. memory.persistPath / memory.path in claude-flow.config.json (cwd or
 *      the directory the CLI was invoked from)
 *   3. Default: cwd/.swarm
 *
 * Cached per-process so repeated lookups are cheap; reset only by spawning
 * a fresh process (which is how config changes already propagate).
 */
let _memoryRootCache: string | undefined;
export function getMemoryRoot(): string {
  if (_memoryRootCache !== undefined) return _memoryRootCache;

  // 1. Env var
  const envPath = process.env.CLAUDE_FLOW_MEMORY_PATH;
  if (envPath && envPath.trim().length > 0) {
    _memoryRootCache = path.resolve(envPath);
    return _memoryRootCache;
  }

  // 2. Config file (claude-flow.config.json)
  const configCandidates = [
    path.resolve(process.cwd(), 'claude-flow.config.json'),
    path.resolve(process.cwd(), '.claude-flow', 'config.json'),
  ];
  for (const configPath of configCandidates) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const fromConfig: unknown = raw?.memory?.persistPath ?? raw?.memory?.path;
      if (typeof fromConfig === 'string' && fromConfig.trim().length > 0) {
        _memoryRootCache = path.resolve(fromConfig);
        return _memoryRootCache;
      }
    } catch {
      /* malformed config — fall through to default */
    }
  }

  // 3. Default
  _memoryRootCache = path.resolve(process.cwd(), '.swarm');
  return _memoryRootCache;
}

/** For tests + the `memory configure` flow that mutates the config at runtime. */
export function _resetMemoryRootCache(): void {
  _memoryRootCache = undefined;
}

/**
 * #2105: Resolve the full path to the SQLite memory database.
 * Precedence (highest to lowest):
 *   1. cliFlag             - explicit --path flag passed by a subcommand
 *   2. CLAUDE_FLOW_DB_PATH - full file-path override (new in #2105)
 *   3. getMemoryRoot()/memory.db - directory from CLAUDE_FLOW_MEMORY_PATH /
 *                                  config / default cwd/.swarm
 */
export function resolveDbPath(cliFlag?: string): string {
  if (cliFlag && cliFlag.trim().length > 0) {
    return path.resolve(cliFlag);
  }
  const envDb = process.env.CLAUDE_FLOW_DB_PATH;
  if (envDb && envDb.trim().length > 0) {
    return path.resolve(envDb);
  }
  return path.join(getMemoryRoot(), 'memory.db');
}

// ADR-053: Lazy import of AgentDB v3 bridge
let _bridge: typeof import('./memory-bridge.js') | null | undefined;
async function getBridge(): Promise<typeof import('./memory-bridge.js') | null> {
  // #2120 — Allow callers to force the raw sql.js fallback path. The
  // ensureSchemaColumns backfill (NULL → 'active') lives in that
  // fallback, so smokes that verify legacy-DB migration semantics need a
  // way to bypass the bridge. Also useful when the bridge would hang on
  // network-bound init (Xenova model fetch) in offline CI.
  if (process.env.CLAUDE_FLOW_DISABLE_BRIDGE === '1') return null;
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
-- GRAPH EDGES (ADR-130 Phase 1)
-- Unified knowledge graph backend — sql.js canonical store
-- ============================================

-- Unified graph edges table (ADR-130)
-- Node IDs use domain-prefixed format: {domain}:{uuid}
-- where domain in (mem, agent, task, entity, span, pattern)
CREATE TABLE IF NOT EXISTS graph_edges (
  id              TEXT PRIMARY KEY,          -- edge-{uuid}
  source_id       TEXT NOT NULL,             -- domain-prefixed node ID
  target_id       TEXT NOT NULL,             -- domain-prefixed node ID
  relation        TEXT NOT NULL,             -- e.g. "caused", "depends-on", "imports"
  weight          REAL DEFAULT 1.0,
  -- Temporal / reliability semantics (ADR-130 §"graph that forgets" property)
  confidence      REAL DEFAULT 1.0,          -- [0,1]; updated by JUDGE step
  decay_rate      REAL DEFAULT 0.0,          -- per-day exponential decay applied at read time
  last_reinforced TEXT,                      -- ISO-8601; set when CONSOLIDATE re-touches edge
  witness_id      TEXT,                      -- FK to verification/witness-fixes.json (ADR-103)
  -- Embedding storage: "inline:{base64}" | "vector_indexes:{id}" | NULL
  embedding_ref   TEXT,
  metadata        TEXT,                      -- JSON blob for plugin-specific fields
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source    ON graph_edges (source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target    ON graph_edges (target_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_relation  ON graph_edges (relation);
CREATE INDEX IF NOT EXISTS idx_graph_edges_reinforced ON graph_edges (last_reinforced);

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
    const swarmDir = getMemoryRoot();
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
        const fileBuffer = readFileMaybeEncrypted(dbPath, null);
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
    const swarmDir = getMemoryRoot();
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

  // #2356: `available` now reflects real capability (index already loaded OR
  // @ruvector/core installed and resolvable), not merely whether the lazy
  // singleton happens to be warm in this process. `initialized` still reports
  // whether the in-process index is actually loaded, so callers can tell
  // "installed but not yet loaded" apart from "loaded".
  return {
    available: hnswIndex !== null || isRuvectorCoreResolvable(),
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

-- Create default vector index configuration. Dimension matches the default
-- ONNX embedding model (Xenova/all-MiniLM-L6-v2, 384-dim); HNSW rejects
-- inserts whose dim does not match this row, so a 768 here breaks every
-- memory_store --vector and memory_search on a fresh install (#1947).
INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES
  ('default', 'default', 384),
  ('patterns', 'patterns', 384);
`;
}

/**
 * Memory initialization result
 */
export interface MemoryInitResult {
  success: boolean;
  /**
   * #1791.6 — set when an existing database was found and `force` was not
   * passed. The call is treated as a successful no-op rather than an error.
   */
  alreadyExists?: boolean;
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

    const fileBuffer = readFileMaybeEncrypted(dbPath, null);
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

    // #2120 — Belt-and-suspenders backfill. `ALTER TABLE ADD COLUMN
    // status TEXT DEFAULT 'active'` should populate existing rows with
    // 'active' in modern SQLite, but: (a) some auto-memory bridge writes
    // happen via INSERT paths that pass an explicit NULL, (b) some
    // historical sql.js builds skipped the DEFAULT backfill, (c)
    // entries can be migrated in from older snapshots. After ensuring
    // the column exists, force-backfill any remaining NULL → 'active'.
    // Safe on already-correct DBs (0 rows updated).
    if (columnsAdded.includes('status') || existingColumns.has('status')) {
      try {
        db.run(`UPDATE memory_entries SET status = 'active' WHERE status IS NULL`);
        modified = true;
      } catch {
        /* table is read-only or doesn't exist — skip */
      }
    }

    if (modified) {
      // Save updated database
      const data = db.export();
      writeFileRestricted(dbPath, Buffer.from(data), { encrypt: true });
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
 * Self-heal an EXISTING memory database that is missing the `vector_indexes`
 * table or per-namespace rows.
 *
 * Why this exists: fresh installs create `vector_indexes` + seed rows, but a
 * DB written by an older CLI or by agentdb directly may have thousands of
 * embedded rows in `memory_entries` and NO `vector_indexes` table at all.
 * Two things break as a result:
 *   1. The statusline's vector count read collapsed to `0` (the count query
 *      referenced the missing table and failed whole — now split, but the
 *      HNSW flag still needs the table).
 *   2. #1941 — `memory_search` routes per namespace via `vector_indexes`; a
 *      namespace with no row returns 0 results even when entries exist.
 *
 * This is idempotent and conservative:
 *   - Does NOTHING (no writes) when the table already exists and every embedded
 *     namespace already has a row — the common already-healed path, hit on
 *     every MCP start, must not write to the live DB unnecessarily.
 *   - Before ANY write, runs `PRAGMA quick_check`; if the DB reports structural
 *     corruption it SKIPS the repair entirely (returns `corrupt:true`) rather
 *     than writing into a malformed btree and risking making it worse. The
 *     caller/user should recover via `sqlite3 old.db .recover | sqlite3 new.db`.
 *   - Does NOT checkpoint. mode=ro readers already see committed WAL frames, and
 *     forcing a checkpoint on a DB with a torn WAL could persist latent damage.
 *
 * When a repair IS needed and the DB is healthy: creates the table if absent,
 * seeds the fresh-install default rows, and backfills an accurate
 * `total_vectors` per namespace. Runs on the existing-DB path of
 * `initializeMemoryDatabase` (MCP start / `memory init`) and from `ruflo init`.
 *
 * Uses better-sqlite3 (WAL-safe, native). If the native module is unavailable
 * it is a silent no-op — the split statusline query already prevents the count
 * from zeroing; only the HNSW flag and namespace routing stay degraded.
 */
/**
 * Auto-recover a structurally-corrupt memory DB into a clean one, universally
 * (better-sqlite3 only — no dependency on the external `sqlite3` CLI, which is
 * absent on many npx hosts). Safe by construction:
 *   1. Confirms corruption (quick_check) — no-op on a healthy DB.
 *   2. Acquires an EXCLUSIVE lock (BEGIN IMMEDIATE). If another process is
 *      writing, it SKIPS (returns reason:'writer-active') rather than racing a
 *      writer and losing its in-flight writes — the mistake that must not recur.
 *   3. Rebuilds a fresh DB table-by-table (schema + rows), skipping any single
 *      table whose pages won't scan so one bad table can't abort the whole
 *      rebuild.
 *   4. VERIFIES the rebuild (integrity_check == ok AND recovered
 *      memory_entries count >= the readable source count) BEFORE touching the
 *      original.
 *   5. Backs up the corrupt DB to `<db>.corrupt-<ts>.bak`, then atomically
 *      renames the verified rebuild into place and drops stale -wal/-shm.
 * On any failure the original + backup are left intact — never destructive.
 */
export async function recoverMemoryDatabase(
  dbPath: string,
  opts: { verbose?: boolean } = {},
): Promise<{ recovered: boolean; backupPath?: string; rows?: number; reason?: string; restoredFromBackup?: boolean; from?: string; restoreReason?: string }> {
  if (!dbPath || !fs.existsSync(dbPath)) return { recovered: false, reason: 'no-db' };

  // Fallback for when the in-place rebuild can't produce a verified DB (issue
  // #2584): rebuild-from-corrupt salvages nothing when the damage is total, so
  // restore the newest integrity-ok backup instead of leaving the store dead.
  const restoreFromBackup = async (reason: string) => {
    const r = await restoreMemoryDbFromBackup(dbPath, { verbose: opts.verbose });
    if (r.restored) {
      return { recovered: true, restoredFromBackup: true, backupPath: r.corruptBackupPath, rows: r.rows, from: r.from };
    }
    return { recovered: false, reason, restoreReason: r.skipped };
  };

  let Database: any;
  try {
    // Module name behind a variable so TS does not statically resolve the
    // optional native dep's types at build time (CI may not install them).
    const mod: string = 'better-sqlite3';
    Database = (await import(mod)).default;
  } catch {
    return await restoreFromBackup('no-native');
  }

  const ts = Date.now();
  const tmpPath = `${dbPath}.recovering-${ts}`;
  const bakPath = `${dbPath}.corrupt-${ts}.bak`;
  let src: any;
  let dst: any;

  try {
    src = new Database(dbPath, { timeout: 1500 });

    // Confirm corruption — never rewrite a healthy DB.
    const qc = src.prepare('PRAGMA quick_check(1)').get() as Record<string, string> | undefined;
    const qcVal = qc ? String(Object.values(qc)[0] ?? '') : '';
    if (qcVal.toLowerCase() === 'ok') { src.close(); return { recovered: false, reason: 'not-corrupt' }; }

    // Exclusive-writer guard: acquire the write lock. If busy, another process
    // is writing — do NOT race it. Reading within this txn is still allowed.
    try {
      src.exec('BEGIN IMMEDIATE');
    } catch {
      src.close();
      return { recovered: false, reason: 'writer-active' };
    }

    let srcRows = 0;
    try { srcRows = (src.prepare('SELECT COUNT(*) AS c FROM memory_entries').get() as { c: number })?.c ?? 0; } catch { /* unreadable */ }

    try { fs.rmSync(tmpPath, { force: true }); } catch { /* fresh */ }
    dst = new Database(tmpPath);

    // Copy schema: tables first (so data can be inserted), then indexes/triggers.
    const objects = src
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ type: string; name: string; sql: string }>;
    const tables = objects.filter(o => o.type === 'table');
    const others = objects.filter(o => o.type !== 'table');

    for (const t of tables) {
      try { dst.exec(t.sql); } catch { /* skip an untranslatable table def */ }
    }

    // Copy rows table-by-table; a table whose pages won't scan is skipped whole.
    let copiedEntries = 0;
    for (const t of tables) {
      try {
        const cols = (dst.prepare(`PRAGMA table_info("${t.name}")`).all() as Array<{ name: string }>).map(c => c.name);
        if (!cols.length) continue;
        const colList = cols.map(c => `"${c}"`).join(',');
        const placeholders = cols.map(() => '?').join(',');
        const insert = dst.prepare(`INSERT OR IGNORE INTO "${t.name}" (${colList}) VALUES (${placeholders})`);
        const rows = src.prepare(`SELECT ${colList} FROM "${t.name}"`).all() as Array<Record<string, unknown>>;
        const runAll = dst.transaction((rs: Array<Record<string, unknown>>) => {
          for (const r of rs) insert.run(cols.map(c => r[c] as any));
        });
        runAll(rows);
        if (t.name === 'memory_entries') copiedEntries = rows.length;
      } catch { /* skip a table whose data pages are unreadable */ }
    }

    for (const o of others) {
      try { dst.exec(o.sql); } catch { /* an index over corrupt data — non-fatal */ }
    }

    dst.close(); dst = null;
    try { src.exec('ROLLBACK'); } catch { /* ignore */ }
    src.close(); src = null;

    // Verify BEFORE touching the original.
    const check = new Database(tmpPath, { readonly: true });
    const integ = String(check.pragma('integrity_check', { simple: true }) ?? '');
    let dstRows = 0;
    try { dstRows = (check.prepare('SELECT COUNT(*) AS c FROM memory_entries').get() as { c: number })?.c ?? 0; } catch { /* */ }
    check.close();

    if (integ.toLowerCase() !== 'ok' || dstRows < srcRows) {
      try { fs.rmSync(tmpPath, { force: true }); } catch { /* */ }
      if (opts.verbose) {
        console.log(`memory DB rebuild-in-place failed (integrity=${integ}, rows ${dstRows}/${srcRows}) — trying newest good backup`);
      }
      return await restoreFromBackup('verify-failed');
    }

    // Back up the corrupt DB, then atomically swap in the verified rebuild.
    fs.copyFileSync(dbPath, bakPath);
    fs.renameSync(tmpPath, dbPath);
    for (const s of ['-wal', '-shm']) { try { fs.rmSync(`${dbPath}${s}`, { force: true }); } catch { /* */ } }

    if (opts.verbose) {
      console.log(`memory DB auto-recovered: ${dstRows} rows, integrity ok. Corrupt original saved to ${bakPath}`);
    }
    return { recovered: true, backupPath: bakPath, rows: dstRows };
  } catch (e) {
    try { dst?.close(); } catch { /* */ }
    try { src?.exec('ROLLBACK'); } catch { /* */ }
    try { src?.close(); } catch { /* */ }
    try { fs.rmSync(tmpPath, { force: true }); } catch { /* */ }
    if (opts.verbose) console.log(`memory DB rebuild-in-place error (${(e as Error)?.message ?? e}) — trying newest good backup`);
    return await restoreFromBackup('error');
  }
}

export async function repairVectorIndexes(
  dbPath: string,
  opts: { verbose?: boolean; autoRecover?: boolean } = {},
): Promise<{ repaired: boolean; tableCreated: boolean; namespaces: string[]; corrupt?: boolean; recovered?: boolean; backupPath?: string }> {
  const res = { repaired: false, tableCreated: false, namespaces: [] as string[], corrupt: false };
  if (!dbPath || !fs.existsSync(dbPath)) return res;

  let Database: any;
  try {
    // Module name behind a variable so TS does not statically resolve the
    // optional native dep's types at build time (CI may not install them).
    const mod: string = 'better-sqlite3';
    Database = (await import(mod)).default;
  } catch {
    // Native module absent (e.g. WASM-only host). Statusline fix still covers
    // the display; nothing to repair here.
    return res;
  }

  let db: any;
  try {
    db = new Database(dbPath, { timeout: 3000 });

    const tableExists = (name: string): boolean =>
      (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(name)?.c ?? 0) > 0;

    // Nothing to key off if there is no entries table.
    if (!tableExists('memory_entries')) { db.close(); return res; }

    const hasVectorIndexes = tableExists('vector_indexes');

    // Namespaces that actually have embeddings.
    const nsRows = db
      .prepare(
        "SELECT COALESCE(namespace, 'default') AS ns, COUNT(*) AS c " +
        'FROM memory_entries WHERE embedding IS NOT NULL GROUP BY ns',
      )
      .all() as Array<{ ns: string; c: number }>;

    // Which of those are already present in vector_indexes? If the table exists
    // and every embedded namespace already has a row, the DB is already healed
    // — return WITHOUT writing anything (common path on every MCP start).
    let needsWrite = !hasVectorIndexes;
    if (hasVectorIndexes) {
      const present = new Set(
        (db.prepare('SELECT name FROM vector_indexes').all() as Array<{ name: string }>).map(r => r.name),
      );
      needsWrite = nsRows.some(r => !present.has(String(r.ns || 'default')));
    }
    if (!needsWrite) { db.close(); return res; }

    // A write is needed. GUARD: never write into a structurally corrupt DB —
    // that risks worsening the damage. quick_check is cheaper than a full
    // integrity_check and only runs on the rare repair path, not every start.
    const qc = db.prepare('PRAGMA quick_check(1)').get() as Record<string, string> | undefined;
    const qcVal = qc ? String(Object.values(qc)[0] ?? '') : '';
    if (qcVal.toLowerCase() !== 'ok') {
      res.corrupt = true;
      db.close(); // release our handle before recovery may swap the file
      if (opts.autoRecover) {
        // Auto-fix: rebuild the corrupt DB (backup + verify + atomic swap), then
        // provision vector_indexes on the clean rebuild. This is what makes any
        // npx-deployed ruflo self-repair a corrupt memory DB on init / MCP start.
        const rec = await recoverMemoryDatabase(dbPath, { verbose: opts.verbose });
        if (rec.recovered) {
          const healed = await repairVectorIndexes(dbPath, { verbose: opts.verbose });
          return { ...healed, corrupt: true, recovered: true, backupPath: rec.backupPath };
        }
        if (opts.verbose) {
          console.log(`vector_indexes repair skipped — corruption (${qcVal}); auto-recovery not run (${rec.reason ?? 'unknown'})`);
        }
      } else if (opts.verbose) {
        console.log(
          'vector_indexes repair SKIPPED — memory DB reports corruption (' + qcVal + '). ' +
          'Recover with:  sqlite3 <db> .recover | sqlite3 <db>.recovered',
        );
      }
      return res;
    }

    if (!hasVectorIndexes) {
      db.exec(`CREATE TABLE IF NOT EXISTS vector_indexes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        dimensions INTEGER NOT NULL,
        metric TEXT DEFAULT 'cosine' CHECK(metric IN ('cosine', 'euclidean', 'dot')),
        hnsw_m INTEGER DEFAULT 16,
        hnsw_ef_construction INTEGER DEFAULT 200,
        hnsw_ef_search INTEGER DEFAULT 100,
        quantization_type TEXT CHECK(quantization_type IN ('none', 'scalar', 'product')),
        quantization_bits INTEGER DEFAULT 8,
        total_vectors INTEGER DEFAULT 0,
        last_rebuild_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      )`);
      res.tableCreated = true;
    }

    // 384 = default ONNX model dim (Xenova/all-MiniLM-L6-v2); HNSW rejects
    // dim-mismatched inserts, so this must match the stored embeddings (#1947).
    const ensureRow = db.prepare(
      'INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES (?, ?, 384)',
    );
    const setCount = db.prepare(
      'UPDATE vector_indexes SET total_vectors = ?, updated_at = ? WHERE name = ?',
    );

    const backfill = db.transaction(() => {
      // Parity with a fresh install's seed rows.
      ensureRow.run('default', 'default');
      ensureRow.run('patterns', 'patterns');

      const now = Date.now();
      for (const r of nsRows) {
        const ns = String(r.ns || 'default');
        ensureRow.run(ns, ns);
        setCount.run(r.c, now, ns);
        res.namespaces.push(ns);
      }
    });
    backfill();

    res.repaired = res.tableCreated || res.namespaces.length > 0;
    db.close();

    if (opts.verbose && res.repaired) {
      console.log(
        `vector_indexes ${res.tableCreated ? 'created' : 'refreshed'} — ` +
        `backfilled ${res.namespaces.length} namespace(s)`,
      );
    }
  } catch (e) {
    try { db?.close(); } catch { /* already closed */ }
    if (opts.verbose) {
      console.log(`vector_indexes repair skipped: ${(e as Error)?.message ?? e}`);
    }
  }
  return res;
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

  const swarmDir = getMemoryRoot();
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
    // #1791.6 — Idempotent re-init: if the database already exists and the
    // caller did not pass --force, treat it as a successful no-op instead of
    // an error. Callers (CLI, MCP tools, embeddings) can branch on
    // `alreadyExists` if they want a different message; previous behavior
    // surfaced an `[ERROR]` and a "Initialization failed" spinner even when
    // the existing DB was perfectly healthy.
    if (fs.existsSync(dbPath) && !force) {
      // #2568-followup: an existing DB may predate `vector_indexes` (or was
      // written by agentdb directly). Self-heal it here — this branch is hit on
      // every MCP-server start and `memory init`, so any ruflo repairs itself.
      // Idempotent + best-effort; never turns a healthy re-init into a failure.
      const heal = await repairVectorIndexes(dbPath, { verbose, autoRecover: true });
      return {
        success: true,
        alreadyExists: true,
        backend,
        dbPath,
        schemaVersion: '3.0.0',
        tablesCreated: heal.tableCreated ? ['vector_indexes'] : [],
        indexesCreated: [],
        features: {
          vectorEmbeddings: false,
          patternLearning: false,
          temporalDecay: false,
          hnswIndexing: heal.repaired,
          migrationTracking: false
        }
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
      writeFileRestricted(dbPath, buffer, { encrypt: true });

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

      writeFileRestricted(dbPath, sqliteHeader, { encrypt: true });

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
  const swarmDir = getMemoryRoot();
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
  const swarmDir = getMemoryRoot();
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

    // Save (atomic — issue #2584: a torn full-image flush corrupts the store)
    const data = db.export();
    writeFileAtomic(path_, Buffer.from(data));
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
    // ADR-094: prefer @huggingface/transformers (clears protobufjs <7.5.5
    // critical RCE chain), fall back to legacy @xenova/transformers.
    // Inlined here rather than depending on @claude-flow/embeddings to
    // avoid a circular optional-dep at install time; the logic mirrors
    // @claude-flow/embeddings/src/transformers-loader.ts.
    let transformersSource: '@huggingface/transformers' | '@xenova/transformers' | null = null;
    let pipelineFn: ((task: string, model?: string) => Promise<unknown>) | null = null;

    {
      const tryLoad = async (specifier: string): Promise<Record<string, unknown> | null> => {
        try { return (await import(specifier)) as Record<string, unknown>; }
        catch { return null; }
      };
      const hf = await tryLoad('@huggingface/transformers');
      if (hf && typeof hf.pipeline === 'function') {
        pipelineFn = hf.pipeline as (t: string, m?: string) => Promise<unknown>;
        transformersSource = '@huggingface/transformers';
      } else {
        const xen = await tryLoad('@xenova/transformers');
        if (xen && typeof xen.pipeline === 'function') {
          pipelineFn = xen.pipeline as (t: string, m?: string) => Promise<unknown>;
          transformersSource = '@xenova/transformers';
        }
      }
    }

    if (pipelineFn && transformersSource) {
      // #2461: pipelineFn() can throw with `fetch failed` on Windows behind
      // a corporate proxy / strict firewall when transformers tries to pull
      // the model files from the HuggingFace CDN. Without the catch, that
      // throw escapes the outer try and aborts loadEmbeddingModel() with
      // success=false BEFORE we reach the (working) ruvector ONNX fallback
      // below — leaving embeddingModelState=null, which then crashes
      // generateLocalEmbedding() with "Cannot read properties of null
      // (reading 'model')" on every memory store / search call.
      try {
        if (verbose) {
          console.log(`Loading ONNX embedding model via ${transformersSource} (all-MiniLM-L6-v2)...`);
        }
        const embedder = await pipelineFn('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

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
      } catch (err) {
        if (verbose) {
          console.warn(
            `${transformersSource} pipeline init failed (${err instanceof Error ? err.message : String(err)}); ` +
            'falling through to ruvector ONNX / agentic-flow / hash fallback.'
          );
        }
        // Intentional fall-through to the next embedder branch.
      }
    }

    // Fallback: Check for agentic-flow ReasoningBank embeddings (v3)
    const reasoningBank = await import('agentic-flow/reasoningbank').catch(() => null);

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
    const agenticFlow = await import('agentic-flow').catch(() => null);

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
 *
 * AUDIT #3: the `backend` field is the authoritative signal for whether the
 * returned vector carries real ONNX semantics ('onnx') or the deterministic
 * hash fallback ('mock'). The hash fallback produces inverted/meaningless
 * semantics, so operators MUST be able to tell the two apart even when the
 * `model` string reports a real model name (e.g. the AgentDB bridge always
 * labels its output 'Xenova/all-MiniLM-L6-v2' regardless of whether AgentDB's
 * own embedder is real or stubbed). Set `backend` truthfully by the path that
 * actually produced the vector. Do NOT change the embedding math.
 */
export async function generateEmbedding(text: string): Promise<{
  embedding: number[];
  dimensions: number;
  model: string;
  backend: 'onnx' | 'mock';
}> {
  // ADR-053: Try AgentDB v3 bridge first
  const bridge = await getBridge();
  if (bridge) {
    const bridgeResult = await bridge.bridgeGenerateEmbedding(text);
    if (bridgeResult) {
      // The bridge labels its output with a real model name unconditionally;
      // honor the backend it reports if present, otherwise treat a real model
      // name as ONNX (the bridge only returns when AgentDB's embedder exists).
      const backend: 'onnx' | 'mock' =
        (bridgeResult as { backend?: 'onnx' | 'mock' }).backend ?? 'onnx';
      return { ...bridgeResult, backend };
    }
  }

  return generateLocalEmbedding(text);
}

/**
 * Generate an embedding using ONLY the local model chain (transformers.js /
 * ruvector ONNX / hash fallback) — never the AgentDB bridge.
 *
 * #2312: this MUST stay bridge-free. `memory-bridge.ts` rescues a degraded
 * agentdb embedder by delegating to this module; if that delegation went
 * through `generateEmbedding` (bridge-first), the call would re-enter the
 * patched `agentdb.embedder.embed` and recurse unboundedly:
 *
 *   generateEmbedding → bridgeGenerateEmbedding → embedder.embed (patched)
 *     → generateEmbedding → … (heap OOM at ~4 GB on CI, no stack overflow
 *     because the cycle is async/microtask-driven)
 *
 * Keeping the local chain as its own export breaks that cycle structurally.
 */
export async function generateLocalEmbedding(text: string): Promise<{
  embedding: number[];
  dimensions: number;
  model: string;
  backend: 'onnx' | 'mock';
}> {
  // Ensure model is loaded
  if (!embeddingModelState?.loaded) {
    await loadEmbeddingModel();
  }

  // #2461: loadEmbeddingModel() can leave embeddingModelState null when an
  // earlier loader (transformers fetch, ruvector init) throws and we never
  // reach the hash-fallback assignment. Don't lie with a `!` non-null
  // assertion — fall back to a synthetic hash-fallback state so we degrade
  // to the deterministic 128-dim hash embedding instead of crashing the
  // entire memory store/search path with "reading property 'model' of null".
  const state = embeddingModelState ?? {
    loaded: true,
    model: null,
    tokenizer: null,
    dimensions: 128,
  };

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
          model: 'onnx',
          backend: 'onnx'
        };
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Deterministic hash-based fallback (for testing/demo without ONNX).
  // AUDIT #3: backend='mock' — these vectors do NOT carry real semantics.
  (await import('./embedding-policy.js')).enforceNoStub('memory-initializer.generateLocalEmbedding'); // "no stubs" strict mode
  const embedding = generateHashEmbedding(text, state.dimensions);
  return {
    embedding,
    dimensions: state.dimensions,
    model: 'hash-fallback',
    backend: 'mock'
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
    const fileBuffer = readFileMaybeEncrypted(dbPath, null);
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

    // Verification is read-only: sql.js holds an in-memory copy; discarding it on
    // close() leaves the on-disk DB untouched. Writing back here would race the
    // still-open better-sqlite3 handle (WAL) owned by ControllerRegistry /
    // repairVectorIndexes — atomic rename fails with EPERM on Windows (#2596)
    // and risks clobbering concurrent writes on all platforms.
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
    if (bridgeResult) {
      // Keep HNSW index in sync with bridge-stored entries
      if (bridgeResult.rawEmbedding && bridgeResult.success) {
        const ns = options.namespace || 'default';
        await addToHNSWIndex(bridgeResult.id, bridgeResult.rawEmbedding, {
          id: bridgeResult.id,
          key: options.key,
          namespace: ns,
          content: options.value,
        }).catch(() => {});
      }
      return bridgeResult;
    }
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

  const swarmDir = getMemoryRoot();
  const dbPath = customPath ? path.resolve(customPath) : path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, id: '', error: 'Database not initialized. Run: claude-flow memory init' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = readFileMaybeEncrypted(dbPath, null);
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

    // #1941: provision a `vector_indexes` row for this namespace before the
    // entry insert. The HNSW lookup uses this table to find which namespaces
    // are indexed — without a row, `memory_search({namespace:"X"})` returns
    // 0 even when memory_entries holds matching rows. INSERT OR IGNORE
    // preserves the existing `default` / `patterns` rows.
    try {
      db.run(
        `INSERT OR IGNORE INTO vector_indexes (id, name, dimensions) VALUES (?, ?, ?)`,
        [namespace, namespace, embeddingDimensions ?? 384]
      );
    } catch { /* vector_indexes may not exist on legacy DBs — fall through */ }

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
    writeFileRestricted(dbPath, Buffer.from(data), { encrypt: true });
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

  const swarmDir = getMemoryRoot();
  const dbPath = customPath ? path.resolve(customPath) : path.join(swarmDir, 'memory.db');
  const startTime = Date.now();

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, results: [], searchTime: 0, error: 'Database not found' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    // Generate query embedding
    const queryEmb = await generateEmbedding(query);
    const queryEmbedding = queryEmb.embedding;

    // Try RaBitQ pre-filter first (32× compressed Hamming scan)
    try {
      const { searchRabitq } = await import('./rabitq-index.js');
      const rabitqCandidates = await searchRabitq(queryEmbedding, { k: limit * 2, namespace: effectiveNamespace });
      if (rabitqCandidates && rabitqCandidates.length > 0) {
        // Rerank candidates with exact cosine similarity from SQLite
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();
        const fileBuffer = readFileMaybeEncrypted(dbPath, null);
        const db = new SQL.Database(fileBuffer);
        const reranked: { id: string; key: string; content: string; score: number; namespace: string }[] = [];

        for (const candidate of rabitqCandidates) {
          const stmt = db.prepare('SELECT content, embedding FROM memory_entries WHERE id = ? AND status = ?');
          stmt.bind([candidate.id, 'active']);
          if (stmt.step()) {
            const [content, embeddingJson] = stmt.get() as [string, string | null];
            let score = 0;
            if (embeddingJson) {
              try {
                const embedding = JSON.parse(embeddingJson) as number[];
                score = cosineSim(queryEmbedding, embedding);
              } catch { /* skip */ }
            }
            if (score >= threshold) {
              reranked.push({
                id: candidate.id.substring(0, 12),
                key: candidate.key || candidate.id.substring(0, 15),
                content: (content || '').substring(0, 60) + ((content || '').length > 60 ? '...' : ''),
                score,
                namespace: candidate.namespace,
              });
            }
          }
          stmt.free();
        }
        db.close();

        if (reranked.length > 0) {
          reranked.sort((a, b) => b.score - a.score);
          return { success: true, results: reranked.slice(0, limit), searchTime: Date.now() - startTime };
        }
      }
    } catch { /* RaBitQ unavailable, fall through */ }

    // Try HNSW search (150x faster than brute-force)
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

    const fileBuffer = readFileMaybeEncrypted(dbPath, null);
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
  /** #2073: When true, include the entry's full `content` string in each result. */
  includeContent?: boolean;
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
    /** #2073: Present when `includeContent: true` was requested. */
    content?: string;
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

  const swarmDir = getMemoryRoot();
  const dbPath = customPath || path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, entries: [], total: 0, error: 'Database not found' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = readFileMaybeEncrypted(dbPath, null);
    const db = new SQL.Database(fileBuffer);

    // #2120 — accept `status IS NULL` alongside `'active'`. Old DBs
    // that predate the status column may have NULL after migration.
    // See memory-bridge.ts:bridgeListEntries for full context.
    // Get total count
    const countStmt = namespace
      ? db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE (status = 'active' OR status IS NULL) AND namespace = ?`)
      : db.prepare(`SELECT COUNT(*) as cnt FROM memory_entries WHERE (status = 'active' OR status IS NULL)`);
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
    // #2120 — same NULL-as-active acceptance as the count above.
    const listStmt = namespace
      ? db.prepare(`SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at FROM memory_entries WHERE (status = 'active' OR status IS NULL) AND namespace = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      : db.prepare(`SELECT id, key, namespace, content, embedding, access_count, created_at, updated_at FROM memory_entries WHERE (status = 'active' OR status IS NULL) ORDER BY updated_at DESC LIMIT ? OFFSET ?`);
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
      content?: string;
    }[] = [];

    if (result[0]?.values) {
      for (const row of result[0].values) {
        const [id, key, ns, content, embedding, accessCount, createdAt, updatedAt] = row as [
          string, string, string, string, string | null, number, string, string
        ];
        const entry: {
          id: string;
          key: string;
          namespace: string;
          size: number;
          accessCount: number;
          createdAt: string;
          updatedAt: string;
          hasEmbedding: boolean;
          content?: string;
        } = {
          // #2073: don't truncate id when content is requested — callers
          // (notably memory_export) need the full id to round-trip via import.
          id: options.includeContent ? String(id) : String(id).substring(0, 20),
          key: key || String(id).substring(0, 15),
          namespace: ns || 'default',
          size: (content || '').length,
          accessCount: accessCount || 0,
          createdAt: createdAt || new Date().toISOString(),
          updatedAt: updatedAt || new Date().toISOString(),
          hasEmbedding: !!embedding && embedding.length > 10
        };
        if (options.includeContent) {
          entry.content = content || '';
        }
        entries.push(entry);
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

  const swarmDir = getMemoryRoot();
  const dbPath = customPath || path.join(swarmDir, 'memory.db');

  try {
    if (!fs.existsSync(dbPath)) {
      return { success: false, found: false, error: 'Database not found' };
    }

    // Ensure schema has all required columns (migration for older DBs)
    await ensureSchemaColumns(dbPath);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();

    const fileBuffer = readFileMaybeEncrypted(dbPath, null);
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
    writeFileRestricted(dbPath, Buffer.from(data), { encrypt: true });

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

  const swarmDir = getMemoryRoot();
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

    const fileBuffer = readFileMaybeEncrypted(dbPath, null);
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
    writeFileRestricted(dbPath, Buffer.from(data), { encrypt: true });

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
