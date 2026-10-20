/**
 * The event stream: what changed between two reads of ruflo's state, plus what the console observed itself (tool calls,
 * routes, mod admissions, permission denies). Every event is something that happened on disk or in this session, with
 * the time the console saw it: the stream never synthesises activity.
 */
import type { Snapshot } from './snapshot'

export type EventKind = 'swarm' | 'claims' | 'federation' | 'learning' | 'tools' | 'mods' | 'missions' | 'workflows' | 'autopilot' | 'anatole' | 'notices' | 'other'

export type ConsoleEvent = {
  atMs: number
  kind: EventKind
  text: string
  /** The ruflo agent the event concerns, when one does: the topology pulses along that agent's edge. */
  agentId?: string
  /** What the event is about, as `agent:<id>`, `claim:<id>`, `run:<id>`, `task:<id>`, `mission:<id>` or `step:<id>`; derived by `refOf` when absent. */
  ref?: string
  /** Which part of the console saw it, when not the diff of two reads: `autopilot`, `workflows`, `anatole`, `notices`, `session`. */
  src?: string
}

export const EVENT_KINDS: readonly EventKind[] = ['swarm', 'claims', 'federation', 'learning', 'tools', 'mods', 'missions', 'workflows', 'autopilot', 'anatole', 'notices', 'other']

export const isEventKind = (value: unknown): value is EventKind => typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value)

/** What an event is about: its own `ref`, else the agent it names, else the first issue or mission id in the words of a claims or missions event. */
export function refOf(event: ConsoleEvent): string | undefined {
  if (event.ref !== undefined) return event.ref
  if (event.agentId !== undefined) return `agent:${event.agentId}`

  const word = /^(?:task |mission |proposal )?([A-Za-z0-9][\w.:-]{2,60})/.exec(event.text)?.[1]

  if (word === undefined) return undefined
  if (event.kind === 'claims') return `${event.text.startsWith('task ') ? 'task' : 'claim'}:${word}`
  if (event.kind === 'missions') return `mission:${word}`

  return undefined
}
export const MAX_EVENTS = 300

const ev = (atMs: number, kind: EventKind, text: string, agentId?: string): ConsoleEvent => ({ atMs, kind, text, ...(agentId !== undefined && { agentId }) })

/** What changed from `prev` to `next`. The first read (no `prev`) is a baseline and yields nothing. */
export function diffEvents(prev: Snapshot | null, next: Snapshot, atMs: number): ConsoleEvent[] {
  if (prev === null) {
    return []
  }

  const out: ConsoleEvent[] = []
  const before = new Map(prev.agents.map(agent => [agent.id, agent]))
  const after = new Map(next.agents.map(agent => [agent.id, agent]))

  if (prev.swarm?.id !== next.swarm?.id && next.swarm !== null) out.push(ev(atMs, 'swarm', `swarm ${next.swarm.id} (${next.swarm.topology}) appeared`))
  if (prev.swarm !== null && next.swarm !== null && prev.swarm.id === next.swarm.id && prev.swarm.status !== next.swarm.status) {
    out.push(ev(atMs, 'swarm', `swarm ${next.swarm.status} (was ${prev.swarm.status})`))
  }

  for (const [id, agent] of after) {
    const old = before.get(id)

    if (old === undefined) out.push(ev(atMs, 'swarm', `agent ${agent.name ?? agent.type} spawned (${agent.type})`, id))
    else if (old.status !== agent.status) out.push(ev(atMs, 'swarm', `agent ${agent.name ?? agent.type}: ${old.status} → ${agent.status}`, id))
  }

  for (const [id, agent] of before) {
    if (!after.has(id)) out.push(ev(atMs, 'swarm', `agent ${agent.name ?? agent.type} left the store`, id))
  }

  const claimsBefore = new Map(prev.claims.map(claim => [claim.issueId, claim]))
  const claimsAfter = new Map(next.claims.map(claim => [claim.issueId, claim]))

  for (const [id, claim] of claimsAfter) {
    const old = claimsBefore.get(id)
    const owner = claim.claimant.kind === 'agent' ? claim.claimant.id : undefined

    if (old === undefined) out.push(ev(atMs, 'claims', `${id} claimed by ${claim.claimant.agentType ?? claim.claimant.name ?? claim.claimant.id}`, owner))
    else if (old.claimant.id !== claim.claimant.id) out.push(ev(atMs, 'claims', `${id} now held by ${claim.claimant.agentType ?? claim.claimant.id}`, owner))
    else if (old.status !== claim.status) out.push(ev(atMs, 'claims', `${id}: ${old.status} → ${claim.status}${claim.handoffTo !== undefined ? ` (to ${claim.handoffTo})` : ''}`, owner))
    else if ((old.progress ?? 0) !== (claim.progress ?? 0)) out.push(ev(atMs, 'claims', `${id} progress ${claim.progress ?? 0}%`, owner))
  }

  for (const [id, claim] of claimsBefore) {
    if (!claimsAfter.has(id)) out.push(ev(atMs, 'claims', `${id} released`, claim.claimant.kind === 'agent' ? claim.claimant.id : undefined))
  }

  const tasksBefore = new Set(prev.tasks.map(task => task.id))

  for (const task of next.tasks) {
    if (!tasksBefore.has(task.id)) out.push(ev(atMs, 'claims', `task ${task.id} created: ${task.description.slice(0, 60)}`))
  }

  const proposals = new Set(prev.hive?.pending.map(entry => entry.id) ?? [])
  const decided = new Set(prev.hive?.history.map(entry => entry.id) ?? [])

  for (const proposal of next.hive?.pending ?? []) {
    if (!proposals.has(proposal.id)) out.push(ev(atMs, 'swarm', `proposal ${proposal.type} (${proposal.strategy}) opened`, next.hive?.queen))
  }

  for (const decision of next.hive?.history ?? []) {
    if (!decided.has(decision.id)) out.push(ev(atMs, 'swarm', `proposal ${decision.type} decided: ${decision.result} (${decision.votesFor}/${decision.votesAgainst})`, next.hive?.queen))
  }

  // Each ballot new since the last read, tagged with its voter: the hive's honeycomb pulses that worker's cell.
  const ballotsBefore = new Map(prev.hive?.pending.map(entry => [entry.id, new Set(entry.ballots.map(ballot => ballot.voter))]) ?? [])

  for (const proposal of next.hive?.pending ?? []) {
    const seen = ballotsBefore.get(proposal.id) ?? new Set<string>()

    for (const ballot of proposal.ballots) {
      if (!seen.has(ballot.voter)) out.push(ev(atMs, 'swarm', `${ballot.voter} voted ${ballot.isFor ? 'for' : 'against'} ${proposal.type} (${proposal.id})`, ballot.voter))
    }
  }

  const workersBefore = new Set(prev.hive?.workers ?? [])
  const workersAfter = new Set(next.hive?.workers ?? [])

  for (const worker of workersAfter) if (!workersBefore.has(worker)) out.push(ev(atMs, 'swarm', `${worker} joined the hive`, worker))
  for (const worker of workersBefore) if (!workersAfter.has(worker)) out.push(ev(atMs, 'swarm', `${worker} left the hive`, worker))

  const patterns = (next.neural?.patterns ?? 0) - (prev.neural?.patterns ?? 0)

  if (prev.neural !== null && next.neural !== null && patterns > 0) out.push(ev(atMs, 'learning', `+${patterns} pattern${patterns === 1 ? '' : 's'} learned`))

  const outcomes = (next.outcomes?.total ?? 0) - (prev.outcomes?.total ?? 0)

  if (prev.outcomes !== null && outcomes > 0) out.push(ev(atMs, 'learning', `+${outcomes} routed outcome${outcomes === 1 ? '' : 's'} judged`))
  if ((prev.federationNodes?.length ?? 0) !== (next.federationNodes?.length ?? 0)) out.push(ev(atMs, 'federation', `federation keys: ${next.federationNodes?.length ?? 0} node ids on disk`))
  const missionsBefore = new Map((prev.missions?.missions ?? []).map(mission => [mission.id, mission]))

  for (const mission of next.missions?.missions ?? []) {
    const old = missionsBefore.get(mission.id)

    if (old === undefined) out.push(ev(atMs, 'missions', `mission ${mission.id} (${mission.state}): ${mission.objective.slice(0, 60)}`))
    else if (old.state !== mission.state) out.push(ev(atMs, 'missions', `mission ${mission.id}: ${old.state} → ${mission.state}`))
    else if (old.evidence.verified !== mission.evidence.verified) out.push(ev(atMs, 'missions', `mission ${mission.id}: ${mission.evidence.verified}/${mission.evidence.count} evidence verified`))
  }

  if (prev.hasNostrKey !== next.hasNostrKey && next.hasNostrKey === true) out.push(ev(atMs, 'federation', 'a nostr identity appeared (~/.ruflo/nostr.key)'))

  return out
}

/** Appends events, newest last, keeping at most MAX_EVENTS. */
export function record(events: ConsoleEvent[], fresh: readonly ConsoleEvent[]): void {
  if (fresh.length === 0) return

  events.push(...fresh)

  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}

/** The agents an event touched in the last `windowMs`, newest event per agent: what the topology pulses for. */
export function recentByAgent(events: readonly ConsoleEvent[], nowMs: number, windowMs: number): Map<string, number> {
  const out = new Map<string, number>()

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as ConsoleEvent

    if (nowMs - event.atMs > windowMs) break
    if (event.agentId !== undefined && !out.has(event.agentId)) out.set(event.agentId, event.atMs)
  }

  return out
}
