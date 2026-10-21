import type { RenderElement } from 'claude-code'

import { advisorSummary, escalationOf, modelLabel } from '../mission-advisor'
import { answerOf } from '../mission-advisor-live'
import type { MissionRecord } from '../mission-types'
import { settingsOf } from '../settings'
import { button, kv, row, rule, text, THEME, type Ctx } from './common'

/**
 * The Advisor section of the Loop tab (ADR-483), drawn only while the setting is on. It names the model each consult runs on as the
 * setting says (never a role the host did not give), splits the spend into the advisor's reported share and the mission's ledger reading,
 * and offers the three checkpoints as buttons that ask first.
 */
export function advisorRows(ctx: Ctx, mission: MissionRecord, missionUsd: number | null): RenderElement[] {
  const ai = settingsOf(ctx.state).ai

  if (!ai.advisor) return []

  const summary = advisorSummary(mission)
  const escalation = escalationOf(mission)
  const answer = answerOf(ctx.state, mission.id)
  const rows = [rule(ctx, 'Advisor', 'claude -p · read-only'), kv(ctx, 'model', modelLabel(ai))]
  const stuck =
    escalation.state === 'stop'
      ? `stopped: ${escalation.stream?.label ?? 'a check'} failed ${escalation.count}x`
      : escalation.state === 'consult'
        ? `consult due: ${escalation.stream?.label ?? 'a check'} failed ${escalation.count}x`
        : escalation.state === 'consulted'
          ? 'consult offered for the repeated failure'
          : 'no repeated failure'

  rows.push(kv(ctx, 'failures', stuck.slice(0, 44), escalation.state === 'stop' ? THEME.bad : escalation.state === 'consult' ? THEME.warn : undefined))
  rows.push(kv(ctx, 'consults', `${summary.consults}${summary.models.length > 0 ? ` on ${summary.models.join(', ')}` : ''}`.slice(0, 44)))
  rows.push(kv(ctx, 'advisor cost', summary.consults === 0 ? 'none yet' : `$${summary.costUsd.toFixed(3)} as claude reported it`))
  rows.push(kv(ctx, 'mission total', missionUsd === null ? 'no reading yet' : `$${missionUsd.toFixed(2)} (ledger list-price estimate)`))
  rows.push(row(ctx, [button(ctx, 'adv-plan', 'Review plan…', () => ctx.act.mission.advisor('plan')), button(ctx, 'adv-stuck', 'Root-cause…', () => ctx.act.mission.advisor('stuck')), button(ctx, 'adv-done', 'Pre-done…', () => ctx.act.mission.advisor('done'))]))

  if (answer !== undefined) {
    rows.push(text(ctx, ` last (${answer.kind}): ${answer.note}`.slice(0, 80), { dimColor: answer.status === 'running' }))

    for (const line of answer.lines.filter(item => item.trim() !== '').slice(0, 6)) rows.push(text(ctx, ` │ ${line}`.slice(0, 70), { dimColor: true }))
  }

  rows.push(text(ctx, ' A separate billed read-only turn, asked first; not', { dimColor: true }))
  rows.push(text(ctx, ' Claude Code’s in-session advisor.', { dimColor: true }))

  return rows
}
