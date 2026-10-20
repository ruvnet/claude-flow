/**
 * Updates, pure: when a newer ruflo-console is published to github.com/ruvnet/ruflo, offer it at load, and keep an "always" choice.
 * Versions, the published manifest, the rules for what to do (ask, update without asking, leave alone), the question, and a read of
 * `claude plugin list --json` live here with no host and no network, so tests/updates.spec.ts runs them. The flow that fetches and
 * installs is hooks/update-flow.ts. The install itself is Claude Code's own `claude plugin update`, never code of ours, and its own
 * confirmation for a marketplace-declared command is never bypassed (no `-y`, no `--accept-command`).
 */
import { ESCAPES, HIDDEN } from './data/parse'
import { RUFLO_MARKET } from './data/snapshot'

export type UpdatesMode = 'ask' | 'auto' | 'off'
export const UPDATES_MODES: readonly UpdatesMode[] = ['ask', 'auto', 'off']

export const parseMode = (value: unknown): UpdatesMode => (value === 'auto' || value === 'off' ? value : 'ask')

/** Keys in the plugin's store (shared across sessions): the mode, when it last checked, when a session began updating, what it installed. */
export const UPDATES_KEY = 'updates'
export const CHECKED_KEY = 'update-checked-at'
export const APPLYING_KEY = 'update-applying-at'
export const INSTALLED_KEY = 'update-installed'

export const PLUGIN_NAME = 'ruflo-console'
/** The marketplace the plugin is installed from (`claude plugin marketplace list`: ruflo, GitHub ruvnet/ruflo). */
export const MARKET = RUFLO_MARKET
export const PLUGIN_ID = `${PLUGIN_NAME}@${MARKET}`
/** The published manifest: the same repository the ruflo marketplace is added from (ruvnet/ruflo), its main branch. */
export const MANIFEST_URL = 'https://raw.githubusercontent.com/ruvnet/ruflo/main/plugins/ruflo-console/.claude-plugin/plugin.json'
/** How often a session checks (the answer is cached across sessions), and how long one session's "I am updating" holds the others off. */
export const CHECK_EVERY_MS = 24 * 60 * 60_000
/** A session left open re-asks on this timer; the daily gate above still decides whether the network is touched. */
export const RECHECK_EVERY_MS = 6 * 60 * 60_000
/** The newest version a quiet re-check already told this person about, so a long session toasts once, not every tick. */
export const NOTIFIED_KEY = 'ruflo-console/update-notified'
export const APPLYING_HOLD_MS = 10 * 60_000

export const LABEL = { now: 'Update now', always: 'Always auto-update', later: 'Not now' } as const

/** The command to type by hand, said whenever Claude Code asks for its own confirmation or the update cannot be done from here. */
export const MANUAL_COMMAND = `claude plugin update ${PLUGIN_ID}`

type Semver = readonly [number, number, number]

/** `major.minor.patch` and nothing else: a pre-release or build suffix is never offered. */
export function parseSemver(text: string): Semver | null {
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(text.trim())

  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

export type Bump = 'patch' | 'minor' | 'major'

/** What `remote` is over `local`, or null when it is not strictly newer (the same, older, or not a version): never a downgrade. */
export function bumpKind(local: string, remote: string): Bump | null {
  const a = parseSemver(local)
  const b = parseSemver(remote)

  if (a === null || b === null) return null
  if (b[0] !== a[0]) return b[0] > a[0] ? 'major' : null
  if (b[1] !== a[1]) return b[1] > a[1] ? 'minor' : null

  return b[2] > a[2] ? 'patch' : null
}

/** The version in a fetched manifest, only if it is ours (`name` is ruflo-console) and a plain semver; else null. */
export function versionFromManifest(text: string): string | null {
  try {
    const value = JSON.parse(text) as { name?: unknown; version?: unknown }

    return value.name === PLUGIN_NAME && typeof value.version === 'string' && parseSemver(value.version) !== null ? value.version.trim() : null
  } catch {
    return null
  }
}

/** Time to check: never has, a day has passed, or the stored time is in the future (a clock that moved). */
export const isDue = (lastMs: unknown, nowMs: number): boolean => typeof lastMs !== 'number' || !Number.isFinite(lastMs) || lastMs > nowMs || nowMs - lastMs >= CHECK_EVERY_MS

/** Another session began updating a moment ago: this one leaves it alone (best effort; the store is not atomic). */
export const isBeingApplied = (startedMs: unknown, nowMs: number): boolean => typeof startedMs === 'number' && Number.isFinite(startedMs) && startedMs <= nowMs && nowMs - startedMs < APPLYING_HOLD_MS

export type Decision = 'none' | 'ask' | 'auto'

/**
 * What to do with a newer version. Off does nothing. Auto updates without asking, but never across a major version: a new major can
 * change what the console does, so it always asks. Otherwise it asks.
 */
export function decide(mode: UpdatesMode, kind: Bump | null): Decision {
  if (kind === null || mode === 'off') return 'none'

  return mode === 'auto' && kind !== 'major' ? 'auto' : 'ask'
}

/**
 * The question and the choices. "Always" is offered only below a major version, and says exactly what it means; the question ends
 * in a question mark, as the dialog requires.
 */
export function promptOf(local: string, remote: string, kind: Bump): { question: string; options: string[] } {
  const intro = `ruflo-console ${remote} is published to github.com/ruvnet/ruflo (you have ${local}${kind === 'major' ? '; a new major version, which can change what the console does' : ''}).`
  const always = kind === 'major' ? '' : `\n\n"${LABEL.always}" installs every new minor or patch version published there without asking (a new major version always asks). You can turn it off in Settings.`
  const how = '\n\nIt runs claude plugin marketplace update, then claude plugin update, and takes effect after you restart Claude Code or run /reload-plugins.'

  return { question: `${intro}${always}${how}\n\n${LABEL.now}?`, options: kind === 'major' ? [LABEL.now, LABEL.later] : [LABEL.now, LABEL.always, LABEL.later] }
}

export type Installed = { version: string; scope: string }

/**
 * Every install of ours that applies to a session working in `cwd`: the user-scope one, and a project or local one whose project is
 * `cwd` or holds it. An install for another project does not load here, so it is never touched. If none of those is found but the plugin
 * is listed, the single entry `installedEntry` would pick stands in (an unusual layout still gets an update, not a refusal).
 */
export function installedEntries(listJson: string, cwd: string, id: string = PLUGIN_ID): Installed[] {
  try {
    const list = JSON.parse(listJson) as unknown

    if (!Array.isArray(list)) return []

    const ours = list.filter((entry): entry is { id: string; version?: unknown; scope?: unknown; projectPath?: unknown } => typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === id)
    const here = (entry: { projectPath?: unknown }) => typeof entry.projectPath === 'string' && entry.projectPath !== '' && (cwd === entry.projectPath || cwd.startsWith(`${entry.projectPath.replace(/\/+$/, '')}/`))
    const applies = ours.filter(entry => entry.scope === 'user' || ((entry.scope === 'project' || entry.scope === 'local') && here(entry)))
    const valid = applies.flatMap(entry => (typeof entry.version === 'string' && typeof entry.scope === 'string' ? [{ version: entry.version, scope: entry.scope }] : []))

    if (valid.length > 0) return valid

    const single = installedEntry(listJson, id)

    return single === null ? [] : [single]
  } catch {
    return []
  }
}

/**
 * Our plugin in `claude plugin list --json`: the user-scope entry if there is one, else an enabled one, else the first. Null when it is
 * not installed from the marketplace (a session loaded with --plugin-dir has nothing to update) or the output is not the list.
 */
export function installedEntry(listJson: string, id: string = PLUGIN_ID): Installed | null {
  try {
    const list = JSON.parse(listJson) as unknown

    if (!Array.isArray(list)) return null

    const ours = list.filter((entry): entry is { id: string; version?: unknown; scope?: unknown; enabled?: unknown } => typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === id)
    const chosen = ours.find(entry => entry.scope === 'user') ?? ours.find(entry => entry.enabled === true) ?? ours[0]

    return chosen === undefined || typeof chosen.version !== 'string' || typeof chosen.scope !== 'string' ? null : { version: chosen.version, scope: chosen.scope }
  } catch {
    return null
  }
}

/** Claude Code refuses to run a marketplace-declared command unattended and says so: that is its trust gate, not a failure to retry. */
export const needsConfirmation = (output: string): boolean => /shownCommand|must be confirmed|confirm/i.test(output)

/** One short line of a command's output, for the toast: escapes and control characters removed, cut to fit. */
export function firstLine(text: string, max = 140): string {
  const line =
    text
      .replace(ESCAPES, '')
      .split('\n')
      // The console's one strip set (data/parse.ts): the line reaches update toasts and outcome details.
      .map(entry => entry.replace(HIDDEN, '').trim())
      .find(entry => entry !== '') ?? ''

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
