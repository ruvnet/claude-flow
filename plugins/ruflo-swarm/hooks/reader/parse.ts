/**
 * Parsers for the files ruflo writes under `.claude-flow/` and `.swarm/`, and for the JSON `hooks route` prints.
 * Every one takes text from disk that another process wrote, so each tolerates any shape: what it cannot read
 * is left out, never guessed. Nothing here reads, keeps or returns the hive's `hiveToken`.
 */
import { remoteHostOf, type RemoteHost } from './ruos'

/** Text longer than this is not read: a store that size is not one the CLI wrote, and parsing it would stall a hook. */
export const MAX_TEXT = 4_000_000
/** At most this many records of one kind are kept; the rest are counted, not drawn. */
export const MAX_RECORDS = 1_000

export type SwarmInfo = {
  id: string
  topology: string
  status: string
  maxAgents?: number
  strategy?: string
  consensus?: string
  agentIds: string[]
  updatedAt?: string
}

export type AgentRecord = {
  id: string
  type: string
  status: string
  health?: number
  taskCount?: number
  model?: string
  createdAt?: string
  /** Where the agent runs, when ruflo-ruos placed it on a ruOS desktop (`config.host`, see ./ruos). */
  remote?: RemoteHost
}

export type TaskRecord = {
  id: string
  type: string
  description: string
  priority: string
  status: string
  progress?: number
  assignedTo: string[]
}

export type ClaimRecord = {
  issueId: string
  status: string
  claimant: { kind: 'agent' | 'human'; id: string; agentType?: string }
  progress?: number
  handoffTo?: string
  isStealable: boolean
}

export type Proposal = { id: string; type: string; status: string; strategy: string; votesFor: number; votesAgainst: number; proposedBy: string }
export type Decision = { id: string; type: string; result: string; votesFor: number; votesAgainst: number; decidedAt: string }

export type HiveInfo = {
  topology: string
  strategy?: string
  queen?: { id: string; term?: number }
  workers: string[]
  pending: Proposal[]
  history: Decision[]
}

export type RoutePick = {
  task: string
  agent: string
  confidence: number
  matched: boolean
  pattern?: string
  alternatives: { agent: string; confidence: number }[]
  method?: string
  atMs: number
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/

/** Plain printable text of at most `max` characters: no control characters reach the terminal. */
export function plain(value: unknown, max = 200): string {
  if (typeof value !== 'string') {
    return ''
  }

  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim()

  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, Math.max(0, max - 1))}…`
}

/** An id as ruflo mints them (`agent-…`, `task-…`, `proposal-…`), or null: only such a string ever reaches an argv. */
export function idOf(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value) ? value : null
}

const numberOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
const stringOf = (value: unknown, max = 80): string | undefined => (typeof value === 'string' && value !== '' ? plain(value, max) : undefined)
const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** JSON text to a plain object, or null for anything else (too long, malformed, an array, a scalar). */
export function jsonObject(text: string | null): Record<string, unknown> | null {
  if (text === null || text.length > MAX_TEXT) {
    return null
  }

  try {
    return recordOf(JSON.parse(text))
  } catch {
    return null
  }
}

const valuesOf = (value: unknown): unknown[] => {
  const record = recordOf(value)

  return record === null ? [] : Object.values(record).slice(0, MAX_RECORDS)
}

/** `.claude-flow/swarm/swarm-state.json`: the running swarm, else the one updated last. */
export function parseSwarmStore(text: string | null): SwarmInfo | null {
  const swarms = valuesOf(jsonObject(text)?.swarms)
    .map(recordOf)
    .flatMap(swarm => {
      const id = idOf(swarm?.swarmId)

      if (swarm === null || id === null) {
        return []
      }

      const config = recordOf(swarm.config)

      return [
        {
          id,
          topology: stringOf(swarm.topology, 40) ?? 'unknown',
          status: stringOf(swarm.status, 40) ?? 'unknown',
          ...(numberOf(swarm.maxAgents) !== undefined && { maxAgents: numberOf(swarm.maxAgents) }),
          ...(stringOf(config?.strategy, 40) !== undefined && { strategy: stringOf(config?.strategy, 40) }),
          ...(stringOf(config?.consensusMechanism, 40) !== undefined && { consensus: stringOf(config?.consensusMechanism, 40) }),
          agentIds: (Array.isArray(swarm.agents) ? swarm.agents : []).slice(0, MAX_RECORDS).flatMap(agent => (idOf(agent) !== null ? [agent as string] : [])),
          ...(stringOf(swarm.updatedAt, 40) !== undefined && { updatedAt: stringOf(swarm.updatedAt, 40) }),
        } satisfies SwarmInfo,
      ]
    })

  const byRecency = (a: SwarmInfo, b: SwarmInfo) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')

  return [...swarms.filter(swarm => swarm.status === 'running')].sort(byRecency)[0] ?? [...swarms].sort(byRecency)[0] ?? null
}

/** `.swarm/state.json`: the pointer `swarm init` leaves, which names the swarm and its strategy. */
export function parseSwarmPointer(text: string | null): { id: string; topology?: string; strategy?: string; status?: string } | null {
  const value = jsonObject(text)
  const id = idOf(value?.id)

  if (value === null || id === null) {
    return null
  }

  return {
    id,
    ...(stringOf(value.topology, 40) !== undefined && { topology: stringOf(value.topology, 40) }),
    ...(stringOf(value.strategy, 40) !== undefined && { strategy: stringOf(value.strategy, 40) }),
    ...(stringOf(value.status, 40) !== undefined && { status: stringOf(value.status, 40) }),
  }
}

/** `.claude-flow/agents/store.json`. */
export function parseAgents(text: string | null): AgentRecord[] {
  return valuesOf(jsonObject(text)?.agents).flatMap(entry => {
    const agent = recordOf(entry)
    const id = idOf(agent?.agentId)

    if (agent === null || id === null) {
      return []
    }

    return [
      {
        id,
        type: stringOf(agent.agentType, 40) ?? 'agent',
        status: stringOf(agent.status, 20) ?? 'unknown',
        ...(numberOf(agent.health) !== undefined && { health: numberOf(agent.health) }),
        ...(numberOf(agent.taskCount) !== undefined && { taskCount: numberOf(agent.taskCount) }),
        ...(stringOf(agent.model, 40) !== undefined && { model: stringOf(agent.model, 40) }),
        ...(stringOf(agent.createdAt, 40) !== undefined && { createdAt: stringOf(agent.createdAt, 40) }),
        ...(remoteHostOf(agent.config) !== null && { remote: remoteHostOf(agent.config) as RemoteHost }),
      },
    ]
  })
}

/** `.claude-flow/tasks/store.json`. */
export function parseTasks(text: string | null): TaskRecord[] {
  return valuesOf(jsonObject(text)?.tasks).flatMap(entry => {
    const task = recordOf(entry)
    const id = idOf(task?.taskId)

    if (task === null || id === null) {
      return []
    }

    return [
      {
        id,
        type: stringOf(task.type, 40) ?? 'task',
        description: plain(task.description, 300),
        priority: stringOf(task.priority, 20) ?? 'normal',
        status: stringOf(task.status, 20) ?? 'unknown',
        ...(numberOf(task.progress) !== undefined && { progress: numberOf(task.progress) }),
        assignedTo: (Array.isArray(task.assignedTo) ? task.assignedTo : []).slice(0, 50).flatMap(agent => (idOf(agent) !== null ? [agent as string] : [])),
      },
    ]
  })
}

/** `.claude-flow/claims/claims.json`: issue claims (who works on what), not the authorization file `.claude-flow/claims.json`. */
export function parseClaims(text: string | null): ClaimRecord[] {
  const store = jsonObject(text)
  const stealable = recordOf(store?.stealable) ?? {}

  return valuesOf(store?.claims).flatMap(entry => {
    const claim = recordOf(entry)
    const issueId = idOf(claim?.issueId)
    const claimant = recordOf(claim?.claimant)

    if (claim === null || issueId === null || claimant === null) {
      return []
    }

    const isAgent = claimant.type === 'agent'
    const who = idOf(isAgent ? claimant.agentId : claimant.userId)

    if (who === null) {
      return []
    }

    const handoff = recordOf(claim.handoffTo)
    const handoffTo = idOf(handoff?.agentId ?? handoff?.userId)

    return [
      {
        issueId,
        status: stringOf(claim.status, 30) ?? 'unknown',
        claimant: { kind: isAgent ? 'agent' : 'human', id: who, ...(stringOf(claimant.agentType, 40) !== undefined && { agentType: stringOf(claimant.agentType, 40) }) },
        ...(numberOf(claim.progress) !== undefined && { progress: numberOf(claim.progress) }),
        ...(handoffTo !== null && { handoffTo }),
        isStealable: claim.status === 'stealable' || Object.hasOwn(stealable, issueId),
      },
    ]
  })
}

const votesOf = (value: unknown): { votesFor: number; votesAgainst: number } => {
  const votes = valuesOf(value)

  return { votesFor: votes.filter(vote => vote === true).length, votesAgainst: votes.filter(vote => vote === false).length }
}

/** `.claude-flow/hive-mind/state.json`, without its capability token. */
export function parseHive(text: string | null): HiveInfo | null {
  const hive = jsonObject(text)

  if (hive === null || hive.initialized !== true) {
    return null
  }

  const queen = recordOf(hive.queen)
  const queenId = idOf(queen?.agentId)
  const consensus = recordOf(hive.consensus)

  const pending = (Array.isArray(consensus?.pending) ? consensus.pending : []).slice(-50).flatMap(entry => {
    const proposal = recordOf(entry)
    const id = idOf(proposal?.proposalId)

    return proposal === null || id === null
      ? []
      : [
          {
            id,
            type: stringOf(proposal.type, 40) ?? 'proposal',
            status: stringOf(proposal.status, 20) ?? 'pending',
            strategy: stringOf(proposal.strategy, 20) ?? 'unknown',
            proposedBy: stringOf(proposal.proposedBy, 60) ?? 'unknown',
            ...votesOf(proposal.votes),
          },
        ]
  })

  const history = (Array.isArray(consensus?.history) ? consensus.history : []).slice(-50).flatMap(entry => {
    const decision = recordOf(entry)
    const id = idOf(decision?.proposalId)
    const votes = recordOf(decision?.votes)

    return decision === null || id === null
      ? []
      : [
          {
            id,
            type: stringOf(decision.type, 40) ?? 'proposal',
            result: stringOf(decision.result, 20) ?? 'unknown',
            votesFor: numberOf(votes?.for) ?? 0,
            votesAgainst: numberOf(votes?.against) ?? 0,
            decidedAt: stringOf(decision.decidedAt, 40) ?? '',
          },
        ]
  })

  return {
    topology: stringOf(hive.topology, 40) ?? 'unknown',
    ...(stringOf(hive.consensusStrategy, 30) !== undefined && { strategy: stringOf(hive.consensusStrategy, 30) }),
    ...(queenId !== null && { queen: { id: queenId, ...(numberOf(queen?.term) !== undefined && { term: numberOf(queen?.term) }) } }),
    workers: (Array.isArray(hive.workers) ? hive.workers : []).slice(0, MAX_RECORDS).flatMap(worker => (idOf(worker) !== null ? [worker as string] : [])),
    pending,
    history,
  }
}

/**
 * What `hooks route --format json` printed (log lines may come first), or the `hooks_route` MCP tool answered, as one pick.
 * The router's own `matched` flag is kept as it said it; whether the confidence clears a threshold is the view's call.
 */
export function parseRoute(text: string, atMs: number): RoutePick | null {
  const start = text.indexOf('{')
  const value = start < 0 ? null : jsonObject(text.slice(start, Math.min(text.length, start + 200_000)))
  const primary = recordOf(value?.primaryAgent)
  const agent = stringOf(primary?.type, 40)
  const confidence = numberOf(primary?.confidence)

  if (value === null || agent === undefined || confidence === undefined) {
    return null
  }

  const routing = recordOf(value.routing)

  return {
    task: plain(value.task, 200),
    agent,
    confidence: Math.max(0, Math.min(1, confidence)),
    matched: value.matched === true,
    ...(stringOf(value.matchedPattern, 40) !== undefined && { pattern: stringOf(value.matchedPattern, 40) }),
    alternatives: (Array.isArray(value.alternativeAgents) ? value.alternativeAgents : []).slice(0, 3).flatMap(entry => {
      const alt = recordOf(entry)
      const type = stringOf(alt?.type, 40)
      const score = numberOf(alt?.confidence)

      return type !== undefined && score !== undefined ? [{ agent: type, confidence: Math.max(0, Math.min(1, score)) }] : []
    }),
    ...(stringOf(routing?.method, 40) !== undefined && { method: stringOf(routing?.method, 40) }),
    atMs,
  }
}

/** A pick held in `$.store` read back: every field checked, as anything else from storage is. */
export function routeFromStore(value: unknown): RoutePick | null {
  const pick = recordOf(value)

  if (pick === null || typeof pick.task !== 'string' || typeof pick.agent !== 'string' || numberOf(pick.confidence) === undefined || numberOf(pick.atMs) === undefined) {
    return null
  }

  return parseRoute(JSON.stringify({ task: pick.task, matched: pick.matched, matchedPattern: pick.pattern, primaryAgent: { type: pick.agent, confidence: pick.confidence }, alternativeAgents: [], routing: { method: pick.method } }), numberOf(pick.atMs) ?? 0)
}
