import type { On } from 'claude-code'

/**
 * The world beneath the mod, answered from memory: a project at /work, a
 * file map, settings, the environment (read and written), and what the mod
 * drew. Each noun is answered with `{ value }` as the engine's own ops are.
 */
export type World = {
  readonly files: Map<string, string>
  readonly dirs: Set<string>
  readonly env: Map<string, string>
  readonly statuses: (string | undefined)[]
  readonly logs: string[]
  readonly commands: string[]
}

export const ROOT = '/work'
export const HELPER = `${ROOT}/.claude/helpers/hook-handler.cjs`

export function world(on: On, settings: unknown = {}, files: Record<string, string> = {}): World {
  const w: World = { files: new Map(Object.entries(files)), dirs: new Set([ROOT, `${ROOT}/.claude-flow`]), env: new Map(), statuses: [], logs: [], commands: [] }

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('settings.read', () => ({ value: settings as never }))
  on('env.get', ($, e) => ({ value: w.env.get(e.name) }))
  on('env.set', ($, e) => {
    if (e.value === undefined) w.env.delete(e.name)
    else w.env.set(e.name, e.value)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: w.files.has(e.path) || w.dirs.has(e.path) }))
  on('fs.stat', ($, e) => {
    const text = w.files.get(e.path)
    if (text === undefined && w.dirs.has(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }
    if (text === undefined) return { deny: `ENOENT: no such file or directory, '${e.path}'` }
    return { value: { kind: 'file', size: text.length, mtimeMs: text.length, isLink: false } }
  })
  on('fs.read', ($, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) return { deny: `ENOENT: no such file or directory, '${e.path}'` }
    return { value: text }
  })
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => {
    w.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.status', ($, e) => {
    w.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  return w
}

export const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const

/** A prompt the person typed and sent. */
export const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const
