import { runWord, type RunEventType } from '../reader/ruos'
import type { Snapshot } from '../reader/snapshot'

/** How a tile is coloured: the five states the pane names. */
export type MemberState = 'idle' | 'working' | 'blocked' | 'done' | 'failed'

export type PulseKind = 'read' | 'write'

/** One Claude Code agent loop as the engine reported it (`agent.spawn`, `$.agent.list()`), and what it has done since. */
export type LoopRecord = {
  id: string
  /** The agent type it runs as, without a plugin's prefix (`ruflo-swarm:coordinator` → `coordinator`). */
  role: string
  name?: string
  description?: string
  /** The numbers of the accepted ADRs the agent was told about when it was spawned (ruflo-console, ADR-480). */
  adrs?: number[]
  status: string
  calls: number
  errors: number
  lastTool?: string
  lastSubject?: string
  lastAtMs: number
  pulse?: { kind: PulseKind; atMs: number }
}

/** What the session's loops are doing, kept by the hooks between reads of the disk. */
export type Activity = {
  /** Claude Code's own subagents and teammates, by agent id; `lead` is the main loop. */
  loops: Map<string, LoopRecord>
  turnId: string | null
  isWorking: boolean
  /** The last few calls of each loop, newest last, for the activity view. */
  recent: Map<string, { tool: string; subject: string; isError: boolean; atMs: number }[]>
}

export const LEAD = 'lead'
export const PULSE_MS = 2_000
const RECENT = 12
const MAX_LOOPS = 200

export function newActivity(): Activity {
  return { loops: new Map(), turnId: null, isWorking: false, recent: new Map() }
}

export type Member = {
  id: string
  label: string
  role: string
  source: 'ruflo' | 'claude' | 'lead' | 'queen'
  state: MemberState
  /** The word under the colour, as the source said it (`busy`, `terminated`, `running`). */
  word: string
  pulse?: PulseKind
  isLeader: boolean
  claims: number
  calls: number
}

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead'])

/** Whether a tool call reads or writes files, or neither (a pulse is for file work only). */
export function pulseOf(tool: string, command?: string): PulseKind | null {
  if (WRITE_TOOLS.has(tool)) {
    return 'write'
  }

  if (READ_TOOLS.has(tool)) {
    return 'read'
  }

  if ((tool === 'Bash' || tool === 'PowerShell') && command !== undefined) {
    return /(?:>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\brm\b|\bmkdir\b|\btouch\b|\bpatch\b|\bgit\s+(?:apply|checkout|restore|commit))/.test(command) ? 'write' : 'read'
  }

  return null
}

export const roleOf = (type: string): string => (type.includes(':') ? type.slice(type.lastIndexOf(':') + 1) : type) || 'agent'

function loopFor(activity: Activity, id: string, nowMs: number): LoopRecord {
  const held = activity.loops.get(id)

  if (held !== undefined) {
    return held
  }

  if (activity.loops.size >= MAX_LOOPS) {
    // Bounded: the loop not heard from longest makes room.
    const oldest = [...activity.loops.values()].filter(loop => loop.id !== LEAD).sort((a, b) => a.lastAtMs - b.lastAtMs)[0]

    if (oldest !== undefined) {
      activity.loops.delete(oldest.id)
      activity.recent.delete(oldest.id)
    }
  }

  const loop: LoopRecord = { id, role: id === LEAD ? 'lead' : 'agent', status: 'running', calls: 0, errors: 0, lastAtMs: nowMs }

  activity.loops.set(id, loop)

  return loop
}

/** A subagent the engine started (`agent.spawn`'s answer), with the type and name it was asked for. */
export function noteSpawn(activity: Activity, id: string, type: string, nowMs: number, name?: string, description?: string, adrs: readonly number[] = []): void {
  const loop = loopFor(activity, id, nowMs)

  loop.role = roleOf(type)
  loop.status = 'running'
  loop.lastAtMs = nowMs

  if (name !== undefined) {
    loop.name = name
  }

  if (description !== undefined) {
    loop.description = description
  }

  if (adrs.length > 0) {
    loop.adrs = adrs.slice(0, 8)
    loop.description = `${loop.description ?? ''}${loop.description === undefined ? '' : ' '}[guided by ADR ${adrs.slice(0, 8).join(', ')}]`.slice(0, 200)
  }
}

/** A tool call made by a loop (`agentId` absent: the main loop). Returns the pulse it lit, if any. */
export function noteCall(activity: Activity, agentId: string | undefined, tool: string, subject: string, nowMs: number, command?: string): PulseKind | null {
  const id = agentId ?? LEAD
  const loop = loopFor(activity, id, nowMs)
  const pulse = pulseOf(tool, command)

  loop.calls += 1
  loop.lastTool = tool
  loop.lastSubject = subject
  loop.lastAtMs = nowMs

  if (pulse !== null) {
    loop.pulse = { kind: pulse, atMs: nowMs }
  }

  return pulse
}

export function noteResult(activity: Activity, agentId: string | undefined, tool: string, subject: string, isError: boolean, nowMs: number): void {
  const id = agentId ?? LEAD
  const loop = loopFor(activity, id, nowMs)

  if (isError) {
    loop.errors += 1
  }

  activity.recent.set(id, [...(activity.recent.get(id) ?? []), { tool, subject, isError, atMs: nowMs }].slice(-RECENT))
}

/** How many failures in a row of one call make a loop stuck (ADR-477). */
export const STUCK_AFTER = 3

/** What a loop is called to the person, as its tile says it (a loop known only from its tool calls is said to be a subagent). */
export function loopLabel(activity: Activity, id: string): string {
  const loop = activity.loops.get(id)

  if (id === LEAD) return 'claude (main)'

  return loop === undefined ? `subagent …${id.slice(-4)}` : (loop.name ?? (loop.role === 'agent' ? `subagent …${id.slice(-4)}` : loop.role))
}

/** The call a loop has just failed STUCK_AFTER times running with the same subject (nothing in between), else null: the sign of a loop going round in circles. */
export function stuckCall(activity: Activity, agentId: string | undefined): { tool: string; subject: string } | null {
  const last = (activity.recent.get(agentId ?? LEAD) ?? []).slice(-STUCK_AFTER)
  const [first] = last

  if (first === undefined || last.length < STUCK_AFTER) return null

  return last.every(call => call.isError && call.tool === first.tool && call.subject === first.subject) ? { tool: first.tool, subject: first.subject } : null
}

/** A loop's own `turn.complete`: a subagent's answer is in. */
export function noteDone(activity: Activity, agentId: string, reason: string, nowMs: number): void {
  const loop = loopFor(activity, agentId, nowMs)

  loop.status = reason === 'answer' ? 'completed' : reason === 'aborted' ? 'killed' : 'failed'
  loop.lastAtMs = nowMs
}

/** `$.agent.list()` as the engine answered it: types and statuses for loops the hooks saw start before this module did. */
export function noteListed(activity: Activity, listed: readonly { id: string; type: string; status: string; description?: string; name?: string }[], nowMs: number): void {
  for (const agent of listed.slice(0, MAX_LOOPS)) {
    const loop = loopFor(activity, agent.id, nowMs)

    loop.role = roleOf(agent.type)
    loop.status = agent.status

    // A named Agent call runs as an in-process teammate, listed as type `teammate`: its name is what tells it apart.
    if (agent.name !== undefined && agent.name !== '') {
      loop.name = agent.name.slice(0, 40)
    }

    if (agent.description !== undefined && loop.description === undefined) {
      loop.description = agent.description
    }
  }
}

const RUFLO_STATES: Record<string, MemberState> = { idle: 'idle', busy: 'working', terminated: 'done' }
const RUN_STATES: Partial<Record<RunEventType, MemberState>> = { 'run.started': 'working', 'run.output': 'working', 'run.completed': 'done', 'run.failed': 'failed', 'run.stopped': 'done' }
const LOOP_STATES: Record<string, MemberState> = { running: 'working', pending: 'working', completed: 'done', failed: 'failed', killed: 'failed' }

/**
 * The tiles, in a stable order: the leader first, then ruflo's agents as the store lists them, then Claude Code's loops.
 * A ruflo agent with a blocked claim is blocked; a loop that has not called a tool for a while is idle, not working.
 */
export function membersOf(snapshot: Snapshot | null, activity: Activity, nowMs: number): Member[] {
  const claims = snapshot?.claims ?? []
  const claimsOf = (id: string) => claims.filter(claim => claim.claimant.id === id && claim.status !== 'completed')
  const queen = snapshot?.hive?.queen
  const members: Member[] = []

  if (queen !== undefined) {
    members.push({ id: queen.id, label: 'queen', role: 'queen', source: 'queen', state: 'working', word: `term ${queen.term ?? '?'}`, isLeader: true, claims: 0, calls: 0 })
  }

  const coordinator = (snapshot?.agents ?? []).find(agent => /coordinator|queen/.test(agent.type) && agent.status !== 'terminated')

  const events = snapshot?.ruos.events ?? []

  for (const agent of snapshot?.agents ?? []) {
    const held = claimsOf(agent.id)
    const isBlocked = held.some(claim => claim.status === 'blocked')
    const remote = agent.remote
    // On a ruOS desktop the newest lifecycle event for its run (or the agent) says where it stands.
    const run = remote === undefined ? undefined : events.filter(event => event.type !== 'desktop.state' && ((remote.runId !== undefined && event.runId === remote.runId) || event.agentId === agent.id)).sort((a, b) => b.ts - a.ts)[0]
    const runState = run === undefined ? undefined : RUN_STATES[run.type]

    members.push({
      id: agent.id,
      label: remote === undefined ? agent.type : `${agent.type} @${remote.desktopName}`,
      role: agent.type,
      source: 'ruflo',
      state: isBlocked ? 'blocked' : (runState ?? RUFLO_STATES[agent.status] ?? 'idle'),
      word: isBlocked ? 'blocked' : run !== undefined ? runWord(run) : agent.status,
      isLeader: queen === undefined && coordinator?.id === agent.id,
      claims: held.length,
      calls: 0,
    })
  }

  const loops = [...activity.loops.values()].sort((a, b) => (a.id === LEAD ? -1 : b.id === LEAD ? 1 : 0))

  for (const loop of loops) {
    const pulse = loop.pulse !== undefined && nowMs - loop.pulse.atMs < PULSE_MS ? loop.pulse.kind : undefined
    const isLead = loop.id === LEAD
    const isQuiet = nowMs - loop.lastAtMs > 30_000
    const base = isLead ? (activity.isWorking ? 'working' : 'idle') : (LOOP_STATES[loop.status] ?? 'idle')

    members.push({
      id: loop.id,
      // A loop known only from its tool calls (no spawn or listing reached the hooks) is said to be one, not given a role.
      label: isLead ? 'claude (main)' : (loop.name ?? (loop.role === 'agent' ? `subagent …${loop.id.slice(-4)}` : loop.role)),
      role: loop.role,
      source: isLead ? 'lead' : 'claude',
      state: base === 'working' && isQuiet && !isLead ? 'idle' : base,
      word: isLead ? (activity.isWorking ? 'turn running' : 'waiting') : loop.status,
      ...(pulse !== undefined && { pulse }),
      isLeader: isLead && queen === undefined && coordinator === undefined,
      claims: 0,
      calls: loop.calls,
    })
  }

  return members
}

/** True while some tile is still lit: the frame timer keeps drawing until every pulse has faded. */
export const isAnimating = (activity: Activity, nowMs: number): boolean =>
  [...activity.loops.values()].some(loop => loop.pulse !== undefined && nowMs - loop.pulse.atMs < PULSE_MS)
