/**
 * Memory Distillation Service (ADR-174)
 *
 * Turns raw `memory_entries` (what ruflo has been RECORDING for thousands of
 * commits) into the structured intelligence substrate it has never populated:
 * `episodes` → `reasoning_patterns` (+ `pattern_embeddings`) → `causal_edges`.
 * This is the DISTILL/CONSOLIDATE half of the RETRIEVE→JUDGE→DISTILL→CONSOLIDATE
 * pipeline; RETRIEVE (embeddings) was already populated, the rest was empty
 * because the daemon's `consolidate` worker was a stub (see ADR-174 root cause).
 *
 * Design invariants (load-bearing):
 *  - $0 by default: reuses the deterministic structural extractor
 *    (structured-distill.ts) and the embeddings ALREADY on each row — no LLM
 *    call, no new embedding work, unless a caller explicitly opts into a judge.
 *  - Incremental: a `distill_state` cursor (per namespace, by monotonic rowid)
 *    means a run never rescans processed rows.
 *  - Non-destructive: NEVER mutates or deletes `memory_entries`; only inserts
 *    into the (previously empty) target tables. Writes are per-batch
 *    transactions — a failure rolls back the batch and advances no cursor.
 *  - Safe on a recovered DB: quick_check gate before any write; skips (not
 *    throws) on corruption; better-sqlite3 optional (silent no-op if absent).
 *  - Provenance discipline (ADR-171): `feedback` outcomes are execution-tier
 *    ground truth; everything else is proxy. Proxy-tier patterns are written
 *    but never `promoted` — visible for audit, excluded from promoted recall.
 */
import * as fs from 'fs';
import * as path from 'path';

import { distillTrajectoryContent, serialiseDistilled } from '../memory/structured-distill.js';

export type DistillProvenance = 'oracle:test-exec' | 'judge:fable' | 'proxy:structural';

export interface DistillOptions {
  dbPath: string;
  /** Restrict to these namespaces (default: all namespaces with embeddings). */
  namespaces?: string[];
  /** Rows per transaction (default 200). */
  batchSize?: number;
  /** Hard cap on rows processed this invocation (default: unbounded within a run). */
  maxEntries?: number;
  /** Cosine distance below which two entries collapse into one pattern (default 0.2, the ADR-174 M4-tuned platform default: ~37% fewer patterns, retrieval-neutral). */
  dedupDistance?: number;
  /** Report counts, write nothing (default false). */
  dryRun?: boolean;
  /** Judge tier. Only 'structural' ($0) is implemented here; 'fable' is reserved (ADR-172). */
  judge?: 'structural' | 'fable';
  /** Ignore the cursor and re-scan from this rowid (default: cursor-driven). */
  sinceRowid?: number;
  verbose?: boolean;
}

export interface DistillReport {
  processed: number;
  episodes: number;
  patterns: number;
  patternEmbeddings: number;
  causalEdges: number;
  promoted: number;
  byProvenance: Record<string, number>;
  namespaces: string[];
  dryRun: boolean;
  spendUsd: number;
  corrupt?: boolean;
  skipped?: string;
}

interface SourceRow {
  rowid: number;
  id: string;
  namespace: string;
  content: string;
  embedding: number[] | null;
}

interface Cluster {
  rep: SourceRow;
  members: SourceRow[];
  successCount: number;
  provenance: DistillProvenance;
}

function emptyReport(dryRun: boolean, extra: Partial<DistillReport> = {}): DistillReport {
  return {
    processed: 0, episodes: 0, patterns: 0, patternEmbeddings: 0, causalEdges: 0,
    promoted: 0, byProvenance: {}, namespaces: [], dryRun, spendUsd: 0, ...extra,
  };
}

function parseEmbedding(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const mag = Math.sqrt(na * nb);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * Best-effort success/reward extraction for a `feedback` outcome record. These
 * are recorded post-edit outcomes — execution-observed ground truth (ADR-171
 * execution tier), not a proxy guess.
 */
function judgeFeedback(content: string): { success: boolean; reward: number } {
  try {
    const o = JSON.parse(content);
    if (typeof o.success === 'boolean') return { success: o.success, reward: o.success ? 1 : 0 };
    if (typeof o.outcome === 'string') { const ok = /success|pass|ok|true/i.test(o.outcome); return { success: ok, reward: ok ? 1 : 0 }; }
    if (typeof o.error === 'string' && o.error) return { success: false, reward: 0 };
  } catch { /* not JSON — treat as neutral */ }
  return { success: true, reward: 0.5 };
}

/**
 * Distill accumulated memory into the structured intelligence tables.
 * Incremental, $0, transactional, provenance-tagged.
 */
export async function runDistillation(options: DistillOptions): Promise<DistillReport> {
  const {
    dbPath, namespaces, batchSize = 200, maxEntries,
    dedupDistance = 0.2, dryRun = false, judge = 'structural',
    sinceRowid, verbose = false,
  } = options;

  if (judge === 'fable') {
    // ADR-172 cost gate: the LLM judge path is not enabled in this $0 service.
    return emptyReport(dryRun, { skipped: 'judge:fable requires the cost-bounded advisor path (ADR-172), not enabled here' });
  }
  if (!dbPath || !fs.existsSync(dbPath)) return emptyReport(dryRun, { skipped: 'no-db' });

  let Database: any;
  try {
    const mod: string = 'better-sqlite3';
    Database = (await import(mod)).default;
  } catch {
    return emptyReport(dryRun, { skipped: 'better-sqlite3 unavailable' });
  }

  const report = emptyReport(dryRun);
  let db: any;
  try {
    db = new Database(dbPath, { timeout: 3000 });

    const tableExists = (name: string): boolean =>
      (db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name=?").get(name)?.c ?? 0) > 0;
    if (!tableExists('memory_entries')) { db.close(); return { ...report, skipped: 'no memory_entries' }; }
    for (const t of ['episodes', 'reasoning_patterns', 'pattern_embeddings', 'causal_edges']) {
      if (!tableExists(t)) { db.close(); return { ...report, skipped: `target table ${t} missing (agentdb schema not initialised)` }; }
    }

    // Safety gate: never distill into a structurally-corrupt DB.
    const qc = db.prepare('PRAGMA quick_check(1)').get() as Record<string, string> | undefined;
    if (qc && String(Object.values(qc)[0] ?? '').toLowerCase() !== 'ok') {
      db.close();
      return { ...report, corrupt: true, skipped: 'memory DB reports corruption — run recoverMemoryDatabase first' };
    }

    // M0: incremental cursor table (per namespace, by monotonic rowid).
    db.exec(`CREATE TABLE IF NOT EXISTS distill_state (
      namespace TEXT PRIMARY KEY,
      last_rowid INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER
    )`);

    // Which namespaces to process.
    const nsAll = (db.prepare(
      "SELECT DISTINCT COALESCE(namespace,'default') AS ns FROM memory_entries WHERE embedding IS NOT NULL",
    ).all() as Array<{ ns: string }>).map(r => r.ns);
    const nsList = namespaces && namespaces.length ? nsAll.filter(n => namespaces.includes(n)) : nsAll;
    report.namespaces = nsList;

    const getCursor = db.prepare('SELECT last_rowid FROM distill_state WHERE namespace = ?');
    const setCursor = db.prepare(
      'INSERT INTO distill_state (namespace, last_rowid, last_run_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(namespace) DO UPDATE SET last_rowid = excluded.last_rowid, last_run_at = excluded.last_run_at',
    );

    const insEpisode = db.prepare(
      'INSERT INTO episodes (session_id, task, input, output, reward, success, tags, metadata) VALUES (?,?,?,?,?,?,?,?)',
    );
    const insPattern = db.prepare(
      'INSERT INTO reasoning_patterns (task_type, approach, success_rate, uses, avg_reward, tags, metadata) VALUES (?,?,?,?,?,?,?)',
    );
    const insPatEmb = db.prepare('INSERT OR REPLACE INTO pattern_embeddings (pattern_id, embedding) VALUES (?, ?)');
    const insEdge = db.prepare(
      'INSERT INTO causal_edges (from_memory_id, from_memory_type, to_memory_id, to_memory_type, similarity, confidence, mechanism, metadata) VALUES (?,?,?,?,?,?,?,?)',
    );

    let remaining = typeof maxEntries === 'number' ? maxEntries : Infinity;

    for (const ns of nsList) {
      if (remaining <= 0) break;
      let cursor = typeof sinceRowid === 'number' ? sinceRowid : (getCursor.get(ns)?.last_rowid ?? 0);

      // Process this namespace in bounded batches until drained or cap hit.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (remaining <= 0) break;
        const lim = Math.min(batchSize, remaining);
        const rows = db.prepare(
          "SELECT rowid AS rowid, id, COALESCE(namespace,'default') AS namespace, content, embedding " +
          'FROM memory_entries WHERE embedding IS NOT NULL AND COALESCE(namespace,' + "'default'" + ') = ? AND rowid > ? ' +
          'ORDER BY rowid LIMIT ?',
        ).all(ns, cursor, lim) as Array<{ rowid: number; id: string; namespace: string; content: string; embedding: string }>;
        if (rows.length === 0) break;

        const src: SourceRow[] = rows.map(r => ({
          rowid: r.rowid, id: r.id, namespace: r.namespace,
          content: String(r.content ?? ''), embedding: parseEmbedding(r.embedding),
        }));

        // Greedy cosine clustering within the batch (bounded n → O(n²) is fine).
        const clusters: Cluster[] = [];
        for (const row of src) {
          let placed = false;
          if (row.embedding) {
            for (const cl of clusters) {
              if (cl.rep.embedding && cosine(row.embedding, cl.rep.embedding) >= 1 - dedupDistance) {
                cl.members.push(row);
                if (ns === 'feedback' && judgeFeedback(row.content).success) cl.successCount++;
                placed = true; break;
              }
            }
          }
          if (!placed) {
            const success = ns === 'feedback' ? judgeFeedback(row.content).success : false;
            clusters.push({
              rep: row, members: [row], successCount: success ? 1 : 0,
              provenance: ns === 'feedback' ? 'oracle:test-exec' : 'proxy:structural',
            });
          }
        }

        const maxRowid = Math.max(...src.map(r => r.rowid), cursor);

        // Embedding-coverage invariant: a cluster is only written if it has an
        // embeddable representative — reselect to any member with a valid
        // (parseable) vector; skip the cluster if none (unretrievable anyway).
        // Guarantees every reasoning_pattern has exactly one pattern_embedding.
        const embVecOf = (cl: Cluster): number[] | null =>
          cl.rep.embedding ?? cl.members.find(m => m.embedding)?.embedding ?? null;

        if (!dryRun) {
          const commit = db.transaction(() => {
            let prevEpId: number | null = null;
            for (const cl of clusters) {
              const embVec = embVecOf(cl);
              if (!embVec) continue; // no embeddable member → skip (keeps 1:1)

              const distilled = distillTrajectoryContent(cl.rep.content);
              const taskType = distilled.labels[0] ?? ns;
              const approach = distilled.summary || serialiseDistilled(distilled).slice(0, 200);
              const uses = cl.members.length;
              const successRate = cl.provenance === 'oracle:test-exec' ? cl.successCount / uses : 0;
              const avgReward = successRate; // structural: reward == success fraction
              const promoted = cl.provenance === 'oracle:test-exec'; // proxy NEVER promotes (ADR-171)
              const provMeta = {
                provenance: cl.provenance, provenance_tier: cl.provenance, promoted,
                sourceIds: cl.members.map(m => m.id).slice(0, 25),
                paths: distilled.paths.slice(0, 10), namespace: ns, distilledBy: 'structural',
              };

              const epInfo = insEpisode.run(
                `distill:${ns}`, approach, cl.rep.content.slice(0, 2000), '',
                avgReward, promoted && cl.successCount > 0 ? 1 : 0,
                JSON.stringify(distilled.labels), JSON.stringify(provMeta),
              );
              report.episodes++;

              const patInfo = insPattern.run(
                taskType, approach, successRate, uses, avgReward,
                JSON.stringify(distilled.labels), JSON.stringify(provMeta),
              );
              const patternId = Number(patInfo.lastInsertRowid);
              report.patterns++;
              report.byProvenance[cl.provenance] = (report.byProvenance[cl.provenance] ?? 0) + 1;
              if (promoted) report.promoted++;

              // pattern_embeddings: reuse the representative's existing 384-dim
              // vector as a Float32 BLOB — $0, no re-embedding. Guaranteed 1:1.
              insPatEmb.run(patternId, Buffer.from(Float32Array.from(embVec).buffer));
              report.patternEmbeddings++;

              // WEAK relational edge — NOT causal proof. Links to the actual
              // previous episode (not epId-1, which wrongly assumed consecutive
              // rowids). Explicitly typed co-occurrence / proxy-tier / non-
              // promoted: may rank retrieval, must NOT justify autonomous action
              // (ADR-174 edge contract).
              const epId = Number(epInfo.lastInsertRowid);
              if (prevEpId !== null) {
                insEdge.run(
                  prevEpId, 'episode', epId, 'episode',
                  0, 0.3, 'co-occurrence',
                  JSON.stringify({
                    edge_type: 'cooccurrence',
                    provenance_tier: 'proxy:structural',
                    confidence: 0.3,
                    promoted: false,
                    namespace: ns,
                    note: 'weak co-occurrence; may rank retrieval, must not justify autonomous action',
                  }),
                );
                report.causalEdges++;
              }
              prevEpId = epId;
            }
            setCursor.run(ns, maxRowid, Date.now());
          });
          commit();
        } else {
          // dry-run accounting only — mirror the embeddable-cluster skip.
          for (const cl of clusters) {
            if (!embVecOf(cl)) continue;
            report.patterns++;
            report.episodes++;
            report.byProvenance[cl.provenance] = (report.byProvenance[cl.provenance] ?? 0) + 1;
            if (cl.provenance === 'oracle:test-exec') report.promoted++;
          }
        }

        report.processed += rows.length;
        remaining -= rows.length;
        cursor = maxRowid;
        if (rows.length < lim) break; // namespace drained
      }
    }

    db.close();
    if (verbose) {
      console.log(
        `distilled ${report.processed} entries → ${report.patterns} patterns ` +
        `(${report.promoted} promoted), ${report.episodes} episodes, ${report.causalEdges} edges` +
        (dryRun ? ' [dry-run]' : ''),
      );
    }
  } catch (e) {
    try { db?.close(); } catch { /* */ }
    return { ...report, skipped: `error: ${(e as Error)?.message ?? e}` };
  }
  return report;
}

/** Where the memory DB lives, for daemon/CLI callers. */
export function defaultMemoryDbPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.swarm', 'memory.db');
}
