/**
 * ADR-174 Milestone 2 — `memory distill` CLI surface.
 *
 * Exercises the CLI command family (run|status|config) built on top of the
 * frozen M1 service (`../src/services/memory-distillation.ts`). The service
 * itself is proven by `memory-distillation.test.ts`; this file proves the CLI
 * wiring: flag → DistillOptions mapping, the ADR-172 fail-fast budget gate,
 * the aggressive/conservative presets, and the read-only `status` report.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { Command, CommandContext } from '../src/types.js';
import { distillCommand, resolveDistillConfig } from '../src/commands/memory-distill.js';

let Database: any;
let haveNative = false;
try { Database = (await import('better-sqlite3')).default; haveNative = true; } catch { haveNative = false; }

/** Same fixture shape as __tests__/memory-distillation.test.ts. */
function seedDb(dbPath: string): void {
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
  ins.run('c1', 'k1', 'commands', 'refactor the auth module in src/auth.ts', vec(1));
  ins.run('c2', 'k2', 'commands', 'add validation to src/api/handler.ts', vec(2));
  ins.run('c3', 'k3', 'commands', 'optimize the query in src/db/store.ts', vec(3));
  ins.run('f1', 'k4', 'feedback', JSON.stringify({ taskId: 'edit-a', success: true }), vec(4));
  ins.run('f2', 'k5', 'feedback', JSON.stringify({ taskId: 'edit-b', success: false }), vec(5));
  db.close();
}

function countReasoningPatterns(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  const c = (db.prepare('SELECT COUNT(*) AS c FROM reasoning_patterns').get() as { c: number }).c;
  db.close();
  return c;
}

function makeCtx(flags: Record<string, unknown>, cwd: string): CommandContext {
  return { args: [], flags: { _: [], ...flags }, cwd, interactive: false } as CommandContext;
}

function sub(name: string): Command {
  const cmd = distillCommand.subcommands?.find((c) => c.name === name);
  if (!cmd?.action) throw new Error(`memory distill ${name} has no action`);
  return cmd;
}

describe.skipIf(!haveNative)('memory distill CLI (ADR-174 Milestone 2)', () => {
  let workdir: string;
  beforeAll(() => { workdir = mkdtempSync(join(tmpdir(), 'distill-cli-')); });

  it('registers run, status, and config as subcommands of `memory distill`', () => {
    const names = (distillCommand.subcommands ?? []).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['run', 'status', 'config']));
  });

  it('--dry-run makes no writes', async () => {
    const dbPath = join(workdir, 'dry.db');
    seedDb(dbPath);

    const result = await sub('run').action!(makeCtx({ dryRun: true, db: dbPath }, workdir));

    expect(result?.success).toBe(true);
    const data = result?.data as any;
    expect(data.report.patterns).toBeGreaterThan(0);
    expect(data.report.dryRun).toBe(true);
    expect(countReasoningPatterns(dbPath)).toBe(0); // no writes actually landed
  });

  it('--namespace scopes the run to the requested namespace(s)', async () => {
    const dbPath = join(workdir, 'ns.db');
    seedDb(dbPath);

    const result = await sub('run').action!(makeCtx({ namespace: 'feedback', db: dbPath }, workdir));

    expect(result?.success).toBe(true);
    const data = result?.data as any;
    expect(data.config.namespaces).toEqual(['feedback']);
    expect(data.report.processed).toBe(2); // only the 2 feedback rows
    expect(data.report.byProvenance['proxy:structural']).toBeUndefined();
  });

  it('--judge fable without --budget-usd fails fast (ADR-172 gate)', async () => {
    const dbPath = join(workdir, 'fable.db');
    seedDb(dbPath);

    const result = await sub('run').action!(makeCtx({ judge: 'fable', db: dbPath }, workdir));

    expect(result?.success).toBe(false);
    expect(result?.exitCode).toBe(1);
    expect(countReasoningPatterns(dbPath)).toBe(0); // refused before calling the service
  });

  it('--judge fable with --budget-usd > 0 passes the gate (service still reserves the tier)', async () => {
    const dbPath = join(workdir, 'fable-funded.db');
    seedDb(dbPath);

    const result = await sub('run').action!(makeCtx({ judge: 'fable', budgetUsd: 2, db: dbPath }, workdir));

    expect(result?.success).toBe(true);
    const data = result?.data as any;
    // The M1 service reserves judge:fable (ADR-172, not enabled here) — CLI must
    // surface that as a skip, not silently fall back to structural.
    expect(data.report.skipped).toContain('judge:fable');
  });

  it('--aggressive preset maps to dedup-distance 0.3 / batch-size 500', () => {
    const resolved = resolveDistillConfig(makeCtx({ aggressive: true }, workdir));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.config.dedupDistance).toBe(0.3);
      expect(resolved.config.batchSize).toBe(500);
    }
  });

  it('--conservative preset maps to dedup-distance 0.1 / batch-size 100', () => {
    const resolved = resolveDistillConfig(makeCtx({ conservative: true }, workdir));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.config.dedupDistance).toBe(0.1);
      expect(resolved.config.batchSize).toBe(100);
    }
  });

  it('rejects --aggressive and --conservative together', () => {
    const resolved = resolveDistillConfig(makeCtx({ aggressive: true, conservative: true }, workdir));
    expect(resolved.ok).toBe(false);
  });

  it('explicit --batch-size overrides the --aggressive preset', () => {
    const resolved = resolveDistillConfig(makeCtx({ aggressive: true, batchSize: 42 }, workdir));
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.config.batchSize).toBe(42);
      expect(resolved.config.dedupDistance).toBe(0.3); // untouched preset value
    }
  });

  it('`config` prints the effective merged config as JSON-serializable data', async () => {
    const result = await sub('config').action!(makeCtx({ aggressive: true, db: '/tmp/nonexistent.db' }, workdir));
    expect(result?.success).toBe(true);
    const data = result?.data as any;
    expect(data.dedupDistance).toBe(0.3);
    expect(data.batchSize).toBe(500);
    expect(data.dbPath).toBe('/tmp/nonexistent.db');
  });

  it('`status` reports table counts, cursor, and the promote-gate breakdown after a run', async () => {
    const dbPath = join(workdir, 'status.db');
    seedDb(dbPath);

    const runResult = await sub('run').action!(makeCtx({ db: dbPath }, workdir));
    expect(runResult?.success).toBe(true);

    const statusResult = await sub('status').action!(makeCtx({ db: dbPath }, workdir));
    expect(statusResult?.success).toBe(true);
    const data = statusResult?.data as any;

    expect(data.available).toBe(true);
    expect(data.counts.reasoning_patterns).toBeGreaterThan(0);
    expect(data.counts.episodes).toBeGreaterThan(0);
    expect(data.counts.pattern_embeddings).toBeGreaterThan(0);
    expect(data.promoted).toBeGreaterThan(0); // feedback rows promote (ADR-171)
    expect(data.proxy).toBeGreaterThan(0); // commands rows never promote
    expect(data.cursors.length).toBeGreaterThan(0);
  });

  it('`status` degrades gracefully when no DB exists at the path', async () => {
    const result = await sub('status').action!(makeCtx({ db: join(workdir, 'does-not-exist.db') }, workdir));
    expect(result?.success).toBe(true);
    const data = result?.data as any;
    expect(data.available).toBe(false);
    expect(data.reason).toBe('no-db');
  });
});
