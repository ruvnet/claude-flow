// MCP tools for ruflo-arena (Ruflo ADR-147/148). Tool shape matches the Ruflo convention:
// { name, description, category, inputSchema, handler } with Zod validation at the boundary
// and a `{ success, result | error }` return envelope.

import { z } from 'zod';
import {
  ArenaRunSchema,
  CoevolveRunSchema,
  EvolveRunSchema,
  RunGetSchema,
  RunListSchema,
  TournamentRunSchema,
} from '../domain/types.js';
import { getGame } from '../domain/games.js';
import { classicRoster, findStrategy } from '../domain/strategies.js';
import { runMatch } from '../engine/arena.js';
import { runTournament } from '../engine/tournament.js';
import { coevolve, evolveVsField } from '../engine/evolution.js';
import { competitiveArrayTable, evolutionSummary, rankingTable, sparkline } from '../report/render.js';
import {
  FileRunStore,
  agentdbRecord,
  makeRecord,
  type RunStore,
} from '../persistence/run-store.js';

export interface MCPTool {
  name: string;
  description: string;
  category: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

const ok = (result: unknown) => ({ success: true as const, result });
const fail = (err: unknown) => ({
  success: false as const,
  error: { message: err instanceof Error ? err.message : String(err) },
});

const num = (description: string, def?: number) => ({ type: 'number', description: def === undefined ? description : `${description} (default ${def})` });
const str = (description: string, def?: string) => ({ type: 'string', description: def === undefined ? description : `${description} (default "${def}")` });
const bool = (description: string, def: boolean) => ({ type: 'boolean', description: `${description} (default ${def})` });

/** Build the tool set against a given RunStore (inject InMemoryRunStore in tests). */
export function createArenaTools(store: RunStore): MCPTool[] {
  return [
    {
      name: 'arena/run',
      description:
        'Run a single deterministic match between two named strategies under a payoff game. Returns cumulative and mean payoffs; reproducible under --seed.',
      category: 'arena',
      inputSchema: {
        type: 'object',
        properties: {
          game: str('Game key: pd | prisoners-dilemma | mon | match-or-not', 'pd'),
          a: str('Strategy A name (from the classic roster)', 'tit-for-tat'),
          b: str('Strategy B name', 'always-defect'),
          rounds: num('Number of rounds', 200),
          seed: num('PRNG seed for reproducibility', 1),
          history: bool('Include per-round move log', false),
          persist: bool('Persist the run via the RunStore', true),
        },
      },
      handler: async (input) => {
        try {
          const args = ArenaRunSchema.parse(input);
          const game = getGame(args.game);
          const a = findStrategy(game, args.a);
          const b = findStrategy(game, args.b);
          const match = runMatch(game, a, b, { rounds: args.rounds, seed: args.seed, history: args.history });
          const summary = { a: match.a, b: match.b, rounds: match.rounds, mean: match.mean, cumulative: match.cumulative };
          if (!args.persist) return ok({ ...summary, game: game.name, seed: args.seed });
          const record = makeRecord('arena', game.name, args.seed, summary, match);
          await store.save(record);
          return ok({ runId: record.runId, game: game.name, seed: args.seed, ...summary, agentdb: agentdbRecord(record) });
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: 'tournament/run',
      description:
        "Round-robin tournament over the classic roster, producing Wolfram's competitive array (mean-payoff matrix) and a mean-vs-field ranking.",
      category: 'arena',
      inputSchema: {
        type: 'object',
        properties: {
          game: str('Game key', 'pd'),
          rounds: num('Rounds per match', 200),
          seed: num('PRNG seed', 1),
          includeSelf: bool('Include self-play (diagonal) in mean-vs-field', true),
          persist: bool('Persist the run', true),
        },
      },
      handler: async (input) => {
        try {
          const args = TournamentRunSchema.parse(input);
          const game = getGame(args.game);
          const t = runTournament(game, classicRoster(game), {
            rounds: args.rounds,
            seed: args.seed,
            includeSelf: args.includeSelf,
          });
          const summary = { winner: t.ranking[0], ranking: t.ranking, names: t.names };
          const result = {
            game: t.game,
            rounds: t.rounds,
            seed: t.seed,
            ranking: t.ranking,
            matrix: t.matrix,
            names: t.names,
            tables: { competitiveArray: competitiveArrayTable(t), ranking: rankingTable(t) },
          };
          if (!args.persist) return ok(result);
          const record = makeRecord('tournament', game.name, args.seed, summary, t);
          await store.save(record);
          return ok({ runId: record.runId, ...result, agentdb: agentdbRecord(record) });
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: 'evolve/run',
      description:
        'Hill-climb (mutate -> keep-if-fitter) an FSM strategy against the classic field. Returns the evolved program, its fitness, and the fitness curve (plateau -> breakthrough structure).',
      category: 'arena',
      inputSchema: {
        type: 'object',
        properties: {
          game: str('Game key', 'pd'),
          generations: num('Number of generations', 300),
          seed: num('PRNG seed', 42),
          rounds: num('Rounds per evaluation match', 100),
          startStates: num('Initial FSM state count', 2),
          persist: bool('Persist the run', true),
        },
      },
      handler: async (input) => {
        try {
          const args = EvolveRunSchema.parse(input);
          const game = getGame(args.game);
          const r = evolveVsField(game, classicRoster(game), {
            generations: args.generations,
            seed: args.seed,
            rounds: args.rounds,
            startStates: args.startStates,
          });
          const summary = { ...evolutionSummary(r), generations: r.generations };
          const result = {
            game: game.name,
            ...summary,
            best: r.best,
            sparkline: sparkline(r.curve.map((c) => c.fitness)),
          };
          if (!args.persist) return ok(result);
          const record = makeRecord('evolution', game.name, args.seed, summary, r);
          await store.save(record);
          return ok({ runId: record.runId, ...result, agentdb: agentdbRecord(record) });
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: 'coevolve/run',
      description:
        "Mutual co-evolution: two FSM strategies evolve against each other on alternating generations (Wolfram's arms race). Returns the arms-race payoff trace.",
      category: 'arena',
      inputSchema: {
        type: 'object',
        properties: {
          game: str('Game key', 'pd'),
          generations: num('Number of generations', 400),
          seed: num('PRNG seed', 7),
          rounds: num('Rounds per evaluation match', 100),
          startStates: num('Initial FSM state count', 2),
          persist: bool('Persist the run', true),
        },
      },
      handler: async (input) => {
        try {
          const args = CoevolveRunSchema.parse(input);
          const game = getGame(args.game);
          const r = coevolve(game, {
            generations: args.generations,
            seed: args.seed,
            rounds: args.rounds,
            startStates: args.startStates,
          });
          const payoffs = r.curve.map((c) => c.payoffA);
          // Single-pass scan avoids Math.min/max(...spread) — the spread
          // form hits V8's argument-count limit (~16k) for long curves.
          let minP = Infinity, maxP = -Infinity;
          for (const p of payoffs) {
            if (p < minP) minP = p;
            if (p > maxP) maxP = p;
          }
          const summary = {
            generations: r.generations,
            payoffRange: [minP, maxP] as [number, number],
            finalPayoffA: payoffs[payoffs.length - 1],
          };
          const result = { game: game.name, ...summary, sparkline: sparkline(payoffs) };
          if (!args.persist) return ok(result);
          const record = makeRecord('coevolution', game.name, args.seed, summary, r);
          await store.save(record);
          return ok({ runId: record.runId, ...result, agentdb: agentdbRecord(record) });
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: 'run/get',
      description:
        'Fetch a persisted run record by runId. Use when reproducing or inspecting a prior arena/tournament/evolve/coevolve run after seeing its runId in a tool result or via run/list.',
      category: 'arena',
      inputSchema: { type: 'object', properties: { runId: str('Run identifier') }, required: ['runId'] },
      handler: async (input) => {
        try {
          const { runId } = RunGetSchema.parse(input);
          const record = await store.get(runId);
          return record ? ok(record) : fail(`run "${runId}" not found`);
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: 'run/list',
      description:
        'List recent persisted run records (most recent first). Use when browsing prior runs to find a runId to replay, compare strategies across runs, or audit what arena experiments have been executed in this project.',
      category: 'arena',
      inputSchema: { type: 'object', properties: { limit: num('Max records', 20) } },
      handler: async (input) => {
        try {
          const { limit } = RunListSchema.parse(input);
          const records = await store.list(limit);
          return ok(records.map((r) => ({ runId: r.runId, kind: r.kind, game: r.game, seed: r.seed, createdAt: r.createdAt, summary: r.summary })));
        } catch (err) {
          return fail(err);
        }
      },
    },
  ];
}

/**
 * Default tool set, persisting to `.ruflo/arena/` under the process CWD.
 *
 * For hosts that need to control the on-disk location (test sandboxes, multi-tenant
 * runtimes, in-memory only), prefer the {@link createArenaTools} factory with an
 * explicit {@link RunStore} — e.g. `createArenaTools(new InMemoryRunStore())` for
 * tests, or `createArenaTools(new FileRunStore('/custom/path'))` for relocation.
 */
export const arenaTools: MCPTool[] = createArenaTools(new FileRunStore());

// Re-export Zod schemas so hosts can introspect/validate independently.
export const schemas = {
  arena: ArenaRunSchema,
  tournament: TournamentRunSchema,
  evolve: EvolveRunSchema,
  coevolve: CoevolveRunSchema,
} satisfies Record<string, z.ZodTypeAny>;
