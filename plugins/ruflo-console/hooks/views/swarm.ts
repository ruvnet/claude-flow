import type { RenderElement } from 'claude-code'

import { agentLabels, shortId, type AgentRecord, type SwarmInfo } from '../data/parse'
import { membersText, swarmStatusOf } from '../data/swarm-status'
import { ago, button, clip, col, kv, picture, row, rule, starts, text, THEME, type Ctx } from './common'
import { selection } from './select'

const STATUS_COLOR = (status: string): string | undefined =>
  /busy|active|running/i.test(status) ? THEME.warn : /error|fail/i.test(status) ? THEME.bad : /stop|terminat|offline/i.test(status) ? undefined : THEME.info

/** The swarm's own facts in words (data/swarm-status.ts): its agents, its cap, when its record was last written, and "stale". */
export function swarmFacts(swarm: SwarmInfo, nowMs: number, agents: readonly AgentRecord[]): { text: string; isStale: boolean; found: number } {
  const status = swarmStatusOf(swarm, nowMs, agents)

  return {
    text: `${membersText(status)}${swarm.maxAgents !== undefined ? ` · max ${swarm.maxAgents}` : ''} · updated ${status.updatedMs === undefined ? 'n/a' : ago(status.updatedMs, nowMs)}${status.isStale ? ' · stale' : ''}`,
    isStale: status.isStale,
    found: status.found,
  }
}

/** The agent store as what it is: every agent on disk, not the swarm's members. */
export const onDisk = (n: number): string => `${n} agent${n === 1 ? '' : 's'} on disk`

/**
 * The swarm as ruflo wrote it: a graph of its members with the leader marked, the agents (pick one with j/k, open it
 * with d), and the hive's votes. The tile board is ruflo-swarm's pane (/ruflo swarm pane); this view does not redraw it.
 */
export function swarmView(ctx: Ctx): RenderElement {
  const snap = ctx.state.snapshot
  const swarm = snap?.swarm ?? null
  const hive = snap?.hive ?? null
  const agents = snap?.agents ?? []
  const picked = selection(ctx.state).agent
  const rows: RenderElement[] = [rule(ctx, 'Swarm', swarm?.id ?? '')]

  if (snap === null) return text(ctx, 'reading ruflo state…', { dimColor: true })

  if (swarm === null && hive === null && agents.length === 0) {
    rows.push(starts(ctx, 'No swarm here yet: start a hierarchical one, then spawn agents into it.', ['swarm', 'spawn-coder', 'spawn-tester', 'spawn-reviewer']))

    return col(ctx, rows, 'swarm')
  }

  const facts = swarm === null ? null : swarmFacts(swarm, ctx.nowMs, agents)

  rows.push(kv(ctx, 'topology', swarm === null || facts === null ? `${hive?.topology ?? 'n/a'} (hive-mind)` : `${swarm.topology}${swarm.strategy !== undefined ? ` · ${swarm.strategy}` : ''} · ${swarm.status} · ${facts.text}`, facts?.isStale === true ? THEME.warn : undefined))
  // The graph draws the swarm's own members (frames.ts topoModelOf); with no swarm record it draws the agents on disk.
  rows.push(picture(ctx, 'topology', `graph needs a terminal: ${swarm === null ? onDisk(agents.length) : `${facts?.found ?? 0} swarm member${facts?.found === 1 ? '' : 's'}`}`))
  rows.push(text(ctx, '★ leader · ◉ busy (a dot runs to it while it works) · ● idle · grey stopped · a white flash = an event about that agent', { dimColor: true }))
  rows.push(rule(ctx, 'Agents', `${onDisk(agents.length)} (every swarm) · j/k pick · d open · x actions`))
  const labels = agentLabels(agents)
  // The type column only earns its room when some agent has a name that is not its type.
  const hasTypes = agents.some(agent => agent.name !== undefined && agent.name !== agent.type)

  for (const agent of agents.slice(0, 10)) {
    const isPicked = picked?.id === agent.id
    const color = STATUS_COLOR(agent.status)

    rows.push(
      row(ctx, [
        ctx.kit.Text({ ...(color === undefined ? { dimColor: true } : { color }), children: `${isPicked ? '▸' : ' '}● ` }),
        ctx.kit.Text({
          wrap: 'truncate-end',
          ...(isPicked && { bold: true }),
          // One label (name, else type, with a short id only where two read the same); the type only when it differs.
          children: clip(`${(labels.get(agent.id) ?? agent.type).padEnd(16)} ${agent.status.padEnd(8)} ${hasTypes ? `${(agent.name !== undefined && agent.name !== agent.type ? agent.type : '').padEnd(12)} ` : ''}tasks ${agent.taskCount ?? 'n/a'} · health ${agent.health === undefined ? 'n/a' : `${Math.round(agent.health * 100)}%`} · #${shortId(agent.id)}`, ctx.columns - 3),
        }),
      ]),
    )
  }

  if (agents.length > 10) rows.push(text(ctx, `+${agents.length - 10} more (j/k walks all of them)`, { dimColor: true }))

  if (ctx.columns >= 44 && agents.length > 0) {
    rows.push(row(ctx, [button(ctx, 'agent-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'agent-next', 'next', () => ctx.act.select(1), { hotkey: 'j' }), button(ctx, 'drill', 'Open agent', ctx.act.drill, { hotkey: 'd' })]))
  }

  rows.push(rule(ctx, 'Hive-mind', hive === null ? 'not initialised' : `${hive.strategy ?? 'consensus'}${hive.queen !== undefined ? ` · queen ${hive.queen}` : ''}`))

  // A short summary: the Hive-Mind view (👑) holds the queen, quorum, proposals, voting and broadcasts.
  if (hive === null) {
    rows.push(starts(ctx, 'No hive-mind yet: queen-led consensus for the swarm.', ['hive'], 'swarm-'))
  } else {
    const newest = hive.pending.at(-1)

    rows.push(text(ctx, `${hive.workers.length} workers · ${hive.pending.length} open · ${hive.history.length} decided · ${hive.broadcasts.length} broadcasts`, { dimColor: true }))
    if (newest !== undefined) rows.push(text(ctx, `◇ ${newest.type} (${newest.strategy}) ${newest.status} · for ${newest.votesFor} · against ${newest.votesAgainst} · ${newest.id}`, { color: THEME.warn }))
  }

  if (ctx.columns >= 44) rows.push(row(ctx, [button(ctx, 'open-hive', '▸ open hive', () => ctx.act.view('hive'))]))

  return col(ctx, rows, 'swarm')
}
