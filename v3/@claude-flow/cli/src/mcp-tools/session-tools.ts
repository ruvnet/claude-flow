/**
 * Session MCP Tools for CLI
 *
 * Tool definitions for session management with file persistence.
 */

import { existsSync, readFileSync, readdirSync, unlinkSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { type MCPTool, getProjectCwd } from './types.js';
import {
  mkdirRestricted,
  readFileMaybeEncrypted,
  writeFileRestricted,
} from '../fs-secure.js';
import { validateIdentifier, validateText } from './validate-input.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Imported snapshots become live stores on restore. Validate their containers
// before registering them, while allowing older metadata-only snapshots.
function validateImportedSession(value: unknown): string | undefined {
  if (!isRecord(value) || (typeof value.name !== 'string' && !isSessionRecordLike(value))) {
    return 'Invalid session: Not a session record; expected a named snapshot or snapshot data';
  }
  if (value.name !== undefined && typeof value.name !== 'string') {
    return 'Invalid session: name must be a string';
  }
  if (value.data === undefined) return undefined;
  if (!isRecord(value.data)) return 'Invalid session: data must be an object';
  for (const [component, collection] of [['tasks', 'tasks'], ['agents', 'agents'], ['memory', 'entries']]) {
    const store = value.data[component];
    if (store === undefined) continue;
    if (!isRecord(store) || !isRecord(store[collection]) ||
        Object.values(store[collection]).some(record => !isRecord(record))) {
      return `Invalid session: data.${component}.${collection} must be a record map`;
    }
  }
  return undefined;
}

// Storage paths
const STORAGE_DIR = '.claude-flow';
const SESSION_DIR = 'sessions';

interface SessionRecord {
  sessionId: string;
  name: string;
  description?: string;
  savedAt: string;
  stats: {
    tasks: number;
    agents: number;
    memoryEntries: number;
    totalSize: number;
  };
  data?: {
    memory?: Record<string, unknown>;
    tasks?: Record<string, unknown>;
    agents?: Record<string, unknown>;
  };
}

function getSessionDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, SESSION_DIR);
}

function getSessionPath(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(getSessionDir(), `${safeId}.json`);
}

function ensureSessionDir(): void {
  const dir = getSessionDir();
  if (!existsSync(dir)) {
    mkdirRestricted(dir);
  }
}

function loadSession(sessionId: string): SessionRecord | null {
  try {
    const path = getSessionPath(sessionId);
    if (existsSync(path)) {
      // ADR-096 Phase 2: readFileMaybeEncrypted transparently handles both
      // legacy plaintext sessions and post-migration encrypted ones via the
      // RFE1 magic-byte sniff.
      const data = readFileMaybeEncrypted(path, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Return null on error
  }
  return null;
}

function saveSession(session: SessionRecord): void {
  ensureSessionDir();
  // audit_1776853149979: session JSON contains memory snapshots and agent
  // prompts — restrict to owner read/write.
  // ADR-096 Phase 2: opt-in encrypt-at-rest. The encrypt flag is honored
  // only when CLAUDE_FLOW_ENCRYPT_AT_REST is set; otherwise the legacy
  // plaintext path runs unchanged.
  writeFileRestricted(
    getSessionPath(session.sessionId),
    JSON.stringify(session, null, 2),
    { encrypt: true },
  );
}

function listSessions(): SessionRecord[] {
  ensureSessionDir();
  const dir = getSessionDir();
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));

  const sessions: SessionRecord[] = [];
  for (const file of files) {
    try {
      // ADR-096 Phase 2: same magic-byte sniff for the listing path so a
      // mixed plaintext+encrypted dir still enumerates cleanly.
      const data = readFileMaybeEncrypted(join(dir, file), 'utf-8');
      sessions.push(JSON.parse(data));
    } catch {
      // Skip invalid files
    }
  }

  return sessions;
}

/** Snapshot format written by session_save since #3573. */
const MEMORY_SNAPSHOT_FORMAT = 'ruflo-session-memory/2';
const MEMORY_PAGE_SIZE = 500;

interface MemorySnapshotEntry {
  key: string;
  value: string;
  namespace: string;
  provenanceType?: string;
  source: 'memory-db' | 'agentdb' | 'legacy-json';
}

/**
 * #3573: what session_save learned about memory, so callers can say
 * "not included" or "no store" instead of printing an invented 0.
 */
export interface MemoryCaptureReport {
  requested: boolean;
  status: 'not-requested' | 'captured' | 'no-store' | 'error';
  entries: number;
  sources: { memoryDb: number; agentdb: number; legacyJson: number };
  error?: string;
}

async function readLiveEntries(
  listEntries: typeof import('../memory/memory-initializer.js').listEntries,
  dbPath: string,
  encryptWrites?: boolean,
): Promise<Array<{ key: string; namespace: string; content?: string; provenanceType?: string }>> {
  const rows: Array<{ key: string; namespace: string; content?: string; provenanceType?: string }> = [];
  // Bounded: stop on a short page, once `total` rows are in hand, or after a
  // hard cap, so a backend that ignores `offset` cannot loop forever.
  for (let page = 0, offset = 0; page < 10_000; page++, offset += MEMORY_PAGE_SIZE) {
    const result = await listEntries({
      dbPath, includeContent: true, limit: MEMORY_PAGE_SIZE, offset,
      ...(encryptWrites === undefined ? {} : { encryptWrites }),
    });
    if (!result.success) throw new Error(result.error || `could not list ${dbPath}`);
    rows.push(...result.entries);
    if (result.entries.length < MEMORY_PAGE_SIZE || rows.length >= result.total) break;
  }
  return rows;
}

/**
 * #3573: capture the memory the user actually has.
 *
 * Before this, session_save read only the pre-SQLite `.claude-flow/memory/store.json`,
 * which a current install never writes, so `--include-memory` saved nothing and
 * reported "Memory Entries: 0". The snapshot now covers the same store `memory
 * list` reads (resolveDbPath), plus rows that exist only in the sibling AgentDB
 * store written by the MCP path, de-duplicated by namespace+key (default CLI
 * writes are mirrored into AgentDB, so most rows are in both). A legacy
 * store.json is still captured for backward compatibility.
 */
async function captureMemorySnapshot(): Promise<{ memory?: Record<string, unknown>; report: MemoryCaptureReport }> {
  const report: MemoryCaptureReport = {
    requested: true, status: 'captured', entries: 0,
    sources: { memoryDb: 0, agentdb: 0, legacyJson: 0 },
  };
  const entries: Record<string, MemorySnapshotEntry | Record<string, unknown>> = {};
  let legacy: unknown;

  const legacyPath = join(getProjectCwd(), STORAGE_DIR, 'memory', 'store.json');
  if (existsSync(legacyPath)) {
    try {
      legacy = JSON.parse(readFileSync(legacyPath, 'utf-8'));
      const legacyEntries = (legacy as { entries?: Record<string, Record<string, unknown>> }).entries || {};
      for (const [id, entry] of Object.entries(legacyEntries)) {
        entries[id] = entry;
        report.sources.legacyJson++;
      }
    } catch { /* unreadable legacy file is not memory we can restore */ }
  }

  let sawStore = legacy !== undefined;
  try {
    const { listEntries, resolveDbPath } = await import('../memory/memory-initializer.js');
    const primary = resolveDbPath();
    const seen = new Set<string>();
    if (existsSync(primary)) {
      sawStore = true;
      for (const row of await readLiveEntries(listEntries, primary)) {
        const id = `${row.namespace}::${row.key}`;
        seen.add(id);
        entries[id] = {
          key: row.key, value: row.content ?? '', namespace: row.namespace,
          provenanceType: row.provenanceType, source: 'memory-db',
        };
        report.sources.memoryDb++;
      }
    }
    let sibling: string | null = null;
    try {
      const { siblingAgentDbPath } = await import('../memory/memory-bridge.js');
      sibling = siblingAgentDbPath(primary);
    } catch { /* no bridge, no sibling store */ }
    if (sibling && existsSync(sibling)) {
      sawStore = true;
      // The AgentDB store is read by native SQLite and must stay plaintext.
      for (const row of await readLiveEntries(listEntries, sibling, false)) {
        const id = `${row.namespace}::${row.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        entries[id] = {
          key: row.key, value: row.content ?? '', namespace: row.namespace,
          provenanceType: row.provenanceType, source: 'agentdb',
        };
        report.sources.agentdb++;
      }
    }
  } catch (e) {
    report.status = 'error';
    report.error = (e as Error).message;
  }

  report.entries = Object.keys(entries).length;
  if (report.status !== 'error' && !sawStore) report.status = 'no-store';
  if (report.entries === 0 && legacy === undefined) {
    return { report };
  }
  return {
    memory: {
      format: MEMORY_SNAPSHOT_FORMAT,
      entries,
      ...(legacy !== undefined ? { legacy } : {}),
    },
    report,
  };
}

// Load related stores for session data
async function loadRelatedStores(options: { includeMemory?: boolean; includeTasks?: boolean; includeAgents?: boolean }) {
  const data: SessionRecord['data'] = {};
  let memoryCapture: MemoryCaptureReport = {
    requested: false, status: 'not-requested', entries: 0,
    sources: { memoryDb: 0, agentdb: 0, legacyJson: 0 },
  };

  if (options.includeMemory) {
    const captured = await captureMemorySnapshot();
    memoryCapture = captured.report;
    if (captured.memory) data.memory = captured.memory;
  }

  if (options.includeTasks) {
    try {
      const taskPath = join(getProjectCwd(), STORAGE_DIR, 'tasks', 'store.json');
      if (existsSync(taskPath)) {
        data.tasks = JSON.parse(readFileSync(taskPath, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  if (options.includeAgents) {
    try {
      const agentPath = join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json');
      if (existsSync(agentPath)) {
        data.agents = JSON.parse(readFileSync(agentPath, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  return { data, memoryCapture };
}

/** Count entries in a memory snapshot of either format. */
function countMemoryEntries(memory: unknown): number {
  if (!memory || typeof memory !== 'object') return 0;
  return Object.keys((memory as { entries?: object }).entries || {}).length;
}

/**
 * Restore a memory snapshot into the live store and report what was actually
 * written. #3573: the previous restore swallowed every write failure and then
 * echoed the count recorded at save time.
 */
async function restoreMemorySnapshot(memory: Record<string, unknown>): Promise<{
  restored: number; failed: number; errors: string[];
}> {
  const outcome = { restored: 0, failed: 0, errors: [] as string[] };
  const isV2 = memory.format === MEMORY_SNAPSHOT_FORMAT;
  // Legacy snapshots are the old store.json itself; v2 snapshots carry it
  // under `legacy` only when one existed at save time.
  const legacyJson = isV2 ? memory.legacy : memory;
  if (legacyJson !== undefined) {
    const memoryDir = join(getProjectCwd(), STORAGE_DIR, 'memory');
    if (!existsSync(memoryDir)) mkdirRestricted(memoryDir);
    writeFileRestricted(join(memoryDir, 'store.json'), JSON.stringify(legacyJson, null, 2));
  }

  const entries = (memory as {
    entries?: Record<string, { key?: string; id?: string; value?: string; content?: string; namespace?: string; provenanceType?: string }>;
  }).entries;
  if (!entries) return outcome;

  let storeEntry: typeof import('../memory/memory-initializer.js').storeEntry;
  let isValidProvenanceType: (value: unknown) => boolean = () => false;
  try {
    const mod = await import('../memory/memory-initializer.js');
    storeEntry = mod.storeEntry;
    try { if (typeof mod.isValidProvenanceType === 'function') isValidProvenanceType = mod.isValidProvenanceType; }
    catch { /* optional: without it, provenance is simply not carried over */ }
  } catch (e) {
    outcome.failed = Object.keys(entries).length;
    outcome.errors.push(`memory store unavailable: ${(e as Error).message}`);
    return outcome;
  }
  for (const entry of Object.values(entries)) {
    const key = entry.key || entry.id || '';
    const value = entry.value || entry.content || '';
    if (!key || !value) { outcome.failed++; continue; }
    try {
      // A snapshot from another version may carry a provenance value this one
      // rejects; drop it rather than fail an otherwise-good row.
      const provenance = entry.provenanceType && entry.provenanceType !== 'unknown'
        && isValidProvenanceType(entry.provenanceType) ? entry.provenanceType : undefined;
      const result = await storeEntry({
        key,
        value,
        namespace: entry.namespace || 'restored',
        upsert: true,
        ...(provenance ? { provenanceType: provenance } : {}),
      });
      if (result && result.success === false) {
        outcome.failed++;
        if (result.error && outcome.errors.length < 5) outcome.errors.push(`${key}: ${result.error}`);
      } else {
        outcome.restored++;
      }
    } catch (e) {
      outcome.failed++;
      if (outcome.errors.length < 5) outcome.errors.push(`${key}: ${(e as Error).message}`);
    }
  }
  return outcome;
}

/** A session record is an object that carries at least one of its defining fields. */
function isSessionRecordLike(value: unknown): value is Partial<SessionRecord> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return 'data' in v || 'stats' in v || 'sessionId' in v || 'savedAt' in v;
}

export const sessionTools: MCPTool[] = [
  {
    name: 'session_save',
    description: 'Save current session state Use when native conversation memory is wrong because you need durable cross-session state — restoring agent definitions, swarm topology, memory store, breaker history. For in-session continuation only, no tool needed. Pair with session_save before exiting and session_restore on resume.',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Session name' },
        description: { type: 'string', description: 'Session description' },
        includeMemory: { type: 'boolean', default: true, description: 'Include memory in session' },
        includeTasks: { type: 'boolean', default: true, description: 'Include tasks in session' },
        includeAgents: { type: 'boolean', default: true, description: 'Include agents in session' },
      },
      required: ['name'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vName = validateText(input.name, 'name', 256);
      if (!vName.valid) return { success: false, error: vName.error };
      if (input.description) {
        const v = validateText(input.description, 'description');
        if (!v.valid) return { success: false, error: v.error };
      }

      const sessionId = `session-${Date.now()}-${randomUUID().slice(0, 8)}`;

      // Load related data based on options
      const { data, memoryCapture } = await loadRelatedStores({
        includeMemory: input.includeMemory !== false,
        includeTasks: input.includeTasks !== false,
        includeAgents: input.includeAgents !== false,
      });

      // Calculate stats
      const stats = {
        tasks: data.tasks ? Object.keys((data.tasks as { tasks?: object }).tasks || {}).length : 0,
        agents: data.agents ? Object.keys((data.agents as { agents?: object }).agents || {}).length : 0,
        memoryEntries: countMemoryEntries(data.memory),
        totalSize: 0,
      };

      const session: SessionRecord = {
        sessionId,
        name: input.name as string,
        description: input.description as string,
        savedAt: new Date().toISOString(),
        stats,
        data: Object.keys(data).length > 0 ? data : undefined,
      };

      // Calculate size
      const sessionJson = JSON.stringify(session);
      session.stats.totalSize = Buffer.byteLength(sessionJson, 'utf-8');

      saveSession(session);

      return {
        sessionId,
        name: session.name,
        savedAt: session.savedAt,
        stats: session.stats,
        memoryCapture,
        path: getSessionPath(sessionId),
      };
    },
  },
  {
    name: 'session_restore',
    description: 'Restore a saved session Use when native conversation memory is wrong because you need durable cross-session state — restoring agent definitions, swarm topology, memory store, breaker history. For in-session continuation only, no tool needed. Pair with session_save before exiting and session_restore on resume.',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to restore' },
        name: { type: 'string', description: 'Session name to restore' },
        restoreMemory: { type: 'boolean', description: 'Restore memory (default true)' },
        restoreTasks: { type: 'boolean', description: 'Restore tasks (default true)' },
        restoreAgents: { type: 'boolean', description: 'Restore agents (default true)' },
      },
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      if (input.sessionId) {
        const v = validateIdentifier(input.sessionId, 'sessionId');
        if (!v.valid) return { success: false, error: v.error };
      }
      if (input.name) {
        const v = validateText(input.name, 'name', 256);
        if (!v.valid) return { success: false, error: v.error };
      }

      let session: SessionRecord | null = null;

      // Try to find by sessionId first
      if (input.sessionId) {
        session = loadSession(input.sessionId as string);
      }

      // Try to find by name if sessionId not found
      if (!session && input.name) {
        const sessions = listSessions();
        session = sessions.find(s => s.name === input.name) || null;
      }

      // Try to find latest if no params
      if (!session && !input.sessionId && !input.name) {
        const sessions = listSessions();
        if (sessions.length > 0) {
          sessions.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
          session = sessions[0];
        }
      }

      if (session) {
        // Restore data to respective stores. audit_1776853149979: tighten
        // perms on the restored stores too.
        let memoryRestore: { restored: number; failed: number; errors: string[] } | undefined;
        if (input.restoreMemory !== false && session.data?.memory) {
          memoryRestore = await restoreMemorySnapshot(session.data.memory as Record<string, unknown>);
        }
        if (input.restoreTasks !== false && session.data?.tasks) {
          const taskDir = join(getProjectCwd(), STORAGE_DIR, 'tasks');
          if (!existsSync(taskDir)) mkdirRestricted(taskDir);
          writeFileRestricted(join(taskDir, 'store.json'), JSON.stringify(session.data.tasks, null, 2));
        }
        if (input.restoreAgents !== false && session.data?.agents) {
          const agentDir = join(getProjectCwd(), STORAGE_DIR, 'agents');
          if (!existsSync(agentDir)) mkdirRestricted(agentDir);
          writeFileRestricted(join(agentDir, 'store.json'), JSON.stringify(session.data.agents, null, 2));
        }

        return {
          sessionId: session.sessionId,
          name: session.name,
          restored: true,
          restoredComponents: {
            memory: input.restoreMemory !== false && !!session.data?.memory,
            tasks: input.restoreTasks !== false && !!session.data?.tasks,
            agents: input.restoreAgents !== false && !!session.data?.agents,
          },
          restoredAt: new Date().toISOString(),
          stats: session.stats,
          // #3573: counts actually written, not the count recorded at save time.
          ...(memoryRestore ? {
            memoryRestore,
            stats: { ...session.stats, memoryEntriesRestored: memoryRestore.restored },
          } : {}),
        };
      }

      return {
        sessionId: input.sessionId || input.name || 'latest',
        restored: false,
        error: 'Session not found',
      };
    },
  },
  {
    name: 'session_list',
    description: 'List saved sessions Use when native conversation memory is wrong because you need durable cross-session state — restoring agent definitions, swarm topology, memory store, breaker history. For in-session continuation only, no tool needed. Pair with session_save before exiting and session_restore on resume.',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum sessions to return' },
        sortBy: { type: 'string', description: 'Sort field (date, name, size)' },
      },
    },
    handler: async (input) => {
      // ADR-093 F6: sessions on disk come from two writers with different
      // shapes — `session_save` writes {sessionId, name, savedAt, stats},
      // while the auto-session writer (claude-flow daemon) writes
      // {id, startedAt, ...}. The previous projection assumed only the
      // first shape, so the second shape collapsed to empty objects in
      // session_list output.
      type AnySession = Record<string, unknown> & {
        sessionId?: string;
        id?: string;
        name?: string;
        description?: string;
        savedAt?: string;
        startedAt?: string;
        stats?: { totalSize?: number };
      };
      const raw = listSessions() as unknown as AnySession[];
      let sessions = raw.map((s): AnySession => ({
        ...s,
        sessionId: (s.sessionId as string) || (s.id as string) || 'unknown',
        savedAt: (s.savedAt as string) || (s.startedAt as string) || '',
      }));

      // Sort
      const sortBy = (input.sortBy as string) || 'date';
      if (sortBy === 'date') {
        sessions.sort((a, b) => new Date(String(b.savedAt || '')).getTime() - new Date(String(a.savedAt || '')).getTime());
      } else if (sortBy === 'name') {
        sessions.sort((a, b) => String(a.name || a.sessionId || '').localeCompare(String(b.name || b.sessionId || '')));
      } else if (sortBy === 'size') {
        sessions.sort((a, b) => (b.stats?.totalSize ?? 0) - (a.stats?.totalSize ?? 0));
      }

      // Apply limit
      const limit = (input.limit as number) || 10;
      sessions = sessions.slice(0, limit);

      return {
        sessions: sessions.map(s => {
          // Project to a stable shape; pull through either source's metadata.
          const projection: Record<string, unknown> = {
            sessionId: s.sessionId,
            name: s.name ?? s.sessionId,
            description: s.description,
            savedAt: s.savedAt,
            stats: s.stats ?? null,
          };
          // Preserve auto-session shape fields when present
          if ((s as Record<string, unknown>).platform) projection.platform = (s as Record<string, unknown>).platform;
          if ((s as Record<string, unknown>).metrics) projection.metrics = (s as Record<string, unknown>).metrics;
          return projection;
        }),
        total: sessions.length,
        limit,
      };
    },
  },
  {
    name: 'session_delete',
    description: 'Delete a saved session Use when native conversation memory is wrong because you need durable cross-session state — restoring agent definitions, swarm topology, memory store, breaker history. For in-session continuation only, no tool needed. Pair with session_save before exiting and session_restore on resume.',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to delete' },
      },
      required: ['sessionId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.sessionId, 'sessionId');
      if (!vId.valid) return { success: false, error: vId.error };

      const sessionId = input.sessionId as string;
      const path = getSessionPath(sessionId);

      if (existsSync(path)) {
        unlinkSync(path);
        return {
          sessionId,
          deleted: true,
          deletedAt: new Date().toISOString(),
        };
      }

      return {
        sessionId,
        deleted: false,
        error: 'Session not found',
      };
    },
  },
  {
    name: 'session_info',
    description: 'Get detailed session information Use when native conversation memory is wrong because you need durable cross-session state — restoring agent definitions, swarm topology, memory store, breaker history. For in-session continuation only, no tool needed. Pair with session_save before exiting and session_restore on resume.',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID' },
      },
      required: ['sessionId'],
    },
    handler: async (input) => {
      // Validate user-provided input (#1425)
      const vId = validateIdentifier(input.sessionId, 'sessionId');
      if (!vId.valid) return { success: false, error: vId.error };

      const sessionId = input.sessionId as string;
      const session = loadSession(sessionId);

      if (session) {
        const path = getSessionPath(sessionId);
        const stat = statSync(path);

        return {
          sessionId: session.sessionId,
          name: session.name,
          description: session.description,
          savedAt: session.savedAt,
          stats: session.stats,
          fileSize: stat.size,
          path,
          hasData: {
            memory: !!session.data?.memory,
            tasks: !!session.data?.tasks,
            agents: !!session.data?.agents,
          },
        };
      }

      return {
        sessionId,
        error: 'Session not found',
      };
    },
  },
  {
    // #1916: `ruflo session current` referenced an unregistered
    // `session_current` tool. Returns the most-recently-saved session.
    name: 'session_current',
    description: 'Return the most-recently-saved session (id, name, stats) — the de-facto "current" one. Use when native conversation memory is wrong because you need to know which durable session is active before exporting/restoring it. For in-session continuation only, no tool needed. Pair with session_export / session_restore.',
    category: 'session',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const dir = getSessionDir();
      if (!existsSync(dir)) return { sessionId: '', status: 'none', startedAt: '', error: 'No saved sessions' };
      const files = readdirSync(dir).filter(f => f.endsWith('.json'));
      if (files.length === 0) return { sessionId: '', status: 'none', startedAt: '', error: 'No saved sessions' };
      let newest = files[0]; let newestMtime = 0;
      for (const f of files) {
        const mt = statSync(join(dir, f)).mtimeMs;
        if (mt >= newestMtime) { newestMtime = mt; newest = f; }
      }
      const sessionId = newest.replace(/\.json$/, '');
      const session = loadSession(sessionId);
      if (!session) return { sessionId, status: 'unknown', startedAt: '', error: 'Session file unreadable' };
      return {
        sessionId: session.sessionId,
        name: session.name,
        status: 'active',
        startedAt: session.savedAt,
        stats: session.stats,
      };
    },
  },
  {
    // #1916: `ruflo session export <id> -o <file>` referenced an unregistered
    // `session_export` tool. Writes the session JSON to a file (if given) and
    // returns the session payload.
    name: 'session_export',
    description: 'Export a saved session (agents, tasks, memory snapshot) to a JSON file and/or return the payload. Use when native Write is wrong because the data is the structured session record (not a freeform file) and you want it serialized consistently for transfer/backup. For writing arbitrary content, native Write is fine. Pair with session_import on the other end.',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'Session ID to export' },
        outputPath: { type: 'string', description: 'File path to write the export to (optional)' },
        includeMemory: { type: 'boolean', description: 'Include the memory snapshot (default true)' },
      },
      required: ['sessionId'],
    },
    handler: async (input) => {
      const vId = validateIdentifier(input.sessionId, 'sessionId');
      if (!vId.valid) return { success: false, error: vId.error };
      const sessionId = input.sessionId as string;
      const session = loadSession(sessionId);
      if (!session) return { sessionId, error: 'Session not found' };
      // Apply the explicit exclusion before either returning or writing the
      // snapshot. The saved source remains intact for a later full restore.
      if (input.includeMemory === false) {
        if (session.data) delete session.data.memory;
        session.stats = { ...session.stats, memoryEntries: 0, totalSize: 0 };
        session.stats.totalSize = Buffer.byteLength(JSON.stringify(session), 'utf-8');
      }
      let path: string | null = null;
      const outputPath = input.outputPath ? String(input.outputPath) : null;
      if (outputPath) {
        try { writeFileSync(outputPath, JSON.stringify(session, null, 2), 'utf-8'); path = outputPath; }
        catch (e) { return { sessionId, error: `Could not write ${outputPath}: ${(e as Error).message}` }; }
      }
      return { sessionId, name: session.name, data: session, path, exportedAt: new Date().toISOString() };
    },
  },
  {
    // #1916: `ruflo session import <file>` referenced an unregistered
    // `session_import` tool. Reads a session JSON and re-saves it locally.
    name: 'session_import',
    description: 'Import a session (produced by session_export) into the local session store and optionally activate it. Pass either inputPath (a session JSON file) or data (the session record itself). Use when native Read is wrong because the file is a structured session record that must be re-registered (new id, stats recomputed) rather than just read. For reading the file, native Read is fine. Pair with session_export on the source.',
    category: 'session',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string', description: 'Path to the session JSON file to import (or pass data)' },
        data: { type: 'object', description: 'The session record itself, as written by session_export (or pass inputPath)' },
        name: { type: 'string', description: 'Override the imported session name' },
        activate: { type: 'boolean', description: 'Restore the imported session into the active stores' },
      },
    },
    handler: async (input) => {
      let parsed: unknown;
      if (input.data !== undefined && input.data !== null) {
        parsed = input.data;
      } else {
        const inputPath = String(input.inputPath ?? '');
        if (!inputPath) return { error: 'Provide inputPath (a session JSON file) or data (a session record)' };
        if (!existsSync(inputPath)) return { error: `File not found: ${inputPath}` };
        try {
          const bytes = readFileSync(inputPath);
          const content = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
          parsed = JSON.parse(content.toString('utf-8'));
        }
        catch (e) { return { error: `Invalid session JSON: ${(e as Error).message}` }; }
      }
      const validationError = validateImportedSession(parsed);
      if (validationError) return { error: validationError };
      const record = parsed as Partial<SessionRecord>;
      const newId = `session-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const stats = {
        tasks: Object.keys((record.data?.tasks?.tasks as object) || {}).length,
        agents: Object.keys((record.data?.agents?.agents as object) || {}).length,
        memoryEntries: countMemoryEntries(record.data?.memory),
        totalSize: 0,
      };
      const session: SessionRecord = {
        sessionId: newId,
        name: input.name ? String(input.name) : (record.name || 'imported-session'),
        description: record.description,
        savedAt: new Date().toISOString(),
        stats,
        data: record.data,
      };
      session.stats.totalSize = Buffer.byteLength(JSON.stringify(session), 'utf-8');
      saveSession(session);
      let activated = false;
      if (input.activate === true) {
        const restore = sessionTools.find(tool => tool.name === 'session_restore')!;
        const result = await restore.handler({ sessionId: newId }) as { restored?: boolean; error?: string };
        if (result.restored !== true) {
          return { sessionId: newId, activated: false, error: result.error || 'Imported session could not be restored' };
        }
        activated = true;
      }
      return {
        sessionId: newId,
        name: session.name,
        importedAt: session.savedAt,
        stats: {
          agentsImported: stats.agents,
          tasksImported: stats.tasks,
          memoryEntriesImported: stats.memoryEntries,
        },
        activated,
      };
    },
  },
];
