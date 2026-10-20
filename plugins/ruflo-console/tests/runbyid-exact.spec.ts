/** ADR-450 T13: a model-supplied id resolves only to the entry it names; the person's palette keeps its fuzzy convenience. */
import { describe, expect, it } from 'vitest'

import { callTool } from '../hooks/model-tools'
import { paletteEntries } from '../hooks/palette'
import { createRunner } from '../hooks/runner'
import { newState } from '../hooks/state'
import { settingsOf } from '../hooks/settings'
import type { Host } from '../hooks/host'
import type { ModelToolDeps } from '../hooks/model-tools'

function real(level: 'read' | 'write' | 'manage' | 'full' = 'full') {
  const runs: string[][] = []
  const host = { fs: {}, run: async (argv: readonly string[]) => (runs.push([...argv]), { exitCode: 0, stdout: '{"success":true}', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }), invalidate: () => undefined, after: () => ({ cancel: () => undefined, fire: () => undefined }) } as unknown as Host
  const state = newState({})

  Object.assign(settingsOf(state).ai, { modelControl: level, modelConfirm: 'ask' })

  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })
  const deps = { state, control: { host, setView: () => undefined, open: async () => undefined, actions: {}, runner } } as unknown as ModelToolDeps

  return { state, runner, runs, deps }
}

const NEAR_MISSES = ['mem-pattern-stor', 'MEM-PATTERN-STORE', ' mem-pattern-store extra', 'mem-pattern', 'store a pattern in memory']

describe('runById (ADR-450 T13)', () => {
  it('a person-facing run keeps the fuzzy fallback when text is given', () => {
    const { runner } = real()

    expect(runner.runById('MEM-PATTERN-STORE', 'jwt refresh')).toBe(true)
  })

  it('an exact run resolves the id as written, and only that', () => {
    const { runner, state } = real()
    const id = paletteEntries(state, Date.now()).find(entry => entry.run.kind === 'spec')?.id ?? ''

    expect(id).not.toBe('')
    expect(runner.runById(id, '', { exact: true })).toBe(true)
    expect(runner.runById(id.toUpperCase(), '', { exact: true })).toBe(id.toUpperCase() === id)
  })

  for (const id of NEAR_MISSES) {
    it(`an exact run refuses the near miss "${id}" even with text`, () => {
      const { runner, state } = real()

      expect(runner.runById(id, 'jwt refresh', { exact: true })).toBe(false)
      expect(state.pending).toBeNull()
    })
  }

  it('console_run passes exact, so a near miss with text runs nothing and the refusal lists no entries', async () => {
    const { deps, state, runs } = real()
    const answer = await callTool('console_run', { id: 'mem-pattern-stor', text: 'jwt refresh' }, deps)

    expect(answer).toMatch(/^Refused: .*no palette entry "mem-pattern-stor"/)
    expect(state.pending).toBeNull()
    expect(runs).toEqual([])
  })

  it('console_run of an exact text entry id still works and its confirm names that exact entry', async () => {
    const { deps, state } = real()
    const answer = await callTool('console_run', { id: 'mem-pattern-store', text: 'jwt refresh' }, deps)
    const entry = paletteEntries(state, Date.now()).find(candidate => candidate.id === 'mem-pattern-store')

    expect(entry).toBeDefined()
    expect(answer).toMatch(/^Waiting for the person to confirm/)
    expect(state.pending?.label).toBeTruthy()
  })
})
