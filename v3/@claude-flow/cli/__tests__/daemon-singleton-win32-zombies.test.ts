/**
 * Daemon singleton: no zombie `daemon start --foreground` processes.
 *
 * Reproduced on Windows with ruflo 3.56.3: three concurrent CLI commands in a
 * fresh project left THREE `daemon start --foreground --quiet --workspace W`
 * processes alive for one workspace. Two independent defects combine:
 *
 *  1. The launcher's lock wait gave up after a fixed 5s and then proceeded
 *     WITHOUT the lock. On Windows the lock holder runs killStaleDaemons
 *     (`tasklist /v`, often several seconds) while holding it, so waiters time
 *     out, see no PID file yet, and each fork their own daemon child.
 *  2. A forked foreground child whose WorkerDaemon.start() declines (another
 *     live daemon owns daemon.pid) still parked itself forever on a keep-alive
 *     interval — an idle ~85 MB process with no TTL — and its exit handler
 *     would delete the OTHER daemon's PID file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { daemonCommand } from '../src/commands/daemon.js';

const SAVED_ENV = { ...process.env };
const SAVED_CWD = process.cwd();

function startCommand() {
  return daemonCommand.subcommands!.find((c) => c.name === 'start')!;
}

function within<T>(p: Promise<T>, ms: number): Promise<T | 'TIMEOUT'> {
  return Promise.race([p, new Promise<'TIMEOUT'>((r) => setTimeout(() => r('TIMEOUT'), ms))]);
}

describe('daemon singleton (win32 zombie daemons)', () => {
  let ws: string;
  let holder: ChildProcess;

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'daemon-singleton-'));
    mkdirSync(join(ws, '.claude-flow'), { recursive: true });
    writeFileSync(join(ws, 'claude-flow.config.json'), '{}');
    // A live process standing in for "the daemon / launcher that got there first".
    holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  });

  afterEach(() => {
    process.chdir(SAVED_CWD);
    process.env = { ...SAVED_ENV };
    try { holder.kill(); } catch { /* gone */ }
    rmSync(ws, { recursive: true, force: true });
  });

  it('a forked foreground child exits when another live daemon owns daemon.pid, and leaves that PID file alone', async () => {
    const pidFile = join(ws, '.claude-flow', 'daemon.pid');
    writeFileSync(pidFile, String(holder.pid));
    process.env.CLAUDE_FLOW_DAEMON = '1'; // we are the forked child
    const result = await within(
      startCommand().action!({ args: [], flags: { foreground: true, quiet: true, workspace: ws }, cwd: ws, interactive: false } as never),
      4000,
    );
    expect(result).not.toBe('TIMEOUT'); // pre-fix: parks forever on a keep-alive interval
    expect(result).toMatchObject({ success: true });
    expect(readFileSync(pidFile, 'utf-8').trim()).toBe(String(holder.pid));
  });

  it('a launcher never steals a lock whose holder is still alive', async () => {
    const lockFile = join(ws, '.claude-flow', 'daemon.lock');
    writeFileSync(lockFile, String(holder.pid)); // holder is mid-spawn (e.g. slow tasklist on Windows)
    delete process.env.CLAUDE_FLOW_DAEMON;
    process.env.RUFLO_DAEMON_LOCK_WAIT_MS = '1500';
    process.chdir(ws);
    const result = await within(
      startCommand().action!({ args: [], flags: { quiet: true, workspace: ws }, cwd: ws, interactive: false } as never)
        .catch((e: Error) => ({ success: false, error: e.message })),
      15000,
    );
    expect(result).not.toBe('TIMEOUT');
    // pre-fix: after a fixed 5s the waiter deletes the live holder's lock and
    // goes on to spawn its own daemon.
    expect(existsSync(lockFile)).toBe(true);
    expect(readFileSync(lockFile, 'utf-8').trim()).toBe(String(holder.pid));
  }, 20000);
});
