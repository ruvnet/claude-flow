/**
 * One snapshot of everything the console draws from disk: the files read (./files), parsed (./parse, ./facts), plus the
 * ruflo marketplace clone's manifest. A fact a file does not hold is null and its read's reason says why; the views
 * draw that as n/a, missing or too large, never as zero.
 */
import { readAnatole, type AnatoleFacts } from './anatole'
import { readRecall, type RecallFacts } from './recall'
import {
  enabledOf,
  parseActivity,
  parseDaemon,
  parseHarnessPolicy,
  parseHelpers,
  parseInstalled,
  parseMarketplaceManifest,
  parseMarketplaces,
  parseNeural,
  parseOutcomes,
  parseRouter,
  parseSona,
  type Daemon,
  type Installed,
  type Marketplace,
  type NeuralStats,
  type Outcomes,
  type RouterState,
} from './facts'
import { parseMissions, type MissionObservation } from './missions'
import { readBounded, readDisk, textOf, type ProjectKey, type Read, type ReadCache, type ReaderFs } from './files'
import { parseAgentdbMod, type AgentdbMod } from './agentdb-mod'
import { readMods, type ModsFacts } from './mods'
import {
  parseAgents,
  parseClaims,
  parseHive,
  parseHiveAgents,
  parseSwarmPointer,
  parseSwarmStore,
  parseTasks,
  type AgentRecord,
  type ClaimRecord,
  type HiveAgentRecord,
  type HiveInfo,
  type SwarmInfo,
  type TaskRecord,
} from './parse'

/** The marketplace this repository publishes, and the plugins a current clone of it must list. */
export const RUFLO_MARKET = 'ruflo'
export const EXPECTED_IN_MARKET = ['ruflo-core', 'ruflo-mods', 'ruflo-swarm'] as const

export type PluginsFacts = {
  installed: Installed[] | null
  enabled: Set<string>
  /** Whether the merged settings held an `enabledPlugins` record at all: without one, "not enabled" is not known (ADR-485). */
  enabledKnown?: boolean
  markets: Marketplace[] | null
  /** The ruflo clone's plugin names, or null when the clone or its manifest is not readable. */
  rufloOffered: string[] | null
  /** Expected plugins the clone does not list: non-empty means the clone is stale. */
  missingFromClone: string[]
}

export type Snapshot = {
  reads: Record<ProjectKey, ReadStatus>
  swarm: SwarmInfo | null
  agents: AgentRecord[]
  tasks: TaskRecord[]
  claims: ClaimRecord[]
  hive: HiveInfo | null
  /** Workers `hive-mind spawn` wrote to .claude-flow/agents.json, apart from the agent store. */
  hiveAgents: HiveAgentRecord[]
  activity: ReturnType<typeof parseActivity>
  daemon: Daemon | null
  neural: NeuralStats | null
  router: RouterState | null
  outcomes: Outcomes | null
  sona: { patterns: number } | null
  harnessPolicy: ReturnType<typeof parseHarnessPolicy>
  helpers: ReturnType<typeof parseHelpers>
  helpersVersion: string | null
  isRufloProject: boolean
  federationNodes: string[] | null
  hasNostrKey: boolean | null
  plugins: PluginsFacts
  missions: MissionObservation | null
  /** The ruflo-agentdb mod's own status file (ADR-445); null while the mod has not written one. */
  agentdbMod: AgentdbMod | null
  /** Project Anatole's reported files (ADR-453): unauthenticated, bounded, shape-checked. */
  anatole?: AnatoleFacts
  /** What the intelligence hook recalls from and what the neural verbs act on (ADR-456): bounded reads, never a prompt the hook did not keep. */
  recall?: RecallFacts
  /** Every `.claude-flow/<short>-mod/status.json` the per-plugin mods wrote (ADR-446), bounded and shape-checked. */
  mods: ModsFacts
  changed: number
  readAtMs: number
}

export type ReadStatus = 'ok' | 'missing' | 'too-large' | 'refused' | 'not-regular'

const statusOf = (read: Read): ReadStatus => (read.text !== null ? 'ok' : read.reason)

/** Reads and parses everything; never rejects. `settings` is the merged settings, for `enabledPlugins`. */
export async function readSnapshot(fs: ReaderFs, cache: ReadCache, cwd: string, home: string | null, settings: unknown, nowMs: number, configDir?: string | null, federationNetwork = false): Promise<Snapshot> {
  const disk = await readDisk(fs, cache, cwd, home, configDir === undefined ? (home === null ? null : `${home}/.claude`) : configDir, federationNetwork)
  const text = (key: ProjectKey) => textOf(disk.project[key])
  const stored = parseSwarmStore(text('swarm'))
  const pointer = parseSwarmPointer(text('pointer'))
  const swarm: SwarmInfo | null =
    stored ?? (pointer !== null ? { id: pointer.id, topology: pointer.topology ?? 'unknown', status: pointer.status ?? 'unknown', agentIds: [], ...(pointer.strategy !== undefined && { strategy: pointer.strategy }) } : null)
  const markets = parseMarketplaces(textOf(disk.home.marketplaces))
  const location = markets?.find(market => market.name === RUFLO_MARKET)?.location
  const offered = location === undefined ? null : parseMarketplaceManifest(textOf(await readBounded(fs, cache, `${location}/.claude-plugin/marketplace.json`)))
  const reads = Object.fromEntries((Object.keys(disk.project) as ProjectKey[]).map(key => [key, statusOf(disk.project[key])])) as Snapshot['reads']

  return {
    reads,
    swarm,
    agents: parseAgents(text('agents')),
    tasks: parseTasks(text('tasks')),
    claims: parseClaims(text('claims')),
    hive: parseHive(text('hive')),
    hiveAgents: parseHiveAgents(text('hiveAgents')),
    activity: parseActivity(text('activity')),
    daemon: parseDaemon(text('daemon')),
    neural: parseNeural(text('neural')),
    router: parseRouter(text('router')),
    outcomes: parseOutcomes(text('outcomes')),
    sona: parseSona(text('sona')),
    harnessPolicy: parseHarnessPolicy(text('harnessPolicy')),
    helpers: parseHelpers(text('helpersManifest')),
    helpersVersion: text('helpersVersion')?.trim().slice(0, 20) ?? null,
    isRufloProject: text('config') !== null || swarm !== null || text('claims') !== null || text('daemon') !== null,
    federationNodes: disk.federationNodes,
    hasNostrKey: disk.hasNostrKey,
    plugins: {
      installed: parseInstalled(textOf(disk.home.installed)),
      enabled: enabledOf(settings),
      enabledKnown: typeof (settings as { enabledPlugins?: unknown } | null)?.enabledPlugins === 'object' && (settings as { enabledPlugins?: unknown }).enabledPlugins !== null,
      markets,
      rufloOffered: offered,
      missingFromClone: offered === null ? [] : EXPECTED_IN_MARKET.filter(name => !offered.includes(name)),
    },
    missions: parseMissions(text('missions')),
    agentdbMod: parseAgentdbMod(text('agentdbMod')),
    mods: await readMods(fs, cache, cwd),
    anatole: await readAnatole(fs, cache, cwd),
    recall: await readRecall(fs, cache, cwd),
    changed: disk.changed,
    readAtMs: nowMs,
  }
}
