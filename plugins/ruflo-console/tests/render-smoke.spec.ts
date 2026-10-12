/**
 * Every page draws, in both looks and at three widths, with an empty project and a busy one. Without the Claude Code test kit (the
 * kit tests need the host package), this runs each view's real code through `viewText`, the console's own text renderer, so a view that
 * calls a name it never imported, reads a field that is not there, or prints `undefined` fails here instead of when someone opens it.
 * (It exists because the Security page called `sentryRows` without importing it: nothing in the pure specs rendered that view.)
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/render-smoke.spec.ts
 */
import { afterAll, describe, expect, it } from 'vitest'

import type { ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { secMemo } from '../hooks/secure'
import { newState, VIEWS, type State } from '../hooks/state'
import { setLook, type Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import { RUFLO_FILES } from './fixtures/ruflo-run'

/** An `act` whose every property is itself, and callable: a view that reaches into it while drawing gets something, never a TypeError. */
const act: Actions = (() => {
  const handler: ProxyHandler<() => void> = { get: (_target, key) => (key === 'then' ? undefined : proxy), apply: () => undefined }
  const proxy: unknown = new Proxy(() => undefined, handler)

  return proxy as Actions
})()

const memoryFs = (files: Record<string, string>) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
})

/** A busy project: a read snapshot with agents, claims and tasks, spend, findings, an update on offer, a terminal run. */
async function busyState(): Promise<State> {
  const files = {
    ...Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text])),
    '/home/dev/.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/m/ruflo' } }),
    '/home/dev/m/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'ruflo-core' }, { name: 'ruflo-swarm' }] }),
  }
  const state = newState({})

  state.snapshot = await readSnapshot(memoryFs(files), new Map() as ReadCache, '/work', '/home/dev', {}, 0)
  state.usage = { costUsd: 19.81, contextPercent: 40 }
  state.updateAvailable = '0.27.0'
  state.events.push({ atMs: 1_000, kind: 'claims', text: 'claude: Bash' })
  secMemo(state).findings = { source: 'scan', counts: { critical: 1, high: 235, medium: 60, low: 0 }, atMs: 0 }
  state.terminal.runs.set('codex', { label: 'codex', startedAtMs: 0, stop: () => undefined })

  return state
}

const NOISE = /\[object Object\]|\bundefined\b|\bNaN\b/

afterAll(() => setLook('plain'))

describe('every page draws', () => {
  for (const look of ['bbs', 'plain'] as const) {
    for (const columns of [44, 60, 100, 160]) {
      it(`in the ${look} look at ${columns} columns, empty and busy`, async () => {
        setLook(look)

        const busy = await busyState()
        const problems: string[] = []

        for (const [name, state] of [['empty', newState({})], ['busy', busy]] as const) {
          for (const view of VIEWS) {
            state.view = view.id

            try {
              const text = viewText({ state, nowMs: 5_000, columns, act }, view.id)

              if (text.trim() === '') problems.push(`${name} ${view.id}: drew nothing`)
              else if (NOISE.test(text)) problems.push(`${name} ${view.id}: prints ${NOISE.exec(text)?.[0]}: ${(text.split('\n').find(line => NOISE.test(line)) ?? '').trim().slice(0, 90)}`)
            } catch (error) {
              problems.push(`${name} ${view.id}: threw ${error instanceof Error ? error.message : String(error)}`)
            }
          }
        }

        expect(problems).toEqual([])
      })
    }
  }
})
