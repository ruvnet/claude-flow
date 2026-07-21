/**
 * meta-proxy process lifecycle (ADR-307) — start/stop/status/logs.
 *
 * Adapts daemon.ts's proven pattern (PID file, O_EXCL lockfile for atomic
 * check-then-start, signal-0 liveness, SIGTERM->1000ms->SIGKILL) to a
 * native binary instead of a forked Node process. The binary itself takes
 * no CLI flags — confirmed empirically (2026-07-16): `meta-proxy.exe` has
 * no `--version`/`--help`, and any invocation just starts the server reading
 * its own config file — so `spawn()` here passes zero arguments, always.
 *
 * Foreground `start` (the ADR-307 default) uses `stdio: 'inherit'` and
 * blocks directly — simplest and safest, no log-file redirection needed.
 * `start --service` needs REAL file-descriptor redirection
 * (`stdio: ['ignore', fd, fd]`) + `detached: true` + `unref()` via
 * `child_process.spawn()` directly — `SafeExecutor.executeStreaming()`
 * buffers output in-process, which is wrong for a process meant to outlive
 * the `ruflo` invocation that started it.
 *
 * @module proxy/lifecycle
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { proxyBinaryPath, proxyPidFilePath, proxyLockFilePath, proxyLogFilePath } from './paths.js';

export class ProxyNotInstalledError extends Error {
  constructor() {
    super('meta-proxy is not installed. Run: ruflo proxy install');
    this.name = 'ProxyNotInstalledError';
  }
}

export class ProxyAlreadyRunningError extends Error {
  constructor(public readonly pid: number) {
    super(`meta-proxy is already running (pid ${pid}). Stop it first with: ruflo proxy stop`);
    this.name = 'ProxyAlreadyRunningError';
  }
}

function requireBinary(): string {
  const bin = proxyBinaryPath();
  if (!fs.existsSync(bin)) throw new ProxyNotInstalledError();
  return bin;
}

/** Signal-0 liveness probe — cross-platform in Node, throws if the process is dead. */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface ProxyStatus {
  installed: boolean;
  running: boolean;
  pid: number | null;
  stalePidFile: boolean;
}

export function getProxyStatus(): ProxyStatus {
  const installed = fs.existsSync(proxyBinaryPath());
  const pidPath = proxyPidFilePath();
  if (!fs.existsSync(pidPath)) {
    return { installed, running: false, pid: null, stalePidFile: false };
  }
  const raw = fs.readFileSync(pidPath, 'utf-8').trim();
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid)) {
    return { installed, running: false, pid: null, stalePidFile: true };
  }
  const running = isProcessRunning(pid);
  return { installed, running, pid: running ? pid : null, stalePidFile: !running };
}

function writePidFile(pid: number): void {
  fs.writeFileSync(proxyPidFilePath(), String(pid), 'utf-8');
}

function clearStalePidFile(): void {
  try {
    fs.unlinkSync(proxyPidFilePath());
  } catch {
    // already absent
  }
}

/**
 * Atomic check-then-start via an O_EXCL lockfile — the same fix daemon.ts
 * applies for the identical race (#2407/#2484: without this, N concurrent
 * `start` calls all see "not running" and all spawn their own process).
 * Returns the lock fd to release once the PID file has been written (or on
 * any early-return/throw), never before.
 */
function acquireStartLock(): number | null {
  const lockFile = proxyLockFilePath();
  try {
    return fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return null; // another start is mid-spawn
    throw e;
  }
}

function releaseStartLock(fd: number | null): void {
  if (fd === null) return;
  try {
    fs.closeSync(fd);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(proxyLockFilePath());
  } catch {
    /* ignore */
  }
}

/**
 * Foreground start (ADR-307 default) — blocks the caller until the process
 * exits or is interrupted. `stdio: 'inherit'` passes the proxy's own output
 * straight through to the terminal; signals (Ctrl+C) propagate naturally to
 * the child, no manual forwarding needed.
 */
export async function startForeground(supervised = false): Promise<never> {
  const bin = requireBinary();
  const status = getProxyStatus();
  // In service mode startBackground has already written this supervisor's
  // PID. Treating it as a competing proxy makes the supervisor immediately
  // exit before it can spawn meta-proxy.
  if (!supervised && status.running && status.pid) throw new ProxyAlreadyRunningError(status.pid);
  if (status.stalePidFile) clearStalePidFile();

  const child = spawn(bin, [], { stdio: 'inherit', windowsHide: false });
  if (!supervised && child.pid) writePidFile(child.pid);

  const cleanup = () => clearStalePidFile();
  process.on('exit', cleanup);
  if (supervised) {
    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) child.kill(signal);
    };
    process.once('SIGTERM', () => forwardSignal('SIGTERM'));
    process.once('SIGINT', () => forwardSignal('SIGINT'));
  }

  await new Promise<void>((resolve) => {
    child.on('exit', () => {
      cleanup();
      resolve();
    });
  });
  process.exit(0);
}

/**
 * Background/`--service` start — detaches so the process outlives this
 * `ruflo` invocation, redirecting stdout/stderr to a real log file (not
 * buffered in-process). Returns once the child's PID is confirmed written,
 * without waiting for the process to exit.
 */
export async function startBackground(): Promise<{ pid: number }> {
  requireBinary();
  const status = getProxyStatus();
  if (status.running && status.pid) throw new ProxyAlreadyRunningError(status.pid);

  const lockFd = acquireStartLock();
  try {
    // Re-check under the lock — the dedup above raced a concurrent starter.
    const rechecked = getProxyStatus();
    if (rechecked.running && rechecked.pid) throw new ProxyAlreadyRunningError(rechecked.pid);
    if (rechecked.stalePidFile) clearStalePidFile();

    const logFd = fs.openSync(proxyLogFilePath(), 'a');
    const cliEntry = process.argv[1];
    if (!cliEntry) throw new Error('cannot locate the ruflo CLI entrypoint for supervised service mode');
    const child = spawn(process.execPath, [cliEntry, 'proxy', 'supervise'], {
      stdio: ['ignore', logFd, logFd],
      detached: true,
      windowsHide: true,
    });
    fs.closeSync(logFd); // the child holds its own duplicated fd; safe to close ours

    if (!child.pid) throw new Error('ruflo proxy supervisor failed to spawn — no PID returned');
    writePidFile(child.pid);
    child.unref();
    return { pid: child.pid };
  } finally {
    releaseStartLock(lockFd);
  }
}

export interface StopResult {
  wasRunning: boolean;
  pid: number | null;
}

/** SIGTERM -> 1000ms -> SIGKILL if still alive, mirroring daemon.ts's killBackgroundDaemon. */
export async function stopProxy(): Promise<StopResult> {
  const status = getProxyStatus();
  if (!status.running || !status.pid) {
    if (status.stalePidFile) clearStalePidFile();
    return { wasRunning: false, pid: null };
  }

  const pid = status.pid;
  process.kill(pid, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  if (isProcessRunning(pid)) {
    process.kill(pid, 'SIGKILL');
  }
  clearStalePidFile();
  return { wasRunning: true, pid };
}

const TAIL_BYTES = 64 * 1024; // bounded read — a long-running proxy's log grows over weeks

export function readProxyLogTail(maxBytes: number = TAIL_BYTES): string {
  const logPath = proxyLogFilePath();
  if (!fs.existsSync(logPath)) return '';
  const { size } = fs.statSync(logPath);
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(logPath, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/** Streams new log lines as they're appended, starting from the current end of file. */
export function watchProxyLog(onLine: (line: string) => void): fs.FSWatcher {
  const logPath = proxyLogFilePath();
  if (!fs.existsSync(logPath)) {
    throw new Error('no log file yet — meta-proxy has never been started in --service mode');
  }
  let offset = fs.statSync(logPath).size;
  return fs.watch(logPath, () => {
    const { size } = fs.statSync(logPath);
    if (size <= offset) return;
    const fd = fs.openSync(logPath, 'r');
    try {
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      for (const line of buf.toString('utf-8').split('\n')) {
        if (line.length > 0) onLine(line);
      }
    } finally {
      fs.closeSync(fd);
    }
  });
}
