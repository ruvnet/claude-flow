import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import * as daemonService from '../src/services/worker-daemon.js';
import { daemonCommand } from '../src/commands/daemon.js';
import type { CommandContext } from '../src/types.js';

const dirs: string[] = [];
const signals = ['SIGTERM', 'SIGINT', 'SIGHUP', 'uncaughtException', 'unhandledRejection', 'exit'] as const;
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
function project(savedWorkers?: Array<{ type: string; enabled: boolean }>) {
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-worker-selection-')); dirs.push(dir);
  mkdirSync(join(dir, '.claude-flow'), { recursive: true });
  if (savedWorkers) writeFileSync(join(dir, '.claude-flow', 'daemon-state.json'), JSON.stringify({ config: { workers: savedWorkers }, workers: {} }));
  return dir;
}
const enabled = (daemon: WorkerDaemon) => daemon.getStatus().config.workers.filter(w => w.enabled).map(w => w.type);

describe('daemon explicit worker selection (#3547)', () => {
  it.each([['map,audit', ['map', 'audit']], ['predict,document,predict', ['predict', 'document']]])('consumes --workers %s in the public foreground start action', async (workers, selection) => {
    vi.stubEnv('CLAUDE_FLOW_DAEMON', '1');
    const start = vi.spyOn(daemonService, 'startDaemon').mockRejectedValue(new Error('test stops before daemon scheduling'));
    const action = daemonCommand.subcommands!.find(command => command.name === 'start')!.action!;
    await action({ flags: { foreground: true, quiet: true, workspace: project(), workers }, args: [] } as unknown as CommandContext);
    expect(start).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ enabledWorkers: selection }));
  });

  it('overrides persisted enabled flags and keeps disabled workers in the configuration', () => {
    const dir = project([{ type: 'map', enabled: false }, { type: 'audit', enabled: false }, { type: 'optimize', enabled: true }]);
    const daemon = new WorkerDaemon(dir, { aiWorkersEnabled: false, enabledWorkers: ['map', 'audit'] });
    expect(enabled(daemon)).toEqual(['map', 'audit']);
    expect(daemon.getStatus().config.workers.find(w => w.type === 'optimize')!.enabled).toBe(false);
    expect(daemon.getStatus().config.workers).toHaveLength(9);
    expect(daemon.getStatus().config.aiWorkersEnabled).toBe(false);
  });

  it('preserves saved selection when no explicit selection is supplied', () => {
    const daemon = new WorkerDaemon(project([{ type: 'optimize', enabled: false }]), { aiWorkersEnabled: false });
    expect(enabled(daemon)).not.toContain('optimize');
    expect(enabled(daemon)).toContain('map');
  });

  it('does not leak a selected or restored worker flag into a different project', () => {
    new WorkerDaemon(project(), { aiWorkersEnabled: false, enabledWorkers: ['audit'] });
    const fresh = new WorkerDaemon(project(), { aiWorkersEnabled: false });
    expect(enabled(fresh)).toEqual(['map', 'audit', 'optimize', 'consolidate', 'testgaps', 'backup', 'harness']);
  });

  it('supports an explicit empty constructor selection without enabling defaults', () => {
    expect(enabled(new WorkerDaemon(project(), { aiWorkersEnabled: false, enabledWorkers: [] }))).toEqual([]);
  });

  it.each(['map,unknown', 'map;echo', ''])('rejects invalid --workers %s before starting', async workers => {
    vi.stubEnv('CLAUDE_FLOW_DAEMON', '1');
    const start = vi.spyOn(daemonService, 'startDaemon').mockRejectedValue(new Error('should not reach start'));
    const action = daemonCommand.subcommands!.find(command => command.name === 'start')!.action!;
    const result = await action({ flags: { foreground: true, quiet: true, workspace: project(), workers }, args: [] } as unknown as CommandContext);
    expect(result.success).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});
