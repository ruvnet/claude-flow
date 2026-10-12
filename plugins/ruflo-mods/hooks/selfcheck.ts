import type { ModState } from './state'

/**
 * Startup self-check: when a ruflo plugin the settings enable is not in the ruflo marketplace clone and has no cached install, Claude Code
 * skips it without a word (`/ruflo` or `/ruflo-mods` is then an unknown command). This says so once, in a toast, with the repair.
 *
 * Fail-open and read-only: every read is guarded, nothing is written, and the toast names only fixed plugin names and a fixed command, so
 * nothing from the repository or a settings file can reach the line. It never produces model-facing text.
 */
const SIBLINGS = ['ruflo-console', 'ruflo-swarm'] as const
const MARKETPLACE = 'ruflo'
const SOURCE = /^[A-Za-z0-9._/@-]{1,200}$/

/** What the check reads, as functions (the engine's `$` is followed only inside the file that spells it: session.ts hands these in). */
export type SelfCheckIo = {
  read: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  home: () => Promise<string | undefined>
  configDirEnv: () => Promise<string | undefined>
}

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

async function readJson(io: SelfCheckIo, path: string): Promise<unknown> {
  try {
    return JSON.parse(await io.read(path))
  } catch {
    return undefined
  }
}

/** The enabled ruflo plugins this check watches: the mod's siblings that settings turn on (`false` is a decision, not a fault). */
export function watched(enabledPlugins: unknown): string[] {
  if (!record(enabledPlugins)) return []

  return SIBLINGS.filter(name => enabledPlugins[`${name}@${MARKETPLACE}`] === true)
}

/** The one line the person sees. Fixed words only: the plugin names come from this file, never from a file read. */
export function selfCheckLine(missing: readonly string[]): string {
  return `ruflo marketplace clone is stale: ${missing.join(', ')} not loaded. Run: claude plugin marketplace update ${MARKETPLACE}`
}

async function missingFromClone(io: SelfCheckIo, configDir: string, names: readonly string[]): Promise<string[]> {
  const known = await readJson(io, `${configDir}/plugins/known_marketplaces.json`)
  const entry = record(known) ? known[MARKETPLACE] : undefined
  const declared = record(entry) && typeof entry.installLocation === 'string' && SOURCE.test(entry.installLocation) ? entry.installLocation : undefined
  const clone = declared ?? `${configDir}/plugins/marketplaces/${MARKETPLACE}`

  // No clone at all: Claude Code clones it at the next interactive start; nothing is "stale" yet.
  if (!(await io.exists(clone).catch(() => false))) return []

  const catalog = await readJson(io, `${clone}/.claude-plugin/marketplace.json`)
  const listed = record(catalog) && Array.isArray(catalog.plugins) ? catalog.plugins : []
  const installed = await readJson(io, `${configDir}/plugins/installed_plugins.json`)
  const plugins = record(installed) && record(installed.plugins) ? installed.plugins : {}
  const out: string[] = []

  for (const name of names) {
    const hit = listed.find((p): p is Record<string, unknown> => record(p) && p.name === name)
    const source = typeof hit?.source === 'string' && SOURCE.test(hit.source) && !hit.source.includes('..') ? hit.source : `./plugins/${name}`
    const inClone = await io.exists(`${clone}/${source}/.claude-plugin/plugin.json`).catch(() => false)
    const cached = (Array.isArray(plugins[`${name}@${MARKETPLACE}`]) ? (plugins[`${name}@${MARKETPLACE}`] as unknown[]) : []).some(
      e => record(e) && typeof e.installPath === 'string' && e.scope === 'user' && SOURCE.test(e.installPath),
    )
    const cachedHere = cached ? await Promise.all((plugins[`${name}@${MARKETPLACE}`] as Array<Record<string, unknown>>).filter(e => e.scope === 'user').map(e => io.exists(String(e.installPath)).catch(() => false))) : []

    if (!inClone && !cachedHere.some(Boolean)) out.push(name)
  }

  return out
}

export async function runSelfCheck(io: SelfCheckIo, state: ModState, enabledPlugins: unknown): Promise<void> {
  try {
    const names = watched(enabledPlugins)

    if (names.length === 0) return

    const home = await io.home().catch(() => undefined)
    const configDir = (await io.configDirEnv().catch(() => undefined)) ?? (home === undefined || home === '' ? undefined : `${home}/.claude`)

    if (configDir === undefined || !SOURCE.test(configDir)) return

    const missing = await missingFromClone(io, configDir, names)

    if (missing.length > 0) await state.say({ level: 'warn', text: selfCheckLine(missing), timeoutMs: 12_000, always: true })
  } catch {
    // a self-check never fails a session
  }
}
