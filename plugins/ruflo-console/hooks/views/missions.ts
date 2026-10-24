import type { RenderElement } from 'claude-code'

import { money, type Mission } from '../data/missions'
import { attentionCount, clampCursor, freshnessOf, isLive, listLayout, spinAt } from '../mission-list'
import { ago, paragraph, rule, text, THEME, type Ctx } from './common'
import { researchRows } from './research-section'
import { own } from '../data/safe'
import { remoteRunRows } from './remote-runs'

const STATE_COLOR: Record<string, string> = { running: THEME.warn, verifying: THEME.warn, completed: THEME.ok, failed: THEME.bad, blocked: THEME.bad, paused: THEME.info, queued: THEME.info }

/** Task status as recorded by the runtime, in words that never claim more: only evidence is verified. */
const TASK_GLYPH: Record<string, string> = { pending: '○', running: '◐', 'recorded-done': '●', failed: '✖', unknown: '?' }

function missionRows(ctx: Ctx, mission: Mission, isFirst: boolean): RenderElement[] {
  const budget = mission.budget
  const rows: RenderElement[] = [
    ...paragraph(ctx, `${isFirst ? '▸' : ' '} ${mission.objective || '(no objective)'}`, { bold: true, ...(own(STATE_COLOR, mission.state) !== undefined && { color: own(STATE_COLOR, mission.state) }) }, '  '),
    ...paragraph(
      ctx,
      `    ${isLive(mission.state) ? `${spinAt(ctx.nowMs)} ` : ''}${mission.state} · rev ${mission.revision} · ${mission.executionMode === 'session-bound' ? 'session-bound (runs only while a session drives it)' : mission.executionMode} · ${mission.id}`,
      { dimColor: true },
      '      ',
    ),
    ...paragraph(
      ctx,
      `    plan rev ${mission.plan.revision}: ${mission.plan.taskCount === 0 ? 'no tasks yet' : mission.plan.tasks.map(task => `${task.status === 'running' ? spinAt(ctx.nowMs) : (own(TASK_GLYPH, task.status) ?? '?')} ${task.id}`).join(' → ')}${mission.plan.taskCount > mission.plan.tasks.length ? ` (+${mission.plan.taskCount - mission.plan.tasks.length})` : ''}`,
      {},
      '      ',
    ),
    ...paragraph(
      ctx,
      `    evidence ${mission.evidence.verified}/${mission.evidence.count} verified · budget ${budget === null ? 'none' : `${money(budget.settledMinor, budget.currency)} settled, ${money(budget.reservedMinor, budget.currency)} reserved of ${money(budget.ceilingMinor, budget.currency)} (estimate ${money(budget.estimatedMinor, budget.currency)})`}`,
      { dimColor: true },
      '      ',
    ),
  ]

  if (mission.executor !== null) rows.push(...paragraph(ctx, `    executor ${mission.executor.connection} (seen ${ago(mission.executor.observedAtMs, ctx.nowMs)}; not connected is not failed)`, { dimColor: true }, '      '))
  if (mission.blockedReason !== undefined) rows.push(...paragraph(ctx, `    blocked: ${mission.blockedReason}`, { color: THEME.bad }, '      '))
  if (mission.unresolvedOperations > 0) rows.push(text(ctx, `    ${mission.unresolvedOperations} operation(s) unresolved`, { color: THEME.warn }))

  return rows
}

/**
 * ADR-406 missions, observed only: what `.claude-flow/missions/observation.json` says, as of its own `observedAt`. The
 * console takes no mission action here; those go through `ruflo mission action` (a button is never authorization).
 */
export function observationRows(ctx: Ctx): RenderElement[] {
  const observation = ctx.state.snapshot?.missions ?? null
  const rows: RenderElement[] = [rule(ctx, 'Mission record', observation === null ? 'no observation' : `${observation.missions.length}${observation.isTruncated ? '+' : ''} · observed ${ago(observation.observedAtMs, ctx.nowMs)}`)]
  rows.push(...researchRows(ctx))
  rows.push(...remoteRunRows(ctx))

  if (observation === null) {
    rows.push(text(ctx, ctx.state.isStandalone ? ' No mission record yet (ADR-406). Missions are made from a goal in the Claude Code console; this page shows the record once one exists.' : ' No mission record yet (ADR-406): create one from a goal in Plan.', { color: THEME.warn }))

    return rows
  }

  if (observation.missions.length === 0) rows.push(text(ctx, 'No missions yet.', { dimColor: true }))
  if (freshnessOf(observation.observedAtMs, ctx.nowMs) === 'stale') rows.push(...paragraph(ctx, ` observation is stale (last written ${ago(observation.observedAtMs, ctx.nowMs)}): the daemon may have stopped`, { color: THEME.warn }, ' '))

  const attention = attentionCount(observation.missions)

  if (attention > 0) rows.push(...paragraph(ctx, ` ${attention} need attention (blocked or failed): listed first`, { color: THEME.bad }, ' '))

  // One line a mission; the cursor's mission (j and k move it) is expanded below the list.
  const cursor = clampCursor(ctx.state.select.item, observation.missions.length)
  const layout = listLayout(observation.missions, cursor, ctx.nowMs)

  for (const { index, line } of layout.rows) rows.push(text(ctx, `${index === cursor ? '▸' : ' '} ${line}`, index === cursor ? { bold: true } : { dimColor: true }))
  if (layout.hidden > 0) rows.push(text(ctx, `  ${layout.hidden} more not shown · j and k scroll`, { dimColor: true }))
  if (layout.expanded !== null) rows.push(...missionRows(ctx, layout.expanded, true))

  rows.push(...paragraph(ctx, 'legend: ○ pending · ◐ running · ● recorded done (recorded, not verified) · ✖ failed', { dimColor: true }, '  '))
  rows.push(...paragraph(ctx, 'observation only: actions go through `npx ruflo mission action` with a request id and the expected revision', { dimColor: true }, '  '))

  return rows
}
