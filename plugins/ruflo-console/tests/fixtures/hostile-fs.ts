/** A fake reader fs over a path → text map; `link` paths stat as links, `kind` overrides what a path stats as. */
import type { ReaderFs } from '../../hooks/data/files'

export function readableFs(files: Record<string, string>, options: { link?: string[]; kind?: Record<string, string> } = {}): ReaderFs {
  return {
    read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
    stat: async path => {
      const text = files[path]

      if (text === undefined) throw new Error('ENOENT')

      return { mtimeMs: 1, size: text.length, kind: options.kind?.[path] ?? 'file', isLink: options.link?.includes(path) === true }
    },
    list: async () => [],
  }
}
