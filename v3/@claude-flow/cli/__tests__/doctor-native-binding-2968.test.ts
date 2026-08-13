/**
 * Regression coverage for #2968: better-sqlite3's JavaScript wrapper can be
 * installed while its native addon is absent because postinstall did not run.
 * Doctor must report capability loss, not accuse the database of corruption.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('better-sqlite3', () => ({
  default: class MissingNativeBinding {
    constructor() {
      throw new Error('Could not locate the bindings file. Tried:\n → better_sqlite3.node');
    }
  },
}));

import { doctorCommand } from '../src/commands/doctor.js';
import { _resetMemoryRootCache } from '../src/memory/memory-initializer.js';

type HealthCheck = { name: string; status: 'pass' | 'warn' | 'fail'; message: string };
type DoctorData = { results: HealthCheck[] };

const originalCwd = process.cwd();
let workdir: string;

async function runDoctor(component?: string) {
  const ctx = {
    flags: component ? { component } : {},
    args: [],
    config: {} as Record<string, unknown>,
  } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];
  return doctorCommand.action!(ctx);
}

function findCheck(results: HealthCheck[], name: string): HealthCheck | undefined {
  return results.find((result) => result.name.includes(name));
}

describe('doctor #2968 — missing better-sqlite3 native binding', () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'doctor-2968-'));
    process.chdir(workdir);
    mkdirSync(join(workdir, '.swarm'), { recursive: true });
    writeFileSync(join(workdir, '.swarm', 'memory.db'), Buffer.from('SQLite format 3\0'.padEnd(256, '\0'), 'binary'));
    _resetMemoryRootCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    _resetMemoryRootCache();
    rmSync(workdir, { recursive: true, force: true });
  });

  it('warns in the default structural check without reporting malformed data', async () => {
    const result = await runDoctor();
    const check = findCheck((result.data as DoctorData).results, 'Memory Structural Integrity');

    expect(check?.status).toBe('warn');
    expect(check?.message).toMatch(/native binding is unavailable/i);
    expect(check?.message).toMatch(/durable WAL-backed persistence unavailable/i);
    expect(check?.message).not.toMatch(/malformed/i);
    expect(check?.message).not.toContain('Tried:');
  }, 20000);

  it('warns in `doctor --component memory` instead of returning a fallback pass', async () => {
    const result = await runDoctor('memory');
    const check = findCheck((result.data as DoctorData).results, 'Memory Integrity');

    expect(check?.status).toBe('warn');
    expect(check?.message).toMatch(/native binding is unavailable/i);
    expect(check?.message).not.toMatch(/malformed/i);
  });
});
