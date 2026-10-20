/**
 * Two runs of the same workflow, side by side (ADR-461). Pure: agents are matched by phase and label (the Nth agent of a
 * label within a phase pairs with the Nth in the other run), and each pair is marked
 *   =  the same          ~  changed: a different final state or model, tokens off by TOKEN_DELTA or more, or time off by TIME_DELTA or more
 *   +  only in B          -  only in A
 * A figure either run did not record is n/a and never counts as a change: the comparison says what the files say.
 */
import type { WfAgent, WfRun } from './workflows'

/** Tokens and time are "changed" past these relative differences; a smaller move is run-to-run noise. */
export const TOKEN_DELTA = 0.1
export const TIME_DELTA = 0.25

export type Mark = '=' | '~' | '+' | '-'

/** `diff` is B minus A and `ratio` is diff over A; both are absent where either side is unknown (or A is zero for the ratio). */
export type Delta = { a?: number; b?: number; diff?: number; ratio?: number }

export type AgentDiff = {
  key: string
  label: string
  phase: string
  mark: Mark
  a?: WfAgent
  b?: WfAgent
  tokens: Delta
  time: Delta
  /** `done → failed`, or null when the state is the same (or one side is absent). */
  stateChange: string | null
  modelChange: string | null
  /** Whether both agents reported a result and the two differ; null where either has none. */
  resultsDiffer: boolean | null
}

export type Comparison = {
  ok: true
  a: WfRun
  b: WfRun
  rows: AgentDiff[]
  totals: { agents: Delta; done: Delta; failed: Delta; tokens: Delta; time: Delta }
  counts: { same: number; changed: number; added: number; removed: number }
  /** Tokens are a floor on either side, or a run was derived from transcripts rather than a record. */
  notes: string[]
}

export type NotComparable = { ok: false; why: string }

const delta = (a: number | undefined, b: number | undefined): Delta => {
  const both = a !== undefined && b !== undefined

  return { ...(a !== undefined && { a }), ...(b !== undefined && { b }), ...(both && { diff: b - a }), ...(both && a !== 0 && { ratio: (b - a) / a }) }
}

/** Runs other than `run` that carry its workflow name, newest first as the list holds them: what it can be compared with. */
export const otherRunsOf = (run: WfRun, runs: readonly WfRun[]): WfRun[] => (run.kind !== 'workflow' ? [] : runs.filter(entry => entry.kind === 'workflow' && entry.id !== run.id && entry.name === run.name))

const keyed = (run: WfRun): Map<string, WfAgent> => {
  const seen = new Map<string, number>()
  const out = new Map<string, WfAgent>()

  for (const phase of run.phases) {
    for (const agent of phase.agents) {
      const base = `${agent.phase}\u0000${agent.label}`
      const nth = (seen.get(base) ?? 0) + 1

      seen.set(base, nth)
      out.set(`${base}\u0000${nth}`, agent)
    }
  }

  return out
}

const isOff = (d: Delta, limit: number): boolean => d.ratio !== undefined && Math.abs(d.ratio) >= limit

function pair(key: string, a: WfAgent | undefined, b: WfAgent | undefined): AgentDiff {
  const tokens = delta(a?.tokens, b?.tokens)
  const time = delta(a?.elapsedMs, b?.elapsedMs)
  const stateChange = a !== undefined && b !== undefined && a.state !== b.state ? `${a.state} → ${b.state}` : null
  const modelChange = a !== undefined && b !== undefined && a.model !== undefined && b.model !== undefined && a.model !== b.model ? `${a.model} → ${b.model}` : null
  const resultsDiffer = a?.resultPreview !== undefined && b?.resultPreview !== undefined ? a.resultPreview !== b.resultPreview : null
  const mark: Mark = a === undefined ? '+' : b === undefined ? '-' : stateChange !== null || modelChange !== null || isOff(tokens, TOKEN_DELTA) || isOff(time, TIME_DELTA) ? '~' : '='
  const at = (a ?? b) as WfAgent

  return { key, label: at.label, phase: at.phase, mark, ...(a !== undefined && { a }), ...(b !== undefined && { b }), tokens, time, stateChange, modelChange, resultsDiffer }
}

export function compareRuns(a: WfRun, b: WfRun): Comparison | NotComparable {
  if (a.kind !== 'workflow' || b.kind !== 'workflow') return { ok: false, why: 'only Claude Code workflow runs compare: the ruflo swarm is one live roster, not a run' }
  if (a.id === b.id) return { ok: false, why: 'that is the same run' }
  if (a.name !== b.name) return { ok: false, why: `different workflows: "${a.name}" and "${b.name}"` }

  const left = keyed(a)
  const right = keyed(b)
  const rows = [...left.entries()].map(([key, agent]) => pair(key, agent, right.get(key)))

  for (const [key, agent] of right) if (!left.has(key)) rows.push(pair(key, undefined, agent))

  const count = (mark: Mark): number => rows.filter(row => row.mark === mark).length
  const notes: string[] = []

  if (a.isTokensPartial || b.isTokensPartial) notes.push('tokens marked ≥ are a floor (a long transcript was only read from its end), so a token difference may be larger than it looks')
  if (!a.hasRecord || !b.hasRecord) notes.push(`${!a.hasRecord && !b.hasRecord ? 'both runs are' : `run ${a.hasRecord ? 'B' : 'A'} is`} derived from journal and transcripts, not a finished run record: figures can still move`)
  if (rows.some(row => row.resultsDiffer === true)) notes.push('result text differs between the two (it always can; only the agents\' own words are compared, not their meaning)')

  return {
    ok: true,
    a,
    b,
    rows,
    totals: { agents: delta(a.total, b.total), done: delta(a.done, b.done), failed: delta(a.failed, b.failed), tokens: delta(a.totalTokens ?? undefined, b.totalTokens ?? undefined), time: delta(a.durationMs, b.durationMs) },
    counts: { same: count('='), changed: count('~'), added: count('+'), removed: count('-') },
    notes,
  }
}

/** `+12%` · `-3%` · `n/a`; a ratio over 999% reads `>+999%`. */
export function fmtRatio(d: Delta): string {
  if (d.ratio === undefined) return d.diff === 0 ? '0%' : 'n/a'

  const percent = Math.round(d.ratio * 100)

  return Math.abs(percent) > 999 ? `${percent > 0 ? '>+' : '<-'}999%` : `${percent > 0 ? '+' : ''}${percent}%`
}
