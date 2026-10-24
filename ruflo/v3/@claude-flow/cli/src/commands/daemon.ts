/**
 * V3 CLI Daemon Command
 * Manages background worker daemon (Node.js-based, similar to shell helpers)
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { WorkerDaemon, getDaemon, startDaemon, stopDaemon, type WorkerType } from '../services/worker-daemon.js';
import { spawn, execFile } from 'child_process';
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
    const projectRoot = process.cwd();
    const isDaemonProcess = process.env.CLAUDE_FLOW_DAEMON === '1';

    // Check if background daemon already running (skip if we ARE the daemon process)
    if (!isDaemonProcess) {
      const bgPid = getBackgroundDaemonPid(projectRoot);
      if (bgPid && isProcessRunning(bgPid)) {
        if (!quiet) {
          output.printWarning(`Daemon already running in background (PID: ${bgPid})`);
        }
        return { success: true };
      }
    }

    // Background mode (default): fork a detached process
    if (!foreground) {
      return startBackgroundDaemon(projectRoot, quiet);
    }

    // Foreground mode: run in current process (blocks terminal)
    try {
      const stateDir = join(projectRoot, '.claude-flow');
      const pidFile = join(stateDir, 'daemon.pid');

      // Ensure state directory exists
      if (!fs.existsSync(stateDir)) {
        fs.mkdirSync(stateDir, { recursive: true });
      }

      // Write PID file for foreground mode
      fs.writeFileSync(pidFile, String(process.pid));

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

      if (!quiet) {
        const spinner = output.createSpinner({ text: 'Starting worker daemon...', spinner: 'dots' });
        spinner.start();

        const daemon = await startDaemon(projectRoot);
        const status = daemon.getStatus();

        spinner.succeed('Worker daemon started (foreground mode)');

        output.writeln();
        output.printBox(
          [
            `PID: ${status.pid}`,
            `Started: ${status.startedAt?.toISOString()}`,
            `Workers: ${status.config.workers.filter(w => w.enabled).length} enabled`,
            `Max Concurrent: ${status.config.maxConcurrent}`,
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

        // Keep process alive
        await new Promise(() => {}); // Never resolves - daemon runs until killed
      } else {
        await startDaemon(projectRoot);
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
 * Start daemon as a detached background process
 */
async function startBackgroundDaemon(projectRoot: string, quiet: boolean): Promise<CommandResult> {
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

  // Use spawn with explicit arguments instead of shell string interpolation
  // This prevents command injection via paths
  const child = spawn(process.execPath, [
    cliPath,
    'daemon', 'start', '--foreground', '--quiet'
  ], {
    cwd: resolvedRoot,
    detached: true,
    stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
    env: { ...process.env, CLAUDE_FLOW_DAEMON: '1' },
  });

  // Get PID from spawned process directly (no shell echo needed)
  const pid = child.pid;

  if (!pid || pid <= 0) {
    output.printError('Failed to get daemon PID');
    return { success: false, exitCode: 1 };
  }

  // Save PID
  fs.writeFileSync(pidFile, String(pid));

  if (!quiet) {
    output.printSuccess(`Daemon started in background (PID: ${pid})`);
    output.printInfo(`Logs: ${logFile}`);
    output.printInfo(`Stop with: claude-flow daemon stop`);
  }

  // Unref so parent can exit immediately
  child.unref();

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

        spinner.succeed(killed ? 'Worker daemon stopped' : 'Worker daemon was not running');
      } else {
        await stopDaemon();
        await killBackgroundDaemon(projectRoot);
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

// Status subcommand
const statusCommand: Command = {
  name: 'status',
  description: 'Show daemon and worker status',
  options: [
    { name: 'verbose', short: 'v', type: 'boolean', description: 'Show detailed worker statistics' },
    { name: 'show-modes', type: 'boolean', description: 'Show worker execution modes (local/headless) and sandbox settings' },
  ],
  examples: [
    { command: 'claude-flow daemon status', description: 'Show daemon status' },
    { command: 'claude-flow daemon status -v', description: 'Show detailed status' },
    { command: 'claude-flow daemon status --show-modes', description: 'Show worker execution modes' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const verbose = ctx.flags.verbose as boolean;
    const showModes = ctx.flags['show-modes'] as boolean;
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
          `Workers Enabled: ${status.config.workers.filter(w => w.enabled).length}`,
          `Max Concurrent: ${status.config.maxConcurrent}`,
        ].filter(Boolean).join('\n'),
        'Worker Daemon'
      );

      output.writeln();
      output.writeln(output.bold('Worker Status'));

      const workerData = status.config.workers.map(w => {
        const state = status.workers.get(w.type);
        // Check for headless mode from worker config or state
        const isHeadless = (w as any).headless || (state as any)?.headless || false;
        const sandboxMode = (w as any).sandbox || (state as any)?.sandbox || null;
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
        'Worker Daemon'
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
    output.writeln(output.bold('Worker Daemon - Background Task Management'));
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
