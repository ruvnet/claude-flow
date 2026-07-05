/**
 * Stateful flywheel — the autonomy loop (ADR-176 A-P3b). Proves the daemon path
 * COMPOUNDS across ticks (winner→next baseline via persisted lineage), is
 * shadow-first (serve lags promotion by one tick), and surfaces status. Deps
 * injected → deterministic, no ONNX.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runFlywheelGeneration, checkServedChampionDrift, flywheelStatus, loadPromotions, currentChampion, servedChampion,
  axisEffectiveness, biasedGrid,
  type GenerationDeps, type AnchorTask,
} from '../src/services/harness-flywheel-generations.js';
import type { RankedItem } from '../src/services/harness-flywheel.js';

// 60 docs; each body carries its own id token 3× so the harvested query recovers it.
const patterns = Array.from({ length: 60 }, (_, i) => {
  const id = `p${String(i).padStart(2, '0')}`;
  return { id, name: `feature ${i}`, content: `${id} ${id} ${id} alpha beta gamma delta epsilon widget subsystem` };
});
const anchor: AnchorTask[] = [{ id: 'anchor-0', q: 'anchor find zero', labels: ['feature 0'] }];

// Stub: self-retrieval rank of the target improves in TWO steps as alpha falls
// (0.5→rank3, ~0.3→rank1, ~0.2→rank0) → two successive improvements possible.
// Anchor ranking is config-independent → human relevance flat → redblue PASS.
function makeDeps(now: number, applyLog?: string[]): GenerationDeps {
  return {
    getPatterns: () => patterns,
    search: (q, cfg) => {
      const m = q.match(/p\d+/);
      const ids: RankedItem[] = patterns.map((p) => ({ id: p.id, name: p.name }));
      if (m) {
        const idx = ids.findIndex((x) => x.id === m[0]);
        const to = cfg.alpha <= 0.25 ? 0 : cfg.alpha <= 0.45 ? 1 : 3;
        const [item] = ids.splice(idx, 1); ids.splice(to, 0, item);
        return ids.slice(0, 5);
      }
      return ids.slice(0, 5); // anchor: fixed → 'feature 0' at rank 0 → constant nDCG
    },
    anchorTasks: anchor,
    sample: 120,
    now,
    applyFn: (cfg, hash) => { applyLog?.push(hash); },
  };
}

describe('runFlywheelGeneration — compounding autonomy loop', () => {
  it('compounds across ticks and is shadow-first (serve lags promotion by one tick)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fwg-'));
    const applied: string[] = [];

    // tick 0: first generation off the DEFAULT baseline → promotes; NOT served yet (shadow).
    const g0 = await runFlywheelGeneration(root, makeDeps(1000, applied));
    expect(g0.ran).toBe(true);
    expect(g0.promoted).toBe(true);
    expect(g0.generation).toBe(0);
    expect(g0.anchorRegressed).toBe(false);       // human relevance preserved
    expect(loadPromotions(root).length).toBe(1);
    expect(servedChampion(root).championHash).toBeNull(); // shadow — nothing served yet
    expect(applied.length).toBe(0);

    // tick 1: serves gen-0 champion FIRST (1-tick shadow delay), then compounds → gen-1.
    const g1 = await runFlywheelGeneration(root, makeDeps(2000, applied));
    const promos = loadPromotions(root);
    expect(servedChampion(root).championHash).toBe(promos[0].candidateManifestHash); // gen-0 now served
    expect(applied[0]).toBe(promos[0].candidateManifestHash);
    expect(g1.promoted).toBe(true);
    expect(g1.generation).toBe(1);
    // compounding: gen-1's baseline is gen-0's promoted candidate.
    expect(promos[1].baselineManifestHash).toBe(promos[0].candidateManifestHash);
    expect(promos[1].deltas.benchmark).toBeGreaterThan(0);
  });

  it('surfaces an auditable status: intact replayable lineage + telemetry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fwg-'));
    await runFlywheelGeneration(root, makeDeps(1000));
    await runFlywheelGeneration(root, makeDeps(2000));
    await runFlywheelGeneration(root, makeDeps(3000)); // likely a refusal (ceiling) — still recorded

    const s = flywheelStatus(root);
    expect(s.generations).toBeGreaterThanOrEqual(2);
    expect(s.lineage.promotions).toBe(s.generations);
    expect(s.lineage.lineageIntact).toBe(true);       // chains back to the immutable root
    expect(s.lineage.allReplayable).toBe(true);        // every bundle re-runs accept/v1+sig
    expect(s.attempts).toBeGreaterThanOrEqual(s.generations); // refusals recorded too
    expect(s.mutation[0].mutationClass).toMatch(/retrieval/);
    expect(s.champion.hash).toBe(currentChampion(root).hash);
  });

  it('meta-learning: attributes payoff to the axis that moved and biases the search toward it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fwg-'));
    await runFlywheelGeneration(root, makeDeps(1000)); // gen 0 moves alpha (the only axis that helps)
    const promos = loadPromotions(root);
    expect(promos.length).toBeGreaterThanOrEqual(1);

    const eff = axisEffectiveness(promos);
    expect(eff[0].axis).toBe('alpha');           // alpha ranked top by measured Δ
    expect(eff[0].meanDelta).toBeGreaterThan(0);

    // the biased grid explores the productive axis (alpha) at a wider range than
    // an unproductive one, and includes joint moves only among productive axes.
    const champ = currentChampion(root).config as { alpha: number; subjectWeight: number };
    const grid = biasedGrid(champ as never, eff);
    const alphaVariants = new Set(grid.map((g) => g.alpha)).size;
    const bwVariants = new Set(grid.map((g) => g.bodyWeight)).size; // unproductive here
    expect(alphaVariants).toBeGreaterThan(bwVariants); // compute concentrated on the paying axis
  });

  it('deployment canary: rolls back a served champion that has DRIFTED on the current store', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fwg-'));
    await runFlywheelGeneration(root, makeDeps(1000)); // gen 0 promoted (low-alpha champion)
    await runFlywheelGeneration(root, makeDeps(2000)); // serves gen 0
    expect(servedChampion(root).championHash).not.toBeNull();

    // stable: on the SAME store the served champion still beats its predecessor.
    const stable = await checkServedChampionDrift(root, makeDeps(3000));
    expect(stable.checked).toBe(true);
    expect(stable.rolledBack).toBe(false);

    // DRIFT: the store's signal flips (now HIGHER alpha wins) → the served
    // low-alpha champion underperforms its predecessor → auto rollback.
    const drifted = await checkServedChampionDrift(root, {
      ...makeDeps(4000),
      search: (q, cfg) => {
        const m = q.match(/p\d+/);
        const ids = patterns.map((p) => ({ id: p.id, name: p.name }));
        if (m) { const i = ids.findIndex((x) => x.id === m[0]); const to = cfg.alpha >= 0.45 ? 0 : 3; const [it] = ids.splice(i, 1); ids.splice(to, 0, it); return ids.slice(0, 5); }
        return ids.slice(0, 5);
      },
    });
    expect(drifted.checked).toBe(true);
    expect(drifted.rolledBack).toBe(true);
    expect(servedChampion(root).championHash).toBeNull(); // reverted
  });

  it('no-op (never throws) on a store too small to harvest', async () => {
    const root = mkdtempSync(join(tmpdir(), 'fwg-'));
    const r = await runFlywheelGeneration(root, { ...makeDeps(1), getPatterns: () => patterns.slice(0, 5) });
    expect(r.ran).toBe(false);
    expect(r.reason).toMatch(/too small/);
  });
});
