/**
 * The files the console reads, and one bounded, cached reader for them. Paths in PROJECT are relative to the session's
 * working directory; paths in HOME to Claude Code's config directory (`$CLAUDE_CONFIG_DIR`, else `~/.claude`). Every read may be refused, a refusal is a missing
 * fact, and a file over READ_MAX bytes is never read (`.claude-flow/policy/state.json` reaches 40 MB in a busy project).
 *
 * Never listed here, never read: `.claude-flow/federation/key-*.json`, `~/.ruflo/nostr.key` and `~/.ruflo/channels.json`
 * hold private keys. The console names the first by listing the folder and stats the second only with federation enabled.
 */

/** The `$.fs` calls a reader makes; each may reject. */
export type ReaderFs = {
  read: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ mtimeMs?: number; size?: number; kind?: string; isLink?: boolean } | undefined>
  list: (path: string) => Promise<readonly { name: string; kind?: string; size?: number; mtimeMs?: number }[]>
}

/** Larger files are not read: the engine refuses past 4 MiB, and parsing one this size on a timer stalls a hook. */
export const READ_MAX = 2_000_000

export const PROJECT = {
  swarm: '.claude-flow/swarm/swarm-state.json',
  pointer: '.swarm/state.json',
  agents: '.claude-flow/agents/store.json',
  hiveAgents: '.claude-flow/agents.json',
  tasks: '.claude-flow/tasks/store.json',
  claims: '.claude-flow/claims/claims.json',
  hive: '.claude-flow/hive-mind/state.json',
  activity: '.claude-flow/metrics/swarm-activity.json',
  daemon: '.claude-flow/daemon-state.json',
  neural: '.claude-flow/neural/stats.json',
  router: '.swarm/model-router-state.json',
  outcomes: '.claude-flow/routing-outcomes.json',
  sona: '.swarm/sona-patterns.json',
  harnessPolicy: '.claude-flow/harness-active-policy.json',
  helpersManifest: '.claude/helpers/helpers.manifest.json',
  helpersVersion: '.claude/helpers/.helpers-version',
  config: '.claude-flow/config.yaml',
  missions: '.claude-flow/missions/observation.json',
  agentdbMod: '.claude-flow/agentdb-mod/status.json',
} as const

export type ProjectKey = keyof typeof PROJECT

export const HOME = {
  installed: 'plugins/installed_plugins.json',
  marketplaces: 'plugins/known_marketplaces.json',
} as const

/** Folders listed by name only: the federation keys' node ids, never their content. */
export const FEDERATION_DIR = '.claude-flow/federation'
export const NOSTR_KEY = '.ruflo/nostr.key'

/** What one read came to: the text, or why there is none. */
export type Read = { text: string; mtimeMs: number } | { text: null; reason: 'missing' | 'too-large' | 'refused' | 'not-regular'; size?: number }

/** The text of each file as last read, by path, with the mtime and size it was read at. */
export type ReadCache = Map<string, { mtimeMs: number; size: number; text: string } | { missingUntilMs: number }>

/** A path found missing is not stat-ed again for this long: a file ruflo creates shows up within it. */
export const MISSING_RECHECK_MS = 10_000

/**
 * Reads one file, unless its mtime and size match what was read last; stats first, so a huge file is never read. With `regularOnly`, a path the
 * engine's stat reports as a link (it follows links and reads their target, even outside the project) or as anything but a file is never read.
 */
export async function readBounded(fs: ReaderFs, cache: ReadCache, path: string, max = READ_MAX, regularOnly = false): Promise<Read> {
  let stat: Awaited<ReturnType<ReaderFs['stat']>>

  const before = cache.get(path)

  if (before !== undefined && 'missingUntilMs' in before && before.missingUntilMs > Date.now()) {
    return { text: null, reason: 'missing' }
  }

  try {
    stat = await fs.stat(path)
  } catch {
    cache.set(path, { missingUntilMs: Date.now() + MISSING_RECHECK_MS })

    return { text: null, reason: 'missing' }
  }

  if (regularOnly && (stat?.isLink === true || (stat?.kind !== undefined && stat.kind !== 'file'))) {
    cache.delete(path)

    return { text: null, reason: 'not-regular' }
  }

  const mtimeMs = stat?.mtimeMs ?? -1
  const size = stat?.size ?? -1

  if (size > max) {
    cache.delete(path)

    return { text: null, reason: 'too-large', size }
  }

  const held = before !== undefined && 'text' in before ? before : undefined

  if (held !== undefined && mtimeMs >= 0 && held.mtimeMs === mtimeMs && held.size === size) {
    return { text: held.text, mtimeMs }
  }

  try {
    const text = await fs.read(path)

    cache.set(path, { mtimeMs, size, text })

    return { text, mtimeMs }
  } catch {
    cache.delete(path)

    return { text: null, reason: 'refused' }
  }
}

/** Joins a root and a relative path with one slash. */
export const under = (root: string, path: string): string => `${root.replace(/\/+$/, '')}/${path}`

/** Every file the console reads, as text or the reason it has none, and how many changed since the last pass. */
export type DiskRead = { project: Record<ProjectKey, Read>; home: Record<keyof typeof HOME, Read>; changed: number; federationNodes: string[] | null; hasNostrKey: boolean | null }

/** Reads every file in parallel; nothing here rejects. `home` and `configDir` are null when unknown. */
export async function readDisk(fs: ReaderFs, cache: ReadCache, cwd: string, home: string | null, configDir: string | null = home === null ? null : `${home}/.claude`, federationNetwork = false): Promise<DiskRead> {
  const mtimeOf = (held: ReadCache extends Map<string, infer V> ? V : never) => ('mtimeMs' in held ? held.mtimeMs : -1)
  const before = new Map([...cache].map(([path, held]) => [path, mtimeOf(held)]))
  const projectKeys = Object.keys(PROJECT) as ProjectKey[]
  const homeKeys = Object.keys(HOME) as (keyof typeof HOME)[]
  const missingHome: Read = { text: null, reason: 'missing' }
  const [projectReads, homeReads, federationNodes, hasNostrKey] = await Promise.all([
    // ADR-450 T2: the one mod status file read here must be a regular file, like the per-plugin ones in readMods.
    Promise.all(projectKeys.map(key => readBounded(fs, cache, under(cwd, PROJECT[key]), READ_MAX, key === 'agentdbMod'))),
    Promise.all(homeKeys.map(key => (configDir === null ? Promise.resolve(missingHome) : readBounded(fs, cache, under(configDir, HOME[key]))))),
    fs
      .list(under(cwd, FEDERATION_DIR))
      .then(entries => entries.flatMap(entry => (/^key-[A-Za-z0-9._-]{1,64}\.json$/.test(entry.name) ? [entry.name.slice(4, -5)] : [])).slice(0, 50))
      .catch(() => null),
    home === null || !federationNetwork ? Promise.resolve(null) : fs.stat(under(home, NOSTR_KEY)).then(stat => stat !== undefined, () => false),
  ])
  const project = Object.fromEntries(projectKeys.map((key, i) => [key, projectReads[i] as Read])) as Record<ProjectKey, Read>
  const homeRecord = Object.fromEntries(homeKeys.map((key, i) => [key, homeReads[i] as Read])) as Record<keyof typeof HOME, Read>
  let changed = 0

  for (const [path, held] of cache) {
    if ('mtimeMs' in held && before.get(path) !== held.mtimeMs) {
      changed += 1
    }
  }

  return { project, home: homeRecord, changed: before.size === 0 ? 0 : changed, federationNodes, hasNostrKey }
}

/** The text of a read, or null. */
export const textOf = (read: Read | undefined): string | null => (read !== undefined && read.text !== null ? read.text : null)
