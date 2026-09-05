/**
 * Parent-death watchdog (#2234).
 *
 * `ruflo mcp start` runs as a double-forked grandchild of Claude Code (`npx -y
 * ruflo … mcp start` → `npm exec …` → `node … mcp start`). When Claude Code
 * exits, only the `npm exec` shim is terminated; the `node` server reparents to
 * `launchd`/`init` (`ppid === 1`) and silently lingers — leaving ~50 MB and an
 * open database handle per restart. Over a week this accumulates to ~20
 * orphaned servers (~1 GB), and an arbitrary stale one can win the next stdio
 * handshake, transparently serving superseded code.
 *
 * Cheap, robust fix: poll `process.ppid`. When it becomes 1 (and didn't start
 * there), our original parent has exited — we're orphaned. Run the cleanup
 * hook and exit cleanly.
 *
 * @module runtime/parent-death-watchdog
 */

export interface ParentDeathWatchdogOptions {
  /** Poll interval in ms. Default 2000. */
  intervalMs?: number;
  /**
   * Cleanup hook fired when orphaning is detected. May be async. After it
   * resolves (or throws), the process exits with code 0 (success) / 1 (error).
   * Defaults to `process.exit(0)` directly.
   */
  onOrphaned?: () => void | Promise<void>;
  /** Override `process.ppid` getter (tests). */
  ppidGetter?: () => number;
  /** Override `process.exit` (tests). */
  exit?: (code: number) => void;
}

export interface ParentDeathWatchdog {
  stop(): void;
  /** Manually trigger the orphan check (used by tests). */
  checkOnce(): Promise<void>;
}

/**
 * Install a parent-death watchdog. Safe to call once per process; calling
 * twice replaces the previous interval.
 */
export function installParentDeathWatchdog(opts: ParentDeathWatchdogOptions = {}): ParentDeathWatchdog {
  const intervalMs = opts.intervalMs ?? 2000;
  const get = opts.ppidGetter ?? (() => process.ppid);
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const onOrphaned = opts.onOrphaned;

  const initialPpid = get();
  let triggered = false;
  let timer: NodeJS.Timeout | undefined;

  const triggerOrphaned = async (): Promise<void> => {
    if (triggered) return;
    triggered = true;
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }
    try {
      if (onOrphaned) await onOrphaned();
      exit(0);
    } catch {
      exit(1);
    }
  };

  const checkOnce = async (): Promise<void> => {
    // Only trigger when we *transition* to ppid=1; if we already started there
    // (process launched directly under launchd/init) it isn't an orphan event.
    const ppid = get();
    if (ppid === 1 && initialPpid !== 1) await triggerOrphaned();
  };

  timer = setInterval(() => {
    void checkOnce();
  }, intervalMs);
  // Don't keep the event loop alive on the watchdog alone.
  if (typeof (timer as NodeJS.Timeout).unref === 'function') (timer as NodeJS.Timeout).unref();

  return {
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    checkOnce,
  };
}
