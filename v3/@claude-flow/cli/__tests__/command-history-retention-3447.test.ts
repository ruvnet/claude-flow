import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({ store: vi.fn(), call: vi.fn() }));
vi.mock('../src/mcp-client.js', () => ({ callMCPTool: mocks.call, MCPClientError: class extends Error {} }));
vi.mock('../src/memory/memory-bridge.js', () => ({ bridgeStoreEntry: mocks.store }));
vi.mock('../src/memory/intelligence.js', () => ({
  getIntelligenceStats: () => ({ trajectoriesRecorded: 0 }),
  recordTrajectory: vi.fn(async () => {}),
}));
import { hooksPostCommand } from '../src/mcp-tools/hooks-tools.js';
import { hooksCommand } from '../src/commands/hooks.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-command-history-'));
  vi.stubEnv('CLAUDE_FLOW_CWD', dir);
  mocks.store.mockReset().mockResolvedValue({ success: true, id: 'stored' });
  mocks.call.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe('command history retention and outcomes (#3447)', () => {
  it('bounds raw telemetry lifetime and skips unused command embeddings', async () => {
    await hooksPostCommand.handler({ command: 'npm test' });
    expect(mocks.store).toHaveBeenCalledWith(expect.objectContaining({
      ttl: 30 * 24 * 60 * 60, generateEmbeddingFlag: false,
    }));
  });

  it('honors an explicit failure even when the CLI supplies its default exit code', async () => {
    const result: any = await hooksPostCommand.handler({ command: 'npm test', success: false, exitCode: 0, ttl: 60 });
    expect(result.success).toBe(false);
    expect(mocks.store).toHaveBeenCalledWith(expect.objectContaining({ tags: ['error'], ttl: 60 }));
  });

  it('refuses invalid retention values before writing history', async () => {
    const result: any = await hooksPostCommand.handler({ command: 'npm test', ttl: -1 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/ttl/i);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it.each([null, { success: false, error: 'read-only' }])('uses expiring JSON history when the bridge declines a write (%s)', async (outcome) => {
    mocks.store.mockResolvedValue(outcome);
    const result: any = await hooksPostCommand.handler({ command: 'npm test', ttl: 60 });
    expect(result._storedIn).toBe('json-store');
    const entries = Object.values(JSON.parse(readFileSync(join(dir, '.claude-flow/memory/store.json'), 'utf8')).entries) as any[];
    expect(entries).toHaveLength(1);
    expect(Date.parse(entries[0].expiresAt)).toBeGreaterThan(Date.now());
  });

  it('reclaims expired command fallback rows without deleting other namespaces', async () => {
    mocks.store.mockResolvedValue(null);
    const memoryDir = join(dir, '.claude-flow/memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'store.json'), JSON.stringify({ version: '3.0.0', entries: {
      old: { namespace: 'commands', expiresAt: '2000-01-01T00:00:00Z' },
      keep: { namespace: 'patterns', expiresAt: '2000-01-01T00:00:00Z' },
    } }));
    await hooksPostCommand.handler({ command: 'npm test' });
    const store = JSON.parse(readFileSync(join(memoryDir, 'store.json'), 'utf8'));
    expect(store.entries.old).toBeUndefined();
    expect(store.entries.keep).toBeDefined();
  });

  it('forwards CLI retention and returns nonzero when no backend records the outcome', async () => {
    mocks.call.mockResolvedValue({ recorded: false, success: false });
    const postCommand = hooksCommand.subcommands!.find(c => c.name === 'post-command')!;
    const result = await postCommand.action!({ args: [], flags: { command: 'npm test', ttl: 120, success: false, format: 'json' } } as any);
    expect(mocks.call).toHaveBeenCalledWith('hooks_post-command', expect.objectContaining({ ttl: 120, success: false }));
    expect(result).toMatchObject({ success: false, exitCode: 1 });
  });
});
