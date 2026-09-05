// Adaptive evolution (Ruflo ADR-148).
//   evolveVsField — hill-climb a strategy against a fixed roster (mutate -> keep if fitter).
//   coevolve      — two strategies evolve against each other (Wolfram's mutual co-evolution).
// Fitness curves expose the plateau -> breakthrough structure Wolfram highlights.

import { mulberry32, derive } from './rng.js';
import { meanPayoff } from './arena.js';
import { randomFSM, mutate } from '../domain/strategies.js';
import type { CoevolutionResult, EvolutionResult, FsmStrategy, GameSpec, Strategy } from '../domain/types.js';

/** Fitness = mean-vs-field: average mean-payoff against every opponent in the roster. */
export function fitnessVsField(
  game: GameSpec,
  fsm: FsmStrategy,
  roster: Strategy[],
  rounds: number,
  evalSeed: number,
): number {
  let sum = 0;
  for (const opp of roster) sum += meanPayoff(game, fsm, opp, rounds, evalSeed);
  return sum / roster.length;
}

export interface EvolveOptions {
  generations?: number;
  seed?: number;
  rounds?: number;
  startStates?: number;
}

/** Hill-climb one FSM against a fixed field. Accept a mutation iff it does not lower fitness. */
export function evolveVsField(game: GameSpec, roster: Strategy[], opts: EvolveOptions = {}): EvolutionResult {
  const { generations = 300, seed = 42, rounds = 100, startStates = 2 } = opts;
  const rng = mulberry32(derive(seed, 7));
  const evalSeed = derive(seed, 99);

  let cur = randomFSM(game, rng, startStates, 'evolved');
  let curFit = fitnessVsField(game, cur, roster, rounds, evalSeed);
  const curve: EvolutionResult['curve'] = [{ gen: 0, fitness: curFit, accepted: true, nStates: cur.nStates }];

  for (let g = 1; g <= generations; g++) {
    const cand = mutate(cur, game, rng);
    const candFit = fitnessVsField(game, cand, roster, rounds, evalSeed);
    const accepted = candFit >= curFit;
    if (accepted) {
      cur = cand;
      curFit = candFit;
    }
    curve.push({ gen: g, fitness: curFit, accepted, nStates: cur.nStates });
  }

  return { best: cur, bestFitness: curFit, curve, generations };
}

export interface CoevolveOptions {
  generations?: number;
  seed?: number;
  rounds?: number;
  startStates?: number;
}

/** Mutual co-evolution: A and B take turns; each keeps a mutation iff it helps it head-to-head. */
export function coevolve(game: GameSpec, opts: CoevolveOptions = {}): CoevolutionResult {
  const { generations = 400, seed = 7, rounds = 100, startStates = 2 } = opts;
  const rng = mulberry32(derive(seed, 11));
  const evalSeed = derive(seed, 23);

  let a = randomFSM(game, rng, startStates, 'A');
  let b = randomFSM(game, rng, startStates, 'B');

  // Cache the current (A vs B) baseline so each generation runs ONE match
  // (the candidate's), not three (candidate + old baseline + curve sample).
  // Numerically identical — the seed is fixed — but ~3x fewer matches per gen.
  let baseline = meanPayoff(game, a, b, rounds, evalSeed);

  const curve: CoevolutionResult['curve'] = [{ gen: 0, side: 'init', payoffA: baseline }];
  for (let g = 1; g <= generations; g++) {
    if (g % 2 === 1) {
      const cand = mutate(a, game, rng);
      const candFit = meanPayoff(game, cand, b, rounds, evalSeed);
      if (candFit >= baseline) { a = cand; baseline = candFit; }
    } else {
      const cand = mutate(b, game, rng);
      // B wants to MINIMISE A's payoff (zero-sum in a 2-player setting).
      const candFit = meanPayoff(game, a, cand, rounds, evalSeed);
      if (candFit <= baseline) { b = cand; baseline = candFit; }
    }
    curve.push({ gen: g, side: g % 2 === 1 ? 'A' : 'B', payoffA: baseline });
  }
  return { a, b, curve, generations };
}
