import { describe, it, expect } from 'vitest';
import { prisonersDilemma as PD, matchOrNot as MON } from '../src/domain/games.js';
import { copyOpponent, constant, pavlov } from '../src/domain/strategies.js';
import { runMatch } from '../src/engine/arena.js';

describe('games', () => {
  it('PD uses the classic R/T/S/P payoffs', () => {
    expect(PD.payoff('C', 'C')).toEqual([3, 3]);
    expect(PD.payoff('D', 'C')).toEqual([5, 0]);
    expect(PD.payoff('C', 'D')).toEqual([0, 5]);
    expect(PD.payoff('D', 'D')).toEqual([1, 1]);
  });

  it('match-or-not is zero-sum', () => {
    for (const a of MON.actions)
      for (const b of MON.actions) {
        const [pa, pb] = MON.payoff(a, b);
        expect(pa + pb).toBe(0);
      }
  });
});

describe('arena', () => {
  it('tit-for-tat vs tit-for-tat fully cooperates (mean 3)', () => {
    const tft = copyOpponent(PD.actions, 0);
    const r = runMatch(PD, tft, tft, { rounds: 200, seed: 1 });
    expect(r.mean).toEqual([3, 3]);
  });

  it('always-cooperate is exploited by always-defect', () => {
    const allC = constant(PD.actions, 0);
    const allD = constant(PD.actions, 1);
    expect(runMatch(PD, allC, allD, { rounds: 100 }).mean[0]).toBe(0);
    expect(runMatch(PD, allD, allC, { rounds: 100 }).mean[0]).toBe(5);
  });

  it('tit-for-tat limits losses against always-defect (~1)', () => {
    const m = runMatch(PD, copyOpponent(PD.actions, 0), constant(PD.actions, 1), { rounds: 200 }).mean[0];
    expect(m).toBeGreaterThan(0.9);
    expect(m).toBeLessThanOrEqual(1.0);
  });

  it('pavlov cooperates with itself', () => {
    const p = pavlov(PD.actions);
    expect(runMatch(PD, p, p, { rounds: 100 }).mean[0]).toBe(3);
  });

  it('is deterministic under a fixed seed', () => {
    const tft = copyOpponent(PD.actions, 0);
    const a = runMatch(PD, tft, tft, { rounds: 50, seed: 123, history: true });
    const b = runMatch(PD, tft, tft, { rounds: 50, seed: 123, history: true });
    expect(a.history).toEqual(b.history);
  });
});
