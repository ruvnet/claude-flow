/**
 * #2661 root-fix — worktree leases.
 *
 * Registers which worktrees of a repository are currently "alive" (have a
 * running daemon actively heartbeating), independent of whether that
 * worktree's daemon is the elected repository supervisor (see
 * repo-supervisor.ts). A lease expires after 15 minutes without a heartbeat
 * — a removed worktree, or a daemon that crashed without a graceful
 * shutdown, becomes ineligible within one expiry window instead of lingering
 * forever in the registry.
 *
 * The registry lives under the user's home directory (not the workspace) so
 * it is visible to every worktree's daemon, keyed by repositoryId:
 *
 *   ~/.claude-flow/leases/<repositoryId>.json
 *
 * This is deliberately a thin, single-purpose registry — repo-supervisor.ts
 * is the piece that actually elects one process to own the recurring AI
 * worker schedule; leases only answer "which worktrees are currently live"
 * for status reporting and future supervisor-dispatched work.
 */

import * as fs from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

export const LEASE_TTL_MS = 15 * 60 * 1000; // 15 minutes — issue #2661 spec
const LOCK_STALE_MS = 10_000;

export interface LeaseRecord {
  worktreeRoot: string;
  pid: number;
  registeredAt: number;
  lastHeartbeat: number;
}

interface LeaseFile {
  version: 1;
  leases: Record<string, LeaseRecord>; // keyed by sha256(worktreeRoot).slice(0,16)
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
      throw new Error(`Workspace lease file is a symlink (refusing): ${path}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

function leaseKey(worktreeRoot: string): string {
  return createHash('sha256').update(worktreeRoot).digest('hex').slice(0, 16);
}

export class WorkspaceLeaseRegistry {
  private readonly dir: string;

  constructor(options?: { baseDir?: string }) {
    this.dir = options?.baseDir
      ?? process.env.RUFLO_AI_BUDGET_DIR // shares the same override as global-ai-budget for test isolation
      ?? join(homedir(), '.claude-flow');
  }

  private fileFor(repositoryId: string): string {
    return join(this.dir, 'leases', `${repositoryId}.json`);
  }

  private ensureDir(repositoryId: string): void {
    const dir = join(this.dir, 'leases');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    void repositoryId;
  }

  private async withLock<T>(repositoryId: string, fn: () => T): Promise<T> {
    this.ensureDir(repositoryId);
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
        if (Date.now() > deadline) throw new Error('timed out acquiring workspace-lease lock');
        await delay(25);
      }
    }
  }

  private readFile(repositoryId: string): LeaseFile {
    const file = this.fileFor(repositoryId);
    assertNotSymlink(file);
    let parsed: LeaseFile = { version: 1, leases: {} };
    if (fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        if (raw && typeof raw === 'object' && raw.leases && typeof raw.leases === 'object') {
          parsed = { version: 1, leases: raw.leases };
        }
      } catch { /* corrupt — start fresh */ }
    }
    return parsed;
  }

  private writeFile(repositoryId: string, data: LeaseFile): void {
    const file = this.fileFor(repositoryId);
    assertNotSymlink(file);
    const tmp = `${file}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  /** Register or renew this process's lease on a worktree. Best-effort. */
  async heartbeat(repositoryId: string, worktreeRoot: string): Promise<void> {
    try {
      await this.withLock(repositoryId, () => {
        const data = this.readFile(repositoryId);
        const now = Date.now();
        const key = leaseKey(worktreeRoot);
        const existing = data.leases[key];
        data.leases[key] = {
          worktreeRoot,
          pid: process.pid,
          registeredAt: existing?.registeredAt ?? now,
          lastHeartbeat: now,
        };
        this.writeFile(repositoryId, data);
      });
    } catch { /* best-effort — a missed heartbeat just expires the lease early */ }
  }

  /** Release this worktree's lease on graceful shutdown. Best-effort. */
  async release(repositoryId: string, worktreeRoot: string): Promise<void> {
    try {
      await this.withLock(repositoryId, () => {
        const data = this.readFile(repositoryId);
        delete data.leases[leaseKey(worktreeRoot)];
        this.writeFile(repositoryId, data);
      });
    } catch { /* best-effort */ }
  }

  /**
   * Active leases for a repository — expired (>15 min stale) or dead-PID
   * entries are excluded, not just filtered at read time, so callers never
   * see a worktree that's actually gone.
   */
  listActive(repositoryId: string): LeaseRecord[] {
    try {
      const data = this.readFile(repositoryId);
      const now = Date.now();
      return Object.values(data.leases).filter(
        (l) => now - l.lastHeartbeat < LEASE_TTL_MS && isProcessAlive(l.pid),
      );
    } catch {
      return [];
    }
  }

  /** True when the given worktree currently holds a live (non-expired) lease. */
  isLeaseActive(repositoryId: string, worktreeRoot: string): boolean {
    return this.listActive(repositoryId).some((l) => l.worktreeRoot === worktreeRoot);
  }
}

let registryInstance: WorkspaceLeaseRegistry | null = null;

export function getWorkspaceLeaseRegistry(): WorkspaceLeaseRegistry {
  if (!registryInstance) registryInstance = new WorkspaceLeaseRegistry();
  return registryInstance;
}

/** Test hook: reset the singleton (e.g. after changing RUFLO_AI_BUDGET_DIR). */
export function resetWorkspaceLeaseRegistryForTests(): void {
  registryInstance = null;
}
