/**
 * The skills view's work: list what is installed (project and global), search skills.sh, and the four changes. Reads
 * run at once, but only when the person acts (opening the view, Enter in the search field, refresh), since `npx -y
 * skills` downloads the CLI and `find` asks skills.sh. Changes (add, remove, update, init) write to the agents' skill
 * folders or the project, so each is asked first: the confirm row prints its exact argv, and after it runs the
 * installed lists are read again to say whether it took. Every argv is fixed, with no shell; nothing here writes a file.
 */
import type { ActionSpec } from './actions'
import { addArgv, agentsOf, findArgv, initArgv, listArgv, nameInId, newNameOf, parseFind, parseInstalled, removeArgv, skillIdOf, skillNameOf, updateArgv, type FoundSkill, type InstalledSkill, type Scope } from './data/skills'
import { plain } from './data/parse'
import type { Host } from './host'
import { outputLines } from './ops'
import type { Runner } from './runner'
import type { State } from './state'

/** A read may first download the CLI; `add` clones a repository. */
const READ_TIMEOUT_MS = 90_000
const CHANGE_TIMEOUT_MS = 180_000

const firstLine = (text: string): string => plain(text.split('\n').find(line => line.trim() !== '') ?? '', 120)

const listing = new WeakMap<State, Promise<void>>()
const finding = new WeakMap<State, Promise<void>>()

async function listOnce(state: State, host: Host): Promise<void> {
  const skills = state.skills

  skills.isListing = true
  host.invalidate()

  try {
    const lists = await Promise.all(
      (['project', 'global'] as const).map(async scope => {
        try {
          const result = await host.run(listArgv(scope), READ_TIMEOUT_MS)
          const parsed = result.exitCode === 0 ? parseInstalled(result.stdout, scope) : null

          if (parsed === null) skills.listErrors[scope] = result.exitCode !== 0 ? `exit ${result.exitCode}: ${firstLine(result.stderr) || 'no message'}` : 'no JSON list in the output'
          else delete skills.listErrors[scope]

          return parsed ?? []
        } catch (error) {
          skills.listErrors[scope] = plain(error instanceof Error ? error.message : String(error), 120) || 'refused'

          return []
        }
      }),
    )

    skills.installed = lists.flat()
    skills.listedAtMs = Date.now()
  } finally {
    skills.isListing = false
    host.invalidate()
  }
}

/** Reads both installed lists; a list already running is joined, unless `isFresh` asks for one that starts after it. */
export function listSkills(state: State, host: Host, isFresh = false): Promise<void> {
  // `npx skills ls` is a network fetch and a package download: Claude opening the page does not start it, only the person's own press does (#3815).
  if (state.control.viaModel) return Promise.resolve()

  const held = listing.get(state)

  if (held !== undefined && !isFresh) return held

  const run = (held ?? Promise.resolve()).then(() => listOnce(state, host)).finally(() => {
    if (listing.get(state) === run) listing.delete(state)
  })

  listing.set(state, run)

  return run
}

/** Asks skills.sh for the field's text; answers why not when it cannot (bad text, a search already out). */
export function findSkills(state: State, host: Host, text: string): string | null {
  const skills = state.skills
  const argv = findArgv(text)

  if (argv === null) return 'search: 1-64 characters of letters, digits, @ / . _ - and spaces, not starting with - (owner:<name> narrows it)'
  if (skills.isFinding) return 'a search is still running'

  skills.query = text.trim()
  skills.isFinding = true
  skills.findError = null
  host.invalidate()

  const run = host
    .run(argv, READ_TIMEOUT_MS)
    .then(result => {
      skills.found = parseFind(result.stdout)
      skills.foundAtMs = Date.now()
      skills.findError = result.exitCode !== 0 ? `exit ${result.exitCode}: ${firstLine(result.stderr) || firstLine(result.stdout) || 'no message'}` : null
    })
    .catch((error: unknown) => {
      skills.found = null
      skills.findError = plain(error instanceof Error ? error.message : String(error), 120) || 'refused'
    })
    .finally(() => {
      skills.isFinding = false
      host.invalidate()
    })

  finding.set(state, run)

  return null
}

/** Resolves when the search started last has answered (a headless `skills-find` waits on it). */
export const findSettled = (state: State): Promise<void> => finding.get(state) ?? Promise.resolve()

/**
 * One confirm-gated change: `shows` puts its argv on the confirm row; once confirmed, `run` runs it, reads the lists
 * again, and says how it went (on disk: the lists show the change).
 */
export function change(state: State, host: Host, label: string, argv: readonly string[], expect: string, verify?: (installed: InstalledSkill[]) => boolean): ActionSpec {
  return {
    label,
    args: argv,
    shows: argv.join(' '),
    expect,
    run: async () => {
      const skills = state.skills

      if (skills.busy !== null) {
        state.outcome = { label, ok: false, verified: 'n/a', detail: `${skills.busy} is still running: ask again when it ends`, atMs: Date.now() }
        host.invalidate()

        return
      }

      skills.busy = label
      host.invalidate()

      try {
        const result = await host.run(argv, CHANGE_TIMEOUT_MS)
        const ok = result.exitCode === 0

        await listSkills(state, host, true)

        const verified = !ok || verify === undefined || state.skills.installed === null ? 'n/a' : verify(state.skills.installed) ? 'yes' : 'no'

        state.outcome = {
          label,
          ok: ok && verified !== 'no',
          verified,
          detail: ok ? `skills answered ok; expected ${expect}` : `exit ${result.exitCode}: ${firstLine(result.stderr) || firstLine(result.stdout) || 'no message'}`,
          atMs: Date.now(),
          lines: outputLines(`${result.stdout}\n${result.stderr}`, 6),
        }
      } catch (error) {
        state.outcome = { label, ok: false, verified: 'n/a', detail: plain(error instanceof Error ? error.message : String(error), 160) || 'refused', atMs: Date.now() }
      } finally {
        skills.busy = null
        skills.last = state.outcome
        host.invalidate()
      }
    },
  }
}

/** The CLI lowercases a skill's folder name on install, so a listed name is matched without case. */
const isIn = (name: string, scope: Scope) => (installed: InstalledSkill[]) => installed.some(skill => skill.name.toLowerCase() === name.toLowerCase() && skill.scope === scope)

export function addSpec(state: State, host: Host, found: FoundSkill, scope: Scope): ActionSpec | null {
  const id = skillIdOf(found.id)

  const agents = agentsOf(state.skills.agents)
  const where = `${scope === 'global' ? ' globally' : ' to this project'}${agents.length > 0 ? ` for ${agents.join(', ')}` : ''}`

  return id === null ? null : change(state, host, `add skill ${id}${where}`, addArgv(id, scope, agents), `${nameInId(id)} listed as ${scope}`, isIn(nameInId(id), scope))
}

export function removeSpec(state: State, host: Host, skill: InstalledSkill): ActionSpec | null {
  const name = skillNameOf(skill.name)

  return name === null ? null : change(state, host, `remove ${skill.scope} skill ${name}`, removeArgv(name, skill.scope), `${name} gone from the ${skill.scope} list`, installed => !isIn(name, skill.scope)(installed))
}

export function updateSpec(state: State, host: Host, skill: InstalledSkill): ActionSpec | null {
  const name = skillNameOf(skill.name)

  return name === null ? null : change(state, host, `update ${skill.scope} skill ${name}`, updateArgv(name, skill.scope), 'the newest version from its source')
}

/** `init` writes `<name>/SKILL.md` in the project, which `ls` does not list: nothing to check it against. */
export function initSpec(state: State, host: Host, name: string): ActionSpec | null {
  const safe = newNameOf(name)

  return safe === null ? null : change(state, host, `create skill ${safe}`, initArgv(safe), `${safe}/SKILL.md in this project`)
}

/** What the AI terminal is loaded with for ▸ edit: the skill named, and where it is; claude makes the change. */
export const editPrompt = (skill: InstalledSkill): string => `Edit the skill ${plain(skill.name, 128)} at ${plain(skill.path, 300)}: `

const NAME_RULE = 'a new skill name: letters, digits, . _ - (no slash, not starting with . or -), at most 64'

export type SkillActions = {
  list: () => void
  searchDraft: (text: string) => void
  search: (text: string) => void
  createDraft: (text: string) => void
  /** Enter asks; Enter again on the same name (or an emptied field) confirms, as the field keeps the keys. */
  create: (text: string) => void
  add: (found: FoundSkill, scope: Scope) => void
  remove: (skill: InstalledSkill) => void
  update: (skill: InstalledSkill) => void
  edit: (skill: InstalledSkill) => void
}

export function skillActions(state: State, host: Host, runner: Runner, load: (text: string) => void): SkillActions {
  const skills = state.skills
  const nameless = (what: string) => `that skill's name cannot be passed to skills ${what}`

  return {
    list: () => void listSkills(state, host, true),
    searchDraft: text => {
      skills.searchDraft = text
    },
    search: text => {
      skills.searchDraft = text
      const why = findSkills(state, host, text)

      if (why !== null) runner.ask(null, why)
    },
    createDraft: text => {
      skills.createDraft = text
    },
    create: text => {
      const asked = skills.asked
      const name = newNameOf(text)

      if (asked !== null && asked.card !== null && (asked.key === text.trim() || text.trim() === '') && state.pending?.id === asked.card) {
        skills.asked = null
        skills.createDraft = ''
        void runner.confirm(asked.card)

        return
      }

      const spec = name === null ? null : initSpec(state, host, name)

      skills.createDraft = text
      if (name !== null) skills.authored = name
      const before = state.pending?.id

      runner.ask(spec, NAME_RULE)
      skills.asked = spec !== null && name !== null ? { key: name, label: spec.label, card: state.pending !== null && state.pending.id !== before ? (state.pending.id ?? null) : null } : null
    },
    add: (found, scope) => runner.ask(addSpec(state, host, found, scope), 'that result is not an owner/repo@skill id'),
    remove: skill => runner.ask(removeSpec(state, host, skill), nameless('remove')),
    update: skill => runner.ask(updateSpec(state, host, skill), nameless('update')),
    edit: skill => load(editPrompt(skill)),
  }
}
