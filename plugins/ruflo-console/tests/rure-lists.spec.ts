/**
 * ruRE long lists (ADR-496): a list that fits on one line stays one line (as before); a long one gets its own wrapped lines and a larger
 * (still hard) cap, since the result panel scrolls. The total line count never passes RE_MAX_LINES, whatever the file holds.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-lists
 */
import { describe, expect, it } from 'vitest'

import { RE_MAX_LINES, rureLines } from '../hooks/data/rure'

const many = (n: number, prefix = 'fn') => Array.from({ length: n }, (_, index) => `${prefix}_${index}`)
const binary = (extra: Record<string, unknown>) => rureLines('dt-re-bin', { success: true, format: 'elf', arch: 'x86-64', bits: 64, endianness: 'little', kind: 'exec', entryPoint: 4096, sections: [], libraries: [], imports: [], exports: [], strings: [], warnings: [], truncated: false, redactedCount: 0, screened: true, ...extra })

describe('long lists', () => {
  it('a short list is still one line', () => {
    expect(binary({ imports: ['puts', 'printf'] })).toContain('imports (2): puts, printf')
  })

  it('a long list wraps onto lines of its own, in order, with the total in the title', () => {
    const lines = binary({ imports: many(30) })
    const at = lines.findIndex(line => line === 'imports (30):')

    expect(at).toBeGreaterThan(-1)

    const body = lines.slice(at + 1).filter(line => line.startsWith('  '))

    expect(body.length).toBeGreaterThan(1)
    expect(body.every(line => line.length <= 110)).toBe(true)
    expect(body.join(' ')).toContain('fn_0, fn_1')
    expect(body.join(' ')).toContain('fn_29')
  })

  it('shows at most 60 items of a list and says how many it left out', () => {
    const lines = binary({ imports: many(500) })

    expect(lines.join('\n')).toContain('imports (500):')
    expect(lines.join('\n')).toContain('fn_59')
    expect(lines.join('\n')).not.toContain('fn_60,')
    expect(lines.join('\n')).toMatch(/… \+440/)
  })

  it('a hostile file cannot pass the total cap or the line width', () => {
    const lines = binary({ imports: many(5000), exports: many(5000, 'ex'), libraries: many(5000, 'lib'), strings: many(5000, 's').map(value => ({ value, offset: 1 })), sections: many(5000, 'sec').map(name => ({ name, offset: 1, size: 1 })) })

    expect(lines.length).toBeLessThanOrEqual(RE_MAX_LINES)
    expect(RE_MAX_LINES).toBe(120)
    expect(lines.every(line => line.length < 400)).toBe(true)
  })

  it('an item with an escape sequence is cleaned inside a wrapped list too', () => {
    const lines = binary({ imports: [...many(30), '\u001b[31mred\u001b]52;c;eA==\u0007'] })

    expect(lines.join('\n')).not.toMatch(/\u001b|\u0007/)
  })
})
