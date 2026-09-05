#!/usr/bin/env node
// Human-facing CLI for ruflo-arena. Subcommands mirror the MCP tools (ADR-147).
//   ruflo-arena demo | arena | tournament | evolve | coevolve

import { getGame } from './domain/games.js';
import { classicRoster, findStrategy } from './domain/strategies.js';
import { runMatch } from './engine/arena.js';
import { runTournament } from './engine/tournament.js';
import { coevolve, evolveVsField } from './engine/evolution.js';
import {
  competitiveArrayTable,
  describeFSM,
  evolutionSummary,
  heatmap,
  rankingTable,
  sparkline,
} from './report/render.js';

type Flags = Record<string, string>;

function parseArgs(argv: string[]): { command: string; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      flags[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    } else positional.push(a);
  }
  return { command: positional[0] ?? 'demo', flags };
}

function cmdArena(flags: Flags): void {
  const game = getGame(flags.game ?? 'pd');
  const a = findStrategy(game, flags.a ?? 'tit-for-tat');
  const b = findStrategy(game, flags.b ?? 'always-defect');
  const res = runMatch(game, a, b, { rounds: Number(flags.rounds ?? 200), seed: Number(flags.seed ?? 1) });
  console.log(`\nArena — ${game.name}  (${res.rounds} rounds, seed ${res.seed})`);
  console.log(`  ${a.name}  vs  ${b.name}`);
  console.log(`  cumulative : ${res.cumulative[0]} : ${res.cumulative[1]}`);
  console.log(`  mean/round : ${res.mean[0].toFixed(3)} : ${res.mean[1].toFixed(3)}`);
}

function cmdTournament(flags: Flags): void {
  const game = getGame(flags.game ?? 'pd');
  const t = runTournament(game, classicRoster(game), {
    rounds: Number(flags.rounds ?? 200),
    seed: Number(flags.seed ?? 1),
  });
  console.log(`\nCompetitive array — ${game.name}  (${t.rounds} rounds, seed ${t.seed})`);
  console.log('rows = strategy, cols = opponent; cell = mean payoff to row\n');
  console.log(competitiveArrayTable(t));
  console.log('\nheatmap:\n' + heatmap(t.matrix));
  console.log('\nRanking (mean-vs-field):');
  console.log(rankingTable(t));
}

function cmdEvolve(flags: Flags): void {
  const game = getGame(flags.game ?? 'pd');
  const r = evolveVsField(game, classicRoster(game), {
    generations: Number(flags.generations ?? 300),
    seed: Number(flags.seed ?? 42),
    rounds: Number(flags.rounds ?? 100),
  });
  const s = evolutionSummary(r);
  console.log(`\nEvolve vs field — ${game.name}  (${r.generations} generations, seed ${flags.seed ?? 42})`);
  console.log(`  start fitness : ${s.startFitness.toFixed(3)}`);
  console.log(`  final fitness : ${s.finalFitness.toFixed(3)}   (accepted mutations: ${s.acceptedMutations})`);
  console.log(`  fitness curve : ${sparkline(r.curve.map((c) => c.fitness))}`);
  console.log('\nEvolved strategy:\n' + describeFSM(r.best));
}

function cmdCoevolve(flags: Flags): void {
  const game = getGame(flags.game ?? 'pd');
  const r = coevolve(game, {
    generations: Number(flags.generations ?? 400),
    seed: Number(flags.seed ?? 7),
    rounds: Number(flags.rounds ?? 100),
  });
  const payoffs = r.curve.map((c) => c.payoffA);
  console.log(`\nCo-evolution (arms race) — ${game.name}  (${r.generations} generations)`);
  console.log("  A's head-to-head payoff over time (A maximises, B minimises):");
  console.log('  ' + sparkline(payoffs));
  console.log(`  range: [${Math.min(...payoffs).toFixed(2)}, ${Math.max(...payoffs).toFixed(2)}]`);
}

function cmdDemo(): void {
  console.log('============================================================');
  console.log(' ruflo-arena — competitive ruliology demo (ADR-147/148/150)');
  console.log('============================================================');
  cmdTournament({ game: 'pd', rounds: '200', seed: '1' });
  cmdEvolve({ game: 'pd', generations: '400', seed: '42' });
  cmdCoevolve({ game: 'pd', generations: '400', seed: '7' });
  cmdTournament({ game: 'mon', rounds: '200', seed: '1' });
}

const COMMANDS: Record<string, (flags: Flags) => void> = {
  arena: cmdArena,
  tournament: cmdTournament,
  evolve: cmdEvolve,
  coevolve: cmdCoevolve,
  demo: () => cmdDemo(),
};

function main(): void {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const fn = COMMANDS[command];
  if (!fn) {
    console.error(`unknown command "${command}". Commands: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(1);
  }
  fn(flags);
}

main();
