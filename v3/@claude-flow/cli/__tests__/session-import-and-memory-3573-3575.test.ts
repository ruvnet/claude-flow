/**
 * #3575: `session import` could never succeed — the CLI passed a parsed `data`
 * object to session_import, which required `inputPath`, then printed
 * "Session imported" and crashed reading the error result.
 *
 * #3573: `session save --include-memory` defaulted to true but captured nothing,
 * because it read only the pre-SQLite `.claude-flow/memory/store.json`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
// Route CLI calls straight to the real session tool handlers (no policy layer).
vi.mock('../src/mcp-client.js', async () => {
  const { sessionTools } = await import('../src/mcp-tools/session-tools.js');
  class MCPClientError extends Error {}
  return {
    MCPClientError,
    callMCPTool: async (name: string, input: Record<string, unknown>) =>
      sessionTools.find(t => t.name === name)!.handler(input),
  };
});

import { output } from '../src/output.js';
import { sessionCommand } from '../src/commands/session.js';
import { sessionTools } from '../src/mcp-tools/session-tools.js';
import {
  _resetMemoryRootCache, initializeMemoryDatabase, storeEntry, listEntries, purgeNamespace,
} from '../src/memory/memory-initializer.js';

const tool = (name: string, input: Record<string, unknown>): Promise<any> =>
  sessionTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const sub = (name: string) => sessionCommand.subcommands!.find(c => c.name === name)!;
const run = (name: string, args: string[], flags: Record<string, unknown> = {}) =>
  sub(name).action!({ args, flags, cwd: state.cwd, interactive: false } as never) as Promise<any>;

let spinner: { succeed: ReturnType<typeof vi.fn>; fail: ReturnType<typeof vi.fn> };
let printed: { success: string[]; error: string[]; tables: any[] };

beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-session-3575-'));
  const memDir = join(state.cwd, '.swarm');
  mkdirSync(memDir, { recursive: true });
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', memDir);
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  vi.stubEnv('CLAUDE_FLOW_DISABLE_BRIDGE', '1');
  vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '0');
  _resetMemoryRootCache();
  mkdirSync(join(state.cwd, '.claude-flow', 'agents'), { recursive: true });
  writeFileSync(join(state.cwd, '.claude-flow', 'agents', 'store.json'),
    JSON.stringify({ agents: { a1: { agentId: 'a1' }, a2: { agentId: 'a2' } } }));

  spinner = { succeed: vi.fn(), fail: vi.fn() };
  printed = { success: [], error: [], tables: [] };
  vi.spyOn(output, 'createSpinner').mockReturnValue({ start: vi.fn(), stop: vi.fn(), ...spinner } as never);
  vi.spyOn(output, 'printSuccess').mockImplementation((m: string) => { printed.success.push(m); });
  vi.spyOn(output, 'printError').mockImplementation((m: string) => { printed.error.push(m); });
  vi.spyOn(output, 'printTable').mockImplementation((t: any) => { printed.tables.push(t); });
  for (const quiet of ['writeln', 'printInfo', 'printWarning', 'printJson'] as const) {
    vi.spyOn(output, quiet).mockImplementation(() => undefined as never);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  _resetMemoryRootCache();
  rmSync(state.cwd, { recursive: true, force: true });
});

describe('#3575 session import', () => {
  it('round-trips export -> import and the imported session is listed', async () => {
    const saved = await tool('session_save', { name: 'checkpoint', includeAgents: true });
    const file = join(state.cwd, 'backup.json');

    const exported = await run('export', [saved.sessionId], { output: file, format: 'json' });
    expect(exported.success).toBe(true);
    expect(existsSync(file)).toBe(true);

    const imported = await run('import', [file], { name: 'restored-copy' });
    expect(imported.success).toBe(true);
    expect(imported.data.stats.agentsImported).toBe(2);
    expect(spinner.succeed).toHaveBeenCalledWith('Session imported');

    const listed = await tool('session_list', { limit: 50 });
    expect(listed.sessions.map((s: any) => s.name)).toContain('restored-copy');
  });

  it('fails cleanly on a missing file: non-zero exit, no success line', async () => {
    const result = await run('import', [join(state.cwd, 'nope.json')]);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(printed.success).toEqual([]);
  });

  it('fails cleanly on a file that is not a session: no "Session imported", no TypeError', async () => {
    const file = join(state.cwd, 'not-a-session.json');
    writeFileSync(file, JSON.stringify(['not', 'a', 'session']));
    const result = await run('import', [file]);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(spinner.succeed).not.toHaveBeenCalled();
    expect(printed.success).toEqual([]);
    expect(printed.error.join('\n')).not.toMatch(/TypeError/);
    expect(printed.error.join('\n')).toMatch(/Not a session record/);
  });

  it('session_import accepts the record inline as data, not only as a path', async () => {
    const saved = await tool('session_save', { name: 'inline-src', includeAgents: true });
    const record = (await tool('session_export', { sessionId: saved.sessionId })).data;
    const result = await tool('session_import', { data: record, name: 'inline-copy' });
    expect(result.error).toBeUndefined();
    expect(result.stats.agentsImported).toBe(2);
  });

  it('export with no session id refuses (like delete) unless --latest is given', async () => {
    await tool('session_save', { name: 'only-one', includeAgents: true });
    const refused = await run('export', [], { output: join(state.cwd, 'x.json'), format: 'json' });
    expect(refused).toMatchObject({ success: false, exitCode: 1 });
    expect(existsSync(join(state.cwd, 'x.json'))).toBe(false);

    const latest = await run('export', [], { latest: true, output: join(state.cwd, 'y.json'), format: 'json' });
    expect(latest.success).toBe(true);
    expect(existsSync(join(state.cwd, 'y.json'))).toBe(true);
  });
});

describe('#3573 session save includes memory', () => {
  const primary = () => join(state.cwd, '.swarm', 'memory.db');
  const mirror = () => join(state.cwd, '.swarm', 'agentdb-memory.db');
  const all = async (dbPath: string) =>
    (await listEntries({ dbPath, limit: 100, includeContent: true })).entries
      .map(e => `${e.namespace}/${e.key}=${e.content}`).sort();

  beforeEach(async () => {
    expect((await initializeMemoryDatabase({ dbPath: primary(), force: true, migrate: false })).success).toBe(true);
    for (let i = 1; i <= 6; i++) {
      const r = await storeEntry({
        dbPath: primary(), namespace: i <= 3 ? 'alpha' : 'beta', key: `k${i}`, value: `value-${i}`,
        generateEmbeddingFlag: false,
      });
      expect(r.success).toBe(true);
    }
  });

  it('6 entries -> save -> file holds 6 -> wipe -> restore --memory-only -> 6 are back', async () => {
    const before = await all(primary());
    expect(before).toHaveLength(6);

    const saved = await tool('session_save', { name: 'with-memory', includeMemory: true, includeAgents: true });
    expect(saved.stats.memoryEntries).toBe(6);
    expect(saved.memoryCapture).toMatchObject({ requested: true, status: 'captured', entries: 6 });

    const onDisk = JSON.parse(readFileSync(saved.path, 'utf-8'));
    expect(Object.keys(onDisk.data.memory.entries)).toHaveLength(6);
    expect(onDisk.stats.memoryEntries).toBe(6);

    for (const ns of ['alpha', 'beta']) await purgeNamespace({ dbPath: primary(), namespace: ns });
    expect(await all(primary())).toHaveLength(0);

    // `session restore --memory-only`, through the CLI.
    const restored = await run('restore', [saved.sessionId], { 'memory-only': true, force: true });
    expect(restored.success).toBe(true);
    expect(restored.data.memoryRestore).toMatchObject({ restored: 6, failed: 0 });
    expect(await all(primary())).toEqual(before);
  });

  it('captures rows that exist only in the sibling AgentDB store, without duplicating mirrored ones', async () => {
    expect((await initializeMemoryDatabase({ dbPath: mirror(), force: true, migrate: false })).success).toBe(true);
    // One row mirrored in both stores, one written only by the MCP/AgentDB path.
    await storeEntry({ dbPath: mirror(), namespace: 'alpha', key: 'k1', value: 'value-1', generateEmbeddingFlag: false });
    await storeEntry({ dbPath: mirror(), namespace: 'mcp', key: 'agent-note', value: 'from-mcp', generateEmbeddingFlag: false });

    const saved = await tool('session_save', { name: 'both-stores', includeMemory: true });
    expect(saved.memoryCapture).toMatchObject({ entries: 7, sources: { memoryDb: 6, agentdb: 1 } });
    const entries = JSON.parse(readFileSync(saved.path, 'utf-8')).data.memory.entries;
    expect(entries['mcp::agent-note']).toMatchObject({ value: 'from-mcp', source: 'agentdb' });
  });

  it('the save table says "not included" instead of an invented 0 when memory is excluded', async () => {
    const result = await run('save', [], { name: 'no-mem', 'include-memory': false });
    expect(result.success).toBe(true);
    const row = printed.tables[0].data.find((r: any) => r.property === 'Memory Entries');
    expect(row.value).toBe('not included');
  });
});
