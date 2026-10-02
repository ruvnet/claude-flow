/**
 * Headless process helpers shared by the dual-mode orchestrator and the
 * CLI team runner (`ruflo team run`).
 *
 * Both run one non-interactive agent turn (`codex exec`, `claude -p`, or a
 * custom command host) as a child process with bounded output, a timeout,
 * and a stripped environment. Neither uses a shell.
 */

import { spawn, spawnSync, ChildProcess } from 'child_process';
import { isProtectedEnvName } from './env-policy.js';

export { isProtectedEnvName } from './env-policy.js';

export interface HeadlessProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Written to stdin before it is closed. stdin is always closed (#2947). */
  stdinText?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Time between SIGTERM and SIGKILL when the process tree is stopped. Default 5000 ms. */
  killGraceMs?: number;
  /** Aborting stops the process tree the same way a timeout does. */
  signal?: AbortSignal;
  /** Called once the child is spawned, so callers can track or kill it. */
  onSpawn?: (proc: ChildProcess) => void;
}

export interface HeadlessProcessResult {
  /** Exit code, or null when the process was killed by a signal or timed out. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when the run was stopped through `signal`. */
  aborted?: boolean;
  /** True when output went over maxOutputBytes and the middle was dropped. */
  truncated?: boolean;
  ms: number;
}

const DEFAULT_KILL_GRACE_MS = 5000;
/** Bytes kept from the start of a truncated stream (Codex puts thread.started first). */
const HEAD_KEEP_BYTES = 16 * 1024;

/**
 * Bounded capture that keeps the head and the tail of a stream. The tail is
 * what matters for agent CLIs (the terminal event and the final message come
 * last); the head keeps the first events. Bytes are decoded once at the end,
 * so a multi-byte UTF-8 character split across chunks survives.
 */
class BoundedCapture {
  private head: Buffer[] = [];
  private headBytes = 0;
  private tail: Buffer[] = [];
  private tailBytes = 0;
  private dropped = 0;
  private readonly headMax: number;
  private readonly tailMax: number;

  constructor(maxBytes: number) {
    this.headMax = Math.min(HEAD_KEEP_BYTES, Math.floor(maxBytes / 4));
    this.tailMax = Math.max(0, maxBytes - this.headMax);
  }

  push(chunk: Buffer): void {
    let buf = chunk;
    if (this.headBytes < this.headMax) {
      const take = buf.subarray(0, this.headMax - this.headBytes);
      this.head.push(take);
      this.headBytes += take.length;
      buf = buf.subarray(take.length);
    }
    if (!buf.length) return;
    this.tail.push(buf);
    this.tailBytes += buf.length;
    // Compact once the tail holds twice its budget, so pushes stay O(1) amortized.
    if (this.tailBytes > this.tailMax * 2) this.compact();
  }

  private compact(): void {
    const all = Buffer.concat(this.tail);
    const keep = all.subarray(Math.max(0, all.length - this.tailMax));
    this.dropped += all.length - keep.length;
    this.tail = [keep];
    this.tailBytes = keep.length;
  }

  get truncated(): boolean {
    return this.dropped > 0 || this.tailBytes > this.tailMax;
  }

  toString(): string {
    this.compact();
    const head = Buffer.concat(this.head);
    let tail = Buffer.concat(this.tail);
    if (!this.dropped) return Buffer.concat([head, tail]).toString('utf8');
    // Drop UTF-8 continuation bytes at the cut so the tail starts on a character.
    let i = 0;
    while (i < tail.length && i < 4 && ((tail[i] ?? 0) & 0xc0) === 0x80) i += 1;
    tail = tail.subarray(i);
    return `${head.toString('utf8')}\n…(${this.dropped + i} bytes of output dropped)…\n${tail.toString('utf8')}`;
  }
}

/**
 * Stop a child and everything it started. On POSIX the child leads its own
 * process group (see runHeadlessProcess), so the whole group is signalled.
 * On Windows `taskkill /T /F` ends the tree.
 */
/** True when a POSIX process group still has a member. ESRCH means it is gone. */
function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export function killProcessTree(proc: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  const pid = proc.pid;
  if (pid === undefined) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // Not a group leader (spawned by someone else) or already gone.
    try {
      proc.kill(signal);
    } catch {
      /* already exited */
    }
  }
}

/**
 * Spawn a command, feed it optional stdin, close stdin, and collect bounded
 * output. Resolves with the exit code instead of rejecting on a non-zero
 * exit. Rejects only when the process cannot be spawned.
 *
 * The child runs in its own process group (POSIX), so a timeout or an abort
 * stops everything it started: SIGTERM to the group, then SIGKILL after
 * `killGraceMs`. The promise resolves only after that group is gone (or the
 * SIGKILL has been sent and a short follow-up wait has elapsed). Resolving
 * on the leader's `close` is not enough: a descendant that traps SIGTERM and
 * detaches its stdio stays in the group, and a caller that then
 * `process.exit`s would cancel a SIGKILL timer that had not fired yet
 * (#3513 round-3 review).
 */
export function runHeadlessProcess(opts: HeadlessProcessOptions): Promise<HeadlessProcessResult> {
  const { command, args, cwd, env, stdinText, timeoutMs, maxOutputBytes } = opts;
  const grace = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const out = new BoundedCapture(maxOutputBytes);
    const err = new BoundedCapture(maxOutputBytes);
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let exited = false;
    let exitCode: number | null = null;
    let stopping = false;
    const timers: NodeJS.Timeout[] = [];

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const finish = () => settle(() => resolve({
      code: timedOut || aborted ? null : exitCode,
      stdout: out.toString(),
      stderr: err.toString(),
      timedOut,
      ...(aborted ? { aborted } : {}),
      ...(out.truncated || err.truncated ? { truncated: true } : {}),
      ms: Date.now() - started,
    }));

    // POSIX: `detached` makes the child a process-group leader so the group
    // can be killed. Windows: detached would open a console; taskkill /T is used instead.
    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    const stopTree = () => {
      if (stopping) return;
      // Windows taskkill /T /F ends the tree immediately; `close` finishes.
      if (process.platform === 'win32' || proc.pid === undefined) {
        if (!(exited && process.platform === 'win32')) killProcessTree(proc, 'SIGTERM');
        return;
      }
      stopping = true;
      const pid = proc.pid;
      killProcessTree(proc, 'SIGTERM');
      // Do not resolve while the group is still alive. The leader's `close`
      // can fire as soon as it exits, before a descendant that trapped
      // SIGTERM is dead. A timer that outlives this promise is cancelled
      // when the CLI calls process.exit on the result (#3513 round-3).
      const deadline = Date.now() + grace;
      const tick = () => {
        if (settled) return;
        if (!groupAlive(pid)) {
          finish();
          return;
        }
        if (Date.now() >= deadline) {
          killProcessTree(proc, 'SIGKILL');
          const killDeadline = Date.now() + 500;
          const afterKill = () => {
            if (settled) return;
            if (!groupAlive(pid) || Date.now() >= killDeadline) finish();
            else setTimeout(afterKill, 20);
          };
          setTimeout(afterKill, 20);
          return;
        }
        setTimeout(tick, 20);
      };
      setTimeout(tick, 20);
    };
    function onAbort() {
      if (settled || timedOut || aborted) return;
      aborted = true;
      stopTree();
    }

    // #2947: `codex exec` blocks until stdin reaches EOF, so the pipe is
    // always closed, after the prompt when one is sent this way.
    proc.stdin?.on('error', () => { /* child exited before reading stdin */ });
    if (stdinText !== undefined) proc.stdin?.write(stdinText);
    proc.stdin?.end();

    opts.onSpawn?.(proc);

    proc.stdout?.on('data', (data: Buffer) => out.push(data));
    proc.stderr?.on('data', (data: Buffer) => err.push(data));

    timers.push(setTimeout(() => {
      if (aborted) return;
      timedOut = true;
      stopTree();
    }, timeoutMs));
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort);

    proc.on('exit', (code) => {
      exited = true;
      exitCode = code;
    });
    proc.on('close', (code) => {
      exited = true;
      if (exitCode === null) exitCode = code;
      if (!stopping) finish();
    });
    proc.on('error', (e) => {
      settle(() => reject(e));
    });
  });
}

export interface WorkerEnvironmentOptions {
  principalId: string;
  dbPath?: string;
  /** Serialized into CLAUDE_FLOW_CAPABILITY_ENVELOPE when given. */
  envelope?: unknown;
  /** Names copied back from `base` after the sensitive-name strip. */
  passEnv?: string[];
}

/**
 * Build a child environment from `base`: drop secrets and policy/identity
 * variables (via the shared `isProtectedEnvName` policy — #3513 MAJOR A),
 * then set the worker's principal, database path and envelope. Names in
 * `passEnv` (for example a host's own auth key) are re-added from `base`
 * after the strip — callers that hand this an untrusted `passEnv` (a custom
 * command host's declared list) must filter it through `isProtectedEnvName`
 * themselves first, the same way `team-runner.ts` does; this function trusts
 * whatever `passEnv` it is given. Token minting is left to the caller.
 */
export function buildWorkerEnvironment(
  base: NodeJS.ProcessEnv,
  opts: WorkerEnvironmentOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (isProtectedEnvName(name)) continue;
    env[name] = value;
  }
  env.FORCE_COLOR = '0';
  if (opts.dbPath !== undefined) env.CLAUDE_FLOW_DB_PATH = opts.dbPath;
  env.CLAUDE_FLOW_PRINCIPAL_ID = opts.principalId;
  if (opts.envelope !== undefined) {
    env.CLAUDE_FLOW_CAPABILITY_ENVELOPE = JSON.stringify(opts.envelope);
  }
  for (const name of opts.passEnv ?? []) {
    if (base[name] !== undefined) env[name] = base[name];
  }
  return env;
}
