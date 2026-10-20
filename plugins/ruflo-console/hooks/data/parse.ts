/**
 * Readers for the swarm files ruflo writes under `.claude-flow/` and `.swarm/`.
 *
 * Vendored from plugins/ruflo-swarm/hooks/reader/parse.ts (a mod may import only its own files), cut to what the console
 * draws, with the claim record extended by its timestamps and context. Every one takes text another process wrote, so
 * each tolerates any shape: what it cannot read is left out, never guessed. Nothing here keeps the hive's `hiveToken`.
 */
import { countOf, ratioOf, timeOf } from './safe'

/** Text longer than this is not parsed: a store that size is not one the CLI wrote, and parsing it would stall a hook. */
export const MAX_TEXT = 4_000_000
/** At most this many records of one kind are kept; the rest are counted, not drawn. */
export const MAX_RECORDS = 1_000

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/

// Whole escape sequences go first (the CLI colours its output; a hostile file may carry a hyperlink or a title): stripping only the ESC byte
// would leave `[1m` or `]8;;https://…` in the text. Written as \u escapes so no invisible character sits in this source.
export const ESCAPES = new RegExp('\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\|(?=\\u001b)|$)|\\u009d[^\\u0007\\u009c\\u009d]*(?:[\\u0007\\u009c]|(?=\\u009d)|$)|(?:\\u001b\\[|\\u009b)[0-9;?]*[ -/]*[@-~]', 'g')
// Controls, DEL, C1, soft hyphen, combining grapheme joiner, Arabic letter mark, zero-width and bidi characters, invisible operators,
// variation selectors, Hangul fillers and BOM: nothing a person could read, all of them fit for hiding or reordering text.
export const HIDDEN = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0d\\ufeff\\uffa0\\ufff9-\\ufffb]|[\\u{e0000}-\\u{e0fff}]', 'gu')

/** The zero-width and format characters that can split a credential or a keyword without being seen: removed (not spaced) before any mask or pattern runs. */
export const INVISIBLE = new RegExp('[\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb]|[\\u{e0000}-\\u{e0fff}]', 'gu')

/** Plain printable text of at most `max` characters: no escape sequence, control, hidden or bidi-override character reaches the terminal. */
export function plain(value: unknown, max = 200): string {
  if (typeof value !== 'string') {
    return ''
  }

  const cleaned = value.replace(ESCAPES, '').replace(INVISIBLE, '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim()

  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, Math.max(0, max - 1))}…`
}

/** An id as ruflo mints them (`agent-…`, `swarm-…`, `proposal-…`), or null: only such a string ever reaches an argv. */
export function idOf(value: unknown): string | null {
  return typeof value === 'string' && ID.test(value) ? value : null
}

export const numberOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
export const stringOf = (value: unknown, max = 80): string | undefined => (typeof value === 'string' && value !== '' ? plain(value, max) || undefined : undefined)
export const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** JSON text to a plain object, or null for anything else (too long, malformed, an array, a scalar). */
export function jsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.length > MAX_TEXT) {
    return null
  }

  try {
    return recordOf(JSON.parse(text))
  } catch {
    return null
  }
}

export const valuesOf = (value: unknown): unknown[] => {
  const record = recordOf(value)

  return record === null ? [] : Object.values(record).slice(0, MAX_RECORDS)
}

/** An ISO time to epoch milliseconds, or undefined. */
export const msOf = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return timeOf(value)
  }

  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN

  return Number.isFinite(parsed) ? parsed : undefined
}

export type SwarmInfo = { id: string; topology: string; status: string; maxAgents?: number; strategy?: string; agentIds: string[]; updatedAt?: string }
export type AgentRecord = { id: string; type: string; name?: string; status: string; health?: number; taskCount?: number; createdAtMs?: number }
export type TaskRecord = {
  id: string
  type: string
  description: string
  status: string
  assignedTo: string[]
  createdAtMs?: number
  /** `mission:<id>` / `task:<id>` style labels (plain words only), as `task_create` stored them. */
  tags?: string[]
  startedAtMs?: number
  completedAtMs?: number
  /** What `task_complete` / `task_update` recorded as the result, flattened to `key: value` text (bounded). */
  resultText?: string
}
export type Claimant = { kind: 'agent' | 'human'; id: string; agentType?: string; name?: string }
export type ClaimRecord = {
  issueId: string
  status: string
  claimant: Claimant
  progress?: number
  handoffTo?: string
  isStealable: boolean
  claimedAtMs?: number
  changedAtMs?: number
  /** ruflo's claim type declares `expiresAt`, but no claims tool sets it today: absent means no TTL, not an expired one. */
  expiresAtMs?: number
  context?: string
}
/** One worker's vote on a proposal, as `votes` records it: the voter's id and whether it voted for. */
export type Ballot = { voter: string; isFor: boolean }
export type Proposal = {
  id: string
  type: string
  status: string
  strategy: string
  votesFor: number
  votesAgainst: number
  /** Who voted which way, in the order the store lists them. */
  ballots: Ballot[]
  /** Voters the CLI excluded as Byzantine (bft proposals only). */
  byzantine: string[]
  value?: string
  proposedBy?: string
  proposedAtMs?: number
  /** Raft: the term the proposal belongs to, and when it may be re-proposed in the next one. */
  term?: number
  timeoutAtMs?: number
  /** Quorum: unanimous, majority or supermajority. */
  quorumPreset?: string
}
export type Decision = { id: string; type: string; result: string; votesFor: number; votesAgainst: number; strategy?: string; term?: number; decidedAtMs?: number; byzantine: number }
/** A message `hive-mind broadcast` left in the hive's shared memory. */
export type Broadcast = { id: string; message: string; priority: string; from: string; atMs?: number }
export type HiveInfo = {
  topology: string
  strategy?: string
  queen?: string
  queenTerm?: number
  queenElectedAtMs?: number
  workers: string[]
  pending: Proposal[]
  history: Decision[]
  /** The newest broadcasts, oldest first, and every shared-memory key (values are not kept: they are anyone's JSON). */
  broadcasts: Broadcast[]
  memoryKeys: string[]
  createdAtMs?: number
  updatedAtMs?: number
}
/** A worker `hive-mind spawn` wrote to `.claude-flow/agents.json`, with the role it was given in the hive. */
export type HiveAgentRecord = AgentRecord & { role?: string }

/** `.claude-flow/swarm/swarm-state.json`: the running swarm, else the one updated last. */
export function parseSwarmStore(text: string | null): SwarmInfo | null {
  const swarms = valuesOf(jsonObject(text)?.swarms).flatMap(entry => {
    const swarm = recordOf(entry)
    const id = idOf(swarm?.swarmId)

    if (swarm === null || id === null) {
      return []
    }

    const config = recordOf(swarm.config)
    const info: SwarmInfo = {
      id,
      topology: stringOf(swarm.topology, 40) ?? 'unknown',
      status: stringOf(swarm.status, 40) ?? 'unknown',
      agentIds: (Array.isArray(swarm.agents) ? swarm.agents : []).slice(0, MAX_RECORDS).flatMap(agent => {
        const agentId = idOf(agent) ?? idOf(recordOf(agent)?.agentId) ?? idOf(recordOf(agent)?.id)

        return agentId !== null ? [agentId] : []
      }),
    }
    const maxAgents = countOf(swarm.maxAgents)
    const strategy = stringOf(config?.strategy, 40)
    const updatedAt = stringOf(swarm.updatedAt, 40)

    if (maxAgents !== undefined) info.maxAgents = maxAgents
    if (strategy !== undefined) info.strategy = strategy
    if (updatedAt !== undefined) info.updatedAt = updatedAt

    return [info]
  })
  // By instant, not text: "…T10:00+02:00" is older than "…T09:00Z" though it sorts after it as a string. Unparseable sorts last.
  const byRecency = (a: SwarmInfo, b: SwarmInfo) => (msOf(b.updatedAt) ?? -Infinity) - (msOf(a.updatedAt) ?? -Infinity) || 0

  return [...swarms.filter(swarm => swarm.status === 'running')].sort(byRecency)[0] ?? [...swarms].sort(byRecency)[0] ?? null
}

/** `.swarm/state.json`: the pointer `swarm init` (or `swarm start`) leaves. */
export function parseSwarmPointer(text: string | null): { id: string; topology?: string; strategy?: string; status?: string } | null {
  const value = jsonObject(text)
  const id = idOf(value?.id) ?? idOf(value?.swarmId)

  if (value === null || id === null) {
    return null
  }

  const pointer: { id: string; topology?: string; strategy?: string; status?: string } = { id }
  const topology = stringOf(value.topology, 40)
  const strategy = stringOf(value.strategy, 40)
  const status = stringOf(value.status, 40)

  if (topology !== undefined) pointer.topology = topology
  if (strategy !== undefined) pointer.strategy = strategy
  if (status !== undefined) pointer.status = status

  return pointer
}

/** `.claude-flow/agents/store.json`. */
export function parseAgents(text: string | null): AgentRecord[] {
  return valuesOf(jsonObject(text)?.agents).flatMap(entry => {
    const agent = recordOf(entry)
    const id = idOf(agent?.agentId)

    if (agent === null || id === null) {
      return []
    }

    const record: AgentRecord = { id, type: stringOf(agent.agentType, 40) ?? 'agent', status: stringOf(agent.status, 20) ?? 'unknown' }
    const name = stringOf(agent.name, 40)
    const health = ratioOf(agent.health)
    const taskCount = countOf(agent.taskCount)
    const createdAtMs = msOf(agent.createdAt)

    if (name !== undefined) record.name = name
    if (health !== undefined) record.health = health
    if (taskCount !== undefined) record.taskCount = taskCount
    if (createdAtMs !== undefined) record.createdAtMs = createdAtMs

    return [record]
  })
}

/** `.claude-flow/tasks/store.json`. */
/** A task's result object as one bounded line of `key: value` pairs (strings and numbers only), or undefined. */
function resultTextOf(value: unknown): string | undefined {
  const result = recordOf(value)

  if (result === null) return typeof value === 'string' ? plain(value, 400) || undefined : undefined

  const text = Object.entries(result)
    .slice(0, 8)
    .flatMap(([key, v]) => (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? [`${plain(key, 24)}: ${plain(String(v), 160)}`] : []))
    .join(' · ')

  return text === '' ? undefined : text.slice(0, 500)
}

export function parseTasks(text: string | null): TaskRecord[] {
  return valuesOf(jsonObject(text)?.tasks).flatMap(entry => {
    const task = recordOf(entry)
    const id = idOf(task?.taskId)

    return task === null || id === null
      ? []
      : [
          {
            id,
            type: stringOf(task.type, 40) ?? 'task',
            description: plain(task.description, 200),
            status: stringOf(task.status, 20) ?? 'unknown',
            assignedTo: (Array.isArray(task.assignedTo) ? task.assignedTo : []).slice(0, 50).flatMap(agent => (idOf(agent) !== null ? [agent as string] : [])),
            ...(msOf(task.createdAt) !== undefined && { createdAtMs: msOf(task.createdAt) }),
            tags: (Array.isArray(task.tags) ? task.tags : []).slice(0, 12).flatMap(tag => (typeof tag === 'string' && /^[A-Za-z0-9_.:-]{1,90}$/.test(tag) ? [tag] : [])),
            ...(msOf(task.startedAt) !== undefined && { startedAtMs: msOf(task.startedAt) }),
            ...(msOf(task.completedAt) !== undefined && { completedAtMs: msOf(task.completedAt) }),
            ...(resultTextOf(task.result) !== undefined && { resultText: resultTextOf(task.result) }),
          },
        ]
  })
}

function claimantOf(value: unknown): Claimant | null {
  const claimant = recordOf(value)

  if (claimant === null) {
    return null
  }

  const isAgent = claimant.type === 'agent'
  const id = idOf(isAgent ? claimant.agentId : claimant.userId)

  if (id === null) {
    return null
  }

  const who: Claimant = { kind: isAgent ? 'agent' : 'human', id }
  const agentType = stringOf(claimant.agentType, 40)
  const name = stringOf(claimant.name, 40)

  if (agentType !== undefined) who.agentType = agentType
  if (name !== undefined) who.name = name

  return who
}

/** `.claude-flow/claims/claims.json`: issue claims (who works on what), not the authorization file `.claude-flow/claims.json`. */
export function parseClaims(text: string | null): ClaimRecord[] {
  const store = jsonObject(text)
  const stealable = recordOf(store?.stealable) ?? {}

  return valuesOf(store?.claims).flatMap(entry => {
    const claim = recordOf(entry)
    const issueId = idOf(claim?.issueId)
    const claimant = claimantOf(claim?.claimant)

    if (claim === null || issueId === null || claimant === null) {
      return []
    }

    const handoff = recordOf(claim.handoffTo)
    const handoffTo = idOf(handoff?.agentId ?? handoff?.userId)
    const record: ClaimRecord = {
      issueId,
      status: stringOf(claim.status, 30) ?? 'unknown',
      claimant,
      isStealable: claim.status === 'stealable' || Object.hasOwn(stealable, issueId),
    }
    const progress = numberOf(claim.progress)
    const claimedAtMs = msOf(claim.claimedAt)
    const changedAtMs = msOf(claim.statusChangedAt)
    const expiresAtMs = msOf(claim.expiresAt)
    const context = stringOf(claim.context, 120)

    if (progress !== undefined) record.progress = Math.max(0, Math.min(100, progress))
    if (handoffTo !== null) record.handoffTo = handoffTo
    if (claimedAtMs !== undefined) record.claimedAtMs = claimedAtMs
    if (changedAtMs !== undefined) record.changedAtMs = changedAtMs
    if (expiresAtMs !== undefined) record.expiresAtMs = expiresAtMs
    if (context !== undefined) record.context = context

    return [record]
  })
}

const votesOf = (value: unknown): { votesFor: number; votesAgainst: number; ballots: Ballot[] } => {
  const ballots = Object.entries(recordOf(value) ?? {})
    .slice(0, MAX_RECORDS)
    .flatMap(([voter, vote]) => (idOf(voter) !== null && typeof vote === 'boolean' ? [{ voter, isFor: vote }] : []))

  return { votesFor: ballots.filter(ballot => ballot.isFor).length, votesAgainst: ballots.filter(ballot => !ballot.isFor).length, ballots }
}

const idsOf = (value: unknown, max = 50): string[] => (Array.isArray(value) ? value : []).slice(0, max).flatMap(entry => (idOf(entry) !== null ? [entry as string] : []))

/** A proposal's value as one bounded line: a string as it is, anything else as its JSON. */
function valueText(value: unknown): string | undefined {
  if (typeof value === 'string') return stringOf(value, 120)
  if (value === undefined || value === null) return undefined

  try {
    return stringOf(JSON.stringify(value).slice(0, 400), 120)
  } catch {
    return undefined
  }
}

function proposalOf(entry: unknown): Proposal | null {
  const proposal = recordOf(entry)
  const id = idOf(proposal?.proposalId)

  if (proposal === null || id === null) return null

  const out: Proposal = {
    id,
    type: stringOf(proposal.type, 40) ?? 'proposal',
    status: stringOf(proposal.status, 20) ?? 'pending',
    strategy: stringOf(proposal.strategy, 20) ?? 'unknown',
    ...votesOf(proposal.votes),
    byzantine: idsOf(proposal.byzantineVoters),
  }
  const value = valueText(proposal.value)
  const proposedBy = idOf(proposal.proposedBy)
  const proposedAtMs = msOf(proposal.proposedAt)
  const term = numberOf(proposal.term)
  const timeoutAtMs = msOf(proposal.timeoutAt)
  const quorumPreset = stringOf(proposal.quorumPreset, 20)

  if (value !== undefined) out.value = value
  if (proposedBy !== null) out.proposedBy = proposedBy
  if (proposedAtMs !== undefined) out.proposedAtMs = proposedAtMs
  if (term !== undefined) out.term = term
  if (timeoutAtMs !== undefined) out.timeoutAtMs = timeoutAtMs
  if (quorumPreset !== undefined) out.quorumPreset = quorumPreset

  return out
}

function decisionOf(entry: unknown): Decision | null {
  const decision = recordOf(entry)
  const id = idOf(decision?.proposalId)
  const votes = recordOf(decision?.votes)

  if (decision === null || id === null) return null

  const out: Decision = {
    id,
    type: stringOf(decision.type, 40) ?? 'proposal',
    result: stringOf(decision.result, 20) ?? 'unknown',
    votesFor: countOf(votes?.for) ?? 0,
    votesAgainst: countOf(votes?.against) ?? 0,
    byzantine: idsOf(decision.byzantineDetected).length,
  }
  const strategy = stringOf(decision.strategy, 20)
  const term = numberOf(decision.term)
  const decidedAtMs = msOf(decision.decidedAt)

  if (strategy !== undefined) out.strategy = strategy
  if (term !== undefined) out.term = term
  if (decidedAtMs !== undefined) out.decidedAtMs = decidedAtMs

  return out
}

/** `sharedMemory.broadcasts`, the last 20, each field bounded: the message is free text another process wrote. */
function broadcastsOf(value: unknown): Broadcast[] {
  return (Array.isArray(value) ? value : []).slice(-20).flatMap(entry => {
    const message = recordOf(entry)
    const id = idOf(message?.messageId)
    const text = stringOf(message?.message, 160)

    if (message === null || id === null || text === undefined) return []

    const atMs = msOf(message.timestamp)

    return [{ id, message: text, priority: stringOf(message.priority, 12) ?? 'normal', from: idOf(message.fromId) ?? 'system', ...(atMs !== undefined && { atMs }) }]
  })
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
  const shared = recordOf(hive.sharedMemory)
  const info: HiveInfo = {
    topology: stringOf(hive.topology, 40) ?? 'unknown',
    workers: idsOf(hive.workers, MAX_RECORDS),
    pending: (Array.isArray(consensus?.pending) ? consensus.pending : []).slice(-50).flatMap(entry => proposalOf(entry) ?? []),
    history: (Array.isArray(consensus?.history) ? consensus.history : []).slice(-50).flatMap(entry => decisionOf(entry) ?? []),
    broadcasts: broadcastsOf(shared?.broadcasts),
    memoryKeys: Object.keys(shared ?? {}).slice(0, 200).flatMap(key => (idOf(key) !== null ? [key] : [])),
  }
  const strategy = stringOf(hive.consensusStrategy, 30)
  const term = numberOf(queen?.term)
  const electedAtMs = msOf(queen?.electedAt)
  const createdAtMs = msOf(hive.createdAt)
  const updatedAtMs = msOf(hive.updatedAt)

  if (strategy !== undefined) info.strategy = strategy
  if (queenId !== null) info.queen = queenId
  if (term !== undefined) info.queenTerm = term
  if (electedAtMs !== undefined) info.queenElectedAtMs = electedAtMs
  if (createdAtMs !== undefined) info.createdAtMs = createdAtMs
  if (updatedAtMs !== undefined) info.updatedAtMs = updatedAtMs

  return info
}

/** `.claude-flow/agents.json`: the workers `hive-mind spawn` writes (the other agent tools use agents/store.json), with their hive role. */
export function parseHiveAgents(text: string | null): HiveAgentRecord[] {
  const roles = new Map(
    valuesOf(jsonObject(text)?.agents).flatMap(entry => {
      const agent = recordOf(entry)
      const id = idOf(agent?.agentId)
      const role = stringOf(recordOf(agent?.config)?.hiveRole, 20)

      return id !== null && role !== undefined ? [[id, role] as const] : []
    }),
  )

  return parseAgents(text).map(agent => {
    const role = roles.get(agent.id)

    return role === undefined ? agent : { ...agent, role }
  })
}

/** The tail of an id a person can tell apart at a glance: `agent-1790954653916-od014i` → `od014i`. */
export function shortId(id: string): string {
  const tail = id.split(/[-_:]/).pop() ?? id

  return tail.length >= 4 ? tail.slice(-6) : id.slice(-6)
}

/** One readable label per agent: its name, else its type, with a short id only where two would read the same. */
export function agentLabels(agents: readonly { id: string; name?: string; type: string }[]): Map<string, string> {
  const base = (agent: { name?: string; type: string }) => agent.name ?? agent.type
  const counts = new Map<string, number>()

  for (const agent of agents) counts.set(base(agent), (counts.get(base(agent)) ?? 0) + 1)

  return new Map(agents.map(agent => [agent.id, (counts.get(base(agent)) ?? 0) > 1 ? `${base(agent)}·${shortId(agent.id).slice(-4)}` : base(agent)]))
}
