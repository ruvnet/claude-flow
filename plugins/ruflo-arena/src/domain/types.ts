// Domain contracts for competitive ruliology (Ruflo ADR-147/148).
// Strategies are *programs*; games are payoff matrices; runs are reproducible artifacts.

import { z } from 'zod';

export type ActionSymbol = string;
export type Payoff = readonly [number, number];

/** A 2-player, simultaneous-move game defined by its payoff matrix. */
export interface GameSpec {
  readonly name: string;
  readonly actions: readonly ActionSymbol[];
  readonly zeroSum: boolean;
  payoff(a: ActionSymbol, b: ActionSymbol): Payoff;
}

/** One state of a Moore machine: the action it emits + transitions on the opponent's action. */
export interface FsmState {
  action: ActionSymbol;
  next: Record<ActionSymbol, number>;
}

/** A strategy expressed as a deterministic finite-state (Moore) machine. */
export interface FsmStrategy {
  kind: 'fsm';
  name: string;
  nStates: number;
  start: number;
  states: FsmState[];
}

/** A strategy expressed as a closure (e.g. a stochastic strategy using the seeded rng). */
export interface FnStrategy<S = unknown> {
  kind: 'fn';
  name: string;
  init: (rng: () => number) => S;
  act: (state: S, rng: () => number) => ActionSymbol;
  update: (state: S, own: ActionSymbol, opp: ActionSymbol, rng: () => number) => S;
}

export type Strategy = FsmStrategy | FnStrategy;

/** A running instance of a strategy (Moore semantics: emit on state, transition on opponent). */
export interface AgentInstance {
  act(): ActionSymbol;
  observe(own: ActionSymbol, opp: ActionSymbol): void;
}

export interface MatchResult {
  game: string;
  a: string;
  b: string;
  rounds: number;
  seed: number;
  cumulative: [number, number];
  mean: [number, number];
  history: Array<{ round: number; aAct: ActionSymbol; bAct: ActionSymbol; pA: number; pB: number }> | null;
}

export interface TournamentResult {
  game: string;
  rounds: number;
  seed: number;
  names: string[];
  matrix: number[][];
  meanVsField: number[];
  ranking: Array<{ name: string; meanVsField: number }>;
}

export interface EvolutionResult {
  best: FsmStrategy;
  bestFitness: number;
  generations: number;
  curve: Array<{ gen: number; fitness: number; accepted: boolean; nStates: number }>;
}

export interface CoevolutionResult {
  a: FsmStrategy;
  b: FsmStrategy;
  generations: number;
  curve: Array<{ gen: number; side: string; payoffA: number }>;
}

export type RunKind = 'arena' | 'tournament' | 'evolution' | 'coevolution';

/** A persisted, queryable record of a competition run (local stand-in for RuVector ADR-197). */
export interface RunRecord {
  runId: string;
  kind: RunKind;
  game: string;
  seed: number;
  createdAt: string;
  summary: Record<string, unknown>;
  artifact: unknown;
}

// ---------------------------------------------------------------------------
// Zod input schemas — validated at MCP tool boundaries (Ruflo: validate at boundaries).
// Numbers are coerced because MCP/CLI inputs may arrive as strings.
// ---------------------------------------------------------------------------

const gameKey = z.string().min(1);

export const ArenaRunSchema = z.object({
  game: gameKey.default('pd'),
  a: z.string().default('tit-for-tat'),
  b: z.string().default('always-defect'),
  rounds: z.coerce.number().int().positive().max(100_000).default(200),
  seed: z.coerce.number().int().default(1),
  history: z.coerce.boolean().default(false),
  persist: z.coerce.boolean().default(true),
});

export const TournamentRunSchema = z.object({
  game: gameKey.default('pd'),
  rounds: z.coerce.number().int().positive().max(100_000).default(200),
  seed: z.coerce.number().int().default(1),
  includeSelf: z.coerce.boolean().default(true),
  persist: z.coerce.boolean().default(true),
});

export const EvolveRunSchema = z.object({
  game: gameKey.default('pd'),
  generations: z.coerce.number().int().positive().max(50_000).default(300),
  seed: z.coerce.number().int().default(42),
  rounds: z.coerce.number().int().positive().max(100_000).default(100),
  startStates: z.coerce.number().int().min(1).max(32).default(2),
  persist: z.coerce.boolean().default(true),
});

export const CoevolveRunSchema = z.object({
  game: gameKey.default('pd'),
  generations: z.coerce.number().int().positive().max(50_000).default(400),
  seed: z.coerce.number().int().default(7),
  rounds: z.coerce.number().int().positive().max(100_000).default(100),
  startStates: z.coerce.number().int().min(1).max(32).default(2),
  persist: z.coerce.boolean().default(true),
});

export const RunGetSchema = z.object({ runId: z.string().min(1) });
export const RunListSchema = z.object({ limit: z.coerce.number().int().positive().max(1000).default(20) });

export type ArenaRunInput = z.infer<typeof ArenaRunSchema>;
export type TournamentRunInput = z.infer<typeof TournamentRunSchema>;
export type EvolveRunInput = z.infer<typeof EvolveRunSchema>;
export type CoevolveRunInput = z.infer<typeof CoevolveRunSchema>;
