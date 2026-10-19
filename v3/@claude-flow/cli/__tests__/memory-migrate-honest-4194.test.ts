import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  storeEntry: mocks.store,
  searchEntries: vi.fn(),
  listEntries: vi.fn(),
  getEntry: vi.fn(),
  deleteEntry: vi.fn(),
  initializeMemoryDatabase: vi.fn(),
  checkMemoryInitialization: vi.fn(async () => ({ initialized: true })),
  resolveDbPath: () => '.swarm/memory.db',
  getHNSWStatus: () => ({ algorithm: 'brute-force' }),
}));
import { memoryTools } from '../src/mcp-tools/memory-tools.js';

const migrate = memoryTools.find(t => t.name === 'memory_migrate')!;
const MARKER = '.claude-flow/memory/.migrated-to-sqlite';
let cwd: string;
let dir: string;

beforeEach(() => {
  cwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'memory-migrate-4194-'));
  mkdirSync(join(dir, '.claude-flow/memory'), { recursive: true });
  writeFileSync(join(dir, '.claude-flow/memory/store.json'), JSON.stringify({
    version: '1',
    entries: { a: { key: 'a', value: 'one' }, b: { key: 'b', value: 'two' } },
  }));
  process.chdir(dir);
  mocks.store.mockReset().mockResolvedValue({ success: true });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('memory_migrate reports what it moved (#4194)', () => {
  it('does not claim a migration when the marker already exists', async () => {
    writeFileSync(join(dir, MARKER), '{}');
    const result = await migrate.handler({}) as any;
    expect(result.migrated).toBe(0);
    expect(result.message).not.toBe('Migration completed');
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it('force clears the marker that is actually checked and re-runs', async () => {
    writeFileSync(join(dir, MARKER), '{}');
    const result = await migrate.handler({ force: true }) as any;
    expect(mocks.store).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ success: true, message: 'Migration completed', migrated: 2, total: 2 });
    expect(existsSync(join(dir, MARKER))).toBe(true);
  });

  it('reports the real count when some entries fail', async () => {
    mocks.store.mockImplementation(async (e: { key: string }) => {
      if (e.key === 'b') throw new Error('boom');
      return { success: true };
    });
    const result = await migrate.handler({}) as any;
    expect(result).toMatchObject({ success: true, migrated: 1, total: 2 });
    expect(result.message).toContain('1 of 2');
  });
});
