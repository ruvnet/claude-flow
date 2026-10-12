/**
 * The `skills` CLI (vercel-labs/skills, skills.sh) as fixed argv, and readers for what it prints. Read against skills
 * 1.7.0's source: `ls --json` prints an array of `{ name, path, scope, agents, source, sourceUrl, sourceType }`; `find`
 * has no JSON, so its coloured text is read line by line (`source@name 3.7M installs`, then `└ https://skills.sh/…`).
 * Every string here is another program's, or the person's, so each one is checked before it can become an argv element.
 */
import type { Outcome } from '../state'
import { jsonAfter } from './cli'
import { plain, recordOf, stringOf } from './parse'

/** `npx -y skills`: downloads the CLI on first use, so every run here reaches the network. */
export const SKILLS = ['npx', '-y', 'skills'] as const

export type Scope = 'project' | 'global'

export type InstalledSkill = { name: string; path: string; scope: Scope; agents: string[]; source?: string }
export type FoundSkill = { id: string; installs?: string; url?: string }

/** What the skills view holds between renders: the lists, the last search, and what is running now. */
export type SkillsState = {
  installed: InstalledSkill[] | null
  /** Why a list could not be read, by scope; a failing scope never blanks the other. */
  listErrors: Partial<Record<Scope, string>>
  listedAtMs: number
  isListing: boolean
  /** The search field's text, and the query the shown results answer. */
  searchDraft: string
  query: string
  found: FoundSkill[] | null
  findError: string | null
  isFinding: boolean
  createDraft: string
  /** The change running now (its label), and the create the last Enter asked about: Enter on it again confirms. */
  busy: string | null
  asked: { key: string; label: string; card: number | null } | null
  /** How the last change went, kept for the view after the footer lets it go. */
  last: Outcome | null
  /** Where ▸ add and ▸ update all go: the scope, and the agents named to `--agent` (none: the CLI's own pick). */
  scope: Scope
  agents: string[]
  /** How results are ordered: as skills.sh answered, or by install count. */
  sort: 'relevance' | 'installs'
  /** When the shown results arrived: a headless `skills-find` answers with them. */
  foundAtMs: number
  /** The preview panel: a skill's SKILL.md (installed) or its repository's skill list (a result), and what is loading. */
  preview: Preview | null
  previewing: string | null
  /** A ▸ use run in flight (its id). */
  using: string | null
  /** The last ▸ scan: the stack the project's manifests show, and the skills its ruflo agents name. */
  scan: Scan | null
  isScanning: boolean
  /** The skill the person last created or named for authoring, and its check. */
  authored: string | null
  check: { name: string; ok: boolean; lines: string[]; atMs: number } | null
}

export type Preview = { title: string; kind: 'installed' | 'repo'; lines: string[]; ok: boolean; atMs: number }

/** One local skill (under .claude/skills or .agents/skills) and the agent files that name it. */
export type LocalSkill = { name: string; where: string; refs: string[] }
export type Scan = { stack: string[]; chips: string[]; local: LocalSkill[]; agentFiles: number; atMs: number; notes: string[] }

export const emptySkills = (): SkillsState => ({
  installed: null,
  listErrors: {},
  listedAtMs: 0,
  isListing: false,
  searchDraft: '',
  query: '',
  found: null,
  findError: null,
  isFinding: false,
  createDraft: '',
  busy: null,
  asked: null,
  last: null,
  scope: 'project',
  agents: [],
  sort: 'relevance',
  foundAtMs: 0,
  preview: null,
  previewing: null,
  using: null,
  scan: null,
  isScanning: false,
  authored: null,
  check: null,
})

/**
 * The agents ▸ add can name to `--agent`, by the CLI's own ids (skills 1.7.0 `agents` table; it knows ~75, these are
 * the common ones). A fixed list: nothing typed ever reaches `--agent`.
 */
export const AGENT_TARGETS: readonly { id: string; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'gemini-cli', label: 'Gemini CLI' },
  { id: 'github-copilot', label: 'Copilot' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'cline', label: 'Cline' },
]

/** The agent ids that may become argv: known targets only, in the list's order, each once. */
export const agentsOf = (picked: readonly string[]): string[] => AGENT_TARGETS.map(agent => agent.id).filter(id => picked.includes(id))

const TYPED = /^[A-Za-z0-9@/._ -]+$/
const SKILL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)*@[A-Za-z0-9][A-Za-z0-9._:-]*$/
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
/** A new skill's folder: `init` joins it onto the project, so no slash and no leading dot (`../x` would escape). */
const NEW_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

export const MAX_QUERY = 512
export const MAX_NAME = 64

/** Text the person typed, trimmed, or null: empty, too long, a character outside [A-Za-z0-9@/._ -], or a leading -. */
export function typedOf(value: string, max = MAX_QUERY): string | null {
  const text = value.trim()

  return text === '' || text.length > max || !TYPED.test(text) || text.startsWith('-') ? null : text
}

export const skillIdOf = (value: unknown): string | null => (typeof value === 'string' && value.length <= 128 && SKILL_ID.test(value) ? value : null)
export const skillNameOf = (value: unknown): string | null => (typeof value === 'string' && value.length <= 128 && SKILL_NAME.test(value) ? value : null)

/** The name a new skill may take, or null. */
export function newNameOf(value: string): string | null {
  const text = typedOf(value, MAX_NAME)

  return text !== null && NEW_NAME.test(text) ? text : null
}

/**
 * The search field's words as `find` argv: `owner:<name>` anywhere in it becomes `--owner <name>`, the rest is the query
 * as one element. Null when the text would not pass `typedOf`, or names no query.
 */
export function findArgv(value: string): readonly string[] | null {
  const words = value.trim().split(/\s+/)
  const owners = words.filter(word => word.startsWith('owner:')).map(word => word.slice(6))
  const query = typedOf(words.filter(word => !word.startsWith('owner:')).join(' '))
  const owner = owners[0]

  if (query === null || owners.length > 1 || (owner !== undefined && !OWNER.test(owner))) return null

  return [...SKILLS, 'find', query, ...(owner !== undefined ? ['--owner', owner] : [])]
}

export const listArgv = (scope: Scope): readonly string[] => [...SKILLS, 'ls', ...(scope === 'global' ? ['-g'] : []), '--json']
/** `--agent` takes every word up to the next one starting with -, so the agents come last, before `-y`. */
const agentFlag = (agents: readonly string[]): string[] => {
  const ids = agentsOf(agents)

  return ids.length === 0 ? [] : ['--agent', ...ids]
}

export const addArgv = (id: string, scope: Scope, agents: readonly string[] = []): readonly string[] => [...SKILLS, 'add', id, ...(scope === 'global' ? ['-g'] : []), ...agentFlag(agents), '-y']
/** `use <id>` prints a prompt that carries the skill's SKILL.md; it copies the skill to a temp dir, installs nothing. */
export const useArgv = (id: string): readonly string[] => [...SKILLS, 'use', id]
/** `add <id> --list` lists the repository's skills and exits before installing (never with --json: the CLI refuses it). */
export const listRepoArgv = (id: string): readonly string[] => [...SKILLS, 'add', id, '--list']
/** `update` with no names updates every skill of the scope. */
export const updateAllArgv = (scope: Scope): readonly string[] => [...SKILLS, 'update', scope === 'global' ? '-g' : '-p', '-y']
/** Restores the project's skills from skills-lock.json: takes no flags. */
export const restoreArgv = (): readonly string[] => [...SKILLS, 'experimental_install']
/** Links skills found in node_modules into the agents' folders. */
export const syncArgv = (agents: readonly string[] = []): readonly string[] => [...SKILLS, 'experimental_sync', ...agentFlag(agents), '-y']
export const removeArgv = (name: string, scope: Scope): readonly string[] => [...SKILLS, 'remove', name, ...(scope === 'global' ? ['-g'] : []), '-y']
/** With the scope named, so `update` never stops at its project-or-global prompt. */
export const updateArgv = (name: string, scope: Scope): readonly string[] => [...SKILLS, 'update', name, scope === 'global' ? '-g' : '-p', '-y']
export const initArgv = (name: string): readonly string[] => [...SKILLS, 'init', name]

/** `skills ls [-g] --json`: the installed skills, or null when the output is not a JSON array. */
export function parseInstalled(stdout: string, scope: Scope): InstalledSkill[] | null {
  const value = jsonAfter(stdout)

  if (!Array.isArray(value)) return null

  return value.slice(0, 200).flatMap(entry => {
    const skill = recordOf(entry)
    const name = stringOf(skill?.name, 128)
    const path = stringOf(skill?.path, 300)

    if (skill === null || name === undefined || path === undefined) return []

    const agents = (Array.isArray(skill.agents) ? skill.agents : []).slice(0, 20).flatMap(agent => stringOf(agent, 30) ?? [])
    const source = stringOf(skill.source, 120)

    return [{ name, path, scope: skill.scope === 'global' || skill.scope === 'project' ? skill.scope : scope, agents, ...(source !== undefined && { source }) }]
  })
}

/**
 * `skills find <query>`: each result is a line `source@name[ N installs]` followed by `└ <url>`. Split into lines first
 * (`plain` folds newlines away), then strip colour from each. A line that is not a skill id is passed over.
 */
export function parseFind(stdout: string): FoundSkill[] {
  const lines = stdout.slice(0, 200_000).split('\n').map(line => plain(line, 300))
  const out: FoundSkill[] = []

  lines.forEach((line, i) => {
    const match = /^(\S+)(?:\s+([\d.]+[KM]?)\s+installs?)?$/.exec(line)
    const id = skillIdOf(match?.[1])

    if (match === null || id === null || out.length >= 30) return

    const next = /^└\s*(https:\/\/\S+)$/.exec(lines[i + 1] ?? '')?.[1]

    out.push({ id, ...(match[2] !== undefined && { installs: match[2] }), ...(next !== undefined && { url: next }) })
  })

  return out
}

/** The skill's own name in an `owner/repo@skill` id: what `ls` lists once it is added. */
export const nameInId = (id: string): string => id.slice(id.lastIndexOf('@') + 1)

/** An install count as skills.sh prints it (`1M`, `764.8K`, `42`), or -1 when there is none. */
export function installsOf(text: string | undefined): number {
  const match = /^([\d.]+)([KM]?)$/.exec(text ?? '')
  const n = match === null ? NaN : Number(match[1])

  return Number.isFinite(n) && match !== null ? n * (match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1000 : 1) : -1
}

/** The results in the order asked for: as found, or most installed first (results without a count last). */
export const sortedFound = (found: readonly FoundSkill[], sort: SkillsState['sort']): FoundSkill[] =>
  sort === 'installs' ? [...found].sort((a, b) => installsOf(b.installs) - installsOf(a.installs)) : [...found]

/** A line with its colour gone but its indent kept (`plain` folds whitespace, and the indent is what tells names from text). */
const bare = (line: string): string => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+$/, '')

export type RepoSkill = { name: string; description: string; group?: string }

/**
 * `skills add <id> --list`: after the `Available Skills` step, each skill is a `│    name` line then a `│      text`
 * line (deeper); a line with no bar is a group's title. Everything before that step (spinners, the source) is passed over.
 */
export function parseRepoList(stdout: string): RepoSkill[] {
  const lines = stdout.slice(0, 200_000).split('\n').map(bare)
  const start = lines.findIndex(line => /Available Skills\s*$/.test(line))
  const out: RepoSkill[] = []
  let group: string | undefined

  if (start < 0) return out

  for (const line of lines.slice(start + 1)) {
    if (out.length >= 60) break
    if (/^[└]/.test(line)) break

    const body = /^│(\s*)(.*)$/.exec(line)

    if (body === null) {
      if (line.trim() !== '') group = plain(line, 60)
      continue
    }

    const [, indent = '', words = ''] = body

    if (words.trim() === '') continue

    const last = out[out.length - 1]

    if (indent.length <= 4) out.push({ name: plain(words, 80), description: '', ...(group !== undefined && { group }) })
    else if (last !== undefined) last.description = plain(`${last.description} ${words}`, 300)
  }

  return out
}

/** The terminal sends at most this much of a prompt; a longer one is cut here, and the outcome says so. */
export const USE_MAX = 8_000

/** What `use` printed, as the prompt the terminal is loaded with: trimmed, capped, empty when there is none. */
export function usePromptOf(stdout: string): { prompt: string; isCut: boolean } {
  const text = stdout.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '').trim()

  return { prompt: text.slice(0, USE_MAX), isCut: text.length > USE_MAX }
}
