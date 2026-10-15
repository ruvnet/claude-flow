/**
 * Dream Cycle 2026-09-22 (intelligence surface).
 *
 * `EWCConsolidator.updateFisherFromConfidences()` (memory/ewc-consolidation.ts)
 * is the Fisher-matrix update wired into production at
 * `intelligence.ts:413`, called after every SONA `distillLearning()` pass
 * (see `ewc-distill-confidence-gate.test.ts`, the 2026-08-27 fix that wired
 * it in). Before this fix, its online-EMA update used
 * `globalFisher[i] = alpha * globalFisher[i] + (1 - alpha) * currentFisher[i]`
 * with `alpha = fisherDecayRate` (default 0.01) — the OLD accumulated value
 * got the *small* coefficient (0.01) and the new batch got the *large* one
 * (0.99), discarding ~99% of accumulated importance on every single call.
 *
 * This is inverted relative to the two sibling `globalFisher` EMA sites in
 * the same class — `computeFisherMatrix()` and `recordGradient()` — which
 * both correctly do `(1 - decay) * old + decay * new` (decay is the weight
 * given to the *new* batch, so old dominates and Fisher decays slowly).
 * It also contradicts the standard online-EWC/EWC++ update rule (Chaudhry
 * et al., "Riemannian Walk for Incremental Learning", ECCV 2018,
 * arXiv:1801.10112; confirmed still the reference baseline as of
 * arXiv:2502.11756, 2025), which the file's own docstring describes
 * correctly ("Uses online averaging: F_new = alpha * F_old + (1-alpha) *
 * F_current") but the code did not implement to match ("alpha" is bound to
 * the *decay* config value, which should carry small weight on old, not new).
 *
 * Net effect of the bug: EWC++'s entire purpose ("Prevents catastrophic
 * forgetting of important patterns during continual learning", line 3 of
 * ewc-consolidation.ts) was defeated for this call path — importance
 * accumulated over many prior distill passes was wiped by the very next
 * low-signal one.
 */
import { describe, expect, it } from 'vitest';

describe('#dream-2026-09-22 EWCConsolidator.updateFisherFromConfidences EMA direction', () => {
  it('retains most of a prior high-importance signal across several subsequent low-signal calls', async () => {
    const { EWCConsolidator } = await import('../src/memory/ewc-consolidation.js');
    const consolidator = new EWCConsolidator({
      dimensions: 8,
      fisherDecayRate: 0.01,
      storagePath: '/tmp/ewc-ema-direction-test-a.json',
    });

    // One high-magnitude, high-confidence-delta batch establishes a strong
    // Fisher signal (the "important pattern" EWC++ should protect).
    consolidator.updateFisherFromConfidences([
      { id: 'important', embedding: new Array(8).fill(10), oldConf: 0.5, newConf: 0.9 },
    ]);
    const fisherAfterFirst = consolidator.getConsolidationStats().avgFisherValue;
    expect(fisherAfterFirst).toBeGreaterThan(0);

    // Five subsequent near-zero-signal batches (as would happen on nights
    // where little of note gets distilled) should barely erode it — a slow
    // EMA with decay=0.01 retains (1-0.01)^5 ≈ 95.1% of the original value.
    for (let i = 0; i < 5; i++) {
      consolidator.updateFisherFromConfidences([
        { id: 'noise', embedding: new Array(8).fill(0.001), oldConf: 0.5, newConf: 0.51 },
      ]);
    }
    const fisherAfterFiveNoisyCalls = consolidator.getConsolidationStats().avgFisherValue;

    // Buggy behavior retained ~(0.01)^5 of the original (effectively zero);
    // correct behavior retains ~95%. 0.9 is a safe discriminating threshold.
    expect(fisherAfterFiveNoisyCalls).toBeGreaterThan(fisherAfterFirst * 0.9);
  });

  it('matches the EMA direction of the sibling recordGradient()/computeFisherMatrix() update sites', async () => {
    const { EWCConsolidator } = await import('../src/memory/ewc-consolidation.js');

    const viaConfidences = new EWCConsolidator({
      dimensions: 4,
      fisherDecayRate: 0.25,
      storagePath: '/tmp/ewc-ema-direction-test-b.json',
    });
    const viaGradient = new EWCConsolidator({
      dimensions: 4,
      fisherDecayRate: 0.25,
      storagePath: '/tmp/ewc-ema-direction-test-c.json',
    });

    // Same embedding/confidence-delta shape, fed through both update paths:
    // recordGradient() takes a raw gradient vector directly, while
    // updateFisherFromConfidences() scales the embedding by the confidence
    // delta first — so use delta=1 to make the two proxies equivalent.
    const embedding = [2, 2, 2, 2];
    viaConfidences.updateFisherFromConfidences([
      { id: 'p1', embedding, oldConf: 0, newConf: 1 },
    ]);
    viaGradient.recordGradient('p1', embedding, true);

    const statsA = viaConfidences.getConsolidationStats();
    const statsB = viaGradient.getConsolidationStats();

    // Both start from an all-zero globalFisher and observe the same single
    // gradient-proxy sample, so a matching EMA direction must produce the
    // same post-update Fisher value; the (now-fixed) inverted direction
    // would instead produce dramatically different avgFisherValue for the
    // same decay rate and inputs whenever decay != 0.5.
    expect(statsA.avgFisherValue).toBeCloseTo(statsB.avgFisherValue, 10);
  });

  // Post-review hardening (ruvnet, PR #3395): the EMA-direction fix above was
  // confirmed correct, but the function had no defenses against malformed
  // runtime input or a corrupted/incompatible persisted state file. Fixed
  // fail-closed rather than adding a follow-up candidate.
  it('drops a sample with non-finite embedding values instead of poisoning globalFisher', async () => {
    const { EWCConsolidator } = await import('../src/memory/ewc-consolidation.js');
    const consolidator = new EWCConsolidator({
      dimensions: 4,
      fisherDecayRate: 0.5,
      storagePath: '/tmp/ewc-ema-hardening-test-a.json',
    });

    consolidator.updateFisherFromConfidences([
      { id: 'good', embedding: [3, 3, 3, 3], oldConf: 0.2, newConf: 0.8 },
    ]);
    const beforeBad = consolidator.getConsolidationStats().avgFisherValue;

    consolidator.updateFisherFromConfidences([
      { id: 'nan-embedding', embedding: [NaN, 1, 1, 1], oldConf: 0.2, newConf: 0.8 },
      { id: 'infinite-embedding', embedding: [Infinity, 1, 1, 1], oldConf: 0.2, newConf: 0.8 },
      { id: 'nan-confidence', embedding: [1, 1, 1, 1], oldConf: NaN, newConf: 0.8 },
      { id: 'infinite-confidence', embedding: [1, 1, 1, 1], oldConf: 0.2, newConf: Infinity },
    ]);
    const afterBad = consolidator.getConsolidationStats().avgFisherValue;

    // Every entry in the second batch was malformed, so none contributed a
    // sample -- globalFisher (and avgFisherValue) must be byte-identical to
    // before, and in particular must not have become NaN.
    expect(afterBad).toBe(beforeBad);
    expect(Number.isFinite(afterBad)).toBe(true);
  });

  it('leaves globalFisher and persisted state untouched when no sample contributes (all deltas zero)', async () => {
    const { EWCConsolidator } = await import('../src/memory/ewc-consolidation.js');
    const storagePath = '/tmp/ewc-ema-hardening-test-b.json';
    const fs = await import('node:fs');
    if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);

    const consolidator = new EWCConsolidator({
      dimensions: 4,
      fisherDecayRate: 0.5,
      storagePath,
    });

    // No prior signal established, and this batch's only entry has a zero
    // confidence delta -- sampleCount stays 0.
    consolidator.updateFisherFromConfidences([
      { id: 'no-op', embedding: [5, 5, 5, 5], oldConf: 0.5, newConf: 0.5 },
    ]);

    expect(consolidator.getConsolidationStats().avgFisherValue).toBe(0);
    // A no-contributing-sample update must not persist -- it has nothing new
    // to record and decaying accumulated importance toward an empty batch
    // would defeat the same anti-forgetting purpose the EMA fix restores.
    expect(fs.existsSync(storagePath)).toBe(false);
  });

  it('quarantines a corrupted persisted globalFisher on load instead of resuming from it', async () => {
    const { EWCConsolidator } = await import('../src/memory/ewc-consolidation.js');
    const fs = await import('node:fs');
    const storagePath = '/tmp/ewc-ema-hardening-test-c.json';

    fs.writeFileSync(
      storagePath,
      JSON.stringify({
        version: '1.0.0',
        config: { lambda: 0.4, dimensions: 4, fisherDecayRate: 0.01 },
        // Corrupted: a non-finite value survived a lossy JSON round-trip as
        // `null`, and one entry is negative (impossible for a real Fisher
        // value, which is always a sum of squares).
        globalFisher: [1.5, null, -2, 3],
        patterns: [],
        consolidationHistory: [],
        savedAt: Date.now(),
      }),
    );

    const consolidator = new EWCConsolidator({ dimensions: 4, storagePath });
    await consolidator.initialize();

    // The whole array is quarantined (not element-by-element patched) --
    // resuming with a zeroed Fisher is a known-safe state; silently keeping
    // 3 of 4 "plausible-looking" values from a file already proven corrupt
    // is not.
    expect(consolidator.getConsolidationStats().avgFisherValue).toBe(0);
  });
});
