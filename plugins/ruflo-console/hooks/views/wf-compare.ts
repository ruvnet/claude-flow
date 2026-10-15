/**
 * Compare on the Workflows page (ADR-461): a board slot that sets the picked run beside another run of the same workflow
 * name, agent by agent (data/wf-compare.ts). Registered by importing views/wf-replay.ts.
 */
import type { RenderElement } from 'claude-code'

import { compareRuns, fmtRatio, otherRunsOf, TIME_DELTA, TOKEN_DELTA, type AgentDiff, type Comparison, type Mark } from '../data/wf-compare'
import { fmtElapsed, fmtTokens, type WfAgent, type WfRun } from '../data/workflows'
import { clip, row, text, THEME, type Ctx } from './common'
import { fold, redraw } from './wf-fold'
import { flow, runTag } from './wf-layout'
import { registerSlot, type SlotEnv } from './wf-slots'

const against = new Map<string, string>()
const changedOnly = new Set<string>()
const ROWS_MAX = 20

/** For tests. */
export const resetCompare = (): void => (against.clear(), changedOnly.clear())

/** The run B for A: the one the person stepped to if it is still in the list, else the newest other run of the same workflow. */
export function partnerOf(run: WfRun, runs: readonly WfRun[]): WfRun | null {
  const others = otherRunsOf(run, runs)

  return others.find(other => other.id === against.get(run.id)) ?? others[0] ?? null
}

/** Steps to the next (or previous) other run of the same workflow; a test and the buttons share it. */
export function stepPartner(run: WfRun, runs: readonly WfRun[], by: 1 | -1): void {
  const others = otherRunsOf(run, runs)

  if (others.length === 0) return

  const at = Math.max(0, others.findIndex(other => other.id === partnerOf(run, runs)?.id))

  against.set(run.id, (others[(at + by + others.length) % others.length] as WfRun).id)
}

const MARK_COLOR: Record<Mark, string | undefined> = { '=': undefined, '~': THEME.warn, '+': THEME.ok, '-': THEME.bad }

const cellOf = (agent: WfAgent | undefined): string => (agent === undefined ? '—' : `${agent.state === 'done' ? '✔' : agent.state === 'failed' ? '✖' : agent.state === 'running' ? '◐' : '○'} ${fmtTokens(agent.tokens, agent.isTokensPartial)} ${fmtElapsed(agent.elapsedMs)}`)

function diffRow(ctx: Ctx, diff: AgentDiff): RenderElement {
  const label = clip(diff.label, Math.max(8, Math.min(28, Math.floor(ctx.columns / 3))))
  const change = [diff.stateChange, diff.modelChange, diff.tokens.ratio === undefined ? null : `tok ${fmtRatio(diff.tokens)}`, diff.time.ratio === undefined ? null : `time ${fmtRatio(diff.time)}`, diff.resultsDiffer === true ? 'result differs' : null].filter(entry => entry !== null).join(' · ')
  const color = MARK_COLOR[diff.mark]

  return text(ctx, ` ${diff.mark} ${label.padEnd(Math.max(8, Math.min(28, Math.floor(ctx.columns / 3))))} A ${cellOf(diff.a).padEnd(20)} B ${cellOf(diff.b).padEnd(20)} ${change}`, color === undefined ? {} : { color })
}

function totalsRows(ctx: Ctx, c: Comparison): RenderElement[] {
  const line = (name: string, a: string, b: string, ratio?: string): RenderElement => text(ctx, ` ${name.padEnd(9)} A ${a.padEnd(14)} B ${b.padEnd(14)}${ratio === undefined ? '' : ` ${ratio}`}`)

  return [
    line('state', c.a.state, c.b.state),
    line('agents', `${c.a.total} (${c.a.done} ok, ${c.a.failed} failed)`, `${c.b.total} (${c.b.done} ok, ${c.b.failed} failed)`),
    line('tokens', c.a.totalTokens === null ? 'n/a' : fmtTokens(c.a.totalTokens, c.a.isTokensPartial), c.b.totalTokens === null ? 'n/a' : fmtTokens(c.b.totalTokens, c.b.isTokensPartial), fmtRatio(c.totals.tokens)),
    line('time', fmtElapsed(c.a.durationMs), fmtElapsed(c.b.durationMs), fmtRatio(c.totals.time)),
  ]
}

export function compareBody(env: SlotEnv, run: WfRun): RenderElement[] {
  const { ctx, runs } = env
  const other = partnerOf(run, runs)

  if (other === null) return [text(ctx, ` No other run of "${clip(run.name, 40)}" has been read: a run of the same workflow name is needed to compare. Runs read: ${runs.filter(entry => entry.kind === 'workflow').length}.`, { dimColor: true })]

  const result = compareRuns(run, other)

  if (!result.ok) return [text(ctx, ` ${result.why}`, { color: THEME.warn })]

  const isOnly = changedOnly.has(run.id)
  const shown = result.rows.filter(entry => !isOnly || entry.mark !== '=')
  const total = otherRunsOf(run, runs).length
  const flip = (): void => {
    if (isOnly) changedOnly.delete(run.id)
    else changedOnly.add(run.id)
    redraw(ctx)
  }

  return [
    row(ctx, [text(ctx, ` A ${runTag(run.id)}`, { bold: true }), text(ctx, '  vs  '), text(ctx, `B ${runTag(other.id)}`, { bold: true }), text(ctx, total > 1 ? `  (${total} other runs of this workflow)` : '', { dimColor: true })], 'wf-cmp-ids'),
    ...flow(ctx, [...(total > 1 ? [{ key: 'wf-cmp-prev', label: '◂ other run', onPress: () => (stepPartner(run, runs, -1), redraw(ctx)) }, { key: 'wf-cmp-next', label: 'other run ▸', onPress: () => (stepPartner(run, runs, 1), redraw(ctx)) }] : []), { key: 'wf-cmp-only', label: isOnly ? 'show all agents' : 'changed only', onPress: flip }], 'wf-cmp-controls'),
    ...totalsRows(ctx, result),
    text(ctx, ` ${result.counts.same} same · ${result.counts.changed} changed · ${result.counts.added} only in B (+) · ${result.counts.removed} only in A (-)   ~ = tokens off by ${TOKEN_DELTA * 100}% or time by ${TIME_DELTA * 100}% or a state/model change`, { dimColor: true }),
    ...shown.slice(0, ROWS_MAX).map(entry => diffRow(ctx, entry)),
    ...(shown.length > ROWS_MAX ? [text(ctx, ` +${shown.length - ROWS_MAX} more agents not drawn`, { dimColor: true })] : shown.length === 0 ? [text(ctx, ' No agent differs by those thresholds.', { dimColor: true })] : []),
    ...result.notes.map(note => text(ctx, ` ${note}`, { dimColor: true })),
  ]
}

registerSlot({
  kind: 'board',
  id: 'compare',
  title: 'Compare runs',
  order: 50,
  render: env => {
    const run = env.run

    if (run === null) return []
    if (run.kind !== 'workflow') return [text(env.ctx, ' Compare is for Claude Code workflow runs, which can be run again: the ruflo swarm is one live roster.', { dimColor: true })]

    const total = otherRunsOf(run, env.runs).length

    return fold(env.ctx, 'compare', total === 0 ? 'no other run of this workflow has been read' : `${total} other run${total === 1 ? '' : 's'} of "${clip(run.name, 30)}": agents, tokens, time and results side by side`, () => compareBody(env, run))
  },
})
