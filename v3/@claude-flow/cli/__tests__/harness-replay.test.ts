/**
 * Deterministic replay engine (ADR-176 phase 3).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digest, recordRun, verifyReplay, allDeterministic, ReplayStore, type RunFn } from '../src/services/harness-replay.js';

const pure: RunFn = (inputs) => ({ doubled: (inputs as { x: number }).x * 2 });

describe('digest', () => {
  it('is stable + order-independent', () => {
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
  });
});

describe('record + verify replay', () => {
  it('a pure run replays deterministically', () => {
    const rec = recordRun('r1', { x: 5 }, pure);
    expect(verifyReplay(rec, pure).deterministic).toBe(true);
  });

  it('a non-deterministic run does NOT replay (fail-closed)', () => {
    const rec = recordRun('r2', { x: 5 }, pure);
    const drifting: RunFn = () => ({ doubled: Math.floor(performance.now()) }); // changes each call
    expect(verifyReplay(rec, drifting).deterministic).toBe(false);
  });

  it('a throwing replay is non-deterministic', () => {
    const rec = recordRun('r3', { x: 5 }, pure);
    expect(verifyReplay(rec, () => { throw new Error('boom'); }).deterministic).toBe(false);
  });

  it('allDeterministic is the batch predicate for accept()', () => {
    const recs = [recordRun('a', { x: 1 }, pure), recordRun('b', { x: 2 }, pure)];
    expect(allDeterministic(recs, pure)).toBe(true);
  });
});

describe('ReplayStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'replay-')); });

  it('records + retrieves the latest run for an id', () => {
    const s = new ReplayStore(join(dir, 'runs.jsonl'));
    s.record(recordRun('r', { x: 1 }, pure, 1));
    s.record(recordRun('r', { x: 9 }, pure, 2)); // newer for same id
    expect(s.get('r')?.inputs).toEqual({ x: 9 });
    expect(s.all().length).toBe(2);
    expect(s.get('missing')).toBeUndefined();
  });

  it('rotates at the cap (runaway-storage guard) — never exceeds maxEntries', () => {
    const s = new ReplayStore(join(dir, 'capped.jsonl'), 5);
    for (let i = 0; i < 20; i++) s.record(recordRun('r' + i, { x: i }, pure));
    expect(s.all().length).toBeLessThanOrEqual(5);
    expect(s.get('r19')).toBeDefined(); // newest retained
  });

  it('measured: records + replays a batch quickly', () => {
    const N = 3000;
    const recs = Array.from({ length: N }, (_, i) => recordRun('r' + i, { x: i }, pure));
    const t0 = performance.now();
    const ok = allDeterministic(recs, pure);
    const ms = performance.now() - t0;
    expect(ok).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[bench] replay: verified ${N} runs in ${ms.toFixed(1)}ms (${Math.round(N / (ms / 1000))}/s)`);
    expect(ms).toBeLessThan(2000);
  });
});
