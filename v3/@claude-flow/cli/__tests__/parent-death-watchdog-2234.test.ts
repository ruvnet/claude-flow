// Regression tests for #2234 — parent-death watchdog so `ruflo mcp start`
// doesn't orphan and accumulate ~1 GB of stale MCP servers when Claude Code
// restarts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { installParentDeathWatchdog } from '../src/runtime/parent-death-watchdog.js';

describe('parent-death watchdog (#2234)', () => {
  afterEach(() => vi.useRealTimers());

  it('fires the orphan hook + exits when ppid transitions to 1', async () => {
    vi.useFakeTimers();
    let ppid = 5000;
    const exit = vi.fn();
    const onOrphaned = vi.fn();
    const wd = installParentDeathWatchdog({
      intervalMs: 100,
      ppidGetter: () => ppid,
      exit,
      onOrphaned,
    });

    // Still parented to Claude Code → no action.
    await vi.advanceTimersByTimeAsync(150);
    expect(onOrphaned).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    // Parent dies → reparented to launchd/init.
    ppid = 1;
    await vi.advanceTimersByTimeAsync(150);

    expect(onOrphaned).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    wd.stop();
  });

  it('never fires when the process started with ppid=1 (already daemonised)', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    const onOrphaned = vi.fn();
    const wd = installParentDeathWatchdog({
      intervalMs: 50,
      ppidGetter: () => 1, // initial AND current ppid is init
      exit,
      onOrphaned,
    });

    await vi.advanceTimersByTimeAsync(300);

    expect(onOrphaned).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    wd.stop();
  });

  it('only triggers once (idempotent on rapid re-checks)', async () => {
    const exit = vi.fn();
    const onOrphaned = vi.fn();
    let ppid = 4242;
    const wd = installParentDeathWatchdog({
      intervalMs: 999_999, // disable the timer; use manual checks
      ppidGetter: () => ppid,
      exit,
      onOrphaned,
    });

    ppid = 1;
    await wd.checkOnce();
    await wd.checkOnce();
    await wd.checkOnce();
    expect(onOrphaned).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    wd.stop();
  });

  it('exit code 1 when the orphan hook throws', async () => {
    const exit = vi.fn();
    const wd = installParentDeathWatchdog({
      intervalMs: 999_999,
      ppidGetter: () => 1,
      exit,
      onOrphaned: () => { throw new Error('cleanup failed'); },
    });
    // ppidGetter returns 1 immediately, but initialPpid was also 1 → wouldn't
    // fire normally. Force it via a separate watchdog with transition:
    wd.stop();
    let ppid = 999;
    const wd2 = installParentDeathWatchdog({
      intervalMs: 999_999,
      ppidGetter: () => ppid,
      exit,
      onOrphaned: () => { throw new Error('boom'); },
    });
    ppid = 1;
    await wd2.checkOnce();
    expect(exit).toHaveBeenCalledWith(1);
    wd2.stop();
  });
});
