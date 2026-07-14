/**
 * #2661 — Global AI launch budget (emergency cost fuse).
 *
 * Every autonomous `claude --print` launch across ALL ruflo daemons in ALL
 * worktrees/workspaces owned by the current user must pass through this
 * user-global budget before a process is created. Without it, N worktree
 * daemons each schedule their own AI workers and aggregate launch volume
 * scales linearly with worktree count — enough to exhaust a user's Claude
 * hourly quota silently (13 launches/hour/daemon under the legacy schedule).
 *
 * The ledger lives under the user's home directory (NOT the workspace) so
 * daemons started from different worktrees of the same repository — or from
 * unrelated repositories — all share one budget:
 *
 *   ~/.claude-flow/ai-budget.json           launch ledger + circuit breaker
 *   ~/.claude-flow/ai-budget.lock           O_EXCL mutation lock
 *   ~/.claude-flow/ai-budget-receipts.jsonl launch/deny/pause receipts
 *
 * Files are owner-only (0700 dir / 0600 files) and symlinks are rejected
 * (invariant 9 of #2661). All checks happen BEFORE process creation and the
 * ledger mutation is atomic under the lock, so two daemons racing for the
 * last hourly slot cannot both win.
 *
 * Default limits (issue #2661 containment):
 *   maxConcurrentGlobal      1   at most one autonomous claude child, user-wide
 *   maxLaunchesPerHour       2
 *   maxLaunchesPerDay        12
 *   pauseOnQuotaErrorMinutes 60  circuit breaker on 429/quota responses
 */

import * as fs from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface AiBudgetLimits {
  maxConcurrentGlobal: number;
  maxLaunchesPerHour: number;
  maxLaunchesPerDay: number;
  pauseOnQuotaErrorMinutes: number;
}

export const DEFAULT_AI_BUDGET_LIMITS: AiBudgetLimits = {
  maxConcurrentGlobal: 1,
  maxLaunchesPerHour: 2,
  maxLaunchesPerDay: 12,
  pauseOnQuotaErrorMinutes: 60,
};

export interface AiBudgetRequest {
  workerType: string;
  model: string;
  /** Worktree/workspace root requesting the launch (recorded for receipts only). */
  workspace: string;
}

export interface AiBudgetPermit {
  allowed: boolean;
  permitId?: string;
  reason?: string;
}

interface LaunchRecord {
  at: number;
  pid: number;
  workerType: string;
  model: string;
  workspace: string;
}

interface ActiveRecord {
  permitId: string;
  at: number;
  pid: number;
  workerType: string;
}

interface Ledger {
  version: 1;
  launches: LaunchRecord[];
  active: ActiveRecord[];
  pausedUntil?: number;
  pauseReason?: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Active reservations older than this are treated as abandoned (crashed
// daemon). Must exceed the daemon's 16-min worker timeout with margin.
const ACTIVE_STALE_MS = 30 * 60 * 1000;
// A mutation lock older than this belongs to a crashed process — take it over.
const LOCK_STALE_MS = 10_000;
const RECEIPTS_MAX_BYTES = 512 * 1024;
const RECEIPTS_KEEP_LINES = 200;

/**
 * Heuristic match for Anthropic quota / rate-limit failures. Only ever
 * applied to ERROR output of a FAILED launch (never to successful analysis
 * output, which may legitimately discuss "rate limiting" in the user's code).
 */
export function isQuotaErrorText(text: string | undefined): boolean {
  if (!text) return false;
  return /\b429\b|rate[\s_-]?limit|usage[\s_-]?limit|quota|too many requests|overloaded_error/i.test(text);
}

function envPositiveInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Invariant 9: registry files must never be symlinks. */
function assertNotSymlink(path: string): void {
  try {
    const st = fs.lstatSync(path);
    if (st.isSymbolicLink()) {
      throw new Error(`AI budget file is a symlink (refusing): ${path}`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class GlobalAiBudget {
  private readonly dir: string;
  private readonly ledgerFile: string;
  private readonly lockFile: string;
  private readonly receiptsFile: string;
  private readonly limits: AiBudgetLimits;

  constructor(options?: { baseDir?: string; limits?: Partial<AiBudgetLimits> }) {
    this.dir = options?.baseDir
      ?? process.env.RUFLO_AI_BUDGET_DIR
      ?? join(homedir(), '.claude-flow');
    this.ledgerFile = join(this.dir, 'ai-budget.json');
    this.lockFile = join(this.dir, 'ai-budget.lock');
    this.receiptsFile = join(this.dir, 'ai-budget-receipts.jsonl');
    this.limits = {
      maxConcurrentGlobal:
        options?.limits?.maxConcurrentGlobal
        ?? envPositiveInt('RUFLO_AI_MAX_CONCURRENT')
        ?? DEFAULT_AI_BUDGET_LIMITS.maxConcurrentGlobal,
      maxLaunchesPerHour:
        options?.limits?.maxLaunchesPerHour
        ?? envPositiveInt('RUFLO_AI_MAX_PER_HOUR')
        ?? DEFAULT_AI_BUDGET_LIMITS.maxLaunchesPerHour,
      maxLaunchesPerDay:
        options?.limits?.maxLaunchesPerDay
        ?? envPositiveInt('RUFLO_AI_MAX_PER_DAY')
        ?? DEFAULT_AI_BUDGET_LIMITS.maxLaunchesPerDay,
      pauseOnQuotaErrorMinutes:
        options?.limits?.pauseOnQuotaErrorMinutes
        ?? envPositiveInt('RUFLO_AI_QUOTA_PAUSE_MINUTES')
        ?? DEFAULT_AI_BUDGET_LIMITS.pauseOnQuotaErrorMinutes,
    };
  }

  getLimits(): AiBudgetLimits {
    return { ...this.limits };
  }

  /**
   * Atomically reserve one launch slot. Denials carry a machine-readable
   * reason and are receipted. The reservation is counted as a launch
   * immediately (the hourly/daily invariant is on launches, not completions);
   * `release()` only frees the concurrency slot.
   *
   * Fails CLOSED: if the ledger cannot be read or locked, the launch is
   * denied — an unaccountable launch is exactly what this fuse exists to
   * prevent. `RUFLO_AI_BUDGET_DISABLE=1` is the explicit escape hatch.
   */
  async reserve(req: AiBudgetRequest): Promise<AiBudgetPermit> {
    if (process.env.RUFLO_AI_BUDGET_DISABLE === '1') {
      return { allowed: true, permitId: `bypass_${Date.now()}_${process.pid}` };
    }

    let unlock: (() => void) | null = null;
    try {
      unlock = await this.acquireLock();
      const now = Date.now();
      const ledger = this.readLedger(now);

      let reason: string | null = null;
      if (ledger.pausedUntil && ledger.pausedUntil > now) {
        reason = `circuit-open until ${new Date(ledger.pausedUntil).toISOString()} (${ledger.pauseReason ?? 'quota error'})`;
      } else if (ledger.active.length >= this.limits.maxConcurrentGlobal) {
        reason = `global-concurrency (${ledger.active.length}/${this.limits.maxConcurrentGlobal} active)`;
      } else {
        const lastHour = ledger.launches.filter((l) => now - l.at < HOUR_MS).length;
        const lastDay = ledger.launches.length; // already pruned to 24h
        if (lastHour >= this.limits.maxLaunchesPerHour) {
          reason = `hourly-budget (${lastHour}/${this.limits.maxLaunchesPerHour} in last hour)`;
        } else if (lastDay >= this.limits.maxLaunchesPerDay) {
          reason = `daily-budget (${lastDay}/${this.limits.maxLaunchesPerDay} in last 24h)`;
        }
      }

      if (reason) {
        this.appendReceipt({ event: 'deny', at: now, reason, ...req });
        return { allowed: false, reason };
      }

      const permitId = `permit_${now}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
      ledger.launches.push({ at: now, pid: process.pid, workerType: req.workerType, model: req.model, workspace: req.workspace });
      ledger.active.push({ permitId, at: now, pid: process.pid, workerType: req.workerType });
      this.writeLedger(ledger);
      this.appendReceipt({ event: 'launch', at: now, permitId, ...req });
      return { allowed: true, permitId };
    } catch (e) {
      // Fail closed — see docstring.
      const reason = `budget-ledger-error: ${e instanceof Error ? e.message : String(e)}`;
      try { this.appendReceipt({ event: 'deny', at: Date.now(), reason, ...req }); } catch { /* best-effort */ }
      return { allowed: false, reason };
    } finally {
      unlock?.();
    }
  }

  /** Free the concurrency slot held by a permit. Best-effort. */
  async release(permitId: string | undefined): Promise<void> {
    if (!permitId || permitId.startsWith('bypass_')) return;
    let unlock: (() => void) | null = null;
    try {
      unlock = await this.acquireLock();
      const ledger = this.readLedger(Date.now());
      const before = ledger.active.length;
      ledger.active = ledger.active.filter((a) => a.permitId !== permitId);
      if (ledger.active.length !== before) this.writeLedger(ledger);
    } catch {
      // Abandoned reservations expire via ACTIVE_STALE_MS pruning.
    } finally {
      unlock?.();
    }
  }

  /**
   * Open the user-global circuit breaker: a quota/429 response from ANY
   * daemon pauses ALL autonomous Claude launches for the cooldown window.
   */
  async recordQuotaError(detail: string): Promise<void> {
    let unlock: (() => void) | null = null;
    try {
      unlock = await this.acquireLock();
      const now = Date.now();
      const ledger = this.readLedger(now);
      ledger.pausedUntil = now + this.limits.pauseOnQuotaErrorMinutes * 60 * 1000;
      ledger.pauseReason = detail.slice(0, 200);
      this.writeLedger(ledger);
      this.appendReceipt({ event: 'quota-pause', at: now, until: ledger.pausedUntil, detail: ledger.pauseReason });
    } catch {
      // best-effort — the hourly budget still bounds retries
    } finally {
      unlock?.();
    }
  }

  /**
   * #2661 root-fix — manual pause, via `ruflo daemon budget pause`. Distinct
   * from the automatic quota-error circuit breaker only in duration (open-
   * ended, until explicitly resumed, instead of a fixed cooldown) and
   * reason text — the enforcement path in reserve() is identical, so a
   * manual pause is just as hard a stop as a quota-triggered one.
   */
  async pause(reason?: string): Promise<void> {
    let unlock: (() => void) | null = null;
    try {
      unlock = await this.acquireLock();
      const now = Date.now();
      const ledger = this.readLedger(now);
      // Sentinel far-future timestamp rather than a real duration — resume()
      // is the only thing that clears it. year ~2255, safely beyond any
      // realistic process lifetime, and still a valid finite JS timestamp.
      ledger.pausedUntil = 9_000_000_000_000;
      ledger.pauseReason = (reason ?? 'manual pause (ruflo daemon budget pause)').slice(0, 200);
      this.writeLedger(ledger);
      this.appendReceipt({ event: 'manual-pause', at: now, reason: ledger.pauseReason });
    } finally {
      unlock?.();
    }
  }

  /** #2661 root-fix — `ruflo daemon budget resume`. Clears ANY pause (manual or quota-triggered). */
  async resume(): Promise<void> {
    let unlock: (() => void) | null = null;
    try {
      unlock = await this.acquireLock();
      const now = Date.now();
      const ledger = this.readLedger(now);
      const wasPaused = ledger.pausedUntil !== undefined && ledger.pausedUntil > now;
      ledger.pausedUntil = undefined;
      ledger.pauseReason = undefined;
      this.writeLedger(ledger);
      if (wasPaused) {
        this.appendReceipt({ event: 'manual-resume', at: now });
      }
    } finally {
      unlock?.();
    }
  }

  /**
   * #2661 root-fix — structured per-launch token telemetry. Best-effort,
   * receipt-only: usage is recorded as a distinct receipt keyed by permitId
   * rather than mutated into the launch ledger, so a usage-recording failure
   * can never corrupt the budget-enforcement ledger. Only operational
   * metadata — never prompts or source content.
   */
  recordUsage(permitId: string | undefined, usage: {
    workerType: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    durationMs?: number;
    costUsd?: number;
  }): void {
    if (!permitId || permitId.startsWith('bypass_')) return;
    this.appendReceipt({ event: 'usage', at: Date.now(), permitId, ...usage });
  }

  /** Snapshot for `daemon status` / diagnostics. */
  getUsage(): {
    lastHour: number;
    lastDay: number;
    active: number;
    pausedUntil?: number;
    pauseReason?: string;
    /** #2661 — 24h launch counts per worktree/workspace, most active first. */
    byWorkspace: Array<{ workspace: string; launches: number }>;
  } {
    try {
      const now = Date.now();
      const ledger = this.readLedger(now);
      const byWs = new Map<string, number>();
      for (const l of ledger.launches) {
        byWs.set(l.workspace, (byWs.get(l.workspace) ?? 0) + 1);
      }
      return {
        lastHour: ledger.launches.filter((l) => now - l.at < HOUR_MS).length,
        lastDay: ledger.launches.length,
        active: ledger.active.length,
        pausedUntil: ledger.pausedUntil && ledger.pausedUntil > now ? ledger.pausedUntil : undefined,
        pauseReason: ledger.pausedUntil && ledger.pausedUntil > now ? ledger.pauseReason : undefined,
        byWorkspace: Array.from(byWs.entries())
          .map(([workspace, launches]) => ({ workspace, launches }))
          .sort((a, b) => b.launches - a.launches),
      };
    } catch {
      return { lastHour: 0, lastDay: 0, active: 0, byWorkspace: [] };
    }
  }

  // -- internals ----------------------------------------------------------

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    }
  }

  private async acquireLock(): Promise<() => void> {
    this.ensureDir();
    const deadline = Date.now() + 2000;
    for (;;) {
      try {
        const fd = fs.openSync(this.lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return () => {
          try { fs.unlinkSync(this.lockFile); } catch { /* already gone */ }
        };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        // Stale lock from a crashed process — take over.
        try {
          const st = fs.lstatSync(this.lockFile);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(this.lockFile);
            continue;
          }
        } catch { /* raced — retry */ }
        if (Date.now() > deadline) {
          throw new Error('timed out acquiring ai-budget lock');
        }
        await delay(25);
      }
    }
  }

  /** Read + prune the ledger. Caller must hold the lock for read-modify-write. */
  private readLedger(now: number): Ledger {
    assertNotSymlink(this.ledgerFile);
    let ledger: Ledger = { version: 1, launches: [], active: [] };
    if (fs.existsSync(this.ledgerFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.ledgerFile, 'utf-8'));
        if (raw && typeof raw === 'object') {
          ledger = {
            version: 1,
            launches: Array.isArray(raw.launches) ? raw.launches.filter((l: LaunchRecord) => typeof l?.at === 'number') : [],
            active: Array.isArray(raw.active) ? raw.active.filter((a: ActiveRecord) => typeof a?.at === 'number') : [],
            pausedUntil: typeof raw.pausedUntil === 'number' ? raw.pausedUntil : undefined,
            pauseReason: typeof raw.pauseReason === 'string' ? raw.pauseReason : undefined,
          };
        }
      } catch {
        // Corrupt ledger: start fresh rather than blocking forever. The next
        // write re-establishes it; worst case one over-budget launch.
      }
    }
    ledger.launches = ledger.launches.filter((l) => now - l.at < DAY_MS);
    // Drop reservations whose process died (tolerating PID reuse via the
    // staleness cutoff) or that outlived any plausible worker run.
    ledger.active = ledger.active.filter(
      (a) => now - a.at < ACTIVE_STALE_MS && isProcessAlive(a.pid)
    );
    if (ledger.pausedUntil && ledger.pausedUntil <= now) {
      ledger.pausedUntil = undefined;
      ledger.pauseReason = undefined;
    }
    return ledger;
  }

  private writeLedger(ledger: Ledger): void {
    this.ensureDir();
    assertNotSymlink(this.ledgerFile);
    const tmp = `${this.ledgerFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ledger), { mode: 0o600 });
    fs.renameSync(tmp, this.ledgerFile);
  }

  /**
   * Invariant 10: every launch, denial, and pause emits a receipt. Only
   * operational metadata is persisted — never prompts or source content.
   */
  private appendReceipt(receipt: Record<string, unknown>): void {
    try {
      this.ensureDir();
      assertNotSymlink(this.receiptsFile);
      fs.appendFileSync(this.receiptsFile, JSON.stringify(receipt) + '\n', { mode: 0o600 });
      const st = fs.statSync(this.receiptsFile);
      if (st.size > RECEIPTS_MAX_BYTES) {
        const lines = fs.readFileSync(this.receiptsFile, 'utf-8').split('\n');
        fs.writeFileSync(this.receiptsFile, lines.slice(-RECEIPTS_KEEP_LINES).join('\n'), { mode: 0o600 });
      }
    } catch {
      // Receipts are best-effort; never block a decision on them.
    }
  }
}

// Singleton — one budget per process, shared by all executors.
let budgetInstance: GlobalAiBudget | null = null;

export function getGlobalAiBudget(): GlobalAiBudget {
  if (!budgetInstance) {
    budgetInstance = new GlobalAiBudget();
  }
  return budgetInstance;
}

/** Test hook: reset the singleton (e.g. after changing RUFLO_AI_BUDGET_DIR). */
export function resetGlobalAiBudgetForTests(): void {
  budgetInstance = null;
}
