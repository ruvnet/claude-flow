#!/usr/bin/env node
/**
 * Context Persistence Hook (ADR-051)
 *
 * Intercepts Claude Code's PreCompact, SessionStart, and UserPromptSubmit
 * lifecycle events to persist conversation history in SQLite (primary),
 * RuVector PostgreSQL (optional), or JSON (fallback), enabling "infinite
 * context" across compaction boundaries.
 *
 * Backend priority:
 *   1. better-sqlite3 (native, WAL mode, indexed queries, ACID transactions)
 *   2. RuVector PostgreSQL (if RUVECTOR_* env vars set - TB-scale, GNN search)
 *   3. AgentDB from @claude-flow/memory (HNSW vector search)
 *   4. JsonFileBackend (zero dependencies, always works)
 *
 * Proactive archiving:
 *   - UserPromptSubmit hook archives on every prompt, BEFORE context fills up
 *   - PreCompact hook is a safety net that catches any remaining unarchived turns
 *   - SessionStart hook restores context after compaction
 *   - Together, compaction becomes invisible — no information is ever lost
 *
 * Usage:
 *   node context-persistence-hook.mjs pre-compact       # PreCompact: archive transcript
 *   node context-persistence-hook.mjs session-start      # SessionStart: restore context
 *   node context-persistence-hook.mjs user-prompt-submit # UserPromptSubmit: proactive archive
 *   node context-persistence-hook.mjs status              # Show archive stats
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../..');
const DATA_DIR = join(PROJECT_ROOT, '.claude-flow', 'data');
const ARCHIVE_JSON_PATH = join(DATA_DIR, 'transcript-archive.json');
const ARCHIVE_DB_PATH = join(DATA_DIR, 'transcript-archive.db');

const NAMESPACE = 'transcript-archive';
const RESTORE_BUDGET = parseInt(process.env.CLAUDE_FLOW_COMPACT_RESTORE_BUDGET || '4000', 10);
const MAX_MESSAGES = 500;
const BLOCK_COMPACTION = process.env.CLAUDE_FLOW_BLOCK_COMPACTION === 'true';
const COMPACT_INSTRUCTION_BUDGET = parseInt(process.env.CLAUDE_FLOW_COMPACT_INSTRUCTION_BUDGET || '2000', 10);
const RETENTION_DAYS = parseInt(process.env.CLAUDE_FLOW_RETENTION_DAYS || '30', 10);
const AUTO_OPTIMIZE = process.env.CLAUDE_FLOW_AUTO_OPTIMIZE !== 'false'; // on by default

// ============================================================================
// Context Autopilot — prevent compaction by managing context size in real-time
// ============================================================================
const AUTOPILOT_ENABLED = process.env.CLAUDE_FLOW_CONTEXT_AUTOPILOT !== 'false'; // on by default
const CONTEXT_WINDOW_TOKENS = parseInt(process.env.CLAUDE_FLOW_CONTEXT_WINDOW || '200000', 10);
const AUTOPILOT_WARN_PCT = parseFloat(process.env.CLAUDE_FLOW_AUTOPILOT_WARN || '0.70');
const AUTOPILOT_PRUNE_PCT = parseFloat(process.env.CLAUDE_FLOW_AUTOPILOT_PRUNE || '0.85');
const AUTOPILOT_STATE_PATH = join(DATA_DIR, 'autopilot-state.json');

// Approximate tokens per character (Claude averages ~3.5 chars per token)
const CHARS_PER_TOKEN = 3.5;

const DEBUG = !!(process.env.RUFLO_DEBUG || process.env.DEBUG);

// ── Graceful shutdown (FIX 3) ───────────────────────────────────────────────
// The active backend is created mid-handler and closed at the end. SQLite holds
// a native handle and a WAL; if a SIGTERM/SIGINT arrives between creation and
// `backend.shutdown()`, that close is skipped — risking an unflushed WAL or a
// stale lock file. Track the active backend and flush it on signal before exit.
let activeBackend = null;
let shuttingDown = false;
function trackBackend(b) { activeBackend = b; return b; }
async function gracefulExit(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (DEBUG) process.stderr.write(`[ContextPersistence] received ${signal}, flushing backend before exit\n`);
  try {
    if (activeBackend && typeof activeBackend.shutdown === 'function') await activeBackend.shutdown();
  } catch { /* best effort — never block exit on cleanup */ }
  process.exit(0);
}
process.on('SIGTERM', () => { gracefulExit('SIGTERM'); });
process.on('SIGINT', () => { gracefulExit('SIGINT'); });

// Ensure data dir
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ============================================================================
// SQLite Backend (better-sqlite3 — synchronous, fast, WAL mode)
// ============================================================================

class SQLiteBackend {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async initialize() {
    const require = createRequire(import.meta.url);
    const Database = require('better-sqlite3');
    this.db = new Database(this.dbPath);

    // Performance optimizations
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 5000');
    this.db.pragma('temp_store = MEMORY');

    // Create schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transcript_entries (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'episodic',
        namespace TEXT NOT NULL DEFAULT 'transcript-archive',
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        access_level TEXT NOT NULL DEFAULT 'private',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at INTEGER NOT NULL,
        content_hash TEXT,
        session_id TEXT,
        chunk_index INTEGER,
        summary TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_te_namespace ON transcript_entries(namespace);
      CREATE INDEX IF NOT EXISTS idx_te_session ON transcript_entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_te_hash ON transcript_entries(content_hash);
      CREATE INDEX IF NOT EXISTS idx_te_chunk ON transcript_entries(session_id, chunk_index);
      CREATE INDEX IF NOT EXISTS idx_te_created ON transcript_entries(created_at);
    `);

    // Schema migration: add confidence + embedding columns (self-learning support)
    try {
      this.db.exec(`ALTER TABLE transcript_entries ADD COLUMN confidence REAL NOT NULL DEFAULT 0.8`);
    } catch { /* column already exists */ }
    try {
      this.db.exec(`ALTER TABLE transcript_entries ADD COLUMN embedding BLOB`);
    } catch { /* column already exists */ }
    try {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_te_confidence ON transcript_entries(confidence)`);
    } catch { /* index already exists */ }

    // Prepare statements for reuse
    this._stmts = {
      insert: this.db.prepare(`
        INSERT OR IGNORE INTO transcript_entries
          (id, key, content, type, namespace, tags, metadata, access_level,
           created_at, updated_at, version, access_count, last_accessed_at,
           content_hash, session_id, chunk_index, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      queryByNamespace: this.db.prepare(
        'SELECT * FROM transcript_entries WHERE namespace = ? ORDER BY created_at DESC'
      ),
      queryBySession: this.db.prepare(
        'SELECT * FROM transcript_entries WHERE namespace = ? AND session_id = ? ORDER BY chunk_index DESC'
      ),
      countAll: this.db.prepare('SELECT COUNT(*) as cnt FROM transcript_entries'),
      countByNamespace: this.db.prepare(
        'SELECT COUNT(*) as cnt FROM transcript_entries WHERE namespace = ?'
      ),
      hashExists: this.db.prepare(
        'SELECT 1 FROM transcript_entries WHERE content_hash = ? LIMIT 1'
      ),
      listNamespaces: this.db.prepare(
        'SELECT DISTINCT namespace FROM transcript_entries'
      ),
      listSessions: this.db.prepare(
        'SELECT session_id, COUNT(*) as cnt FROM transcript_entries WHERE namespace = ? GROUP BY session_id ORDER BY MAX(created_at) DESC'
      ),
    };

    this._bulkInsert = this.db.transaction((entries) => {
      for (const e of entries) {
        this._stmts.insert.run(
          e.id, e.key, e.content, e.type, e.namespace,
          JSON.stringify(e.tags), JSON.stringify(e.metadata), e.accessLevel,
          e.createdAt, e.updatedAt, e.version, e.accessCount, e.lastAccessedAt,
          e.metadata?.contentHash || null,
          e.metadata?.sessionId || null,
          e.metadata?.chunkIndex ?? null,
          e.metadata?.summary || null
        );
      }
    });

    // Optimization statements
    this._stmts.markAccessed = this.db.prepare(
      'UPDATE transcript_entries SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?'
    );
    this._stmts.pruneStale = this.db.prepare(
      'DELETE FROM transcript_entries WHERE namespace = ? AND access_count = 0 AND created_at < ?'
    );
    this._stmts.queryByImportance = this.db.prepare(`
      SELECT *, (
        (CAST(access_count AS REAL) + 1) *
        (1.0 / (1.0 + (? - created_at) / 86400000.0)) *
        (CASE WHEN json_array_length(json_extract(metadata, '$.toolNames')) > 0 THEN 1.5 ELSE 1.0 END) *
        (CASE WHEN json_array_length(json_extract(metadata, '$.filePaths')) > 0 THEN 1.3 ELSE 1.0 END)
      ) AS importance_score
      FROM transcript_entries
      WHERE namespace = ? AND session_id = ?
      ORDER BY importance_score DESC
    `);
    this._stmts.allForSync = this.db.prepare(
      'SELECT * FROM transcript_entries WHERE namespace = ? ORDER BY created_at ASC'
    );
  }

  async store(entry) {
    this._stmts.insert.run(
      entry.id, entry.key, entry.content, entry.type, entry.namespace,
      JSON.stringify(entry.tags), JSON.stringify(entry.metadata), entry.accessLevel,
      entry.createdAt, entry.updatedAt, entry.version, entry.accessCount, entry.lastAccessedAt,
      entry.metadata?.contentHash || null,
      entry.metadata?.sessionId || null,
      entry.metadata?.chunkIndex ?? null,
      entry.metadata?.summary || null
    );
  }

  async bulkInsert(entries) {
    this._bulkInsert(entries);
  }

  async query(opts) {
    let rows;
    if (opts?.namespace && opts?.sessionId) {
      rows = this._stmts.queryBySession.all(opts.namespace, opts.sessionId);
    } else if (opts?.namespace) {
      rows = this._stmts.queryByNamespace.all(opts.namespace);
    } else {
      rows = this.db.prepare('SELECT * FROM transcript_entries ORDER BY created_at DESC').all();
    }
    return rows.map(r => this._rowToEntry(r));
  }

  async queryBySession(namespace, sessionId) {
    const rows = this._stmts.queryBySession.all(namespace, sessionId);
    return rows.map(r => this._rowToEntry(r));
  }

  hashExists(hash) {
    return !!this._stmts.hashExists.get(hash);
  }

  async count(namespace) {
    if (namespace) {
      return this._stmts.countByNamespace.get(namespace).cnt;
    }
    return this._stmts.countAll.get().cnt;
  }

  async listNamespaces() {
    return this._stmts.listNamespaces.all().map(r => r.namespace);
  }

  async listSessions(namespace) {
    return this._stmts.listSessions.all(namespace || NAMESPACE);
  }

  markAccessed(ids) {
    const now = Date.now();
    const boostStmt = this.db.prepare(
      'UPDATE transcript_entries SET access_count = access_count + 1, last_accessed_at = ?, confidence = MIN(1.0, confidence + 0.03) WHERE id = ?'
    );
    for (const id of ids) {
      boostStmt.run(now, id);
    }
  }

  /**
   * Confidence decay: reduce confidence for entries not accessed recently.
   * Decay rate: 0.5% per hour (matches LearningBridge default).
   * Entries with confidence below 0.1 are floor-clamped.
   */
  decayConfidence(namespace, hoursElapsed = 1) {
    const decayRate = 0.005 * hoursElapsed;
    const result = this.db.prepare(
      'UPDATE transcript_entries SET confidence = MAX(0.1, confidence - ?) WHERE namespace = ? AND confidence > 0.1'
    ).run(decayRate, namespace || NAMESPACE);
    return result.changes;
  }

  /**
   * Store embedding blob for an entry (768-dim Float32Array → Buffer).
   */
  storeEmbedding(id, embedding) {
    const buf = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
    this.db.prepare('UPDATE transcript_entries SET embedding = ? WHERE id = ?').run(buf, id);
  }

  /**
   * Cosine similarity search across all entries with embeddings.
   * Handles both 384-dim (ONNX) and 768-dim (legacy hash) embeddings.
   * Returns top-k entries ranked by similarity to the query embedding.
   */
  semanticSearch(queryEmbedding, k = 10, namespace) {
    const rows = this.db.prepare(
      'SELECT id, embedding, summary, session_id, chunk_index, confidence, access_count FROM transcript_entries WHERE namespace = ? AND embedding IS NOT NULL'
    ).all(namespace || NAMESPACE);

    const queryDim = queryEmbedding.length;
    const scored = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      // Only compare if dimensions match
      if (stored.length !== queryDim) continue;
      let dot = 0;
      for (let i = 0; i < queryDim; i++) {
        dot += queryEmbedding[i] * stored[i];
      }
      // Boost by confidence (self-learning signal)
      const score = dot * (row.confidence || 0.8);
      scored.push({ id: row.id, score, summary: row.summary, sessionId: row.session_id, chunkIndex: row.chunk_index, confidence: row.confidence, accessCount: row.access_count });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * Smart pruning: prune by confidence instead of just age.
   * Removes entries with confidence <= threshold AND access_count = 0.
   */
  pruneByConfidence(namespace, threshold = 0.2) {
    const result = this.db.prepare(
      'DELETE FROM transcript_entries WHERE namespace = ? AND confidence <= ? AND access_count = 0'
    ).run(namespace || NAMESPACE, threshold);
    return result.changes;
  }

  pruneStale(namespace, maxAgeDays) {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const result = this._stmts.pruneStale.run(namespace || NAMESPACE, cutoff);
    return result.changes;
  }

  queryByImportance(namespace, sessionId) {
    const now = Date.now();
    const rows = this._stmts.queryByImportance.all(now, namespace, sessionId);
    return rows.map(r => ({ ...this._rowToEntry(r), importanceScore: r.importance_score }));
  }

  allForSync(namespace) {
    const rows = this._stmts.allForSync.all(namespace || NAMESPACE);
    return rows.map(r => this._rowToEntry(r));
  }

  async shutdown() {
    if (this.db) {
      this.db.pragma('optimize');
      this.db.close();
      this.db = null;
    }
  }

  _rowToEntry(row) {
    return {
      id: row.id,
      key: row.key,
      content: row.content,
      type: row.type,
      namespace: row.namespace,
      tags: JSON.parse(row.tags),
      metadata: JSON.parse(row.metadata),
      accessLevel: row.access_level,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      accessCount: row.access_count,
      lastAccessedAt: row.last_accessed_at,
      references: [],
    };
  }
}

// ============================================================================
// JSON File Backend (fallback when better-sqlite3 unavailable)
// ============================================================================

class JsonFileBackend {
  constructor(filePath) {
    this.filePath = filePath;
    this.entries = new Map();
  }

  async initialize() {
    if (existsSync(this.filePath)) {
      try {
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(data)) {
          for (const entry of data) this.entries.set(entry.id, entry);
        }
      } catch { /* start fresh */ }
    }
  }

  async store(entry) { this.entries.set(entry.id, entry); this._persist(); }

  async bulkInsert(entries) {
    for (const e of entries) this.entries.set(e.id, e);
    this._persist();
  }

  async query(opts) {
    let results = [...this.entries.values()];
    if (opts?.namespace) results = results.filter(e => e.namespace === opts.namespace);
    if (opts?.type) results = results.filter(e => e.type === opts.type);
    if (opts?.limit) results = results.slice(0, opts.limit);
    return results;
  }

  async queryBySession(namespace, sessionId) {
    return [...this.entries.values()]
      .filter(e => e.namespace === namespace && e.metadata?.sessionId === sessionId)
      .sort((a, b) => (b.metadata?.chunkIndex ?? 0) - (a.metadata?.chunkIndex ?? 0));
  }

  hashExists(hash) {
    for (const e of this.entries.values()) {
      if (e.metadata?.contentHash === hash) return true;
    }
    return false;
  }

  async count(namespace) {
    if (!namespace) return this.entries.size;
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.namespace === namespace) n++;
    }
    return n;
  }

  async listNamespaces() {
    const ns = new Set();
    for (const e of this.entries.values()) ns.add(e.namespace || 'default');
    return [...ns];
  }

  async listSessions(namespace) {
    const sessions = new Map();
    for (const e of this.entries.values()) {
      if (e.namespace === (namespace || NAMESPACE) && e.metadata?.sessionId) {
        sessions.set(e.metadata.sessionId, (sessions.get(e.metadata.sessionId) || 0) + 1);
      }
    }
    return [...sessions.entries()].map(([session_id, cnt]) => ({ session_id, cnt }));
  }

  async shutdown() { this._persist(); }

  _persist() {
    try {
      writeFileSync(this.filePath, JSON.stringify([...this.entries.values()], null, 2), 'utf-8');
    } catch { /* best effort */ }
  }
}

// ============================================================================
// RuVector PostgreSQL Backend (optional, TB-scale, GNN-enhanced)
// ============================================================================

class RuVectorBackend {
  constructor(config) {
    this.config = config;
    this.pool = null;
  }

  async initialize() {
    const pg = await import('pg');
    const Pool = pg.default?.Pool || pg.Pool;
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port || 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl || false,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3000,
      application_name: 'claude-flow-context-persistence',
    });

    // Test connection and create schema
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS transcript_entries (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'episodic',
          namespace TEXT NOT NULL DEFAULT 'transcript-archive',
          tags JSONB NOT NULL DEFAULT '[]',
          metadata JSONB NOT NULL DEFAULT '{}',
          access_level TEXT NOT NULL DEFAULT 'private',
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1,
          access_count INTEGER NOT NULL DEFAULT 0,
          last_accessed_at BIGINT NOT NULL,
          content_hash TEXT,
          session_id TEXT,
          chunk_index INTEGER,
          summary TEXT,
          embedding vector(768)
        );

        CREATE INDEX IF NOT EXISTS idx_te_namespace ON transcript_entries(namespace);
        CREATE INDEX IF NOT EXISTS idx_te_session ON transcript_entries(session_id);
        CREATE INDEX IF NOT EXISTS idx_te_hash ON transcript_entries(content_hash);
        CREATE INDEX IF NOT EXISTS idx_te_chunk ON transcript_entries(session_id, chunk_index);
        CREATE INDEX IF NOT EXISTS idx_te_created ON transcript_entries(created_at);
      `);
    } finally {
      client.release();
    }
  }

  async store(entry) {
    const embeddingArr = entry._embedding
      ? `[${Array.from(entry._embedding).join(',')}]`
      : null;
    await this.pool.query(
      `INSERT INTO transcript_entries
        (id, key, content, type, namespace, tags, metadata, access_level,
         created_at, updated_at, version, access_count, last_accessed_at,
         content_hash, session_id, chunk_index, summary, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id, entry.key, entry.content, entry.type, entry.namespace,
        JSON.stringify(entry.tags), JSON.stringify(entry.metadata), entry.accessLevel,
        entry.createdAt, entry.updatedAt, entry.version, entry.accessCount, entry.lastAccessedAt,
        entry.metadata?.contentHash || null,
        entry.metadata?.sessionId || null,
        entry.metadata?.chunkIndex ?? null,
        entry.metadata?.summary || null,
        embeddingArr,
      ]
    );
  }

  async bulkInsert(entries) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        const embeddingArr = entry._embedding
          ? `[${Array.from(entry._embedding).join(',')}]`
          : null;
        await client.query(
          `INSERT INTO transcript_entries
            (id, key, content, type, namespace, tags, metadata, access_level,
             created_at, updated_at, version, access_count, last_accessed_at,
             content_hash, session_id, chunk_index, summary, embedding)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (id) DO NOTHING`,
          [
            entry.id, entry.key, entry.content, entry.type, entry.namespace,
            JSON.stringify(entry.tags), JSON.stringify(entry.metadata), entry.accessLevel,
            entry.createdAt, entry.updatedAt, entry.version, entry.accessCount, entry.lastAccessedAt,
            entry.metadata?.contentHash || null,
            entry.metadata?.sessionId || null,
            entry.metadata?.chunkIndex ?? null,
            entry.metadata?.summary || null,
            embeddingArr,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async query(opts) {
    let sql = 'SELECT * FROM transcript_entries';
    const params = [];
    const clauses = [];
    if (opts?.namespace) { params.push(opts.namespace); clauses.push(`namespace = $${params.length}`); }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    if (opts?.limit) { params.push(opts.limit); sql += ` LIMIT $${params.length}`; }
    const { rows } = await this.pool.query(sql, params);
    return rows.map(r => this._rowToEntry(r));
  }

  async queryBySession(namespace, sessionId) {
    const { rows } = await this.pool.query(
      'SELECT * FROM transcript_entries WHERE namespace = $1 AND session_id = $2 ORDER BY chunk_index DESC',
      [namespace, sessionId]
    );
    return rows.map(r => this._rowToEntry(r));
  }

  hashExists(hash) {
    // Synchronous check not possible with pg — use a cached check
    // The bulkInsert uses ON CONFLICT DO NOTHING for dedup at DB level
    return false;
  }

  async hashExistsAsync(hash) {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM transcript_entries WHERE content_hash = $1 LIMIT 1',
      [hash]
    );
    return rows.length > 0;
  }

  async count(namespace) {
    const sql = namespace
      ? 'SELECT COUNT(*) as cnt FROM transcript_entries WHERE namespace = $1'
      : 'SELECT COUNT(*) as cnt FROM transcript_entries';
    const params = namespace ? [namespace] : [];
    const { rows } = await this.pool.query(sql, params);
    return parseInt(rows[0].cnt, 10);
  }

  async listNamespaces() {
    const { rows } = await this.pool.query('SELECT DISTINCT namespace FROM transcript_entries');
    return rows.map(r => r.namespace);
  }

  async listSessions(namespace) {
    const { rows } = await this.pool.query(
      `SELECT session_id, COUNT(*) as cnt FROM transcript_entries
       WHERE namespace = $1 GROUP BY session_id ORDER BY MAX(created_at) DESC`,
      [namespace || NAMESPACE]
    );
    return rows.map(r => ({ session_id: r.session_id, cnt: parseInt(r.cnt, 10) }));
  }

  async markAccessed(ids) {
    const now = Date.now();
    for (const id of ids) {
      await this.pool.query(
        'UPDATE transcript_entries SET access_count = access_count + 1, last_accessed_at = $1 WHERE id = $2',
        [now, id]
      );
    }
  }

  async pruneStale(namespace, maxAgeDays) {
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const { rowCount } = await this.pool.query(
      'DELETE FROM transcript_entries WHERE namespace = $1 AND access_count = 0 AND created_at < $2',
      [namespace || NAMESPACE, cutoff]
    );
    return rowCount;
  }

  async queryByImportance(namespace, sessionId) {
    const now = Date.now();
    const { rows } = await this.pool.query(`
      SELECT *, (
        (CAST(access_count AS REAL) + 1) *
        (1.0 / (1.0 + ($1 - created_at) / 86400000.0)) *
        (CASE WHEN jsonb_array_length(metadata->'toolNames') > 0 THEN 1.5 ELSE 1.0 END) *
        (CASE WHEN jsonb_array_length(metadata->'filePaths') > 0 THEN 1.3 ELSE 1.0 END)
      ) AS importance_score
      FROM transcript_entries
      WHERE namespace = $2 AND session_id = $3
      ORDER BY importance_score DESC
    `, [now, namespace, sessionId]);
    return rows.map(r => ({ ...this._rowToEntry(r), importanceScore: r.importance_score }));
  }

  async shutdown() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  _rowToEntry(row) {
    return {
      id: row.id,
      key: row.key,
      content: row.content,
      type: row.type,
      namespace: row.namespace,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      accessLevel: row.access_level,
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10),
      version: row.version,
      accessCount: row.access_count,
      lastAccessedAt: parseInt(row.last_accessed_at, 10),
      references: [],
    };
  }
}

/**
 * Parse RuVector config from environment variables.
 * Returns null if required vars are not set.
 */
function getRuVectorConfig() {
  const host = process.env.RUVECTOR_HOST || process.env.PGHOST;
  const database = process.env.RUVECTOR_DATABASE || process.env.PGDATABASE;
  const user = process.env.RUVECTOR_USER || process.env.PGUSER;
  const password = process.env.RUVECTOR_PASSWORD || process.env.PGPASSWORD;

  if (!host || !database || !user) return null;

  return {
    host,
    port: parseInt(process.env.RUVECTOR_PORT || process.env.PGPORT || '5432', 10),
    database,
    user,
    password: password || '',
    ssl: process.env.RUVECTOR_SSL === 'true',
  };
}

// ============================================================================
// Backend resolution: SQLite > RuVector PostgreSQL > AgentDB > JSON
// ============================================================================

async function resolveBackend() {
  // Tier 1: better-sqlite3 (native, fastest, local)
  try {
    const backend = new SQLiteBackend(ARCHIVE_DB_PATH);
    await backend.initialize();
    return { backend: trackBackend(backend), type: 'sqlite' };
  } catch { /* fall through */ }

  // Tier 2: RuVector PostgreSQL (TB-scale, vector search, GNN)
  try {
    const rvConfig = getRuVectorConfig();
    if (rvConfig) {
      const backend = new RuVectorBackend(rvConfig);
      await backend.initialize();
      return { backend: trackBackend(backend), type: 'ruvector' };
    }
  } catch { /* fall through */ }

  // Tier 3: AgentDB from @claude-flow/memory (HNSW)
  try {
    const localDist = join(PROJECT_ROOT, 'v3/@claude-flow/memory/dist/index.js');
    let memPkg = null;
    if (existsSync(localDist)) {
      memPkg = await import(`file://${localDist}`);
    } else {
      memPkg = await import('@claude-flow/memory');
    }
    if (memPkg?.AgentDBBackend) {
      const backend = new memPkg.AgentDBBackend();
      await backend.initialize();
      return { backend: trackBackend(backend), type: 'agentdb' };
    }
  } catch { /* fall through */ }

  // Tier 4: JSON file (always works)
  const backend = new JsonFileBackend(ARCHIVE_JSON_PATH);
  await backend.initialize();
  return { backend: trackBackend(backend), type: 'json' };
}

// ============================================================================
// ONNX Embedding (384-dim, all-MiniLM-L6-v2 via @xenova/transformers)
// ============================================================================

const EMBEDDING_DIM = 384; // ONNX all-MiniLM-L6-v2 output dimension
let _onnxPipeline = null;
let _onnxFailed = false;

/**
 * Initialize ONNX embedding pipeline (lazy, cached).
 * Returns null if @xenova/transformers is not available.
 */
async function getOnnxPipeline() {
  if (_onnxFailed) return null;
  if (_onnxPipeline) return _onnxPipeline;
  try {
    const { pipeline } = await import('@xenova/transformers');
    _onnxPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    return _onnxPipeline;
  } catch {
    _onnxFailed = true;
    return null;
  }
}

/**
 * Generate ONNX embedding (384-dim, high quality semantic vectors).
 * Falls back to hash embedding if ONNX is unavailable.
 */
async function createEmbedding(text) {
  // Try ONNX first (384-dim, real semantic understanding)
  const pipe = await getOnnxPipeline();
  if (pipe) {
    try {
      const truncated = text.slice(0, 512); // MiniLM max ~512 tokens
      const output = await pipe(truncated, { pooling: 'mean', normalize: true });
      return { embedding: new Float32Array(output.data), dim: 384, method: 'onnx' };
    } catch { /* fall through to hash */ }
  }
  // Fallback: hash embedding (384-dim to match ONNX dimension)
  return { embedding: createHashEmbedding(text, 384), dim: 384, method: 'hash' };
}

// ============================================================================
// Hash embedding fallback (deterministic, sub-millisecond)
// ============================================================================

function createHashEmbedding(text, dimensions = 384) {
  const embedding = new Float32Array(dimensions);
  const normalized = text.toLowerCase().trim();
  for (let i = 0; i < dimensions; i++) {
    let hash = 0;
    for (let j = 0; j < normalized.length; j++) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(j) * (i + 1)) | 0;
    }
    embedding[i] = (Math.sin(hash) + 1) / 2;
  }
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += embedding[i] * embedding[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dimensions; i++) embedding[i] /= norm;
  return embedding;
}

// ============================================================================
// Content hash for dedup
// ============================================================================

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

// ============================================================================
// Read stdin with timeout (hooks receive JSON input on stdin)
// ============================================================================

function readStdin(timeoutMs = 100) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.removeAllListeners();
      resolve(data ? JSON.parse(data) : null);
    }, timeoutMs);

    if (process.stdin.isTTY) {
      clearTimeout(timer);
      resolve(null);
      return;
    }

    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      try { resolve(data ? JSON.parse(data) : null); }
      catch { resolve(null); }
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    process.stdin.resume();
  });
}

// ============================================================================
// Transcript parsing
// ============================================================================

function parseTranscript(transcriptPath) {
  if (!existsSync(transcriptPath)) return [];
  const content = readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      // SDK transcript wraps messages: { type: "user"|"A", message: { role, content } }
      // Unwrap to get the inner API message with role/content
      if (parsed.message && parsed.message.role) {
        messages.push(parsed.message);
      } else if (parsed.role) {
        // Already in API message format (e.g. from tests)
        messages.push(parsed);
      }
      // Skip non-message entries (progress, file-history-snapshot, queue-operation)
    } catch { /* skip malformed lines */ }
  }
  return messages;
}

// ============================================================================
// Extract text content from message content blocks
// ============================================================================

function extractTextContent(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  }
  if (typeof message.text === 'string') return message.text;
  return '';
}

// ============================================================================
// Extract tool calls from assistant message
// ============================================================================

function extractToolCalls(message) {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content
    .filter(b => b.type === 'tool_use')
    .map(b => ({
      name: b.name || 'unknown',
      input: b.input || {},
    }));
}

// ============================================================================
// Extract file paths from tool calls
// ============================================================================

function extractFilePaths(toolCalls) {
  const paths = new Set();
  for (const tc of toolCalls) {
    if (tc.input?.file_path) paths.add(tc.input.file_path);
    if (tc.input?.path) paths.add(tc.input.path);
    if (tc.input?.notebook_path) paths.add(tc.input.notebook_path);
  }
  return [...paths];
}

// ============================================================================
// Chunk transcript into conversation turns
// ============================================================================

function chunkTranscript(messages) {
  const relevant = messages.filter(
    m => m.role === 'user' || m.role === 'assistant'
  );
  const capped = relevant.slice(-MAX_MESSAGES);

  const chunks = [];
  let currentChunk = null;

  for (const msg of capped) {
    if (msg.role === 'user') {
      const isSynthetic = Array.isArray(msg.content) &&
        msg.content.every(b => b.type === 'tool_result');
      if (isSynthetic && currentChunk) continue;
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = {
        userMessage: msg,
        assistantMessage: null,
        toolCalls: [],
        turnIndex: chunks.length,
      };
    } else if (msg.role === 'assistant' && currentChunk) {
      currentChunk.assistantMessage = msg;
      currentChunk.toolCalls = extractToolCalls(msg);
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

// ============================================================================
// Extract summary from chunk (no LLM, extractive only)
// ============================================================================

function extractSummary(chunk) {
  const parts = [];

  const userText = extractTextContent(chunk.userMessage);
  const firstUserLine = userText.split('\n').find(l => l.trim()) || '';
  if (firstUserLine) parts.push(firstUserLine.slice(0, 100));

  const toolNames = [...new Set(chunk.toolCalls.map(tc => tc.name))];
  if (toolNames.length) parts.push('Tools: ' + toolNames.join(', '));

  const filePaths = extractFilePaths(chunk.toolCalls);
  if (filePaths.length) {
    const shortPaths = filePaths.slice(0, 5).map(p => {
      const segs = p.split('/');
      return segs.length > 2 ? '.../' + segs.slice(-2).join('/') : p;
    });
    parts.push('Files: ' + shortPaths.join(', '));
  }

  const assistantText = extractTextContent(chunk.assistantMessage);
  const assistantLines = assistantText.split('\n').filter(l => l.trim()).slice(0, 2);
  if (assistantLines.length) parts.push(assistantLines.join(' ').slice(0, 120));

  return parts.join(' | ').slice(0, 300);
}

// ============================================================================
// Generate unique ID
// ============================================================================

let idCounter = 0;
function generateId() {
  return `ctx-${Date.now()}-${++idCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Build MemoryEntry from chunk
// ============================================================================

function buildEntry(chunk, sessionId, trigger, timestamp) {
  const userText = extractTextContent(chunk.userMessage);
  const assistantText = extractTextContent(chunk.assistantMessage);
  const fullContent = `User: ${userText}\n\nAssistant: ${assistantText}`;
  const toolNames = [...new Set(chunk.toolCalls.map(tc => tc.name))];
  const filePaths = extractFilePaths(chunk.toolCalls);
  const summary = extractSummary(chunk);
  const contentHash = hashContent(fullContent);

  const now = Date.now();
  return {
    id: generateId(),
    key: `transcript:${sessionId}:${chunk.turnIndex}:${timestamp}`,
    content: fullContent,
    type: 'episodic',
    namespace: NAMESPACE,
    tags: ['transcript', 'compaction', sessionId, ...toolNames],
    metadata: {
      sessionId,
      chunkIndex: chunk.turnIndex,
      trigger,
      timestamp,
      toolNames,
      filePaths,
      summary,
      contentHash,
      turnRange: [chunk.turnIndex, chunk.turnIndex],
    },
    accessLevel: 'private',
    createdAt: now,
    updatedAt: now,
    version: 1,
    references: [],
    accessCount: 0,
    lastAccessedAt: now,
  };
}

// ============================================================================
// Store chunks with dedup (uses indexed hash lookup for SQLite)
// ============================================================================

async function storeChunks(backend, chunks, sessionId, trigger) {
  const timestamp = new Date().toISOString();

  const entries = [];
  for (const chunk of chunks) {
    const entry = buildEntry(chunk, sessionId, trigger, timestamp);
    // Fast hash-based dedup (indexed lookup in SQLite, scan in JSON)
    if (!backend.hashExists(entry.metadata.contentHash)) {
      entries.push(entry);
    }
  }

  if (entries.length > 0) {
    await backend.bulkInsert(entries);
  }

  return { stored: entries.length, deduped: chunks.length - entries.length };
}

// ============================================================================
// Retrieve context for restoration (uses indexed session query for SQLite)
// ============================================================================

async function retrieveContext(backend, sessionId, budget) {
  // Use optimized session query if available, otherwise filter manually
  const sessionEntries = backend.queryBySession
    ? await backend.queryBySession(NAMESPACE, sessionId)
    : (await backend.query({ namespace: NAMESPACE }))
        .filter(e => e.metadata?.sessionId === sessionId)
        .sort((a, b) => (b.metadata?.chunkIndex ?? 0) - (a.metadata?.chunkIndex ?? 0));

  if (sessionEntries.length === 0) return '';

  const lines = [];
  let charCount = 0;
  const header = `## Restored Context (from pre-compaction archive)\n\nPrevious conversation included ${sessionEntries.length} archived turns:\n\n`;
  charCount += header.length;

  for (const entry of sessionEntries) {
    const meta = entry.metadata || {};
    const toolStr = meta.toolNames?.length ? ` Tools: ${meta.toolNames.join(', ')}.` : '';
    const fileStr = meta.filePaths?.length ? ` Files: ${meta.filePaths.slice(0, 3).join(', ')}.` : '';
    const line = `- [Turn ${meta.chunkIndex ?? '?'}] ${meta.summary || '(no summary)'}${toolStr}${fileStr}`;

    if (charCount + line.length + 1 > budget) break;
    lines.push(line);
    charCount += line.length + 1;
  }

  if (lines.length === 0) return '';

  const footer = `\n\nFull archive: ${NAMESPACE} namespace in AgentDB (query with session ID: ${sessionId})`;
  return header + lines.join('\n') + footer;
}

// ============================================================================
// Build custom compact instructions (exit code 0 stdout)
// Guides Claude on what to preserve during compaction summary
// ============================================================================

function buildCompactInstructions(chunks, sessionId, archiveResult) {
  const parts = [];

  parts.push('COMPACTION GUIDANCE (from context-persistence-hook):');
  parts.push('');
  parts.push(`All ${chunks.length} conversation turns have been archived to the transcript-archive database.`);
  parts.push(`Session: ${sessionId} | Stored: ${archiveResult.stored} new, ${archiveResult.deduped} deduped.`);
  parts.push('After compaction, archived context will be automatically restored via SessionStart hook.');
  parts.push('');

  // Collect unique tools and files across all chunks for preservation hints
  const allTools = new Set();
  const allFiles = new Set();
  const decisions = [];

  for (const chunk of chunks) {
    const toolNames = [...new Set(chunk.toolCalls.map(tc => tc.name))];
    for (const t of toolNames) allTools.add(t);
    const filePaths = extractFilePaths(chunk.toolCalls);
    for (const f of filePaths) allFiles.add(f);

    // Look for decision indicators in assistant text
    const assistantText = extractTextContent(chunk.assistantMessage);
    if (assistantText) {
      const lower = assistantText.toLowerCase();
      if (lower.includes('decided') || lower.includes('choosing') || lower.includes('approach')
          || lower.includes('instead of') || lower.includes('rather than')) {
        const firstLine = assistantText.split('\n').find(l => l.trim()) || '';
        if (firstLine.length > 10) decisions.push(firstLine.slice(0, 120));
      }
    }
  }

  parts.push('PRESERVE in compaction summary:');

  if (allFiles.size > 0) {
    const fileList = [...allFiles].slice(0, 15).map(f => {
      const segs = f.split('/');
      return segs.length > 3 ? '.../' + segs.slice(-3).join('/') : f;
    });
    parts.push(`- Files modified/read: ${fileList.join(', ')}`);
  }

  if (allTools.size > 0) {
    parts.push(`- Tools used: ${[...allTools].join(', ')}`);
  }

  if (decisions.length > 0) {
    parts.push('- Key decisions:');
    for (const d of decisions.slice(0, 5)) {
      parts.push(`  * ${d}`);
    }
  }

  // Recent turns summary (most important context)
  const recentChunks = chunks.slice(-5);
  if (recentChunks.length > 0) {
    parts.push('');
    parts.push('MOST RECENT TURNS (prioritize preserving):');
    for (const chunk of recentChunks) {
      const userText = extractTextContent(chunk.userMessage);
      const firstLine = userText.split('\n').find(l => l.trim()) || '';
      const toolNames = [...new Set(chunk.toolCalls.map(tc => tc.name))];
      parts.push(`- [Turn ${chunk.turnIndex}] ${firstLine.slice(0, 80)}${toolNames.length ? ` (${toolNames.join(', ')})` : ''}`);
    }
  }

  // Cap at budget
  let result = parts.join('\n');
  if (result.length > COMPACT_INSTRUCTION_BUDGET) {
    result = result.slice(0, COMPACT_INSTRUCTION_BUDGET - 3) + '...';
  }
  return result;
}

// ============================================================================
// Importance scoring for retrieval ranking
// ============================================================================

function computeImportance(entry, now) {
  const meta = entry.metadata || {};
  const accessCount = entry.accessCount || 0;
  const createdAt = entry.createdAt || now;
  const ageMs = Math.max(1, now - createdAt);
  const ageDays = ageMs / 86400000;

  // Recency: exponential decay, half-life of 7 days
  const recency = Math.exp(-0.693 * ageDays / 7);

  // Frequency: log-scaled access count
  const frequency = Math.log2(accessCount + 1) + 1;

  // Richness: tool calls and file paths indicate actionable context
  const toolCount = meta.toolNames?.length || 0;
  const fileCount = meta.filePaths?.length || 0;
  const richness = 1.0 + (toolCount > 0 ? 0.5 : 0) + (fileCount > 0 ? 0.3 : 0);

  return recency * frequency * richness;
}

// ============================================================================
// Smart retrieval: importance-ranked instead of just recency
// ============================================================================

async function retrieveContextSmart(backend, sessionId, budget) {
  let sessionEntries;

  // Use importance-ranked query if backend supports it
  if (backend.queryByImportance) {
    try {
      sessionEntries = backend.queryByImportance(NAMESPACE, sessionId);
    } catch {
      // Fall back to standard query
      sessionEntries = null;
    }
  }

  if (!sessionEntries) {
    // Fall back: fetch all, compute importance in JS
    const raw = backend.queryBySession
      ? await backend.queryBySession(NAMESPACE, sessionId)
      : (await backend.query({ namespace: NAMESPACE }))
          .filter(e => e.metadata?.sessionId === sessionId);

    const now = Date.now();
    sessionEntries = raw
      .map(e => ({ ...e, importanceScore: computeImportance(e, now) }))
      .sort((a, b) => b.importanceScore - a.importanceScore);
  }

  if (sessionEntries.length === 0) return { text: '', accessedIds: [] };

  const lines = [];
  const accessedIds = [];
  let charCount = 0;
  const header = `## Restored Context (importance-ranked from archive)\n\nPrevious conversation: ${sessionEntries.length} archived turns, ranked by importance:\n\n`;
  charCount += header.length;

  for (const entry of sessionEntries) {
    const meta = entry.metadata || {};
    const score = entry.importanceScore?.toFixed(2) || '?';
    const toolStr = meta.toolNames?.length ? ` Tools: ${meta.toolNames.join(', ')}.` : '';
    const fileStr = meta.filePaths?.length ? ` Files: ${meta.filePaths.slice(0, 3).join(', ')}.` : '';
    const line = `- [Turn ${meta.chunkIndex ?? '?'}, score:${score}] ${meta.summary || '(no summary)'}${toolStr}${fileStr}`;

    if (charCount + line.length + 1 > budget) break;
    lines.push(line);
    accessedIds.push(entry.id);
    charCount += line.length + 1;
  }

  if (lines.length === 0) return { text: '', accessedIds: [] };

  // Cross-session semantic search: find related context from previous sessions
  let crossSessionText = '';
  if (backend.semanticSearch && sessionEntries.length > 0) {
    try {
      // Use the most recent turn's summary as the search query
      const recentSummary = sessionEntries[0]?.metadata?.summary || '';
      if (recentSummary) {
        const crossResults = await crossSessionSearch(backend, recentSummary, sessionId, 3);
        if (crossResults.length > 0) {
          const crossLines = crossResults.map(r =>
            `- [Session ${r.sessionId?.slice(0, 8)}..., turn ${r.chunkIndex ?? '?'}, conf:${(r.confidence || 0).toFixed(2)}] ${r.summary || '(no summary)'}`
          );
          crossSessionText = `\n\nRelated context from previous sessions:\n${crossLines.join('\n')}`;
        }
      }
    } catch { /* cross-session search is best-effort */ }
  }

  const footer = `\n\nFull archive: ${NAMESPACE} namespace (session: ${sessionId}). ${sessionEntries.length - lines.length} additional turns available.`;
  return { text: header + lines.join('\n') + crossSessionText + footer, accessedIds };
}

// ============================================================================
// Auto-optimize: prune stale entries, run after archiving
// ============================================================================

async function autoOptimize(backend, backendType) {
  if (!AUTO_OPTIMIZE) return { pruned: 0, synced: 0, decayed: 0, embedded: 0 };

  let pruned = 0;
  let decayed = 0;
  let embedded = 0;

  // Step 1: Confidence decay — reduce confidence for unaccessed entries
  if (backend.decayConfidence) {
    try {
      decayed = backend.decayConfidence(NAMESPACE, 1); // 1 hour worth of decay per optimize cycle
    } catch { /* non-critical */ }
  }

  // Step 2: Smart pruning — remove low-confidence entries first
  if (backend.pruneByConfidence) {
    try {
      pruned += backend.pruneByConfidence(NAMESPACE, 0.15);
    } catch { /* non-critical */ }
  }

  // Step 3: Age-based pruning as fallback
  if (backend.pruneStale) {
    try {
      pruned += backend.pruneStale(NAMESPACE, RETENTION_DAYS);
    } catch { /* non-critical */ }
  }

  // Step 4: Generate ONNX embeddings (384-dim) for entries missing them
  if (backend.storeEmbedding) {
    try {
      const rows = backend.db?.prepare?.(
        'SELECT id, content FROM transcript_entries WHERE namespace = ? AND embedding IS NULL LIMIT 20'
      )?.all(NAMESPACE);
      if (rows) {
        for (const row of rows) {
          const { embedding } = await createEmbedding(row.content);
          backend.storeEmbedding(row.id, embedding);
          embedded++;
        }
      }
    } catch { /* non-critical */ }
  }

  // Step 5: Auto-sync to RuVector if available
  let synced = 0;
  if (backendType === 'sqlite' && backend.allForSync) {
    try {
      const rvConfig = getRuVectorConfig();
      if (rvConfig) {
        const rvBackend = new RuVectorBackend(rvConfig);
        await rvBackend.initialize();

        const allEntries = backend.allForSync(NAMESPACE);
        if (allEntries.length > 0) {
          // Add hash embeddings for vector search in RuVector
          const entriesToSync = allEntries.map(e => ({
            ...e,
            _embedding: createHashEmbedding(e.content),
          }));
          await rvBackend.bulkInsert(entriesToSync);
          synced = entriesToSync.length;
        }

        await rvBackend.shutdown();
      }
    } catch { /* RuVector sync is best-effort */ }
  }

  return { pruned, synced, decayed, embedded };
}

// ============================================================================
// Cross-session semantic retrieval
// ============================================================================

/**
 * Find relevant context from OTHER sessions using semantic similarity.
 * This enables "What did we discuss about auth?" across sessions.
 */
async function crossSessionSearch(backend, queryText, currentSessionId, k = 5) {
  if (!backend.semanticSearch) return [];
  try {
    const { embedding: queryEmb } = await createEmbedding(queryText);
    const results = backend.semanticSearch(queryEmb, k * 2, NAMESPACE);
    // Filter out current session entries (we already have those)
    return results
      .filter(r => r.sessionId !== currentSessionId)
      .slice(0, k);
  } catch { return []; }
}

// ============================================================================
// Context Autopilot Engine
// ============================================================================

/**
 * Estimate context token usage from transcript JSONL.
 *
 * Primary method: Read the most recent assistant message's `usage` field which
 * contains `input_tokens` + `cache_read_input_tokens` — this is the ACTUAL
 * context size as reported by the Claude API. This includes system prompt,
 * CLAUDE.md, tool definitions, all messages, and everything Claude sees.
 *
 * Fallback: Sum character lengths and divide by CHARS_PER_TOKEN.
 */
function estimateContextTokens(transcriptPath) {
  if (!existsSync(transcriptPath)) return { tokens: 0, turns: 0, method: 'none' };

  const content = readFileSync(transcriptPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  // Track the most recent usage data (from the last assistant message)
  let lastInputTokens = 0;
  let lastCacheRead = 0;
  let lastCacheCreate = 0;
  let turns = 0;
  let lastPreTokens = 0;
  let totalChars = 0;

  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]);

      // Check for compact_boundary
      if (parsed.type === 'system' && parsed.subtype === 'compact_boundary') {
        lastPreTokens = parsed.compactMetadata?.preTokens
          || parsed.compact_metadata?.pre_tokens || 0;
        // Reset after compaction — new context starts here
        totalChars = 0;
        turns = 0;
        lastInputTokens = 0;
        lastCacheRead = 0;
        lastCacheCreate = 0;
        continue;
      }

      // Extract ACTUAL token usage from assistant messages
      // The SDK transcript stores: { message: { role, content, usage: { input_tokens, cache_read_input_tokens, ... } } }
      const msg = parsed.message || parsed;
      const usage = msg.usage;
      if (usage && (msg.role === 'assistant' || parsed.type === 'assistant')) {
        const inputTokens = usage.input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        const cacheCreate = usage.cache_creation_input_tokens || 0;

        // The total context sent to Claude = input_tokens + cache_read + cache_create
        // input_tokens: non-cached tokens actually processed
        // cache_read: tokens served from cache (still in context)
        // cache_create: tokens newly cached (still in context)
        const totalContext = inputTokens + cacheRead + cacheCreate;

        if (totalContext > 0) {
          lastInputTokens = inputTokens;
          lastCacheRead = cacheRead;
          lastCacheCreate = cacheCreate;
        }
      }

      // Count turns for display
      const role = msg.role || parsed.type;
      if (role === 'user') turns++;

      // Char fallback accumulation
      if (role === 'user' || role === 'assistant') {
        const c = msg.content;
        if (typeof c === 'string') totalChars += c.length;
        else if (Array.isArray(c)) {
          for (const block of c) {
            if (block.text) totalChars += block.text.length;
            else if (block.input) totalChars += JSON.stringify(block.input).length;
          }
        }
      }
    } catch { /* skip */ }
  }

  // Primary: use actual API usage data
  const actualTotal = lastInputTokens + lastCacheRead + lastCacheCreate;
  if (actualTotal > 0) {
    return {
      tokens: actualTotal,
      turns,
      method: 'api-usage',
      lastPreTokens,
      breakdown: {
        input: lastInputTokens,
        cacheRead: lastCacheRead,
        cacheCreate: lastCacheCreate,
      },
    };
  }

  // Fallback: char-based estimate
  const estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);
  if (lastPreTokens > 0) {
    const compactSummaryTokens = 3000;
    return {
      tokens: compactSummaryTokens + estimatedTokens,
      turns,
      method: 'post-compact-char-estimate',
      lastPreTokens,
    };
  }

  return { tokens: estimatedTokens, turns, method: 'char-estimate' };
}

/**
 * Load autopilot state (persisted across hook invocations).
 */
function loadAutopilotState() {
  try {
    if (existsSync(AUTOPILOT_STATE_PATH)) {
      return JSON.parse(readFileSync(AUTOPILOT_STATE_PATH, 'utf-8'));
    }
  } catch { /* fresh state */ }
  return {
    sessionId: null,
    lastTokenEstimate: 0,
    lastPercentage: 0,
    pruneCount: 0,
    warningIssued: false,
    lastCheck: 0,
    history: [], // Track token growth over time
  };
}

/**
 * Save autopilot state.
 */
function saveAutopilotState(state) {
  try {
    writeFileSync(AUTOPILOT_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* best effort */ }
}

/**
 * Build a context optimization report for additionalContext injection.
 */
function buildAutopilotReport(percentage, tokens, windowSize, turns, state) {
  const bar = buildProgressBar(percentage);
  const status = percentage >= AUTOPILOT_PRUNE_PCT
    ? 'OPTIMIZING'
    : percentage >= AUTOPILOT_WARN_PCT
      ? 'WARNING'
      : 'OK';

  const parts = [
    `[ContextAutopilot] ${bar} ${(percentage * 100).toFixed(1)}% context used`,
    `(~${formatTokens(tokens)}/${formatTokens(windowSize)} tokens, ${turns} turns)`,
    `Status: ${status}`,
  ];

  if (state.pruneCount > 0) {
    parts.push(`| Optimizations: ${state.pruneCount} prune cycles`);
  }

  // Add trend if we have history
  if (state.history.length >= 2) {
    const recent = state.history.slice(-3);
    const avgGrowth = recent.reduce((sum, h, i) => {
      if (i === 0) return 0;
      return sum + (h.pct - recent[i - 1].pct);
    }, 0) / (recent.length - 1);

    if (avgGrowth > 0) {
      const turnsUntilFull = Math.ceil((1.0 - percentage) / avgGrowth);
      parts.push(`| ~${turnsUntilFull} turns until optimization needed`);
    }
  }

  return parts.join(' ');
}

/**
 * Visual progress bar for context usage.
 */
function buildProgressBar(percentage) {
  const width = 20;
  const filled = Math.round(percentage * width);
  const empty = width - filled;
  const fillChar = percentage >= AUTOPILOT_PRUNE_PCT ? '!' : percentage >= AUTOPILOT_WARN_PCT ? '#' : '=';
  return `[${fillChar.repeat(filled)}${'-'.repeat(empty)}]`;
}

/**
 * Format token count for display.
 */
function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/**
 * Context Autopilot: run on every UserPromptSubmit.
 * Returns { additionalContext, shouldBlock } for the hook output.
 */
async function runAutopilot(transcriptPath, sessionId, backend, backendType) {
  const state = loadAutopilotState();

  // Reset state if session changed
  if (state.sessionId !== sessionId) {
    state.sessionId = sessionId;
    state.lastTokenEstimate = 0;
    state.lastPercentage = 0;
    state.pruneCount = 0;
    state.warningIssued = false;
    state.history = [];
  }

  // Estimate current context usage
  const { tokens, turns, method, lastPreTokens } = estimateContextTokens(transcriptPath);
  const percentage = Math.min(tokens / CONTEXT_WINDOW_TOKENS, 1.0);

  // Track history (keep last 50 data points)
  state.history.push({ ts: Date.now(), tokens, pct: percentage, turns });
  if (state.history.length > 50) state.history.shift();

  state.lastTokenEstimate = tokens;
  state.lastPercentage = percentage;
  state.lastCheck = Date.now();

  let optimizationMessage = '';

  // Phase 1: Warning zone (70-85%) — advise concise responses
  if (percentage >= AUTOPILOT_WARN_PCT && percentage < AUTOPILOT_PRUNE_PCT) {
    if (!state.warningIssued) {
      state.warningIssued = true;
      optimizationMessage = ` | Context at ${(percentage * 100).toFixed(0)}%. Keep responses concise to extend session.`;
    }
  }

  // Phase 2: Critical zone (85%+) — session rotation needed
  if (percentage >= AUTOPILOT_PRUNE_PCT) {
    state.pruneCount++;

    // Prune stale entries from archive to free up storage
    if (backend.pruneStale) {
      try {
        const pruned = backend.pruneStale(NAMESPACE, Math.min(RETENTION_DAYS, 7));
        if (pruned > 0) {
          optimizationMessage += ` | Pruned ${pruned} stale archive entries.`;
        }
      } catch { /* non-critical */ }
    }

    const turnsLeft = Math.max(0, Math.ceil((1.0 - percentage) / 0.03));
    optimizationMessage += ` | CRITICAL: ${(percentage * 100).toFixed(0)}% context used (~${turnsLeft} turns left). All ${turns} turns archived. Start a new session with /clear — context will be fully restored via SessionStart hook.`;
  }

  const report = buildAutopilotReport(percentage, tokens, CONTEXT_WINDOW_TOKENS, turns, state);
  saveAutopilotState(state);

  return {
    additionalContext: report + optimizationMessage,
    percentage,
    tokens,
    turns,
    method,
    state,
  };
}

// ============================================================================
// Commands
// ============================================================================

async function doPreCompact() {
  const input = await readStdin(200);
  if (!input) return;

  const { session_id: sessionId, transcript_path: transcriptPath, trigger } = input;
  if (!transcriptPath || !sessionId) return;

  const messages = parseTranscript(transcriptPath);
  if (messages.length === 0) return;

  const chunks = chunkTranscript(messages);
  if (chunks.length === 0) return;

  const { backend, type } = await resolveBackend();

  const archiveResult = await storeChunks(backend, chunks, sessionId, trigger || 'auto');

  // Auto-optimize: prune stale entries + sync to RuVector if available
  const optimizeResult = await autoOptimize(backend, type);

  const total = await backend.count(NAMESPACE);
  await backend.shutdown();

  const optParts = [];
  if (optimizeResult.pruned > 0) optParts.push(`${optimizeResult.pruned} pruned`);
  if (optimizeResult.decayed > 0) optParts.push(`${optimizeResult.decayed} decayed`);
  if (optimizeResult.embedded > 0) optParts.push(`${optimizeResult.embedded} embedded`);
  if (optimizeResult.synced > 0) optParts.push(`${optimizeResult.synced} synced`);
  const optimizeMsg = optParts.length > 0 ? ` Optimized: ${optParts.join(', ')}.` : '';
  process.stderr.write(
    `[ContextPersistence] Archived ${archiveResult.stored} turns (${archiveResult.deduped} deduped) via ${type}. Total: ${total}.${optimizeMsg}\n`
  );

  // Exit code 0: stdout is appended as custom compact instructions
  // This guides Claude on what to preserve in the compaction summary
  const instructions = buildCompactInstructions(chunks, sessionId, archiveResult);
  process.stdout.write(instructions);

  // Context Autopilot: track state and log archival status
  // NOTE: Claude Code 2.0.76 executePreCompactHooks uses executeHooksOutsideREPL
  // which does NOT support exit code 2 blocking. Compaction always proceeds.
  // Our "infinite context" comes from archive + restore, not blocking.
  if (AUTOPILOT_ENABLED) {
    const state = loadAutopilotState();
    const pct = state.lastPercentage || 0;
    const bar = buildProgressBar(pct);

    process.stderr.write(
      `[ContextAutopilot] ${bar} ${(pct * 100).toFixed(1)}% | ${trigger} compact — ${chunks.length} turns archived. Context will be restored after compaction.\n`
    );

    // Reset autopilot state for post-compaction fresh start
    state.lastTokenEstimate = 0;
    state.lastPercentage = 0;
    state.warningIssued = false;
    saveAutopilotState(state);
  }
}

async function doSessionStart() {
  const input = await readStdin(200);

  // Restore context after compaction OR after /clear (session rotation)
  // With DISABLE_COMPACT, /clear is the primary way to free context
  if (!input || (input.source !== 'compact' && input.source !== 'clear')) return;

  const sessionId = input.session_id;
  if (!sessionId) return;

  const { backend, type } = await resolveBackend();

  // Use smart retrieval (importance-ranked) when auto-optimize is on
  let additionalContext;
  if (AUTO_OPTIMIZE) {
    const { text, accessedIds } = await retrieveContextSmart(backend, sessionId, RESTORE_BUDGET);
    additionalContext = text;

    // Track which entries were actually restored (access pattern learning)
    if (accessedIds.length > 0 && backend.markAccessed) {
      try { backend.markAccessed(accessedIds); } catch { /* non-critical */ }
    }

    if (accessedIds.length > 0) {
      process.stderr.write(
        `[ContextPersistence] Smart restore: ${accessedIds.length} turns (importance-ranked) via ${type}\n`
      );
    }
  } else {
    additionalContext = await retrieveContext(backend, sessionId, RESTORE_BUDGET);
  }

  await backend.shutdown();

  if (!additionalContext) return;

  const output = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(output));
}

// ============================================================================
// Proactive archiving on every user prompt (prevents context cliff)
// ============================================================================

async function doUserPromptSubmit() {
  const input = await readStdin(200);
  if (!input) return;

  const { session_id: sessionId, transcript_path: transcriptPath } = input;
  if (!transcriptPath || !sessionId) return;

  const messages = parseTranscript(transcriptPath);
  if (messages.length === 0) return;

  const chunks = chunkTranscript(messages);
  if (chunks.length === 0) return;

  const { backend, type } = await resolveBackend();

  // Only archive new turns (dedup handles the rest, but we can skip early
  // by only processing the last N chunks since the previous archive)
  const existingCount = backend.queryBySession
    ? (await backend.queryBySession(NAMESPACE, sessionId)).length
    : 0;

  // Skip if we've already archived most turns (within 2 turns tolerance)
  const skipArchive = existingCount > 0 && chunks.length - existingCount <= 2;

  let archiveMsg = '';
  if (!skipArchive) {
    const result = await storeChunks(backend, chunks, sessionId, 'proactive');
    if (result.stored > 0) {
      const total = await backend.count(NAMESPACE);
      archiveMsg = `[ContextPersistence] Proactively archived ${result.stored} turns (total: ${total}).`;
      process.stderr.write(
        `[ContextPersistence] Proactive archive: ${result.stored} new, ${result.deduped} deduped via ${type}. Total: ${total}\n`
      );
    }
  }

  // Context Autopilot: estimate usage and report percentage
  let autopilotMsg = '';
  if (AUTOPILOT_ENABLED && transcriptPath) {
    try {
      const autopilot = await runAutopilot(transcriptPath, sessionId, backend, type);
      autopilotMsg = autopilot.additionalContext;

      process.stderr.write(
        `[ContextAutopilot] ${(autopilot.percentage * 100).toFixed(1)}% context used (~${formatTokens(autopilot.tokens)} tokens, ${autopilot.turns} turns, ${autopilot.method})\n`
      );
    } catch (err) {
      process.stderr.write(`[ContextAutopilot] Error: ${err.message}\n`);
    }
  }

  await backend.shutdown();

  // Combine archive message and autopilot report
  const additionalContext = [archiveMsg, autopilotMsg].filter(Boolean).join(' ');

  if (additionalContext) {
    const output = {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext,
      },
    };
    process.stdout.write(JSON.stringify(output));
  }
}

async function doStatus() {
  const { backend, type } = await resolveBackend();

  const total = await backend.count();
  const archiveCount = await backend.count(NAMESPACE);
  const namespaces = await backend.listNamespaces();
  const sessions = await backend.listSessions(NAMESPACE);

  console.log('\n=== Context Persistence Archive Status ===\n');
  const backendLabel = {
    sqlite: ARCHIVE_DB_PATH,
    ruvector: `${process.env.RUVECTOR_HOST || 'N/A'}:${process.env.RUVECTOR_PORT || '5432'}`,
    agentdb: 'in-memory HNSW',
    json: ARCHIVE_JSON_PATH,
  };
  console.log(`  Backend:     ${type} (${backendLabel[type] || type})`);
  console.log(`  Total:       ${total} entries`);
  console.log(`  Transcripts: ${archiveCount} entries`);
  console.log(`  Namespaces:  ${namespaces.join(', ') || 'none'}`);
  console.log(`  Budget:      ${RESTORE_BUDGET} chars`);
  console.log(`  Sessions:    ${sessions.length}`);
  console.log(`  Proactive:   enabled (UserPromptSubmit hook)`);
  console.log(`  Auto-opt:    ${AUTO_OPTIMIZE ? 'enabled' : 'disabled'} (importance ranking, pruning, sync)`);
  console.log(`  Retention:   ${RETENTION_DAYS} days (prune never-accessed entries)`);
  const rvConfig = getRuVectorConfig();
  console.log(`  RuVector:    ${rvConfig ? `${rvConfig.host}:${rvConfig.port}/${rvConfig.database} (auto-sync enabled)` : 'not configured'}`);

  // Self-learning stats
  if (type === 'sqlite' && backend.db) {
    try {
      const embCount = backend.db.prepare('SELECT COUNT(*) as cnt FROM transcript_entries WHERE embedding IS NOT NULL').get().cnt;
      const avgConf = backend.db.prepare('SELECT AVG(confidence) as avg FROM transcript_entries WHERE namespace = ?').get(NAMESPACE)?.avg || 0;
      const lowConf = backend.db.prepare('SELECT COUNT(*) as cnt FROM transcript_entries WHERE namespace = ? AND confidence < 0.3').get(NAMESPACE).cnt;
      console.log('');
      console.log('  --- Self-Learning ---');
      console.log(`  Embeddings:  ${embCount}/${archiveCount} entries have vector embeddings`);
      console.log(`  Avg conf:    ${(avgConf * 100).toFixed(1)}% (decay: -0.5%/hr, boost: +3%/access)`);
      console.log(`  Low conf:    ${lowConf} entries below 30% (pruned at 15%)`);
      console.log(`  Semantic:    ${embCount > 0 ? 'enabled (cross-session search)' : 'pending (embeddings generating)'}`);
    } catch { /* stats are non-critical */ }
  }

  // Autopilot status
  console.log('');
  console.log('  --- Context Autopilot ---');
  console.log(`  Enabled:     ${AUTOPILOT_ENABLED}`);
  console.log(`  Window:      ${formatTokens(CONTEXT_WINDOW_TOKENS)} tokens`);
  console.log(`  Warn at:     ${(AUTOPILOT_WARN_PCT * 100).toFixed(0)}%`);
  console.log(`  Prune at:    ${(AUTOPILOT_PRUNE_PCT * 100).toFixed(0)}%`);
  console.log(`  Compaction:  LOSSLESS (archive before, restore after)`);

  const apState = loadAutopilotState();
  if (apState.sessionId) {
    const pct = apState.lastPercentage || 0;
    const bar = buildProgressBar(pct);
    console.log(`  Current:     ${bar} ${(pct * 100).toFixed(1)}% (~${formatTokens(apState.lastTokenEstimate)} tokens)`);
    console.log(`  Prune cycles: ${apState.pruneCount}`);
    if (apState.history.length >= 2) {
      const first = apState.history[0];
      const last = apState.history[apState.history.length - 1];
      const growthRate = (last.pct - first.pct) / apState.history.length;
      if (growthRate > 0) {
        const turnsLeft = Math.ceil((1.0 - pct) / growthRate);
        console.log(`  Est. runway: ~${turnsLeft} turns until prune threshold`);
      }
    }
  }

  if (sessions.length > 0) {
    console.log('\n  Recent sessions:');
    for (const s of sessions.slice(0, 10)) {
      console.log(`    - ${s.session_id}: ${s.cnt} turns`);
    }
  }

  console.log('');
  await backend.shutdown();
}

// ============================================================================
// Exports for testing
// ============================================================================

export {
  SQLiteBackend,
  RuVectorBackend,
  JsonFileBackend,
  resolveBackend,
  getRuVectorConfig,
  createEmbedding,
  createHashEmbedding,
  getOnnxPipeline,
  EMBEDDING_DIM,
  hashContent,
  parseTranscript,
  extractTextContent,
  extractToolCalls,
  extractFilePaths,
  chunkTranscript,
  extractSummary,
  buildEntry,
  buildCompactInstructions,
  computeImportance,
  retrieveContextSmart,
  autoOptimize,
  crossSessionSearch,
  storeChunks,
  retrieveContext,
  readStdin,
  // Autopilot
  estimateContextTokens,
  loadAutopilotState,
  saveAutopilotState,
  runAutopilot,
  buildProgressBar,
  formatTokens,
  buildAutopilotReport,
  NAMESPACE,
  ARCHIVE_DB_PATH,
  ARCHIVE_JSON_PATH,
  COMPACT_INSTRUCTION_BUDGET,
  RETENTION_DAYS,
  AUTO_OPTIMIZE,
  AUTOPILOT_ENABLED,
  CONTEXT_WINDOW_TOKENS,
  AUTOPILOT_WARN_PCT,
  AUTOPILOT_PRUNE_PCT,
};

// ============================================================================
// Main
// ============================================================================

const command = process.argv[2] || 'status';

try {
  switch (command) {
    case 'pre-compact': await doPreCompact(); break;
    case 'session-start': await doSessionStart(); break;
    case 'user-prompt-submit': await doUserPromptSubmit(); break;
    case 'status': await doStatus(); break;
    default:
      console.log('Usage: context-persistence-hook.mjs <pre-compact|session-start|user-prompt-submit|status>');
      process.exit(1);
  }
} catch (err) {
  // Hooks must never crash Claude Code - fail silently
  process.stderr.write(`[ContextPersistence] Error (non-critical): ${err.message}\n`);
}
