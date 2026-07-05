/**
 * Self-optimizing flywheel (ADR-176) — harvester, ledger proof, and the tick
 * that gets an install smarter on its own data. All deps injected (no ONNX).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { harvestSelfSupervisedTasks, blendCorpus, hashBlend } from '../src/services/harness-corpus-harvester.js';
import { appendLedger, summarizeImprovement, readLedger, bootstrapDeltaCILow, type LedgerEntry } from '../src/services/harness-improvement-ledger.js';
import { runFlywheelTick, DEFAULT_CONFIG, type FlywheelDeps, type RankedItem, type AnchorTask } from '../src/services/harness-flywheel.js';
import { activeChampion } from '../src/config/harness-feedback-applier.js';

// ── Harvester ────────────────────────────────────────────────────────────────
const patterns = Array.from({ length: 30 }, (_, i) => ({
  id: `p${String(i).padStart(2, '0')}`,
  name: `feature commit ${i}`,
  content: `implement widget number ${i} with alpha beta gamma delta epsilon token${i} handler subsystem`,
}));

describe('corpus harvester', () => {
  it('derives discriminative self-retrieval tasks with oracle provenance, deterministically', () => {
    const a = harvestSelfSupervisedTasks(patterns, { sample: 10 });
    const b = harvestSelfSupervisedTasks(patterns, { sample: 10 });
    expect(a.length).toBeGreaterThan(3);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id)); // deterministic
    expect(a[0].provenanceTier).toBe('oracle:self-identity');
    expect(a[0].expected).toBe(a[0].input.targetId); // self-identity label
    // query withholds the subject tokens — "feature"/"commit" should not dominate.
    expect(a[0].input.q.length).toBeGreaterThan(0);
  });

  it('blends anchor + harvested into a versioned, hashed corpus that changes with content', () => {
    const anchor = [{ id: 'q00', input: { id: 'q00', q: 'x' }, expected: ['x'] }];
    const c1 = blendCorpus(anchor, harvestSelfSupervisedTasks(patterns, { sample: 8 }));
    const c2 = blendCorpus(anchor, harvestSelfSupervisedTasks(patterns.slice(0, 20), { sample: 8 }));
    expect(c1.anchorIds).toEqual(['q00']);
    expect(c1.version).toMatch(/^flywheel-a1-h/);
    expect(c1.corpusHash).not.toBe(c2.corpusHash); // grows/changes with the store
  });
});

// ── Ledger (proof) ───────────────────────────────────────────────────────────
function entry(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    ts: 1, corpusVersion: 'v', corpusHash: 'h', corpusSize: 10, anchorSize: 5,
    baselineRef: 'r0', candidateRef: 'r1', baselineScore: 0.5, candidateScore: 0.6, delta: 0.1,
    anchorRegressed: false, accepted: true, gates: {}, championRef: 'r1', reason: 'ok', ...over,
  };
}

describe('improvement ledger', () => {
  it('summarizes monotonic, chained improvement as an auditable claim', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    appendLedger(dir, entry({ baselineRef: 'r0', candidateRef: 'r1', championRef: 'r1', baselineScore: 0.50, candidateScore: 0.60, delta: 0.10 }));
    appendLedger(dir, entry({ baselineRef: 'rX', candidateRef: 'rX', accepted: false, championRef: undefined, delta: -0.02, reason: 'rejected' }));
    appendLedger(dir, entry({ baselineRef: 'r1', candidateRef: 'r2', championRef: 'r2', baselineScore: 0.60, candidateScore: 0.68, delta: 0.08 }));
    const s = summarizeImprovement(dir);
    expect(s.attempts).toBe(3);
    expect(s.accepted).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.cumulativeDelta).toBeCloseTo(0.18, 6);
    expect(s.firstScore).toBe(0.50);
    expect(s.currentScore).toBe(0.68);
    expect(s.monotonic).toBe(true);   // each accepted strictly beat its baseline
    expect(s.chainIntact).toBe(true); // r0→r1→r2
  });

  it('flags a broken chain (an accepted champion whose baseline != prior champion)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    appendLedger(dir, entry({ baselineRef: 'r0', championRef: 'r1' }));
    appendLedger(dir, entry({ baselineRef: 'rZ', championRef: 'r2' })); // rZ != r1
    expect(summarizeImprovement(dir).chainIntact).toBe(false);
  });

  it('flags non-monotonic (an accepted entry that did not actually improve)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    appendLedger(dir, entry({ baselineScore: 0.6, candidateScore: 0.6, delta: 0, accepted: true }));
    expect(summarizeImprovement(dir).monotonic).toBe(false);
  });
});

describe('bootstrapDeltaCILow (SOTA small-N noise guard)', () => {
  it('is deterministic and positive for a consistent improvement', () => {
    const deltas = [0.1, 0.05, 0.2, 0.08, 0.12, 0.15];
    const a = bootstrapDeltaCILow(deltas);
    const b = bootstrapDeltaCILow(deltas);
    expect(a).toBe(b);            // reproducible verdict
    expect(a).toBeGreaterThan(0); // survives resampling → significant
  });

  it('is not positive when the mean gain rides on one lucky task (noise)', () => {
    const deltas = [0, 0, 0, 0, 0.6, 0]; // one outlier, rest flat
    expect(bootstrapDeltaCILow(deltas)).toBeLessThanOrEqual(0); // CI low ≤ 0 → held back
  });

  it('is not positive with mixed signs (no real direction)', () => {
    expect(bootstrapDeltaCILow([0.2, -0.2, 0.1, -0.15, 0.05, -0.1])).toBeLessThanOrEqual(0);
  });
});

// ── Flywheel tick ────────────────────────────────────────────────────────────
// 6 anchor tasks (objective ≥ 4). Each query names its target doc via `target:pNN`.
const anchor: AnchorTask[] = Array.from({ length: 6 }, (_, i) => ({
  id: `q${i}`, input: { id: `q${i}`, q: `target:p0${i} find the feature` }, expected: [`feature commit ${i}`],
}));

// Stub where a LOWER alpha ranks the anchor's target doc #1 (so a 2-step
// neighbor alpha 0.5→0.3 improves the anchor). Harvested queries carry no
// `target:` → default order, config-invariant → the guard set never regresses.
function makeDeps(now: number, activeParams: () => Partial<{ alpha: number }> | null = () => null): FlywheelDeps {
  return {
    getPatterns: () => patterns,
    search: (query, cfg) => {
      const ranked: RankedItem[] = patterns.map((p) => ({ id: p.id, name: p.name }));
      const m = query.match(/target:(p\d+)/);
      if (m) {
        const idx = ranked.findIndex((r) => r.id === m[1]);
        if (idx >= 0) {
          const to = cfg.alpha <= 0.4 ? 0 : 3;              // low alpha → target #1; else rank 4 (out of top-3)
          const [item] = ranked.splice(idx, 1);
          ranked.splice(to, 0, item);
        }
      }
      return ranked.slice(0, 5);
    },
    anchorTasks: anchor,
    activeParams,
    sample: 12,
    now,
  };
}

describe('runFlywheelTick', () => {
  it('LEARNS: a lower-alpha neighbor improves the anchor without regressing the guard → applied + proven', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fw-'));
    const r = await runFlywheelTick(cwd, makeDeps(1000));
    expect(r.ran).toBe(true);
    expect(r.accepted).toBe(true);
    expect(r.applied).toBe(true);
    expect(r.anchorRegressed).toBe(false);                 // guard held
    expect(r.candidateScore!).toBeGreaterThan(r.baselineScore!); // real improvement
    // the champion is live AND the proof ledger recorded a significant, accepted entry.
    expect((activeChampion(cwd)?.params as { alpha: number }).alpha).toBeLessThanOrEqual(0.4);
    const led = readLedger(join(cwd, '.claude-flow', 'metrics'));
    expect(led.length).toBe(1);
    expect(led[0].accepted).toBe(true);
    expect(led[0].significant).toBe(true);                 // survived the bootstrap CI
    expect(led[0].deltaCILow!).toBeGreaterThan(0);
  });

  it('records the attempt even on a no-op (proof surface is always written)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fw-'));
    // start already at the optimum (alpha 0.3) → no neighbor improves → honest refuse.
    await runFlywheelTick(cwd, makeDeps(1, () => ({ alpha: 0.3 })));
    const led = readLedger(join(cwd, '.claude-flow', 'metrics'));
    expect(led.length).toBe(1);
  });

  it('never throws on a tiny store — returns a clean no-op', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fw-'));
    const r = await runFlywheelTick(cwd, { ...makeDeps(1), getPatterns: () => patterns.slice(0, 3) });
    expect(r.ran).toBe(false);
    expect(r.reason).toMatch(/too small|not enough/);
  });
});
