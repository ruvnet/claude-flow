import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Row { namespace: string; key: string; content: string }
const state = vi.hoisted(() => ({ cwd: '', primary: [] as Row[], sibling: [] as Row[], restored: [] as object[] }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/memory/memory-initializer.js', () => ({
  resolveDbPath: () => join(state.cwd, '.swarm', 'memory.db'),
  listEntries: async ({ dbPath, offset = 0, limit }: { dbPath: string; offset?: number; limit: number }) => {
    const rows = dbPath === join(state.cwd, '.swarm', 'memory.db') ? state.primary : state.sibling;
    return { success: true, entries: rows.slice(offset, offset + limit), total: rows.length };
  },
  storeEntry: async (entry: object) => { state.restored.push(entry); return { success: true }; },
}));
vi.mock('../src/memory/memory-bridge.js', () => ({
  siblingAgentDbPath: () => join(state.cwd, '.swarm', 'agentdb-memory.db'),
}));

import { sessionTools } from '../src/mcp-tools/session-tools.js';
import { validateIdentifier } from '../src/mcp-tools/validate-input.js';

const tool = (name: string, input: Record<string, unknown>) =>
  sessionTools.find(t => t.name === name)!.handler(input) as Promise<any>;
const sorted = (entries: object) => Object.values(entries)
  .map(({ namespace, key, value }) => ({ namespace, key, value }))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const expected = (rows: Row[]) => sorted(rows.map(({ namespace, key, content }) => ({ namespace, key, value: content })));
const first = { namespace: 'team::alice', key: 'profile', content: 'Alice profile' };
const second = { namespace: 'team', key: 'alice::profile', content: 'Team profile' };

beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-session-key-isolation-'));
  state.primary = [];
  state.sibling = [];
  state.restored = [];
  vi.stubEnv('CLAUDE_FLOW_ENCRYPT_AT_REST', '0');
  mkdirSync(join(state.cwd, '.swarm'));
  // Only memory IO is mocked. The session handlers persist/export/import real files.
  writeFileSync(join(state.cwd, '.swarm', 'memory.db'), 'fixture');
  writeFileSync(join(state.cwd, '.swarm', 'agentdb-memory.db'), 'fixture');
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(state.cwd, { recursive: true, force: true });
});

describe('session memory snapshot namespace/key isolation', () => {
  it('round-trips both legal delimiter-bearing tuples through save, export, import and restore', async () => {
    state.primary = [first, second];
    for (const row of state.primary) {
      expect(validateIdentifier(row.namespace, 'namespace').valid).toBe(true);
      expect(validateIdentifier(row.key, 'key').valid).toBe(true);
    }
    const saved = await tool('session_save', { name: 'tuple checkpoint' });
    expect(saved.memoryCapture).toMatchObject({ status: 'captured', entries: 2, sources: { memoryDb: 2 } });
    expect(saved.stats.memoryEntries).toBe(2);
    const backup = join(state.cwd, 'checkpoint.json');
    const exported = await tool('session_export', { sessionId: saved.sessionId, outputPath: backup });
    expect(exported.data.data.memory.format).toBe('ruflo-session-memory/2');
    expect(sorted(exported.data.data.memory.entries)).toEqual(expected(state.primary));
    expect(JSON.parse(readFileSync(backup, 'utf8'))).toEqual(exported.data);
    const imported = await tool('session_import', { inputPath: backup });
    expect(imported.stats.memoryEntriesImported).toBe(2);
    const restored = await tool('session_restore', { sessionId: imported.sessionId, restoreTasks: false, restoreAgents: false });
    expect(restored.memoryRestore).toMatchObject({ restored: 2, failed: 0 });
    expect(sorted(state.restored)).toEqual(expected(state.primary));
  });

  it('does not deduplicate a distinct sibling tuple, but still prefers the primary for true mirrors', async () => {
    state.primary = [first];
    state.sibling = [{ ...first, content: 'stale mirror' }, second];
    const saved = await tool('session_save', { name: 'both stores' });
    expect(saved.memoryCapture).toMatchObject({ entries: 2, sources: { memoryDb: 1, agentdb: 1 } });
    const record = JSON.parse(readFileSync(saved.path, 'utf8'));
    expect(sorted(record.data.memory.entries)).toEqual(expected([first, second]));
  });

  it('retains ordinary map IDs and keeps the same key in different namespaces', async () => {
    state.primary = [{ namespace: 'alpha', key: 'note', content: 'A' }, { namespace: 'beta', key: 'note', content: 'B' }];
    state.sibling = [{ namespace: 'mcp', key: 'agent-note', content: 'from MCP' }];
    const saved = await tool('session_save', { name: 'ordinary IDs' });
    const entries = JSON.parse(readFileSync(saved.path, 'utf8')).data.memory.entries;
    expect(entries['mcp::agent-note']).toMatchObject({ value: 'from MCP', source: 'agentdb' });
    expect(sorted(entries)).toEqual(expected([...state.primary, ...state.sibling]));
  });

  it.each([
    ['literal escape text', 'team%3Aalice', 'profile', 'team:alice', 'profile'],
    ['literal percent', 'team%alice', 'profile', 'team%25alice', 'profile'],
    ['repeated delimiters', 'team:', ':profile', 'team', '::profile'],
    ['key escape text', 'team', '%3Aprofile', 'team', ':profile'],
    ['unpaired surrogate', 'team\uD800', 'profile', 'team', '\uD800profile'],
  ])('preserves opaque backend row fields containing %s', async (_label, ns1, key1, ns2, key2) => {
    // Existing backend rows may contain characters rejected for new CLI identifiers.
    // Snapshotting must not lose those rows or throw while escaping their IDs.
    state.primary = [{ namespace: ns1, key: key1, content: 'A' }, { namespace: ns2, key: key2, content: 'B' }];
    const saved = await tool('session_save', { name: 'escaping controls' });
    expect(saved.memoryCapture).toMatchObject({ status: 'captured', entries: 2 });
    const entries = JSON.parse(readFileSync(saved.path, 'utf8')).data.memory.entries;
    expect(sorted(entries)).toEqual(expected(state.primary));
  });

  it('still restores older v2 snapshots using explicit row fields, not their raw composite IDs', async () => {
    const imported = await tool('session_import', { data: {
      name: 'old v2', data: { memory: { format: 'ruflo-session-memory/2', entries: {
        'team::alice::profile': { namespace: first.namespace, key: first.key, value: first.content, source: 'memory-db' },
      } } },
    }, activate: true });
    expect(imported.activated).toBe(true);
    expect(sorted(state.restored)).toEqual(expected([first]));
  });

  it('preserves pre-v2 legacy snapshots and restores their explicit fields', async () => {
    const legacy = { entries: { 'old-id': { namespace: 'legacy', key: 'note', content: 'legacy content' } } };
    const imported = await tool('session_import', { data: { name: 'old legacy', data: { memory: legacy } }, activate: true });
    expect(imported.activated).toBe(true);
    expect(sorted(state.restored)).toEqual([{ namespace: 'legacy', key: 'note', value: 'legacy content' }]);
    expect(JSON.parse(readFileSync(join(state.cwd, '.claude-flow', 'memory', 'store.json'), 'utf8'))).toEqual(legacy);
  });

  it('does not overwrite a legacy row whose opaque ID equals an escaped live tuple', async () => {
    state.primary = [first];
    const legacy = { entries: {
      'team%3A%3Aalice::profile': { namespace: 'legacy', key: 'note', value: 'legacy content' },
    } };
    const legacyDir = join(state.cwd, '.claude-flow', 'memory');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'store.json'), JSON.stringify(legacy));
    const saved = await tool('session_save', { name: 'mixed stores' });
    expect(saved.memoryCapture).toMatchObject({ entries: 2, sources: { memoryDb: 1, legacyJson: 1 } });
    const record = JSON.parse(readFileSync(saved.path, 'utf8'));
    expect(record.data.memory.legacy).toEqual(legacy);
    expect(record.data.memory.entries['team%3A%3Aalice::profile']).toEqual(legacy.entries['team%3A%3Aalice::profile']);
    expect(sorted(record.data.memory.entries)).toEqual(sorted([
      { namespace: first.namespace, key: first.key, value: first.content },
      ...Object.values(legacy.entries),
    ]));
  });

  it('restores modern values after legacy values for the same explicit tuple', async () => {
    state.primary = [first];
    const legacy = { entries: { note: { namespace: first.namespace, key: first.key, value: 'legacy value' } } };
    const legacyDir = join(state.cwd, '.claude-flow', 'memory');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'store.json'), JSON.stringify(legacy));
    const saved = await tool('session_save', { name: 'same tuple' });
    // Counts are captured records, not unique semantic tuples across the two formats.
    expect(saved.memoryCapture.entries).toBe(2);
    await tool('session_restore', { sessionId: saved.sessionId });
    expect(state.restored.map((entry: any) => entry.value)).toEqual(['legacy value', first.content]);
    expect(JSON.parse(readFileSync(join(legacyDir, 'store.json'), 'utf8'))).toEqual(legacy);
  });

  it('checks occupied alternate slots without confusing physical IDs with live identities', async () => {
    const canonical = 'team%3A%3Aalice::profile';
    const alternateTuple = { ...first, key: 'profile#2', content: 'distinct tuple at an allocated slot' };
    state.primary = [first, { ...first, content: 'updated primary' }];
    state.sibling = [{ ...first, content: 'stale sibling' }, second, alternateTuple];
    const legacy = { entries: {
      [canonical]: { namespace: 'legacy', key: 'one', value: 'legacy one' },
      [`${canonical}#1`]: { namespace: 'legacy', key: 'two', value: 'legacy two' },
    } };
    const legacyDir = join(state.cwd, '.claude-flow', 'memory');
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, 'store.json'), JSON.stringify(legacy));
    const saved = await tool('session_save', { name: 'occupied slots' });
    expect(saved.memoryCapture).toMatchObject({ entries: 5, sources: { memoryDb: 2, agentdb: 2, legacyJson: 2 } });
    const entries = JSON.parse(readFileSync(saved.path, 'utf8')).data.memory.entries;
    expect(entries[canonical]).toEqual(legacy.entries[canonical]);
    expect(entries[`${canonical}#1`]).toEqual(legacy.entries[`${canonical}#1`]);
    expect(sorted(entries)).toEqual(sorted([
      ...Object.values(legacy.entries),
      { namespace: first.namespace, key: first.key, value: 'updated primary' },
      { namespace: second.namespace, key: second.key, value: second.content },
      { namespace: alternateTuple.namespace, key: alternateTuple.key, value: alternateTuple.content },
    ]));
  });
});
