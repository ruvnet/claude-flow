/**
 * Folders outside the project that ruRE may read (ADR-499). The person names them in the plugin option `rureFolders` as
 * `name=/absolute/folder` pairs; a ruRE sample then reaches one as `@name` or `@name/sub/file`. Nothing else outside the project can be named:
 * not an absolute path, not `..`, and Claude cannot define a folder on its own (a plugin option change is install-class: Claude's console tools can only
 * propose it at the full control level, and it always waits for the person's Yes, which shows the folders).
 * The sample stays a plain relative-looking token until the preflight resolves it, so the field rule needs no knowledge of the option.
 * Leaf: pure functions; the host's `stat` is passed in. Nothing here runs a command.
 */
import type { ReaderFs } from './files'

/** The folders as the option holds them: alias -> absolute folder, no trailing slash. A null-prototype object, so an alias can be called anything. */
export type Folders = Readonly<Record<string, string>>

const ALIAS = /^[A-Za-z0-9_-]{1,32}$/
/** A POSIX folder or a Windows one with forward slashes: plain characters only (no spaces, no `~`, no `$`, no `..`). */
const FOLDER = /^(?:\/|[A-Za-z]:\/)[A-Za-z0-9._/-]{1,198}$/
const MAX_FOLDERS = 16

const isLinkKind = (kind: string | undefined): boolean => kind === 'symlink' || kind === 'link'
const isDir = (kind: string | undefined): boolean => kind === 'dir' || kind === 'directory'

/** A folder that is every file (`/`, `C:/`) or a system root is not a choice a typo should reach. */
const tooBroad = (path: string): boolean => path.replace(/^[A-Za-z]:/, '').split('/').filter(part => part !== '').length < 2

/**
 * The option's text (`docs=/data/samples; bins=/opt/vendor/bin`) as folders. A pair that breaks any rule is dropped, never repaired: a folder the
 * person meant but mistyped is then unknown, which refuses, where a repaired one could name a place they did not mean.
 */
export function parseFolders(raw: unknown): Folders {
  const out: Record<string, string> = Object.create(null) as Record<string, string>

  if (typeof raw !== 'string' || raw.length > 4000) return out

  for (const pair of raw.split(/[;\n]/)) {
    const at = pair.indexOf('=')

    if (at < 1) continue

    const alias = pair.slice(0, at).trim()
    const folder = pair.slice(at + 1).trim().replaceAll('\\', '/').replace(/\/+$/, '')

    if (!ALIAS.test(alias) || !FOLDER.test(folder) || tooBroad(folder)) continue
    if (folder.split('/').some(part => part === '..' || part === '.')) continue
    if (alias in out || Object.keys(out).length >= MAX_FOLDERS) continue

    out[alias] = folder
  }

  return out
}

/** A sample that names an allowed folder starts with `@`. */
export const isAliased = (sample: string): boolean => sample.startsWith('@')

/** The text rule for the part after `@`: `name` or `name/rel/path`, plain characters, no `..`, no empty part. */
export const aliasSampleOf = (text: string): string | null => {
  const value = text.trim()
  const match = /^@([A-Za-z0-9_-]{1,32})((?:\/[A-Za-z0-9._-]{1,100}){0,12})$/.exec(value)

  if (match === null || value.length > 160) return null

  return match[2]!.split('/').every(part => part !== '..' && part !== '.') ? value : null
}

/** What an aliased sample means: the allowed folder, the part below it, and the absolute path of both. Or why it means nothing. */
export function resolveAlias(sample: string, folders: Folders): { alias: string; root: string; rel: string; path: string } | { refuse: string } {
  const match = /^@([A-Za-z0-9_-]+)(\/.*)?$/.exec(sample)

  if (match === null) return { refuse: `${sample} is not a folder name this page knows` }

  const alias = match[1]!
  const root = folders[alias]

  if (root === undefined) {
    const known = Object.keys(folders)

    return { refuse: known.length === 0 ? `@${alias}: no outside folder is allowed. You can allow one in the ruflo-console option rureFolders (name=/folder); changing it always asks you first.` : `@${alias} is not one of your allowed folders (${known.map(name => `@${name}`).join(', ')})` }
  }

  const rel = (match[2] ?? '').replace(/^\/+/, '')

  return { alias, root, rel, path: rel === '' ? root : `${root}/${rel}` }
}

/**
 * `null` when the folder and everything below it down to the sample are real (not links), or the reason. The folder itself must be a folder and
 * not a link: a link there could lead anywhere the person never looked. A part that is not there is fine (the tool says "not found" itself);
 * a host that cannot stat answers like a missing part, so the check narrows what runs and never widens it.
 */
export async function foldersLinkCheck(fs: Pick<ReaderFs, 'stat'>, root: string, rel: string): Promise<string | null> {
  const top = await fs.stat(root).catch(() => undefined)

  if (top === undefined) return `${root} is not there: check the folder in rureFolders`
  if (top.isLink === true || isLinkKind(top.kind)) return `${root} is a link: name the real folder in rureFolders, because ruRE does not follow links`
  if (!isDir(top.kind)) return `${root} is not a folder`

  let at = root

  for (const part of rel.split('/').filter(piece => piece !== '')) {
    at = `${at}/${part}`

    const stat = await fs.stat(at).catch(() => undefined)

    if (stat === undefined) return null
    if (stat.isLink === true || isLinkKind(stat.kind)) return `${at} is a link: it could lead out of the allowed folder, so ruRE does not follow it`
  }

  return null
}
