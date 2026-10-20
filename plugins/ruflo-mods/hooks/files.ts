import type { FsStat } from 'claude-code'

/**
 * The two `$.fs` calls a reader needs. The engine reads a module's `$` uses
 * off its source, so `$` itself never leaves a hook: the hook builds this
 * from `$.fs.stat` / `$.fs.read` spelled at the call site.
 */
export type FileHost = {
  readonly stat: (path: string) => Promise<FsStat>
  readonly read: (path: string) => Promise<string>
}

/** Under `$.fs.read`'s own 4 MiB bound, so an oversized file reads as too big. */
export const MAX_READ_BYTES = 4 * 1024 * 1024

export type Read<T> =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Only ENOENT is "missing" (`$.fs.stat` rejects ENOENT for a missing path).
 * Anything else is an error: for the guard that means failing closed, so a
 * loosely matched message must never read as "no policy here".
 */
export const isMissing = (error: unknown, path?: string) => {
  const message = String((error as Error)?.message ?? error)
  // The path a message quotes is the caller's own word, not the error: a project under ".../ENOENT-x/" is not missing.
  return /\bENOENT\b/.test(path ? message.split(path).join('') : message)
}

/**
 * A reader that parses a project file once per change: one `$.fs.stat` per
 * call, a `$.fs.read` and parse only when its size or mtime moved. Absent is
 * a value, not an error; anything else that fails is `error`, which a guard
 * fails closed on.
 *
 * @param pathOf the file's path, resolved per call (it follows the session root)
 * @param parse turns the text into the value; may throw
 */
export function cachedFile<T>(pathOf: () => string, parse: (text: string) => T) {
  let seen: { key: string; read: Read<T> } | undefined

  return async (fs: FileHost): Promise<Read<T>> => {
    const path = pathOf()
    let key: string
    try {
      const stat = await fs.stat(path)
      if (stat.kind !== 'file') return { kind: 'error', message: `${path} is not a file` }
      if (stat.size > MAX_READ_BYTES) return { kind: 'error', message: `${path} is over 4 MiB` }
      key = `${path}:${stat.size}:${stat.mtimeMs}`
    } catch (error) {
      seen = undefined
      return isMissing(error, path) ? { kind: 'absent' } : { kind: 'error', message: messageOf(error) }
    }
    if (seen?.key === key) return seen.read

    const read = await readAndParse(fs, path, parse)
    seen = { key, read }
    return read
  }
}

const messageOf = (error: unknown) => String((error as Error)?.message ?? error)

/**
 * Only the read may say "absent": a parse error's message can quote the file's
 * own text (JSON.parse does), so a corrupt file containing "ENOENT" must still
 * be an error and never read as "no file here".
 */
async function readAndParse<T>(fs: FileHost, path: string, parse: (text: string) => T): Promise<Read<T>> {
  let text: string
  try {
    text = await fs.read(path)
  } catch (error) {
    return isMissing(error, path) ? { kind: 'absent' } : { kind: 'error', message: messageOf(error) }
  }
  try {
    return { kind: 'ok', value: parse(text) }
  } catch (error) {
    return { kind: 'error', message: messageOf(error) }
  }
}
