/**
 * The ruflo marketplace as a catalog: every plugin its clone lists, with the skills, agents, commands, MCP config and
 * mod (function hooks) each ships, read from the clone on disk. An external plugin (listed by a git source, maintained in
 * another repository) has no copy in the clone: it is read from its install path in `installed_plugins.json` when it is
 * installed. Read-only, bounded, nothing run: a file over the cap, a name that is not a plain word and a path with `..`
 * are skipped, and every read may be refused.
 */
import type { ReaderFs } from './files'
import { plain } from './parse'

export type CatalogPlugin = {
  name: string
  description: string
  version: string | null
  /** Folder of the plugin inside the clone, or of the installed copy of an external one (absolute); '' when there is neither. */
  dir: string
  skills: string[]
  agents: string[]
  commands: string[]
  hasMcp: boolean
  /** The plugin.json userConfig keys: the options Settings can edit. */
  options: string[]
  /** A `hooks/register.ts` makes it a mod: function hooks run in the engine. */
  isMod: boolean
  /** Set for an external plugin: the repository, folder and ref the marketplace pins it to. */
  external?: string
}

const NAME = /^[A-Za-z0-9._-]{1,80}$/
const PLUGINS_MAX = 200
const LIST_MAX = 200
const DOC_BYTES = 120_000
/** Lines of a SKILL.md or command file the Result panel shows. */
export const DOC_LINES = 40

const recordOf = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)

const safeSource = (source: unknown): string | null =>
  typeof source === 'string' && source.startsWith('./') && !source.split('/').includes('..') && source.length < 200 ? source.slice(2).replace(/\/+$/, '') : null

async function namesIn(fs: ReaderFs, dir: string, kind: 'dir' | 'md'): Promise<string[]> {
  const entries = await fs.list(dir).catch(() => [])

  return entries
    .flatMap(entry => {
      const isDir = entry.kind === undefined ? !entry.name.includes('.') : entry.kind === 'directory' || entry.kind === 'dir'
      const name = kind === 'md' ? entry.name.replace(/\.md$/, '') : entry.name

      return (kind === 'md' ? entry.name.endsWith('.md') && !isDir : isDir) && NAME.test(name) ? [name] : []
    })
    .sort()
    .slice(0, LIST_MAX)
}

/** An external source (`git-subdir`, `github`, `git`, `url`) as one plain line, or null for anything else. */
function externalOf(source: unknown): string | null {
  const record = recordOf(source)
  const at = (value: unknown) => (typeof value === 'string' ? value : '')

  if (record === null || !['git-subdir', 'github', 'git', 'url'].includes(at(record.source))) return null

  const where = [at(record.url) || at(record.repo), at(record.path)].filter(Boolean).join(' ')
  const ref = at(record.ref) || at(record.sha).slice(0, 12)

  return where === '' ? null : plain(`${where}${ref === '' ? '' : ` @ ${ref}`}`, 200)
}

const exists = async (fs: ReaderFs, path: string): Promise<boolean> => (await fs.stat(path).catch(() => undefined)) !== undefined

async function pluginOf(fs: ReaderFs, location: string, entry: Record<string, unknown>, installed: ReadonlyMap<string, string>): Promise<CatalogPlugin | null> {
  const name = entry.name
  const source = safeSource(entry.source)
  const external = source === null ? externalOf(entry.source) : null

  if (typeof name !== 'string' || !NAME.test(name) || (source === null && external === null)) return null

  const dir = source !== null ? `${location}/${source}` : (installed.get(name) ?? '')

  if (dir === '') {
    return { name, options: [], description: plain(typeof entry.description === 'string' ? entry.description : '', 400), version: null, dir, skills: [], agents: [], commands: [], hasMcp: false, isMod: false, ...(external !== null && { external }) }
  }

  const manifest = await fs.read(`${dir}/.claude-plugin/plugin.json`).then(
    text => recordOf(JSON.parse(text)),
    () => null,
  )
  const [skills, agents, commands, hasMcp, isMod] = await Promise.all([namesIn(fs, `${dir}/skills`, 'dir'), namesIn(fs, `${dir}/agents`, 'md'), namesIn(fs, `${dir}/commands`, 'md'), exists(fs, `${dir}/.mcp.json`), exists(fs, `${dir}/hooks/register.ts`)])
  const version = typeof manifest?.version === 'string' ? plain(manifest.version, 30) : typeof entry.version === 'string' ? plain(entry.version, 30) : null

  const options = Object.keys(recordOf(manifest?.userConfig) ?? {}).filter(key => NAME.test(key)).slice(0, 60)

  return { name, options, description: plain(typeof entry.description === 'string' ? entry.description : typeof manifest?.description === 'string' ? manifest.description : '', 400), version, dir, skills, agents, commands, hasMcp, isMod, ...(external !== null && { external }) }
}

/**
 * Every plugin the marketplace clone at `location` lists, or null when its manifest cannot be read. `installed` maps a plugin name to
 * its install path (absolute, already checked by the caller): an external plugin is read from there.
 */
export async function readCatalog(fs: ReaderFs, location: string, installed: ReadonlyMap<string, string> = new Map()): Promise<CatalogPlugin[] | null> {
  if (!location.startsWith('/') || location.split('/').includes('..')) return null

  const raw = await fs.read(`${location}/.claude-plugin/marketplace.json`).catch(() => null)
  let list: unknown[] = []

  try {
    const plugins = raw === null ? null : recordOf(JSON.parse(raw))?.plugins

    if (!Array.isArray(plugins)) return null

    list = plugins.slice(0, PLUGINS_MAX)
  } catch {
    return null
  }

  const found: CatalogPlugin[] = []

  // Eight at a time: forty-odd plugins are a few hundred small reads, none of which should crowd the engine's own.
  for (let at = 0; at < list.length; at += 8) {
    const batch = await Promise.all(
      list.slice(at, at + 8).map(async entry => {
        const record = recordOf(entry)

        return record === null ? null : pluginOf(fs, location, record, installed).catch(() => null)
      }),
    )

    for (const plugin of batch) if (plugin !== null) found.push(plugin)
  }

  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/** A skill, agent or command file's first lines (and its frontmatter description), or null when it cannot be read. */
export async function readDoc(fs: ReaderFs, plugin: CatalogPlugin, kind: 'skill' | 'agent' | 'command', name: string): Promise<{ description: string; lines: string[] } | null> {
  if (!NAME.test(name) || plugin.dir === '') return null

  const path = kind === 'skill' ? `${plugin.dir}/skills/${name}/SKILL.md` : `${plugin.dir}/${kind === 'agent' ? 'agents' : 'commands'}/${name}.md`
  const stat = await fs.stat(path).catch(() => undefined)

  if (stat === undefined || (stat.size ?? 0) > DOC_BYTES) return null
  // A link, or anything but a plain file, is never read: its target may be outside the plugin and its text would be drawn and handed to the model (#3817).
  if (stat.isLink === true || (stat.kind !== undefined && stat.kind !== 'file')) return null

  const text = await fs.read(path).catch(() => null)

  if (text === null) return null

  const lines = text.split('\n').map(line => plain(line, 200))
  const description = lines.find(line => /^description:/i.test(line))?.replace(/^description:\s*/i, '').replace(/^["']|["']$/g, '') ?? ''

  return { description: plain(description, 200), lines: lines.slice(0, DOC_LINES) }
}

export type CatalogMode = 'all' | 'installed' | 'missing' | 'mods' | 'skills' | 'agents'

/** The plugins a mode and a filter word keep: the word matches a name, a description, or any skill/agent/command name. */
export function visible(all: readonly CatalogPlugin[], installed: ReadonlySet<string>, mode: CatalogMode, word: string): CatalogPlugin[] {
  const needle = word.trim().toLowerCase()

  return all.filter(plugin => {
    if (mode === 'installed' && !installed.has(plugin.name)) return false
    if (mode === 'missing' && installed.has(plugin.name)) return false
    if (mode === 'mods' && !plugin.isMod) return false
    if (mode === 'skills' && plugin.skills.length === 0) return false
    if (mode === 'agents' && plugin.agents.length === 0) return false

    return needle === '' || [plugin.name, plugin.description, ...plugin.skills, ...plugin.agents, ...plugin.commands].some(text => text.toLowerCase().includes(needle))
  })
}
