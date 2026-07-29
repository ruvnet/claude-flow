/**
 * Regression guard for #2677's unreachable Reflexion substrate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { doctorCommand } from '../src/commands/doctor.js';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';

type HealthCheck = { name: string; status: 'pass' | 'warn' | 'fail'; message: string };
type DoctorData = { results: HealthCheck[] };

const ORIGINAL_CWD = process.cwd();
let workdir: string;

async function runMemoryDoctor(): Promise<HealthCheck[]> {
  const ctx = {
    flags: { component: 'memory' },
    args: [],
    config: {},
  } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];
  const result = await doctorCommand.action!(ctx);
  return (result.data as DoctorData).results;
}

function find(results: HealthCheck[], name: string): HealthCheck | undefined {
  return results.find((result) => result.name === name);
}

async function seed(includeEmbedding: boolean, includeCritique: boolean): Promise<void> {
  const Database = (await import('better-sqlite3')).default as any;
  mkdirSync(join(workdir, '.swarm'), { recursive: true });
  const db = new Database(join(workdir, '.swarm', 'memory.db'));
  db.exec(`
    CREATE TABLE memory_entries (
      id TEXT PRIMARY KEY, content TEXT, embedding TEXT
    );
    INSERT INTO memory_entries VALUES ('m1', 'execution feedback', '[1,0]');
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL, task TEXT NOT NULL, critique TEXT
    );
    CREATE TABLE episode_embeddings (
      episode_id INTEGER PRIMARY KEY, embedding BLOB NOT NULL
    );
  `);
  db.prepare('INSERT INTO episodes (session_id, task, critique) VALUES (?,?,?)')
    .run('distill:feedback', 'test auth', includeCritique ? 'validation failed before fix' : null);
  if (includeEmbedding) {
    db.prepare('INSERT INTO episode_embeddings (episode_id, embedding) VALUES (?,?)')
      .run(1, Buffer.from(Float32Array.from([1, 0]).buffer));
  }
  db.close();
}

describe('doctor #2677 — Reflexion and critique coverage', () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'doctor-2677-reflexion-'));
    process.chdir(workdir);
    _resetMemoryRootCache();
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    _resetMemoryRootCache();
    rmSync(workdir, { recursive: true, force: true });
  });

  it('fails when episodes are structurally unreachable and carry no critique', async () => {
    await seed(false, false);
    const results = await runMemoryDoctor();
    expect(find(results, 'Memory Reflexion Coverage')?.status).toBe('fail');
    expect(find(results, 'Memory Reflexion Coverage')?.message).toContain('0/1');
    expect(find(results, 'Memory Feedback Critiques')?.status).toBe('fail');
  });

  it('passes when every feedback episode is embedded and carries a lesson', async () => {
    await seed(true, true);
    const results = await runMemoryDoctor();
    expect(find(results, 'Memory Reflexion Coverage')?.status).toBe('pass');
    expect(find(results, 'Memory Feedback Critiques')?.status).toBe('pass');
  });
});
