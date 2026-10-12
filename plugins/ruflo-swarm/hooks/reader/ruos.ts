/**
 * The ruOS remote-host contract agreed with the ruflo-ruos plugin: swarm agents that run on ruOS cloud desktops.
 *   - `.claude-flow/agents/store.json`: `agents[id].config.host = { kind: 'ruos', desktopId, desktopName, transport, runId }`
 *   - `.claude-flow/ruos/hosts.json`: `{ updatedAt, hosts: [{ desktopId, name, state, heartbeatAt, agents: [agentId] }] }`
 *   - `.claude-flow/ruos/events.jsonl`: one lifecycle event per line, ids and sizes only
 * Every field is text another process wrote: ids must match ruflo's id shape, names are cleaned and bounded, and
 * free text (`error`, `lastResult`) is never read.
 */
import { idOf, jsonObject, MAX_RECORDS, plain } from './parse'

export const RUOS_HOSTS = '.claude-flow/ruos/hosts.json'
export const RUOS_EVENTS = '.claude-flow/ruos/events.jsonl'
/** Only the tail of the event log is parsed: the newest events say where each run stands. */
export const EVENTS_TAIL = 64 * 1024
/** An event log bigger than this is not read at all (there is no ranged read), and the pane says so. */
export const EVENTS_MAX = 2_000_000
const EVENT_LINES = 200
const MAX_HOSTS = 200

export type RemoteHost = { desktopId: string; desktopName: string; transport: 'fleet-mcp' | 'ssh' | 'unknown'; runId?: string }
export type RuosHost = { desktopId: string; name: string; state: string; heartbeatAt?: string; agents: string[] }
export type RunEventType = 'run.started' | 'run.output' | 'run.completed' | 'run.failed' | 'run.stopped' | 'desktop.state'
export type RunEvent = { ts: number; type: RunEventType; runId?: string; agentId?: string; desktopId?: string; exitCode?: number; bytes?: number }

const TYPES = new Set<string>(['run.started', 'run.output', 'run.completed', 'run.failed', 'run.stopped', 'desktop.state'])

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** An agent record's `config.host`, when it names a ruOS desktop in the agreed shape. */
export function remoteHostOf(config: unknown): RemoteHost | null {
  const host = recordOf(recordOf(config)?.host)
  const desktopId = idOf(host?.desktopId)

  if (host === null || host.kind !== 'ruos' || desktopId === null) {
    return null
  }

  const runId = idOf(host.runId)

  return {
    desktopId,
    desktopName: plain(host.desktopName, 40) || desktopId,
    transport: host.transport === 'fleet-mcp' || host.transport === 'ssh' ? host.transport : 'unknown',
    ...(runId !== null && { runId }),
  }
}

export function parseHosts(text: string | null): RuosHost[] | null {
  const value = jsonObject(text)

  if (value === null || !Array.isArray(value.hosts)) {
    return null
  }

  return value.hosts.slice(0, MAX_HOSTS).flatMap(entry => {
    const host = recordOf(entry)
    const desktopId = idOf(host?.desktopId)

    if (host === null || desktopId === null) {
      return []
    }

    const heartbeat = typeof host.heartbeatAt === 'string' && !Number.isNaN(Date.parse(host.heartbeatAt)) ? host.heartbeatAt.slice(0, 40) : undefined

    return [
      {
        desktopId,
        name: plain(host.name, 40) || desktopId,
        state: plain(host.state, 20) || 'unknown',
        ...(heartbeat !== undefined && { heartbeatAt: heartbeat }),
        agents: (Array.isArray(host.agents) ? host.agents : []).slice(0, MAX_RECORDS).flatMap(agent => (idOf(agent) !== null ? [agent as string] : [])),
      },
    ]
  })
}

const tsOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value
  }

  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN

  return Number.isNaN(parsed) ? null : parsed
}

const countOf = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) ? value : undefined)

/** The newest event of each run (or each desktop, for `desktop.state`), from the tail of the log. A torn first line is dropped. */
export function parseEvents(text: string | null): RunEvent[] {
  if (text === null) {
    return []
  }

  const tail = text.length > EVENTS_TAIL ? text.slice(text.length - EVENTS_TAIL) : text
  const lines = tail.split('\n')

  if (text.length > EVENTS_TAIL) {
    lines.shift()
  }

  const newest = new Map<string, RunEvent>()

  for (const line of lines.slice(-EVENT_LINES)) {
    const value = line.trim() === '' ? null : jsonObject(line)
    const ts = tsOf(value?.ts)
    const type = typeof value?.type === 'string' && TYPES.has(value.type) ? (value.type as RunEventType) : null

    if (value === null || ts === null || type === null) {
      continue
    }

    const runId = idOf(value.runId)
    const agentId = idOf(value.agentId)
    const desktopId = idOf(value.desktopId)
    const key = type === 'desktop.state' ? `desktop:${desktopId ?? ''}` : `run:${runId ?? agentId ?? ''}`
    const event: RunEvent = {
      ts,
      type,
      ...(runId !== null && { runId }),
      ...(agentId !== null && { agentId }),
      ...(desktopId !== null && { desktopId }),
      ...(countOf(value.exitCode) !== undefined && { exitCode: countOf(value.exitCode) }),
      ...(countOf(value.bytes) !== undefined && { bytes: countOf(value.bytes) }),
    }
    const held = newest.get(key)

    // `run.output` is progress, not a state: it never hides how a run ended.
    if (held === undefined || (held.ts <= ts && !(type === 'run.output' && held.type !== 'run.started' && held.type !== 'run.output'))) {
      newest.set(key, event)
    }
  }

  return [...newest.values()]
}

/** What a run's newest event says, as the word under a tile. */
export function runWord(event: RunEvent): string {
  switch (event.type) {
    case 'run.started':
    case 'run.output':
      return 'running'
    case 'run.completed':
      return 'completed'
    case 'run.failed':
      return event.exitCode !== undefined ? `failed (exit ${event.exitCode})` : 'failed'
    case 'run.stopped':
      return 'stopped'
    default:
      return 'desktop'
  }
}
