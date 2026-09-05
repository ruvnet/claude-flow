// GameSpec library — payoff matrices (Ruflo ADR-147). Prisoner's dilemma (symmetric)
// and match-or-not (zero-sum), per Wolfram's "Games Between Programs".

import type { ActionSymbol, GameSpec, Payoff } from './types.js';

export function makeGame(
  name: string,
  actions: readonly ActionSymbol[],
  table: Record<string, Payoff>,
  zeroSum = false,
): GameSpec {
  return {
    name,
    actions,
    zeroSum,
    payoff(a, b) {
      const cell = table[`${a}|${b}`];
      if (!cell) throw new Error(`${name}: no payoff for (${a}, ${b})`);
      return cell;
    },
  };
}

/** Iterated Prisoner's Dilemma — classic R=3, T=5, S=0, P=1. */
export const prisonersDilemma: GameSpec = makeGame(
  'prisoners-dilemma',
  ['C', 'D'],
  {
    'C|C': [3, 3],
    'C|D': [0, 5],
    'D|C': [5, 0],
    'D|D': [1, 1],
  },
  false,
);

/** Match-or-not (zero-sum): A scores when actions agree, B when they differ. */
export const matchOrNot: GameSpec = makeGame(
  'match-or-not',
  ['0', '1'],
  {
    '0|0': [1, -1],
    '1|1': [1, -1],
    '0|1': [-1, 1],
    '1|0': [-1, 1],
  },
  true,
);

export const GAMES: Record<string, GameSpec> = {
  'prisoners-dilemma': prisonersDilemma,
  pd: prisonersDilemma,
  'match-or-not': matchOrNot,
  mon: matchOrNot,
};

export function getGame(key: string): GameSpec {
  const g = GAMES[key];
  if (!g) throw new Error(`unknown game "${key}". Known: ${Object.keys(GAMES).join(', ')}`);
  return g;
}
