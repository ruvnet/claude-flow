/**
 * The standalone renderer (ADR-489) is the chokepoint the Claude Code engine is in the mod: hostile text from ruflo files must
 * never reach the terminal as an escape sequence, and a secret never as text. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-render.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { cells, clean, render, terminalKit, widthOf } from '../tui/ansi'

const kit = terminalKit()
const text = (children: unknown, props: Record<string, unknown> = {}) => kit.Text({ children, ...props } as never)
const box = (children: unknown[], props: Record<string, unknown> = {}) => kit.Box({ children, ...props } as never)
/** Every escape sequence the output holds, so a test can say "only ours". */
const escapes = (lines: string[]) => lines.join('\n').match(/\u001b[^m]*m?|\u009b/g) ?? []
const OURS = /^\u001b\[[0-9;]*m$/

describe('clean', () => {
  it('removes OSC, CSI, C1 and invisible characters, keeping the words', () => {
    expect(clean('swarm-\u001b]0;pwned\u0007one\u001b[31m red \u009b2J​‮ end')).toBe('swarm-one red  end')
    expect(clean('a\nb\tc\r\nd')).toBe('a b c d')
  })

  it('withholds a whole line that holds a secret', () => {
    expect(clean('token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here')).toMatch(/withheld/)
    expect(clean('key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toMatch(/withheld/)
  })

  it('treats a non-string as empty and a number as its digits', () => {
    expect(clean(undefined)).toBe('')
    expect(clean({})).toBe('')
    expect(clean(42)).toBe('42')
  })
})

describe('render', () => {
  it('never lets content write an escape: only the renderer\'s own colour codes remain', () => {
    const hostile = box([text('\u001b]0;pwned\u0007\u001b[2J\u001b[?1049h name', { color: '#ff2a6d', bold: true }), kit.Button({ key: 'x', label: 'go\u001b[31m', hotkey: 'g' } as never)], { flexDirection: 'row' })

    for (const depth of ['none', '256', 'truecolor'] as const) {
      const out = render(hostile, 80, depth)

      expect(escapes(out).every(seq => OURS.test(seq))).toBe(true)
      expect(out.join('')).not.toContain('pwned')
    }
    expect(escapes(render(hostile, 80, 'none'))).toEqual([])
  })

  it('maps theme names and hex to 256 and truecolor sequences, and none to plain text', () => {
    expect(render(text('x', { color: 'success' }), 20, '256')[0]).toContain('38;5;71')
    expect(render(text('x', { color: '#ff0000' }), 20, 'truecolor')[0]).toContain('38;2;255;0;0')
    expect(render(text('x', { color: '#ff0000' }), 20, '256')[0]).toContain('38;5;196')
    expect(render(text('x', { color: 'error', bold: true }), 20, 'none')).toEqual(['x'])
  })

  it('lays a row out side by side and a column as lines', () => {
    expect(render(box([text('label '), text('value')], { flexDirection: 'row' }), 40, 'none')).toEqual(['label value'])
    expect(render(box([text('one'), text('two')], { flexDirection: 'column' }), 40, 'none')).toEqual(['one', 'two'])
  })

  it('wraps long text, truncates where asked, and never exceeds the width', () => {
    const wrapped = render(text('word '.repeat(30)), 24, 'none')
    const cut = render(text('x'.repeat(100), { wrap: 'truncate-end' }), 24, 'none')

    expect(wrapped.length).toBeGreaterThan(3)
    expect(wrapped.every(line => widthOf(line) <= 24)).toBe(true)
    expect(cut).toHaveLength(1)
    expect(widthOf(cut[0] as string)).toBeLessThanOrEqual(24)
    expect(cut[0]).toMatch(/…$/)
  })

  it('draws a rounded border exactly as wide as asked, around padded content', () => {
    const out = render(box([text('hi')], { borderStyle: 'round', paddingX: 1 }), 20, 'none')

    expect(out).toHaveLength(3)
    expect(out.every(line => widthOf(line) === 20)).toBe(true)
    expect(out[0]?.startsWith('╭')).toBe(true)
    expect(out[1]).toContain(' hi')
  })

  it('counts emoji and CJK as two cells, so a border stays straight on a row that has them', () => {
    expect([cells('abc'), cells('🏠'), cells('✅'), cells('日本'), cells('é'), cells('e\u0301')]).toEqual([3, 2, 2, 4, 1, 1])

    const rows = ['plain row', '🏠 Overview', '🎯 📌 👑 🐝 four', '日本語のテキスト', 'x'.repeat(60)]
    const out = render(box(rows.map(row => box([text(row)], { flexDirection: 'row' })), { borderStyle: 'round', paddingX: 1 }), 30, 'none')

    expect(out.length).toBeGreaterThan(rows.length)
    expect(new Set(out.map(widthOf))).toEqual(new Set([30]))
    expect(widthOf(render(text('🏠'.repeat(20), { wrap: 'truncate-end' }), 11, 'none')[0] as string)).toBeLessThanOrEqual(11)
  })

  it('draws only a state chip from a button (a control nobody can press is not drawn), and skips hidden boxes', () => {
    expect(render(kit.Button({ key: 'k', label: 'Refresh' } as never), 30, 'none')).toEqual([])
    expect(render(kit.Button({ key: 'k', label: ' ✦ ask Claude ' } as never), 30, 'none')).toEqual([])
    expect(render(kit.Button({ key: 'k', label: ' ● all 3 ', hotkey: 'a' } as never), 30, 'none')).toEqual(['● all 3  '])
    expect(render(kit.Button({ key: 'k', label: ' ○ bad 0 ' } as never), 30, 'none')).toEqual(['○ bad 0  '])
    // A section title stays, without the fold mark (nothing folds in a terminal).
    expect(render(kit.Button({ key: 'sec-optimizer', label: '▾ Optimizer' } as never), 30, 'none')).toEqual(['Optimizer'])
    expect(render(kit.Button({ key: 'sec-plan', label: '▸ Plan options' } as never), 30, 'none')).toEqual(['Plan options'])
    expect(render(box([text('gone')], { hidden: true }), 30, 'none')).toEqual([])
  })

  it('survives garbage: null, booleans, unknown types, deep nesting', () => {
    expect(render(null, 10, 'none')).toEqual([])
    expect(render({ type: 'Raster', props: {} }, 10, 'none')).toEqual([])
    expect(render([false, undefined, [[text('ok')]]], 10, 'none')).toEqual(['ok'])
  })
})
