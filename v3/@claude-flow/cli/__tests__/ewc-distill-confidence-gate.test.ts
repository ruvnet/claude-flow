/**
 * Dream Cycle 2026-08-27 (intelligence surface).
 *
 * `LocalSonaCoordinator.distillLearning()` (memory/intelligence.ts) gates every
 * pattern-confidence update behind an EWC "forgetting" penalty. Before this
 * fix, it called `EWCConsolidator.getPenalty(oldWeights, newWeights)` with
 * 1-element weight arrays (`[oldConfidence]`, `[proposedConfidence]`) and no
 * explicit `fisher` argument. `getPenalty()`'s length guard
 * (`Math.min(oldWeights.length, newWeights.length, fisherDiag.length)`)
 * collapses that call to reading only `globalFisher[0]` — one arbitrary
 * dimension out of 384 — regardless of the pattern's actual embedding, so
 * every pattern got an identical, embedding-independent penalty. Two
 * purpose-built methods for exactly this scalar-confidence case already
 * existed in the same file (`computeConfidencePenalty`,
 * `updateFisherFromConfidences` — their own docstrings say "used by SONA
 * after distillLearning") but were never called from production. This test
 * regression-guards the wiring: distillLearning() must use the
 * full-diagonal-aware methods, not the 1-element-collapsing ones.
 *
 * Runs in a temp cwd so ReasoningBank/EWC disk persistence never touches the
 * real repo tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('#dream-2026-08-27 distillLearning EWC confidence gate', () => {
  let tmpRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-ewc-distill-'));
    process.chdir(tmpRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('uses computeConfidencePenalty/updateFisherFromConfidences, never getPenalty([x],[y])/recordGradient', async () => {
    const intelligence = await import('../src/memory/intelligence.js');
    const ewcModule = await import('../src/memory/ewc-consolidation.js');

    ewcModule.resetEWCConsolidator();
    intelligence.clearIntelligence();

    const computeConfidencePenaltySpy = vi.spyOn(
      ewcModule.EWCConsolidator.prototype,
      'computeConfidencePenalty',
    );
    const updateFisherFromConfidencesSpy = vi.spyOn(
      ewcModule.EWCConsolidator.prototype,
      'updateFisherFromConfidences',
    );
    const getPenaltySpy = vi.spyOn(ewcModule.EWCConsolidator.prototype, 'getPenalty');
    const recordGradientSpy = vi.spyOn(ewcModule.EWCConsolidator.prototype, 'recordGradient');

    await intelligence.initializeIntelligence();

    const embedding = new Array(384).fill(0).map((_, i) => (i % 7 === 0 ? 0.9 : 0.05));

    // First trajectory: bank is empty, so distillLearning finds nothing similar
    // yet; this call only seeds a pattern (confidence 0.8) for the next call.
    await intelligence.recordTrajectory(
      [{ type: 'action', content: 'first run of a repeatable action', embedding }],
      'success',
    );

    // Second trajectory: an (almost) identical embedding is now similar to the
    // pattern stored by the first call, so distillLearning's confidence-update
    // gate actually executes this time.
    await intelligence.recordTrajectory(
      [{ type: 'action', content: 'second run of the same repeatable action', embedding }],
      'success',
    );

    expect(computeConfidencePenaltySpy).toHaveBeenCalled();
    expect(updateFisherFromConfidencesSpy).toHaveBeenCalled();
    // The old, defect-shaped call pattern must not reappear.
    expect(getPenaltySpy).not.toHaveBeenCalled();
    expect(recordGradientSpy).not.toHaveBeenCalled();
  });
});
