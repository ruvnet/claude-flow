/**
 * The Learning page's new actions under vitest: pretrain, consolidate and the pattern store run fixed argv through `mcp exec`, the
 * typed ones validate their text, and every entry is reachable headless (`/ruflo run nn-...`).
 */
import { describe, expect, it } from 'vitest'

import { neuralEntries, patternSearchSpec, patternStoreSpec } from '../hooks/neural'
import { pulseDue } from '../hooks/pulse'
import { newState } from '../hooks/state'

const param = (argv: readonly string[] | undefined): Record<string, unknown> => JSON.parse(argv?.[argv.indexOf('-p') + 1] ?? '{}') as Record<string, unknown>

describe('learning actions', () => {
  it('pretrain has three depths, each a fixed hooks_pretrain call that says it is local and writes the intelligence store', () => {
    const entries = neuralEntries(newState({}))

    for (const depth of ['shallow', 'medium', 'deep']) {
      const entry = entries.find(candidate => candidate.id === `nn-pretrain-${depth}`)

      expect(entry?.spec?.args.slice(0, 4)).toEqual(['mcp', 'exec', '-t', 'hooks_pretrain'])
      expect(param(entry?.spec?.args)).toEqual({ depth })
      expect(entry?.spec?.note).toContain('local')
      expect(entry?.spec?.note).toContain('writes')
    }
  })

  it('consolidate is the agentdb_consolidate tool with no options (it refuses any), and asks as a local write', () => {
    const entry = neuralEntries(newState({})).find(candidate => candidate.id === 'nn-consolidate')

    expect(entry?.spec?.args.slice(0, 4)).toEqual(['mcp', 'exec', '-t', 'agentdb_consolidate'])
    expect(param(entry?.spec?.args)).toEqual({})
    expect(entry?.spec?.isReadOnly).not.toBe(true)
  })

  it('pattern search is a read with the text as the query; pattern store is a local write; empty or flag-shaped text builds nothing', () => {
    const search = patternSearchSpec('auth tests after login')
    const store = patternStoreSpec('always run the auth tests after touching login')

    expect(search?.args.slice(0, 4)).toEqual(['mcp', 'exec', '-t', 'hooks_intelligence_pattern-search'])
    expect(param(search?.args)).toEqual({ query: 'auth tests after login', topK: 5 })
    expect(search?.isReadOnly).toBe(true)
    expect(store?.args.slice(0, 4)).toEqual(['mcp', 'exec', '-t', 'hooks_intelligence_pattern-store'])
    expect(param(store?.args)).toEqual({ pattern: 'always run the auth tests after touching login', type: 'general' })
    expect(store?.isReadOnly).not.toBe(true)
    expect(store?.note).toContain('ReasoningBank')

    for (const bad of ['', '   ', '--force']) {
      expect(patternSearchSpec(bad), bad).toBeNull()
      expect(patternStoreSpec(bad), bad).toBeNull()
    }
  })

  it('only the Learning page asks for a redraw, about every 350 ms, and not twice in one slot', () => {
    expect(pulseDue('overview', 10_000)).toBe(false)
    expect(pulseDue('learning', 10_000)).toBe(true)
    expect(pulseDue('learning', 10_100)).toBe(false)
    expect(pulseDue('learning', 10_400)).toBe(true)
  })

  it('both typed entries are listed for the palette, so /ruflo run nn-pattern-search <text> works headless', () => {
    const ids = neuralEntries(newState({})).map(entry => entry.id)

    expect(ids).toEqual(expect.arrayContaining(['nn-pattern-search', 'nn-pattern-store', 'nn-pretrain-medium', 'nn-consolidate']))
  })
})
