/**
 * Readers for the non-swarm facts on disk: self-learning stores, the daemon's state, MetaHarness's active policy, the
 * helpers manifest, and Claude Code's own plugin records. Same rules as ./parse: any shape tolerated, nothing guessed,
 * every string cleaned. A value a file does not hold is absent, and the view says n/a.
 */
import { jsonObject, msOf, plain, recordOf, stringOf } from './parse'
import { countOf, ratioOf } from './safe'

export type NeuralStats = { trajectories?: number; patterns?: number; signals?: number; lastAdaptationMs?: number }

/** `.claude-flow/neural/stats.json`, written by the hooks' learning pass. */
export function parseNeural(text: string | null): NeuralStats | null {
  const value = jsonObject(text)

  if (value === null) {
    return null
  }

  const stats: NeuralStats = {}
  const trajectories = countOf(value.trajectoriesRecorded)
  const patterns = countOf(value.patternsLearned)
  const signals = countOf(value.signalsProcessed)
  const last = msOf(value.lastAdaptation)

  if (trajectories !== undefined) stats.trajectories = trajectories
  if (patterns !== undefined) stats.patterns = patterns
  if (signals !== undefined) stats.signals = signals
  if (last !== undefined) stats.lastAdaptationMs = last

  return stats
}

export type RouterState = { decisions?: number; distribution: { model: string; count: number }[]; avgConfidence?: number; updatedMs?: number; history: { ok: boolean; atMs: number }[] }

/** `.swarm/model-router-state.json`: the model tier router's tallies and its recent outcomes. */
export function parseRouter(text: string | null): RouterState | null {
  const value = jsonObject(text)

  if (value === null) {
    return null
  }

  const distribution = Object.entries(recordOf(value.modelDistribution) ?? {})
    .slice(0, 12)
    .flatMap(([model, count]) => (countOf(count) !== undefined ? [{ model: plain(model, 20), count: countOf(count) as number }] : []))
  const history = (Array.isArray(value.learningHistory) ? value.learningHistory : []).slice(-200).flatMap(entry => {
    const row = recordOf(entry)
    const atMs = msOf(row?.timestamp)

    return row === null || atMs === undefined || typeof row.outcome !== 'string' ? [] : [{ ok: row.outcome === 'success', atMs }]
  })
  const state: RouterState = { distribution, history }
  const decisions = countOf(value.totalDecisions)
  const confidence = ratioOf(value.avgConfidence)
  const updated = msOf(value.lastUpdated)

  if (decisions !== undefined) state.decisions = decisions
  if (confidence !== undefined) state.avgConfidence = confidence
  if (updated !== undefined) state.updatedMs = updated

  return state
}

export type Outcomes = { total: number; successes: number; points: { ok: boolean; quality?: number; agent: string; atMs: number }[] }

/** `.claude-flow/routing-outcomes.json`: what each routed task came to, oldest first. */
export function parseOutcomes(text: string | null): Outcomes | null {
  const value = jsonObject(text)

  if (value === null || !Array.isArray(value.outcomes)) {
    return null
  }

  const points = value.outcomes.slice(-500).flatMap(entry => {
    const row = recordOf(entry)
    const atMs = msOf(row?.timestamp)

    if (row === null || atMs === undefined || typeof row.success !== 'boolean') {
      return []
    }

    const quality = ratioOf(row.quality)

    return [{ ok: row.success, agent: stringOf(row.agent, 30) ?? '?', atMs, ...(quality !== undefined && { quality }) }]
  })

  points.sort((a, b) => a.atMs - b.atMs)

  return { total: points.length, successes: points.filter(point => point.ok).length, points }
}

/** `.swarm/sona-patterns.json`: how many routing patterns SONA keeps. */
export function parseSona(text: string | null): { patterns: number } | null {
  const value = jsonObject(text)

  return value === null ? null : { patterns: Object.keys(recordOf(value.patterns) ?? {}).length }
}

export type Daemon = { running: boolean; savedAtMs?: number; workers: { name: string; runs: number; failures: number; lastRunMs?: number }[] }

/** `.claude-flow/daemon-state.json`: what the daemon last wrote. `running` is its own word, as of `savedAtMs`. */
export function parseDaemon(text: string | null): Daemon | null {
  const value = jsonObject(text)

  if (value === null) {
    return null
  }

  const workers = Object.entries(recordOf(value.workers) ?? {})
    .slice(0, 24)
    .flatMap(([name, entry]) => {
      const worker = recordOf(entry)
      const lastRunMs = msOf(worker?.lastRun)

      return worker === null
        ? []
        : [{ name: plain(name, 20), runs: countOf(worker.runCount) ?? 0, failures: countOf(worker.failureCount) ?? 0, ...(lastRunMs !== undefined && { lastRunMs }) }]
    })
  const daemon: Daemon = { running: value.running === true, workers }
  const savedAtMs = msOf(value.savedAt) ?? msOf(value.startedAt)

  if (savedAtMs !== undefined) daemon.savedAtMs = savedAtMs

  return daemon
}

/** `.claude-flow/harness-active-policy.json`: the MetaHarness champion this project serves, by its own word. */
export function parseHarnessPolicy(text: string | null): { champion: string; tier?: string; layer?: string; appliedAtMs?: number } | null {
  const value = jsonObject(text)
  const champion = stringOf(value?.championId, 90)

  if (value === null || champion === undefined) {
    return null
  }

  const tier = stringOf(value.provenanceTier, 40)
  const layer = stringOf(value.layer, 40)
  const appliedAtMs = msOf(value.appliedAt)

  return { champion, ...(tier !== undefined && { tier }), ...(layer !== undefined && { layer }), ...(appliedAtMs !== undefined && { appliedAtMs }) }
}

/** `.claude/helpers/helpers.manifest.json`: the signed list of helper files. The console reads it; it does not verify the signature. */
export function parseHelpers(text: string | null): { version: string; files: string[]; algorithm?: string; isSigned: boolean } | null {
  const value = jsonObject(text)
  const manifest = recordOf(value?.manifest)

  if (value === null || manifest === null) {
    return null
  }

  const files = Object.keys(recordOf(manifest.files) ?? {})
    .filter(name => /^[A-Za-z0-9._-]{1,80}$/.test(name))
    .slice(0, 40)
  const algorithm = stringOf(value.algorithm, 20)

  return { version: stringOf(manifest.version, 20) ?? 'unknown', files, isSigned: typeof value.signature === 'string' && value.signature.length > 20, ...(algorithm !== undefined && { algorithm }) }
}

export type Installed = { id: string; name: string; marketplace: string; version: string; scope: string; updatedMs?: number; installPath?: string }

/** `~/.claude/plugins/installed_plugins.json` (version 2): every installed plugin, `name@marketplace`. */
export function parseInstalled(text: string | null): Installed[] | null {
  const value = jsonObject(text)
  const plugins = recordOf(value?.plugins)

  if (value === null || plugins === null) {
    return null
  }

  return Object.entries(plugins)
    .slice(0, 400)
    .flatMap(([id, entries]) => {
      const [name, marketplace] = id.split('@')
      const entry = recordOf(Array.isArray(entries) ? entries[0] : entries)

      if (entry === null || name === undefined || marketplace === undefined || !/^[A-Za-z0-9._-]{1,80}$/.test(name) || !/^[A-Za-z0-9._-]{1,80}$/.test(marketplace)) {
        return []
      }

      const updatedMs = msOf(entry.lastUpdated)
      const installPath = typeof entry.installPath === 'string' && entry.installPath.length <= 300 ? entry.installPath : undefined

      return [{ id: `${name}@${marketplace}`, name, marketplace, version: stringOf(entry.version, 30) ?? '?', scope: stringOf(entry.scope, 12) ?? '?', ...(updatedMs !== undefined && { updatedMs }), ...(installPath !== undefined && { installPath }) }]
    })
}

export type Marketplace = { name: string; location?: string; updatedMs?: number; isAutoUpdate: boolean }

/** `~/.claude/plugins/known_marketplaces.json`: each marketplace clone, where it is and when it was last pulled. */
export function parseMarketplaces(text: string | null): Marketplace[] | null {
  const value = jsonObject(text)

  if (value === null) {
    return null
  }

  return Object.entries(value)
    .slice(0, 50)
    .flatMap(([name, entry]) => {
      const market = recordOf(entry)
      const location = typeof market?.installLocation === 'string' ? market.installLocation : undefined
      const updatedMs = msOf(market?.lastUpdated)
      // Only an absolute path with no `..` is followed to the clone's manifest.
      const safeLocation = location !== undefined && location.startsWith('/') && !location.split('/').includes('..') && location.length < 400 ? location : undefined

      return market === null || !/^[A-Za-z0-9._-]{1,80}$/.test(name)
        ? []
        : [{ name, isAutoUpdate: market.autoUpdate === true, ...(safeLocation !== undefined && { location: safeLocation }), ...(updatedMs !== undefined && { updatedMs }) }]
    })
}

/** A marketplace clone's `.claude-plugin/marketplace.json`: the plugin names it offers. */
export function parseMarketplaceManifest(text: string | null): string[] | null {
  const value = jsonObject(text)

  if (value === null || !Array.isArray(value.plugins)) {
    return null
  }

  return value.plugins.slice(0, 400).flatMap(entry => {
    const name = recordOf(entry)?.name

    return typeof name === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(name) ? [name] : []
  })
}

/** The plugins `enabledPlugins` in the merged settings turns on, as `name@marketplace`. */
export function enabledOf(settings: unknown): Set<string> {
  const enabled = recordOf(recordOf(settings)?.enabledPlugins) ?? {}

  return new Set(Object.entries(enabled).flatMap(([id, on]) => (on === true && /^[A-Za-z0-9._-]{1,80}@[A-Za-z0-9._-]{1,80}$/.test(id) ? [id] : [])))
}

/** `.swarm/state.json` from `swarm start` names an objective and an agent plan; `.claude-flow/metrics/swarm-activity.json` a count. */
export function parseActivity(text: string | null): { agentCount?: number; isActive: boolean; atMs?: number } | null {
  const value = jsonObject(text)
  const swarm = recordOf(value?.swarm)

  if (value === null || swarm === null) {
    return null
  }

  const agentCount = countOf(swarm.agent_count)
  const atMs = msOf(value.timestamp)

  return { isActive: swarm.active === true, ...(agentCount !== undefined && { agentCount }), ...(atMs !== undefined && { atMs }) }
}
