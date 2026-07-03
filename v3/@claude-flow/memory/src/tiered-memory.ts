/**
 * Tier-aware in-memory store with Zep/Graphiti-style temporal validity.
 *
 * This is the store backing `agentdb_hierarchical-store` / `-recall` when
 * agentdb's native HierarchicalMemory is unavailable (previously an inline
 * stub in controller-registry.ts). It is promoted to a first-class module
 * so temporal knowledge semantics live in one tested place:
 *
 * - Facts may carry a validity window (`validFrom` / `validUntil`).
 * - Conflicting facts are INVALIDATED, not overwritten: `supersedes`
 *   stamps the old entry with `validUntil = now` + `supersededBy = <newId>`
 *   and archives it — the history stays queryable.
 * - `recall()` filters invalid entries by default; `includeExpired: true`
 *   is the audit escape hatch.
 * - Entries without temporal fields behave exactly as before (always valid).
 *
 * API shape is kept duck-type compatible with the previous stub so the CLI
 * memory-bridge keeps working unchanged:
 *   store(key, value, tier)   recall(query, topK)   getTierStats()
 *
 * IMPORTANT: this class must NOT expose both `getStats` and `promote` —
 * that pair is the bridge's detection signal for the REAL agentdb
 * HierarchicalMemory API.
 *
 * @module @claude-flow/memory/tiered-memory
 */

/** Temporal options accepted by {@link TieredMemoryStore.store}. */
export interface TemporalStoreOptions {
  /** ISO-8601 timestamp from which the fact is valid (default: always). */
  validFrom?: string;
  /** ISO-8601 timestamp after which the fact is no longer valid. */
  validUntil?: string;
  /**
   * Id (or key) of an existing entry this fact supersedes. The old entry
   * is stamped `validUntil = now`, `supersededBy = <new id>` and archived —
   * never deleted.
   */
  supersedes?: string;
}

/** Options accepted by {@link TieredMemoryStore.recall}. */
export interface TieredRecallOptions {
  /**
   * Include entries whose validity window has closed (superseded or
   * expired) and entries not yet valid. Audit escape hatch — default false.
   */
  includeExpired?: boolean;
}

/** A stored tiered-memory entry. */
export interface TieredMemoryEntry {
  id: string;
  key: string;
  value: string;
  tier: string;
  ts: number;
  validFrom?: string;
  validUntil?: string;
  supersededBy?: string;
}

/** Result of a store operation. */
export interface TieredStoreResult {
  id: string;
  key: string;
  tier: string;
  /** Set when `supersedes` matched an existing entry. */
  superseded?: { id: string; key: string; validUntil: string } | null;
}

const VALID_TIERS = ['working', 'episodic', 'semantic'] as const;
const MAX_PER_TIER = 5000;
const MAX_ARCHIVED = 5000;
const MAX_VALUE_LENGTH = 100_000;
const MAX_QUERY_LENGTH = 10_000;

let idCounter = 0;
function nextId(): string {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `tm_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

/**
 * Returns true when the entry is valid at `nowMs`.
 * Entries without temporal fields are always valid (legacy behavior).
 * Unparseable timestamps are ignored (treated as absent) rather than
 * silently hiding the entry.
 */
export function isTemporallyValid(
  entry: Pick<TieredMemoryEntry, 'validFrom' | 'validUntil'>,
  nowMs: number = Date.now()
): boolean {
  if (entry.validFrom) {
    const from = Date.parse(entry.validFrom);
    if (!Number.isNaN(from) && from > nowMs) return false; // not yet valid
  }
  if (entry.validUntil) {
    const until = Date.parse(entry.validUntil);
    if (!Number.isNaN(until) && until <= nowMs) return false; // expired/superseded
  }
  return true;
}

/**
 * Tier-aware in-memory store with temporal validity and per-tier size
 * limits to prevent unbounded memory growth.
 */
export class TieredMemoryStore {
  private tiers: Record<string, Map<string, TieredMemoryEntry>> = {
    working: new Map(),
    episodic: new Map(),
    semantic: new Map(),
  };

  /**
   * Superseded entries are moved here so a same-key re-store cannot
   * clobber the historical fact. Bounded FIFO.
   */
  private archived: TieredMemoryEntry[] = [];

  /**
   * Store an entry. Same-key stores within a tier overwrite (legacy
   * behavior); use `options.supersedes` to invalidate-and-keep instead.
   */
  store(
    key: string,
    value: string,
    tier: string = 'working',
    options?: TemporalStoreOptions
  ): TieredStoreResult {
    const tierName = (VALID_TIERS as readonly string[]).includes(tier) ? tier : 'working';
    const t = this.tiers[tierName];

    const id = nextId();
    let superseded: TieredStoreResult['superseded'] = null;

    if (options?.supersedes) {
      superseded = this.supersede(options.supersedes, id);
    }

    // Evict oldest if at capacity
    if (t.size >= MAX_PER_TIER) {
      const oldest = t.keys().next().value;
      if (oldest !== undefined) t.delete(oldest);
    }

    const entry: TieredMemoryEntry = {
      id,
      key,
      value: value.substring(0, MAX_VALUE_LENGTH),
      tier: tierName,
      ts: Date.now(),
    };
    if (options?.validFrom) entry.validFrom = options.validFrom;
    if (options?.validUntil) entry.validUntil = options.validUntil;

    t.set(key, entry);
    return { id, key, tier: tierName, superseded };
  }

  /**
   * Invalidate an existing entry (matched by id first, then by key) by
   * stamping `validUntil = now` + `supersededBy = newId` and moving it to
   * the archive. The entry is NOT deleted — `recall(..., { includeExpired:
   * true })` still returns it.
   */
  supersede(idOrKey: string, newId: string): TieredStoreResult['superseded'] {
    const found = this.findActive(idOrKey);
    if (!found) return null;

    const { map, entry } = found;
    const now = new Date().toISOString();
    entry.validUntil = now;
    entry.supersededBy = newId;

    map.delete(entry.key);
    this.archived.push(entry);
    if (this.archived.length > MAX_ARCHIVED) this.archived.shift();

    return { id: entry.id, key: entry.key, validUntil: now };
  }

  /**
   * Substring recall across tiers, newest first. By default only
   * temporally-valid entries are returned; pass `{ includeExpired: true }`
   * to audit superseded / expired / future-dated facts too.
   */
  recall(query: string, topK = 5, options?: TieredRecallOptions): TieredMemoryEntry[] {
    const safeTopK = Math.min(Math.max(1, topK), 100);
    const q = query.toLowerCase().substring(0, MAX_QUERY_LENGTH);
    const includeExpired = options?.includeExpired === true;
    const now = Date.now();
    const results: TieredMemoryEntry[] = [];

    const consider = (entry: TieredMemoryEntry): boolean => {
      if (!entry.key.toLowerCase().includes(q) && !entry.value.toLowerCase().includes(q)) {
        return false;
      }
      if (!includeExpired && !isTemporallyValid(entry, now)) return false;
      results.push(entry);
      return true;
    };

    outer: for (const map of Object.values(this.tiers)) {
      for (const entry of map.values()) {
        consider(entry);
        if (results.length >= safeTopK * 3) break outer; // early exit for large stores
      }
    }

    if (includeExpired && results.length < safeTopK * 3) {
      for (const entry of this.archived) {
        consider(entry);
        if (results.length >= safeTopK * 3) break;
      }
    }

    return results.sort((a, b) => b.ts - a.ts).slice(0, safeTopK);
  }

  /** Hard-delete an active entry by key (used by hierarchical-delete). */
  remove(key: string): boolean {
    for (const map of Object.values(this.tiers)) {
      if (map.delete(key)) return true;
    }
    return false;
  }

  /** Per-tier active counts plus the superseded-archive size. */
  getTierStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [name, map] of Object.entries(this.tiers)) {
      stats[name] = map.size;
    }
    stats.superseded = this.archived.length;
    return stats;
  }

  private findActive(
    idOrKey: string
  ): { map: Map<string, TieredMemoryEntry>; entry: TieredMemoryEntry } | null {
    // Prefer id match (exact provenance), fall back to key match.
    for (const map of Object.values(this.tiers)) {
      for (const entry of map.values()) {
        if (entry.id === idOrKey) return { map, entry };
      }
    }
    for (const map of Object.values(this.tiers)) {
      const entry = map.get(idOrKey);
      if (entry) return { map, entry };
    }
    return null;
  }
}

export default TieredMemoryStore;
