import { describe, it, expect } from 'vitest';
import { prisonersDilemma as PD } from '../src/domain/games.js';
import { classicRoster } from '../src/domain/strategies.js';
import { runTournament } from '../src/engine/tournament.js';

describe('tournament', () => {
  it('produces a square competitive array consistent with the roster', () => {
    const roster = classicRoster(PD);
    const t = runTournament(PD, roster, { rounds: 200, seed: 1 });
    expect(t.matrix.length).toBe(roster.length);
    for (const row of t.matrix) expect(row.length).toBe(roster.length);
    expect(t.meanVsField.length).toBe(roster.length);
    expect(t.ranking.length).toBe(roster.length);
  });

  it('always-defect is pairwise-unbeatable in PD (dominance)', () => {
    const t = runTournament(PD, classicRoster(PD), { rounds: 200, seed: 1 });
    const allD = t.names.indexOf('always-defect');
    expect(allD).toBeGreaterThanOrEqual(0);
    for (let j = 0; j < t.names.length; j++) {
      expect(t.matrix[allD][j]).toBeGreaterThanOrEqual(t.matrix[j][allD] - 1e-9);
    }
  });

  it('ranking is sorted by mean-vs-field descending', () => {
    const t = runTournament(PD, classicRoster(PD), { rounds: 200, seed: 1 });
    for (let i = 1; i < t.ranking.length; i++) {
      expect(t.ranking[i - 1].meanVsField).toBeGreaterThanOrEqual(t.ranking[i].meanVsField);
    }
  });

  it('is reproducible under a fixed seed', () => {
    const a = runTournament(PD, classicRoster(PD), { rounds: 100, seed: 5 });
    const b = runTournament(PD, classicRoster(PD), { rounds: 100, seed: 5 });
    expect(a.matrix).toEqual(b.matrix);
  });
});
