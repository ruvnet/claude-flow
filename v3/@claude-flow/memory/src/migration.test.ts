/**
 * Tests for MemoryMigrator batch embedding (perf fix).
 *
 * Previously the migrator awaited one embedding per entry inside the batch
 * loop — N sequential inferences per batch. Now it prefers a true batch
 * embedding generator (one call per batch) and otherwise embeds with
 * bounded concurrency. Per-entry error semantics are preserved: one bad
 * entry never fails the batch.
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryMigrator } from './migration.js';
import type { AgentDBAdapter } from './agentdb-adapter.js';
import type { MemoryEntry } from './types.js';

function writeSourceFile(entries: Array<{ key: string; value: string }>): string {
  const dir = mkdtempSync(join(tmpdir(), 'migration-test-'));
  const file = join(dir, 'source.json');
  writeFileSync(file, JSON.stringify(entries));
  return file;
}

function makeTarget(): { stored: MemoryEntry[]; target: AgentDBAdapter } {
  const stored: MemoryEntry[] = [];
  const target = {
    store: async (entry: MemoryEntry) => {
      stored.push(entry);
      return entry;
    },
  } as unknown as AgentDBAdapter;
  return { stored, target };
}

const embeddingOf = (content: string) => new Float32Array([content.length, 1, 2]);

describe('MemoryMigrator — batch embedding', () => {
  it('uses the batch embedding generator ONCE per batch (not per entry)', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({ key: `k${i}`, value: `value ${i}` }));
    const sourcePath = writeSourceFile(entries);
    const { stored, target } = makeTarget();

    const batchCalls: string[][] = [];
    const batchGenerator = async (contents: string[]) => {
      batchCalls.push(contents);
      return contents.map(embeddingOf);
    };

    const migrator = new MemoryMigrator(
      target,
      { source: 'json', sourcePath, batchSize: 10 },
      undefined,
      batchGenerator
    );
    const result = await migrator.migrate();

    expect(result.success).toBe(true);
    expect(result.progress.migrated).toBe(25);
    // 25 entries / batchSize 10 → 3 batch calls, NOT 25 single calls
    expect(batchCalls).toHaveLength(3);
    expect(batchCalls.map((c) => c.length)).toEqual([10, 10, 5]);
    expect(stored.every((e) => e.embedding instanceof Float32Array)).toBe(true);
  });

  it('falls back to bounded concurrency over the single-text generator', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, value: `value ${i}` }));
    const sourcePath = writeSourceFile(entries);
    const { stored, target } = makeTarget();

    let inFlight = 0;
    let maxInFlight = 0;
    const generator = async (content: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return embeddingOf(content);
    };

    const migrator = new MemoryMigrator(
      target,
      { source: 'json', sourcePath, batchSize: 20, embeddingConcurrency: 4 },
      generator
    );
    const result = await migrator.migrate();

    expect(result.progress.migrated).toBe(20);
    expect(maxInFlight).toBeGreaterThan(1); // actually concurrent
    expect(maxInFlight).toBeLessThanOrEqual(4); // but bounded — never unbounded
    expect(stored.every((e) => e.embedding instanceof Float32Array)).toBe(true);
  });

  it('one failing embedding does not fail the batch — entry stored without vector', async () => {
    const entries = [
      { key: 'good-1', value: 'alpha' },
      { key: 'bad', value: 'POISON' },
      { key: 'good-2', value: 'gamma' },
    ];
    const sourcePath = writeSourceFile(entries);
    const { stored, target } = makeTarget();

    const generator = async (content: string) => {
      if (content === 'POISON') throw new Error('embedder choked');
      return embeddingOf(content);
    };

    const warnings: string[] = [];
    const migrator = new MemoryMigrator(
      target,
      { source: 'json', sourcePath, batchSize: 10 },
      generator
    );
    migrator.on('migration:warning', (w: { message: string }) => warnings.push(w.message));

    const result = await migrator.migrate();

    expect(result.progress.migrated).toBe(3); // all three stored
    expect(result.progress.failed).toBe(0);
    const bad = stored.find((e) => e.key === 'bad');
    expect(bad).toBeDefined();
    expect(bad!.embedding).toBeUndefined();
    expect(warnings.some((m) => m.includes('bad'))).toBe(true);
    // Good entries still got vectors
    expect(stored.find((e) => e.key === 'good-1')!.embedding).toBeInstanceOf(Float32Array);
  });

  it('falls back to single-text embedding when the batch call fails', async () => {
    const entries = [
      { key: 'a', value: 'one' },
      { key: 'b', value: 'two' },
    ];
    const sourcePath = writeSourceFile(entries);
    const { stored, target } = makeTarget();

    const batchGenerator = vi.fn(async () => {
      throw new Error('batch backend down');
    });
    const singleGenerator = vi.fn(async (content: string) => embeddingOf(content));

    const migrator = new MemoryMigrator(
      target,
      { source: 'json', sourcePath, batchSize: 10 },
      singleGenerator,
      batchGenerator
    );
    const result = await migrator.migrate();

    expect(result.progress.migrated).toBe(2);
    expect(batchGenerator).toHaveBeenCalledTimes(1);
    expect(singleGenerator).toHaveBeenCalledTimes(2);
    expect(stored.every((e) => e.embedding instanceof Float32Array)).toBe(true);
  });

  it('preserves validation-skip semantics (invalid entries never reach the embedder)', async () => {
    const entries = [
      { key: 'ok', value: 'fine' },
      { value: 'missing key' } as { key: string; value: string }, // invalid
    ];
    const sourcePath = writeSourceFile(entries);
    const { target } = makeTarget();

    const batchGenerator = vi.fn(async (contents: string[]) => contents.map(embeddingOf));
    const migrator = new MemoryMigrator(
      target,
      { source: 'json', sourcePath, batchSize: 10 },
      undefined,
      batchGenerator
    );
    const result = await migrator.migrate();

    expect(result.progress.migrated).toBe(1);
    expect(result.progress.skipped).toBe(1);
    expect(batchGenerator).toHaveBeenCalledTimes(1);
    expect(batchGenerator.mock.calls[0][0]).toEqual(['fine']);
  });

  it('skips embedding entirely when generateEmbeddings=false', async () => {
    const sourcePath = writeSourceFile([{ key: 'k', value: 'v' }]);
    const { stored, target } = makeTarget();
    const batchGenerator = vi.fn(async (contents: string[]) => contents.map(embeddingOf));

    const migrator = new MemoryMigrator(
      target,
      { source: 'json', sourcePath, generateEmbeddings: false },
      undefined,
      batchGenerator
    );
    const result = await migrator.migrate();

    expect(result.progress.migrated).toBe(1);
    expect(batchGenerator).not.toHaveBeenCalled();
    expect(stored[0].embedding).toBeUndefined();
  });
});
