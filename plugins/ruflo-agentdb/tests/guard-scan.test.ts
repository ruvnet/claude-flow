import { describe, expect, test, tier } from 'claude-code/testing'

import { verdict } from '../hooks/guard'

tier('user')

const TOKEN = 'Zq8vT3mK9wX2LpR7sNd4'
const refused = (input: unknown) => verdict('memory_store', input) !== undefined

describe('the memory write guard reads what the walker cannot', () => {
  test('a name field and a value field holding a credential are judged together', () => {
    expect(refused({ key: 'api_key', value: TOKEN })).toBe(true)
    expect(refused({ name: 'password', content: TOKEN })).toBe(true)
    expect(refused({ entries: [{ field: 'secret', data: TOKEN }] })).toBe(true)
  })

  test('a [name, value] pair is judged together', () => {
    expect(refused({ rows: [['token', TOKEN]] })).toBe(true)
  })

  test('the same shapes with ordinary values go through', () => {
    expect(refused({ key: 'api_key', value: 'see the vault entry for the billing service' })).toBe(false)
    expect(refused({ key: 'project', value: TOKEN })).toBe(false)
    expect(refused({ rows: [['title', 'weekly notes']] })).toBe(false)
  })

  test('an input past the node budget is refused, not half read', () => {
    const reason = verdict('memory_store', { list: Array.from({ length: 25_000 }, () => 1) })
    expect(reason).toContain('too large to screen')
    expect(reason).not.toContain(TOKEN)
  })

  test('an input past the character budget is refused', () => {
    expect(refused({ a: 'p'.repeat(1_400_000), b: 'p'.repeat(1_400_000) })).toBe(true)
  })

  test('a large input under both budgets still goes through', () => {
    expect(refused({ a: 'lorem '.repeat(50_000), list: Array.from({ length: 5_000 }, () => 'x') })).toBe(false)
  })

  test('a tool that is not a writer is never judged', () => {
    expect(verdict('memory_search', { key: 'api_key', value: TOKEN })).toBeUndefined()
  })
})

describe('the write-capable tools found by checking the registry schemas are guarded', () => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['agentdb_feedback', { taskId: 't1', patterns: [`api_key=${TOKEN}`] }],
    ['agentdb_session-end', { sessionId: 's1', summary: `deploy used password=${TOKEN}` }],
    ['hive-mind_memory', { action: 'set', key: 'creds', value: { token: TOKEN } }],
    ['session_save', { name: 'work', description: `secret: ${TOKEN}` }],
  ]
  for (const [tool, input] of cases) {
    test(`${tool} is refused with a secret and passes without one`, () => {
      expect(verdict(tool, input)).toMatch(/secret/)
      expect(verdict(`mcp__ruflo__${tool}`, input)).toMatch(/secret/)
      expect(verdict(tool, JSON.parse(JSON.stringify(input).replaceAll(TOKEN, 'see the vault')))).toBeUndefined()
    })
  }

  test('tools that take no free text stay unguarded', () => {
    for (const tool of ['memory_import', 'rvf_ingest', 'hooks_compress_store']) expect(verdict(tool, { value: `api_key=${TOKEN}` })).toBeUndefined()
  })
})
