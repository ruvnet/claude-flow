import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bridgeSessionEnd = vi.fn();
const shutdownBridge = vi.fn();

vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeSessionEnd,
  shutdownBridge,
}));

import { hooksSessionEnd } from '../src/mcp-tools/hooks-tools.js';

describe('hooks session-end native resource cleanup (#2691)', () => {
  let workdir: string;
  let previousCwd: string | undefined;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ruflo-2691-'));
    previousCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = workdir;
    const sessionDir = join(workdir, '.claude-flow', 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'current.json'), JSON.stringify({
      id: 'session-cleanup-test',
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      metrics: { edits: 0, commands: 0, tasks: 0, errors: 0 },
    }));
    bridgeSessionEnd.mockReset();
    shutdownBridge.mockReset();
    bridgeSessionEnd.mockResolvedValue({ controller: 'test', persisted: true });
    shutdownBridge.mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
    if (previousCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = previousCwd;
  });

  it('shuts down the memory bridge after persisting a session', async () => {
    const result = await hooksSessionEnd.handler({ saveState: false, stopDaemon: false });

    expect(bridgeSessionEnd).toHaveBeenCalledOnce();
    expect(shutdownBridge).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      sessionPersistence: { controller: 'test', persisted: true },
    });
  });

  it('still shuts down a partially initialized bridge when persistence fails', async () => {
    bridgeSessionEnd.mockRejectedValueOnce(new Error('native initialization failed'));

    const result = await hooksSessionEnd.handler({ saveState: false, stopDaemon: false });

    expect(shutdownBridge).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      sessionPersistence: { controller: 'none', persisted: false },
    });
  });
});
