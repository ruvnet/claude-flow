/**
 * The hive-mind as the console reads it: the queen, its workers with their role and liveness, and what each open
 * proposal needs to pass. The quorum arithmetic is the CLI's own (`calculateRequiredVotes` and `tryResolveProposal` in
 * v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts), so the bar the view draws is the bar the CLI decides by. A
 * figure the source has no formula for (gossip and crdt fault tolerance) is n/a, never estimated.
 */
import type { ConsoleEvent } from './events'
import type { AgentRecord, HiveAgentRecord, HiveInfo, Proposal } from './parse'

/** The roles `hive-mind spawn --role` accepts. */
export const HIVE_ROLES = ['worker', 'specialist', 'scout'] as const

/** How long a worker's cell pulses after the console sees its vote, join or leave. */
export const HIVE_PULSE_MS = 2_000

/** Votes a proposal needs, exactly as the CLI counts them: `totalNodes` is the hive's workers, at least one. */
export function requiredVotes(strategy: string, totalNodes: number, quorumPreset = 'majority'): number {
  if (totalNodes <= 0) return 1

  const majority = Math.floor(totalNodes / 2) + 1
  const twoThirds = Math.floor((totalNodes * 2) / 3) + 1

  if (strategy === 'bft') return twoThirds
  if (strategy === 'quorum') return quorumPreset === 'unanimous' ? totalNodes : quorumPreset === 'supermajority' ? twoThirds : majority

  return majority
}

/** The CLI counts a hive with no workers as one node. */
export const nodesOf = (hive: HiveInfo): number => Math.max(1, hive.workers.length)

/**
 * The proposal strategy (`bft`, `raft`, `quorum`) a hive's consensus strategy maps to; null where the tool has none
 * (gossip, crdt), so a proposal falls back to the tool's default, raft.
 */
export function proposalStrategyOf(consensus: string | undefined): 'bft' | 'raft' | 'quorum' | null {
  if (consensus === 'byzantine' || consensus === 'bft') return 'bft'
  if (consensus === 'raft' || consensus === 'quorum') return consensus

  return null
}

/** Faulty workers the strategy survives: byzantine f < n/3, raft f < n/2. Null where the source states no bound. */
export function faultTolerance(consensus: string | undefined, workers: number): { faulty: number; of: number; rule: string } | null {
  if (workers <= 0) return null

  const strategy = proposalStrategyOf(consensus)

  if (strategy === 'bft') return { faulty: Math.floor((workers - 1) / 3), of: workers, rule: 'byzantine f < n/3' }
  if (strategy === 'raft') return { faulty: Math.floor((workers - 1) / 2), of: workers, rule: 'raft f < n/2' }

  return null
}

/** One open proposal against its bar: votes cast, votes needed, and whether its raft timeout has passed. */
export type Tally = { proposal: Proposal; required: number; nodes: number; isTimedOut: boolean; isDeadlocked: boolean }

export function tallyOf(hive: HiveInfo, proposal: Proposal, nowMs: number): Tally {
  const nodes = nodesOf(hive)
  const required = requiredVotes(proposal.strategy, nodes, proposal.quorumPreset)
  const remaining = nodes - proposal.ballots.length

  return {
    proposal,
    required,
    nodes,
    isTimedOut: proposal.strategy === 'raft' && proposal.timeoutAtMs !== undefined && nowMs > proposal.timeoutAtMs,
    // Neither side can still reach the bar: the next vote makes the CLI reject it.
    isDeadlocked: proposal.votesFor + remaining < required && proposal.votesAgainst + remaining < required,
  }
}

/** The open proposal j/k picks, by the shared item index; null when none is open. */
export function pickedProposal(hive: HiveInfo | null, index: number): Proposal | null {
  const pending = hive?.pending ?? []

  return pending.length === 0 ? null : (pending[((index % pending.length) + pending.length) % pending.length] ?? null)
}

/** The next registered worker with no ballot on `proposal`: only a worker may vote, and each votes once. */
export function nextVoter(hive: HiveInfo, proposal: Proposal): string | null {
  return hive.workers.find(worker => !proposal.ballots.some(ballot => ballot.voter === worker)) ?? null
}

/** Why a new proposal would be refused before it is asked: raft allows one pending proposal per term. */
export function proposeBlock(hive: HiveInfo): string | null {
  const strategy = proposalStrategyOf(hive.strategy) ?? 'raft'
  const term = hive.queenTerm ?? 1
  const holder = strategy === 'raft' ? hive.pending.find(entry => entry.strategy === 'raft' && entry.term === term && entry.status === 'pending') : undefined

  return holder === undefined ? null : `raft term ${term} already has ${holder.type} (${holder.id}) open: decide it first`
}

/** What the console last saw a hive member do, and when, while it is fresh: a vote either way, a join or a leave. */
export type HiveWave = { kind: 'for' | 'against' | 'join' | 'leave'; atMs: number }

/**
 * The newest fresh event about `id`, read from the words `diffEvents` writes ("<id> voted for …", "<id> joined the
 * hive"); null when there is none within HIVE_PULSE_MS of `nowMs`. The honeycomb runs a wave from that cell.
 */
export function waveOf(events: readonly ConsoleEvent[], id: string, nowMs: number): HiveWave | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as ConsoleEvent

    if (nowMs - event.atMs >= HIVE_PULSE_MS) break
    if (event.agentId !== id || event.atMs > nowMs) continue

    const words = event.text.startsWith(`${id} `) ? event.text.slice(id.length + 1) : ''
    const kind = words.startsWith('voted for ') ? 'for' : words.startsWith('voted against ') ? 'against' : words === 'joined the hive' ? 'join' : words === 'left the hive' ? 'leave' : null

    if (kind !== null) return { kind, atMs: event.atMs }
  }

  return null
}

/**
 * When the console first saw each broadcast, so the ticker slides a new one in once. Everything present at the first
 * read counts as old (arrived at -Infinity), so opening the view never animates what was already there.
 */
export class Arrivals {
  private readonly seen = new Map<string, number>()
  private hive: string | null = null

  arrivedAt(hiveId: string, ids: readonly string[], nowMs: number): Map<string, number> {
    const isFirst = this.hive !== hiveId

    if (isFirst) {
      this.hive = hiveId
      this.seen.clear()
    }

    for (const id of ids) if (!this.seen.has(id)) this.seen.set(id, isFirst ? Number.NEGATIVE_INFINITY : nowMs)

    // Forget what the hive no longer keeps (it holds the last 100), so the map stays the hive's size.
    if (this.seen.size > ids.length * 2 + 16) for (const id of [...this.seen.keys()]) if (!ids.includes(id)) this.seen.delete(id)

    return this.seen
  }
}

export type Liveness = 'busy' | 'idle' | 'down' | 'error' | 'unknown'

/** One hive worker as the stores describe it; `isKnown` is false for an id in no agent store. */
export type Member = { id: string; role: string; status: string; type?: string; liveness: Liveness; isKnown: boolean }

export function livenessOf(status: string): Liveness {
  if (/error|fail/i.test(status)) return 'error'
  if (/busy|active|running|working/i.test(status)) return 'busy'
  if (/stop|terminat|offline|dead/i.test(status)) return 'down'
  if (/idle|ready|waiting/i.test(status)) return 'idle'

  return 'unknown'
}

/** Each of `hive.workers`, its role from agents.json and its status from agents.json or the agent store. */
export function membersOf(hive: HiveInfo, hiveAgents: readonly HiveAgentRecord[], agents: readonly AgentRecord[]): Member[] {
  const spawned = new Map(hiveAgents.map(agent => [agent.id, agent]))
  const stored = new Map(agents.map(agent => [agent.id, agent]))

  return hive.workers.map(id => {
    const record = spawned.get(id) ?? stored.get(id)

    if (record === undefined) return { id, role: 'n/a', status: 'not in a store', liveness: 'unknown', isKnown: false }

    return { id, role: spawned.get(id)?.role ?? 'n/a', status: record.status, type: record.type, liveness: livenessOf(record.status), isKnown: true }
  })
}
