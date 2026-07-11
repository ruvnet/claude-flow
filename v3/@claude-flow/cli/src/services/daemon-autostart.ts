/**
 * Self-running daemon (auto-start).
 *
 * The self-optimizing loop's workers (distillation, backup, and the future
 * evolve worker) are inert unless the daemon runs — but it required a manual
 * `ruflo daemon start`. This ensures a daemon is running on CLI use, SAFELY:
 *
 *   - single-instance: only starts when no live daemon holds the pidfile, and
 *     the spawned `daemon start` independently enforces single-instance via its
 *     own lock + checkExistingDaemon() — so a race spawns at most one survivor,
 *   - bounded lifetime: the daemon self-terminates on TTL/idle (12h default,
 *     RUFLO_DAEMON_TTL_SECS) — auto-start never means "runs forever",
 *   - opt-out: RUFLO_DAEMON_AUTOSTART=0|false|no disables it entirely, OR a
 *     project-local `daemon.autostart: false` in claude-flow.config.json —
 *     the file-based opt-out exists because the env var only reaches a
 *     process that inherited it. A non-interactive shell (cron, CI, many
 *     tool-invoked shells — bash skips ~/.bashrc entirely for these; see
 *     its own `case $- in *i*) ;; *) return;; esac` guard) never re-sources
 *     a shell rc file per invocation, so `export RUFLO_DAEMON_AUTOSTART=0`
 *     in one such shell does NOT persist to the next one. A project config
 *     field has no such gap — it's read fresh from disk every time,
 *     independent of which shell (or whether any shell at all) launched
 *     the command,
 *   - cheap: a pidfile read + a signal-0 liveness check on the fast path,
 *   - best-effort + silent: never blocks or fails a command.
 *
 * Reuses `daemon start` verbatim (all its lock/TTL/worker machinery) — this
 * module only decides WHETHER to spawn, never reimplements the daemon.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

/** True if a live daemon already holds the project's pidfile. */
export function isDaemonAlive(projectRoot: string): boolean {
  const pidFile = path.join(projectRoot, '.claude-flow', 'daemon.pid');
  try {
    if (!fs.existsSync(pidFile)) return false;
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    if (Number.isNaN(pid) || pid === process.pid) return false;
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    // Dead process → stale pidfile. Clean it so `daemon start` proceeds cleanly.
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
    return false;
  }
}

/** Project-local opt-out: `{ "daemon": { "autostart": false } }` in claude-flow.config.json. */
function autostartDisabledByProjectConfig(projectRoot: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, 'claude-flow.config.json'), 'utf-8');
    const cfg = JSON.parse(raw);
    return cfg?.daemon?.autostart === false;
  } catch {
    return false; // absent/malformed config = not disabled
  }
}

function autostartDisabled(projectRoot: string): boolean {
  if (/^(0|false|no|off)$/i.test(process.env.RUFLO_DAEMON_AUTOSTART ?? '')) return true;
  return autostartDisabledByProjectConfig(projectRoot);
}

export interface EnsureResult { started: boolean; reason?: string }

/** Spawn `daemon start` detached, reusing all its lock/TTL machinery. Injectable for tests. */
export type SpawnDaemonFn = (projectRoot: string) => void;

const defaultSpawn: SpawnDaemonFn = (projectRoot) => {
  const cliBin = process.argv[1]; // the running bin/cli.js
  const child = spawn(process.execPath, [cliBin, 'daemon', 'start', '--quiet'], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
};

/**
 * Ensure a daemon is running for `projectRoot`. No-op when disabled or when one
 * is already alive. Best-effort; never throws.
 */
export function ensureDaemonRunning(
  projectRoot: string,
  opts: { spawnFn?: SpawnDaemonFn; isAlive?: (root: string) => boolean } = {},
): EnsureResult {
  try {
    if (autostartDisabled(projectRoot)) return { started: false, reason: 'disabled (RUFLO_DAEMON_AUTOSTART=0 or project config)' };
    // Only in an initialized project (avoid scaffolding a daemon in a random dir).
    if (!fs.existsSync(path.join(projectRoot, '.claude-flow')) && !fs.existsSync(path.join(projectRoot, '.claude'))) {
      return { started: false, reason: 'not a ruflo project' };
    }
    const alive = (opts.isAlive ?? isDaemonAlive)(projectRoot);
    if (alive) return { started: false, reason: 'already running' };
    (opts.spawnFn ?? defaultSpawn)(projectRoot);
    return { started: true };
  } catch (e) {
    return { started: false, reason: `error: ${(e as Error)?.message ?? e}` };
  }
}
