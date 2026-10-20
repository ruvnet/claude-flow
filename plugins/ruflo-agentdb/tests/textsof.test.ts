import { describe, expect, test, tier } from 'claude-code/testing'

import { hasSecret, textsOf } from '../hooks/screen'

tier('user')

const AWS = `AKIA${'IOSFODNN7EXAMPLE'}`
const found = (input: unknown) => textsOf(input).some(hasSecret)
const nest = (leaf: unknown, depth: number) => {
  let v = leaf
  for (let i = 0; i < depth; i++) v = { c: [v] }
  return v
}

describe('the shared walker every guard reads through', () => {
  test('a secret nested 5000 levels deep is found, without overflowing the stack', () => {
    expect(found(nest({ note: AWS }, 5000))).toBe(true)
    expect(found(nest('plain text', 5000))).toBe(false)
  })

  test('an object with 100 000 keys is bounded, and a secret among the first slots is still found', () => {
    const wide: Record<string, unknown> = { first: AWS }
    for (let i = 0; i < 100_000; i++) wide[`field${i}`] = i
    const started = performance.now()
    const texts = textsOf(wide)
    expect(performance.now() - started).toBeLessThan(500)
    expect(texts.length).toBeLessThanOrEqual(20_001) // the walked texts and the truncation marker
    expect(texts.some(hasSecret)).toBe(true)
  })

  test('a secret that is only an object key is read', () => {
    expect(found({ [AWS]: { ok: 1 } })).toBe(true)
    expect(found({ [AWS]: 'v' })).toBe(true)
    expect(found({ short: { ok: 1 } })).toBe(false)
  })

  test('a secret in the middle or at the end of a 1 MB string is found', () => {
    const pad = 'lorem ipsum dolor '.repeat(29_000)
    expect(found({ value: `${pad} ${AWS} ${pad}` })).toBe(true)
    expect(found({ value: `${pad}${pad} ${AWS}` })).toBe(true)
    expect(found({ value: pad + pad })).toBe(false)
  })

  test('a secret split by a soft hyphen, a bidi isolate or a Mongolian vowel separator is found', () => {
    for (const mark of ['­', '⁦', '⁩', '᠎']) expect(found({ value: `${AWS.slice(0, 8)}${mark}${AWS.slice(8)}` })).toBe(true)
  })

  test('the 201st array element and the 25 KB-padded tail are read', () => {
    expect(found({ list: [...Array.from({ length: 200 }, () => 'x'), AWS] })).toBe(true)
    expect(found({ value: `${'y'.repeat(25_000)} ${AWS}` })).toBe(true)
  })

  test('siblings are visited before depth, so a wide list cannot hide a shallow value behind deep ones', () => {
    const deep = nest('plain', 50)
    expect(found({ a: Array.from({ length: 300 }, () => deep), b: { note: AWS } })).toBe(true)
  })

  test('limits bound the work: a node budget of 2 stops the walk', () => {
    expect(textsOf({ a: 'one', b: 'two', c: 'three' }, { nodes: 2 }).length).toBeLessThanOrEqual(3) // two texts and the truncation marker
  })
})
