import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { describe, expect, test, tier } from 'claude-code/testing'

import { segmentText, SEGMENT_MAX } from '../hooks/segment'

tier('user')

const ROOT = '/work'
const HOSTS = `${ROOT}/.claude-flow/ruos/hosts.json`
const START = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const
const prompt = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

/** A stand-in for ruflo-mods' `$.ruflo` noun that records each segment call. */
function fakeRuflo(calls: { id: string; text: string | null }[]): Plugin {
  return {
    name: 'fake-ruflo',
    tier: 'user',
    register: on => {
      on('engine.create', async ($, e, next) => {
        const beneath = await next(e)
        const added = { ruflo: { segment: async (input: { id: string; text: string | null }) => void calls.push(input) } }
        return { ...added, ...beneath }
      })
    },
  }
}

/** Project root and a file map beneath the mod, answered from memory. */
function world(on: On, files: Map<string, string>) {
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT: '${e.path}'` } : { value: text }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
}

const hosts = (...h: { name: string; agents: string[] }[]) =>
  JSON.stringify({ updatedAt: '2026-10-01T21:47:00.000Z', hosts: h.map((x, i) => ({ desktopId: `${i}`.repeat(32), ...x })) })

describe('ruflo-ruos segment', () => {
  test('segmentText: counts agents, names the first busy host, clears when idle', () => {
    expect(segmentText(undefined)).toBeNull()
    expect(segmentText('not json')).toBeNull()
    expect(segmentText(hosts({ name: 'Work Desktop', agents: [] }))).toBeNull()
    expect(segmentText(hosts({ name: 'Work Desktop', agents: ['a1'] }))).toBe('ruOS 1 agent · Work Desktop')
    expect(segmentText(hosts({ name: 'Idle', agents: [] }, { name: 'Work Desktop', agents: ['a', 'b'] }, { name: 'Lab', agents: ['c'] }))).toBe(
      'ruOS 3 agents · Work Desktop +1',
    )
    expect(segmentText(hosts({ name: 'Bad\u001b[31m‮Name', agents: ['a'] }))).toBe('ruOS 1 agent · Bad[31mName')
    expect(segmentText(hosts({ name: 'x'.repeat(100), agents: ['a'] }))?.length).toBe(SEGMENT_MAX)
  })

  test('sets the ruos segment from hosts.json and clears it when agents finish', async ($, on) => {
    const calls: { id: string; text: string | null }[] = []
    const files = new Map([[HOSTS, hosts({ name: 'Work Desktop', agents: ['ruos-r-1'] })]])
    world(on, files)
    fakeRuflo(calls).register(on, {})
    await $.session.start(START)
    files.set(HOSTS, hosts({ name: 'Work Desktop', agents: [] }))
    await $.prompt.submit(prompt('next'))
    expect(calls.filter(c => c.id === 'ruos').map(c => c.text)).toEqual(['ruOS 1 agent · Work Desktop', null])
  })

  test('without the ruflo mod the call rejects and nothing breaks', async ($, on) => {
    world(on, new Map([[HOSTS, hosts({ name: 'Work Desktop', agents: ['a'] })]]))
    await $.session.start(START)
    expect((await $.prompt.submit(prompt('hello'))).text).toBe('hello')
  })
})
