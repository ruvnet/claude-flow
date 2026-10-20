import { msOf, type AgentRecord, type SwarmInfo } from './parse'
import { sinceOf } from './safe'

/** How long a "running" swarm may go with no sign of activity before it is called stale. */
export const SWARM_STALE_MS = 24 * 3_600_000

/** An agent status that means it is working now (the same words the Workflows roster reads as running). */
export const BUSY = /busy|active|running/i

export type SwarmStatus = {
  /** The status as the record wrote it. */
  status: string
  /** What to show: the status, or "stalled" for a stale "running" swarm. */
  shown: string
  /** When the record was last written; undefined when missing or not a believable time (sinceOf). */
  updatedMs: number | undefined
  isStale: boolean
  /** The agent ids the record lists, each once. */
  ids: string[]
  /** How many ids it lists, and how many of them the agent store holds. */
  listed: number
  found: number
  /** The listed agents the store holds, each once (the first record of an id wins). */
  members: AgentRecord[]
}

/** The agent store with each id once: the first record of an id wins, so a duplicated record is never counted twice. */
export function uniqueAgents(agents: readonly AgentRecord[]): AgentRecord[] {
  const seen = new Set<string>()

  return agents.filter(agent => !seen.has(agent.id) && seen.add(agent.id) !== undefined)
}

/**
 * The one reading of a swarm record that Overview, Swarm, the status bar, the topology graph and Workflows use: its status, when it was written,
 * whether a "running" swarm is stale, and its OWN agents: the ids it lists, each once. The agent store holds every agent ever spawned, in any
 * swarm, and is never this swarm's count (a 0-agent swarm once read "259 agents").
 *
 * Stale needs evidence of no activity, not just an old record: the CLI does not rewrite `updatedAt` when an agent is spawned or when the status
 * is read, so a healthy long-running swarm has an old record. A "running" swarm is stale only when its record is over a day old AND it has
 * members, none of them busy, and the newest of them was created over a day ago. With no member to judge by, it shows its age and is not called
 * stale.
 */
export function swarmStatusOf(swarm: SwarmInfo, nowMs: number, agents: readonly AgentRecord[]): SwarmStatus {
  const updatedMs = sinceOf(msOf(swarm.updatedAt), nowMs)
  const own = swarmMembersOf(swarm, agents)
  const newest = own.members.reduce((latest, agent) => Math.max(latest, sinceOf(agent.createdAtMs, nowMs) ?? Number.POSITIVE_INFINITY), Number.NEGATIVE_INFINITY)
  const quiet = own.members.length > 0 && !own.members.some(agent => BUSY.test(agent.status)) && Number.isFinite(newest) && nowMs - newest > SWARM_STALE_MS
  const isStale = swarm.status === 'running' && updatedMs !== undefined && nowMs - updatedMs > SWARM_STALE_MS && quiet

  return { status: swarm.status, shown: isStale ? 'stalled' : swarm.status, updatedMs, isStale, ...own }
}

/** The swarm's own agents without a clock: the ids it lists, each once, how many of them the store holds, and those records. */
export function swarmMembersOf(swarm: SwarmInfo, agents: readonly AgentRecord[]): Pick<SwarmStatus, 'ids' | 'listed' | 'found' | 'members'> {
  const ids = [...new Set(swarm.agentIds)]
  const listed = new Set(ids)
  const members = uniqueAgents(agents).filter(agent => listed.has(agent.id))

  return { ids, listed: ids.length, found: members.length, members }
}

/** "2 agents", or "3 listed, 2 found" when the store lacks some of the listed ids. */
export const membersText = (status: Pick<SwarmStatus, 'listed' | 'found'>): string =>
  status.listed === status.found ? `${status.listed} agent${status.listed === 1 ? '' : 's'}` : `${status.listed} listed, ${status.found} found`

/** The record's status as a run state, so Workflows says what Overview says; null for a status it does not know. */
export const swarmRunState = (status: SwarmStatus): 'failed' | 'active' | 'stalled' | 'finished' | null =>
  /fail|error/i.test(status.status) ? 'failed' : /^running$|active/i.test(status.status) ? (status.isStale ? 'stalled' : 'active') : /terminat|stop|shut|complete|done|finish/i.test(status.status) ? 'finished' : null

/**
 * The agents with evidence of being here now, by the same rule as a swarm's staleness: busy now, created within SWARM_STALE_MS, or seen to
 * change status since `fromMs` (the console logs the first status it sees for every agent, so one entry alone is not activity). The agent store
 * keeps every agent ever spawned; without this, weeks-old idle records read as present.
 */
export function presentAgents(agents: readonly AgentRecord[], log: ReadonlyMap<string, readonly { atMs: number; status: string }[]>, fromMs: number, nowMs: number): AgentRecord[] {
  return uniqueAgents(agents).filter(agent => {
    if (BUSY.test(agent.status) || /working/i.test(agent.status)) return true

    const created = sinceOf(agent.createdAtMs, nowMs)

    if (created !== undefined && nowMs - created <= SWARM_STALE_MS) return true

    return (log.get(agent.id) ?? []).some((entry, i) => i > 0 && entry.atMs >= fromMs)
  })
}
