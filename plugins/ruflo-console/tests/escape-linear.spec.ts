/**
 * Stripping escape sequences is linear: a megabyte of unterminated OSC introducers (7-bit and C1), CSI introducers with no final byte and
 * mixes of them cleans in milliseconds, not seconds. The old pattern rescanned to the end of the text from every unterminated introducer
 * (7.7 s against a 1 s bound). An unterminated OSC swallows to the next introducer or the end, as a terminal does.
 * Timing bound ported in spirit from PR #3821 (@proffesor-for-testing).
 */
import { describe, expect, it } from 'vitest'

import { ESCAPES, plain } from '../hooks/data/parse'
import { termText } from '../hooks/harness'
import { modelLine } from '../hooks/model-tools'
import { firstLine } from '../hooks/updates'

const MEGABYTE = 1_000_000
const SHAPES: Record<string, string> = {
  'C1 OSC introducers': '\u009d'.repeat(MEGABYTE),
  'C1 OSC introducers between text': `x${'\u009d]'.repeat(MEGABYTE / 2)}`,
  '7-bit OSC introducers': '\u001b]'.repeat(MEGABYTE / 2),
  '7-bit OSC with a body': '\u001b]a'.repeat(MEGABYTE / 3),
  'CSI introducers': '\u001b['.repeat(MEGABYTE / 2),
  'CSI with digits and no final byte': '\u001b[1'.repeat(MEGABYTE / 3),
  'C1 CSI with parameters': '\u009b;;;'.repeat(MEGABYTE / 4),
  'one CSI and a megabyte of parameters': `\u001b[${';'.repeat(MEGABYTE)}`,
  'both OSC forms mixed': '\u009dab\u001b]cd'.repeat(MEGABYTE / 6),
  'C1 OSC then escape bytes': `\u009d${'a\u001b'.repeat(MEGABYTE / 2)}`,
}
const BOUND_MS = 1_000
const SMALL = 20_000
const SMALL_BOUND_MS = 250

describe('escape stripping is linear on a megabyte of hostile input', () => {
  for (const [name, input] of Object.entries(SHAPES)) {
    it(name, () => {
      const clean = (text: string) => {
        const started = Date.now()

        text.replace(ESCAPES, '')
        plain(text, 200)
        termText(text)
        modelLine(text, 200)
        firstLine(text)

        return Date.now() - started
      }

      // A quadratic pattern fails on the small input at once, instead of hanging the run on the megabyte one.
      expect(clean(input.slice(0, SMALL))).toBeLessThan(SMALL_BOUND_MS)
      expect(clean(input)).toBeLessThan(BOUND_MS)
    })
  }

  it('terminated sequences still go whole, and visible text stays', () => {
    expect('a\u001b]8;;http://x\u0007LINK\u001b]8;;\u0007b'.replace(ESCAPES, '')).toBe('aLINKb')
    expect('a\u009d52;c;ZZ\u009cb\u001b]0;t\u001b\\c'.replace(ESCAPES, '')).toBe('abc')
    expect('\u001b[31mred\u001b[0m \u009b1mbold'.replace(ESCAPES, '')).toBe('red bold')
  })

  it('an unterminated OSC ends at the next introducer or the end of the text', () => {
    expect('keep\u001b]0;title\u001b[1mbold'.replace(ESCAPES, '')).toBe('keepbold')
    expect('keep\u001b]0;title with no end'.replace(ESCAPES, '')).toBe('keep')
  })
})
