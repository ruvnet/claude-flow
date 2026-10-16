/**
 * Memory MCP Tools for CLI - V3 with sql.js/HNSW Backend
 *
 * UPGRADED: Now uses the advanced sql.js + HNSW backend for:
 * - 150x-12,500x faster semantic search
 * - Vector embeddings with cosine similarity
 * - Persistent SQLite storage (WASM)
 * - Backward compatible with legacy JSON storage (auto-migrates)
 *
 * @module v3/cli/mcp-tools/memory-tools
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'crypto';
import { getProjectCwd, type MCPTool } from './types.js';
import { validateIdentifier } from './validate-input.js';
import { DEFAULT_SEARCH_THRESHOLD, nearMisses } from '../memory/search-defaults.js';

// Legacy JSON store interface (for migration)
interface LegacyMemoryEntry {
  key: string;
  value: unknown;
  metadata?: Record<string, unknown>;
  storedAt: string;
  accessCount: number;
  lastAccessed: string;
}

interface LegacyMemoryStore {
  entries: Record<string, LegacyMemoryEntry>;
  version: string;
}

// #1604: Align with memory-initializer.ts — single source of truth is .swarm/memory.db
const MEMORY_DIR = '.swarm';
const LEGACY_MEMORY_FILE = 'store.json';
const LEGACY_MEMORY_DIR = '.claude-flow/memory';
const MIGRATION_MARKER = '.migrated-to-sqlite';

function getMemoryDir(): string {
  return resolve(MEMORY_DIR);
}

function getLegacyPath(): string {
  return resolve(join(MEMORY_DIR, LEGACY_MEMORY_FILE));
}

function getMigrationMarkerPath(): string {
  return resolve(join(MEMORY_DIR, MIGRATION_MARKER));
}

function ensureMemoryDir(): void {
  const dir = getMemoryDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// D-2: Input bounds for memory parameters
const MAX_KEY_LENGTH = 1024;
const MAX_VALUE_SIZE = 1024 * 1024; // 1MB
const MAX_QUERY_LENGTH = 4096;

// #1425 — single source of truth for the dangerous-character set rejected by
// validateMemoryInput. Imported by sanitizeMemoryKey so write-side sanitization
// and read-side rejection can never drift apart (the symmetry bug behind #1884).
const DANGEROUS_KEY_CHARS = /[;&|`$(){}[\]<>!#\\\0]|\.\.[/\\]/g;
export const DANGEROUS_KEY_PATTERN = /[;&|`$(){}[\]<>!#\\\0]|\.\.[/\\]/;

/**
 * #3570: the one key rule for every memory write path (MCP store, CLI store,
 * import). Plain `/` stays legal (`probe/x`); traversal and shell metacharacters
 * do not. Returns the error message, or null when the key is acceptable.
 */
export function memoryKeyError(key: string): string | null {
  return DANGEROUS_KEY_PATTERN.test(key) ? 'Key contains disallowed characters' : null;
}

function validateMemoryInput(key?: string, value?: string, query?: string, namespace?: string): void {
  if (key && key.length > MAX_KEY_LENGTH) {
    throw new Error(`Key exceeds maximum length of ${MAX_KEY_LENGTH} characters`);
  }
  if (value && value.length > MAX_VALUE_SIZE) {
    throw new Error(`Value exceeds maximum size of ${MAX_VALUE_SIZE} bytes`);
  }
  if (query && query.length > MAX_QUERY_LENGTH) {
    throw new Error(`Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`);
  }
  // Reject path traversal and shell metacharacters in keys/namespaces (#1425)
  const keyError = key ? memoryKeyError(key) : null;
  if (keyError) throw new Error(keyError);
  if (namespace && DANGEROUS_KEY_PATTERN.test(namespace)) {
    throw new Error('Namespace contains disallowed characters');
  }
}

/**
 * #3374 — presence check for a schema-`required` string parameter.
 *
 * `validateMemoryInput` above is a bounds-and-charset validator: every branch
 * is truthiness-guarded, so an omitted parameter passes it silently. Nothing
 * else enforces `inputSchema.required` for these tools, so without this an
 * omitted `query` travelled down to `generateHashEmbedding`'s
 * `text.toLowerCase()` and came back as an unrelated TypeError.
 */
const MISSING_REQUIRED_PARAM = 'MISSING_REQUIRED_PARAM' as const;

function missingRequiredString(
  input: Record<string, unknown>,
  param: string,
  tool: string,
): { error: string; code: typeof MISSING_REQUIRED_PARAM } | null {
  const v = input[param];
  if (typeof v === 'string' && v.length > 0) return null;
  const got = v === undefined ? 'it was omitted' : v === '' ? 'it was an empty string' : `got ${v === null ? 'null' : typeof v}`;
  return {
    error: `${tool}: required parameter "${param}" must be a non-empty string (${got})`,
    code: MISSING_REQUIRED_PARAM,
  };
}

// #1884 — sanitize a key produced from arbitrary input (markdown headings,
// frontmatter names, file names) so it survives validateMemoryInput on the
// read/delete path. Replaces every dangerous char with `_`. Truncates to
// MAX_KEY_LENGTH so the bound check in validateMemoryInput also passes.
// Keep this in sync with DANGEROUS_KEY_PATTERN — they share DANGEROUS_KEY_CHARS.
function sanitizeMemoryKey(key: string): string {
  const safe = key.replace(DANGEROUS_KEY_CHARS, '_');
  return safe.length > MAX_KEY_LENGTH ? safe.slice(0, MAX_KEY_LENGTH) : safe;
}

// #1937 — minimal glob → RegExp helper for memory_import_claude exclusion
// patterns. Anchored. Supports the three operators the issue's voice-fidelity
// workflow needs:
//   `**` — any chars including path separators
//   `*`  — any chars except path separators
//   `?`  — exactly one char except a path separator
// Everything else is regex-escaped. Used to match absolute file paths.
function globToRegex(pattern: string): RegExp {
  // Tokenize so we can replace `**` before `*` without overlap.
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i++;
    } else if (c === '*') {
      out += '[^/\\\\]*';
    } else if (c === '?') {
      out += '[^/\\\\]';
    } else if (/[.+^$|(){}\[\]\\]/.test(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
  }
  return new RegExp('^' + out + '$');
}

// #1883 — resolve the Claude-Code project memory directory for the *current*
// project. Claude Code hashes the project path differently per host OS, and
// our previous logic only POSIX-slash-replaced cwd, which breaks for:
//   - WSL bridges where cwd is `/mnt/<drive>/...` but Claude Code is on Windows
//   - paths containing spaces (Claude Code replaces spaces with dashes)
//   - any leading slash on POSIX (Claude Code strips it)
// Strategy: try several candidate hashes and return the first one with a
// memory dir that exists. An explicit `projectPathOverride` short-circuits
// the heuristics for callers that know the canonical project path.
function resolveProjectMemoryDir(claudeProjectsDir: string, projectPathOverride?: string): { memDir: string; projectHash: string } | null {
  const candidates = new Set<string>();
  const sources: string[] = [];

  if (projectPathOverride && projectPathOverride.length > 0) {
    sources.push(projectPathOverride);
  } else {
    const project = getProjectCwd();
    sources.push(project);
    // Claude Code shares auto-memory across linked Git worktrees under the
    // main checkout's project slug. Preserve the direct-path match first,
    // then try the common Git directory's parent. Explicit overrides above
    // remain authoritative, and non-Git projects need no Git dependency.
    try {
      const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: project,
        encoding: 'utf-8',
        timeout: 1000,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (basename(commonDir) === '.git') sources.push(dirname(resolve(project, commonDir)));
    } catch { /* Git unavailable or not a repository: use the project path */ }
  }

  for (const source of sources) {
    // Candidate 1: legacy POSIX hash — what shipped before #1883
    candidates.add(source.replace(/\//g, '-'));

    // Candidate 2: WSL `/mnt/<drive>/...` translated to Claude-Code Windows hash
    // e.g. `/mnt/c/Users/x/Project Name` → `C--Users-x-Project-Name`
    const wsl = source.match(/^\/mnt\/([a-z])(\/.*)?$/i);
    if (wsl) {
      const drive = wsl[1].toUpperCase();
      const rest = (wsl[2] ?? '').replace(/\//g, '-').replace(/ /g, '-');
      candidates.add(`${drive}-${rest}`);
    }

    // Candidate 3: POSIX hash with leading dash stripped (Claude Code on macOS/Linux)
    const stripped = source.replace(/\//g, '-').replace(/^-+/, '');
    candidates.add(stripped);

    // Candidate 4: spaces replaced with dashes (Claude Code's space rule)
    candidates.add(source.replace(/\//g, '-').replace(/ /g, '-'));

    // Candidate 5 (#1939): native Win32 path on a Win32 Claude Code install.
    // `C:\Users\tobia\OneDrive\Desktop\Claude Stuff` →
    // `C--Users-tobia-OneDrive-Desktop-Claude-Stuff`. Claude Code's on-disk
    // slug replaces drive-colon AND backslashes AND whitespace with `-`.
    // The earlier candidates only handled forward slashes, so a Win32+Win32
    // setup never matched.
    if (/^[A-Za-z]:[\\/]/.test(source)) {
      candidates.add(source.replace(/[:\\/]/g, '-').replace(/\s+/g, '-'));
    }
  }

  for (const projectHash of candidates) {
    const memDir = join(claudeProjectsDir, projectHash, 'memory');
    if (existsSync(memDir)) return { memDir, projectHash };
  }
  return null;
}

/**
 * Check if legacy JSON store exists in old .claude-flow/memory/ location
 */
function hasLegacyStore(): boolean {
  const legacyPath = resolve(join(LEGACY_MEMORY_DIR, LEGACY_MEMORY_FILE));
  const migrationMarker = resolve(join(LEGACY_MEMORY_DIR, MIGRATION_MARKER));
  return existsSync(legacyPath) && !existsSync(migrationMarker);
}

/**
 * Load legacy JSON store for migration
 */
function loadLegacyStore(): LegacyMemoryStore | null {
  try {
    const legacyPath = resolve(join(LEGACY_MEMORY_DIR, LEGACY_MEMORY_FILE));
    if (existsSync(legacyPath)) {
      const data = readFileSync(legacyPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return null on error
  }
  return null;
}

/**
 * Mark migration as complete
 */
function markMigrationComplete(): void {
  const legacyDir = resolve(LEGACY_MEMORY_DIR);
  if (!existsSync(legacyDir)) mkdirSync(legacyDir, { recursive: true });
  writeFileSync(resolve(join(LEGACY_MEMORY_DIR, MIGRATION_MARKER)), JSON.stringify({
    migratedAt: new Date().toISOString(),
    version: '3.0.0',
  }), 'utf-8');
}

/**
 * Lazy-load memory initializer functions to avoid circular deps
 */
async function getMemoryFunctions() {
  const {
    storeEntry,
    searchEntries,
    listEntries,
    getEntry,
    deleteEntry,
    initializeMemoryDatabase,
    checkMemoryInitialization,
  } = await import('../memory/memory-initializer.js');

  return {
    storeEntry,
    searchEntries,
    listEntries,
    getEntry,
    deleteEntry,
    initializeMemoryDatabase,
    checkMemoryInitialization,
  };
}

/**
 * Path of the CLI's own store (.swarm/memory.db or CLAUDE_FLOW_DB_PATH), or
 * undefined when the memory module cannot say (#4148). Never throws.
 */
async function resolveCliStorePath(): Promise<string | undefined> {
  try {
    const mod = await import('../memory/memory-initializer.js');
    return typeof mod.resolveDbPath === 'function' ? mod.resolveDbPath() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * #2922: every `backend:` field in this file's tool responses used to be the
 * hardcoded literal `'sql.js + HNSW'` regardless of which search path was
 * actually active — most of the time that's the bridge doing a brute-force
 * cosine scan, not HNSW. This reports the real algorithm via the same
 * capability probe `getHNSWStatus()` already exposes.
 */
async function describeBackend(): Promise<string> {
  try {
    const { getHNSWStatus } = await import('../memory/memory-initializer.js');
    const status = getHNSWStatus();
    if (status.algorithm !== 'hnsw') return 'sqlite (bridge, brute-force cosine)';

    // #3228: with the native bridge gated off (the Windows default since
    // 3.38.12), memory tools silently fall back to the sql.js store rather
    // than the AgentDB corpus the bridge would have opened. A bare
    // "sql.js + HNSW" hides that substitution — an upgrade can change which
    // file receives writes while store/retrieve smoke tests still pass,
    // because both operations use the same unintended file. Name the gate.
    try {
      const { shouldDisableNativeBridge, getBridgeFailureReason } = await import(
        '../memory/memory-bridge.js'
      );
      if (shouldDisableNativeBridge()) {
        const reason = getBridgeFailureReason();
        return `sql.js + HNSW (native bridge disabled${reason ? `: ${reason}` : ''})`;
      }
    } catch {
      // bridge module unavailable — the plain sql.js label is already accurate
    }
    return 'sql.js + HNSW';
  } catch {
    return 'sqlite';
  }
}

/** #3311: one page per round trip, so a store larger than one page is
 * counted rather than silently cut off at the old hardcoded 100000. */
const MEMORY_STATS_PAGE = 10000;

/** #3311: a hard stop so a `total` that never agrees with the rows returned
 * cannot spin forever. Reaching it is reported as a truncated count, not as
 * a complete one. */
const MEMORY_STATS_MAX_PAGES = 200;

/** The shape one page of `listEntries` comes back in, generic over the row
 * type so paging does not widen or narrow what the caller already has. */
type ListPage<E> = {
  success: boolean;
  entries: E[];
  total: number;
  error?: string;
};

/**
 * Page through the store and return every row, or the first failure.
 *
 * The old call asked for `limit: 100000` in one shot and read only
 * `entries`/`total` off the result — so a bigger store had its namespace
 * breakdown and embedding coverage computed from a prefix, and a listing
 * that reported `success: false` was read as an empty one.
 */
async function collectAllEntries<E>(
  listEntries: (options: { limit?: number; offset?: number; dbPath?: string }) => Promise<ListPage<E>>,
  dbPath?: string,
): Promise<ListPage<E>> {
  const entries: E[] = [];
  let total = 0;

  for (let page = 0; page < MEMORY_STATS_MAX_PAGES; page++) {
    const result = await listEntries({ limit: MEMORY_STATS_PAGE, offset: entries.length, dbPath });
    if (!result.success) {
      return { success: false, entries, total: result.total ?? total, error: result.error };
    }
    total = result.total;
    entries.push(...result.entries);
    if (result.entries.length === 0 || entries.length >= total) break;
  }

  return { success: true, entries, total };
}

/** #3311: unavailable is its own answer. The zeros this replaces were
 * indistinguishable from a store that really is empty. */
function memoryStatsUnavailable(error: string): {
  initialized: null;
  available: false;
  error: string;
} {
  return { initialized: null, available: false, error };
}

/**
 * Version and feature labels from the initialization probe.
 *
 * Metadata only. The probe reads a whole-image snapshot that cannot see live
 * WAL frames, so it is allowed to fail without that meaning the store is
 * missing — which is exactly the conflation #3311 reports.
 */
async function readMemoryStatusLabels(dbPath?: string): Promise<{
  version?: string;
  features?: { vectorEmbeddings: boolean; patternLearning: boolean; temporalDecay: boolean };
}> {
  try {
    const { checkMemoryInitialization } = await getMemoryFunctions();
    const status = await checkMemoryInitialization(dbPath);
    return { version: status.version, features: status.features };
  } catch {
    return {};
  }
}

/**
 * Ensure memory database is initialized and migrate legacy data if needed.
 * #1606: Wrapped in try/catch to prevent process-level crashes that kill
 * the stdio MCP transport on Windows/Codex.
 */
async function ensureInitialized(dbPath?: string): Promise<void> {
  try {
    const { initializeMemoryDatabase, checkMemoryInitialization, storeEntry } = await getMemoryFunctions();

    // Check if already initialized
    const status = await checkMemoryInitialization(dbPath);
    if (!status.initialized) {
      await initializeMemoryDatabase({ force: false, verbose: false, dbPath });
    }

    // Migrate legacy JSON data if exists (from old .claude-flow/memory/ location)
    // A custom import target must not consume the one-time migration marker
    // for the project's normal memory store.
    if (hasLegacyStore()) {
      const { resolveDbPath } = await import('../memory/memory-initializer.js');
      if (!dbPath || dbPath === resolveDbPath()) {
        const legacyStore = loadLegacyStore();
        if (legacyStore && Object.keys(legacyStore.entries).length > 0) {
          console.error('[MCP Memory] Migrating legacy JSON store to sql.js...');
          let migrated = 0;

          for (const [key, entry] of Object.entries(legacyStore.entries)) {
            try {
              const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
              await storeEntry({
                key,
                value,
                namespace: 'default',
                generateEmbeddingFlag: true,
                dbPath,
              });
              migrated++;
            } catch (e) {
              console.error(`[MCP Memory] Failed to migrate key "${key}":`, e);
            }
          }

          console.error(`[MCP Memory] Migrated ${migrated}/${Object.keys(legacyStore.entries).length} entries`);
          markMigrationComplete();
        }
      }
    }
  } catch (error) {
    console.error('[MCP Memory] Initialization failed:', error instanceof Error ? error.message : error);
  }
}

export const memoryTools: MCPTool[] = [
  {
    name: 'memory_store',
    description: 'Persistent key-value store with vector embedding — survives across sessions and is searchable by meaning, not just by file path. Use when native Write is wrong because the data is not a file (e.g. a learned pattern, a decision, a budget config) AND you need to recall it later by semantic query, not by path. Defaults to namespace="default". Upsert semantics: writing an existing key updates it (matching the CLI `memory store` default); pass `upsert: false` to force strict-insert instead.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key (unique within namespace)' },
        value: { description: 'Value to store (string or object)' },
        namespace: { type: 'string', description: 'Namespace for organization (default: "default")' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for filtering',
        },
        ttl: { type: 'number', description: 'Time-to-live in seconds (optional)' },
        upsert: { type: 'boolean', description: 'Update existing key instead of failing (default: true, matching CLI `memory store`; set false for strict-insert). #2775 parity.' },
        provenance_type: {
          type: 'string',
          enum: ['user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'],
          description: 'ADR-323: who/what produced this value, so shared-namespace retrieval can filter by trust level instead of conflating a user\'s stated claim with an agent\'s own output. Default: "unknown".',
        },
      },
      required: ['key', 'value'],
    },
    handler: async (input) => {
      const missingKey = missingRequiredString(input, 'key', 'memory_store');
      if (missingKey) {
        return { success: false, key: input.key, stored: false, hasEmbedding: false, ...missingKey };
      }

      await ensureInitialized();
      const { storeEntry } = await getMemoryFunctions();

      const key = input.key as string;
      const namespace = (input.namespace as string) || 'default';
      const rawValue = input.value;
      const value = typeof rawValue === 'string' ? rawValue : (rawValue !== undefined ? JSON.stringify(rawValue) : '');
      const tags = (input.tags as string[]) || [];
      const ttl = input.ttl as number | undefined;
      // #2775 parity with CLI: default true; only explicit `upsert: false` opts out.
      const upsert = input.upsert !== false;
      // ADR-323: leave undefined when omitted so storeEntry's own default
      // ('unknown') applies uniformly across the CLI, MCP tool, and other callers.
      const provenanceType = input.provenance_type as string | undefined;

      if (!value) {
        return {
          success: false,
          key,
          stored: false,
          hasEmbedding: false,
          error: 'Value is required and cannot be empty',
        };
      }

      validateMemoryInput(key, value, undefined, namespace);
      // #3570: a namespace written here must be exportable and purgeable, so it
      // passes the same validator export and purge use.
      const vNs = validateIdentifier(namespace, 'namespace');
      if (!vNs.valid) throw new Error(vNs.error);

      const startTime = performance.now();

      try {
        const result = await storeEntry({
          key,
          value,
          namespace,
          generateEmbeddingFlag: true,
          tags,
          ttl,
          upsert,
          provenanceType,
        });

        const duration = performance.now() - startTime;

        return {
          success: result.success,
          key,
          namespace,
          stored: result.success,
          storedAt: new Date().toISOString(),
          hasEmbedding: !!result.embedding,
          embeddingDimensions: result.embedding?.dimensions || null,
          provenanceType: provenanceType || 'unknown',
          backend: await describeBackend(),
          storeTime: `${duration.toFixed(2)}ms`,
          error: result.error,
          // #3325: why hasEmbedding is false, when the bridge could not embed.
          ...(result.embeddingError ? { embeddingError: result.embeddingError } : {}),
        };
      } catch (error) {
        return {
          success: false,
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  },
  {
    name: 'memory_retrieve',
    description: 'Read back a value previously stored via memory_store, by exact (namespace, key) — lossless, includes metadata. Use when native Read is wrong because the value is not a file (it lives in the .swarm/memory.db SQLite store) AND you know the exact key. For semantic lookup by meaning, use memory_search.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Namespace (default: "default")' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const missingKey = missingRequiredString(input, 'key', 'memory_retrieve');
      if (missingKey) {
        return { key: input.key, namespace: input.namespace, value: null, found: false, ...missingKey };
      }

      await ensureInitialized();
      const { getEntry } = await getMemoryFunctions();

      const key = input.key as string;
      const namespace = (input.namespace as string) || 'default';

      validateMemoryInput(key, undefined, undefined, namespace);

      try {
        const result = await getEntry({ key, namespace });

        if (result.found && result.entry) {
          // Try to parse JSON value
          let value: unknown = result.entry.content;
          try {
            value = JSON.parse(result.entry.content);
          } catch {
            // Keep as string
          }

          return {
            key,
            namespace,
            value,
            tags: result.entry.tags,
            storedAt: result.entry.createdAt,
            updatedAt: result.entry.updatedAt,
            accessCount: result.entry.accessCount,
            hasEmbedding: result.entry.hasEmbedding,
            found: true,
            backend: await describeBackend(),
          };
        }

        return {
          key,
          namespace,
          value: null,
          found: false,
        };
      } catch (error) {
        return {
          key,
          namespace,
          value: null,
          found: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  },
  {
    name: 'memory_search',
    description: 'Find stored memories by meaning (vector similarity), not by literal text — finds "JWT auth pattern" when you query "token-based login flow". Use when native Grep is wrong because Grep matches characters and you need to find conceptually-related entries across past sessions. Returns top-k with similarity: raw retrieval relevance, which may include lexical scoring and is not guaranteed to be cosine similarity. With smart=true, similarity is the highest raw score across query variants; rankingScore is the composite relevance score used by the ranking pipeline, not cosine similarity, probability, or confidence. Diversity can change result order.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (semantic similarity)' },
        namespace: { type: 'string', description: 'Namespace to search (default: all namespaces — omit to search across every namespace)' },
        limit: { type: 'number', description: 'Maximum results (default: 10)' },
        threshold: { type: 'number', description: 'Minimum raw retrieval relevance 0-1 for candidate admission, applied per query before SmartRetrieval ranking; not a floor on rankingScore (default: 0.2; calibrated for the bundled embedding model, pass 0 to see every match)' },
        smart: { type: 'boolean', description: 'Enable SmartRetrieval — query expansion, RRF fusion, recency boost, MMR diversity; preserves raw similarity and adds rankingScore (default: false)' },
        provenance_filter: {
          type: 'array',
          items: { type: 'string', enum: ['user_claim', 'agent_output', 'system_observation', 'tool_result', 'unknown'] },
          description: 'ADR-323: restrict results to these provenance types (e.g. exclude user_claim when fact-checking). Omit for no filtering. Enforced for standard and SmartRetrieval searches.',
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const missingQuery = missingRequiredString(input, 'query', 'memory_search');
      if (missingQuery) {
        return { query: input.query, results: [], total: 0, ...missingQuery };
      }

      await ensureInitialized();
      const { searchEntries } = await getMemoryFunctions();

      const query = input.query as string;
      const provenanceFilter = input.provenance_filter as string[] | undefined;
      // #2646 (3rd occurrence of #1123/#1131 shape): do NOT coerce an omitted
      // namespace to the literal string 'default' here. Both searchEntries()
      // and bridgeSearchEntries() already resolve an omitted/undefined
      // namespace to 'all' (fan out across every namespace) — but 'default'
      // is truthy, so passing it defeats that fallback and silently scopes
      // the search to a namespace that is usually empty. Leave namespace
      // undefined when not provided so the underlying `|| 'all'` fallback
      // in the search layer actually fires.
      const namespace = input.namespace as string | undefined;
      const limit = (input.limit as number) ?? 10;
      const threshold = (input.threshold as number) ?? DEFAULT_SEARCH_THRESHOLD;
      const thresholdWasDefault = input.threshold === undefined || input.threshold === null;

      validateMemoryInput(undefined, undefined, query, namespace);

      const startTime = performance.now();

      try {
        // #1846: feature-detect smartSearch on the resolved memory package.
        // The export landed in @claude-flow/memory@>3.0.0-alpha.14 — older
        // installs pin to a build that exposes search/store/retrieve but
        // not smartSearch. Throwing `is not a function` is hostile; instead
        // detect at runtime and gracefully fall through to plain semantic
        // search with an explicit fallback note.
        let smartFallbackReason: string | undefined;
        if (input.smart) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let memMod: any;
          try {
            memMod = await import('@claude-flow/memory');
          } catch (err) {
            smartFallbackReason = `@claude-flow/memory failed to load: ${(err as Error).message}`;
          }
          const smartSearch = memMod && typeof memMod.smartSearch === 'function'
            ? memMod.smartSearch
            : undefined;

          if (smartSearch) {
            // SmartRetrieval pipeline (ADR-090)
            const rawSearch = async (req: { query: string; namespace?: string; limit?: number; threshold?: number }) => {
              const r = await searchEntries({
                query: req.query,
                namespace: req.namespace || namespace,
                limit: req.limit || limit * 3,
                threshold: req.threshold ?? threshold,
                provenanceFilter,
              });
              return {
                results: r.results.map(e => ({
                  id: e.id,
                  key: e.key,
                  content: e.content,
                  score: e.score,
                  rawScore: e.score,
                  namespace: e.namespace,
                  provenanceType: e.provenanceType,
                  // Dream Cycle 2026-09-03: thread the already-computed
                  // embedding through so SmartRetrieval's MMR step can use
                  // cosine similarity instead of a text-overlap proxy.
                  embedding: e.embedding,
                })),
              };
            };

            const smartResult = await smartSearch(rawSearch, {
              query,
              namespace,
              limit,
              threshold,
            });

            const duration = performance.now() - startTime;

            const results = smartResult.results.map((r: { content: string; key: string; namespace: string; score: number; rawScore?: number; provenanceType?: string }) => {
              let value: unknown = r.content;
              try { value = JSON.parse(r.content); } catch { /* keep as string */ }
              return {
                key: r.key,
                namespace: r.namespace,
                value,
                similarity: r.rawScore,
                rankingScore: r.score,
                provenanceType: r.provenanceType,
              };
            });

            const smartNearMisses = results.length === 0 && thresholdWasDefault
              ? await nearMisses(searchEntries, { query, namespace, provenanceFilter })
              : undefined;

            return {
              query,
              results,
              total: results.length,
              ...(smartNearMisses ?? {}),
              searchTime: `${duration.toFixed(2)}ms`,
              backend: 'SmartRetrieval (RRF + MMR + Recency)',
              stats: smartResult.stats,
            };
          }

          // smart=true but smartSearch unavailable on installed package.
          // Fall through to plain search with an explicit warning.
          smartFallbackReason = smartFallbackReason
            ?? 'smartSearch is not exported by the installed @claude-flow/memory build (likely a release lag — see #1846). Falling back to standard semantic search.';
        }

        // Original non-smart path (unchanged) — also reached when smart was
        // requested but unavailable. We attach `smartFallback` to the
        // response so callers can see the degradation explicitly.
        // ADR-323: the same filter is also passed into every raw search used
        // by SmartRetrieval above, so query expansion cannot widen trust scope.
        const result = await searchEntries({
          query,
          namespace,
          limit,
          threshold,
          provenanceFilter,
        });

        if (!result.success) {
          return { query, results: [], total: 0, error: result.error };
        }

        const duration = performance.now() - startTime;

        // Parse JSON values in results
        const results = result.results.map(r => {
          let value: unknown = r.content;
          try {
            value = JSON.parse(r.content);
          } catch {
            // Keep as string
          }

          return {
            key: r.key,
            namespace: r.namespace,
            value,
            similarity: r.score,
            provenanceType: r.provenanceType,
          };
        });

        const nearMissInfo = results.length === 0 && thresholdWasDefault
          ? await nearMisses(searchEntries, { query, namespace, provenanceFilter })
          : undefined;

        return {
          query,
          results,
          total: results.length,
          ...(nearMissInfo ?? {}),
          searchTime: `${duration.toFixed(2)}ms`,
          backend: 'HNSW + sql.js',
          ...(smartFallbackReason ? { smartFallback: smartFallbackReason } : {}),
        };
      } catch (error) {
        return {
          query,
          results: [],
          total: 0,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  },
  {
    name: 'memory_delete',
    description: 'Remove a stored memory entry by exact (namespace, key). Use when a previously stored decision is invalidated or contains stale data. No native equivalent — Write to a file does not affect the .swarm/memory.db SQLite store.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        namespace: { type: 'string', description: 'Namespace (default: "default")' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const missingKey = missingRequiredString(input, 'key', 'memory_delete');
      if (missingKey) {
        return { success: false, key: input.key, namespace: input.namespace, deleted: false, ...missingKey };
      }

      await ensureInitialized();
      const { deleteEntry } = await getMemoryFunctions();

      const key = input.key as string;
      const namespace = (input.namespace as string) || 'default';

      validateMemoryInput(key, undefined, undefined, namespace);

      try {
        const result = await deleteEntry({ key, namespace });

        return {
          success: result.deleted,
          key,
          namespace,
          deleted: result.deleted,
          hnswIndexInvalidated: result.deleted,
          backend: await describeBackend(),
        };
      } catch (error) {
        return {
          success: false,
          key,
          namespace,
          deleted: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  },
  {
    name: 'memory_list',
    description: 'Enumerate stored memory entries (optionally filtered by namespace/tags) without semantic search. Use when native Glob is wrong because the entries are not files (they live in .swarm/memory.db). For inspection / audit / "what is in my memory" — pair with memory_search for retrieval-by-meaning.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Filter by namespace' },
        limit: { type: 'number', description: 'Maximum results (default: 50)' },
        offset: { type: 'number', description: 'Offset for pagination (default: 0)' },
      },
    },
    handler: async (input) => {
      await ensureInitialized();
      const { listEntries } = await getMemoryFunctions();

      const namespace = input.namespace as string | undefined;
      const limit = (input.limit as number) || 50;
      const offset = (input.offset as number) || 0;

      if (namespace) { const vNs = validateIdentifier(namespace, 'namespace'); if (!vNs.valid) throw new Error(vNs.error); }

      try {
        const result = await listEntries({
          namespace,
          limit,
          offset,
        });

        const entries = result.entries.map(e => ({
          key: e.key,
          namespace: e.namespace,
          storedAt: e.createdAt,
          updatedAt: e.updatedAt,
          accessCount: e.accessCount,
          hasEmbedding: e.hasEmbedding,
          size: e.size,
        }));

        return {
          entries,
          total: result.total,
          limit,
          offset,
          backend: await describeBackend(),
        };
      } catch (error) {
        return {
          entries: [],
          total: 0,
          limit,
          offset,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
  },
  {
    name: 'memory_stats',
    description: 'Get memory storage statistics including HNSW index status Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        dbPath: { type: 'string', description: 'Database file to inspect; omitted uses the MCP store default' },
      },
    },
    handler: async (input) => {
      if (input.dbPath !== undefined && (typeof input.dbPath !== 'string' || !input.dbPath.trim())) {
        return memoryStatsUnavailable('dbPath must be a non-empty string');
      }
      const dbPath = typeof input.dbPath === 'string' ? resolve(input.dbPath) : undefined;
      // An explicit read must not initialize or migrate the unrelated default store.
      if (!dbPath) await ensureInitialized();
      const { listEntries } = await getMemoryFunctions();

      // #3311: the store's own listing decides whether memory is there.
      // `checkMemoryInitialization` opens a whole-image sql.js snapshot of
      // the main database file, which cannot include live SQLite WAL frames
      // — so a store the bridge reads and searches perfectly well came back
      // `initialized: false` from this tool alone. The probe is still read
      // below, for the version and feature labels it is the only source of,
      // but it no longer gets to overrule a working store.
      let listing: ListPage<{ namespace: string; hasEmbedding: boolean; createdAt?: string | number }>;
      try {
        listing = await collectAllEntries(listEntries, dbPath);
      } catch (error) {
        return memoryStatsUnavailable(error instanceof Error ? error.message : 'Unknown error');
      }
      if (!listing.success) {
        // A failed query is not an empty store. Reporting zeros here is
        // what made a WAL refusal look like "you have no memories".
        return memoryStatsUnavailable(listing.error || 'listEntries reported failure');
      }

      // Object.create(null): a namespace literally named `__proto__` is a
      // legal key, and assigning it on an object literal sets the prototype
      // instead of counting anything — so that namespace's entries vanished
      // from the breakdown while still being counted in the total.
      const namespaces: Record<string, number> = Object.create(null) as Record<string, number>;
      let withEmbeddings = 0;
      let oldest = Infinity;
      let newest = -Infinity;
      for (const entry of listing.entries) {
        namespaces[entry.namespace] = (namespaces[entry.namespace] || 0) + 1;
        if (entry.hasEmbedding) withEmbeddings++;
        // AgentDB returns INTEGER epoch milliseconds; legacy sql.js rows
        // may expose ISO strings or numeric strings from SQLite TEXT affinity.
        const rawCreated = entry.createdAt;
        const millis = typeof rawCreated === 'number'
          ? rawCreated
          : typeof rawCreated === 'string' && /^-?\d+$/.test(rawCreated)
            ? Number(rawCreated)
            : Date.parse(rawCreated ?? '');
        const created = new Date(millis).getTime();
        if (Number.isFinite(created)) {
          oldest = Math.min(oldest, created);
          newest = Math.max(newest, created);
        }
      }

      const counted = listing.entries.length;
      const status = await readMemoryStatusLabels(dbPath);
      let totalSize: string | null = null;
      if (dbPath) {
        try {
          let bytes = statSync(dbPath).size;
          try { bytes += statSync(dbPath + '-wal').size; } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          totalSize = `${bytes} B`;
        } catch { /* unavailable file metadata is unknown, not zero */ }
      }

      return {
        initialized: true,
        totalEntries: listing.total,
        ...(dbPath ? { location: dbPath, totalSize } : {}),
        oldestEntry: counted >= listing.total && Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
        newestEntry: counted >= listing.total && Number.isFinite(newest) ? new Date(newest).toISOString() : null,
        entriesCounted: counted,
        // The breakdown below covers `entriesCounted` rows, which is every
        // row unless the listing was truncated; say so rather than letting
        // a partial count read as the whole store.
        ...(counted < listing.total ? { truncated: true } : {}),
        entriesWithEmbeddings: withEmbeddings,
        embeddingCoverage: counted > 0
          ? `${((withEmbeddings / counted) * 100).toFixed(1)}%`
          : '0%',
        namespaces: { ...namespaces },
        backend: await describeBackend(),
        version: status.version || '3.0.0',
        features: status.features || {
          vectorEmbeddings: true,
          hnswIndex: true,
          semanticSearch: true,
        },
      };
    },
  },
  {
    name: 'memory_migrate',
    description: 'Manually trigger migration from legacy JSON store to sql.js Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Force re-migration even if already done' },
      },
    },
    handler: async (input) => {
      const force = input.force as boolean;

      // Remove migration marker if forcing
      if (force) {
        const markerPath = getMigrationMarkerPath();
        if (existsSync(markerPath)) {
          unlinkSync(markerPath);
        }
      }

      // Check for legacy data
      const legacyStore = loadLegacyStore();
      if (!legacyStore || Object.keys(legacyStore.entries).length === 0) {
        return {
          success: true,
          message: 'No legacy data to migrate',
          migrated: 0,
        };
      }

      // Run migration via ensureInitialized
      await ensureInitialized();

      return {
        success: true,
        message: 'Migration completed',
        migrated: Object.keys(legacyStore.entries).length,
        backend: await describeBackend(),
      };
    },
  },

  // ===== Claude Code Memory Bridge Tools =====

  {
    name: 'memory_import_claude',
    description: 'Import Claude Code auto-memory files into AgentDB with ONNX vector embeddings. Reads ~/.claude/projects/*/memory/*.md files, parses YAML frontmatter, splits into sections, and stores with 384-dim embeddings for semantic search. Use allProjects=true to import from ALL Claude projects. Pass projectPath to override cwd-based detection (#1883 — required when Ruflo runs in WSL but Claude Code is on Windows). Pass excludeFilePatterns (glob list) or excludeFiles (absolute path list) to skip voice-load-bearing, PII, or persona-restricted files (#1937). Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        allProjects: { type: 'boolean', description: 'Import from all Claude projects (default: current project only)' },
        namespace: { type: 'string', description: 'Target namespace (default: "claude-memories")' },
        projectPath: { type: 'string', description: '#1883 — explicit project path to hash, used when cwd does not match Claude Code\'s view (e.g. WSL bridge to Windows host). Pass the canonical project root as Claude Code sees it.' },
        excludeFilePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: '#1937 — glob patterns matched against the absolute file path. Files matching ANY pattern are skipped. Supports `*` (any chars within a path segment), `**` (any chars including separators), and `?` (single char). Examples: `**/voice-*.md`, `**/persona-*.md`. Combine with excludeFiles for explicit paths.',
        },
        excludeFiles: {
          type: 'array',
          items: { type: 'string' },
          description: '#1937 — absolute file paths to skip verbatim. Faster than a pattern when the list is known ahead of time (operator captured baselines). Combine with excludeFilePatterns.',
        },
      },
    },
    handler: async (input) => {
      await ensureInitialized();
      const { storeEntry } = await getMemoryFunctions();

      const ns = (input.namespace as string) || 'claude-memories';
      if (input.namespace) { const vNs = validateIdentifier(ns, 'namespace'); if (!vNs.valid) return { success: false, imported: 0, error: vNs.error }; }
      const allProjects = input.allProjects as boolean;
      const projectPathOverride = input.projectPath as string | undefined;
      const claudeProjectsDir = join(homedir(), '.claude', 'projects');

      // #1937 — voice-fidelity / persona-restricted exclusion.
      const excludeFilePatterns = Array.isArray(input.excludeFilePatterns) ? input.excludeFilePatterns as string[] : [];
      const excludeFilesList = Array.isArray(input.excludeFiles) ? new Set(input.excludeFiles as string[]) : new Set<string>();
      const excludeRegexes = excludeFilePatterns.map(globToRegex);
      const isExcluded = (absPath: string): boolean => {
        if (excludeFilesList.has(absPath)) return true;
        return excludeRegexes.some(re => re.test(absPath));
      };

      // Find memory files
      const memoryFiles: Array<{ path: string; project: string; file: string }> = [];

      let excludedByPattern = 0;

      if (allProjects) {
        // Scan all projects
        if (existsSync(claudeProjectsDir)) {
          try {
            for (const project of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
              if (!project.isDirectory()) continue;
              const memDir = join(claudeProjectsDir, project.name, 'memory');
              if (!existsSync(memDir)) continue;
              for (const file of readdirSync(memDir).filter((f: string) => f.endsWith('.md'))) {
                const absPath = join(memDir, file);
                if (isExcluded(absPath)) { excludedByPattern++; continue; }
                memoryFiles.push({ path: absPath, project: project.name, file });
              }
            }
          } catch { /* scan error */ }
        }
      } else {
        // #1883 — current project: try multiple candidate hashes (POSIX, WSL-translated,
        // leading-dash-stripped, space-replaced). Caller can pass projectPath to override.
        const resolved = resolveProjectMemoryDir(claudeProjectsDir, projectPathOverride);
        if (resolved) {
          try {
            for (const file of readdirSync(resolved.memDir).filter((f: string) => f.endsWith('.md'))) {
              const absPath = join(resolved.memDir, file);
              if (isExcluded(absPath)) { excludedByPattern++; continue; }
              memoryFiles.push({ path: absPath, project: resolved.projectHash, file });
            }
          } catch { /* scan error */ }
        }
      }

      if (memoryFiles.length === 0) {
        return { success: true, imported: 0, message: 'No Claude memory files found' };
      }

      let imported = 0;
      let skipped = 0;
      const importErrors: string[] = [];
      // #1791.8 — Claude Code's `~/.claude/projects/` accumulates historical
      // project_id directories (truncated forms, sandbox cwds, renamed
      // workspaces) that all contain copies of the same memory files. The
      // previous import indexed each copy under a different `project_id`
      // prefix, producing 5–8x duplication on long-lived homes. Dedupe by
      // file content hash so the same memory is imported once even if it
      // appears under several project directories.
      const seenContentHashes = new Set<string>();
      let duplicatesSkipped = 0;
      const projects = new Set<string>();

      for (const memFile of memoryFiles) {
        projects.add(memFile.project);
        try {
          const content = readFileSync(memFile.path, 'utf-8');

          // #1791.8 — Skip if we've already imported this exact content under
          // a different project_id directory.
          const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
          if (seenContentHashes.has(contentHash)) {
            duplicatesSkipped++;
            continue;
          }
          seenContentHashes.add(contentHash);

          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
          let name = memFile.file.replace('.md', '');
          let body = content;

          if (frontmatterMatch) {
            const yaml = frontmatterMatch[1];
            body = frontmatterMatch[2].trim();
            const nameMatch = yaml.match(/^name:\s*(.+)$/m);
            if (nameMatch) name = nameMatch[1].trim();
          }

          // Split into sections for granular search. Persist each full section:
          // clipping at 4096 characters silently discarded its searchable tail (#3217).
          const sections = body.split(/^(?=## )/m).filter(s => s.trim().length > 20);

          if (sections.length === 0 && body.length > 10) {
            // #1884 — sanitize key so memory_delete can later remove it. Without
            // this, dangerous chars from frontmatter `name` strand the key.
            const key = sanitizeMemoryKey(`claude:${memFile.project}:${name}`);
            const stored = await storeEntry({ key, value: body, namespace: ns, generateEmbeddingFlag: true, upsert: true });
            if (!stored.success) throw new Error(stored.error || `Failed to store ${key}`);
            imported++;
          } else {
            for (const section of sections) {
              const titleMatch = section.match(/^##\s+(.+)/);
              const sectionTitle = titleMatch ? titleMatch[1].trim() : name;
              const sectionBody = section.replace(/^##\s+.+\n/, '').trim();
              if (sectionBody.length < 10) continue;
              // #1884 — sanitize so any dangerous chars in the heading don't
              // produce keys memory_delete will reject.
              const key = sanitizeMemoryKey(`claude:${memFile.project}:${name}:${sectionTitle.slice(0, 50)}`);
              const stored = await storeEntry({ key, value: sectionBody, namespace: ns, generateEmbeddingFlag: true, upsert: true });
              if (!stored.success) throw new Error(stored.error || `Failed to store ${key}`);
              imported++;
            }
          }
        } catch (err) {
          skipped++;
          // Say why a file was skipped instead of returning a bare failure (#4197).
          if (importErrors.length < 5) {
            importErrors.push(`${memFile.path}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // AUDIT #3: report the embedding backend truthfully — a hash-fallback
      // import is NOT semantically searchable, so an operator must not read
      // "ONNX ... (384-dim)" when the vectors are mock.
      let importBackend: 'onnx' | 'mock' | 'unknown' = 'unknown';
      try {
        const { generateEmbedding } = await import('../memory/memory-initializer.js');
        const probe = await generateEmbedding('memory_import_claude backend probe');
        importBackend = probe.backend ?? 'unknown';
      } catch { /* probe failed — leave 'unknown' */ }

      return {
        success: skipped === 0,
        imported,
        skipped,
        duplicatesSkipped,
        excludedByPattern,
        ...(importErrors.length > 0 ? { errors: importErrors } : {}),
        files: memoryFiles.length,
        projects: projects.size,
        namespace: ns,
        embedding: `all-MiniLM-L6-v2 (384-dim, backend=${importBackend})`,
        embeddingBackend: importBackend,
      };
    },
  },

  {
    name: 'memory_bridge_status',
    description: 'Show Claude Code memory bridge status — AgentDB vectors, SONA learning, intelligence patterns, and connection health. Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',
    category: 'memory',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await ensureInitialized();

      // Count Claude memory files
      const claudeProjectsDir = join(homedir(), '.claude', 'projects');
      let claudeFiles = 0;
      let claudeProjects = 0;
      if (existsSync(claudeProjectsDir)) {
        try {
          for (const project of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
            if (!project.isDirectory()) continue;
            const memDir = join(claudeProjectsDir, project.name, 'memory');
            if (!existsSync(memDir)) continue;
            const files = readdirSync(memDir).filter((f: string) => f.endsWith('.md'));
            if (files.length > 0) { claudeProjects++; claudeFiles += files.length; }
          }
        } catch { /* ignore */ }
      }

      // AgentDB status
      // #1940: previously used `allEntries.entries.length` for the totals,
      // but `listEntries({})` returns the first 20 entries with a separate
      // `total` field for the full row count. So `memory_bridge_status`
      // reported `totalEntries: 0`...20 even when the DB had hundreds of
      // rows. Use `.total` for the count, and surface the namespaces with
      // entries so the report matches what's actually in the store.
      let agentdbEntries = 0;
      let claudeMemoryEntries = 0;
      const namespaceCounts: Record<string, number> = {};
      try {
        const { listEntries } = await getMemoryFunctions();
        const allEntries = await listEntries({});
        agentdbEntries = (allEntries as { total?: number })?.total
          ?? allEntries?.entries?.length ?? 0;
        const claudeEntries = await listEntries({ namespace: 'claude-memories' });
        claudeMemoryEntries = (claudeEntries as { total?: number })?.total
          ?? claudeEntries?.entries?.length ?? 0;
        // Per-namespace counts for the namespaces the reporter referenced
        // (#1940). Best-effort — a namespace with 0 entries is omitted.
        for (const ns of ['default', 'patterns', 'claude-memories', 'auto-memory', 'tasks', 'feedback', 'pretrain']) {
          try {
            const r = await listEntries({ namespace: ns });
            const t = (r as { total?: number })?.total ?? r?.entries?.length ?? 0;
            if (t > 0) namespaceCounts[ns] = t;
          } catch { /* skip per-namespace failure */ }
        }
      } catch { /* ignore */ }

      // Intelligence status
      let intelligence = { sonaEnabled: false, patternsLearned: 0, trajectoriesRecorded: 0 };
      try {
        const int = await import('../memory/intelligence.js');
        const stats = int.getIntelligenceStats?.();
        if (stats) intelligence = { sonaEnabled: stats.sonaEnabled, patternsLearned: stats.patternsLearned, trajectoriesRecorded: stats.trajectoriesRecorded };
      } catch { /* not initialized */ }

      // AUDIT #3: probe the embedding backend so operators can tell real ONNX
      // output from the deterministic hash fallback (which has inverted/
      // meaningless semantics). Without this, the status string reports the
      // model name unconditionally and mock output is indistinguishable.
      let embeddingBackend: 'onnx' | 'mock' | 'unknown' = 'unknown';
      try {
        const { generateEmbedding } = await import('../memory/memory-initializer.js');
        const probe = await generateEmbedding('memory_bridge_status backend probe');
        embeddingBackend = probe.backend ?? 'unknown';
      } catch { /* probe failed — leave 'unknown' */ }

      const embeddingLabel = `all-MiniLM-L6-v2 (384-dim, backend=${embeddingBackend})`;

      return {
        claudeCode: { memoryFiles: claudeFiles, projects: claudeProjects },
        agentdb: {
          totalEntries: agentdbEntries,
          claudeMemoryEntries,
          namespaces: namespaceCounts,
          backend: embeddingBackend === 'mock' ? 'sql.js + MOCK (hash fallback)' : 'sql.js + ONNX',
          embeddingBackend,
        },
        intelligence,
        // #1940: report 'connected' whenever ANY namespace has imported
        // content, not just `claude-memories` — the bridge can be in active
        // use from other import paths (e.g. plugin namespaces, task memory).
        bridge: {
          status: agentdbEntries > 0 ? 'connected' : 'not-synced',
          embedding: embeddingLabel,
          embeddingBackend,
        },
      };
    },
  },

  {
    name: 'memory_search_unified',
    description: 'Search across both Claude Code memories and AgentDB entries using semantic vector similarity. Returns merged, deduplicated results from all namespaces. Use when native Read/Write is wrong because you need (a) cross-session retrieval by semantic similarity (vector embeddings) not by file path, (b) namespacing across projects without managing directory layout, or (c) the .swarm/memory.db audit trail. For one-shot file I/O, native Read/Write is fine.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (natural language)' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
        namespace: { type: 'string', description: 'Filter to a single namespace (mutually exclusive with `namespaces`)' },
        namespaces: { type: 'array', items: { type: 'string' }, description: 'Explicit list of namespaces to fan out across (overrides defaults and env)' },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const missingQuery = missingRequiredString(input, 'query', 'memory_search_unified');
      if (missingQuery) {
        return { success: false, query: input.query, results: [], total: 0, ...missingQuery };
      }

      await ensureInitialized();
      const { searchEntries, listEntries } = await getMemoryFunctions();
      validateMemoryInput(undefined, undefined, input.query as string);

      const query = input.query as string;
      const limit = (input.limit as number) ?? 10;
      const ns = input.namespace as string | undefined;
      const nsList = Array.isArray(input.namespaces) ? (input.namespaces as string[]) : undefined;

      if (ns) { const vNs = validateIdentifier(ns, 'namespace'); if (!vNs.valid) return { success: false, query, results: [], total: 0, error: vNs.error }; }
      if (nsList) {
        for (const n of nsList) { const v = validateIdentifier(n, 'namespaces[]'); if (!v.valid) return { success: false, query, results: [], total: 0, error: v.error }; }
      }

      // #2246 fix: namespace resolution priority is
      //   1. explicit single `namespace` (back-compat)
      //   2. explicit `namespaces: string[]` (new in 3.10.29)
      //   3. env var CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES (CSV)
      //   4. dynamic enumeration via listEntries({}) over the actual store
      //   5. legacy 6-namespace hardcode as last-resort fallback
      // The legacy default was silently missing ~95% of entries on stores with
      // custom namespaces (issue #2246). Dynamic enumeration fixes that.
      const LEGACY_DEFAULT = ['default', 'claude-memories', 'auto-memory', 'patterns', 'tasks', 'feedback'];
      let namespaces: string[];
      let namespaceSource: 'param-single' | 'param-list' | 'env' | 'dynamic' | 'legacy-fallback';
      if (ns) {
        namespaces = [ns]; namespaceSource = 'param-single';
      } else if (nsList && nsList.length > 0) {
        namespaces = nsList; namespaceSource = 'param-list';
      } else if (process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES) {
        namespaces = process.env.CLAUDE_FLOW_MEMORY_SEARCH_NAMESPACES.split(',').map(s => s.trim()).filter(Boolean);
        namespaceSource = 'env';
      } else {
        // Dynamic enumeration — list all entries and collect distinct namespaces.
        // Cap entries at 100k to bound memory; in practice this is fast (<200ms).
        try {
          const all = await listEntries({ limit: 100000 });
          const seenNs = new Set<string>();
          for (const e of all?.entries ?? []) if (e.namespace) seenNs.add(e.namespace);
          namespaces = seenNs.size > 0 ? Array.from(seenNs).sort() : LEGACY_DEFAULT;
          namespaceSource = seenNs.size > 0 ? 'dynamic' : 'legacy-fallback';
        } catch {
          namespaces = LEGACY_DEFAULT; namespaceSource = 'legacy-fallback';
        }
      }

      const allResults: Array<{ key: string; content: string; score: number; namespace: string; source: string }> = [];

      for (const searchNs of namespaces) {
        try {
          const r = await searchEntries({ query, namespace: searchNs, limit: limit * 2 });
          if (r?.results) {
            for (const entry of r.results) {
              allResults.push({
                key: entry.key || entry.id || '',
                content: (entry.content || (entry as any).value || '').toString().slice(0, 200),
                score: entry.score || 0,
                namespace: searchNs,
                source: searchNs === 'claude-memories' ? 'claude-code' : searchNs === 'auto-memory' ? 'auto-memory' : 'agentdb',
              });
            }
          }
        } catch { /* namespace may not exist */ }
      }

      // Sort by score, deduplicate by key, take top N
      allResults.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const deduplicated = allResults.filter(r => {
        if (seen.has(r.key)) return false;
        seen.add(r.key);
        return true;
      }).slice(0, limit);

      return {
        success: true,
        query,
        results: deduplicated,
        total: deduplicated.length,
        searchedNamespaces: namespaces,
        namespaceSource,        // #2246 — surface how the namespace list was resolved
        searchTime: Date.now(),
      };
    },
  },
  {
    // #1916: `ruflo status memory` (the detailed view) referenced an
    // unregistered `memory_detailed-stats` tool. memory_stats returns a
    // different shape; this returns what the CLI renders.
    name: 'memory_detailed-stats',
    description: 'Detailed memory-store report — backend, entry count, total bytes, per-namespace counts, and (placeholder) perf metrics. Use when native Read/Glob is wrong because the data lives in .swarm/memory.db, not files, and you want an aggregate health view. For a quick count use memory_stats; for "what is in memory" use memory_list.',
    category: 'memory',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await ensureInitialized();
      const { listEntries } = await getMemoryFunctions();
      const all = await listEntries({ limit: 100000 });
      const nsCounts: Record<string, number> = {};
      let bytes = 0;
      for (const e of all.entries) {
        nsCounts[e.namespace] = (nsCounts[e.namespace] || 0) + 1;
        bytes += (e.size as number) || 0;
      }
      return {
        backend: await describeBackend(),
        entries: all.total ?? all.entries.length,
        size: bytes,
        namespaces: Object.entries(nsCounts).map(([name, entries]) => ({ name, entries })),
        performance: { avgSearchTime: 0, avgWriteTime: 0, cacheHitRate: 0, hnswEnabled: true },
        note: 'perf metrics are placeholders; HNSW is always enabled in the sql.js backend',
      };
    },
  },
  {
    // #1916: `ruflo memory cleanup` referenced an unregistered `memory_cleanup`
    // tool. Removes entries whose TTL has expired. Defaults to a dry run —
    // pass dryRun:false to actually delete.
    name: 'memory_cleanup',
    description: 'Prune memory entries whose TTL has expired (dry run by default; pass dryRun:false to delete). Use when native rm is wrong because the entries are rows in .swarm/memory.db, not files. For removing a specific known key use memory_delete. Stale/low-quality pruning is delegated to the agentdb consolidation curator (#1916 follow-up).',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', description: 'Only report candidates, do not delete (default true)' },
        namespace: { type: 'string', description: 'Limit cleanup to one namespace' },
      },
    },
    handler: async (input) => {
      await ensureInitialized();
      const { listEntries, deleteEntry } = await getMemoryFunctions();
      const startedAt = Date.now();
      const dryRun = input.dryRun !== false; // default true
      const namespace = input.namespace ? String(input.namespace) : undefined;
      if (namespace) { const v = validateIdentifier(namespace, 'namespace'); if (!v.valid) throw new Error(v.error); }
      // #4056: TTL hides expired rows from normal reads, so the cleanup has to ask for them.
      const all = await listEntries({ limit: 100000, namespace, includeExpired: true });
      const now = Date.now();
      const expired = all.entries.filter(e => {
        const exp = (e as { expiresAt?: string | number | null }).expiresAt;
        if (!exp) return false;
        const t = typeof exp === 'number' ? exp : Date.parse(String(exp));
        return Number.isFinite(t) && t < now;
      });
      let freedBytes = 0;
      let deleted = 0;
      let vectorsRemoved = 0;
      if (!dryRun) {
        for (const e of expired) {
          try { await deleteEntry({ key: e.key, namespace: e.namespace }); freedBytes += (e.size as number) || 0; deleted++; }
          catch { /* ignore individual delete errors */ }
        }
      } else {
        freedBytes = expired.reduce((s, e) => s + ((e.size as number) || 0), 0);
      }
      if (!dryRun) {
        const { reconcileHNSWIndex } = await import('../memory/memory-initializer.js');
        vectorsRemoved = await reconcileHNSWIndex();
      }
      const formatted = freedBytes < 1024
        ? `${freedBytes} B`
        : freedBytes < 1024 * 1024
          ? `${(freedBytes / 1024).toFixed(1)} KiB`
          : `${(freedBytes / (1024 * 1024)).toFixed(1)} MiB`;
      return {
        dryRun,
        candidates: { expired: expired.length, stale: 0, lowQuality: 0, total: expired.length },
        deleted: { entries: dryRun ? 0 : deleted, vectors: vectorsRemoved, patterns: 0 },
        freed: { bytes: freedBytes, formatted },
        duration: Date.now() - startedAt,
        note: dryRun ? 'dry run — re-run with dryRun:false to delete' : undefined,
      };
    },
  },
  {
    // #1916: `ruflo memory compress` referenced an unregistered tool. The
    // sql.js backend has no on-disk compression; this reports current sizes.
    name: 'memory_compress',
    description: 'Report memory-store size breakdown (the sql.js backend has no on-disk compression — entries are already stored compactly; quantized embeddings via RaBitQ are configured elsewhere). Use when native du is wrong because the data is in .swarm/memory.db. For pruning expired entries use memory_cleanup.',
    category: 'memory',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      await ensureInitialized();
      const { listEntries } = await getMemoryFunctions();
      const all = await listEntries({ limit: 100000 });
      const bytes = all.entries.reduce((s, e) => s + ((e.size as number) || 0), 0);
      const human = `${bytes}B`;
      const sizes = { totalSize: human, vectorsSize: 'n/a', textSize: human, patternsSize: 'n/a', indexSize: 'n/a' };
      return {
        before: sizes,
        after: sizes,
        compression: { ratio: 1, savedBytes: 0, method: 'none' },
        note: 'sql.js backend has no on-disk compression; nothing to compress. (RaBitQ embedding quantization is a separate feature.)',
      };
    },
  },
  {
    // #1916: `ruflo memory export -o <file>` referenced an unregistered tool.
    // Dumps entry metadata (and values when the backend returns them) to JSON.
    name: 'memory_export',
    description: 'Export memory entries to a JSON file (keys, namespaces, timestamps, and values when available). Use when native Write is wrong because the data is rows in .swarm/memory.db, not a file you can copy. For ingesting an export elsewhere use memory_import. (CSV output and embedding-vector export are follow-ups.)',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        outputPath: { type: 'string', description: 'File path to write the JSON export to' },
        format: { type: 'string', enum: ['json', 'csv'], description: 'Export format (csv falls back to json today)' },
        namespace: { type: 'string', description: 'Limit export to one namespace' },
        includeVectors: { type: 'boolean', description: 'Include embedding vectors (advisory — not exported yet)' },
      },
      required: ['outputPath'],
    },
    handler: async (input) => {
      await ensureInitialized();
      const { listEntries } = await getMemoryFunctions();
      const outputPath = String(input.outputPath ?? '');
      if (!outputPath) return { error: 'outputPath is required' };
      const namespace = input.namespace ? String(input.namespace) : undefined;
      if (namespace) { const v = validateIdentifier(namespace, 'namespace'); if (!v.valid) throw new Error(v.error); }
      // #2073: pass includeContent so the value field carries the actual
      // entry body. Without this, `value` is always null because listEntries
      // strips content by default (callers pay for the JSON parse only when
      // they need it).
      // A successful export must cover the whole reported store. Read all
      // pages before touching an existing snapshot, including on read failure.
      type ExportEntry = Awaited<ReturnType<typeof listEntries>>['entries'][number];
      const readStore = async (dbPath?: string): Promise<{ entries: ExportEntry[] } | { error: string }> => {
        const out: ExportEntry[] = [];
        let total: number | undefined;
        do {
          const page = await listEntries({ limit: 10000, offset: out.length, namespace, includeContent: true, ...(dbPath ? { dbPath } : {}) });
          if (!page.success) return { error: page.error || 'Could not read memory for export' };
          total ??= page.total;
          if (page.entries.length === 0 && out.length < total) {
            return { error: `Incomplete memory export: read ${out.length} of ${total} entries` };
          }
          out.push(...page.entries);
        } while (out.length < total);
        return { entries: out };
      };
      const primary = await readStore();
      if ('error' in primary) return { error: primary.error };
      // #4148: the default reader is the AgentDB bridge, but the CLI's own store
      // (.swarm/memory.db, possibly encrypted) can hold rows the bridge never
      // sees, so an export silently covered one store and reported success. Read
      // the CLI store too and merge, newest copy of a (namespace, key) winning.
      const warnings: string[] = [];
      const stores: Array<{ store: string; entries: number }> = [{ store: 'default', entries: primary.entries.length }];
      const merged = new Map<string, ExportEntry>();
      const keep = (e: ExportEntry): void => {
        const id = `${e.namespace}\u0000${e.key}`;
        const have = merged.get(id);
        if (!have || String(e.updatedAt) > String(have.updatedAt)) merged.set(id, e);
      };
      primary.entries.forEach(keep);
      const cliStore = await resolveCliStorePath();
      if (cliStore && existsSync(cliStore)) {
        const secondary = await readStore(cliStore);
        if ('error' in secondary) {
          warnings.push(`Could not read the CLI store ${cliStore} (${secondary.error}); the export covers the AgentDB store only.`);
        } else {
          stores.push({ store: cliStore, entries: secondary.entries.length });
          secondary.entries.forEach(keep);
        }
      }
      const all = { entries: [...merged.values()] };
      const payload = {
        schema: 'ruflo-memory-export/v1',
        exportedAt: new Date().toISOString(),
        namespace: namespace ?? null,
        count: all.entries.length,
        entries: all.entries.map(e => ({
          key: e.key,
          namespace: e.namespace,
          // #2073: `e.content` is the stored value string; `e.value` was a
          // never-populated alias. Fall back to null only if content is
          // missing for backward-compat with the schema.
          value: typeof e.content === 'string' ? e.content : ((e as { value?: unknown }).value ?? null),
          createdAt: e.createdAt, updatedAt: e.updatedAt, accessCount: e.accessCount, hasEmbedding: e.hasEmbedding, size: e.size,
        })),
      };
      try { writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf-8'); }
      catch (e) { return { error: `Could not write ${outputPath}: ${(e as Error).message}` }; }
      const vectorsWithEmb = all.entries.filter(e => e.hasEmbedding).length;
      return {
        outputPath,
        format: (input.format as string) || 'json',
        exported: { entries: all.entries.length, vectors: vectorsWithEmb, patterns: 0 },
        stores,
        ...(warnings.length ? { warnings } : {}),
        fileSize: `${Buffer.byteLength(JSON.stringify(payload))}B`,
        note: input.format === 'csv' ? 'CSV not implemented yet — wrote JSON' : undefined,
      };
    },
  },
  {
    // #1916: `ruflo memory import <file>` referenced an unregistered tool.
    // Reads a ruflo-memory-export JSON and re-stores each entry.
    name: 'memory_import',
    description: 'Import memory entries from a JSON export file (produced by memory_export) into .swarm/memory.db, re-embedding values. Use when native Read is wrong because the data must be re-stored as memory rows (with new embeddings), not just read. For importing Claude Code\'s own memory files use memory_import_claude. Pair with memory_export on the source.',
    category: 'memory',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: 'Path to the JSON export file' },
        merge: { type: 'boolean', description: 'Merge into existing entries (upsert) vs. fail on conflict (default true)' },
        namespace: { type: 'string', description: 'Override the namespace for all imported entries' },
        dbPath: { type: 'string', description: 'Database file to import into (defaults to the MCP memory store)' },
      },
      required: ['inputPath'],
    },
    handler: async (input) => {
      const dbPath = typeof input.dbPath === 'string' && input.dbPath.trim()
        ? resolve(input.dbPath)
        : undefined;
      await ensureInitialized(dbPath);
      const { storeEntry } = await getMemoryFunctions();
      const t0 = Date.now();
      // Values are re-embedded on import; count the vectors actually written
      // rather than reporting a constant 0 next to entries that show a vector.
      let vectors = 0;
      const inputPath = String(input.inputPath ?? '');
      if (!inputPath || !existsSync(inputPath)) return { error: `File not found: ${inputPath || '(empty)'}` };
      let doc: { entries?: Array<{ key: string; namespace?: string; value?: unknown }> };
      try { doc = JSON.parse(readFileSync(inputPath, 'utf-8')); }
      catch (e) { return { error: `Invalid export JSON: ${(e as Error).message}` }; }
      const entries = Array.isArray(doc.entries) ? doc.entries : [];
      const nsOverride = input.namespace ? String(input.namespace) : undefined;
      if (nsOverride) { const v = validateIdentifier(nsOverride, 'namespace'); if (!v.valid) throw new Error(v.error); }
      // #3570: validate every entry's namespace up front so a bad file writes nothing.
      if (!nsOverride) {
        for (const e of entries) {
          if (e && typeof e.key === 'string' && e.namespace !== undefined) {
            const v = validateIdentifier(String(e.namespace), 'namespace');
            if (!v.valid) throw new Error(v.error);
          }
        }
      }
      // #3570 follow-up: keys get the same up-front, all-or-nothing check.
      for (const e of entries) {
        if (e && typeof e.key === 'string') {
          const keyError = memoryKeyError(e.key);
          if (keyError) throw new Error(`${keyError}: ${JSON.stringify(e.key)}`);
        }
      }
      let imported = 0; let skipped = 0; let failed = 0;
      const errors: string[] = [];
      for (const e of entries) {
        if (!e || typeof e.key !== 'string') { skipped++; continue; }
        const value = typeof e.value === 'string' ? e.value : JSON.stringify(e.value ?? null);
        try {
          const result = await storeEntry({ key: e.key, value, namespace: nsOverride ?? e.namespace ?? 'default', upsert: input.merge !== false, dbPath });
          if (!result.success) throw new Error(result.error || 'Memory write was rejected');
          imported++;
          if (result.embedding) vectors++;
        } catch (error) {
          failed++;
          if (errors.length < 10) errors.push(`${e.key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return {
        success: failed === 0,
        error: failed > 0 ? `${failed} memory write(s) failed: ${errors.join('; ')}` : undefined,
        failed,
        inputPath,
        imported: { entries: imported, vectors, patterns: 0 },
        skipped,
        duration: Date.now() - t0,
      };
    },
  },
];
