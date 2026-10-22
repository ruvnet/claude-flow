import { mkdirSync, realpathSync, rmdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Serialize cooperating local writers without stealing a paused writer's lock.
 * Abnormal termination can leave an orphan: recovery requires confirming that
 * no writer still owns the directory before removing it. Never age-reap it.
 */
export function withStatsFileLock<T>(file: string, write: (canonicalFile: string) => T): T {
  const canonicalFile = join(realpathSync(dirname(file)), basename(file));
  const lock = `${canonicalFile}.lock`;
  const deadline = performance.now() + 1000;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw Object.assign(new Error('Learning stats lock is busy'), { code: 'ELOCKED', path: lock });
      }
      Atomics.wait(sleeper, 0, 0, Math.min(10, remaining));
    }
  }
  const cleanup = () => {
    // Only remove our empty directory. Never recursively remove foreign data.
    rmdirSync(lock);
  };
  const onExit = () => {
    try { cleanup(); } catch { /* abnormal exits may require deliberate recovery */ }
  };
  process.once('exit', onExit);
  try {
    return write(canonicalFile);
  } finally {
    process.removeListener('exit', onExit);
    try {
      cleanup();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code || 'UNKNOWN';
      console.warn(`[intelligence] Could not release learning stats lock at ${lock} (${code}); verify ownership before recovery`);
    }
  }
}
