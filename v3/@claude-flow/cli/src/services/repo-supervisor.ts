/**
 * #2661 root-fix — one repository-level supervisor.
 *
 * Ten worktree daemons of the same repository independently deciding "is it
 * time to run audit/optimize/testgaps" every tick is the redundant-scheduler
 * half of the original cardinality bug — the budget ledger and job dedup
 * (global-ai-budget.ts, ai-job-dedup.ts) already bound and dedupe the actual
 * `claude --print` spend, but every daemon still runs its own timer and its
 * own "should I launch" decision. This module elects exactly ONE daemon per
 * repositoryId to own the recurring AI-worker schedule; every other worktree
 * of that repository stays a lease-only participant (workspace-lease.ts) —
 * it keeps running its cheap, $0 local-only workers (map/consolidate/backup)
 * on its own schedule, but does not attempt headless (`claude --print`)
 * execution for its recurring ticks. An explicit `daemon trigger --headless`
 * in a non-supervisor worktree is still honored (still budget/dedup-gated) —
 * this module only governs the unattended recurring schedule.
 *
 * Election is a simple lock-protected takeover, same pattern as
 * global-ai-budget.ts:
 *   - No record, a dead PID, or a stale heartbeat (>SUPERVISOR_STALE_MS) →
 *     the calling daemon takes over.
 *   - A live supervisor with a fresh heartbeat → the calling daemon is not
 *     elected; it does nothing (never overwrites a healthy supervisor).
 *
 * The registry lives under the user's home directory so every worktree's
 * daemon can see it:
 *
 *   ~/.claude-flow/supervisors/<repositoryId>.json
 */

import * as fs from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Longer than any plausible daemon heartbeat interval (daemons renew via the
// existing 60s lifecycle-monitor tick) so a merely-slow tick never triggers
// a false takeover, but short enough that a crashed supervisor's worktree
// yields the schedule within a few minutes rather than indefinitely.
export const SUPERVISOR_STALE_MS = 3 * 60 * 1000;
const LOCK_STALE_MS = 10_000;

export interface SupervisorRecord {
  worktreeRoot: string;
  pid: number;
  electedAt: number;
  lastHeartbeat: number;
}

export interface SupervisorElectionResult {
  isSupervisor: boolean;
  record: SupervisorRecord | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Invariant 9 (#2661): registry files must never be symlinks. */
function assertNotSymlink(path: string): void {
  try {
    const st = fs.lstatSync(path);
    if (st.isSymbolicLink()) {
      throw new Error(`Repo-supervisor file is a symlink (refusing): ${path}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

export class RepoSupervisorRegistry {
  private readonly dir: string;

  constructor(options?: { baseDir?: string }) {
    this.dir = options?.baseDir
      ?? process.env.RUFLO_AI_BUDGET_DIR
      ?? join(homedir(), '.claude-flow');
  }

  private fileFor(repositoryId: string): string {
    return join(this.dir, 'supervisors', `${repositoryId}.json`);
  }

  private ensureDir(): void {
    const dir = join(this.dir, 'supervisors');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private async withLock<T>(repositoryId: string, fn: () => T): Promise<T> {
    this.ensureDir();
    const lockFile = `${this.fileFor(repositoryId)}.lock`;
    const deadline = Date.now() + 2000;
    for (;;) {
      try {
        const fd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        try {
          return fn();
        } finally {
          try { fs.unlinkSync(lockFile); } catch { /* already gone */ }
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          const st = fs.lstatSync(lockFile);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch { /* raced — retry */ }
        if (Date.now() > deadline) throw new Error('timed out acquiring repo-supervisor lock');
        await delay(25);
      }
    }
  }

  private readRecord(repositoryId: string): SupervisorRecord | null {
    const file = this.fileFor(repositoryId);
    assertNotSymlink(file);
    if (!fs.existsSync(file)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (raw && typeof raw.pid === 'number' && typeof raw.lastHeartbeat === 'number') {
        return raw as SupervisorRecord;
      }
    } catch { /* corrupt — treat as absent */ }
    return null;
  }

  private writeRecord(repositoryId: string, record: SupervisorRecord): void {
    const file = this.fileFor(repositoryId);
    assertNotSymlink(file);
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  private isStale(record: SupervisorRecord, now: number): boolean {
    return now - record.lastHeartbeat > SUPERVISOR_STALE_MS || !isProcessAlive(record.pid);
  }

  /**
   * Attempt election (or renewal, if this process already holds it). Safe
   * and cheap to call on every daemon tick — a no-op write when nothing
   * needs to change would still cost a lock+read+write, so callers should
   * still throttle to their own heartbeat cadence rather than calling this
   * per-worker-tick.
   */
  async electOrRenew(repositoryId: string, worktreeRoot: string): Promise<SupervisorElectionResult> {
    try {
      return await this.withLock(repositoryId, () => {
        const now = Date.now();
        const existing = this.readRecord(repositoryId);

        if (existing && existing.pid === process.pid && existing.worktreeRoot === worktreeRoot) {
          const renewed: SupervisorRecord = { ...existing, lastHeartbeat: now };
          this.writeRecord(repositoryId, renewed);
          return { isSupervisor: true, record: renewed };
        }

        if (!existing || this.isStale(existing, now)) {
          const record: SupervisorRecord = { worktreeRoot, pid: process.pid, electedAt: now, lastHeartbeat: now };
          this.writeRecord(repositoryId, record);
          return { isSupervisor: true, record };
        }

        // A live supervisor already owns this repository — never overwrite it.
        return { isSupervisor: false, record: existing };
      });
    } catch {
      // Fail closed on the SCHEDULE side too: if we can't safely coordinate,
      // assume we are NOT the supervisor rather than risk two daemons both
      // believing they own the schedule. The budget ledger is the actual
      // hard invariant either way.
      return { isSupervisor: false, record: null };
    }
  }

  /** Cheap read-only check — does NOT renew or elect. */
  isSupervisor(repositoryId: string, worktreeRoot: string): boolean {
    try {
      const existing = this.readRecord(repositoryId);
      if (!existing) return false;
      const now = Date.now();
      if (this.isStale(existing, now)) return false;
      return existing.pid === process.pid && existing.worktreeRoot === worktreeRoot;
    } catch {
      return false;
    }
  }

  /** Release supervisor status on graceful shutdown, so the next tick elsewhere can take over promptly. Best-effort. */
  async release(repositoryId: string, worktreeRoot: string): Promise<void> {
    try {
      await this.withLock(repositoryId, () => {
        const existing = this.readRecord(repositoryId);
        if (existing && existing.pid === process.pid && existing.worktreeRoot === worktreeRoot) {
          const file = this.fileFor(repositoryId);
          try { fs.unlinkSync(file); } catch { /* already gone */ }
        }
      });
    } catch { /* best-effort */ }
  }

  /** Snapshot for `daemon status --all`. Read-only, never mutates. */
  getRecord(repositoryId: string): SupervisorRecord | null {
    try {
      const existing = this.readRecord(repositoryId);
      if (!existing || this.isStale(existing, Date.now())) return null;
      return existing;
    } catch {
      return null;
    }
  }
}

let registryInstance: RepoSupervisorRegistry | null = null;

export function getRepoSupervisorRegistry(): RepoSupervisorRegistry {
  if (!registryInstance) registryInstance = new RepoSupervisorRegistry();
  return registryInstance;
}

/** Test hook: reset the singleton (e.g. after changing RUFLO_AI_BUDGET_DIR). */
export function resetRepoSupervisorRegistryForTests(): void {
  registryInstance = null;
}
