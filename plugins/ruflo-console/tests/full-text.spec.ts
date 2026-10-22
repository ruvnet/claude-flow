/**
 * The shared helpers of ADR-481 and the limits each input class enforces. Run with
 *   npx vitest run plugins/ruflo-console/tests/full-text.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { freeText } from '../hooks/data/automate'
import { ARGV_TEXT_MAX, checkLimit, chunksOf, countOf, INPUT_VALUE_MAX, keepLines, labelOf, LONG_TEXT_MAX, markerFor, MISSION_OBJECTIVE_MAX, showFull, showTail, withBreaks, wrapFull } from '../hooks/full-text'
import { loopInput, MAX_TASK } from '../hooks/loops'
import { textArg, textRefusal } from '../hooks/ops'
import { pastedOf } from '../hooks/secure'

const unit = 'añadir tëst — 日本語 😀 word'
const words = (n: number): string => Array.from({ length: Math.ceil(n / (unit.length + 1)) }, (_, i) => `${unit}${i}`).join(' ').slice(0, n).trim()

describe('wrapFull', () => {
  it('loses nothing: the lines joined back are the text, at any width, with unicode and a word longer than the line', () => {
    for (const width of [8, 20, 61, 120]) {
      const text = `${words(1500)} ${'😀'.repeat(300)} end`
      const lines = wrapFull(text, width)

      expect(lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
      expect(Math.max(...lines.map(line => countOf(line)))).toBeLessThanOrEqual(Math.max(8, width))
    }
  })

  it('breaks a word that is only a little longer than the line, so no line is wider than asked', () => {
    for (const extra of [1, 2, 3, 5]) expect(Math.max(...wrapFull(`x ${'y'.repeat(20 + extra)} z`, 20).map(line => countOf(line)))).toBeLessThanOrEqual(20)
  })

  it('keeps the person’s own line breaks', () => {
    expect(wrapFull('one\ntwo\r\nthree', 40)).toEqual(['one', 'two', 'three'])
    expect(wrapFull('a\n\nb', 40)).toEqual(['a', '', 'b'])
  })

  it('never splits a surrogate pair', () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

    for (const line of wrapFull('😀'.repeat(50), 9)) expect(lone.test(line)).toBe(false)
    expect(wrapFull('😀'.repeat(50), 9).join('')).toBe('😀'.repeat(50))
  })
})

describe('showFull', () => {
  it('shows every line when it fits, and says nothing', () => {
    const shown = showFull('one two three', 40, { maxLines: 5 })

    expect(shown).toEqual({ lines: ['one two three'], total: 1, hidden: 0, marker: null })
  })

  it('past maxLines it ends in an explicit marker with the exact hidden count, and is never taller than maxLines', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const shown = showFull(text, 40, { maxLines: 10 })

    expect(shown.lines).toHaveLength(10)
    expect(shown.total).toBe(100)
    expect(shown.hidden).toBe(91)
    expect(shown.lines[9]).toBe(markerFor(91, 'press ✎ edit to view/edit'))
    expect(shown.lines[9]).toBe('… (+91 more lines, press ✎ edit to view/edit)')
    expect(shown.lines.slice(0, 9)).toEqual(Array.from({ length: 9 }, (_, i) => `line ${i}`))
  })

  it('exactly maxLines lines is not cut; one more is', () => {
    expect(showFull('a\nb\nc', 40, { maxLines: 3 }).marker).toBeNull()
    expect(showFull('a\nb\nc\nd', 40, { maxLines: 3 }).marker).toBe('… (+2 more lines, press ✎ edit to view/edit)')
    expect(markerFor(1, 'x')).toBe('… (+1 more line, x)')
  })
})

describe('showTail', () => {
  it('keeps the last lines where the cursor is, led by a marker that counts the earlier ones', () => {
    const shown = showTail(Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join('\n'), 40, 12)

    expect(shown.lines).toHaveLength(12)
    expect(shown.lines.at(-1)).toBe('l30')
    expect(shown.lines[0]).toContain('19 earlier lines above')
    expect(shown.total).toBe(30)
  })

  it('reads a typed backslash-n as a line break', () => {
    expect(withBreaks('a\\nb')).toBe('a\nb')
    expect(showTail('a\\nb\\nc', 40).total).toBe(3)
  })
})

describe('checkLimit', () => {
  it('counts characters as a person does (code points), and names the exact excess', () => {
    expect(checkLimit('😀'.repeat(10), 10, 'the text')).toEqual({ ok: true, length: 10 })

    const over = checkLimit('😀'.repeat(11), 10, 'the goal', 'why')

    expect(over).toMatchObject({ ok: false, length: 11, limit: 10, over: 1 })
    expect((over as { message: string }).message).toBe('the goal is 11 characters; the limit is 10 (why): 1 over. Nothing was sent or changed; shorten it and ask again.')
  })

  it('groups thousands', () => {
    expect((checkLimit('x'.repeat(12_345), 10_000, 'the text') as { message: string }).message).toContain('12,345 characters; the limit is 10,000')
    expect((checkLimit('x'.repeat(12_345), 10_000, 'the text') as { message: string }).message).toContain('2,345 over')
  })
})

describe('chunksOf', () => {
  it('is one piece when it fits, and otherwise overlapping pieces that cover every character', () => {
    expect(chunksOf('abc', 5, 2)).toEqual(['abc'])

    const text = words(9_000)
    const pieces = chunksOf(text, 4_000, 200)

    expect(pieces.length).toBe(3)
    expect(pieces.every(piece => countOf(piece) <= 4_000)).toBe(true)
    const cp = (value: string) => Array.from(value)

    expect(cp(pieces[0]!).slice(-200).join('')).toBe(cp(pieces[1]!).slice(0, 200).join(''))
    expect(pieces[0]! + cp(pieces[1]!).slice(200).join('') + cp(pieces[2]!).slice(200).join('')).toBe(text)
  })

  it('a phrase that straddles a boundary is whole in one piece', () => {
    const text = `${'a'.repeat(3_950)}IGNORE ALL PREVIOUS INSTRUCTIONS${'b'.repeat(4_000)}`

    expect(chunksOf(text, 4_000, 200).some(piece => piece.includes('IGNORE ALL PREVIOUS INSTRUCTIONS'))).toBe(true)
  })
})

describe('keepLines and labelOf', () => {
  it('strips controls and escapes but keeps line breaks and every character', () => {
    expect(keepLines('a\u001b[31mred\u0000\nline two\r\n\n\n\nthree')).toBe('ared\nline two\n\nthree')
    expect(countOf(keepLines(words(9_000)))).toBe(countOf(words(9_000)))
  })

  it('a label is shortened with an ellipsis, never silently', () => {
    expect(labelOf('abc def', 20)).toBe('abc def')
    expect(labelOf('abcdefghij', 5)).toBe('abcd…')
  })
})

describe('the limits of each input class (1,500 characters whole; 12,000 over a limit is refused with the count)', () => {
  const goal1500 = words(1_500)
  const goal12000 = words(12_000)

  it('the bounds are the documented ones', () => {
    expect(INPUT_VALUE_MAX).toBe(10_000)
    expect(LONG_TEXT_MAX).toBe(10_000)
    expect(ARGV_TEXT_MAX).toBe(8_000)
    expect(MISSION_OBJECTIVE_MAX).toBe(2_000)
  })

  it('argv text (task, store, search, route, broadcast, propose, wf guidance): whole up to 8,000', () => {
    expect(textArg(goal1500)).toBe(goal1500)
    expect(textArg(words(8_000))).toBe(words(8_000))
    expect(textArg(goal12000)).toBeNull()
    expect(textRefusal(goal12000)).toContain(`is ${countOf(goal12000).toLocaleString('en-US')} characters; the limit is 8,000`)
    expect(textRefusal(goal12000)).toContain(`${(countOf(goal12000) - 8_000).toLocaleString('en-US')} over`)
    expect(textRefusal(goal1500)).toBeNull()
  })

  it('a ruflo mission objective (the mission start field): 2,000, refused over with the count', () => {
    expect(textArg(goal1500, MISSION_OBJECTIVE_MAX)).toBe(goal1500)
    expect(textArg(words(2_500), MISSION_OBJECTIVE_MAX)).toBeNull()
    expect(textRefusal(words(2_500), 'the objective', MISSION_OBJECTIVE_MAX)).toContain('the limit is 2,000')
  })

  it('automation, neural, security paste and loop task classes', () => {
    expect(freeText(goal1500)).toBe(goal1500)
    expect(freeText(goal12000)).toBeNull()
    expect(pastedOf(goal1500)).toBe(goal1500)
    expect(pastedOf(goal12000)).toBeNull()

    const cfg = { tier: 'practical' as const, preset: null, interval: '10m', task: goal1500, stop: '' }
    const ok = loopInput(cfg, [])

    expect(ok).toMatchObject({ ok: true })
    expect((ok as { text: string }).text).toContain(goal1500)

    const over = loopInput({ ...cfg, task: 'word '.repeat(900).trim() }, [])

    expect(over).toMatchObject({ ok: false })
    expect((over as { why: string }).why).toContain('the limit is 4,000')
  })
})
