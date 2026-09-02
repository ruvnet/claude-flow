/**
 * Regression for ruvnet/ruflo#3155.
 *
 * `initializeMemoryDatabase()` used to pass its just-resolved sql.js-facing
 * `memory.db` path straight through to `activateControllerRegistry()` ->
 * `bridge.getControllerRegistry(dbPath)`. That seeded the process-wide
 * ControllerRegistry singleton with `memory.db` as AgentDB's own native
 * better-sqlite3 database, instead of the dedicated `agentdb-memory.db`
 * sibling `getAgentDbPath()` exists specifically to provide (#2786).
 *
 * Because this activation only runs on a database's FIRST-EVER init (an
 * already-initialized `.swarm/` skips it via the #1791.6 idempotent no-op
 * branch), a bridge started against a brand-new directory would activate
 * against `memory.db` and work fine for that process's lifetime — then a
 * restarted bridge process, whose `.swarm/memory.db` already exists, would
 * skip this call entirely and have its first real bridge operation activate
 * the registry against `agentdb-memory.db` instead (via the `dbPath ||
 * getAgentDbPath()` fallback in memory-bridge.ts). That empty file never
 * received the earlier writes, so every read after a restart silently came
 * back `found:false` / an empty list, with no error anywhere.
 *
 * The fix: `activateControllerRegistry()` no longer forwards the sql.js
 * `dbPath` to the bridge at all — it calls `bridge.getControllerRegistry()`
 * with no argument, so both the init-time warm-up and every later bridge
 * call (bridgeStoreEntry, bridgeGetEntry, ...) resolve the SAME file via
 * `getAgentDbPath()`, regardless of whether this is a fresh directory or a
 * restart against an already-initialized one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getControllerRegistry = vi.fn(async (_dbPath?: string) => null);
const shutdownBridge = vi.fn(async () => {});

vi.mock('../src/memory/memory-bridge.js', () => ({
  getControllerRegistry,
  shutdownBridge,
}));

import { initializeMemoryDatabase } from '../src/memory/memory-initializer.js';

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'memory-init-bridge-dbpath-3155-'));
  getControllerRegistry.mockClear();
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('initializeMemoryDatabase -> ControllerRegistry activation (#3155)', () => {
  it('activates the bridge registry with NO dbPath on a fresh directory (sql.js path)', async () => {
    const dbPath = join(testDir, 'memory.db');

    const result = await initializeMemoryDatabase({
      backend: 'sqlite',
      dbPath,
      force: true,
      migrate: false,
    });

    expect(result.success).toBe(true);
    expect(existsSync(dbPath)).toBe(true);

    // The regression: this used to be called with `dbPath` (the sql.js
    // file just written above) — the bridge's own dedicated file must be
    // resolved independently, so no dbPath is forwarded here at all.
    expect(getControllerRegistry).toHaveBeenCalledTimes(1);
    expect(getControllerRegistry).toHaveBeenCalledWith();
    const [calledArg] = getControllerRegistry.mock.calls[0]!;
    expect(calledArg).toBeUndefined();
    expect(calledArg).not.toBe(dbPath);
  });

  it('activates the bridge registry with NO dbPath on the schema-file fallback path', async () => {
    // Force the sql.js import to fail so initializeMemoryDatabase takes the
    // "fall back to schema file approach" branch (the second call site).
    vi.doMock('sql.js', () => {
      throw new Error('sql.js unavailable in this simulated environment');
    });
    vi.resetModules();
    getControllerRegistry.mockClear();

    vi.doMock('../src/memory/memory-bridge.js', () => ({
      getControllerRegistry,
      shutdownBridge,
    }));

    const { initializeMemoryDatabase: initFallback } = await import('../src/memory/memory-initializer.js');
    const dbPath = join(testDir, 'fallback', 'memory.db');

    const result = await initFallback({
      backend: 'sqlite',
      dbPath,
      force: true,
      migrate: false,
    });

    expect(result.success).toBe(true);
    expect(existsSync(dbPath)).toBe(true);
    expect(getControllerRegistry).toHaveBeenCalledTimes(1);
    const [calledArg] = getControllerRegistry.mock.calls[0]!;
    expect(calledArg).toBeUndefined();
    expect(calledArg).not.toBe(dbPath);

    vi.doUnmock('sql.js');
    vi.resetModules();
  });
});
