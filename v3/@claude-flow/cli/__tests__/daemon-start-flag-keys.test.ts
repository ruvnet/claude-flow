import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as daemonService from '../src/services/worker-daemon.js';
import { CommandParser } from '../src/parser.js';
import { daemonCommand } from '../src/commands/daemon.js';
import type { DaemonConfig } from '../src/services/worker-daemon.js';

const dirs: string[] = [];
const signals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'exit'] as const;
const listeners = new Map(signals.map(signal => [signal, process.listeners(signal)]));
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!listeners.get(signal)!.includes(listener)) process.removeListener(signal, listener);
    }
  }
});

async function runStart(flags: string[]): Promise<Partial<DaemonConfig>> {
  const workspace = mkdtempSync(join(tmpdir(), 'ruflo-daemon-start-flags-')); dirs.push(workspace);
  vi.stubEnv('CLAUDE_FLOW_DAEMON', '1');
  vi.stubEnv('RUFLO_DAEMON_NO_DISTILL', undefined);
  // A daemon that declines to start makes the foreground action return.
  const start = vi.spyOn(daemonService, 'startDaemon')
    .mockResolvedValue({ getStatus: () => ({ running: false }) } as unknown as daemonService.WorkerDaemon);
  const parser = new CommandParser();
  parser.registerCommand(daemonCommand);
  const parsed = parser.parse(['daemon', 'start', '--foreground', '--quiet', '--workspace', workspace, ...flags]);
  const action = daemonCommand.subcommands!.find(command => command.name === 'start')!.action!;
  const result = await action({ args: [], flags: parsed.flags, cwd: workspace, interactive: false });
  expect(result?.success).toBe(true);
  expect(start).toHaveBeenCalledTimes(1);
  return start.mock.calls[0][1] as Partial<DaemonConfig>;
}

describe('daemon start flags through the real command parser', () => {
  it('applies --max-cpu-load and --min-free-memory', async () => {
    const config = await runStart(['--max-cpu-load', '8', '--min-free-memory', '5']);
    expect(config.resourceThresholds).toEqual({ maxCpuLoad: 8, minFreeMemoryPercent: 5 });
  });

  it('applies --no-distill', async () => {
    await runStart(['--no-distill']);
    expect(process.env.RUFLO_DAEMON_NO_DISTILL).toBe('1');
  });

  it('leaves thresholds and distillation alone without the flags', async () => {
    const config = await runStart([]);
    expect(config.resourceThresholds).toBeUndefined();
    expect(process.env.RUFLO_DAEMON_NO_DISTILL).toBeUndefined();
  });
});
