/**
 * The rest of the skills view's work, beside the list/search/add/remove of skills.ts: ▸ use a skill without installing
 * it (its prompt goes to the AI terminal, typed, never sent), previews (an installed SKILL.md read from disk, bounded; a
 * result's repository listed by `add <id> --list`, which installs nothing), update-all / restore / sync behind a confirm,
 * the scope and agents ▸ add installs to, a scan of this project (its stack as searches, and which agent files name its
 * skills), and authoring (claude writes the SKILL.md, the console checks its frontmatter). Network reads run only on a
 * click; every change is one fixed argv on the confirm row, its cost in words beside it.
 */
import type { ActionSpec } from './actions'
import { readBounded, textOf, under, type ReaderFs } from './data/files'
import { plain } from './data/parse'
import { checkLines, checkSkillMd, inferStack, skillRefs } from './data/skill-md'
import { AGENT_TARGETS, agentsOf, findArgv, listRepoArgv, nameInId, newNameOf, parseRepoList, restoreArgv, skillIdOf, skillNameOf, sortedFound, syncArgv, updateAllArgv, useArgv, usePromptOf, type FoundSkill, type InstalledSkill, type Scope } from './data/skills'
import type { Host } from './host'
import type { PaletteEntry } from './palette'
import type { Runner } from './runner'
import { change, findSettled, findSkills } from './skills'
import type { State } from './state'

const NET_TIMEOUT_MS = 90_000
/** Lines of a SKILL.md the preview shows under its check. */
export const PREVIEW_LINES = 40
/** Agent files read by ▸ scan, at most, and the largest one read. */
const DOCS_MAX = 200
const DOC_BYTES = 200_000

export const NOTES = {
  use: 'network: downloads the skill to a temp dir (skills-use-*); installs nothing; the prompt is typed into the AI terminal, not sent',
  list: 'network: clones the repository to a temp dir to list it; installs nothing',
  update: 'network: fetches each skill from its source and rewrites its folder',
  restore: 'experimental · network: clones every source in skills-lock.json and writes the agents’ skill folders',
  sync: 'experimental: links skills found in node_modules into the agents’ skill folders (writes)',
} as const

const hosts = new WeakMap<State, { host: Host; load: (text: string) => void }>()

const errorOf = (error: unknown): string => plain(error instanceof Error ? error.message : String(error), 160) || 'refused'

function say(state: State, host: Host, label: string, ok: boolean, detail: string, lines?: string[]): void {
  state.outcome = { label, ok, verified: 'n/a', detail, atMs: Date.now(), ...(lines !== undefined && { lines }) }
  state.skills.last = state.outcome
  host.invalidate()
}

/** ▸ use: runs `use <id>` at once (a click is the ask) and loads its prompt into the claude terminal for review. */
export function useSpec(state: State, host: Host, found: FoundSkill, load: (text: string) => void): ActionSpec | null {
  const id = skillIdOf(found.id)

  if (id === null) return null

  const argv = useArgv(id)
  const label = `use ${id} without installing it`

  return {
    label,
    args: argv,
    shows: argv.join(' '),
    expect: 'the skill’s prompt typed into the AI terminal',
    isReadOnly: true,
    declared: 'network',
    note: NOTES.use,
    run: async () => {
      const skills = state.skills

      if (skills.using !== null) return say(state, host, label, false, `${skills.using} is still being fetched`)

      skills.using = id
      host.invalidate()

      try {
        const result = await host.run(argv, NET_TIMEOUT_MS)
        const { prompt, isCut } = usePromptOf(result.stdout)

        if (result.exitCode !== 0 || prompt === '') return say(state, host, label, false, `exit ${result.exitCode}: ${plain(result.stderr, 160) || 'no prompt printed'}`)

        load(prompt)
        say(state, host, label, true, `its prompt is in the AI terminal${isCut ? ' (cut to 8,000 characters)' : ''}: read it, then Enter twice sends it to claude`)
      } catch (error) {
        say(state, host, label, false, errorOf(error))
      } finally {
        skills.using = null
        host.invalidate()
      }
    },
  }
}

/** ▸ preview of a result: `add <id> --list` (lists, installs nothing), its skills shown, the picked one marked. */
export function previewFoundSpec(state: State, host: Host, found: FoundSkill): ActionSpec | null {
  const id = skillIdOf(found.id)

  if (id === null) return null

  const argv = listRepoArgv(id)
  const label = `preview ${id}`

  return {
    label,
    args: argv,
    shows: argv.join(' '),
    expect: 'the repository’s skills in the preview panel',
    isReadOnly: true,
    declared: 'network',
    note: NOTES.list,
    run: async () => {
      const skills = state.skills

      skills.previewing = id
      host.invalidate()

      try {
        const result = await host.run(argv, NET_TIMEOUT_MS)
        const listed = parseRepoList(result.stdout)
        const want = nameInId(id).toLowerCase()
        const lines = listed.flatMap(skill => [`${skill.name.toLowerCase() === want ? '▸' : ' '} ${skill.name}${skill.group !== undefined ? `  (${skill.group})` : ''}`, `    ${skill.description}`])
        const ok = result.exitCode === 0 && listed.length > 0

        skills.preview = { title: `${id} · ${listed.length} skill${listed.length === 1 ? '' : 's'} in its repository`, kind: 'repo', lines: ok ? lines : [`exit ${result.exitCode}: ${plain(result.stderr, 160) || 'no skills listed'}`], ok, atMs: Date.now() }
        say(state, host, label, ok, ok ? `${listed.length} listed; nothing installed` : 'nothing listed')
      } catch (error) {
        skills.preview = { title: id, kind: 'repo', lines: [errorOf(error)], ok: false, atMs: Date.now() }
        say(state, host, label, false, errorOf(error))
      } finally {
        skills.previewing = null
        host.invalidate()
      }
    },
  }
}

/** A path the CLI listed, accepted only when absolute and free of `..` segments. */
export const isSafeDir = (path: string): boolean => path.startsWith('/') && !path.split('/').includes('..') && !/[\u0000-\u001f]/.test(path)

/** Reads a SKILL.md (bounded), checks it and keeps the result as the preview; never runs it. */
async function previewFile(state: State, fs: ReaderFs, title: string, path: string, folder: string): Promise<void> {
  const read = await readBounded(fs, state.cache, path, undefined, true)
  const text = textOf(read)

  if (text === null) {
    state.skills.preview = { title, kind: 'installed', lines: [`${path}: ${'reason' in read ? read.reason : 'unread'}`], ok: false, atMs: Date.now() }

    return
  }

  const check = checkSkillMd(text, folder)

  state.skills.preview = { title, kind: 'installed', lines: [...checkLines(check), '', ...text.split('\n').slice(0, PREVIEW_LINES).map(line => plain(line, 160))], ok: check.ok, atMs: Date.now() }
}

/** The person's own skills in this project, and every agent file that names one, all from disk (bounded). */
export async function scanProject(state: State, fs: ReaderFs): Promise<void> {
  const read = (path: string) => readBounded(fs, state.cache, under(state.cwd, path)).then(textOf)
  const [packageJson, cargoToml, pyproject, goMod] = await Promise.all(['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'].map(read))
  const { stack, chips } = inferStack({ packageJson, cargoToml, pyproject, goMod })
  const notes: string[] = []
  const local: { name: string; where: string }[] = []

  for (const where of ['.claude/skills', '.agents/skills']) {
    const entries = await fs.list(under(state.cwd, where)).catch(() => [])

    for (const entry of entries.slice(0, 100)) {
      const name = skillNameOf(entry.name)

      if (name === null || entry.kind === 'file' || local.some(skill => skill.name === name)) continue
      if (await fs.stat(under(state.cwd, `${where}/${name}/SKILL.md`)).then(() => true, () => false)) local.push({ name, where })
    }
  }

  const docs: { path: string; text: string }[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await fs.list(dir).catch(() => [])

    for (const entry of entries) {
      if (docs.length >= DOCS_MAX || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.name)) continue

      const path = `${dir}/${entry.name}`

      if (entry.kind === 'dir' && depth > 0) await walk(path, depth - 1)
      else if (entry.kind !== 'dir' && entry.name.endsWith('.md') && (entry.size ?? 0) <= DOC_BYTES) {
        const text = textOf(await readBounded(fs, state.cache, path))

        if (text !== null) docs.push({ path, text: text.slice(0, DOC_BYTES) })
      }
    }
  }

  await walk(under(state.cwd, '.claude/agents'), 2)
  if (docs.length >= DOCS_MAX) notes.push(`read the first ${DOCS_MAX} agent files only`)

  state.skills.scan = { stack, chips, local: skillRefs(local, docs), agentFiles: docs.length, atMs: Date.now(), notes }
}

/** What the AI terminal is loaded with for ▸ write: the skill's file, the rules its check holds it to. */
export const authorPrompt = (cwd: string, name: string): string =>
  `Write the agent skill at ${plain(cwd, 300)}/${name}/SKILL.md. Keep its YAML frontmatter at the top with name: ${name} (lowercase letters, digits and hyphens) and a one-sentence description: of what it does and when to use it (at most 1024 characters), then concise instructions under 500 lines; put long reference material in separate files beside it. The skill is for: `

export type MoreSkillActions = {
  use: (found: FoundSkill) => void
  previewFound: (found: FoundSkill) => void
  previewInstalled: (skill: InstalledSkill) => void
  closePreview: () => void
  updateAll: () => void
  restore: () => void
  sync: () => void
  scope: (scope: Scope) => void
  toggleAgent: (id: string) => void
  sortBy: () => void
  scan: () => void
  /** A recommended search: fills the field and asks skills.sh. */
  chip: (query: string) => void
  /** ▸ write: the AI terminal, loaded with a prompt to write the skill named in the create field. */
  author: () => void
  validate: () => void
}

/** The skill being authored: the create field's name, else the one created last. */
const authoredOf = (state: State): string | null => newNameOf(state.skills.createDraft) ?? state.skills.authored

export const updateAllSpec = (state: State, host: Host): ActionSpec => ({
  ...change(state, host, `update every ${state.skills.scope} skill`, updateAllArgv(state.skills.scope), 'each skill at the newest version of its source'),
  note: NOTES.update,
})

export const restoreSpec = (state: State, host: Host): ActionSpec => ({
  ...change(state, host, 'restore the project’s skills from skills-lock.json', restoreArgv(), 'every skill in skills-lock.json installed'),
  note: NOTES.restore,
})

export const syncSpec = (state: State, host: Host): ActionSpec => ({
  ...change(state, host, `sync skills from node_modules${state.skills.agents.length > 0 ? ` for ${agentsOf(state.skills.agents).join(', ')}` : ''}`, syncArgv(state.skills.agents), 'node_modules skills linked into the agents’ folders'),
  note: NOTES.sync,
})

export function moreSkillActions(state: State, host: Host, runner: Runner, load: (text: string) => void): MoreSkillActions {
  const skills = state.skills
  const notAnId = 'that result is not an owner/repo@skill id'

  hosts.set(state, { host, load })

  return {
    use: found => runner.ask(useSpec(state, host, found, load), notAnId),
    previewFound: found => runner.ask(previewFoundSpec(state, host, found), notAnId),
    previewInstalled: skill => {
      if (!isSafeDir(skill.path)) return runner.ask(null, 'that skill’s path is not an absolute path the console will read')

      skills.previewing = skill.name
      host.invalidate()
      void previewFile(state, host.fs, `${skill.name} · ${skill.scope} · SKILL.md`, `${skill.path.replace(/\/+$/, '')}/SKILL.md`, skill.path.split('/').pop() ?? '').finally(() => {
        skills.previewing = null
        host.invalidate()
      })
    },
    closePreview: () => {
      skills.preview = null
      host.invalidate()
    },
    updateAll: () => runner.ask(updateAllSpec(state, host), ''),
    restore: () => runner.ask(restoreSpec(state, host), ''),
    sync: () => runner.ask(syncSpec(state, host), ''),
    scope: scope => {
      skills.scope = scope
      host.invalidate()
    },
    toggleAgent: id => {
      if (!AGENT_TARGETS.some(agent => agent.id === id)) return

      skills.agents = skills.agents.includes(id) ? skills.agents.filter(agent => agent !== id) : agentsOf([...skills.agents, id])
      host.invalidate()
    },
    sortBy: () => {
      skills.sort = skills.sort === 'installs' ? 'relevance' : 'installs'
      host.invalidate()
    },
    scan: () => {
      if (skills.isScanning) return

      skills.isScanning = true
      host.invalidate()
      void scanProject(state, host.fs)
        .catch(error => say(state, host, 'scan this project', false, errorOf(error)))
        .finally(() => {
          skills.isScanning = false
          host.invalidate()
        })
    },
    chip: query => {
      skills.searchDraft = query
      const why = findSkills(state, host, query)

      if (why !== null) runner.ask(null, why)
    },
    author: () => {
      const name = authoredOf(state)

      if (name === null) return runner.ask(null, 'type the new skill’s name in the create field first')

      skills.authored = name
      load(authorPrompt(state.cwd, name))
    },
    validate: () => {
      const name = authoredOf(state)

      if (name === null) return runner.ask(null, 'type the skill’s name in the create field first')

      skills.authored = name
      void readBounded(host.fs, state.cache, under(state.cwd, `${name}/SKILL.md`), undefined, true).then(read => {
        const text = textOf(read)
        const lines = text === null ? [`${name}/SKILL.md: ${'reason' in read ? read.reason : 'unread'} (▸ create makes it)`] : checkLines(checkSkillMd(text, name))

        skills.check = { name, ok: text !== null && lines[0]?.startsWith('✓') === true, lines, atMs: Date.now() }
        host.invalidate()
      })
    },
  }
}

/**
 * The skills entries of the palette, so `/ruflo run skills-update` works headless: a search (`skills-find <words>`),
 * update-all, restore and sync. Without the view's wiring (no host yet) each says so instead of running.
 */
export function skillPaletteEntries(state: State): PaletteEntry[] {
  const wired = hosts.get(state)
  const why = 'the console is not running in this session: open it first (console_open skills)'
  const spec = (make: (host: Host) => ActionSpec): { kind: 'spec'; spec: ActionSpec | null; why: string } => ({ kind: 'spec', spec: wired === undefined ? null : make(wired.host), why })
  const find = (text: string): ActionSpec | null => {
    const argv = findArgv(text)

    if (wired === undefined || argv === null) return null

    return {
      label: `skills find ${plain(text, 64)}`,
      args: argv,
      shows: argv.join(' '),
      expect: 'the results in the skills view',
      isReadOnly: true,
      declared: 'network',
      note: 'network: asks skills.sh',
      run: async () => {
        state.skills.searchDraft = text
        if (findSkills(state, wired.host, text) === null) await findSettled(state)
      },
    }
  }

  return [
    { id: 'skills-find', group: 'skills', label: 'skills-find <words>: search skills.sh (owner:<name> narrows it)', run: { kind: 'text', keyword: 'skills-find', make: find } },
    { id: 'skills-update', group: 'skills', label: `update every ${state.skills.scope} skill (npx skills update)`, run: spec(host => updateAllSpec(state, host)) },
    { id: 'skills-restore', group: 'skills', label: 'restore the project’s skills from skills-lock.json', run: spec(host => restoreSpec(state, host)) },
    { id: 'skills-sync', group: 'skills', label: 'sync skills from node_modules into the agents’ folders', run: spec(host => syncSpec(state, host)) },
  ]
}

/** The headless answer for `skills-find`: the results that arrived since the ask, most installed first when sorted so. */
export function skillsAnswer(state: State, id: string, sinceMs: number): string | null {
  const skills = state.skills

  if (id !== 'skills-find' || skills.foundAtMs < sinceMs) return null
  if (skills.findError !== null) return `✗ skills find: ${skills.findError}`

  const found = sortedFound(skills.found ?? [], skills.sort)

  return [`skills find "${skills.query}": ${found.length} found`, ...found.slice(0, 15).map(skill => `  ${skill.id}${skill.installs !== undefined ? ` · ${skill.installs} installs` : ''}`)].join('\n')
}
