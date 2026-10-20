/**
 * The facts that are not on disk, asked of the ruflo CLI with fixed argv and read from its JSON. Every probe here was run
 * against @claude-flow/cli 3.50.0 and is local: none reaches the network except `roster` and `registry`, which run only
 * when the person turns `federationNetwork` on. `plugins list` is never run (it fetches the IPFS registry), nor `verify` (it
 * fetches a manifest from GitHub).
 */
import { closeOf } from './json-span'
import { failureReason } from './failure'
import { idOf, msOf, numberOf, plain, recordOf, stringOf, valuesOf } from './parse'
import { countOf, measureOf, own, ratioOf } from './safe'
import { researchProbe } from './research'
import { CLI_PREFIXES, type CliChoice, type State, type ViewId } from '../state'

export type { ViewId }

export type Probe<T> = {
  id: string
  args: readonly string[]
  /** A local executable for a capability check, or an offline-only ruflo read. */
  argv?: readonly string[]
  /** An argv that depends on what is installed; null while it cannot be built, and the probe then does not run. */
  argvOf?: (state: State) => readonly string[] | null
  isOffline?: boolean
  /** The views that draw it: a probe runs only while one of them is in front (the overview's run with the bar too). */
  views: readonly ViewId[]
  everyMs: number
  timeoutMs: number
  isNetwork?: boolean
  parse: (stdout: string) => T | null
}

/** The JSON a CLI run printed: after `Result:` for `mcp exec`, else from the first line that opens an object or array. */
export function jsonAfter(stdout: string): unknown {
  const text = stdout.length > 1_000_000 ? stdout.slice(0, 1_000_000) : stdout
  const marker = text.indexOf('Result:')
  const from = marker >= 0 ? marker + 7 : 0
  const line = /^[ \t]*[[{]/m.exec(text.slice(from))
  const start = line === null ? -1 : from + line.index

  if (start < 0) {
    return null
  }

  const end = closeOf(text, start)

  if (end < 0) {
    return null
  }

  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const objectOf = (stdout: string) => recordOf(jsonAfter(stdout))
const exec = (tool: string, params: Record<string, unknown>) => ['mcp', 'exec', '-t', tool, '-p', JSON.stringify(params)] as const

/** Offline probes never let the download-enabled CLI choice reach the registry. */
export const probeArgv = (probe: Pick<Probe<unknown>, 'args' | 'argv' | 'argvOf' | 'isOffline'>, cli: CliChoice, state?: State): readonly string[] => (state === undefined ? undefined : probe.argvOf?.(state)) ?? probe.argv ?? [...CLI_PREFIXES[probe.isOffline && cli === 'npx' ? 'npx-offline' : cli], ...probe.args]

/** A probe with an install-dependent argv runs only while that argv can be built; every other probe is always ready. */
export const probeReady = (probe: Pick<Probe<unknown>, 'argvOf'>, state: State): boolean => probe.argvOf === undefined || probe.argvOf(state) !== null

/** Help only: older Claude builds must not get a guessed configuration command. */
export const budgetConfigProbe: Probe<boolean> = {
  id: 'budget-config', args: [], argv: ['claude', 'plugin', 'configure', '--help'], views: ['cost'], everyMs: 600_000, timeoutMs: 10_000,
  parse: stdout => /Usage: claude plugin configure/.test(stdout) && /--values-stdin/.test(stdout),
}

export type ModelStats = { isAvailable: boolean; total?: number; models: { name: string; count: number }[] }

/** Persisted router decisions, not billing: the CLI records neither model dollars nor tokens here. */
export const modelStatsProbe: Probe<ModelStats> = {
  id: 'model-stats', args: ['hooks', 'model-stats', '--format', 'json'], views: ['cost'], everyMs: 30_000, timeoutMs: 30_000, isOffline: true,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null || typeof value.available !== 'boolean') return null

    const countOf = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined
    const total = countOf(value.totalDecisions)
    const models = Object.entries(recordOf(value.modelDistribution) ?? {}).slice(0, 12).flatMap(([name, n]) => {
      const count = countOf(n)

      return count === undefined ? [] : [{ name: plain(name, 40), count }]
    })

    return { isAvailable: value.available, ...(total !== undefined && { total }), models }
  },
}

export const versionProbe: Probe<string> = {
  id: 'version',
  args: ['--version'],
  views: ['overview'],
  everyMs: 600_000,
  timeoutMs: 30_000,
  parse: stdout => /v?(\d+\.\d+\.\d+[\w.-]*)/.exec(stdout)?.[1] ?? null,
}

/** `unread`: rows in the second store (.swarm/agentdb-memory.db, the MCP path's) that the CLI's counts leave out. */
export type MemoryStats = { backend: string; total?: number; vectors?: number; storage?: string; oldestMs?: number; newestMs?: number; unread?: number }

export const memoryProbe: Probe<MemoryStats> = {
  id: 'memory',
  args: ['memory', 'stats', '--format', 'json'],
  views: ['overview', 'memory'],
  everyMs: 30_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const entries = recordOf(value.entries)
    const stats: MemoryStats = { backend: stringOf(value.backend, 60) ?? 'unknown' }
    const total = countOf(entries?.total)
    const vectors = countOf(entries?.vectors)
    const storage = stringOf(recordOf(value.storage)?.total, 30)
    const oldestMs = msOf(value.oldestEntry)
    const newestMs = msOf(value.newestEntry)
    const unread = countOf(recordOf(value.unreadStore)?.rows)

    if (total !== undefined) stats.total = total
    if (unread !== undefined) stats.unread = unread
    if (vectors !== undefined) stats.vectors = vectors
    if (storage !== undefined) stats.storage = storage
    if (oldestMs !== undefined) stats.oldestMs = oldestMs
    if (newestMs !== undefined) stats.newestMs = newestMs

    return stats
  },
}

/** One listed entry, as `memory list --format json` answers it: what the Memory Lab browses and opens. */
export type MemoryEntry = { key: string; namespace: string; size?: number; atMs?: number; hasVector: boolean }

export type Namespaces = { sampled: number; byName: { name: string; count: number }[]; entries?: MemoryEntry[] }

/** Namespaces of the newest 500 entries: a sample, and the view says so. */
export const namespacesProbe: Probe<Namespaces> = {
  id: 'namespaces',
  args: ['memory', 'list', '--format', 'json', '--limit', '500'],
  views: ['memory'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = jsonAfter(stdout)

    if (!Array.isArray(value)) {
      return null
    }

    const counts = new Map<string, number>()
    const entries: MemoryEntry[] = []

    for (const entry of value.slice(0, 500)) {
      const record = recordOf(entry)
      const name = stringOf(record?.namespace, 40) ?? '(none)'
      const key = stringOf(record?.key, 128)
      const size = countOf(record?.size)
      const atMs = msOf(record?.updatedAt ?? record?.createdAt)

      counts.set(name, (counts.get(name) ?? 0) + 1)
      if (key !== undefined) entries.push({ key, namespace: name, hasVector: record?.hasEmbedding === true, ...(size !== undefined && { size }), ...(atMs !== undefined && { atMs }) })
    }

    entries.sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0))

    return { sampled: Math.min(500, value.length), byName: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 12), entries }
  },
}

export type HarnessScore = { dims: { name: string; value: number }[]; costUsd?: number; archetype?: string; scaffoldReady?: boolean; constraints?: string; atMs?: number }

const DIMS = ['harnessFit', 'compileConfidence', 'taskCoverage', 'toolSafety', 'memoryUsefulness'] as const

export const scoreProbe: Probe<HarnessScore> = {
  id: 'metaharness',
  args: ['metaharness', 'score', '--format', 'json'],
  views: ['metaharness'],
  everyMs: 120_000,
  timeoutMs: 60_000,
  parse: stdout => {
    const value = objectOf(stdout)
    const dims = DIMS.flatMap(name => {
      const score = numberOf(value?.[name])

      return score === undefined ? [] : [{ name, value: Math.max(0, Math.min(100, score)) }]
    })

    if (value === null || dims.length === 0) {
      return null
    }

    const score: HarnessScore = { dims }
    const costUsd = measureOf(value.estCostPerRunUsd)
    const archetype = stringOf(value.archetype, 40)
    const constraints = stringOf(value.hardConstraints, 10)
    const atMs = msOf(value.generatedAt)

    if (costUsd !== undefined) score.costUsd = costUsd
    if (archetype !== undefined) score.archetype = archetype
    if (typeof value.scaffoldReady === 'boolean') score.scaffoldReady = value.scaffoldReady
    if (constraints !== undefined) score.constraints = constraints
    if (atMs !== undefined) score.atMs = atMs

    return score
  },
}

export type Flywheel = { isLedgerValid: boolean; commits: number; receipts: number; champion?: string; epoch?: number; errors: string[] }

export const flywheelProbe: Probe<Flywheel> = {
  id: 'flywheel',
  args: exec('metaharness_flywheel', { op: 'receipts' }),
  views: ['metaharness'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const data = recordOf(objectOf(stdout)?.data)
    const state = recordOf(data?.state)
    const ledger = recordOf(data?.ledger)

    if (data === null || ledger === null) {
      return null
    }

    const flywheel: Flywheel = {
      isLedgerValid: ledger.valid === true,
      commits: countOf(ledger.commits) ?? 0,
      receipts: Object.keys(recordOf(state?.receiptStates) ?? {}).length,
      errors: (Array.isArray(ledger.errors) ? ledger.errors : []).slice(0, 3).map(error => plain(error, 100)),
    }
    const champion = stringOf(state?.activeChampionRef, 80)
    const epoch = countOf(state?.servingEpoch)

    if (champion !== undefined) flywheel.champion = champion
    if (epoch !== undefined) flywheel.epoch = epoch

    return flywheel
  },
}

export type AuditTrend = { total: number; points: { atMs: number; worst?: string; findings?: number; key?: string }[] }

const SEVERITY: Record<string, number> = { clean: 0, low: 1, medium: 2, high: 3, critical: 4 }

/**
 * Stored MetaHarness audits, oldest first: the trend line's points, each with its memory key (the lab diffs the newest
 * two). audit-list answers `{key, startedAt, finishedAt, worst}` per record. Reads memory; runs nothing.
 */
export const auditProbe: Probe<AuditTrend> = {
  id: 'audits',
  args: ['metaharness', 'audit-list', '--format', 'json'],
  views: ['metaharness'],
  everyMs: 120_000,
  timeoutMs: 60_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null || !Array.isArray(value.records)) {
      return null
    }

    const points = value.records.slice(0, 50).flatMap(entry => {
      const record = recordOf(entry)
      const atMs = msOf(record?.finishedAt ?? record?.startedAt ?? record?.timestamp ?? record?.generatedAt ?? record?.createdAt ?? recordOf(record?.value)?.generatedAt)
      const worst = stringOf(record?.worst ?? recordOf(record?.value)?.worst, 12)
      const findings = countOf(record?.findings ?? recordOf(record?.value)?.findingCount)
      const key = idOf(record?.key) ?? undefined

      return atMs === undefined ? [] : [{ atMs, ...(worst !== undefined && { worst }), ...(findings !== undefined && { findings }), ...(key !== undefined && { key }) }]
    })

    points.sort((a, b) => a.atMs - b.atMs)

    return { total: countOf(value.totalInNamespace) ?? points.length, points }
  },
}

/** A severity word as a 0-4 level, for the trend line; unknown words are null. */
export const severityOf = (word: string | undefined): number | null => (word === undefined ? null : (own(SEVERITY, word.toLowerCase()) ?? null))

export type Intelligence = { trajectories?: number; patterns?: number; successRate?: number; moeDecisions?: number; ewcConsolidations?: number; routerDecisions?: number; routerConfidence?: number; neuralRouter?: string }

export const intelligenceProbe: Probe<Intelligence> = {
  id: 'intelligence',
  args: exec('hooks_intelligence_stats', {}),
  views: ['learning'],
  everyMs: 30_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const sona = recordOf(value.sona)
    const router = recordOf(value.modelRouter)
    const neural = recordOf(value.neuralRouter)
    const routerDecisions = countOf(router?.totalDecisions)
    const out: Intelligence = {}
    const trajectories = countOf(sona?.trajectoriesTotal)
    const patterns = countOf(sona?.patternsLearned)
    const successRate = ratioOf(sona?.successRate)
    const moeDecisions = countOf(recordOf(value.moe)?.routingDecisions)
    const ewc = countOf(recordOf(value.ewc)?.consolidations)

    if (trajectories !== undefined) out.trajectories = trajectories
    if (patterns !== undefined) out.patterns = patterns
    if (successRate !== undefined && (trajectories ?? 0) > 0) out.successRate = successRate
    if (moeDecisions !== undefined) out.moeDecisions = moeDecisions
    if (ewc !== undefined) out.ewcConsolidations = ewc
    if (routerDecisions !== undefined) out.routerDecisions = routerDecisions
    // The tool answers a default confidence before the first decision: only a measured one is kept.
    if (routerDecisions !== undefined && routerDecisions > 0 && ratioOf(router?.avgConfidence) !== undefined) out.routerConfidence = ratioOf(router?.avgConfidence) as number
    if (neural !== null) out.neuralRouter = neural.enabled === true ? 'on' : `off (${plain(neural.reason, 40) || 'not enabled'})`

    return out
  },
}

export type Peers = { peers: { id: string; lastSyncMs?: number }[]; degraded?: string }

export const peersProbe: Probe<Peers> = {
  id: 'peers',
  args: exec('federation_bbs_peers', {}),
  views: ['federation'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const list = Array.isArray(value.peers) ? value.peers : valuesOf(value.peers)
    const peers = list.slice(0, 50).flatMap(entry => {
      const peer = recordOf(entry)
      const id = stringOf(peer?.nodeId ?? peer?.id ?? peer?.name, 40)
      const lastSyncMs = msOf(peer?.lastSyncAt ?? peer?.lastSync)

      return id === undefined ? [] : [{ id, ...(lastSyncMs !== undefined && { lastSyncMs }) }]
    })

    return value.degraded === true ? { peers, degraded: stringOf(value.reason, 60) ?? 'degraded' } : { peers }
  },
}

export type Channels = { channels: { id: string; name?: string; atMs?: number }[] }

/** The channel list answers ids, names and dates; the keys stay in ~/.ruflo/channels.json, which the console never reads. */
export const channelsProbe: Probe<Channels> = {
  id: 'channels',
  args: exec('x_federation_channel_list', {}),
  views: ['federation', 'xruv'],
  everyMs: 60_000,
  timeoutMs: 30_000,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null || !Array.isArray(value.channels)) {
      return null
    }

    return {
      channels: value.channels.slice(0, 50).flatMap(entry => {
        const channel = recordOf(entry)
        const id = stringOf(channel?.channel, 24)
        const name = stringOf(channel?.name, 40)
        const atMs = msOf(channel?.at)

        return id === undefined ? [] : [{ id, ...(name !== undefined && { name }), ...(atMs !== undefined && { atMs }) }]
      }),
    }
  },
}

export type Roster = { members: { name: string; detail?: string }[]; relay?: string; atMs?: number }

/** Reaches wss://relay.ruv.io: runs only with `federationNetwork` on. What it returns is third parties' text. */
export const rosterProbe: Probe<Roster> = {
  id: 'roster',
  args: exec('x_federation_roster', {}),
  views: ['federation', 'xruv'],
  everyMs: 120_000,
  timeoutMs: 45_000,
  isNetwork: true,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const data = value.data
    const rows = Array.isArray(data) ? data : Object.entries(recordOf(data) ?? {}).map(([name, detail]) => ({ name, detail }))
    const relay = stringOf(value.relay, 60)
    const atMs = msOf(value.retrievedAt)

    return {
      members: rows.slice(0, 40).flatMap(entry => {
        const row = recordOf(entry)
        const name = stringOf(row?.name ?? row?.pubkey ?? row?.id, 32)
        const detail = typeof row?.detail === 'string' ? plain(row.detail, 60) : stringOf(recordOf(row?.detail)?.about, 60)

        return name === undefined ? [] : [{ name, ...(detail !== undefined && detail !== '' && { detail }) }]
      }),
      ...(relay !== undefined && { relay }),
      ...(atMs !== undefined && { atMs }),
    }
  },
}

export type Registry = {
  relay?: string
  httpBase?: string
  gatewayPubkey?: string
  swarmTag?: string
  registration?: { isOpen: boolean; endpoint?: string; auth?: string; limits?: string }
  join: string[]
  channels: { name: string; purpose?: string }[]
}

/**
 * The federation's own description of itself (ruv://federation/registry, from the x.ruv.io gateway): reaches the
 * network, so it runs only with `federationNetwork` on. Every string is the gateway's, capped and stripped of control
 * characters, and drawn as data.
 */
export const registryProbe: Probe<Registry> = {
  id: 'registry',
  args: exec('x_federation_registry', {}),
  views: ['xruv'],
  everyMs: 600_000,
  timeoutMs: 45_000,
  isNetwork: true,
  parse: stdout => {
    const value = objectOf(stdout)

    if (value === null) {
      return null
    }

    const reg = recordOf(value.registration)
    const limits = recordOf(reg?.limits)
    const limitText = limits === null ? undefined : Object.entries(limits).slice(0, 4).flatMap(([key, n]) => (measureOf(n) === undefined ? [] : [`${plain(key, 16)} ${measureOf(n)}`])).join(' · ')
    const out: Registry = {
      join: (Array.isArray(value.join) ? value.join : []).slice(0, 6).flatMap(step => (typeof step === 'string' ? [plain(step, 200)] : [])),
      channels: (Array.isArray(value.defaultChannels) ? value.defaultChannels : []).slice(0, 8).flatMap(entry => {
        const channel = recordOf(entry)
        const name = stringOf(channel?.channel, 32)
        const purpose = stringOf(channel?.purpose, 120)

        return name === undefined ? [] : [{ name, ...(purpose !== undefined && { purpose }) }]
      }),
    }
    const relay = stringOf(value.relay, 60)
    const httpBase = stringOf(value.httpBase, 60)
    const gatewayPubkey = stringOf(value.gatewayPubkey, 64)
    const swarmTag = stringOf(value.swarmTag, 32)

    if (relay !== undefined) out.relay = relay
    if (httpBase !== undefined) out.httpBase = httpBase
    if (gatewayPubkey !== undefined) out.gatewayPubkey = gatewayPubkey
    if (swarmTag !== undefined) out.swarmTag = swarmTag
    if (reg !== null) {
      const endpoint = stringOf(reg.endpoint, 80)
      const auth = stringOf(reg.authentication, 20)

      out.registration = { isOpen: reg.enabled === true, ...(endpoint !== undefined && { endpoint }), ...(auth !== undefined && { auth }), ...(limitText !== undefined && limitText !== '' && { limits: limitText }) }
    }

    return out
  },
}

export const PROBES = [versionProbe, memoryProbe, namespacesProbe, scoreProbe, flywheelProbe, auditProbe, intelligenceProbe, peersProbe, channelsProbe, rosterProbe, registryProbe, budgetConfigProbe, modelStatsProbe, researchProbe] as const

export type ProbeId = (typeof PROBES)[number]['id']

/** What a probe came to: the last good value and when, and the last error, so a failing source is never drawn as live. */
export type ProbeResult<T = unknown> = { value: T | null; okAtMs: number | null; error: string | null; errorAtMs: number | null; isRunning: boolean }

/** An empty offline npm cache needs one explicit install; probes never download it themselves. An absent optional package answers exit 0 with `{degraded: true, reason}` (ADR-150): say so. A failure names its picked reason (failureReason), not the first stderr line, which is usually the CLI's `[WARN] Skipped helper auto-refresh`. */
export function probeError(argv: readonly string[], result: { exitCode: number; stdout: string; stderr: string }): string {
  if (result.exitCode === 0) return objectOf(result.stdout)?.degraded === true ? `unavailable: ${plain(objectOf(result.stdout)?.reason, 60) || 'degraded'}` : 'no JSON in the CLI output'
  if (argv[0] === 'npx' && argv.includes('--offline') && argv.includes('@claude-flow/cli@latest') && /\bENOTCACHED\b/.test(`${result.stderr}\n${result.stdout}`)) {
    return 'ruflo CLI not cached; run: npx -y @claude-flow/cli@latest --version'
  }
  return `exit ${result.exitCode}: ${failureReason(result, 100) || 'no message'}`
}

export const emptyResult = (): ProbeResult => ({ value: null, okAtMs: null, error: null, errorAtMs: null, isRunning: false })
