import { describe, expect, test, tier } from 'claude-code/testing'

import { holdsSecret, verdict } from '../hooks/guard'

tier('user')

// Secret-shaped values are assembled at run time so no literal sits in the source.
const rnd = (n: number, seed = 'q7Zk3Xp9Lm2Vb8Nc4Rt6Yw1Hs5Df0Jg') => seed.repeat(Math.ceil(n / seed.length)).slice(0, n)

describe('guard: a memory entry whose key mentions auth is an entry name, not a secret field', () => {
  test('issue #4202: notes keyed with hyphenated names are stored, whatever the key starts with', () => {
    expect(holdsSecret({ key: 'auth-flow-notes', value: 'getUser-not-getSession' })).toBe(false)
    expect(holdsSecret({ key: 'aps-refresh-window', value: 'rotate-55min-before-expiry' })).toBe(false)
    expect(holdsSecret({ key: 'token-refresh-notes', value: 'refresh-at-55-minutes' })).toBe(false)
  })

  test('a hyphen-named key does not excuse a value that holds a credential shape', () => {
    expect(verdict('mcp__x__agentdb_hierarchical-store', { key: 'auth-flow-notes', value: `Bearer ${rnd(40)}` })).toContain('secret')
    expect(verdict('mcp__x__agentdb_hierarchical-store', { key: 'auth-flow-notes', value: `ghp_${'a1B2'.repeat(10)}` })).toContain('secret')
    expect(verdict('mcp__x__agentdb_hierarchical-store', { key: 'notes', value: `sk_live_${'ABCD1234'.repeat(2)}` })).toContain('secret')
  })

  test('single-word credential keys keep blocking keyed literals', () => {
    expect(holdsSecret({ key: 'auth', value: rnd(32) })).toBe(true)
    expect(holdsSecret({ key: 'api_key', value: rnd(32) })).toBe(true)
  })
})
