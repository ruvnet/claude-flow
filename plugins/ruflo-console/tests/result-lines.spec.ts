/** The result lines are tidied before a view draws them: ASCII tables are drawn again with aligned columns, nothing else is rewritten. */
import { describe, expect, it } from 'vitest'

import { plainMarkdown, prettyLines } from '../hooks/result-lines'

const PASTED = [
  'Pattern Optimization (Real)',
  'Quantized 349 pattern embeddings to Int8',
  '+-----------------+-----------+--------------+',
  '| Metric | Before | After |',
  '+-----------------+-----------+--------------+',
  '| Pattern Count | 349 | 349 |',
  '| Quantized | - | 349 |',
  '| Storage Size | 3751.9 KB | 3751.9 KB |',
  '| Reduction Ratio | - | 1.00x |',
  '| Precision | Float32 | Int8 (±0.5%) |',
  '+-----------------+-----------+--------------+',
]

describe('prettyLines', () => {
  it('draws the pasted CLI table with aligned columns and a header rule', () => {
    const out = prettyLines(PASTED)

    expect(out.slice(0, 2)).toEqual(['Pattern Optimization (Real)', 'Quantized 349 pattern embeddings to Int8'])
    expect(out[2]).toBe('┌─────────────────┬───────────┬──────────────┐')
    expect(out[3]).toBe('│ Metric          │ Before    │ After        │')
    expect(out[4]).toBe('├─────────────────┼───────────┼──────────────┤')
    expect(out[5]).toBe('│ Pattern Count   │ 349       │ 349          │')
    expect(out.at(-1)).toBe('└─────────────────┴───────────┴──────────────┘')
    expect(new Set(out.slice(2).map(line => line.length)).size).toBe(1)
  })

  it('leaves ordinary lines alone, trims trailing space and collapses runs of blank lines', () => {
    expect(prettyLines(['a  ', '', '', '', 'b', ''])).toEqual(['a', '', 'b'])
    expect(prettyLines([])).toEqual([])
  })

  it('does not touch a block it cannot read as a table (one row, ragged, or no columns)', () => {
    const ragged = ['| a | b |', '| c |']
    const single = ['| only | one |']

    expect(prettyLines(ragged)).toEqual(ragged)
    expect(prettyLines(single)).toEqual(single)
  })

  it('cuts a very long cell, keeps two tables apart, and bounds a runaway block', () => {
    const long = prettyLines(['| h | v |', '| a | ' + 'x'.repeat(80) + ' |'])

    expect(long.every(line => line.length <= 8 + 48)).toBe(true)
    expect(long.some(line => line.includes('…'))).toBe(true)

    const two = prettyLines(['| a | b |', '| 1 | 2 |', 'text', '| c | d |', '| 3 | 4 |'])

    expect(two.filter(line => line.startsWith('┌'))).toHaveLength(2)
    expect(prettyLines(Array.from({ length: 300 }, () => '| a | b |'))).toHaveLength(300)
  })

  it('never invents text: every cell of the output was in the input', () => {
    const cells = new Set(PASTED.filter(line => line.startsWith('|')).flatMap(line => line.slice(1, -1).split('|').map(cell => cell.trim())))

    for (const line of prettyLines(PASTED).filter(row => row.startsWith('│'))) for (const cell of line.slice(1, -1).split('│').map(part => part.trim())) expect(cells.has(cell), cell).toBe(true)
  })
})

describe('markdown in a result', () => {
  it('draws a markdown pipe table like the CLI one, and reads the markers inside its cells', () => {
    const out = prettyLines(['| Component | Status |', '|---|:---:|', '| **SONA** | `Active` |', '| HNSW | Available |'])

    expect(out[0]).toBe('┌───────────┬───────────┐')
    expect(out[1]).toBe('│ Component │ Status    │')
    expect(out[2]).toBe('├───────────┼───────────┤')
    expect(out[3]).toBe('│ SONA      │ Active    │')
    expect(out.at(-1)).toBe('└───────────┴───────────┘')
    expect(out.join('\n')).not.toMatch(/\*\*|`|:---/)
  })

  it('reads headings, bullets, quotes, bold, code and links as plain text', () => {
    expect(prettyLines(['## Neural status', '', '- **SONA** is `active`', '  * nested [docs](https://example.com/a)', '> a note'])).toEqual([
      '▸ Neural status',
      '',
      '• SONA is active',
      '  • nested docs (https://example.com/a)',
      '│ a note',
    ])
  })

  it('shows a fenced block as it is, without the fences, and leaves single asterisks and unpaired markers alone', () => {
    expect(prettyLines(['```json', '{ "a": **1** }', '```', 'after'])).toEqual(['{ "a": **1** }', 'after'])
    expect(plainMarkdown('5 * 3 = 15, snake_case, a **dangling')).toBe('5 * 3 = 15, snake_case, a **dangling')
    expect(plainMarkdown('use `npm test` and **always** [x](https://a.b)')).toBe('use npm test and always x (https://a.b)')
  })

  it('keeps a table that mixes both styles apart from the text around it', () => {
    const out = prettyLines(['Result:', '+---+---+', '| a | b |', '+---+---+', '| 1 | 2 |', '+---+---+', '', '**done**'])

    expect(out[0]).toBe('Result:')
    expect(out.filter(line => line.startsWith('┌'))).toHaveLength(1)
    expect(out.at(-1)).toBe('done')
  })
})
