/**
 * The AgentDB mod's status file as the console reads it (ADR-445): the parser's shape checks, and the section the Memory page draws from it.
 *   npx vitest run plugins/ruflo-console/tests/agentdb-mod.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { parseAgentdbMod } from '../hooks/data/agentdb-mod'
import { PROJECT } from '../hooks/data/files'

const FILE = {
  version: 1,
  updatedMs: 1_700_000_000_000,
  recall: true,
  guard: true,
  source: 'auto',
  attached: 4,
  skipped: 2,
  cached: 1,
  timedOut: 1,
  dropped: 2,
  blocked: 3,
  errors: 0,
  lastMs: 41,
  lastTool: 'agentdb',
  recent: [{ atMs: 1, source: 'agentdb', score: 0.91, snippet: 'use HNSW above 5k vectors' }],
}

describe('parseAgentdbMod', () => {
  it('reads version 1 of the file', () => {
    expect(parseAgentdbMod(JSON.stringify(FILE))).toMatchObject({ recall: true, guard: true, attached: 4, dropped: 2, blocked: 3, lastMs: 41, tool: 'agentdb' })
    expect(parseAgentdbMod(JSON.stringify(FILE))?.recent).toEqual([{ source: 'agentdb', score: 0.91, snippet: 'use HNSW above 5k vectors' }])
  })

  it('refuses a shape it does not know, and junk', () => {
    expect(parseAgentdbMod(JSON.stringify({ ...FILE, version: 2 }))).toBeNull()
    expect(parseAgentdbMod('not json')).toBeNull()
    expect(parseAgentdbMod(null)).toBeNull()
    expect(parseAgentdbMod('[]')).toBeNull()
  })

  it('clamps counters and cuts long text; a negative or missing number is zero', () => {
    const parsed = parseAgentdbMod(JSON.stringify({ ...FILE, attached: -5, skipped: 'x', recent: [{ source: 's'.repeat(99), snippet: 'y'.repeat(999) }, { snippet: 4 }, 9] }))

    expect(parsed).toMatchObject({ attached: 0, skipped: 0 })
    expect(parsed?.recent).toHaveLength(1)
    expect(parsed?.recent[0]?.snippet).toHaveLength(120)
    expect(parsed?.recent[0]?.source).toHaveLength(24)
  })
})

describe('where the console looks', () => {
  it('reads the status file under the project, never outside it', () => {
    expect(PROJECT.agentdbMod).toBe('.claude-flow/agentdb-mod/status.json')
    expect(PROJECT.agentdbMod.startsWith('/')).toBe(false)
    expect(PROJECT.agentdbMod.includes('..')).toBe(false)
  })
})
