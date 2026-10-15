/**
 * Cost, triage and guards on the Workflows page (ADR-462), as three slots of views/wf-slots.ts: a Triage board section, a Cost board
 * section and a notice slot for the guards. Nothing here reads a disk: the figures come from the store `wf-cost-live.ts` fills, and a
 * section whose figures are not there says why instead of drawing a number. Cost is shown as `$` only where a price was found;
 * tokens without one read "no price". Stop and message are the control tab's (ADR-465), and the page says where that is done.
 */
import type { RenderElement } from 'claude-code'

import { newAlerts } from '../data/wf-alerts'
import { billedTokens, fmtCosted, fmtUsd, isUnread } from '../data/wf-cost'
import { failedOf, rerunText, resultsOfJournal, triageRun, triageStrip, type TriageItem } from '../data/wf-triage'
import { fmtTokens, modelName, type WfRun } from '../data/workflows'
import { under } from '../data/files'
import { activeAlerts, BOOK_CAP, READ_BUDGET, guards } from '../wf-cost-live'
import { TRANSCRIPT_CAP } from '../data/workflows-read'
import type { NoticeDraft } from '../notices'
import { clip, kv, text, THEME, type Ctx } from './common'
import { registerSlot, type SlotEnv } from './wf-slots'

/** A long note as rows that fit the pane: the page's `text` clips to one line, and a sentence that matters must not end in an ellipsis. */
function notes(ctx: Ctx, line: string, props: { color?: string; dimColor?: boolean } = { dimColor: true }, indent = ''): RenderElement[] {
  const width = Math.max(24, ctx.columns - 2 - indent.length)
  const out: string[] = []
  let current = ''

  for (const word of line.split(' ')) {
    if (current !== '' && current.length + 1 + word.length > width) {
      out.push(current)
      current = word
    } else current = current === '' ? word : `${current} ${word}`
  }

  if (current !== '') out.push(current)

  return out.map((part, i) => text(ctx, `${indent}${i === 0 || indent === '' ? '' : '  '}${part}`, props))
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`

/** The journal's results of a run, from the text the reader already holds (no read here); parsed once per text. */
const memo = new Map<string, { text: string; results: Map<string, string> }>()

function resultsOf(ctx: Ctx, run: WfRun): ReadonlyMap<string, string> | null {
  if (run.kind !== 'workflow' || run.dir === undefined) return null

  const path = under(run.dir, 'journal.jsonl')
  const held = ctx.state.cache.get(path)

  if (held === undefined || !('text' in held)) return null

  const known = memo.get(path)

  if (known !== undefined && known.text === held.text) return known.results

  const results = resultsOfJournal(held.text)

  memo.delete(path)
  memo.set(path, { text: held.text, results })
  if (memo.size > 12) memo.delete(memo.keys().next().value as string)

  return results
}

const KIND_MARK = { error: '✖', timeout: '⏱', stale: '◌', empty: '○', ok: '✔', pending: '…' } as const

function itemRow(ctx: Ctx, item: TriageItem): RenderElement {
  const { agent, triage } = item
  const tone = triage.kind === 'error' || triage.kind === 'timeout' ? THEME.bad : triage.kind === 'stale' ? THEME.warn : undefined
  const detail = triage.firstError ?? triage.why

  return text(ctx, `${KIND_MARK[triage.kind]} ${clip(agent.label, 28)} · ${clip(agent.phase, 16)} · ${triage.kind} · ${detail}`, tone === undefined ? { dimColor: true } : { color: tone })
}

/** The Triage section: the strip, the agents that need a look with the first error line, and the text to resume only the failed ones. */
export function triageRows(env: SlotEnv): RenderElement[] {
  const { ctx, run } = env

  if (run === null) return []

  const results = resultsOf(ctx, run)
  const triage = triageRun(run, results)
  const failed = failedOf(triage)
  const empty = triage.items.filter(item => item.triage.kind === 'empty')
  const rows: RenderElement[] = [text(ctx, triageStrip(triage.counts), failed.length > 0 ? { color: THEME.bad, bold: true } : empty.length > 0 ? { color: THEME.warn } : { color: THEME.ok })]

  for (const item of [...failed, ...empty].slice(0, 8)) rows.push(itemRow(ctx, item))

  const more = failed.length + empty.length - 8

  if (more > 0) rows.push(text(ctx, `+${more} more (j/k to them)`, { dimColor: true }))

  const lines = rerunText(run, failed, results !== null)

  if (lines !== null) {
    rows.push(...notes(ctx, 're-run just the failed items (this text is for you to run; the console does not):'))
    for (const line of lines) rows.push(...notes(ctx, line, { dimColor: true }, '  '))
  } else if (run.kind === 'ruflo-swarm' && failed.length > 0) {
    rows.push(text(ctx, 'A ruflo swarm has no resume verb: stop or spawn an agent from the inspector (confirm-gated).', { dimColor: true }))
  }

  rows.push(...notes(ctx, run.kind === 'workflow' ? 'Classes come from the run record, the journal\'s results and the transcripts; no timeout event is written, so timeout is a text match.' : 'Classes come from the ruflo agent\'s status.'))

  return rows
}

/** The ceilings and rules in force, in one line, or how to set them. */
function guardLine(): string {
  const { rules } = guards
  const parts = [rules.runUsd !== null ? `run ${fmtUsd(rules.runUsd)}` : '', rules.dayUsd !== null ? `24h ${fmtUsd(rules.dayUsd)}` : '', rules.stuckMin !== null ? `stuck>${rules.stuckMin}m` : '', rules.tokens !== null ? `tokens>${fmtTokens(rules.tokens)}` : '', rules.isDirty ? 'dirty worktree' : ''].filter(Boolean)

  return parts.length === 0 ? 'off: set wfBudgetRunUsd, wfBudgetDayUsd or wfAlertRules in the plugin options' : `${parts.join(' · ')} · a notice only: nothing is stopped`
}

/** The Cost section: the run's spend, then each phase, then the agents of the phase under the cursor. */
export function costRows(env: SlotEnv): RenderElement[] {
  const { ctx, run, phase } = env

  if (run === null) return []
  if (run.kind !== 'workflow') return [text(ctx, 'A ruflo swarm records no model or tokens per agent, so it has no cost here.', { dimColor: true })]

  const cost = guards.costs.get(run.id)
  const rows: RenderElement[] = []

  rows.push(kv(ctx, 'prices', guards.book === null ? `none: ${guards.bookWhy}` : `ruflo-cost-tracker book as of ${guards.book.asOf} · USD list prices, estimates not bills (cap ${mb(BOOK_CAP)})`, guards.book === null ? THEME.warn : undefined))

  if (cost === undefined) {
    rows.push(text(ctx, guards.error !== null ? `the last cost read failed (${clip(guards.error, 60)})` : 'cost is read after the run board, on each refresh while this page is open', { dimColor: true }))
    rows.push(kv(ctx, 'guards', guardLine()))

    return rows
  }

  const { coverage } = guards

  rows.push(kv(ctx, 'run', `${fmtCosted(cost.total)} · ${isUnread(cost.total) ? 'n/a' : fmtTokens(billedTokens(cost.total), cost.total.isFloor)} billed tokens (all request buckets) · ${cost.covered} of ${cost.count} agents read`, cost.total.isFloor ? THEME.warn : undefined))
  rows.push(...notes(ctx, `Transcripts: up to ${mb(TRANSCRIPT_CAP)} each (a larger one is read from its end: ≥); at most ${mb(READ_BUDGET)} parsed per refresh; ${coverage.read} of ${coverage.total} read${coverage.left > 0 ? `, ${coverage.left} wait for the next refresh` : ''}. ≥ marks a floor, ≈ a family price.`))

  if (cost.total.unpricedModels.length > 0) rows.push(text(ctx, `no price for ${cost.total.unpricedModels.slice(0, 3).map(model => modelName(model)).join(', ')}: its tokens are counted, its dollars are not`, { color: THEME.warn }))

  for (const entry of run.phases.slice(0, 10)) {
    const mine = cost.phases.get(entry.title)
    const here = entry.title === phase?.title

    rows.push(text(ctx, `${here ? '▸' : ' '} ${clip(entry.title, 24).padEnd(24)} ${fmtCosted(mine).padEnd(14)} ${mine === undefined || isUnread(mine) ? 'n/a' : `${fmtTokens(billedTokens(mine), mine.isFloor)} tok`}`, here ? { bold: true } : { dimColor: true }))
  }

  if (run.phases.length > 10) rows.push(text(ctx, `+${run.phases.length - 10} more phases`, { dimColor: true }))

  if (phase !== null) {
    for (const agent of phase.agents.slice(0, 10)) {
      const mine = cost.agents.get(agent.id)
      rows.push(text(ctx, `    ${clip(agent.label, 26).padEnd(26)} ${modelName(agent.model).padEnd(11)} ${fmtCosted(mine).padEnd(12)} ${mine === undefined || isUnread(mine) ? 'n/a' : `${fmtTokens(billedTokens(mine), mine.isFloor)} tok`}`, { dimColor: true }))
    }

    if (phase.agents.length > 10) rows.push(text(ctx, `    +${phase.agents.length - 10} more agents`, { dimColor: true }))
  }

  rows.push(kv(ctx, 'guards', guardLine()))
  // What is over a ceiling or a rule right now stays on the board, whether or not a notice was raised for it.
  for (const alert of activeAlerts(env.runs, ctx.nowMs).filter(entry => entry.runId === run.id || entry.runId === '').slice(0, 5)) rows.push(...notes(ctx, `now: ${alert.text}`, { color: THEME.warn }))
  for (const problem of guards.rules.problems) rows.push(text(ctx, problem, { color: THEME.warn }))
  if (guards.rules.isDirty && guards.dirty === null) rows.push(text(ctx, 'dirty: no worktree reading yet', { dimColor: true }))
  if (guards.rules.stuckMin !== null) rows.push(...notes(ctx, 'stuck is measured from when this console first saw the agent unchanged; an agent with no file activity for 15 minutes counts at once'))
  if (guards.rules.dayUsd !== null) rows.push(...notes(ctx, 'The 24h ceiling counts the workflow runs read on this page, not all your Claude spend (the Cost page has that).'))

  return rows
}

/** The guards' notices: edge-triggered (a condition raises once while it stays true, and what was already true at the first cost read is not announced), over the store the last cost read filled. One tick behind a read. */
export function guardNotices(runs: readonly WfRun[], nowMs: number): NoticeDraft[] {
  const { fresh, raised } = newAlerts(activeAlerts(runs, nowMs), guards.raised)

  guards.raised = raised

  return fresh.map(alert => ({ level: alert.level, text: alert.text, key: alert.key, go: 'workflows' as const }))
}

/** Puts the three slots on the page. Idempotent per registry: a second call is refused by the registry and does nothing. */
export function registerWfTriage(): void {
  registerSlot({ kind: 'board', id: 'wf-triage', title: 'Triage', order: 10, render: triageRows })
  registerSlot({ kind: 'board', id: 'wf-cost', title: 'Cost', order: 20, render: costRows })
  registerSlot({ kind: 'notice', id: 'wf-guard', between: (_prev, next, nowMs) => guardNotices(next, nowMs) })
}

registerWfTriage()
