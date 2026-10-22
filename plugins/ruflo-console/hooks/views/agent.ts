import type { RenderElement } from 'claude-code'

import { ago, button, col, kv, row, rule, text, THEME, type Ctx } from './common'

/**
 * One agent, drilled into: its role and state from the agent store, the tasks assigned to it and the claims it holds,
 * the status changes and events the console saw, and the tail of `ruflo agent logs`. Cost per ruflo agent is not
 * recorded anywhere, so it reads n/a; Claude Code's own spend is on the Cost view.
 */
export function agentView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const id = state.drill.agentId
  const agent = state.snapshot?.agents.find(entry => entry.id === id) ?? null
  const rows: RenderElement[] = [rule(ctx, 'Agent', id ?? '')]

  if (agent === null) {
    rows.push(text(ctx, id === null ? 'No agent picked: choose one on Swarm (2) with j/k and press d.' : `Agent ${id} is no longer in .claude-flow/agents/store.json.`, { dimColor: true }))
    rows.push(row(ctx, [button(ctx, 'back', 'Back', ctx.act.back, { hotkey: 'b' })]))

    return col(ctx, rows, 'agent')
  }

  const tasks = (state.snapshot?.tasks ?? []).filter(task => task.assignedTo.includes(agent.id))
  const claims = (state.snapshot?.claims ?? []).filter(claim => claim.claimant.id === agent.id || claim.handoffTo === agent.id)
  const log = state.statusLog.get(agent.id) ?? []
  const events = state.events.filter(event => event.agentId === agent.id).slice(-6)

  rows.push(kv(ctx, 'role', `${agent.name ?? agent.type} · ${agent.type}`))
  rows.push(kv(ctx, 'status', `${agent.status} · health ${agent.health === undefined ? 'n/a' : `${Math.round(agent.health * 100)}%`} · tasks counted ${agent.taskCount ?? 'n/a'}`, /busy/i.test(agent.status) ? THEME.warn : THEME.info))
  rows.push(kv(ctx, 'created', agent.createdAtMs === undefined ? 'n/a' : ago(agent.createdAtMs, nowMs)))
  rows.push(kv(ctx, 'current task', tasks.length === 0 ? 'none assigned in tasks/store.json' : tasks.map(task => `${task.id} (${task.status}) ${task.description}`).join(' · ')))
  rows.push(kv(ctx, 'claims', claims.length === 0 ? 'none' : claims.map(claim => `${claim.issueId} ${claim.status}${claim.handoffTo === agent.id ? ' (handoff to it)' : ''}`).join(' · ')))
  rows.push(kv(ctx, 'tokens / cost', "n/a — ruflo records no per-agent usage; Claude Code's spend is on Cost (9)"))

  rows.push(rule(ctx, 'Timeline', 'status changes seen since the console loaded'))
  rows.push(text(ctx, log.length === 0 ? 'no change seen yet' : log.slice(-6).map(entry => `${ago(entry.atMs, nowMs)} ${entry.status}`).join('  →  '), { dimColor: log.length === 0 }))

  for (const event of events) rows.push(text(ctx, `${ago(event.atMs, nowMs).padStart(8)}  ${event.text}`, { dimColor: true }))

  rows.push(rule(ctx, 'Logs', state.drill.logs === null ? 'asking `ruflo agent logs`…' : `ruflo agent logs, ${ago(state.drill.logsAtMs, nowMs)}`))

  for (const line of (state.drill.logs ?? []).slice(-8)) rows.push(text(ctx, line, { dimColor: true }))
  if (state.drill.logs !== null && state.drill.logs.length === 0) rows.push(text(ctx, 'no log lines', { dimColor: true }))

  if (ctx.columns >= 44) {
    rows.push(
      row(ctx, [
        button(ctx, 'back', 'Back', ctx.act.back, { hotkey: 'b' }),
        button(ctx, 'agent-prev', 'prev agent', () => ctx.act.select(-1), { hotkey: 'k' }),
        button(ctx, 'agent-next', 'next agent', () => ctx.act.select(1), { hotkey: 'j' }),
        button(ctx, 'actions', 'Actions', () => ctx.act.palette('selection'), { hotkey: 'x' }),
      ]),
    )
  }

  return col(ctx, rows, 'agent')
}
