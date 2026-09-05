// Arena — a single deterministic, replayable match between two strategies (Ruflo ADR-147).

import { mulberry32, derive } from './rng.js';
import { instantiate } from '../domain/strategies.js';
import type { GameSpec, MatchResult, Strategy } from '../domain/types.js';

export interface MatchOptions {
  rounds?: number;
  seed?: number;
  history?: boolean;
}

export function runMatch(game: GameSpec, stratA: Strategy, stratB: Strategy, opts: MatchOptions = {}): MatchResult {
  const { rounds = 200, seed = 1, history = false } = opts;
  const agentA = instantiate(stratA, mulberry32(derive(seed, 1)));
  const agentB = instantiate(stratB, mulberry32(derive(seed, 2)));

  let sumA = 0;
  let sumB = 0;
  const log: MatchResult['history'] = history ? [] : null;

  for (let r = 0; r < rounds; r++) {
    const aAct = agentA.act();
    const bAct = agentB.act();
    const [pA, pB] = game.payoff(aAct, bAct);
    sumA += pA;
    sumB += pB;
    if (log) log.push({ round: r, aAct, bAct, pA, pB });
    agentA.observe(aAct, bAct);
    agentB.observe(bAct, aAct);
  }

  return {
    game: game.name,
    a: stratA.name,
    b: stratB.name,
    rounds,
    seed,
    cumulative: [sumA, sumB],
    mean: [sumA / rounds, sumB / rounds],
    history: log,
  };
}

/** Mean payoff to A when A plays B for `rounds` (used by tournaments / evolution). */
export function meanPayoff(
  game: GameSpec,
  stratA: Strategy,
  stratB: Strategy,
  rounds: number,
  seed: number,
): number {
  return runMatch(game, stratA, stratB, { rounds, seed }).mean[0];
}
