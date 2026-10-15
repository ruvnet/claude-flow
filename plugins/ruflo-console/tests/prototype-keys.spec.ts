/**
 * A mission state, task status, hive role, audit severity or plugin name that is spelled like an Object.prototype key (toString, constructor,
 * __proto__) draws as unknown, never as native code: every lookup that a file or the CLI can key is an own-key lookup.
 * Specs ported from PR #3822 (@proffesor-for-testing).
 */
import { describe, expect, it } from 'vitest'

import { severityOf } from '../hooks/data/cli'
import type { ReadCache, ReaderFs } from '../hooks/data/files'
import { parseMissions } from '../hooks/data/missions'
import { catalogOf } from '../hooks/plugin-catalog'
import { readSnapshot } from '../hooks/data/snapshot'
import { missionRow } from '../hooks/mission-list'
import { mcOf } from '../hooks/mission-control'
import { settingsOf, type PluginConfig } from '../hooks/settings'
import { newState } from '../hooks/state'
import type { Actions, Ctx } from '../hooks/views/common'
import { observationRows } from '../hooks/views/missions'
import { viewText } from '../hooks/views/pane'
import { HIVE_AGENTS, HIVE_FILES, WORKERS } from './fixtures/hive'

const act: Actions = (() => {
  const handler: ProxyHandler<() => void> = { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined }
  const proxy: unknown = new Proxy(() => undefined, handler)
  return proxy as Actions
})()

describe('a state, status, role or severity named for an Object.prototype key draws as unknown, never as native code', () => {
  const PROTO = ['toString', 'constructor', 'valueOf', '__proto__', 'hasOwnProperty']
  const NATIVE = /native code|function |\[object/
  const observation = (state: string, status: string) =>
    JSON.stringify({ schemaVersion: 1, contract: 'ruflo.mission-observation/1', observedAt: '2026-10-02T03:29:44.705Z', missions: [{ missionId: 'msn_proto', objective: 'prototype keys', state, revision: 1, plan: { revision: 1, taskCount: 1, tasks: [{ id: 't1', status }] }, evidence: { count: 0, verified: 0 } }] })
  /** Every color a rendered tree asks for. */
  const colorsOf = (node: unknown, out: unknown[] = []): unknown[] => {
    if (Array.isArray(node)) for (const child of node) colorsOf(child, out)
    else if (node !== null && typeof node === 'object') {
      const props = (node as { props?: Record<string, unknown> }).props ?? {}

      if ('color' in props) out.push(props.color)
      colorsOf(props.children, out)
    }

    return out
  }

  for (const key of PROTO) {
    it(`mission state and task status "${key}": the Missions list row, the record tab text and its colors`, () => {
      const parsed = parseMissions(observation(key, key))
      const mission = parsed?.missions[0]

      expect(mission).toBeDefined()
      expect(missionRow(mission as never, 0)).toMatch(/^○ prototype keys · /)

      const state = newState({})

      state.snapshot = { plugins: { installed: [] }, missions: parsed } as never
      mcOf(state).tab = 'record'
      const screen = viewText({ state, nowMs: 5_000, columns: 160, act }, 'missions')

      expect(screen).toContain('prototype keys')
      expect(screen).not.toMatch(NATIVE)
      expect(screen).toContain('plan rev 1: ? t1')

      const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never
      const ctx = { state, nowMs: 5_000, columns: 160, act, kit: { Box: element('Box'), Text: element('Text'), Button: element('Button') }, pictures: new Map() } as unknown as Ctx
      const colors = colorsOf(observationRows(ctx))

      expect(colors.length).toBeGreaterThan(0)
      expect(colors.filter(color => typeof color !== 'string')).toEqual([])
    })
  }

  it('a hive worker whose role in agents.json is "toString" draws with the plain worker glyph', async () => {
    const agents = { agents: { ...HIVE_AGENTS.agents, [WORKERS[0]]: { ...HIVE_AGENTS.agents[WORKERS[0]], config: { role: 'toString', hiveRole: 'toString' } } } }
    const files = Object.fromEntries(Object.entries({ ...HIVE_FILES, '.claude-flow/agents.json': JSON.stringify(agents) }).map(([path, text]) => [`/work/${path}`, text]))
    const fs: ReaderFs = {
      read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
      stat: async path => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
      list: async () => Promise.reject(new Error('ENOENT')),
    }
    const state = newState({})

    state.snapshot = await readSnapshot(fs, new Map() as ReadCache, '/work', '/home/dev', {}, 0)
    expect(state.snapshot.hiveAgents.find(agent => agent.id === WORKERS[0])?.role).toBe('toString')
    state.view = 'hive'
    const screen = viewText({ state, nowMs: Date.parse('2026-10-02T01:10:10.000Z'), columns: 160, act }, 'hive')
    const line = screen.split('\n').find(row => row.includes(WORKERS[0].slice(-4)) && row.includes('toString'))

    expect(screen).not.toMatch(NATIVE)
    expect(line, screen).toMatch(/●/)
  })

  it('an audit severity "constructor" ranks as no severity, not as a function', () => {
    expect(PROTO.map(severityOf)).toEqual([null, null, null, null, null])
    expect([severityOf('High'), severityOf('clean')]).toEqual([3, 0])
  })

  for (const name of ['constructor', 'toString']) {
    it(`Settings for a plugin named "${name}" draws its own option descriptions and its first four options`, () => {
      const state = newState({})
      const schema = Object.fromEntries(['name', 'length', 'c', 'd', 'e'].map(key => [key, { title: `${key} title`, description: `${key} described`, type: 'string' }]))

      state.snapshot = { plugins: { installed: [{ id: `${name}@ruflo`, name, marketplace: 'ruflo', version: '1.0.0', scope: 'user', installPath: '/p' }] } } as never
      catalogOf(state).plugins = [{ name, options: ['name'] }] as never
      settingsOf(state).plugin = name
      settingsOf(state).configs.set(name, { pluginId: `${name}@m`, name, schema, inputs: {}, choices: {}, configured: [] } as unknown as PluginConfig)
      state.view = 'settings'
      const screen = viewText({ state, nowMs: 5, columns: 160, act }, 'settings')

      expect(screen).toContain('name described')
      expect(screen).toContain('length described')
      expect(screen).not.toMatch(NATIVE)
      expect(screen).not.toMatch(/^\s+(Object|Function|1)\s*$/m)
    })
  }
})

