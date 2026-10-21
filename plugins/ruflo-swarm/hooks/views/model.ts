import { membersOf, type Member, type MemberState } from '../model/members'
import { topologyLines } from '../model/topology'
import type { Decision, Proposal, TaskRecord } from '../reader/parse'
import type { FileKey } from '../reader/snapshot'
import type { ActionOutcome, PendingConfirm, State } from '../state'

/** Below this many columns the pane draws its narrow form: a list, not a grid, and the board as counts. */
export const NARROW = 44
export const TILE = 18

export type TaskRow = { id: string; status: string; type: string; description: string; owner: string; isSelected: boolean }

/** Everything the pane draws, worked out from the state with no element in sight, so it is tested as data. */
export type PaneModel = {
  columns: number
  rows: number
  isNarrow: boolean
  hasSwarm: boolean
  title: string
  members: Member[]
  selected: Member | null
  counts: { state: MemberState; count: number }[]
  topology: string[]
  board: { pending: number; claimed: number; done: number; failed: number; rows: TaskRow[]; selected: TaskRow | null; total: number }
  proposals: Proposal[]
  decisions: Decision[]
  usage: string
  route: string
  /** ruOS desktops hosting swarm agents, one line each; empty when no agent runs remotely and no host file is there. */
  remote: string[]
  missing: string[]
  confirm: PendingConfirm | null
  outcome: ActionOutcome | null
  detail: State['detail']
  next: { text: string; why: string } | null
  isActing: boolean
}

const MISSING_WORDS: Record<FileKey, string> = {
  swarm: 'swarm store',
  pointer: 'swarm pointer',
  agents: 'agent store',
  tasks: 'task store',
  claims: 'claims',
  hive: 'hive-mind',
}

const CLAIMED = new Set(['in_progress', 'running', 'assigned'])
const DONE = new Set(['completed', 'done'])
const FAILED = new Set(['failed', 'cancelled'])

const ageOf = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))

  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`
}

/** The ruOS hosts section: each desktop with its state, heartbeat age and agents; "not on disk" when agents name a host and no snapshot exists. */
export function remoteLines(snapshot: State['snapshot'], nowMs: number): string[] {
  if (snapshot === null) {
    return []
  }

  const hosts = snapshot.ruos.hosts
  const remoteAgents = snapshot.agents.filter(agent => agent.remote !== undefined).length
  const note = snapshot.ruos.note !== undefined ? [snapshot.ruos.note] : []

  if (hosts === null) {
    return remoteAgents > 0 ? [`ruOS hosts: not on disk (${remoteAgents} agent${remoteAgents === 1 ? '' : 's'} name one)`, ...note] : note
  }

  return [
    ...hosts.slice(0, 20).map(host => {
      const beat = host.heartbeatAt !== undefined ? ` · heartbeat ${ageOf(nowMs - Date.parse(host.heartbeatAt))} ago` : ' · no heartbeat'

      return `${host.name} · ${host.state}${beat} · ${host.agents.length} agent${host.agents.length === 1 ? '' : 's'}`
    }),
    ...(hosts.length > 20 ? [`+${hosts.length - 20} more hosts`] : []),
    ...(hosts.length === 0 ? ['no ruOS hosts'] : []),
    ...note,
  ]
}

const short = (id: string) => (id.length > 14 ? `…${id.slice(-8)}` : id)

/** A cost or a token count as the engine gave it; a figure it left out is `n/a`, never zero. */
export function usageLine(usage: State['usage']): string {
  if (usage === null) {
    return 'usage: not read yet'
  }

  const cost = usage.costUsd !== undefined ? `$${usage.costUsd.toFixed(usage.costUsd < 1 ? 3 : 2)}` : 'n/a'
  const tokens = usage.contextTokens !== undefined ? `${Math.round(usage.contextTokens / 1000)}k` : 'n/a'
  const window = usage.contextWindow !== undefined ? `/${Math.round(usage.contextWindow / 1000)}k` : ''
  const percent = usage.contextPercent !== undefined ? ` (${Math.round(usage.contextPercent)}%)` : ''

  return `cost ${cost} · context ${tokens}${window}${percent}`
}

/**
 * The router's last pick the pane has seen (kept in `$.store`, so it may come from an earlier session: its age says),
 * with its score; under the threshold it says so instead of naming a winner.
 */
export function routeLine(route: State['route'], threshold: number, nowMs = Date.now()): string {
  if (route === null) {
    return 'router: no pick seen yet'
  }

  const score = `${Math.round(route.confidence * 100)}%`
  const alt = route.alternatives[0] !== undefined ? ` · alt ${route.alternatives[0].agent} ${Math.round(route.alternatives[0].confidence * 100)}%` : ''

  const age = route.atMs > 0 ? ` · ${ageOf(nowMs - route.atMs)} ago` : ''

  if (!route.matched) {
    return `router: no match (best ${route.agent} ${score})${age}`
  }

  return route.confidence < threshold
    ? `router: below threshold ${Math.round(threshold * 100)}% (best ${route.agent} ${score})${alt}${age}`
    : `router: ${route.agent} ${score}${route.pattern !== undefined ? ` (${route.pattern})` : ''}${alt}${age}`
}

function nextOf(state: State, members: readonly Member[], board: PaneModel['board']): PaneModel['next'] {
  const snapshot = state.snapshot

  if (snapshot === null || !snapshot.hasSwarm) {
    return { text: '/ruflo-swarm:swarm init', why: 'no swarm on disk here: start one' }
  }

  if (!members.some(member => member.source === 'ruflo')) {
    return { text: 'npx @claude-flow/cli@latest agent spawn -t coder --name coder', why: 'the swarm has no ruflo agents yet' }
  }

  if (board.total === 0) {
    return { text: 'npx @claude-flow/cli@latest task create --type implementation --description "…"', why: 'no tasks on the board' }
  }

  if (board.pending > 0 && board.claimed === 0) {
    return { text: '/ruflo-swarm:swarm status', why: `${board.pending} task${board.pending === 1 ? '' : 's'} waiting and none claimed` }
  }

  return null
}

export function paneModelOf(state: State, columns: number, rows: number, nowMs: number): PaneModel {
  const snapshot = state.snapshot
  const members = membersOf(snapshot, state.activity, nowMs)
  const selected = members.find(member => member.id === state.selected) ?? members[0] ?? null
  const counts = (['working', 'blocked', 'idle', 'done', 'failed'] as const)
    .map(memberState => ({ state: memberState, count: members.filter(member => member.state === memberState).length }))
    .filter(entry => entry.count > 0)

  const claimsByIssue = new Map((snapshot?.claims ?? []).map(claim => [claim.issueId, claim]))
  const typeOf = new Map(members.map(member => [member.id, member.label]))

  const taskRow = (task: TaskRecord): TaskRow => {
    const claim = claimsByIssue.get(task.id)
    const ownerId = claim?.claimant.id ?? task.assignedTo[0]

    return {
      id: task.id,
      status: claim !== undefined && claim.status !== 'active' ? `${task.status}/${claim.status}` : task.status,
      type: task.type,
      description: task.description,
      owner: ownerId === undefined ? 'unassigned' : (typeOf.get(ownerId) ?? short(ownerId)),
      isSelected: task.id === state.selectedTask,
    }
  }

  const tasks = snapshot?.tasks ?? []
  // Open work first, newest store order kept within each group.
  const rank = (task: TaskRecord) => (CLAIMED.has(task.status) ? 0 : task.status === 'pending' ? 1 : FAILED.has(task.status) ? 2 : 3)
  const ordered = [...tasks].sort((a, b) => rank(a) - rank(b)).map(taskRow)
  const selectedTask = ordered.find(row => row.id === state.selectedTask) ?? ordered[0] ?? null

  const board = {
    pending: tasks.filter(task => task.status === 'pending').length,
    claimed: tasks.filter(task => CLAIMED.has(task.status) || claimsByIssue.get(task.id)?.status === 'active').length,
    done: tasks.filter(task => DONE.has(task.status)).length,
    failed: tasks.filter(task => FAILED.has(task.status)).length,
    rows: ordered.map(row => ({ ...row, isSelected: row.id === selectedTask?.id })),
    selected: selectedTask,
    total: tasks.length,
  }

  const swarm = snapshot?.swarm
  const topologyName = swarm?.topology ?? snapshot?.hive?.topology ?? 'unknown'

  return {
    columns,
    rows,
    isNarrow: columns < NARROW,
    hasSwarm: snapshot?.hasSwarm === true,
    title: swarm !== undefined && swarm !== null ? `swarm ${short(swarm.id)} · ${topologyName} · ${swarm.status}` : snapshot?.hive !== null && snapshot?.hive !== undefined ? `hive-mind · ${topologyName}` : 'ruflo swarm',
    members,
    selected,
    counts,
    topology: topologyLines(topologyName, members, columns),
    board,
    proposals: snapshot?.hive?.pending.filter(proposal => proposal.status === 'pending') ?? [],
    decisions: (snapshot?.hive?.history ?? []).slice(-2).reverse(),
    usage: usageLine(state.usage),
    route: routeLine(state.route, state.options.routeThreshold, nowMs),
    remote: remoteLines(snapshot, nowMs),
    missing: (snapshot?.missing ?? []).map(key => MISSING_WORDS[key]),
    confirm: state.confirm,
    outcome: state.outcome,
    detail: state.detail,
    next: nextOf(state, members, board),
    isActing: state.isActing,
  }
}
