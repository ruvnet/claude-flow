import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { backupCommand } from '../src/commands/memory-backup.js';
import { configCommand } from '../src/commands/config.js';
import { configManager } from '../src/services/config-file-manager.js';
import { CommandParser } from '../src/parser.js';
import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { getMemoryRoot, _resetMemoryRootCache } from '../src/memory/memory-initializer.js';

let root: string;
let configured: string;
function seed(dir: string, name: string, key: string): void {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, name));
  try {
    db.exec('CREATE TABLE memory_entries(key TEXT PRIMARY KEY, content TEXT)');
    db.prepare('INSERT INTO memory_entries VALUES (?, ?)').run(key, 'owned native backup fixture');
  } finally { db.close(); }
}
function keys(dir: string): string[] {
  return readdirSync(dir).filter(name => name.endsWith('.db')).flatMap(name => {
    const db = new Database(join(dir, name), { readonly: true });
    try { return (db.prepare('SELECT key FROM memory_entries').all() as Array<{ key: string }>).map(row => row.key); }
    finally { db.close(); }
  }).sort();
}
async function backup(...args: string[]) {
  const parser = new CommandParser();
  parser.registerCommand(backupCommand);
  const parsed = parser.parse(['backup', ...args]);
  expect(parser.validateFlags(parsed.flags, backupCommand)).toEqual([]);
  return backupCommand.action!({ cwd: root, args: parsed.positional, flags: parsed.flags, interactive: false });
}
async function configure(location: string, key: string): Promise<void> {
  if (location.startsWith('.claude-flow')) mkdirSync(join(root, '.claude-flow'), { recursive: true });
  writeFileSync(join(root, location), '{}');
  configManager.load(root);
  const parser = new CommandParser();
  parser.registerCommand(configCommand);
  const set = configCommand.subcommands!.find(command => command.name === 'set')!;
  const parsed = parser.parse(['config', 'set', key, 'configured-memory']);
  expect(parser.validateFlags(parsed.flags, set)).toEqual([]);
  expect((await set.action!({ cwd: root, args: parsed.positional, flags: parsed.flags, interactive: false }))?.success).toBe(true);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-project-backup-'));
  configured = join(root, 'configured-memory');
  vi.stubEnv('CLAUDE_FLOW_CONFIG', '');
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', '');
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', '');
  vi.stubEnv('RUFLO_BACKUP_GCS', '');
  vi.stubEnv('RUFLO_BACKUP_KEEP', '');
  _resetMemoryRootCache();
  seed(join(root, '.swarm'), 'memory.db', 'default-cli');
  seed(join(root, '.swarm'), 'agentdb-memory.db', 'default-mcp');
  seed(configured, 'memory.db', 'configured-cli');
  seed(configured, 'agentdb-memory.db', 'configured-mcp');
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetMemoryRootCache();
  rmSync(root, { recursive: true, force: true });
});
it('default CLI snapshots both active sibling stores', async () => {
  expect((await backup())?.success).toBe(true);
  expect(keys(join(root, '.swarm', 'backups'))).toEqual(['default-cli', 'default-mcp']);
});
it('explicit --db retains one source even when DB environment overrides are set', async () => {
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', join(root, '.swarm', 'memory.db'));
  expect((await backup('--db', join(configured, 'agentdb-memory.db')))?.success).toBe(true);
  expect(keys(join(configured, 'backups'))).toEqual(['configured-mcp']);
});
it.each([
  ['claude-flow.config.json', 'memory.persistPath'],
  ['.claude-flow/config.json', 'memory.path'],
])('uses actual CLI-produced %s %s with relative paths', async (location, key) => {
  await configure(location, key);
  expect((await backup())?.success).toBe(true);
  expect(keys(join(configured, 'backups'))).toEqual(['configured-cli', 'configured-mcp']);
});
it('directory environment override takes precedence over the CLI config', async () => {
  await configure('claude-flow.config.json', 'memory.persistPath');
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', join(root, '.swarm'));
  expect((await backup())?.success).toBe(true);
  expect(keys(join(root, '.swarm', 'backups'))).toEqual(['default-cli', 'default-mcp']);
});
it('full-file DB environment override selects only that source', async () => {
  await configure('claude-flow.config.json', 'memory.persistPath');
  seed(configured, 'cli-override.db', 'override-cli');
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', join(configured, 'cli-override.db'));
  expect((await backup())?.success).toBe(true);
  expect(keys(join(configured, 'backups'))).toEqual(['override-cli']);
});
it('a same-basename DB override stays single-store in an explicit shared destination', async () => {
  seed(join(root, 'outside'), 'agentdb-memory.db', 'outside-override');
  vi.stubEnv('CLAUDE_FLOW_DB_PATH', join(root, 'outside', 'agentdb-memory.db'));
  const dir = join(root, 'shared-backups');
  expect((await backup('--dir', dir))?.success).toBe(true);
  expect(keys(dir)).toEqual(['outside-override']);
  expect(keys(configured)).toEqual(['configured-cli', 'configured-mcp']);
});
it('both default stores retain separate snapshot sets in an explicit shared destination', async () => {
  const dir = join(root, 'shared-backups');
  const result = await backup('--dir', dir, '--keep', '1');
  expect(result?.success).toBe(true);
  expect(keys(dir)).toEqual(['default-cli', 'default-mcp']);
});
it.each([false, true])('public daemon trigger snapshots the active pair (configured=%s)', async useConfig => {
  if (useConfig) await configure('claude-flow.config.json', 'memory.persistPath');
  const daemon = new WorkerDaemon(root, { aiWorkersEnabled: false });
  try {
    const result = await daemon.triggerWorker('backup');
    expect(result.success).toBe(true);
    const dir = useConfig ? configured : join(root, '.swarm');
    expect(keys(join(dir, 'backups'))).toEqual(useConfig ? ['configured-cli', 'configured-mcp'] : ['default-cli', 'default-mcp']);
    const metrics = JSON.parse(readFileSync(join(root, '.claude-flow', 'metrics', 'backup.json'), 'utf8'));
    expect(metrics.backedUp).toBe(true);
    expect(metrics.backups.filter((receipt: { backedUp: boolean }) => receipt.backedUp)).toHaveLength(2);
  } finally { await daemon.stop(); }
});
it('an absent primary does not hide an existing AgentDB store', async () => {
  rmSync(join(root, '.swarm', 'memory.db'));
  expect((await backup())?.success).toBe(true);
  expect(keys(join(root, '.swarm', 'backups'))).toEqual(['default-mcp']);
});
it('absent sibling and entirely absent stores retain benign no-db behavior', async () => {
  rmSync(join(root, '.swarm', 'agentdb-memory.db'));
  expect((await backup())?.success).toBe(true);
  expect(keys(join(root, '.swarm', 'backups'))).toEqual(['default-cli']);
  rmSync(join(root, '.swarm', 'memory.db'));
  const result = await backup();
  expect(result?.success).toBe(true);
  expect(result?.data).toMatchObject({ backedUp: false, skipped: 'no-db' });
});
it('a present unbackuppable sibling fails the aggregate while retaining successful receipts', async () => {
  rmSync(join(root, '.swarm', 'agentdb-memory.db'));
  mkdirSync(join(root, '.swarm', 'agentdb-memory.db'));
  const result = await backup();
  expect(result?.success).toBe(false);
  expect(result?.data).toMatchObject({ backedUp: false });
  const receipts = (result?.data as { backups: Array<{ dbPath: string; backedUp: boolean }> }).backups;
  expect(receipts).toEqual(expect.arrayContaining([
    expect.objectContaining({ dbPath: join(root, '.swarm', 'memory.db'), backedUp: true }),
    expect.objectContaining({ dbPath: join(root, '.swarm', 'agentdb-memory.db'), backedUp: false }),
  ]));
});
it('canonical cached root and reset preserve their existing environment semantics', () => {
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', configured);
  expect(getMemoryRoot()).toBe(configured);
  vi.stubEnv('CLAUDE_FLOW_MEMORY_PATH', join(root, '.swarm'));
  expect(getMemoryRoot()).toBe(configured);
  _resetMemoryRootCache();
  expect(getMemoryRoot()).toBe(join(root, '.swarm'));
});
