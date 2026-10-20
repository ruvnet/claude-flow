import type { RenderElement } from 'claude-code'

import type { ClaimRecord } from '../data/parse'
import { button, clip, col, picture, row, rule, startField, starts, text, THEME, type Ctx } from './common'
import { selection } from './select'

const who = (claim: ClaimRecord): string => (claim.claimant.kind === 'agent' ? `${claim.claimant.agentType ?? 'agent'} ${claim.claimant.id}` : `human ${claim.claimant.name ?? claim.claimant.id}`)

/**
 * The claims board: who holds what, for how long, what may be stolen, and what is being handed off. The buttons act
 * through ruflo's own claims tools (`ruflo mcp exec -t claims_*`), each after a y/n confirm.
 */
export function claimsView(ctx: Ctx): RenderElement {
  const snap = ctx.state.snapshot
  const claims = snap?.claims ?? []
  const agents = snap?.agents ?? []
  const pick = selection(ctx.state)
  const stealable = claims.filter(claim => claim.isStealable).length
  const handoffs = claims.filter(claim => claim.handoffTo !== undefined || claim.status === 'handoff-pending').length
  const active = claims.filter(claim => claim.status === 'active').length
  const rows: RenderElement[] = [rule(ctx, 'Claims', `${active} active · ${stealable} stealable · ${handoffs} handoff`)]

  if (snap === null) {
    return text(ctx, 'reading ruflo state…', { dimColor: true })
  }

  if (claims.length === 0) {
    rows.push(text(ctx, snap.reads.claims === 'too-large' ? 'claims.json is too large to read here' : 'No claims on disk (.claude-flow/claims/claims.json).', { dimColor: true }))
    if (snap.tasks.length > 0) rows.push(picture(ctx, 'flow', `${snap.tasks.length} open tasks`))
  } else {
    rows.push(picture(ctx, 'flow', `${claims.length} claims`))
    rows.push(text(ctx, 'lanes: open → claimed → working → done, and stealable · ╰─▶ a pending handoff', { dimColor: true }))
    rows.push(text(ctx, 'ring: TTL left where expiresAt is set, else age filling over 24 h (no claims tool sets a TTL today)', { dimColor: true }))

    claims.slice(0, 10).forEach(claim => {
      const isPicked = pick.claim?.issueId === claim.issueId
      const target = claim.handoffTo === undefined ? undefined : (agents.find(agent => agent.id === claim.handoffTo) ?? null)
      const flags = [claim.isStealable ? 'stealable' : '', claim.handoffTo !== undefined ? `→ ${target?.name ?? target?.type ?? claim.handoffTo}` : ''].filter(Boolean).join(' ')

      rows.push(
        text(ctx, clip(`${isPicked ? '▸' : ' '} ${claim.issueId.padEnd(22)} ${who(claim).padEnd(34)} ${claim.status.padEnd(9)} ${claim.progress ?? 0}%  ${flags}`, ctx.columns), {
          ...(isPicked ? { bold: true, color: THEME.head } : claim.isStealable ? { color: THEME.warn } : {}),
        }),
      )
    })

    if (claims.length > 10) rows.push(text(ctx, `+${claims.length - 10} more`, { dimColor: true }))
  }

  // Nothing to claim, or nobody to claim it: say so with the button that fixes it.
  if (pick.agent === null) rows.push(starts(ctx, 'No agents to claim for.', ['swarm', 'spawn-coder', 'spawn-tester']))
  if (pick.task === null) rows.push(startField(ctx, 'task', 'a task to put on the board, e.g. add OAuth login to the API'))

  rows.push(rule(ctx, 'Act', ctx.state.isActing ? 'running…' : ''))
  rows.push(text(ctx, `picked claim ${pick.claim?.issueId ?? 'n/a'} · agent ${pick.agent !== null ? `${pick.agent.name ?? pick.agent.type} (${pick.agent.id})` : 'n/a — no agents on disk'}`, { dimColor: true }))
  rows.push(text(ctx, `open task ${pick.task === null ? 'n/a — every task is claimed' : `${pick.task.id}: ${pick.task.description || pick.task.type}`}`, { dimColor: true }))

  if (ctx.columns >= 44) {
    rows.push(
      row(ctx, [
        button(ctx, 'claim-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'claim-next', 'next', () => ctx.act.select(1), { hotkey: 'j' }),
        button(ctx, 'agent-next', 'agent', ctx.act.agentNext, { hotkey: 'a' }),
        button(ctx, 'task-next', 'task', ctx.act.taskNext, { hotkey: 't' }),
      ]),
    )
    rows.push(
      row(ctx, [
        button(ctx, 'claim', 'Claim task', ctx.act.claim, { hotkey: 'c' }),
        button(ctx, 'release', 'Release', ctx.act.release, { hotkey: 'l' }),
        button(ctx, 'handoff', 'Hand off', ctx.act.handoff, { hotkey: 'o' }),
        button(ctx, 'steal', 'Steal', ctx.act.steal, { hotkey: 's' }),
      ]),
    )
  }

  return col(ctx, rows, 'claims')
}
