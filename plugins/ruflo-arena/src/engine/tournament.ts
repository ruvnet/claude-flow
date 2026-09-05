// Tournament — round-robin over a roster producing Wolfram's "competitive array":
// the matrix of mean payoffs for every (strategy, opponent) pair (Ruflo ADR-147).

import { meanPayoff } from './arena.js';
import type { GameSpec, Strategy, TournamentResult } from '../domain/types.js';

export interface TournamentOptions {
  rounds?: number;
  seed?: number;
  includeSelf?: boolean;
}

export function runTournament(game: GameSpec, roster: Strategy[], opts: TournamentOptions = {}): TournamentResult {
  const { rounds = 200, seed = 1, includeSelf = true } = opts;
  const names = roster.map((s) => s.name);
  const n = roster.length;

  // Self-matches (i === j) are skipped when `includeSelf=false` — they're
  // also excluded from `meanVsField` below, so computing them would just be
  // wasted work. The diagonal stays at 0 in that mode (consumers can rely
  // on `includeSelf` to interpret it).
  const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (!includeSelf && i === j) continue;
      matrix[i][j] = meanPayoff(game, roster[i], roster[j], rounds, seed);
    }
  }

  const meanVsField = matrix.map((row, i) => {
    let sum = 0;
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (!includeSelf && i === j) continue;
      sum += row[j];
      count += 1;
    }
    return count ? sum / count : 0;
  });

  const ranking = names
    .map((name, i) => ({ name, meanVsField: meanVsField[i] }))
    .sort((x, y) => y.meanVsField - x.meanVsField);

  return { game: game.name, rounds, seed, names, matrix, meanVsField, ranking };
}
