/**
 * Tests for CheckpointGate — the agenticow-backed checkpoint/rollback gate for
 * autopilot loops (agenticow step 3).
 *
 * Two surfaces under test (mirrors agenticow-tools.test.ts conventions):
 *   1. HAPPY PATH — agenticow installed. guard() checkpoints a real temp `.rvf`,
 *      the tick mutates it, and a regression verdict rolls it back so the
 *      mutation is discarded. The success path keeps the checkpoint.
 *   2. DEGRADED PATH — no memory path / kill switch. guard() runs the tick
 *      unguarded and reports degraded:true with no throw.
 *
 * Why both: agenticow is in optionalDependencies — the degraded path is the
 * load-bearing architectural rule (zero hard runtime dep, non-fatal loop).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  CheckpointGate,
  getCheckpointGate,
  __resetCheckpointGateForTests,
  CHECKPOINT_MEM_ENV,
  KILL_SWITCH_ENV,
} from '../src/services/checkpoint-gate.js';

// Detect agenticow availability at module scope (top-level await is allowed in
// vitest ESM). Needed before the it.skipIf(...) calls, which evaluate eagerly.
let havePkg = false;
let acow: any;
try { acow = await import('agenticow'); havePkg = true; } catch { havePkg = false; }

const DIM = 8;
const vec = (s: number) => Array.from({ length: DIM }, (_, i) => Math.sin(s + i));

/** Open a memory file the same way the gate does (load lineage manifest when
 *  present), so verification sees post-checkpoint / post-rollback state. */
async function openMem(path: string) {
  const manifest = `${path}.agenticow.json`;
  if (existsSync(manifest)) return acow.AgenticMemory.load(manifest);
  return acow.open(path, { dimension: DIM });
}

/**
 * The set of vector ids currently VISIBLE across the whole COW lineage.
 *
 * We query (not status()) because agenticow's status().totalVectors reports
 * only the working segment, whereas query() reads through the full chain
 * (base ∪ edits, child wins) — which is exactly what a checkpoint/rollback
 * changes. k=50 comfortably exceeds the tiny test datasets, so every visible
 * id is returned.
 */
async function visibleIds(path: string): Promise<Set<number>> {
  const mem = await openMem(path);
  try {
    const hits = await mem.query(vec(1), 50);
    return new Set<number>(hits.map((h: any) => Number(h.id)));
  } finally {
    await mem.close?.();
  }
}

/** Seed a base `.rvf` with `n` vectors and persist its lineage manifest. */
async function seed(path: string, n: number): Promise<void> {
  const mem = await acow.open(path, { dimension: DIM });
  try {
    await mem.ingest(Array.from({ length: n }, (_, i) => ({ id: i + 1, vector: vec(i + 1), text: `v${i + 1}` })));
    await mem.save?.(`${path}.agenticow.json`);
  } finally {
    await mem.close?.();
  }
}

/** Append `n` vectors (a "mutation" a tick would make). */
async function mutate(path: string, startId: number, n: number): Promise<void> {
  const mem = await openMem(path);
  try {
    await mem.ingest(Array.from({ length: n }, (_, i) => ({ id: startId + i, vector: vec(startId + i), text: `m${startId + i}` })));
    await mem.save?.(`${path}.agenticow.json`);
  } finally {
    await mem.close?.();
  }
}

describe('CheckpointGate — degraded / opt-out paths (no agenticow needed)', () => {
  afterEach(() => {
    delete process.env[KILL_SWITCH_ENV];
    delete process.env[CHECKPOINT_MEM_ENV];
    __resetCheckpointGateForTests();
  });

  it('runs the tick unguarded when no memory path is given', async () => {
    const gate = new CheckpointGate();
    let ran = false;
    const out = await gate.guard(undefined, 'no-path', async () => { ran = true; return { success: true, n: 42 }; });
    expect(ran).toBe(true);
    expect(out.result).toEqual({ success: true, n: 42 });
    expect(out.checkpointed).toBe(false);
    expect(out.rolledBack).toBe(false);
    expect(out.degraded).toBe(true);
    expect(out.reason).toBe('no-memory-path');
  });

  it('kill switch forces unguarded pass-through even with a memory path', async () => {
    process.env[KILL_SWITCH_ENV] = '1';
    __resetCheckpointGateForTests();
    const gate = new CheckpointGate();
    const out = await gate.guard('/tmp/whatever.rvf', 'killed', async () => ({ success: true }));
    expect(out.degraded).toBe(true);
    expect(out.reason).toBe('kill-switch');
    expect(out.checkpointed).toBe(false);
    expect(CheckpointGate.isKillSwitchSet()).toBe(true);
  });

  it('configuredMemPath reflects the env var', () => {
    expect(CheckpointGate.configuredMemPath()).toBeUndefined();
    process.env[CHECKPOINT_MEM_ENV] = '/data/loop.rvf';
    expect(CheckpointGate.configuredMemPath()).toBe('/data/loop.rvf');
  });

  it('rejects path traversal in the memory path (checkpoint)', async () => {
    const gate = new CheckpointGate();
    // Only meaningful when agenticow is present (validation runs after load);
    // when absent it degrades. Either way it must not silently succeed.
    const r = await gate.checkpoint('../../etc/passwd', 'evil').catch((e) => ({ threw: String(e) } as any));
    if (havePkg) {
      expect(r.threw).toMatch(/disallowed/);
    } else {
      expect(r.degraded).toBe(true);
    }
  });

  it('getCheckpointGate returns a stable shared instance', () => {
    const a = getCheckpointGate();
    const b = getCheckpointGate();
    expect(a).toBe(b);
  });
});

describe.skipIf(!havePkg)('CheckpointGate — happy path (real agenticow, temp .rvf)', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'checkpoint-gate-'));
  });
  afterAll(() => {
    try { rmSync(workdir, { recursive: true, force: true }); } catch { /* ignore */ }
    __resetCheckpointGateForTests();
  });

  it('checkpoint → mutate → rollback restores the pre-tick memory state', async () => {
    const path = join(workdir, 'rollback.rvf');
    await seed(path, 3);
    expect(await visibleIds(path)).toEqual(new Set([1, 2, 3]));

    const gate = new CheckpointGate();
    // A regressing tick: mutate memory, then report failure.
    const out = await gate.guard(path, 'iter-1', async () => {
      await mutate(path, 100, 4); // tick writes 4 speculative vectors (ids 100-103)
      return { success: false, reason: 'verifier-failed' };
    });

    expect(out.checkpointed).toBe(true);
    expect(out.rolledBack).toBe(true);
    expect(out.degraded).toBe(false);
    expect(out.reason).toBe('regression-verdict');
    // The 4 speculative vectors are discarded — back to the checkpoint.
    expect(await visibleIds(path)).toEqual(new Set([1, 2, 3]));
  });

  it('success verdict keeps the mutation (no rollback)', async () => {
    const path = join(workdir, 'keep.rvf');
    await seed(path, 2);
    expect(await visibleIds(path)).toEqual(new Set([1, 2]));

    const gate = new CheckpointGate();
    const out = await gate.guard(path, 'iter-1', async () => {
      await mutate(path, 200, 3); // good tick writes ids 200-202
      return { success: true };
    });

    expect(out.checkpointed).toBe(true);
    expect(out.rolledBack).toBe(false);
    expect(out.degraded).toBe(false);
    // Mutation retained across the lineage.
    expect(await visibleIds(path)).toEqual(new Set([1, 2, 200, 201, 202]));
  });

  it('a throwing tick rolls back then re-throws (rethrow default)', async () => {
    const path = join(workdir, 'throw.rvf');
    await seed(path, 2);

    const gate = new CheckpointGate();
    await expect(gate.guard(path, 'iter-1', async () => {
      await mutate(path, 300, 5);
      throw new Error('tick blew up');
    })).rejects.toThrow(/tick blew up/);

    // Rolled back despite the throw — mutation discarded.
    expect(await visibleIds(path)).toEqual(new Set([1, 2]));
  });

  it('a throwing tick with rethrow:false returns the error and rolls back', async () => {
    const path = join(workdir, 'throw-soft.rvf');
    await seed(path, 1);

    const gate = new CheckpointGate();
    const out = await gate.guard(path, 'iter-1', async () => {
      await mutate(path, 400, 2);
      throw new Error('soft fail');
    }, { rethrow: false });

    expect(out.result).toBeUndefined();
    expect(out.rolledBack).toBe(true);
    expect(out.reason).toBe('tick-threw');
    expect(out.error).toBeInstanceOf(Error);
    expect(await visibleIds(path)).toEqual(new Set([1]));
  });

  it('standalone checkpoint() then rollback() round-trips via the manifest', async () => {
    const path = join(workdir, 'manual.rvf');
    await seed(path, 2);

    const gate = new CheckpointGate();
    const cp = await gate.checkpoint(path, 'cp-manual');
    expect(cp.ok).toBe(true);
    expect(existsSync(`${path}.agenticow.json`)).toBe(true);

    await mutate(path, 500, 3);
    expect(await visibleIds(path)).toEqual(new Set([1, 2, 500, 501, 502]));

    const rb = await gate.rollback(path);
    expect(rb.ok).toBe(true);
    expect(await visibleIds(path)).toEqual(new Set([1, 2]));
  });
});
