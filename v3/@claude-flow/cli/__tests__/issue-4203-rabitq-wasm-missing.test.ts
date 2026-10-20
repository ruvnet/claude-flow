import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// #4203 follow-up: `ensureRabitqIndex()` flips a process-level `autoBuildDisabled`
// flag when the optional WASM module is missing, so a store without RaBitQ stops
// paying a failed dynamic import on every search. That branch had no coverage,
// because issue-4203-rabitq-auto-build.test.ts runs with the module installed.
//
// The mock throws on import, which is what `loadRabitqModule()` sees when the
// optional dependency is not present.
const wasm = vi.hoisted(() => ({ imports: 0 }));

vi.mock('@ruvector/rabitq-wasm', () => {
  wasm.imports++;
  throw new Error('@ruvector/rabitq-wasm not available');
});

const DIMENSIONS = 384;
const ROW_COUNT = 12;

function vectorFor(seed: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < DIMENSIONS; i++) {
    out.push(Math.sin(seed * 0.7 + i * 0.11) * Math.cos(seed * 1.3 + i * 0.03));
  }
  return out;
}

/** Seed a real store so the 10-vector floor cannot short-circuit the build. */
async function seedStore(root: string): Promise<string | null> {
  const dbPath = join(root, 'memory.db');
  const bridge = await import('../src/memory/memory-bridge.js');
  const { initializeMemoryDatabase } = await import('../src/memory/memory-initializer.js');

  await initializeMemoryDatabase({ dbPath, force: true, verbose: false });

  const status = await bridge.bridgeGetVectorSearchStatus(dbPath);
  if (!status) return null; // bridge unavailable in this environment

  for (let i = 0; i < ROW_COUNT; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const written = await bridge.bridgeAddEmbedding(
      id,
      vectorFor(i),
      { id, key: `emb-${i}`, namespace: 'test', content: `row ${i}` },
      dbPath,
    );
    if (written !== true) return null;
  }

  return dbPath;
}

describe('#4203 follow-up: a missing WASM module disables auto-build for the process', () => {
  beforeEach(() => {
    vi.resetModules();
    wasm.imports = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops retrying once the WASM module is known to be missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ruflo-4203-nowasm-'));
    try {
      const dbPath = await seedStore(root);
      if (!dbPath) return; // bridge unavailable in this environment

      const rabitq = await import('../src/memory/rabitq-index.js');

      expect(await rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS })).toBe(false);
      expect(wasm.imports).toBe(1);
      expect(rabitq.getRabitqStatus().initialized).toBe(false);

      // Move past the 60s throttle. Without `autoBuildDisabled` this call would
      // try the import again, so an unchanged counter isolates that flag from
      // the throttle it would otherwise be indistinguishable from.
      const realNow = Date.now;
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 10 * 60_000);

      expect(await rabitq.ensureRabitqIndex({ dbPath, dimensions: DIMENSIONS })).toBe(false);
      expect(wasm.imports).toBe(1);

      // Callers keep their exhaustive path: no index, and no throw.
      expect(await rabitq.searchRabitq(vectorFor(0), { k: 3 })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
