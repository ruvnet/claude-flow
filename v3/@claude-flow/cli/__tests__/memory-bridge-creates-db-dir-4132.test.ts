/**
 * #4132: in a project without `.swarm/` (any fresh git worktree) the bridge
 * opened AgentDB at `<cwd>/.swarm/agentdb-memory.db` without creating the
 * directory. better-sqlite3 refuses a missing parent, AgentDB was marked
 * unavailable, the degraded registry was cached, and hierarchical memory ran
 * on the volatile fallback while every store reported success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

class DirectoryCheckingRegistry {
  // Mirrors better-sqlite3: opening a file in a missing directory fails.
  async initialize(options: { dbPath: string }) {
    if (!existsSync(dirname(options.dbPath))) throw new Error('Cannot open database because the directory does not exist');
  }
  get() { return null; }
  getAgentDB() { return null; }
  async shutdown() {}
}

vi.mock('../src/memory/intelligence.js', () => ({
  initializeIntelligence: vi.fn(async () => ({ reasoningBankEnabled: false, sonaEnabled: false })),
}));

const bridge = await import('../src/memory/memory-bridge.js');

let root: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-bridge-4132-')));
  bridge._resetRegistryCacheForTest();
  bridge.__setMemoryBridgeRegistryFactoryForTests(() => new DirectoryCheckingRegistry());
});
afterEach(async () => {
  await bridge.shutdownBridge();
  rmSync(root, { recursive: true, force: true });
});

describe('#4132 the bridge creates the AgentDB directory before opening it', () => {
  it('restores console.log when directory creation fails', async () => {
    const parent = join(root, 'not-a-directory');
    writeFileSync(parent, 'fixture');
    const originalLog = console.log;
    try {
      expect(await bridge.getControllerRegistry(join(parent, 'agentdb-memory.db'))).toBeNull();
      expect(bridge.getBridgeFailureReason(join(parent, 'agentdb-memory.db'))).toBeTruthy();
      expect(console.log).toBe(originalLog);
    } finally { console.log = originalLog; }
  });

  it('opens a database whose .swarm directory does not exist yet', async () => {
    const db = join(root, 'fresh-worktree', '.swarm', 'agentdb-memory.db');
    expect(existsSync(dirname(db))).toBe(false);
    expect(await bridge.getControllerRegistry(db)).not.toBeNull();
    expect(bridge.getBridgeFailureReason(db)).toBeNull();
    expect(existsSync(dirname(db))).toBe(true);
  });
});
