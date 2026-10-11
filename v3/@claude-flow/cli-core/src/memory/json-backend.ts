/**
 * JsonMemoryBackend — the lite memory implementation that ships in cli-core.
 *
 * Persists entries to a JSON file (default: `.swarm/memory.json`, override
 * via CLAUDE_FLOW_MEMORY_PATH). No SQLite, no HNSW, no ONNX embeddings —
 * deliberately so that cli-core stays under 250 KB packed.
 *
 * Search degrades to substring matching (case-insensitive). For real
 * semantic search install @claude-flow/cli (the heavy SqliteHnswMemoryBackend
 * implements the same interface).
 *
 * Atomicity: every write goes through a temp file + atomic rename. No
 * inflight reader sees a half-written JSON. Concurrent writers across
 * processes are NOT coordinated — the last writer wins. Acceptable for
 * single-developer plugin workloads; not safe under high write contention.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  MemoryBackend,
  MemoryEntry,
  MemorySearchResult,
  MemoryStats,
  StoreOptions,
  SearchOptions,
  ListOptions,
} from './backend.js';

const DEFAULT_PATH = '.swarm/memory.json';

interface FileShape {
  version: 1;
  backend: 'json';
  entries: Record<string, MemoryEntry>; // key: `${namespace}::${key}`
  createdAt: string;
  updatedAt: string;
}

function compositeKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class JsonMemoryBackend implements MemoryBackend {
  readonly id = 'json';
  private readonly path: string;
  private cache: FileShape | null = null;

  constructor(opts?: { path?: string }) {
    this.path = resolve(opts?.path || process.env.CLAUDE_FLOW_MEMORY_PATH || DEFAULT_PATH);
  }

  private load(): FileShape {
    if (this.cache) return structuredClone(this.cache);
    if (!existsSync(this.path)) {
      const fresh: FileShape = {
        version: 1,
        backend: 'json',
        entries: {},
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.cache = fresh;
      return structuredClone(fresh);
    }
    try {
      const raw = readFileSync(this.path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1) {
        throw new Error(`Unsupported memory file version: ${parsed.version}`);
      }
      this.cache = parsed;
      return structuredClone(parsed);
    } catch (err) {
      throw new Error(`memory: failed to load ${this.path}: ${(err as Error).message}`);
    }
  }

  private save(state: FileShape): void {
    state.updatedAt = nowIso();
    const dir = dirname(this.path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmp = `${this.path}.tmp.${process.pid}.${Date.now()}`;
    const serialized = JSON.stringify(state, null, 2);
    writeFileSync(tmp, serialized, 'utf-8');
    renameSync(tmp, this.path);
    // Commit only the independently owned representation actually persisted.
    this.cache = JSON.parse(serialized);
  }

  private isExpired(entry: MemoryEntry): boolean {
    if (!entry.ttlSeconds) return false;
    const expiresAt = new Date(entry.storedAt).getTime() + entry.ttlSeconds * 1000;
    return Date.now() > expiresAt;
  }

  async store(key: string, value: unknown, opts?: StoreOptions): Promise<void> {
    const namespace = opts?.namespace || 'default';
    const ck = compositeKey(namespace, key);
    const state = this.load();
    if (state.entries[ck] && !opts?.upsert) {
      throw new Error(`memory: UNIQUE constraint failed for namespace='${namespace}' key='${key}' (pass --upsert to overwrite)`);
    }
    state.entries[ck] = {
      key,
      value,
      namespace,
      tags: opts?.tags || [],
      storedAt: nowIso(),
      accessCount: 0,
      lastAccessed: nowIso(),
      ttlSeconds: opts?.ttl,
    };
    this.save(state);
  }

  async retrieve(key: string, opts?: { namespace?: string }): Promise<MemoryEntry | null> {
    const namespace = opts?.namespace || 'default';
    const ck = compositeKey(namespace, key);
    const state = this.load();
    const entry = state.entries[ck];
    if (!entry) return null;
    if (this.isExpired(entry)) {
      delete state.entries[ck];
      this.save(state);
      return null;
    }
    entry.accessCount++;
    entry.lastAccessed = nowIso();
    this.save(state);
    return { ...entry };
  }

  async search(query: string, opts?: SearchOptions): Promise<MemorySearchResult[]> {
    const namespace = opts?.namespace;
    const limit = opts?.limit ?? 10;
    const threshold = opts?.threshold ?? 0;
    const q = query.toLowerCase();
    const state = this.load();
    const out: MemorySearchResult[] = [];
    for (const entry of Object.values(state.entries)) {
      if (this.isExpired(entry)) continue;
      if (namespace && entry.namespace !== namespace) continue;
      // Simple substring scoring:
      //   1.0  → exact substring of key OR exact substring of value (string form)
      //   0.5  → case-insensitive partial (currently the same — kept distinct so
      //          the heavy backend's similarity scoring can map cleanly)
      //   0    → no match
      const haystack = `${entry.key} ${JSON.stringify(entry.value)}`.toLowerCase();
      let score = 0;
      if (haystack.includes(q)) score = 1.0;
      if (score < threshold) continue;
      out.push({ ...entry, score, backend: 'json' });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  async list(opts?: ListOptions): Promise<MemoryEntry[]> {
    const namespace = opts?.namespace;
    const limit = opts?.limit ?? 100;
    const tags = opts?.tags;
    const state = this.load();
    const out: MemoryEntry[] = [];
    for (const entry of Object.values(state.entries)) {
      if (this.isExpired(entry)) continue;
      if (namespace && entry.namespace !== namespace) continue;
      if (tags && tags.length > 0) {
        const hasAll = tags.every((t) => entry.tags.includes(t));
        if (!hasAll) continue;
      }
      out.push({ ...entry });
    }
    return out.slice(0, limit);
  }

  async delete(key: string, opts?: { namespace?: string }): Promise<boolean> {
    const namespace = opts?.namespace || 'default';
    const ck = compositeKey(namespace, key);
    const state = this.load();
    if (!state.entries[ck]) return false;
    delete state.entries[ck];
    this.save(state);
    return true;
  }

  async stats(): Promise<MemoryStats> {
    const state = this.load();
    const entries = Object.values(state.entries);
    const namespaces = [...new Set(entries.map((e) => e.namespace))].sort();
    const sizeBytes = existsSync(this.path)
      ? readFileSync(this.path, 'utf-8').length
      : 0;
    return {
      totalEntries: entries.length,
      namespaces,
      sizeBytes,
      backend: this.id,
    };
  }
}
