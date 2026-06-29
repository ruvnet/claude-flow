/**
 * V3 CLI Daemon Command
 * Manages background worker daemon (Node.js-based, similar to shell helpers)
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { WorkerDaemon, getDaemon, startDaemon, stopDaemon, type WorkerType, type DaemonConfig } from '../services/worker-daemon.js';
import { spawn, execFile, fork } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';
import * as fs from 'fs';

// Start daemon subcommand
const startCommand: Command = {
  name: 'start',
  description: 'Start the worker daemon with all enabled background workers',
  options: [
    { name: 'workers', short: 'w', type: 'string', description: 'Comma-separated list of workers to enable (default: map,audit,optimize,consolidate,testgaps)' },
    { name: 'quiet', short: 'Q', type: 'boolean', description: 'Suppress output' },
    { name: 'background', short: 'b', type: 'boolean', description: 'Run daemon in background (detached process)', default: true },
    { name: 'foreground', short: 'f', type: 'boolean', description: 'Run daemon in foreground (blocks terminal)' },
    { name: 'headless', type: 'boolean', description: 'Enable headless worker execution (E2B sandbox)' },
    { name: 'sandbox', type: 'string', description: 'Default sandbox mode for headless workers', choices: ['strict', 'permissive', 'disabled'] },
    { name: 'max-cpu-load', type: 'string', description: 'Override maxCpuLoad resource threshold (e.g. 4.0)' },
    { name: 'min-free-memory', type: 'string', description: 'Override minFreeMemoryPercent resource threshold (e.g. 15)' },
    // #2356: self-terminating lifecycle. Caps how long a forgotten daemon can
    // keep dispatching headless worker sweeps. Default 12h (or RUFLO_DAEMON_TTL_SECS); 0 = run until stopped.
    { name: 'ttl', type: 'string', description: 'Max daemon age in seconds before graceful self-shutdown (0 = run until stopped; default 43200 = 12h)' },
    // #1914: workspace root for this daemon. Set automatically when the
    // background launcher forks the foreground child so the daemon process
    // carries its workspace path in argv — `killStaleDaemons` then only
    // reaps daemons belonging to the current workspace (ADR-014 scope).
    { name: 'workspace', type: 'string', description: 'Workspace root for this daemon (internal — set automatically when forking)' },
  ],
  examples: [
    { command: 'claude-flow daemon start', description: 'Start daemon in background (default)' },
    { command: 'claude-flow daemon start --foreground', description: 'Start in foreground (blocks terminal)' },
    { command: 'claude-flow daemon start -w map,audit,optimize', description: 'Start with specific workers' },
    { command: 'claude-flow daemon start --headless --sandbox strict', description: 'Start with headless workers in strict sandbox' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const quiet = ctx.flags.quiet as boolean;
    const foreground = ctx.flags.foreground as boolean;
    // #1914: a forked daemon child receives --workspace <root>; the launcher
    // and interactive invocations have no flag and fall back to cwd.
    const projectRoot = resolveWorkspaceFlag(ctx.flags.workspace) ?? process.cwd();
    const isDaemonProcess = process.env.CLAUDE_FLOW_DAEMON === '1';

    // Parse resource threshold overrides from CLI flags
    const config: Partial<DaemonConfig> = {};
    const rawMaxCpu = ctx.flags['max-cpu-load'] as string | undefined;
    const rawMinMem = ctx.flags['min-free-memory'] as string | undefined;

    // Strict numeric pattern to prevent command injection when forwarding to subprocess (S1)
    const NUMERIC_RE = /^\d+(\.\d+)?$/;
    const sanitize = (s: string) => s.replace(/[\x00-\x1f\x7f-\x9f]/g, '');

    if (rawMaxCpu || rawMinMem) {
      const thresholds: { maxCpuLoad?: number; minFreeMemoryPercent?: number } = {};
      if (rawMaxCpu) {
        const val = parseFloat(rawMaxCpu);
        if (NUMERIC_RE.test(rawMaxCpu) && isFinite(val) && val > 0 && val <= 1000) {
          thresholds.maxCpuLoad = val;
        } else if (!quiet) {
          output.printWarning(`Ignoring invalid --max-cpu-load value: ${sanitize(rawMaxCpu)}`);
        }
      }
      if (rawMinMem) {
        const val = parseFloat(rawMinMem);
        if (NUMERIC_RE.test(rawMinMem) && isFinite(val) && val >= 0 && val <= 100) {
          thresholds.minFreeMemoryPercent = val;
        } else if (!quiet) {
          output.printWarning(`Ignoring invalid --min-free-memory value: ${sanitize(rawMinMem)}`);
        }
      }
      if (thresholds.maxCpuLoad !== undefined || thresholds.minFreeMemoryPercent !== undefined) {
        config.resourceThresholds = thresholds as DaemonConfig['resourceThresholds'];
      }
    }

    // #2356: parse --ttl (seconds → ms). Integer-only so 0 (disable) is valid;
    // INT_RE forbids the decimals NUMERIC_RE allows, since a TTL is whole seconds.
    const rawTtl = ctx.flags.ttl as string | undefined;
    const INT_RE = /^\d+$/;
    if (rawTtl !== undefined) {
      if (INT_RE.test(rawTtl)) {
        config.ttlMs = parseInt(rawTtl, 10) * 1000;
      } else if (!quiet) {
        output.printWarning(`Ignoring invalid --ttl value: ${sanitize(rawTtl)}`);
      }
    }

    // Check if background daemon already running (skip if we ARE the daemon process)
    //
    // #2407 — without an atomic lockfile, N concurrent `daemon start` calls
    // (devcontainer setup + VS Code task + MCP hook within ~500 ms) all see
    // an empty PID file in the same instant, all proceed past this dedup,
    // and all fork their own background daemon. One incident accumulated
    // 39 zombie daemons holding ~8.5 GiB → kernel panic.
    //
    // Wrap the check + the subsequent fork in an O_EXCL lockfile so the
    // dedup is process-atomic. Lock holder gets to spawn; competing callers
    // see EEXIST, wait briefly, then re-read the PID file (which the holder
    // has now written), and return "already running" cleanly.
    // #2484 — previously the lockfile was released BEFORE startBackgroundDaemon
    // ran, opening a race window where a concurrent caller could see no lock
    // AND no PID file (PID hadn't been written yet) and proceed to fork ITS
    // OWN background daemon. EDortta reported 4 identical daemons per Claude
    // Code session on v3.10.37 under exactly this pattern (MCP startup
    // racing with a sibling invocation).
    //
    // Fix: hold the lock across the entire spawn lifecycle (dedup check →
    // killStaleDaemons → fork → PID file write), so the lock-loser ALWAYS
    // sees either a live lock or a populated PID file, never the empty
    // window in between.
    let lockFd: number | null = null;
    let lockFile = '';
    if (!isDaemonProcess) {
      const stateDir = join(resolve(projectRoot), '.claude-flow');
      lockFile = join(stateDir, 'daemon.lock');
      try { fs.mkdirSync(stateDir, { recursive: true }); } catch { /* exists */ }
      try {
        lockFd = fs.openSync(lockFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
        fs.writeSync(lockFd, String(process.pid));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
          // Another `daemon start` is mid-spawn. Wait up to 5s for it to
          // finish, then re-check the PID file. If the holder crashed
          // mid-spawn, fall through and reset; killStaleDaemons + a fresh
          // attempt will recover.
          const deadline = Date.now() + 5000;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
            const winnerPid = getBackgroundDaemonPid(projectRoot);
            if (winnerPid && isProcessRunning(winnerPid)) {
              if (!quiet) {
                output.printWarning(`Daemon already running in background (PID: ${winnerPid}). Stop it first with: daemon stop`);
              }
              return { success: true };
            }
          }
          // Stale lockfile from a crashed prior attempt — clear it and
          // proceed without a held lock. Worst case we double-spawn ONCE
          // and the killStaleDaemons sweep below cleans up.
          try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
        } else {
          throw e;
        }
      }
      // Dedup check while holding the lock.
      try {
        const bgPid = getBackgroundDaemonPid(projectRoot);
        if (bgPid && isProcessRunning(bgPid)) {
          if (!quiet) {
            output.printWarning(`Daemon already running in background (PID: ${bgPid}). Stop it first with: daemon stop`);
          }
          // Release the lock on the early-return path.
          if (lockFd !== null) {
            try { fs.closeSync(lockFd); } catch { /* ignore */ }
            try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
          }
          return { success: true };
        }
        // #1551: Kill any stale daemon processes that weren't tracked by PID file
        await killStaleDaemons(projectRoot, quiet);
      } catch (e) {
        // Anything that throws here MUST still release the lock before
        // rethrowing so we don't leave the lockfile behind for future
        // invocations to wait on for 5s before recovering.
        if (lockFd !== null) {
          try { fs.closeSync(lockFd); } catch { /* ignore */ }
          try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
          lockFd = null;
        }
        throw e;
      }
    }

    // Background mode (default): fork a detached process. The lock (if held)
    // is released AFTER startBackgroundDaemon's PID file write completes —
    // see the cleanup inside startBackgroundDaemon's caller path below.
    // #1968: previously only forwarded resource thresholds — `--workers`,
    // `--headless`, and `--sandbox` were dropped on the floor when the
    // launcher forked the foreground child, so `daemon start --workers map`
    // got the full default worker set instead.
    if (!foreground) {
      try {
        return await startBackgroundDaemon(projectRoot, quiet, {
          maxCpuLoad: rawMaxCpu,
          minFreeMemory: rawMinMem,
          workers: ctx.flags.workers as string | undefined,
          headless: ctx.flags.headless as boolean | undefined,
          sandbox: ctx.flags.sandbox as string | undefined,
          ttl: rawTtl,
        });
      } finally {
        // Release the lock NOW — startBackgroundDaemon has either written
        // the PID file (success path) or thrown (in which case the next
        // caller's killStaleDaemons sweep handles the orphan).
        if (lockFd !== null) {
          try { fs.closeSync(lockFd); } catch { /* ignore */ }
          try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
        }
      }
    }

    // Foreground path: release the lock before we start the (potentially
    // long-running) foreground daemon so other callers can dedup against
    // our PID file (foreground writes its own PID).
    if (lockFd !== null) {
      try { fs.closeSync(lockFd); } catch { /* ignore */ }
      try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
      lockFd = null;
    }

    // Foreground mode: run in current process (blocks terminal)
    try {
      const stateDir = join(projectRoot, '.claude-flow');
      const pidFile = join(stateDir, 'daemon.pid');

      // Ensure state directory exists
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      // NOTE: Do NOT write PID file here — startDaemon() writes it internally.
      // Writing it before startDaemon() causes checkExistingDaemon() to detect
      // our own PID and return early, leaving no workers scheduled (#1478 Bug 1).

      // Clean up PID file on exit
      const cleanup = () => {
        try {
          if (fs.existsSync(pidFile)) {
            fs.unlinkSync(pidFile);
          }
        } catch { /* ignore */ }
      };
      process.on('exit', cleanup);
      process.on('SIGINT', () => { cleanup(); process.exit(0); });
      process.on('SIGTERM', () => { cleanup(); process.exit(0); });
      // Ignore SIGHUP on macOS/Linux — prevents daemon death when terminal closes (#1283)
      if (process.platform !== 'win32') {
        process.on('SIGHUP', () => { /* ignore — keep running */ });
      }

      if (!quiet) {
        const spinner = output.createSpinner({ text: 'Starting worker daemon...', spinner: 'dots' });
        spinner.start();

        const daemon = await startDaemon(projectRoot, config);
        const status = daemon.getStatus();

        spinner.succeed('Worker daemon started (foreground mode)');

        output.writeln();
        output.printBox(
          [
            `PID: ${status.pid}`,
            `Started: ${status.startedAt?.toISOString()}`,
            status.config.ttlMs > 0
              ? `TTL: ${Math.round(status.config.ttlMs / 3600000)}h (self-shutdown)`
              : `TTL: off (runs until stopped)`,
            `Workers: ${status.config.workers.filter(w => w.enabled).length} enabled`,
            `Max Concurrent: ${status.config.maxConcurrent}`,
            `Max CPU Load: ${status.config.resourceThresholds.maxCpuLoad}`,
            `Min Free Memory: ${status.config.resourceThresholds.minFreeMemoryPercent}%`,
          ].join('\n'),
          'Daemon Status'
        );

        output.writeln();
        output.writeln(output.bold('Scheduled Workers'));
        output.printTable({
          columns: [
            { key: 'type', header: 'Worker', width: 15 },
            { key: 'interval', header: 'Interval', width: 12 },
            { key: 'priority', header: 'Priority', width: 10 },
            { key: 'description', header: 'Description', width: 30 },
          ],
          data: status.config.workers
            .filter(w => w.enabled)
            .map(w => ({
              type: output.highlight(w.type),
              interval: `${Math.round(w.intervalMs / 60000)}min`,
              priority: w.priority === 'critical' ? output.error(w.priority) :
                       w.priority === 'high' ? output.warning(w.priority) :
                       output.dim(w.priority),
              description: w.description,
            })),
        });

        output.writeln();
        output.writeln(output.dim('Press Ctrl+C to stop daemon'));

        // Listen for worker events
        daemon.on('worker:start', ({ type }: { type: string }) => {
          output.writeln(output.dim(`[daemon] Worker starting: ${type}`));
        });

        daemon.on('worker:complete', ({ type, durationMs }: { type: string; durationMs: number }) => {
          output.writeln(output.success(`[daemon] Worker completed: ${type} (${durationMs}ms)`));
        });

        daemon.on('worker:error', ({ type, error }: { type: string; error: string }) => {
          output.writeln(output.error(`[daemon] Worker failed: ${type} - ${error}`));
        });

        // Keep process alive — setInterval creates a ref'd handle that prevents
        // Node.js from exiting even when startDaemon's timers are unref'd (#1478 Bug 2).
        setInterval(() => {}, 60_000);
        await new Promise(() => {}); // Never resolves - daemon runs until killed
      } else {
        await startDaemon(projectRoot, config);
        setInterval(() => {}, 60_000); // Keep alive with ref'd handle (#1478)
        await new Promise(() => {}); // Keep alive
      }

      return { success: true };
    } catch (error) {
      output.printError(`Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Validate path for security - prevents path traversal and injection
 */
function validatePath(path: string, label: string): void {
  // Must be absolute after resolution
  const resolved = resolve(path);

  // Check for null bytes (injection attack)
  if (path.includes('\0')) {
    throw new Error(`${label} contains null bytes`);
  }

  // Check for shell metacharacters in path components
  if (/[;&|`$<>]/.test(path)) {
    throw new Error(`${label} contains shell metacharacters`);
  }

  // Prevent path traversal outside expected directories
  if (!resolved.includes('.claude-flow') && !resolved.includes('bin')) {
    // Allow only paths within project structure
    const cwd = process.cwd();
    if (!resolved.startsWith(cwd)) {
      throw new Error(`${label} escapes project directory`);
    }
  }
}

/**
 * #1914: Resolve the `--workspace` flag to an absolute path, or return null
 * if it is absent / not a usable string. Rejects values with null bytes or
 * shell metacharacters (defence-in-depth — the value is later embedded in a
 * forked child's argv and compared against `ps`/`tasklist` output).
 */
export function resolveWorkspaceFlag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes('\0') || /[;&|`$<>]/.test(trimmed)) return null;
  return resolve(trimmed);
}

/**
 * #1914: True when a process command line (from `ps -eo command` on POSIX or
 * the tasklist Window Title column on Windows) belongs to a daemon started
 * for `workspaceRoot`. The launcher (`startBackgroundDaemon`) always appends
 * `--workspace <root>` as the FINAL argv entry, so an exact trailing match
 * after stripping trailing whitespace/quotes is unambiguous — even for
 * workspace paths containing spaces — and never a bare path-prefix match,
 * so workspace `/a/proj` does not reap `/a/proj-other`'s daemon. A daemon
 * whose argv puts `--workspace` mid-list (only possible via a hand-rolled
 * invocation) simply won't be auto-reaped — `daemon stop` still handles it
 * via the PID file.
 */
export function daemonCommandLineBelongsToWorkspace(commandLine: string, workspaceRoot: string): boolean {
  return commandLine.replace(/[\s"']+$/u, '').endsWith(`--workspace ${workspaceRoot}`);
}

/**
 * #2356: extract the workspace root from a daemon process command line for the
 * global `daemon status --all` view. The launcher always appends
 * `--workspace <root>` as the FINAL argv entry (see startBackgroundDaemon), so
 * we capture everything after it to end-of-line and strip trailing quotes.
 * Returns null for pre-#1914 daemons that never stamped a workspace.
 */
export function extractWorkspaceFromDaemonLine(commandLine: string): string | null {
  const m = commandLine.match(/--workspace\s+(.+?)\s*$/u);
  if (!m) return null;
  const ws = m[1].replace(/["']+$/u, '').trim();
  return ws.length > 0 ? ws : null;
}

/**
 * Start daemon as a detached background process
 */
interface ForwardedDaemonFlags {
  maxCpuLoad?: string;
  minFreeMemory?: string;
  workers?: string;
  headless?: boolean;
  sandbox?: string;
  ttl?: string;
}

async function startBackgroundDaemon(projectRoot: string, quiet: boolean, forwarded: ForwardedDaemonFlags = {}): Promise<CommandResult> {
  const { maxCpuLoad, minFreeMemory, workers, headless, sandbox, ttl } = forwarded;
  // Validate and resolve project root
  const resolvedRoot = resolve(projectRoot);
  validatePath(resolvedRoot, 'Project root');

  const stateDir = join(resolvedRoot, '.claude-flow');
  const pidFile = join(stateDir, 'daemon.pid');
  const logFile = join(stateDir, 'daemon.log');

  // Validate all paths
  validatePath(stateDir, 'State directory');
  validatePath(pidFile, 'PID file');
  validatePath(logFile, 'Log file');

  // Ensure state directory exists
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  // Get path to CLI (from dist/src/commands/daemon.js -> bin/cli.js)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // dist/src/commands -> dist/src -> dist -> package root -> bin/cli.js
  const cliPath = resolve(join(__dirname, '..', '..', '..', 'bin', 'cli.js'));
  validatePath(cliPath, 'CLI path');

  // Verify CLI path exists
  if (!fs.existsSync(cliPath)) {
    output.printError(`CLI not found at: ${cliPath}`);
    return { success: false, exitCode: 1 };
  }

  // Platform-aware spawn flags. We use child_process.fork() because the daemon
  // child is itself a Node script — fork() spawns Node directly and skips the
  // cmd.exe interpretation pass that broke Windows + Node 25 when
  // process.execPath contained a space (#1691). It also avoids the [DEP0190]
  // shell:true security warning.
  const isWin = process.platform === 'win32';
  const forkOpts: Record<string, unknown> = {
    cwd: resolvedRoot,
    // detached: true on every platform (#1766). On Windows, leaving detached:false
    // kept the child in the parent's process group AND the IPC pipe held the
    // child to npx — when npx exited, the IPC pipe tore down and the daemon
    // died within ~1s. detached:true + child.disconnect() (below) gives the
    // child its own session/pgid and breaks the IPC pipe so the daemon
    // genuinely survives parent exit. On POSIX, detached:true was already the
    // path; this just makes Windows match.
    detached: true,
    // Use 'ignore' for all stdio + 'ignore' for the IPC channel via silent:true off.
    // fork() defaults to creating an IPC channel; we don't need it here, so we
    // pass stdio explicitly. Passing fs.openSync() FDs causes the child to die
    // on Windows when the parent exits and closes the FDs (#1478 Bug 3) — the
    // daemon writes its own logs via appendFileSync to .claude-flow/logs/.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
    env: {
      ...process.env,
      CLAUDE_FLOW_DAEMON: '1',
      // Prevent macOS SIGHUP kill when terminal closes
      ...(process.platform === 'darwin' ? { NOHUP: '1' } : {}),
    },
  };

  // Forward args to the foreground child. fork() resolves the script path
  // via Node's normal module resolution, so cliPath does not need to be
  // shell-quoted even when it contains spaces.
  const forkArgs = ['daemon', 'start', '--foreground', '--quiet'];
  // Validate with strict numeric pattern to prevent injection via crafted flags.
  const SPAWN_NUMERIC_RE = /^\d+(\.\d+)?$/;
  if (maxCpuLoad && SPAWN_NUMERIC_RE.test(maxCpuLoad)) {
    forkArgs.push('--max-cpu-load', maxCpuLoad);
  }
  if (minFreeMemory && SPAWN_NUMERIC_RE.test(minFreeMemory)) {
    forkArgs.push('--min-free-memory', minFreeMemory);
  }
  // #2356: forward the TTL so the background daemon enforces it too. Integer
  // seconds only (incl. 0 to disable) — reject anything else before it hits argv.
  if (typeof ttl === 'string' && /^\d+$/.test(ttl)) {
    forkArgs.push('--ttl', ttl);
  }
  // #1968: forward worker-selection / sandbox flags. The previous launcher
  // dropped these, so `daemon start --workers map` ran with the default
  // five-worker set instead of just `map`. Validate each before passing
  // through — argv goes straight to a forked process so reject anything
  // that doesn't look like a comma-separated worker-name list or one of
  // the allowed sandbox modes.
  const WORKERS_RE = /^[a-z][a-z0-9_-]*(,[a-z][a-z0-9_-]*)*$/;
  if (typeof workers === 'string' && workers.length > 0 && WORKERS_RE.test(workers)) {
    forkArgs.push('--workers', workers);
  }
  if (headless === true) {
    forkArgs.push('--headless');
  }
  if (typeof sandbox === 'string' && (sandbox === 'strict' || sandbox === 'permissive' || sandbox === 'disabled')) {
    forkArgs.push('--sandbox', sandbox);
  }
  // #1914: stamp the workspace into argv (kept LAST) so the foreground daemon
  // process is self-identifying and `killStaleDaemons` only reaps daemons
  // belonging to this workspace. resolvedRoot was validatePath()'d above.
  forkArgs.push('--workspace', resolvedRoot);
  const child = fork(cliPath, forkArgs, forkOpts);

  // Get PID from spawned process directly (no shell echo needed)
  const pid = child.pid;

  if (!pid || pid <= 0) {
    output.printError('Failed to get daemon PID');
    return { success: false, exitCode: 1 };
  }

  // Unref BEFORE writing PID file — prevents race where parent exits
  // but child hasn't fully detached yet (fixes macOS daemon death #1283).
  child.unref();
  // #1766: also break the IPC pipe explicitly. unref() releases the libuv
  // handle but does NOT close the IPC channel; on Windows the open IPC
  // pipe keeps the daemon tied to its parent npx, and when npx exits the
  // pipe is torn down and the daemon exits with it. disconnect() severs
  // the IPC pipe so the daemon truly stands on its own. Wrapped in try
  // because disconnect() throws if the IPC channel is already gone.
  try { child.disconnect(); } catch { /* IPC channel already closed */ }

  // Longer delay to let the child process start and write its own PID file.
  // 100ms was too short on Windows; the child's checkExistingDaemon() would
  // find the parent-written PID and return early (#1478 Bug 1).
  await new Promise(resolve => setTimeout(resolve, 500));

  // Write PID file only if the child hasn't already written its own.
  // The foreground child calls writePidFile() internally, but on some platforms
  // it may not have started yet, so we write as a fallback.
  if (!fs.existsSync(pidFile)) {
    fs.writeFileSync(pidFile, String(pid));
  }

  if (!quiet) {
    output.printSuccess(`Daemon started in background (PID: ${pid})`);
    output.printInfo(`Logs: ${logFile}`);
    output.printInfo(`Stop with: claude-flow daemon stop`);
  }

  return { success: true };
}

// Stop daemon subcommand
const stopCommand: Command = {
  name: 'stop',
  description: 'Stop the worker daemon and all background workers',
  options: [
    { name: 'quiet', short: 'Q', type: 'boolean', description: 'Suppress output' },
  ],
  examples: [
    { command: 'claude-flow daemon stop', description: 'Stop the daemon' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const quiet = ctx.flags.quiet as boolean;
    const projectRoot = process.cwd();

    try {
      if (!quiet) {
        const spinner = output.createSpinner({ text: 'Stopping worker daemon...', spinner: 'dots' });
        spinner.start();

        // Try to stop in-process daemon first
        await stopDaemon();

        // Also kill any background daemon by PID
        const killed = await killBackgroundDaemon(projectRoot);

        // #1551: Also kill stale daemon processes not tracked by PID file
        await killStaleDaemons(projectRoot, true);

        spinner.succeed(killed ? 'Worker daemon stopped' : 'Worker daemon was not running');
      } else {
        await stopDaemon();
        await killBackgroundDaemon(projectRoot);
        await killStaleDaemons(projectRoot, true);
      }

      return { success: true };
    } catch (error) {
      output.printError(`Failed to stop daemon: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

/**
 * Kill background daemon process using PID file
 */
async function killBackgroundDaemon(projectRoot: string): Promise<boolean> {
  const pidFile = join(projectRoot, '.claude-flow', 'daemon.pid');

  if (!fs.existsSync(pidFile)) {
    return false;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);

    if (isNaN(pid)) {
      fs.unlinkSync(pidFile);
      return false;
    }

    // Check if process is running
    try {
      process.kill(pid, 0); // Signal 0 = check if alive
    } catch {
      // Process not running, clean up stale PID file
      fs.unlinkSync(pidFile);
      return false;
    }

    // Kill the process
    process.kill(pid, 'SIGTERM');

    // Wait a moment then force kill if needed
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      process.kill(pid, 0);
      // Still alive, force kill
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process terminated
    }

    // Clean up PID file
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }

    return true;
  } catch (error) {
    // Clean up PID file on any error
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
    return false;
  }
}

/**
 * Kill stale daemon processes not tracked by the PID file (#1551, #1857).
 * Uses `ps` on POSIX and `tasklist` on Windows to find all daemon
 * processes for this project and kill them.
 */
async function killStaleDaemons(projectRoot: string, quiet: boolean): Promise<void> {
  if (process.platform === 'win32') {
    return killStaleDaemonsWindows(projectRoot, quiet);
  }
  return killStaleDaemonsPosix(projectRoot, quiet);
}

async function killStaleDaemonsPosix(projectRoot: string, quiet: boolean): Promise<void> {
  try {
    const { execFileSync } = await import('child_process');
    const psOutput = execFileSync('ps', ['-eo', 'pid,command'], { encoding: 'utf-8', timeout: 5000 });
    const lines = psOutput.split('\n');
    const currentPid = process.pid;
    const trackedPid = getBackgroundDaemonPid(projectRoot);
    // #1914: only ever reap daemons belonging to THIS workspace (ADR-014).
    const resolvedRoot = resolve(projectRoot);
    let killed = 0;

    for (const line of lines) {
      if (!line.includes('daemon start --foreground')) continue;
      if (!line.includes('claude-flow') && !line.includes('@claude-flow/cli')) continue;
      // #1914: skip daemons from other workspaces (or pre-#1914 versions that
      // didn't stamp --workspace — let `daemon stop` handle those via PID file).
      if (!daemonCommandLineBelongsToWorkspace(line, resolvedRoot)) continue;
      const pidStr = line.trim().split(/\s+/)[0];
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid) || pid === currentPid || pid === trackedPid) continue;
      if (!isProcessRunning(pid)) continue;
      try {
        process.kill(pid, 'SIGTERM');
        killed++;
        if (!quiet) {
          output.printWarning(`Killed stale daemon process (PID: ${pid})`);
        }
      } catch { /* ignore — may have exited between check and kill */ }
    }

    if (killed > 0 && !quiet) {
      output.printInfo(`Cleaned up ${killed} stale daemon process(es)`);
    }
  } catch {
    // ps not available or failed — skip stale cleanup
  }
}

/**
 * #1857: Windows replacement for the POSIX `ps -eo pid,command` path.
 * Uses `tasklist /v /fo csv` which returns CSV with the full Window
 * Title column (last field) — Node-spawned daemon processes carry
 * their command line there. Best-effort like the POSIX path: any
 * tooling failure (tasklist missing, parse error, etc.) is swallowed
 * silently so cleanup doesn't break daemon start.
 */
async function killStaleDaemonsWindows(projectRoot: string, quiet: boolean): Promise<void> {
  try {
    const { execFileSync } = await import('child_process');
    // /v includes the Window Title; /fo csv uses comma-separated quoted fields
    const out = execFileSync('tasklist', ['/v', '/fo', 'csv', '/nh'], { encoding: 'utf-8', timeout: 5000 });
    const lines = out.split(/\r?\n/);
    const currentPid = process.pid;
    const trackedPid = getBackgroundDaemonPid(projectRoot);
    // #1914: only ever reap daemons belonging to THIS workspace (ADR-014).
    const resolvedRoot = resolve(projectRoot);
    let killed = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      // Match daemon command line markers — the Window Title field
      // typically holds the full invocation. Skip rows that aren't ours.
      if (!line.includes('daemon start --foreground')) continue;
      if (!line.includes('claude-flow') && !line.includes('@claude-flow/cli')) continue;
      // #1914: skip daemons from other workspaces (or pre-#1914 versions).
      if (!daemonCommandLineBelongsToWorkspace(line, resolvedRoot)) continue;

      // Parse CSV: tasklist quotes each field, so split on `","`
      const fields = line.split(/","/).map(f => f.replace(/^"|"$/g, ''));
      // fields[0] = Image Name, fields[1] = PID, …
      const pidStr = fields[1];
      const pid = parseInt(pidStr ?? '', 10);
      if (isNaN(pid) || pid === currentPid || pid === trackedPid) continue;
      if (!isProcessRunning(pid)) continue;

      try {
        // taskkill is the Windows equivalent of kill — /pid <n> /f forces.
        // Use SIGTERM-equivalent (no /f) first; the daemon's signal handler
        // catches and cleans up; force-kill is the next start's job.
        execFileSync('taskkill', ['/pid', String(pid), '/t'], { encoding: 'utf-8', timeout: 5000 });
        killed++;
        if (!quiet) {
          output.printWarning(`Killed stale daemon process (PID: ${pid})`);
        }
      } catch { /* taskkill failed — process may have exited; ignore */ }
    }

    if (killed > 0 && !quiet) {
      output.printInfo(`Cleaned up ${killed} stale daemon process(es)`);
    }
  } catch {
    // tasklist not available or failed — skip stale cleanup. Defensive
    // shape matches the POSIX path. Not tested on Windows by the
    // maintainer; please report regressions on the issue tracker.
  }
}

/**
 * Get PID of background daemon from PID file
 */
function getBackgroundDaemonPid(projectRoot: string): number | null {
  const pidFile = join(projectRoot, '.claude-flow', 'daemon.pid');

  if (!fs.existsSync(pidFile)) {
    return null;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Check if a process is running
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check if alive
    return true;
  } catch {
    return false;
  }
}

/**
 * #2356: enumerate every running ruflo daemon across ALL workspaces. Reuses
 * the same `ps`/`tasklist` scan as killStaleDaemons but, instead of killing,
 * returns each live daemon's PID + workspace so `daemon status --all` can
 * surface daemons leaked in other projects. Best-effort: any tooling failure
 * yields an empty list (matching the kill-stale paths).
 */
async function scanRunningDaemons(): Promise<Array<{ pid: number; workspace: string | null }>> {
  const isWin = process.platform === 'win32';
  try {
    const { execFileSync } = await import('child_process');
    const out = isWin
      ? execFileSync('tasklist', ['/v', '/fo', 'csv', '/nh'], { encoding: 'utf-8', timeout: 5000 })
      : execFileSync('ps', ['-eo', 'pid,command'], { encoding: 'utf-8', timeout: 5000 });
    const lines = out.split(/\r?\n/);
    const found: Array<{ pid: number; workspace: string | null }> = [];

    for (const line of lines) {
      if (!line.includes('daemon start --foreground')) continue;
      if (!line.includes('claude-flow') && !line.includes('@claude-flow/cli')) continue;

      let pid: number;
      let cmd: string;
      if (isWin) {
        // tasklist /fo csv: quoted fields; PID is field[1], Window Title is last.
        const fields = line.split(/","/).map(f => f.replace(/^"|"$/g, ''));
        pid = parseInt(fields[1] ?? '', 10);
        cmd = fields[fields.length - 1] ?? line;
      } else {
        pid = parseInt(line.trim().split(/\s+/)[0], 10);
        cmd = line;
      }
      if (Number.isNaN(pid) || !isProcessRunning(pid)) continue;
      found.push({ pid, workspace: extractWorkspaceFromDaemonLine(cmd) });
    }
    return found;
  } catch {
    return [];
  }
}

/**
 * #2356: render the global `daemon status --all` view. For each running daemon
 * it reads that workspace's daemon-state.json to show age + configured TTL,
 * and flags any daemon that has outlived its TTL (or 12h when TTL is unknown)
 * as stale — the visibility that was missing when leaked daemons ran for days.
 */
async function renderAllDaemonsStatus(): Promise<CommandResult> {
  const daemons = await scanRunningDaemons();
  output.writeln();

  if (daemons.length === 0) {
    output.printBox(
      'No ruflo daemons are running in any workspace.',
      'RuFlo Daemons (all workspaces)'
    );
    return { success: true, data: { daemons: [] } };
  }

  const now = Date.now();
  const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
  let staleCount = 0;

  const rows = daemons.map(d => {
    let startedAt: Date | undefined;
    let ttlMs: number | undefined;
    if (d.workspace) {
      try {
        const statePath = join(d.workspace, '.claude-flow', 'daemon-state.json');
        if (fs.existsSync(statePath)) {
          const st = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
          if (st?.startedAt) startedAt = new Date(st.startedAt);
          if (typeof st?.config?.ttlMs === 'number') ttlMs = st.config.ttlMs;
        }
      } catch { /* unreadable/partial state — show what we have */ }
    }

    const ageMs = startedAt ? now - startedAt.getTime() : undefined;
    const overTtl = ttlMs !== undefined && ttlMs > 0 && ageMs !== undefined && ageMs > ttlMs;
    const overTwelveH = ageMs !== undefined && ageMs > TWELVE_HOURS_MS;
    const isStale = overTtl || overTwelveH;
    if (isStale) staleCount++;

    const ageText = ageMs !== undefined ? formatTimeAgo(startedAt as Date).replace(' ago', '') : '?';
    const ttlText = ttlMs !== undefined
      ? (ttlMs > 0 ? `${Math.round(ttlMs / 3600000)}h` : 'off')
      : '?';

    return {
      pid: isStale ? output.warning(String(d.pid)) : String(d.pid),
      workspace: d.workspace ?? output.dim('(unknown)'),
      age: isStale ? output.warning(ageText) : ageText,
      ttl: ttlText === 'off' ? output.dim('off') : ttlText,
    };
  });

  output.printTable({
    columns: [
      { key: 'pid', header: 'PID', width: 8 },
      { key: 'age', header: 'Age', width: 8 },
      { key: 'ttl', header: 'TTL', width: 6 },
      { key: 'workspace', header: 'Workspace', width: 50 },
    ],
    data: rows,
  });

  output.writeln();
  if (staleCount > 0) {
    output.printWarning(
      `${staleCount} daemon(s) have outlived their TTL (or have run >12h). Stop one with: cd <workspace> && ruflo daemon stop`
    );
  } else {
    output.printInfo(`${daemons.length} daemon(s) running, all within their TTL.`);
  }

  return { success: true, data: { daemons: rows.length } };
}

// Status subcommand
const statusCommand: Command = {
  name: 'status',
  description: 'Show daemon and worker status',
  options: [
    { name: 'verbose', short: 'v', type: 'boolean', description: 'Show detailed worker statistics' },
    { name: 'show-modes', type: 'boolean', description: 'Show worker execution modes (local/headless) and sandbox settings' },
    // #2356: the default status reads only the CURRENT workspace, so a daemon
    // leaked in another project is invisible. --all scans every running ruflo
    // daemon across all workspaces (the global view that surfaces leaks).
    { name: 'all', short: 'a', type: 'boolean', description: 'List ruflo daemons across ALL workspaces (global view — surfaces leaked daemons)' },
  ],
  examples: [
    { command: 'claude-flow daemon status', description: 'Show daemon status' },
    { command: 'claude-flow daemon status -v', description: 'Show detailed status' },
    { command: 'claude-flow daemon status --show-modes', description: 'Show worker execution modes' },
    { command: 'claude-flow daemon status --all', description: 'List daemons across all workspaces' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const verbose = ctx.flags.verbose as boolean;
    const showModes = ctx.flags['show-modes'] as boolean;
    // #2356: global view across every workspace, not just cwd.
    if (ctx.flags.all as boolean) {
      return renderAllDaemonsStatus();
    }
    const projectRoot = process.cwd();

    try {
      const daemon = getDaemon(projectRoot);
      const status = daemon.getStatus();

      // Also check for background daemon
      const bgPid = getBackgroundDaemonPid(projectRoot);
      const bgRunning = bgPid ? isProcessRunning(bgPid) : false;

      const isRunning = status.running || bgRunning;
      const displayPid = bgPid || status.pid;

      output.writeln();

      // Daemon status box
      const statusIcon = isRunning ? output.success('●') : output.error('○');
      const statusText = isRunning ? output.success('RUNNING') : output.error('STOPPED');
      const mode = bgRunning ? output.dim(' (background)') : status.running ? output.dim(' (foreground)') : '';

      output.printBox(
        [
          `Status: ${statusIcon} ${statusText}${mode}`,
          `PID: ${displayPid}`,
          status.startedAt ? `Started: ${status.startedAt.toISOString()}` : '',
          status.config.ttlMs > 0
            ? `TTL: ${Math.round(status.config.ttlMs / 3600000)}h (self-shutdown)`
            : `TTL: ${output.dim('off (runs until stopped)')}`,
          `Workers Enabled: ${status.config.workers.filter(w => w.enabled).length}`,
          `Max Concurrent: ${status.config.maxConcurrent}`,
          `Max CPU Load: ${status.config.resourceThresholds.maxCpuLoad}`,
          `Min Free Memory: ${status.config.resourceThresholds.minFreeMemoryPercent}%`,
        ].filter(Boolean).join('\n'),
        'RuFlo Daemon'
      );

      output.writeln();
      output.writeln(output.bold('Worker Status'));

      const workerData = status.config.workers.map(w => {
        const state = status.workers.get(w.type);
        // Check for headless mode from worker config or state
        const isHeadless = (w as unknown as Record<string, unknown>).headless || (state as unknown as Record<string, unknown> | undefined)?.headless || false;
        const sandboxMode = (w as unknown as Record<string, unknown>).sandbox || (state as unknown as Record<string, unknown> | undefined)?.sandbox || null;
        return {
          type: w.enabled ? output.highlight(w.type) : output.dim(w.type),
          enabled: w.enabled ? output.success('✓') : output.dim('○'),
          status: state?.isRunning ? output.warning('running') :
                  w.enabled ? output.success('idle') : output.dim('disabled'),
          runs: state?.runCount ?? 0,
          success: state ? `${Math.round((state.successCount / Math.max(state.runCount, 1)) * 100)}%` : '-',
          lastRun: state?.lastRun ? formatTimeAgo(state.lastRun) : output.dim('never'),
          nextRun: state?.nextRun && w.enabled ? formatTimeUntil(state.nextRun) : output.dim('-'),
          mode: isHeadless ? output.highlight('headless') : output.dim('local'),
          sandbox: isHeadless ? (sandboxMode || 'strict') : output.dim('-'),
        };
      });

      // Build columns based on --show-modes flag
      const baseColumns = [
        { key: 'type', header: 'Worker', width: 12 },
        { key: 'enabled', header: 'On', width: 4 },
        { key: 'status', header: 'Status', width: 10 },
        { key: 'runs', header: 'Runs', width: 6 },
        { key: 'success', header: 'Success', width: 8 },
        { key: 'lastRun', header: 'Last Run', width: 12 },
        { key: 'nextRun', header: 'Next Run', width: 12 },
      ];

      const modeColumns = showModes ? [
        { key: 'mode', header: 'Mode', width: 10 },
        { key: 'sandbox', header: 'Sandbox', width: 12 },
      ] : [];

      output.printTable({
        columns: [...baseColumns, ...modeColumns],
        data: workerData,
      });

      if (verbose) {
        output.writeln();
        output.writeln(output.bold('Worker Configuration'));
        output.printTable({
          columns: [
            { key: 'type', header: 'Worker', width: 12 },
            { key: 'interval', header: 'Interval', width: 10 },
            { key: 'priority', header: 'Priority', width: 10 },
            { key: 'avgDuration', header: 'Avg Duration', width: 12 },
            { key: 'description', header: 'Description', width: 30 },
          ],
          data: status.config.workers.map(w => {
            const state = status.workers.get(w.type);
            return {
              type: w.type,
              interval: `${Math.round(w.intervalMs / 60000)}min`,
              priority: w.priority,
              avgDuration: state?.averageDurationMs ? `${Math.round(state.averageDurationMs)}ms` : '-',
              description: w.description,
            };
          }),
        });
      }

      return { success: true, data: status };
    } catch (error) {
      // Daemon not initialized
      output.writeln();
      output.printBox(
        [
          `Status: ${output.error('○')} ${output.error('NOT INITIALIZED')}`,
          '',
          'Run "claude-flow daemon start" to start the daemon',
        ].join('\n'),
        'RuFlo Daemon'
      );

      return { success: true };
    }
  },
};

// Trigger subcommand - manually run a worker
const triggerCommand: Command = {
  name: 'trigger',
  description: 'Manually trigger a specific worker',
  options: [
    { name: 'worker', short: 'w', type: 'string', description: 'Worker type to trigger', required: true },
    { name: 'headless', type: 'boolean', description: 'Run triggered worker in headless mode (E2B sandbox)' },
  ],
  examples: [
    { command: 'claude-flow daemon trigger -w map', description: 'Trigger the map worker' },
    { command: 'claude-flow daemon trigger -w audit', description: 'Trigger security audit' },
    { command: 'claude-flow daemon trigger -w audit --headless', description: 'Trigger audit in headless sandbox' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const workerType = ctx.flags.worker as WorkerType;

    if (!workerType) {
      output.printError('Worker type is required. Use --worker or -w flag.');
      output.writeln();
      output.writeln('Available workers: map, audit, optimize, consolidate, testgaps, predict, document, ultralearn, refactor, benchmark, deepdive, preload');
      return { success: false, exitCode: 1 };
    }

    try {
      const daemon = getDaemon(process.cwd());

      const spinner = output.createSpinner({ text: `Running ${workerType} worker...`, spinner: 'dots' });
      spinner.start();

      const result = await daemon.triggerWorker(workerType);

      if (result.success) {
        spinner.succeed(`Worker ${workerType} completed in ${result.durationMs}ms`);

        if (result.output) {
          output.writeln();
          output.writeln(output.bold('Output'));
          output.printJson(result.output);
        }
      } else {
        spinner.fail(`Worker ${workerType} failed: ${result.error}`);
      }

      return { success: result.success, data: result };
    } catch (error) {
      output.printError(`Failed to trigger worker: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Enable/disable worker subcommand
const enableCommand: Command = {
  name: 'enable',
  description: 'Enable or disable a specific worker',
  options: [
    { name: 'worker', short: 'w', type: 'string', description: 'Worker type', required: true },
    { name: 'disable', short: 'd', type: 'boolean', description: 'Disable instead of enable' },
  ],
  examples: [
    { command: 'claude-flow daemon enable -w predict', description: 'Enable predict worker' },
    { command: 'claude-flow daemon enable -w document --disable', description: 'Disable document worker' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const workerType = ctx.flags.worker as WorkerType;
    const disable = ctx.flags.disable as boolean;

    if (!workerType) {
      output.printError('Worker type is required. Use --worker or -w flag.');
      return { success: false, exitCode: 1 };
    }

    try {
      const daemon = getDaemon(process.cwd());
      daemon.setWorkerEnabled(workerType, !disable);

      output.printSuccess(`Worker ${workerType} ${disable ? 'disabled' : 'enabled'}`);

      return { success: true };
    } catch (error) {
      output.printError(`Failed to ${disable ? 'disable' : 'enable'} worker: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, exitCode: 1 };
    }
  },
};

// Helper functions for time formatting
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatTimeUntil(date: Date): string {
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);

  if (seconds < 0) return 'now';
  if (seconds < 60) return `in ${seconds}s`;
  if (seconds < 3600) return `in ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `in ${Math.floor(seconds / 3600)}h`;
  return `in ${Math.floor(seconds / 86400)}d`;
}

// #1565: Supervisor installer subcommand. Writes a native auto-restart
// unit (launchd plist on macOS, systemd-user .service on Linux) so the
// daemon survives crashes and reboots without requiring the operator
// to manually run `daemon start` after every failure.
const installSupervisorCommand: Command = {
  name: 'install-supervisor',
  description: 'Install OS-level auto-restart supervisor (launchd on macOS, systemd-user on Linux)',
  options: [
    { name: 'force', short: 'f', type: 'boolean', description: 'Overwrite existing unit file', default: 'false' },
    { name: 'load', type: 'boolean', description: 'Load/enable the unit immediately', default: 'true' },
    { name: 'dry-run', type: 'boolean', description: 'Print the unit file content without writing', default: 'false' },
  ],
  examples: [
    { command: 'claude-flow daemon install-supervisor', description: 'Install + load (auto-restart enabled)' },
    { command: 'claude-flow daemon install-supervisor --no-load', description: 'Write unit file but do not enable yet' },
    { command: 'claude-flow daemon install-supervisor --dry-run', description: 'Preview the unit file' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const force = ctx.flags.force === true;
    const load = ctx.flags.load !== false;
    const dryRun = ctx.flags['dry-run'] === true || ctx.flags.dryRun === true;
    const projectRoot = process.cwd();
    const platform = process.platform;

    if (platform === 'win32') {
      output.printError('Windows scheduled-task installer is not yet implemented.');
      output.printInfo('Use Task Scheduler manually, or follow this issue: https://github.com/ruvnet/ruflo/issues/1565');
      return { success: false, exitCode: 1 };
    }
    if (platform !== 'darwin' && platform !== 'linux') {
      output.printError(`Unsupported platform: ${platform}. Supported: darwin (launchd), linux (systemd-user).`);
      return { success: false, exitCode: 1 };
    }

    // Resolve absolute paths the unit file will reference.
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (!home) {
      output.printError('HOME/USERPROFILE not set; cannot resolve user unit path.');
      return { success: false, exitCode: 1 };
    }
    const nodeBin = process.execPath;
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const cliJs = resolve(join(__dirname, '..', '..', '..', 'bin', 'cli.js'));
    if (!fs.existsSync(cliJs)) {
      output.printError(`CLI not found at: ${cliJs}`);
      return { success: false, exitCode: 1 };
    }

    if (platform === 'darwin') {
      const plistDir = join(home, 'Library', 'LaunchAgents');
      const plistPath = join(plistDir, 'io.ruv.ruflo.daemon.plist');
      const logDir = join(projectRoot, '.claude-flow', 'logs');
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>io.ruv.ruflo.daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${cliJs}</string>
        <string>daemon</string><string>start</string><string>--foreground</string><string>--quiet</string>
    </array>
    <key>WorkingDirectory</key><string>${projectRoot}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key><false/>
        <key>Crashed</key><true/>
    </dict>
    <key>ThrottleInterval</key><integer>10</integer>
    <key>StandardOutPath</key><string>${logDir}/supervisor.out.log</string>
    <key>StandardErrorPath</key><string>${logDir}/supervisor.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CLAUDE_FLOW_DAEMON</key><string>1</string>
    </dict>
</dict>
</plist>
`;

      if (dryRun) {
        output.writeln(plist);
        return { success: true };
      }
      if (fs.existsSync(plistPath) && !force) {
        output.printWarning(`Already installed: ${plistPath}`);
        output.printInfo('Use --force to overwrite.');
        return { success: false, exitCode: 1 };
      }
      if (!fs.existsSync(plistDir)) fs.mkdirSync(plistDir, { recursive: true });
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(plistPath, plist, 'utf-8');
      output.printSuccess(`Wrote ${plistPath}`);

      if (load) {
        try {
          const { execFileSync } = await import('child_process');
          // unload first in case a previous version is loaded
          try { execFileSync('launchctl', ['unload', plistPath], { encoding: 'utf-8', timeout: 5000 }); } catch { /* ok */ }
          execFileSync('launchctl', ['load', '-w', plistPath], { encoding: 'utf-8', timeout: 5000 });
          output.printSuccess('Supervisor loaded — daemon will auto-restart on crash and survive reboot.');
        } catch (err) {
          output.printWarning(`launchctl load failed: ${err instanceof Error ? err.message : String(err)}`);
          output.printInfo(`Run manually: launchctl load -w ${plistPath}`);
        }
      } else {
        output.printInfo(`Run when ready:  launchctl load -w ${plistPath}`);
      }
      return { success: true };
    }

    // Linux: systemd-user
    const unitDir = join(home, '.config', 'systemd', 'user');
    const unitPath = join(unitDir, 'ruflo-daemon.service');
    const unit = `[Unit]
Description=RuFlo background worker daemon
After=default.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
Environment=CLAUDE_FLOW_DAEMON=1
ExecStart=${nodeBin} ${cliJs} daemon start --foreground --quiet
Restart=on-failure
RestartSec=10
# Restart on Crashed (signal) too
StartLimitIntervalSec=300
StartLimitBurst=5

[Install]
WantedBy=default.target
`;

    if (dryRun) {
      output.writeln(unit);
      return { success: true };
    }
    if (fs.existsSync(unitPath) && !force) {
      output.printWarning(`Already installed: ${unitPath}`);
      output.printInfo('Use --force to overwrite.');
      return { success: false, exitCode: 1 };
    }
    if (!fs.existsSync(unitDir)) fs.mkdirSync(unitDir, { recursive: true });
    fs.writeFileSync(unitPath, unit, 'utf-8');
    output.printSuccess(`Wrote ${unitPath}`);

    if (load) {
      try {
        const { execFileSync } = await import('child_process');
        execFileSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf-8', timeout: 5000 });
        execFileSync('systemctl', ['--user', 'enable', '--now', 'ruflo-daemon.service'], { encoding: 'utf-8', timeout: 10000 });
        output.printSuccess('Supervisor enabled — daemon will auto-restart on crash and survive reboot.');
        output.printInfo('Note: requires `loginctl enable-linger $USER` for restart-after-logout on some distros.');
      } catch (err) {
        output.printWarning(`systemctl --user enable failed: ${err instanceof Error ? err.message : String(err)}`);
        output.printInfo(`Run manually: systemctl --user daemon-reload && systemctl --user enable --now ruflo-daemon.service`);
      }
    } else {
      output.printInfo(`Run when ready:  systemctl --user daemon-reload && systemctl --user enable --now ruflo-daemon.service`);
    }
    return { success: true };
  },
};

const uninstallSupervisorCommand: Command = {
  name: 'uninstall-supervisor',
  description: 'Remove the auto-restart supervisor unit (launchd on macOS, systemd-user on Linux)',
  options: [],
  action: async (): Promise<CommandResult> => {
    const platform = process.platform;
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';

    if (platform === 'darwin') {
      const plistPath = join(home, 'Library', 'LaunchAgents', 'io.ruv.ruflo.daemon.plist');
      try {
        const { execFileSync } = await import('child_process');
        try { execFileSync('launchctl', ['unload', plistPath], { encoding: 'utf-8', timeout: 5000 }); } catch { /* ok */ }
      } catch { /* ignore */ }
      if (fs.existsSync(plistPath)) {
        fs.unlinkSync(plistPath);
        output.printSuccess(`Removed ${plistPath}`);
      } else {
        output.printInfo(`Not installed: ${plistPath}`);
      }
      return { success: true };
    }
    if (platform === 'linux') {
      const unitPath = join(home, '.config', 'systemd', 'user', 'ruflo-daemon.service');
      try {
        const { execFileSync } = await import('child_process');
        try { execFileSync('systemctl', ['--user', 'disable', '--now', 'ruflo-daemon.service'], { encoding: 'utf-8', timeout: 5000 }); } catch { /* ok */ }
      } catch { /* ignore */ }
      if (fs.existsSync(unitPath)) {
        fs.unlinkSync(unitPath);
        output.printSuccess(`Removed ${unitPath}`);
      } else {
        output.printInfo(`Not installed: ${unitPath}`);
      }
      return { success: true };
    }
    output.printError(`Unsupported platform: ${platform}`);
    return { success: false, exitCode: 1 };
  },
};

// Main daemon command
export const daemonCommand: Command = {
  name: 'daemon',
  description: 'Manage background worker daemon (Node.js-based, auto-runs like shell helpers)',
  subcommands: [
    startCommand,
    stopCommand,
    statusCommand,
    triggerCommand,
    enableCommand,
    installSupervisorCommand,
    uninstallSupervisorCommand,
  ],
  options: [],
  examples: [
    { command: 'claude-flow daemon start', description: 'Start the daemon' },
    { command: 'claude-flow daemon start --headless', description: 'Start with headless workers (E2B sandbox)' },
    { command: 'claude-flow daemon status', description: 'Check daemon status' },
    { command: 'claude-flow daemon stop', description: 'Stop the daemon' },
    { command: 'claude-flow daemon trigger -w audit', description: 'Run security audit' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('RuFlo Daemon - Background Task Management'));
    output.writeln();
    output.writeln('Node.js-based background worker system that auto-runs like shell daemons.');
    output.writeln('Manages 12 specialized workers for continuous optimization and monitoring.');
    output.writeln();
    output.writeln(output.bold('Headless Mode'));
    output.writeln('Workers can run in headless mode using E2B sandboxes for isolated execution.');
    output.writeln('Use --headless flag with start/trigger commands. Sandbox modes: strict, permissive, disabled.');
    output.writeln();

    output.writeln(output.bold('Available Workers'));
    output.printList([
      `${output.highlight('map')}         - Codebase mapping (5 min interval)`,
      `${output.highlight('audit')}       - Security analysis (10 min interval)`,
      `${output.highlight('optimize')}    - Performance optimization (15 min interval)`,
      `${output.highlight('consolidate')} - Memory consolidation (30 min interval)`,
      `${output.highlight('testgaps')}    - Test coverage analysis (20 min interval)`,
      `${output.highlight('predict')}     - Predictive preloading (2 min, disabled by default)`,
      `${output.highlight('document')}    - Auto-documentation (60 min, disabled by default)`,
      `${output.highlight('ultralearn')}  - Deep knowledge acquisition (manual trigger)`,
      `${output.highlight('refactor')}    - Code refactoring suggestions (manual trigger)`,
      `${output.highlight('benchmark')}   - Performance benchmarking (manual trigger)`,
      `${output.highlight('deepdive')}    - Deep code analysis (manual trigger)`,
      `${output.highlight('preload')}     - Resource preloading (manual trigger)`,
    ]);

    output.writeln();
    output.writeln(output.bold('Subcommands'));
    output.printList([
      `${output.highlight('start')}   - Start the daemon`,
      `${output.highlight('stop')}    - Stop the daemon`,
      `${output.highlight('status')}  - Show daemon status`,
      `${output.highlight('trigger')} - Manually run a worker`,
      `${output.highlight('enable')}  - Enable/disable a worker`,
    ]);

    output.writeln();
    output.writeln('Run "claude-flow daemon <subcommand> --help" for details');

    return { success: true };
  },
};

export default daemonCommand;
