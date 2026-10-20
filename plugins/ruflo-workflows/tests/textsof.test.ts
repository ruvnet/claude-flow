import { describe, expect, test, tier } from 'claude-code/testing'

import { textsOf } from '../hooks/guard'
import { hasSecret } from '../hooks/screen'

tier('user')

const AWS = `AKIA${'IOSFODNN7EXAMPLE'}`
const BIG = 'QUJD'.repeat(10_000)
const found = (input: unknown) => textsOf(input).some(hasSecret)

describe('what the guard reads', () => {
  test('a key name leads its string value, so an object-shaped assignment is caught', () => {
    expect(found({ meta: { api_key: 'abcdef1234567890abcdef' } })).toBe(true)
    expect(found({ meta: { maxTokens: 4096, name: 'refresh policy' } })).toBe(false)
  })

  test('a long field does not starve the fields after it', () => {
    expect(found({ value: BIG, note: AWS })).toBe(true)
    expect(found({ a: BIG, b: BIG, c: BIG, d: 'plain text' })).toBe(false)
  })
})
