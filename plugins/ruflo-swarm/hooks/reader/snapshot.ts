import {
  parseAgents,
  parseClaims,
  parseHive,
  parseSwarmPointer,
  parseSwarmStore,
  parseTasks,
  type AgentRecord,
  type ClaimRecord,
  type HiveInfo,
  type SwarmInfo,
  type TaskRecord,
} from './parse'
import { EVENTS_MAX, parseEvents, parseHosts, RUOS_EVENTS, RUOS_HOSTS, type RunEvent, type RuosHost } from './ruos'

/** The file calls a reader makes, as `$.fs` answers them; every one may be refused. */
export type ReaderFs = {
  read: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ mtimeMs?: number; size?: number } | undefined>
}

/** Where ruflo keeps each fact, relative to the session's working directory. */
export const FILES = {
  swarm: '.claude-flow/swarm/swarm-state.json',
  pointer: '.swarm/state.json',
  agents: '.claude-flow/agents/store.json',
  tasks: '.claude-flow/tasks/store.json',
  claims: '.claude-flow/claims/claims.json',
  hive: '.claude-flow/hive-mind/state.json',
} as const

export type FileKey = keyof typeof FILES

export type Snapshot = {
  swarm: SwarmInfo | null
  agents: AgentRecord[]
  tasks: TaskRecord[]
  claims: ClaimRecord[]
  hive: HiveInfo | null
  /** ruOS desktops that host swarm agents (ruflo-ruos): null hosts when the snapshot file is absent. */
  ruos: { hosts: RuosHost[] | null; events: RunEvent[]; note?: string }
  /** The facts that are not on disk (no file, unreadable, or not in a shape ruflo writes), by key. */
  missing: FileKey[]
  /** True when any of ruflo's swarm files is there at all: the pane has something of its own to show. */
  hasSwarm: boolean
  readAtMs: number
}

/** The text of each file as last read, by path, with the mtime it was read at: an unchanged file is not read again. */
export type ReadCache = Map<string, { mtimeMs: number; size: number; text: string }>

async function textOf(fs: ReaderFs, cache: ReadCache, path: string): Promise<string | null> {
  try {
    const stat = await fs.stat(path)
    const mtimeMs = stat?.mtimeMs ?? -1
    const size = stat?.size ?? -1
    const held = cache.get(path)

    if (held !== undefined && mtimeMs >= 0 && held.mtimeMs === mtimeMs && held.size === size) {
      return held.text
    }

    const text = await fs.read(path)

    cache.set(path, { mtimeMs, size, text })

    return text
  } catch {
    cache.delete(path)

    return null
  }
}

/** Reads every swarm fact ruflo keeps on disk, in parallel; a refused or absent file is a missing fact, never an error. */
export async function readSnapshot(fs: ReaderFs, cache: ReadCache, nowMs: number): Promise<Snapshot> {
  const keys = Object.keys(FILES) as FileKey[]
  const texts = await Promise.all(keys.map(key => textOf(fs, cache, FILES[key])))
  const text = (key: FileKey) => texts[keys.indexOf(key)] ?? null

  const pointer = parseSwarmPointer(text('pointer'))
  const stored = parseSwarmStore(text('swarm'))
  // The pointer names the swarm `swarm init` made last; the store has its members. Either alone still names a swarm.
  const swarm: SwarmInfo | null =
    stored ??
    (pointer !== null
      ? { id: pointer.id, topology: pointer.topology ?? 'unknown', status: pointer.status ?? 'unknown', agentIds: [], ...(pointer.strategy !== undefined && { strategy: pointer.strategy }) }
      : null)

  const ruos = await readRuos(fs, cache)
  const parsed = {
    swarm,
    agents: parseAgents(text('agents')),
    tasks: parseTasks(text('tasks')),
    claims: parseClaims(text('claims')),
    hive: parseHive(text('hive')),
    ruos,
  }

  const missing = keys.filter(key => {
    switch (key) {
      case 'swarm':
        return stored === null
      case 'pointer':
        return pointer === null
      case 'hive':
        return parsed.hive === null
      default:
        return text(key) === null
    }
  })

  return {
    ...parsed,
    missing,
    hasSwarm: swarm !== null || parsed.agents.length > 0 || parsed.hive !== null,
    readAtMs: nowMs,
  }
}

/** The ruOS host snapshot and the tail of its event log. The log is read whole (there is no ranged read), so past a size it is not read. */
async function readRuos(fs: ReaderFs, cache: ReadCache): Promise<Snapshot['ruos']> {
  const hosts = parseHosts(await textOf(fs, cache, RUOS_HOSTS))
  let size = -1

  try {
    size = (await fs.stat(RUOS_EVENTS))?.size ?? -1
  } catch {
    return { hosts, events: [] }
  }

  if (size > EVENTS_MAX) {
    return { hosts, events: [], note: `ruOS event log is ${Math.round(size / 1_000_000)} MB: not read` }
  }

  return { hosts, events: parseEvents(await textOf(fs, cache, RUOS_EVENTS)) }
}
