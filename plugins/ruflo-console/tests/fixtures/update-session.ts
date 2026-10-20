import type { RunResult, UpdateDeps } from '../../hooks/update-flow'
import { INSTALLED_KEY, PLUGIN_ID } from '../../hooks/updates'

export const NOW = 1_800_000_000_000
export { INSTALLED_KEY, PLUGIN_ID }

/** A scripted session: what the store holds, what GitHub says, what the person picks, and how each command answers. */
export type Script = {
  mode?: UpdateDeps['mode'] extends () => infer M ? M : never
  store?: Record<string, unknown>
  manifest?: string | 'reject' | 'hang'
  published?: string
  choice?: string | 'reject'
  listed?: string[]
  isDev?: boolean
  interactive?: boolean
  marketExit?: number
  updateExit?: number
  updateOut?: string
  cwd?: string
}

export function session(script: Script = {}) {
  const store = new Map<string, unknown>(Object.entries(script.store ?? {}))
  let mode = script.mode ?? 'ask'
  const log = { fetches: 0, asked: [] as { question: string; options: readonly string[] }[], ran: [] as string[][], toasts: [] as string[], writes: [] as [string, unknown][] }
  const lists = [...(script.listed ?? [JSON.stringify([{ id: PLUGIN_ID, version: '0.26.0', scope: 'user', enabled: true }]), JSON.stringify([{ id: PLUGIN_ID, version: script.published ?? '0.27.0', scope: 'user', enabled: true }])])]
  const run = async (argv: readonly string[]): Promise<RunResult> => {
    log.ran.push([...argv])

    const text = argv.join(' ')

    if (text === 'claude plugin list --json') return { exitCode: 0, stdout: lists.length > 1 ? (lists.shift() as string) : (lists[0] as string), stderr: '' }
    if (text.startsWith('claude plugin marketplace update')) return { exitCode: script.marketExit ?? 0, stdout: 'updated', stderr: script.marketExit ? 'git: could not resolve host' : '' }

    return { exitCode: script.updateExit ?? 0, stdout: script.updateOut ?? 'updated', stderr: '' }
  }
  const deps: UpdateDeps = {
    nowMs: () => NOW,
    after: (_ms, fn) => {
      if (script.manifest === 'hang') fn()

      return { cancel: () => undefined } as never
    },
    local: '0.26.0',
    cwd: script.cwd ?? '/work/app',
    isInteractive: script.interactive ?? true,
    isDevCheckout: () => script.isDev ?? false,
    mode: () => mode,
    setMode: async next => {
      mode = next
      log.writes.push(['updates', next])
    },
    get: async key => store.get(key),
    set: async (key, value) => {
      store.set(key, value)
      log.writes.push([key, value])
    },
    fetchText: async () => {
      log.fetches++

      if (script.manifest === 'reject') throw new Error('network down')
      if (script.manifest === 'hang') return new Promise(() => undefined)

      return { ok: true, status: 200, text: script.manifest ?? JSON.stringify({ name: 'ruflo-console', version: script.published ?? '0.27.0' }) }
    },
    ask: async (question, options) => {
      log.asked.push({ question, options })

      if (script.choice === 'reject' || script.choice === undefined) throw new Error('dismissed')

      return script.choice
    },
    run,
    toast: text => void log.toasts.push(text),
  }

  return { deps, log, store, modeNow: () => mode }
}

