/** A real controller, runner, palette and `callTool` over a fake host: the host only records what it was asked (store, commands, prompts). */
import { createController } from '../../hooks/controller'
import type { Host } from '../../hooks/host'
import type { ModelToolDeps } from '../../hooks/model-tools'
import { newState } from '../../hooks/state'

export type RunAnswer = { exitCode: number; stdout: string; stderr: string }

export type RigOptions = {
  store?: Record<string, unknown>
  /** What `host.run` answers for an argv (default: exit 0, empty). */
  run?: (argv: readonly string[]) => RunAnswer | Promise<RunAnswer>
  files?: Record<string, string>
  /** What a spawned process prints (a stream of stdout lines); default: nothing. */
  spawn?: (argv: readonly string[]) => readonly string[]
}

export function rig(options: RigOptions = {}) {
  const store = new Map<string, unknown>(Object.entries(options.store ?? {}))
  const seen = { runs: [] as string[][], prompts: [] as string[], slashes: [] as string[], stores: [] as [string, unknown][] }
  const state = newState({})
  const timers: (() => void)[] = []
  const host = new Proxy({}, {
    get: (_target, key) => {
      switch (key) {
        case 'storeGet': return async (name: string) => store.get(name)
        case 'storeSet': return async (name: string, value: unknown) => void (seen.stores.push([name, structuredClone(value)]), store.set(name, structuredClone(value)))
        case 'run': return async (argv: readonly string[]) => (seen.runs.push([...argv]), options.run === undefined ? { exitCode: 0, stdout: '', stderr: '' } : options.run(argv))
        case 'submitPrompt': return async (text: string) => void seen.prompts.push(text)
        case 'runSlash': return async (command: string, args: string) => void seen.slashes.push(`${command} ${args}`)
        case 'fillPrompt': return async () => true
        case 'after': return (_ms: number, fn: () => void) => { timers.push(fn); return { cancel: () => undefined } }
        case 'every': return () => ({ cancel: () => undefined })
        case 'invalidate': case 'toast': case 'scrollTop': case 'blit': return () => undefined
        case 'spawn': return (argv: readonly string[]) => {
          const lines = options.spawn?.(argv) ?? []

          return {
            [Symbol.asyncIterator]: async function* () { for (const text of lines) yield { stream: 'stdout' as const, text: `${text}\n` } },
            result: Promise.resolve({ code: 0, signal: null }),
            return: async () => undefined,
          }
        }
        case 'pluginRoot': return '/plugin'
        case 'fs': return {
          read: async (path: string) => options.files?.[path] ?? Promise.reject(new Error('ENOENT')),
          stat: async () => Promise.reject(new Error('ENOENT')),
          list: async () => Promise.reject(new Error('ENOENT')),
        }
        case 'rufloSnapshot': case 'rufloRoute': return async () => Promise.reject(new Error('none'))
        default: return async () => undefined
      }
    },
  }) as unknown as Host
  const control = createController(state, host)

  return { state, control, host, store, seen, /** Runs (and clears) every `host.after` callback now. */ fireTimers: () => { for (const fn of timers.splice(0)) fn() }, timers, deps: { state, control } as unknown as ModelToolDeps }
}
