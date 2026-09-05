/**
 * Qualification + anti-pattern archive (ADR-176 phase 1).
 * Invariant Q: complete provenance + deterministic replay + benchmark attribution.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  qualifyTrajectory, admitTrajectories, fingerprintTrajectory, AntiPatternArchive,
  type Trajectory, type ReplayFn,
} from '../src/services/harness-qualification.js';

function traj(over: Partial<Trajectory> = {}): Trajectory {
  return {
    id: 't1',
    steps: [{ action: 'edit src/x.ts', tier: 'oracle:test-exec' }, { action: 'run tests', tier: 'oracle:test-exec' }],
    outcome: 'success',
    benchmarkTaskId: 'LAB-v4/task-1',
    inputs: { file: 'src/x.ts' },
    recordedOutputs: { pass: true, n: 3 },
    ...over,
  };
}
// A deterministic replayer that reproduces recordedOutputs.
const goodReplay: ReplayFn = (t) => t.recordedOutputs;

describe('qualifyTrajectory — Invariant Q', () => {
  it('admits a complete, oracle-tier, benchmark-attributed, deterministically-replayable trajectory', () => {
    expect(qualifyTrajectory(traj(), goodReplay).qualified).toBe(true);
  });

  it('rejects incomplete provenance (no steps / missing action)', () => {
    expect(qualifyTrajectory(traj({ steps: [] }), goodReplay).qualified).toBe(false);
    expect(qualifyTrajectory(traj({ steps: [{ action: '', tier: 'oracle:test-exec' }] }), goodReplay).reasons.join()).toMatch(/no action/);
  });

  it('rejects a proxy-tier step (below oracle/judge — ADR-171)', () => {
    const r = qualifyTrajectory(traj({ steps: [{ action: 'guess', tier: 'proxy:structural' }] }), goodReplay);
    expect(r.qualified).toBe(false);
    expect(r.reasons.join()).toMatch(/proxy-tier/);
  });

  it('rejects missing benchmark attribution', () => {
    expect(qualifyTrajectory(traj({ benchmarkTaskId: undefined }), goodReplay).reasons.join()).toMatch(/benchmark attribution/);
  });

  it('rejects when replay is unverified or non-deterministic (fail-closed)', () => {
    expect(qualifyTrajectory(traj()).reasons.join()).toMatch(/replay not verified/); // no replay fn
    const drifting: ReplayFn = () => ({ pass: false }); // different from recorded
    expect(qualifyTrajectory(traj(), drifting).reasons.join()).toMatch(/non-deterministic/);
    const throwing: ReplayFn = () => { throw new Error('boom'); };
    expect(qualifyTrajectory(traj(), throwing).reasons.join()).toMatch(/replay threw/);
  });
});

describe('fingerprint + anti-pattern archive (negative learning)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'antipat-')); });

  it('identical trajectory shapes share a fingerprint', () => {
    expect(fingerprintTrajectory(traj())).toBe(fingerprintTrajectory(traj({ id: 'different-id' })));
  });

  it('records rejects, dedups by fingerprint, and is queryable', () => {
    const arc = new AntiPatternArchive(join(dir, 'anti.jsonl'));
    const fp = fingerprintTrajectory(traj());
    expect(arc.has(fp)).toBe(false);
    arc.record({ fingerprint: fp, stage: 'qualification', reasons: ['x'], ts: 1 });
    expect(arc.has(fp)).toBe(true);
    expect(arc.list().length).toBe(1);
  });

  it('rotates at the cap (runaway-storage guard) — never exceeds maxEntries', () => {
    const arc = new AntiPatternArchive(join(dir, 'capped.jsonl'), 5); // cap = 5
    for (let i = 0; i < 20; i++) arc.record({ fingerprint: 'fp' + i, stage: 'qualification', reasons: ['r'], ts: i });
    const all = arc.list();
    expect(all.length).toBeLessThanOrEqual(5);
    expect(all[all.length - 1].fingerprint).toBe('fp19'); // newest retained
  });
});

describe('admitTrajectories — split + archive', () => {
  it('splits qualified/rejected and records rejects to the archive (deduped)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'admit-'));
    const arc = new AntiPatternArchive(join(dir, 'anti.jsonl'));
    const batch = [
      traj({ id: 'ok' }),
      traj({ id: 'bad', benchmarkTaskId: undefined }),
      traj({ id: 'bad2', benchmarkTaskId: undefined }), // same shape as 'bad' → dedup
    ];
    const rep = admitTrajectories(batch, { replay: goodReplay, archive: arc, ts: 1 });
    expect(rep.admittedCount).toBe(1);
    expect(rep.rejectedCount).toBe(2);
    expect(existsSync(join(dir, 'anti.jsonl'))).toBe(true);
    expect(arc.list().length).toBe(1); // deduped by fingerprint
  });

  it('measured: qualifies a large batch quickly (throughput signal)', () => {
    const N = 5000;
    const batch = Array.from({ length: N }, (_, i) => traj({ id: 't' + i }));
    const t0 = performance.now();
    const rep = admitTrajectories(batch, { replay: goodReplay });
    const ms = performance.now() - t0;
    expect(rep.admittedCount).toBe(N);
    // Measured, not asserted-fast: log the rate. Loose ceiling just to catch a regression to O(n^2).
    // eslint-disable-next-line no-console
    console.log(`[bench] qualification: ${N} trajectories in ${ms.toFixed(1)}ms (${Math.round(N / (ms / 1000))}/s)`);
    expect(ms).toBeLessThan(2000);
  });
});
