/**
 * #3446: distillation must cover the store the MCP bridge actually writes.
 *
 * `memory.db` and `agentdb-memory.db` are separate stores. Before this fix,
 * `memory distill run` and the daemon's consolidate worker only opened
 * memory.db. In an MCP-only project that file often has no AgentDB target
 * tables, so every tick skipped while the rows accumulated in the sibling.
 *
 * The pure tests exercise the multi-store orchestration without requiring a
 * native SQLite build; the CLI test runs the real service when better-sqlite3
 * is available.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Command, CommandContext } from '../src/types.js';
import {
  aggregateDistillReports,
  projectMemoryDbPaths,
  runDistillationForStores,
  type DistillReport,
} from '../src/services/memory-distillation.js';
import { distillCommand } from '../src/commands/memory-distill.js';

let Database: any;
let haveNative = false;
try {
  Database = (await import('better-sqlite3')).default;
  // The package can resolve while its native binary is missing; probe the
  // constructor so the native-only cases skip cleanly on a source-only host.
  const probe = new Database(':memory:');
  probe.close();
  haveNative = true;
} catch { haveNative = false; }

function report(extra: Partial<DistillReport> = {}): DistillReport {
  return {
    processed: 0, episodes: 0, episodeEmbeddings: 0, patterns: 0,
    patternEmbeddings: 0, causalEdges: 0, promoted: 0, byProvenance: {},
    namespaces: [], dryRun: false, spendUsd: 0, ...extra,
  };
}

function makeCtx(flags: Record<string, unknown>, cwd: string): CommandContext {
  return { args: [], flags: { _: [], ...flags }, cwd, interactive: false } as CommandContext;
}

function sub(name: string): Command {
  const cmd = distillCommand.subcommands?.find((c) => c.name === name);
  if (!cmd?.action) throw new Error(`memory distill ${name} has no action`);
  return cmd;
}

/** Source rows plus the AgentDB target tables. */
function seedAgentStore(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT DEFAULT 'default',
    content TEXT, embedding TEXT, status TEXT DEFAULT 'active'
  )`);
  db.exec(`CREATE TABLE episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER DEFAULT 0, session_id TEXT NOT NULL,
    task TEXT NOT NULL, input TEXT, output TEXT, critique TEXT, reward REAL DEFAULT 0,
    success BOOLEAN DEFAULT 0, latency_ms INTEGER, tokens_used INTEGER, tags TEXT,
    metadata JSON, created_at INTEGER DEFAULT 0
  )`);
  db.exec(`CREATE TABLE reasoning_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER DEFAULT 0, task_type TEXT NOT NULL,
    approach TEXT NOT NULL, success_rate REAL NOT NULL DEFAULT 0, uses INTEGER DEFAULT 0,
    avg_reward REAL DEFAULT 0, tags TEXT, metadata TEXT
  )`);
  db.exec(`CREATE TABLE pattern_embeddings (
    pattern_id INTEGER PRIMARY KEY, embedding BLOB NOT NULL
  )`);
  db.exec(`CREATE TABLE causal_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT, from_memory_id INTEGER NOT NULL, from_memory_type TEXT NOT NULL,
    to_memory_id INTEGER NOT NULL, to_memory_type TEXT NOT NULL, similarity REAL DEFAULT 0,
    confidence REAL DEFAULT 0.5, mechanism TEXT, metadata JSON, created_at INTEGER DEFAULT 0
  )`);
  const ins = db.prepare('INSERT INTO memory_entries (id, key, namespace, content, embedding) VALUES (?,?,?,?,?)');
  const vec = (seed: number) => JSON.stringify(Array.from({ length: 8 }, (_, i) => Math.sin(seed + i)));
  ins.run('a1', 'k1', 'commands', 'refactor the auth module in src/auth.ts', vec(1));
  ins.run('a2', 'k2', 'feedback', JSON.stringify({ taskId: 'edit-a', success: true }), vec(2));
  db.close();
}

/** The CLI-only store: source rows but no AgentDB target tables. */
function seedCliStore(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE memory_entries (
    id TEXT PRIMARY KEY, key TEXT, namespace TEXT DEFAULT 'default',
    content TEXT, embedding TEXT, status TEXT DEFAULT 'active'
  )`);
  db.prepare('INSERT INTO memory_entries (id, key, namespace, content, embedding) VALUES (?,?,?,?,?)')
    .run('c1', 'k3', 'commands', 'unrelated CLI-only row', JSON.stringify([1, 2, 3]));
  db.close();
}

function patternCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  const c = (db.prepare('SELECT COUNT(*) AS c FROM reasoning_patterns').get() as { c: number }).c;
  db.close();
  return c;
}

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'distill-3446-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('#3446 multi-store distillation orchestration', () => {
  it('resolves both stores under the same memory root', () => {
    const dir = tempDir();
    const prev = process.env.CLAUDE_FLOW_MEMORY_PATH;
    try {
      process.env.CLAUDE_FLOW_MEMORY_PATH = join(dir, 'state');
      expect(projectMemoryDbPaths(dir)).toEqual([
        join(dir, 'state', 'memory.db'),
        join(dir, 'state', 'agentdb-memory.db'),
      ]);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_FLOW_MEMORY_PATH;
      else process.env.CLAUDE_FLOW_MEMORY_PATH = prev;
    }
  });

  it('honors an explicit CLAUDE_FLOW_DB_PATH as a single-store pin', () => {
    const dir = tempDir();
    const prev = process.env.CLAUDE_FLOW_DB_PATH;
    try {
      process.env.CLAUDE_FLOW_DB_PATH = join('.custom', 'pinned.db');
      expect(projectMemoryDbPaths(dir)).toEqual([join(dir, '.custom', 'pinned.db')]);
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_FLOW_DB_PATH;
      else process.env.CLAUDE_FLOW_DB_PATH = prev;
    }
  });

  it('aggregates per-store counts and only reports skipped when every store skipped', () => {
    const stores = [
      { dbPath: 'memory.db', report: report({ processed: 2, patterns: 1, namespaces: ['commands'] }) },
      { dbPath: 'agentdb-memory.db', report: report({ processed: 3, patterns: 2, skipped: 'target table episodes missing' }) },
    ];
    const merged = aggregateDistillReports(stores);
    expect(merged.processed).toBe(5);
    expect(merged.patterns).toBe(3);
    expect(merged.namespaces).toEqual(['commands']);
    expect(merged.skipped).toBeUndefined();

    const allSkipped = aggregateDistillReports([
      { dbPath: 'a', report: report({ skipped: 'no-db' }) },
      { dbPath: 'b', report: report({ skipped: 'no memory_entries' }) },
    ]);
    expect(allSkipped.skipped).toContain('no-db');
    expect(allSkipped.skipped).toContain('no memory_entries');
  });

  it('invokes the runner once per resolved store and preserves partial failure', async () => {
    const seen: string[] = [];
    const result = await runDistillationForStores(
      ['/tmp/a.db', '/tmp/b.db', '/tmp/a.db'],
      { dryRun: true },
      async ({ dbPath }) => {
        seen.push(dbPath);
        if (dbPath.endsWith('b.db')) throw new Error('boom');
        return report({ processed: 1, dryRun: true });
      },
    );

    expect(seen).toHaveLength(2);
    expect(result.stores).toHaveLength(2);
    expect(result.report.processed).toBe(1);
    expect(result.report.skipped).toBeUndefined();
    expect(result.stores[1].report.skipped).toContain('boom');
  });
});

describe.skipIf(!haveNative)('#3446 CLI covers both stores without --db', () => {
  it('distills the AgentDB sibling and reports the CLI store skip', async () => {
    const dir = tempDir();
    mkdirSync(join(dir, '.swarm'), { recursive: true });
    const cliStore = join(dir, '.swarm', 'memory.db');
    const agentStore = join(dir, '.swarm', 'agentdb-memory.db');
    seedCliStore(cliStore);
    seedAgentStore(agentStore);

    const result = await sub('run').action!(makeCtx({}, dir));
    expect(result?.success).toBe(true);
    const data = result?.data as any;

    expect(data.dbPaths).toEqual([cliStore, agentStore]);
    expect(data.stores).toHaveLength(2);
    expect(data.report.patterns).toBeGreaterThan(0);
    expect(patternCount(agentStore)).toBeGreaterThan(0);
    expect(data.stores.find((s: any) => s.dbPath === cliStore)?.report.skipped)
      .toContain('target table');
  });

  it('an explicit --db remains a single-store operation', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'only.db');
    seedAgentStore(dbPath);

    const result = await sub('run').action!(makeCtx({ db: dbPath }, dir));
    const data = result?.data as any;
    expect(data.dbPaths).toEqual([dbPath]);
    expect(data.stores).toHaveLength(1);
    expect(patternCount(dbPath)).toBeGreaterThan(0);
  });
});
