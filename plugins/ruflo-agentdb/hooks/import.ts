import { holdsSecret, SECRET_REFUSAL } from './guard'
import { splitName } from './tools'

/** The most a `memory_import` file may weigh for the guard to read it; past this the import goes through unread. */
export const IMPORT_MAX_BYTES = 1_000_000

/** Whether `name` is `memory_import`, bare or under any MCP server prefix. */
export const isImport = (name: string) => (splitName(name)?.tool ?? name) === 'memory_import'

/** `path` as an absolute, normalised path when it sits under `base`, else undefined. Pure string work: no `..`, no backslash, no null byte. */
function inside(path: string, base: string | undefined): string | undefined {
  if (base === undefined || !base.startsWith('/')) return undefined
  const root = base.replace(/\/+$/, '')
  const parts = (path.startsWith('/') ? path : `${root}/${path}`).split('/').filter(p => p !== '' && p !== '.')
  const full = `/${parts.join('/')}`
  return root !== '' && full.startsWith(`${root}/`) ? full : undefined
}

/**
 * The file a `memory_import` call would read, as an absolute path the guard may read: a string `inputPath` with no null byte, backslash or `..`
 * segment, under the project root or the user's home. Anything else is undefined (not read). Symlinks are not resolved: the file API has no way to.
 */
export function importPath(input: unknown, root: string | undefined, home: string | undefined): string | undefined {
  const raw = typeof input === 'object' && input !== null ? (input as { inputPath?: unknown }).inputPath : undefined
  if (typeof raw !== 'string' || raw === '' || raw.length > 4096 || /[\0\\]/.test(raw) || raw.split('/').includes('..')) return undefined
  return inside(raw, root) ?? inside(raw, home)
}

/** The refusal when the imported file's text holds a secret, else undefined. A JSON file is read as its values (so name/value pairs are judged together), anything else as text. */
export function importVerdict(text: string): string | undefined {
  let value: unknown = text
  try {
    value = JSON.parse(text)
  } catch {
    /* not JSON: screen the raw text */
  }
  return holdsSecret(value) ? SECRET_REFUSAL : undefined
}

/** What the guard needs of a file system: `$.fs.stat` and `$.fs.read`, spelled at the call site. */
export type ImportFiles = {
  readonly stat: (path: string) => Promise<{ readonly kind: string; readonly size: number }>
  readonly read: (path: string) => Promise<string>
}

/** Stats first, reads only a regular file within the bound; undefined (fail open) on any error, a directory or an oversize file. */
export async function readImport(files: ImportFiles, path: string): Promise<string | undefined> {
  try {
    const stat = await files.stat(path)
    if (stat.kind !== 'file' || stat.size > IMPORT_MAX_BYTES) return undefined
    return await files.read(path)
  } catch {
    return undefined
  }
}
