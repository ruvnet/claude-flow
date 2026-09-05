/**
 * #2661 — Cross-worktree AI job dedup (issue invariant 5).
 *
 * N worktrees of one repository checked out at the same HEAD schedule the
 * same analyses independently: N audits of identical content, N optimize
 * passes, N testgap sweeps. Before a model launch, callers compute
 *
 *   jobKey = sha256(repositoryId, head, workerType, workerConfigHash)
 *
 * and skip the launch when the same job succeeded within the freshness
 * window. HEAD moves → new key → the job runs again.
 *
 * The registry lives next to the AI budget ledger under the user's home
 * directory (owner-only, symlink-rejecting) so all daemons share it:
 *
 *   ~/.claude-flow/ai-jobs.json
 *
 * This is a best-effort OPTIMIZATION layered under the budget: two daemons
 * racing the same key may both miss and both attempt a launch, but the
 * budget's atomic reservation (maxConcurrentGlobal / hourly cap) is the hard
 * invariant that bounds actual launches. Only operational metadata is
 * persisted — never prompts, outputs, or source content.
 */

import * as fs from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

export interface AiJobKeyParts {
  repositoryId: string;
  head: string;
  workerType: string;
  /** Hash of the effective worker config (prompt/model/sandbox/patterns). */
  configHash: string;
}

interface JobRecord {
  at: number;
  workerType: string;
  repositoryId: string;
  workspace: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeAiJobKey(parts: AiJobKeyParts): string {
  return createHash('sha256')
    .update([parts.repositoryId, parts.head, parts.workerType, parts.configHash].join('\n'))
    .digest('hex');
}

/** Stable hash of an arbitrary config object (key-sorted JSON). */
export function hashWorkerConfig(config: unknown): string {
  const canonical = JSON.stringify(config, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
  return createHash('sha256').update(canonical ?? 'null').digest('hex');
}

/** Invariant 9: registry files must never be symlinks. */
function assertNotSymlink(path: string): void {
  try {
    const st = fs.lstatSync(path);
    if (st.isSymbolicLink()) {
      throw new Error(`AI job registry is a symlink (refusing): ${path}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

export class AiJobDedupRegistry {
  private readonly dir: string;
  private readonly file: string;

  constructor(options?: { baseDir?: string }) {
    this.dir = options?.baseDir
      ?? process.env.RUFLO_AI_BUDGET_DIR
      ?? join(homedir(), '.claude-flow');
    this.file = join(this.dir, 'ai-jobs.json');
  }

  /**
   * True when the job succeeded within `freshnessMs`. Any registry error
   * reads as "not fresh" — dedup failing open only costs a (budget-capped)
   * launch, never correctness.
   */
  isFresh(jobKey: string, freshnessMs: number): { fresh: boolean; lastRunAt?: number } {
    if (process.env.RUFLO_AI_DEDUP_DISABLE === '1') return { fresh: false };
    try {
      const records = this.read();
      const rec = records[jobKey];
      if (rec && Date.now() - rec.at < freshnessMs) {
        return { fresh: true, lastRunAt: rec.at };
      }
      return { fresh: false, lastRunAt: rec?.at };
    } catch {
      return { fresh: false };
    }
  }

  /** Record a successful run of a job. Best-effort. */
  recordSuccess(jobKey: string, meta: { workerType: string; repositoryId: string; workspace: string }): void {
    try {
      const records = this.read();
      records[jobKey] = { at: Date.now(), ...meta };
      this.write(records);
    } catch { /* dedup is an optimization — never block on it */ }
  }

  private read(): Record<string, JobRecord> {
    assertNotSymlink(this.file);
    if (!fs.existsSync(this.file)) return {};
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    if (!raw || typeof raw !== 'object') return {};
    // Prune anything older than 24h — freshness windows are far shorter,
    // and HEAD churn would otherwise grow the file without bound.
    const now = Date.now();
    const out: Record<string, JobRecord> = {};
    for (const [key, rec] of Object.entries(raw as Record<string, JobRecord>)) {
      if (rec && typeof rec.at === 'number' && now - rec.at < DAY_MS) {
        out[key] = rec;
      }
    }
    return out;
  }

  private write(records: Record<string, JobRecord>): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }
    assertNotSymlink(this.file);
    const tmp = `${this.file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(records), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

// Singleton — one registry per process.
let registryInstance: AiJobDedupRegistry | null = null;

export function getAiJobDedupRegistry(): AiJobDedupRegistry {
  if (!registryInstance) {
    registryInstance = new AiJobDedupRegistry();
  }
  return registryInstance;
}

/** Test hook: reset the singleton (e.g. after changing RUFLO_AI_BUDGET_DIR). */
export function resetAiJobDedupRegistryForTests(): void {
  registryInstance = null;
}
