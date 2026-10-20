import type { RenderElement } from 'claude-code'

import { button, kv, live, row, rule, sourceLine, text, type Ctx } from './common'
import { capOf, costOf } from '../mission-guard'
import { loopOf } from '../mission-claude'
import { tickPlan } from '../mission-loop'
import { derive } from '../mission-control'
import { parseGates, verdictOf } from '../mission-verify'
import { settingsOf } from '../settings'
import type { MissionRecord } from '../mission-types'
import { loopRows } from './mission-loop'
import { advisorRows } from './mission-advisor'
import { missionCostRows } from './mission-cost'

function verifyRows(ctx: Ctx, mission: MissionRecord): RenderElement[] {
  const prefs = settingsOf(ctx.state).ai
  const { gates, rejected } = parseGates(prefs.loopGates)
  const rows = [rule(ctx, 'Verify', gates.length === 0 ? 'no gates' : `${gates.length} gate${gates.length === 1 ? '' : 's'} · asks first`)]

  if (gates.length === 0) {
    rows.push(text(ctx, ' No gates: add your own commands in', { dimColor: true }))
    rows.push(text(ctx, ' Settings → Mission gates. Nothing is invented.', { dimColor: true }))
  } else {
    for (const gate of gates) rows.push(kv(ctx, gate.label.slice(0, 16), gate.argv.join(' ')))
    rows.push(row(ctx, [button(ctx, 'mc-verify', 'Run the gates…', () => ctx.act.mission.verify())]))
  }

  for (const item of rejected.slice(0, 3)) rows.push(text(ctx, ` skipped: ${item.line.slice(0, 30)} (${item.why})`, { dimColor: true }))

  const statuses = derive(mission, ctx.state.snapshot?.tasks ?? [])

  for (const task of mission.tasks.slice(0, 8)) {
    const verdict = verdictOf(mission, task.id, gates)

    rows.push(text(ctx, ` ${task.id.padEnd(4)} ${(statuses.get(task.id) ?? 'waiting').padEnd(8)} ${verdict.state}${verdict.state === 'no-gates' ? '' : `: ${verdict.detail}`}`.slice(0, 80), { dimColor: verdict.state === 'unverified' || verdict.state === 'no-gates' }))
  }

  return rows
}

/** The Loop tab: the loop manager, this mission's spend against its cap, and the gates that verify its tasks. */
export function loopTabRows(ctx: Ctx, mission: MissionRecord): RenderElement[] {
  const loop = loopOf(mission)
  const cost = costOf(ctx.state, mission)
  const prefs = settingsOf(ctx.state).ai
  const result = ctx.state.probes.get('mission-cost')
  const rows = [...loopRows(ctx, loop, ctx.act.mission.loop, ctx.nowMs)]

  if (loop !== null) {
    const plan = tickPlan({ mission, loop, prefs, gatesConfigured: parseGates(prefs.loopGates).gates.length > 0, spendUsd: cost?.usd ?? null, capUsd: capOf(ctx.state), nowMs: ctx.nowMs, taskStatus: derive(mission, ctx.state.snapshot?.tasks ?? []) })

    rows.push(kv(ctx, 'next tick', `${plan.action}: ${plan.reason}`.slice(0, 60)))
  }

  rows.push(...missionCostRows(ctx, cost, capOf(ctx.state), live(result) === null ? sourceLine(result, ctx.nowMs, 'mission spend').text : 'ledger: cost-tracker plugin'), ...verifyRows(ctx, mission), ...advisorRows(ctx, mission, cost?.usd ?? null))

  return rows
}
