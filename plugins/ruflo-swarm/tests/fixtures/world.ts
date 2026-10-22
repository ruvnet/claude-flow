import type { On, RenderElement, RenderNode } from 'claude-code'

import { CWD } from './inputs'

/** One `$.process.run` the mod made, and what the world answers it with. */
export type Run = { argv: string[]; timeoutMs?: number }
export type Responder = (argv: readonly string[]) => { exitCode: number; stdout: string; stderr: string; write?: Record<string, string> } | { deny: string }

/**
 * The world beneath the mod, in memory: a file tree `$.fs` answers from, a process table `$.process.run` answers
 * from, and a record of everything the mod asked the engine to do.
 */
export type World = {
  files: Map<string, string>
  runs: Run[]
  opened: string[]
  closed: string[]
  toasts: string[]
  logs: string[]
  fills: string[]
  commands: string[]
  stored: Map<string, unknown>
  invalidations: number
  respond: Responder
  /** Writes a file as ruflo's CLI would, moving its mtime on. */
  put: (path: string, text: string) => void
}

const relOf = (path: string) => (path.startsWith(`${CWD}/`) ? path.slice(CWD.length + 1) : path)

export const exitOk = (stdout = ''): ReturnType<Responder> => ({ exitCode: 0, stdout, stderr: '' })

/** Seats the in-memory world beneath the plugin. `usage` is what `$.session.usage()` answers; null refuses it. */
export function worldOf(on: On, files: Readonly<Record<string, string>>, usage: unknown = { context: { tokens: 68_000, window: 200_000, percent: 34 }, rateLimits: [], cost: { usd: 0.4213 } }): World {
  let tick = 1_000
  const mtimes = new Map<string, number>(Object.keys(files).map(path => [path, tick]))

  const world: World = {
    files: new Map(Object.entries(files)),
    runs: [],
    opened: [],
    closed: [],
    toasts: [],
    logs: [],
    fills: [],
    commands: [],
    stored: new Map(),
    invalidations: 0,
    respond: () => exitOk(),
    put: (path, text) => {
      tick += 1_000
      world.files.set(path, text)
      mtimes.set(path, tick)
    },
  }

  on('fs.read', ($, e) => {
    const text = world.files.get(relOf(e.path))

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })

  on('fs.stat', ($, e) => {
    const text = world.files.get(relOf(e.path))

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: { kind: 'file' as const, size: text.length, mtimeMs: mtimes.get(relOf(e.path)) ?? 0, isLink: false } }
  })

  on('process.run', ($, e) => {
    world.runs.push({ argv: [...e.argv], ...(e.init?.timeoutMs !== undefined && { timeoutMs: e.init.timeoutMs }) })

    const answer = world.respond(e.argv)

    if ('deny' in answer) {
      return { deny: answer.deny }
    }

    for (const [path, text] of Object.entries(answer.write ?? {})) {
      world.put(path, text)
    }

    return { value: { exitCode: answer.exitCode, stdout: answer.stdout, stderr: answer.stderr } }
  })

  on('session.usage', () => (usage === null ? { deny: 'usage refused' } : { value: usage as never }))
  on('agent.list', () => ({ value: [] }))
  on('store.get', ($, e) => ({ value: world.stored.get(e.key) }))
  on('store.set', ($, e) => {
    world.stored.set(e.key, e.value)

    return { value: undefined }
  })

  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })

  on('ui.open', ($, e) => {
    world.opened.push(e.id)

    return { value: { isPlaced: true } } as never
  })

  on('ui.close', ($, e) => {
    world.closed.push(e.id)

    return { value: undefined }
  })

  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })

  on('ui.log', ($, e) => {
    world.logs.push(e.text)

    return { value: undefined }
  })

  on('ui.invalidate', () => {
    world.invalidations += 1

    return { value: undefined }
  })

  on('prompt.fill', ($, e) => {
    world.fills.push(e.text)

    return { isFilled: true }
  })

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return world
}

/** Every string a drawn tree holds, button labels included, in drawing order. */
export function stringsOf(node: RenderNode | RenderElement | null | undefined): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return []
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return [String(node)]
  }

  const props = (node as { props?: Record<string, unknown> }).props
  const own = node.type === 'Button' && typeof props?.label === 'string' ? [props.label] : []
  const children = (node as { children?: readonly RenderNode[] }).children ?? []

  return [...own, ...children.flatMap(child => stringsOf(child))]
}

export const textOf = (node: RenderNode | RenderElement | null | undefined): string => stringsOf(node).join('')

/** Every element of `type` in a drawn tree. */
export function elementsOf(node: RenderNode | RenderElement | null | undefined, type: string): RenderElement[] {
  if (node === null || node === undefined || typeof node !== 'object') {
    return []
  }

  const children = (node as { children?: readonly RenderNode[] }).children ?? []

  return [...(node.type === type ? [node as RenderElement] : []), ...children.flatMap(child => elementsOf(child, type))]
}

/** The `key`s of every Button drawn, in order. */
export const buttonKeysOf = (node: RenderNode | RenderElement | null | undefined): string[] =>
  elementsOf(node, 'Button').map(button => String((button as { key?: unknown; props?: { key?: unknown } }).key ?? (button as { props?: { key?: unknown } }).props?.key ?? ''))
