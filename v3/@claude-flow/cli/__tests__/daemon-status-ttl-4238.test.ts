/**
 * #4238: `daemon status` printed the TTL of the status process's own
 * default-config WorkerDaemon (12h), not the running background daemon's,
 * so a daemon started with `--ttl 0` was reported as self-shutting down.
 * The background daemon persists its real config in daemon-state.json.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { daemonCommand } from '../src/commands/daemon.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

const originalCwd = process.cwd();
let workspace: string | undefined;

afterEach(() => {
  process.chdir(originalCwd);
  vi.restoreAllMocks();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

async function statusBoxFor(config: Record<string, unknown>): Promise<string> {
  workspace = mkdtempSync(join(tmpdir(), 'daemon-status-ttl-'));
  const stateDir = join(workspace, '.claude-flow');
  mkdirSync(stateDir, { recursive: true });
  // A live PID stands in for the background daemon.
  writeFileSync(join(stateDir, 'daemon.pid'), String(process.pid));
  writeFileSync(join(stateDir, 'daemon-state.json'), JSON.stringify({ running: true, config }));
  process.chdir(workspace);
  const lines: string[] = [];
  vi.spyOn(output, 'printBox').mockImplementation((content: string | string[]) => {
    lines.push(...(Array.isArray(content) ? content : [content]));
  });
  vi.spyOn(output, 'writeln').mockImplementation(() => undefined);
  const status = daemonCommand.subcommands!.find(c => c.name === 'status')!;
  await status.action!({ args: [], flags: {}, cwd: workspace, interactive: false } as unknown as CommandContext);
  return lines.join('\n');
}

describe('daemon status TTL (#4238)', () => {
  it('reports TTL off when the running background daemon has ttlMs 0', async () => {
    const box = await statusBoxFor({ ttlMs: 0 });
    expect(box).toContain('off (runs until stopped)');
    expect(box).not.toContain('(self-shutdown)');
  });

  it('reports the background daemon TTL rather than the 12h default', async () => {
    expect(await statusBoxFor({ ttlMs: 2 * 3600000 })).toContain('TTL: 2h (self-shutdown)');
  });
});
