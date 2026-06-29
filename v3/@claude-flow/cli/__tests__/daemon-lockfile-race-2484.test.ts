/**
 * Regression test for #2484: "Multiple daemon instances spawned per Claude
 * Code session."
 *
 * Original report: 4 identical `daemon start --foreground --quiet` processes
 * per Claude Code session, accumulating to ~1.7 GB swap on a 16 GB machine
 * with 4 concurrent sessions.
 *
 * Root cause: the `daemon start` launcher held a lockfile during the
 * "is a daemon already running?" check (good) but RELEASED it BEFORE calling
 * startBackgroundDaemon (which forks the actual background process and only
 * then writes the PID file). Concurrent callers could land in the window
 * between lock-release and PID-file-write, see neither lock nor PID, and
 * each proceed to spawn their own background daemon.
 *
 * Fix (this PR): hold the lockfile through the entire spawn lifecycle.
 * The lock is now released INSIDE the finally block of the
 * `if (!foreground) { return await startBackgroundDaemon(...) }` path,
 * so the lock-loser ALWAYS sees either an active lock OR a populated PID
 * file — never the empty window.
 *
 * This test is a STATIC contract check on the source: the lock release
 * patterns must NOT appear between the `if (!isDaemonProcess) { ... }`
 * block and the `if (!foreground) {` branch. It does NOT spawn real
 * daemons (those tests are flaky in CI); it asserts the structural
 * property that closes the race window.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DAEMON_SRC = join(
  __dirname,
  '..',
  'src',
  'commands',
  'daemon.ts',
);

describe('#2484 — daemon lockfile race window is closed', () => {
  const src = readFileSync(DAEMON_SRC, 'utf-8');

  it('the lock is released INSIDE the !foreground branch, not before it', () => {
    // The fix marker — finally block inside the background-spawn path.
    expect(src).toMatch(/if \(!foreground\) \{[\s\S]+?try \{[\s\S]+?startBackgroundDaemon[\s\S]+?\} finally \{[\s\S]+?fs\.closeSync\(lockFd\)/);
  });

  it('lockFd is declared in the outer function scope, not block-scoped', () => {
    // Must be visible to the !foreground branch — block-scoping was the bug.
    expect(src).toMatch(/let lockFd: number \| null = null;[\s\S]+?if \(!isDaemonProcess\)/);
  });

  it('the foreground branch also releases the lock before blocking', () => {
    // The foreground path runs forever, so we MUST release the lock first
    // — otherwise a concurrent `daemon start` would wait 5s before
    // recovering via the stale-lockfile fallback.
    expect(src).toMatch(/\/\/ Foreground path: release the lock[\s\S]+?fs\.closeSync\(lockFd\)/);
  });

  it('the early-return path (daemon already running) also releases the lock', () => {
    // dedup-check finds a running daemon → return early → must still
    // release the lock so the NEXT invocation doesn't wait 5s on the stale
    // lockfile fallback.
    expect(src).toMatch(/printWarning\(`Daemon already running[\s\S]{0,400}?fs\.closeSync\(lockFd\)/);
  });

  it('the issue is documented in a code comment so a future refactor cannot un-fix it', () => {
    expect(src).toMatch(/#2484/);
    expect(src).toMatch(/EDortta/);
  });

  it('does NOT contain the old race pattern (lock release inside the original finally)', () => {
    // The original code had a `finally` block IMMEDIATELY after the dedup
    // check that released the lock unconditionally. If that pattern
    // reappears, the race is back. Asserts the OLD lock-release block is
    // not within 60 lines of the lockFd declaration.
    const lockFdLine = src.split('\n').findIndex((l) => l.includes('let lockFd: number | null = null'));
    expect(lockFdLine).toBeGreaterThan(-1);
    const window = src.split('\n').slice(lockFdLine, lockFdLine + 60).join('\n');
    // The dedup block should NOT have a finally that closes lockFd.
    // (The legitimate close-on-early-return is in the IF branch above, not a finally.)
    const finallyCloseCount = (window.match(/\} finally \{[\s\S]+?fs\.closeSync\(lockFd\)/g) || []).length;
    expect(finallyCloseCount).toBe(0);
  });
});
