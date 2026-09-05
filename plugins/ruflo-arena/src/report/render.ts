// Text rendering of results. In the full system these surfaces become Ruflo dashboard
// panels fed by RuVector read-models (ADR-149/198/202). Here we render to text so the
// plugin is observable with zero UI dependencies.

import type { EvolutionResult, FsmStrategy, TournamentResult } from '../domain/types.js';

const SHADES = ' .:-=+*#%@'; // low -> high

function pad(s: unknown, w: number): string {
  const str = String(s);
  return str.length >= w ? str.slice(0, w) : str + ' '.repeat(w - str.length);
}
function padL(s: unknown, w: number): string {
  const str = String(s);
  return str.length >= w ? str.slice(0, w) : ' '.repeat(w - str.length) + str;
}

function shadeOf(v: number, min: number, span: number): string {
  return SHADES[Math.min(SHADES.length - 1, Math.floor(((v - min) / span) * (SHADES.length - 1)))];
}

/** The competitive array (mean-payoff matrix) as an aligned table. */
export function competitiveArrayTable(t: TournamentResult): string {
  const short = t.names.map((n) => n.slice(0, 6));
  const w = 7;
  const head = pad('', 14) + short.map((n) => padL(n, w)).join('');
  const rows = t.matrix.map((row, i) => {
    const cells = row.map((v) => padL(v.toFixed(2), w)).join('');
    return pad(t.names[i].slice(0, 13), 14) + cells;
  });
  return [head, ...rows].join('\n');
}

/** ASCII heatmap of a matrix (auto-scaled to its min/max). */
export function heatmap(matrix: number[][]): string {
  const flat = matrix.flat();
  const min = Math.min(...flat);
  const span = Math.max(...flat) - min || 1;
  return matrix.map((row) => row.map((v) => shadeOf(v, min, span).repeat(2)).join('')).join('\n');
}

export function rankingTable(t: TournamentResult): string {
  return t.ranking
    .map((r, i) => `${padL(i + 1, 3)}. ${pad(r.name, 22)} ${r.meanVsField.toFixed(3)}`)
    .join('\n');
}

/** One-line sparkline of a numeric series. */
export function sparkline(values: number[]): string {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  return values.map((v) => shadeOf(v, min, span)).join('');
}

/** Compact description of an FSM strategy. */
export function describeFSM(fsm: FsmStrategy): string {
  const lines = [`FSM "${fsm.name}"  states=${fsm.nStates}  start=${fsm.start}`];
  fsm.states.forEach((s, i) => {
    const trans = Object.entries(s.next)
      .map(([k, v]) => `${k}->${v}`)
      .join(' ');
    lines.push(`  s${i}: out=${s.action}  [${trans}]${i === fsm.start ? '  <= start' : ''}`);
  });
  return lines.join('\n');
}

/** Headline numbers for an evolution run (used in summaries). */
export function evolutionSummary(r: EvolutionResult): {
  startFitness: number;
  finalFitness: number;
  acceptedMutations: number;
  states: number;
} {
  return {
    startFitness: r.curve[0].fitness,
    finalFitness: r.bestFitness,
    acceptedMutations: r.curve.filter((c) => c.accepted && c.gen > 0).length,
    states: r.best.nStates,
  };
}
