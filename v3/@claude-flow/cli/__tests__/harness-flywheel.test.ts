/**
 * Self-optimizing flywheel (ADR-176) — harvester, ledger proof, and the tick
 * that gets an install smarter on its own data. All deps injected (no ONNX).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { harvestSelfSupervisedTasks, blendCorpus, hashBlend } from '../src/services/harness-corpus-harvester.js';
import { appendLedger, summarizeImprovement, readLedger, type LedgerEntry } from '../src/services/harness-improvement-ledger.js';
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

// ── Flywheel tick ────────────────────────────────────────────────────────────
const anchor: AnchorTask[] = [
  { id: 'q0', input: { id: 'q0', q: 'alpha beta' }, expected: ['commit 0'] },
  { id: 'q1', input: { id: 'q1', q: 'gamma delta' }, expected: ['commit 1'] },
];

// A search stub where a HIGHER alpha ranks the correct doc better — so a neighbor
// with alpha>0.5 should win and be promoted; anchor never regresses.
function makeDeps(now: number): FlywheelDeps {
  return {
    getPatterns: () => patterns,
    search: (query, cfg) => {
      // deterministic ranking: correct doc's rank improves as alpha rises.
      const ranked: RankedItem[] = patterns.map((p) => ({ id: p.id, name: p.name }));
      // move the doc whose token matches the query toward the top, more so at high alpha.
      const boost = cfg.alpha >= 0.6 ? 0 : 2;
      const target = patterns.find((p) => query.includes(`token${p.id.slice(1)}`) || p.content!.includes(query.split(' ')[0]));
      if (target) {
        const idx = ranked.findIndex((r) => r.id === target.id);
        const to = Math.min(idx, boost);
        ranked.splice(idx, 1); ranked.splice(to, 0, { id: target.id, name: target.name });
      }
      return ranked.slice(0, 5);
    },
    anchorTasks: anchor,
    activeParams: () => null, // start at defaults
    sample: 12,
    now,
  };
}

describe('runFlywheelTick', () => {
  it('harvests, gates, and (when a neighbor dominates) applies + records proof; else honest no-op', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fw-'));
    const r = await runFlywheelTick(cwd, makeDeps(1000));
    expect(r.ran).toBe(true);
    expect(typeof r.baselineScore).toBe('number');
    expect(typeof r.candidateScore).toBe('number');
    // an attempt is always recorded (proof surface), accepted or not.
    const ledger = readLedger(join(cwd, '.claude-flow', 'metrics'));
    expect(ledger.length).toBe(1);
    if (r.accepted) {
      expect(r.applied).toBe(true);
      expect(r.anchorRegressed).toBe(false);              // Goodhart guard held
      expect(activeChampion(cwd)?.params).toBeDefined();  // champion is live
      expect(r.candidateScore!).toBeGreaterThan(r.baselineScore!);
    }
  });

  it('never throws on a tiny store — returns a clean no-op', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fw-'));
    const r = await runFlywheelTick(cwd, { ...makeDeps(1), getPatterns: () => patterns.slice(0, 3) });
    expect(r.ran).toBe(false);
    expect(r.reason).toMatch(/too small|not enough/);
  });
});
