/**
 * Memory health (ADR-457): duplicate and near-duplicate clusters, stale entries and never-recalled namespaces, read from
 * what `memory list --format json` already prints. Pure and read-only: nothing here runs a command or touches a store.
 *
 * ADR-472 adds two inputs, both optional: the hook's recall log (when present, "stale" can mean "the hook did not surface it in N days" for
 * the entries the hook can recall at all) and stored vectors (similar-by-meaning clusters, only when the map's probe read them).
 *
 * What the list carries is key, namespace, size, accessCount, createdAt, updatedAt and whether a vector exists, and NOT
 * the value, so this reads no memory content at all. Three consequences, each stated in the UI rather than hidden:
 *   - a duplicate is judged on the key and the size (exact: same normalised key and same size; near: similar key tokens
 *     and a close size), never on the value;
 *   - "recalled" means accessCount > 0, the count the CLI bumps when an entry is retrieved; there is no last-recalled
 *     timestamp, so "stale" means never recalled AND not updated for STALE_DAYS, and a recalled entry is never called stale;
 *   - the list is the newest HEALTH_CAP entries, and the pairwise comparison has a budget (PAIR_CAP). Both limits are
 *     returned in the result so the view prints them: nothing is truncated silently.
 */
import { type Probe, jsonAfter } from './cli'
import { msOf, numberOf, recordOf, stringOf } from './parse'
import { logWindowMs, surfacedCounts, type RecallFacts } from './recall'

import type { MapEntry } from '../gfx/memmap'

/** Entries read from the store, newest first: the cap the view shows beside every figure. */
export const HEALTH_CAP = 1000
/** Pairwise key comparisons allowed per analysis; the newest entries are compared first and the rest are reported skipped. */
export const PAIR_CAP = 500_000
/** An entry nobody recalled and nobody updated for this long is stale. */
export const STALE_DAYS = 30
/** Key-token Jaccard at or above this, with sizes within SIZE_RATIO of each other, makes two entries near-duplicates. */
export const NEAR_JACCARD = 0.75
export const SIZE_RATIO = 0.2
/** Members kept per cluster and clusters kept in total: the counts above them are exact, the lists are bounded. */
export const CLUSTER_MEMBERS = 8
export const CLUSTERS_KEPT = 12

export type HealthEntry = { key: string; namespace: string; size: number; accessCount: number; updatedAtMs?: number; createdAtMs?: number }
export type HealthSample = { listed: number; entries: HealthEntry[] }

/** The array a list printed: log lines such as `[INFO] …` before it open with `[` too, so the array is the one that opens with `[{`, `[]` or a bare `[`. */
function listJson(stdout: string): unknown {
  const start = /^[ \t]*\[(?=\s*(?:[{\]]|$))/m.exec(stdout)

  return start === null ? jsonAfter(stdout) : jsonAfter(stdout.slice(start.index))
}

/** `memory list` over the newest HEALTH_CAP entries, read as a health sample. */
export const memoryHealthProbe: Probe<HealthSample> = {
  id: 'memory-health',
  args: ['memory', 'list', '--format', 'json', '--limit', String(HEALTH_CAP)],
  views: ['memory'],
  everyMs: 120_000,
  timeoutMs: 45_000,
  parse: stdout => {
    const value = listJson(stdout)

    if (!Array.isArray(value)) return null

    const entries: HealthEntry[] = []

    for (const item of value.slice(0, HEALTH_CAP)) {
      const record = recordOf(item)
      const key = stringOf(record?.key, 128)

      if (record === null || key === undefined) continue

      const updatedAtMs = msOf(record.updatedAt)
      const createdAtMs = msOf(record.createdAt)

      entries.push({
        key,
        namespace: stringOf(record.namespace, 40) ?? '(none)',
        size: Math.max(0, numberOf(record.size) ?? 0),
        accessCount: Math.max(0, numberOf(record.accessCount) ?? 0),
        ...(updatedAtMs !== undefined && { updatedAtMs }),
        ...(createdAtMs !== undefined && { createdAtMs }),
      })
    }

    return { listed: Math.min(value.length, HEALTH_CAP), entries }
  },
}

/** A key with case and separators removed, so `Api/Auth`, `api-auth` and `api_auth` compare equal. */
export const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The words of a key: split on separators and case humps, lowercased, single characters dropped. */
export function keyTokens(key: string): Set<string> {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/)

  return new Set(words.filter(word => word.length > 1))
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0

  let shared = 0

  for (const word of a) if (b.has(word)) shared += 1

  return shared / (a.size + b.size - shared)
}

const sizeClose = (a: number, b: number): boolean => Math.abs(a - b) <= SIZE_RATIO * Math.max(a, b, 1)

export type PairKind = 'exact' | 'near' | null

/** How two entries relate: the same normalised key and size (exact), similar key words and a close size (near), or not. */
export function pairKind(a: HealthEntry, b: HealthEntry, tokensA: ReadonlySet<string>, tokensB: ReadonlySet<string>, normA: string = normaliseKey(a.key), normB: string = normaliseKey(b.key)): PairKind {
  if (a.namespace === b.namespace && a.key === b.key) return null

  if (normA === normB && normA !== '') return a.size === b.size ? 'exact' : 'near'

  return sizeClose(a.size, b.size) && jaccard(tokensA, tokensB) >= NEAR_JACCARD ? 'near' : null
}

export type Cluster = { kind: 'exact' | 'near'; size: number; members: { namespace: string; key: string; size: number }[] }

/** Which rule made an entry stale: the hook's recall log (surfaced in the window?) or the access count (never retrieved). */
export type StaleEntry = HealthEntry & { by: 'log' | 'count' }

export type NamespaceHealth = { name: string; count: number; recalled: number; stale: number; isNeverRecalled: boolean }

export type HealthReport = {
  /** Entries analysed, and how many the store listed in total (equal unless the list itself was cut). */
  analysed: number
  /** Duplicate analysis: pairs compared of pairs possible; `isTruncated` when the budget cut the older entries out. */
  pairsCompared: number
  pairsPossible: number
  isTruncated: boolean
  entriesCompared: number
  clusters: Cluster[]
  clusterCount: number
  /** Entries that sit in some cluster, counting every member (a cluster of 3 is 3). */
  duplicateEntries: number
  stale: StaleEntry[]
  staleCount: number
  /** Per rule: how many stale entries each one named, and how many entries the log could judge at all (the hook can only surface what is in its ranked file). */
  staleByLog: number
  staleByCount: number
  logChecked: number
  /** The log's span in days and its record count; null with no usable log (the access-count rule alone applies). */
  log: { days: number; records: number } | null
  neverRecalledEntries: number
  namespaces: NamespaceHealth[]
  neverRecalledNamespaces: string[]
}

/** What the hook's recall log says about memory entries: the last time each id or category was surfaced, which names the hook can recall at all, and how far back the log reaches. */
export type RecallEvidence = { lastAtMs: ReadonlyMap<string, number>; recallable: ReadonlySet<string>; windowMs: number; records: number }

/**
 * The evidence of a recall facts value, or null with no log or no ranked file. A memory entry joins by an exact key match against a
 * ranked id or its category (the names the log records); entries that do not match are not judged by the log.
 */
export function recallEvidenceOf(facts: RecallFacts | null | undefined, nowMs: number): RecallEvidence | null {
  if (facts === null || facts === undefined || facts.log.length === 0 || facts.ranked === null) return null

  const lastAtMs = new Map<string, number>()

  for (const item of surfacedCounts(facts.log).values()) {
    for (const name of [item.id, item.category]) if (name !== '') lastAtMs.set(name, Math.max(lastAtMs.get(name) ?? 0, item.lastAtMs))
  }

  const recallable = new Set<string>()

  for (const entry of facts.ranked.entries) {
    recallable.add(entry.id)
    if (entry.category !== '') recallable.add(entry.category)
  }

  return { lastAtMs, recallable, windowMs: logWindowMs(facts.log, nowMs), records: facts.log.length }
}

/** Find the clusters: union of every exact/near pair among the newest entries the pair budget reaches. */
function findClusters(entries: readonly HealthEntry[], pairCap: number): { clusters: Cluster[]; compared: number; entriesCompared: number; isTruncated: boolean; possible: number } {
  const n = entries.length
  const possible = (n * (n - 1)) / 2
  const parent = entries.map((_, index) => index)
  const kinds = new Map<number, Set<'exact' | 'near'>>()
  const find = (index: number): number => {
    let root = index

    while (parent[root] !== root) root = parent[root] ?? root

    parent[index] = root

    return root
  }
  // Per-entry work done once, not once per pair: the profile put the per-pair normaliseKey regex at the top of the cost.
  const tokens = entries.map(entry => keyTokens(entry.key))
  const norms = entries.map(entry => normaliseKey(entry.key))
  let compared = 0
  let reached = n
  const pairKinds: { a: number; b: number; kind: 'exact' | 'near' }[] = []

  // Entry j is compared against every older-in-list entry before it, so the budget drops the oldest entries first.
  outer: for (let j = 1; j < n; j += 1) {
    for (let i = 0; i < j; i += 1) {
      if (compared >= pairCap) {
        reached = j

        break outer
      }

      compared += 1

      const entryA = entries[i]
      const entryB = entries[j]
      const kind = entryA === undefined || entryB === undefined ? null : pairKind(entryA, entryB, tokens[i] ?? new Set(), tokens[j] ?? new Set(), norms[i], norms[j])

      if (kind !== null) pairKinds.push({ a: i, b: j, kind })
    }
  }

  for (const { a, b } of pairKinds) parent[find(a)] = find(b)

  for (const { a, kind } of pairKinds) {
    const root = find(a)
    const set = kinds.get(root) ?? new Set<'exact' | 'near'>()

    set.add(kind)
    kinds.set(root, set)
  }

  const groups = new Map<number, number[]>()

  for (let index = 0; index < n; index += 1) {
    const root = find(index)

    if (kinds.has(root)) groups.set(root, [...(groups.get(root) ?? []), index])
  }

  const clusters: Cluster[] = [...groups].map(([root, indexes]) => ({
    // A cluster is exact only when every link inside it is exact.
    kind: kinds.get(root)?.has('near') === true ? 'near' : 'exact',
    size: indexes.length,
    members: indexes.slice(0, CLUSTER_MEMBERS).flatMap(index => {
      const entry = entries[index]

      return entry === undefined ? [] : [{ namespace: entry.namespace, key: entry.key, size: entry.size }]
    }),
  }))

  clusters.sort((a, b) => (a.kind === b.kind ? b.size - a.size : a.kind === 'exact' ? -1 : 1))

  return { clusters, compared, entriesCompared: reached, isTruncated: reached < n, possible }
}

/** The whole report for a sample at `nowMs`; all limits are arguments so a test can shrink them. */
export function analyseHealth(sample: HealthSample, nowMs: number, options: { staleDays?: number; pairCap?: number; evidence?: RecallEvidence | null } = {}): HealthReport {
  const staleDays = options.staleDays ?? STALE_DAYS
  const entries = [...sample.entries].sort((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
  const cutoff = nowMs - staleDays * 86_400_000
  const found = findClusters(entries, options.pairCap ?? PAIR_CAP)
  // The log can speak only if it reaches back as far as the stale window, and only for names the hook can recall.
  const evidence = options.evidence ?? null
  const logSpeaks = evidence !== null && evidence.windowMs >= staleDays * 86_400_000
  const isLogChecked = (entry: HealthEntry): boolean => logSpeaks && evidence.recallable.has(entry.key)
  // An entry with no timestamp is never called stale: its age is unknown, not old.
  // Log rule: not surfaced by the hook inside the window and not updated inside it (accessCount has no time, so it does not vote).
  // Count rule: never retrieved (accessCount 0) and not updated inside the window.
  const staleBy = (entry: HealthEntry): 'log' | 'count' | null => {
    if (entry.updatedAtMs === undefined || entry.updatedAtMs >= cutoff) return null

    if (isLogChecked(entry)) return (evidence?.lastAtMs.get(entry.key) ?? 0) < cutoff ? 'log' : null

    return entry.accessCount === 0 ? 'count' : null
  }
  const isStale = (entry: HealthEntry): boolean => staleBy(entry) !== null
  const stale = entries.flatMap((entry): StaleEntry[] => {
    const by = staleBy(entry)

    return by === null ? [] : [{ ...entry, by }]
  }).sort((a, b) => (a.updatedAtMs ?? 0) - (b.updatedAtMs ?? 0))
  const byName = new Map<string, NamespaceHealth>()

  for (const entry of entries) {
    const space = byName.get(entry.namespace) ?? { name: entry.namespace, count: 0, recalled: 0, stale: 0, isNeverRecalled: false }

    space.count += 1
    if (entry.accessCount > 0) space.recalled += 1
    if (isStale(entry)) space.stale += 1
    byName.set(entry.namespace, space)
  }

  const namespaces = [...byName.values()].map(space => ({ ...space, isNeverRecalled: space.count > 0 && space.recalled === 0 })).sort((a, b) => b.count - a.count)

  return {
    analysed: entries.length,
    pairsCompared: found.compared,
    pairsPossible: found.possible,
    isTruncated: found.isTruncated,
    entriesCompared: found.entriesCompared,
    clusters: found.clusters.slice(0, CLUSTERS_KEPT),
    clusterCount: found.clusters.length,
    duplicateEntries: found.clusters.reduce((sum, cluster) => sum + cluster.size, 0),
    stale: stale.slice(0, 10),
    staleCount: stale.length,
    staleByLog: stale.filter(entry => entry.by === 'log').length,
    staleByCount: stale.filter(entry => entry.by === 'count').length,
    logChecked: entries.filter(isLogChecked).length,
    log: evidence === null ? null : { days: evidence.windowMs / 86_400_000, records: evidence.records },
    neverRecalledEntries: entries.filter(entry => entry.accessCount === 0).length,
    namespaces,
    neverRecalledNamespaces: namespaces.filter(space => space.isNeverRecalled).map(space => space.name),
  }
}

/** Cosine at or above this makes two stored vectors a similar-by-meaning pair; high on purpose, so the list is short and the pairs are real. */
export const SIMILAR_COSINE = 0.97
/** Entries with a vector compared at most: the pair work is O(n^2 * dims), about 50 ms at 500 x 384. */
export const SEMANTIC_CAP = 500

export type SimilarCluster = { size: number; minCosine: number; members: { namespace: string; key: string }[] }

export type SemanticReport = {
  /** Entries with a stored vector that were compared, of those the list carried and of all it listed; the cap is what bounded them. */
  compared: number
  withVector: number
  listed: number
  cap: number
  pairs: number
  clusters: SimilarCluster[]
  clusterCount: number
  /** Entries in some cluster, counting every member. */
  entries: number
}

/**
 * Similar-by-meaning clusters among entries that carry a stored vector (the map's probe reads them: `memory list --embeddings`).
 * Null when none carries one, so the caller never reports a check that did not run. Union of every pair at or above `threshold`.
 */
export function semanticDuplicates(listed: readonly MapEntry[], threshold: number = SIMILAR_COSINE): SemanticReport | null {
  const withVector = listed.filter(entry => entry.vector !== undefined && entry.vector.length > 1)

  if (withVector.length < 2) return null

  const pool = withVector.slice(0, SEMANTIC_CAP)
  const dims = Math.max(...pool.map(entry => entry.vector?.length ?? 0))
  const unit = pool.map(entry => {
    const out = new Float64Array(dims)
    let norm = 0

    for (let i = 0; i < (entry.vector?.length ?? 0); i++) {
      const value = entry.vector?.[i] ?? 0

      out[i] = value
      norm += value * value
    }

    const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0

    for (let i = 0; i < dims; i++) out[i] = (out[i] as number) * scale

    return out
  })
  const parent = pool.map((_, index) => index)
  const find = (index: number): number => {
    let root = index

    while (parent[root] !== root) root = parent[root] ?? root

    parent[index] = root

    return root
  }
  const worst = new Map<number, number>()
  const links: { a: number; b: number; cosine: number }[] = []

  for (let j = 1; j < pool.length; j += 1) {
    const vj = unit[j] as Float64Array

    for (let i = 0; i < j; i += 1) {
      const vi = unit[i] as Float64Array
      let dot = 0

      for (let d = 0; d < dims; d += 1) dot += (vi[d] as number) * (vj[d] as number)

      if (dot >= threshold) links.push({ a: i, b: j, cosine: dot })
    }
  }

  for (const { a, b } of links) parent[find(a)] = find(b)

  for (const { a, cosine } of links) {
    const root = find(a)

    worst.set(root, Math.min(worst.get(root) ?? 1, cosine))
  }

  const groups = new Map<number, number[]>()

  for (let index = 0; index < pool.length; index += 1) {
    const root = find(index)

    if (worst.has(root)) groups.set(root, [...(groups.get(root) ?? []), index])
  }

  const clusters = [...groups].map(([root, indexes]): SimilarCluster => ({
    size: indexes.length,
    minCosine: worst.get(root) ?? threshold,
    members: indexes.slice(0, CLUSTER_MEMBERS).flatMap(index => {
      const entry = pool[index]

      return entry === undefined ? [] : [{ namespace: entry.namespace, key: entry.key }]
    }),
  })).sort((a, b) => b.size - a.size || b.minCosine - a.minCosine)

  return { compared: pool.length, withVector: withVector.length, listed: listed.length, cap: SEMANTIC_CAP, pairs: (pool.length * (pool.length - 1)) / 2, clusters: clusters.slice(0, CLUSTERS_KEPT), clusterCount: clusters.length, entries: clusters.reduce((sum, cluster) => sum + cluster.size, 0) }
}
