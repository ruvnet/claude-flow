import { describe, it, expect } from 'vitest';
import { prisonersDilemma as PD } from '../src/domain/games.js';
import { classicRoster } from '../src/domain/strategies.js';
import { coevolve, evolveVsField } from '../src/engine/evolution.js';

describe('evolution', () => {
  it('hill-climb fitness is monotonic non-decreasing (best-so-far)', () => {
    const r = evolveVsField(PD, classicRoster(PD), { generations: 200, seed: 42 });
    for (let i = 1; i < r.curve.length; i++) {
      expect(r.curve[i].fitness).toBeGreaterThanOrEqual(r.curve[i - 1].fitness - 1e-9);
    }
  });

  it('improves on its random starting point', () => {
    const r = evolveVsField(PD, classicRoster(PD), { generations: 300, seed: 42 });
    expect(r.bestFitness).toBeGreaterThanOrEqual(r.curve[0].fitness);
  });

  it('is deterministic under a fixed seed', () => {
    const a = evolveVsField(PD, classicRoster(PD), { generations: 150, seed: 7 });
    const b = evolveVsField(PD, classicRoster(PD), { generations: 150, seed: 7 });
    expect(a.bestFitness).toBe(b.bestFitness);
    expect(a.best).toEqual(b.best);
  });

  it('co-evolution records a finite arms-race trace', () => {
    const r = coevolve(PD, { generations: 200, seed: 7 });
    expect(r.curve.length).toBe(201);
    for (const pt of r.curve) expect(Number.isFinite(pt.payoffA)).toBe(true);
  });
});
