/**
 * The standalone renderer (ADR-489): the element tree the console's views build (`Box`, `Text`, `Button`) drawn as terminal lines.
 * The Claude Code engine neutralises escape sequences in `Text`; here this file is that chokepoint, so every string that reaches
 * the screen has been through `clean` first (escapes, control and invisible characters removed, a line that holds a secret
 * withheld whole). Pure: no I/O, no Node.
 */
import { ESCAPES, INVISIBLE } from '../hooks/data/parse'
import { hasSecret } from '../hooks/screen'
import { hasInvite } from '../hooks/xruv'
import type { Kit } from '../hooks/views/common'

const SECRET_LINE = '(line withheld: it looks like a secret: not shown)'
const SPACING = /[\t\n\r\u000b\u000c\u2028\u2029]+/g
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g

/** The one path a string takes to the screen. */
export function clean(raw: unknown): string {
  const line = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : ''
  const joined = line.replace(ESCAPES, '').replace(SPACING, ' ').replace(INVISIBLE, '').replace(CONTROLS, '')

  return hasSecret(line) || hasSecret(joined) || hasInvite(joined) ? SECRET_LINE : joined
}

export type Depth = 'none' | '256' | 'truecolor'

type Node = { type: string; props: Record<string, unknown> }
type Style = { color?: unknown; backgroundColor?: unknown; bold?: unknown; dimColor?: unknown; italic?: unknown; inverse?: unknown }

/** Theme names the views use (hooks/views/common.ts PLAIN), as the 256-colour numbers Claude Code's own theme is closest to. */
const NAMED: Record<string, number> = { claude: 173, success: 71, error: 167, warning: 214, suggestion: 147 }
const BASIC: Record<string, number> = { black: 0, red: 1, green: 2, yellow: 3, blue: 4, magenta: 5, cyan: 6, white: 7, gray: 8, grey: 8 }

const hex = (value: string): [number, number, number] | null => (/^#[0-9a-fA-F]{6}$/.test(value) ? [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)] : null)

function cube(r: number, g: number, b: number): number {
  const level = (n: number) => (n < 48 ? 0 : n < 115 ? 1 : Math.min(5, Math.floor((n - 35) / 40)))

  return 16 + 36 * level(r) + 6 * level(g) + level(b)
}

function colorCode(value: unknown, ground: 38 | 48, depth: Depth): string | null {
  if (depth === 'none' || typeof value !== 'string') return null

  const rgb = hex(value)

  if (rgb !== null) return depth === 'truecolor' ? `${ground};2;${rgb[0]};${rgb[1]};${rgb[2]}` : `${ground};5;${cube(...rgb)}`

  const named = NAMED[value] ?? (BASIC[value] === undefined ? undefined : BASIC[value])

  return named === undefined ? null : `${ground};5;${named}`
}

function sgr(style: Style, depth: Depth): string {
  if (depth === 'none') return ''

  const codes = [style.bold === true ? '1' : '', style.dimColor === true ? '2' : '', style.italic === true ? '3' : '', style.inverse === true ? '7' : '', colorCode(style.color, 38, depth) ?? '', colorCode(style.backgroundColor, 48, depth) ?? ''].filter(code => code !== '')

  return codes.length === 0 ? '' : `\u001b[${codes.join(';')}m`
}

const RESET = '\u001b[0m'
/** Wide (two-cell) ranges: CJK, fullwidth forms, and the emoji blocks terminals draw two cells wide. A table, not a library; unlisted ambiguous symbols count one. */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd],
]

/** Terminal cells one code point takes: 0 for a combining mark, 2 for a wide one, else 1. */
export function cellsOf(code: number): number {
  if (code >= 0x300 && code <= 0x36f) return 0

  return WIDE.some(([from, to]) => code >= from && code <= to) ? 2 : 1
}

/** Cells a string takes (no escape sequences in it). */
export const cells = (text: string): number => [...text].reduce((sum, ch) => sum + cellsOf(ch.codePointAt(0) as number), 0)

/** The longest head of `text` that fits `room` cells, and the rest. */
function split(text: string, room: number): [string, string] {
  let used = 0
  let head = ''

  for (const ch of text) {
    const w = cellsOf(ch.codePointAt(0) as number)

    if (used + w > room) break
    used += w
    head += ch
  }

  return [head, text.slice(head.length)]
}

/** Visible width of a line in cells: SGR sequences cost nothing (only ours are ever in it). */
export const widthOf = (line: string): number => cells(line.replace(/\u001b\[[0-9;]*m/g, ''))

/** Cuts a styled line to `width` cells, keeping the sequences, and closes any style left open. */
function cut(line: string, width: number, mark = ''): string {
  if (widthOf(line) <= width) return line

  let out = ''
  let left = Math.max(0, width - cells(mark))

  for (const part of line.split(/(\u001b\[[0-9;]*m)/)) {
    if (part.startsWith('\u001b[')) out += part
    else {
      const [head] = split(part, left)

      out += head
      left -= cells(head)
    }
  }

  return `${out}${mark}${out.includes('\u001b') ? RESET : ''}`
}

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(' ')) {
    let rest = word

    while (cells(rest) > width) {
      if (current !== '') lines.push(current), (current = '')
      const [head, tail] = split(rest, width)

      if (head === '') break
      lines.push(head)
      rest = tail
    }

    if (current !== '' && cells(current) + cells(rest) + 1 > width) {
      lines.push(current)
      current = rest
    } else current = current === '' ? rest : `${current} ${rest}`
  }

  return lines.length === 0 && current === '' ? [''] : [...lines, current]
}

const flat = (children: unknown): unknown[] => (Array.isArray(children) ? children.flatMap(flat) : children === null || children === undefined || typeof children === 'boolean' ? [] : [children])

/** The text of a Text element's children (strings and numbers; a nested Text contributes its own). */
function textOf(children: unknown): string {
  return flat(children)
    .map(child => (typeof child === 'object' ? textOf((child as Node).props?.children) : clean(child)))
    .join('')
}

function pad(line: string, width: number): string {
  return line + ' '.repeat(Math.max(0, width - widthOf(line)))
}

const BORDER = {
  round: ['╭', '╮', '╰', '╯', '─', '│'],
  single: ['┌', '┐', '└', '┘', '─', '│'],
} as const

/** One element as lines no wider than `width`. */
export function render(node: unknown, width: number, depth: Depth): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [cut(clean(node), width)]
  if (Array.isArray(node)) return node.flatMap(child => render(child, width, depth))

  const { type, props } = node as Node

  if (props.hidden === true || props.display === 'none') return []

  if (type === 'Text') {
    const text = textOf(props.children)
    const open = sgr(props as Style, depth)
    const lines = props.wrap === 'truncate-end' ? [cut(text, width, '…')] : wordWrap(text, Math.max(1, width))

    return lines.map(line => (open === '' ? line : `${open}${line}${RESET}`))
  }

  // A Button is a mouse or hotkey control of the Claude Code host, and this terminal has neither: a control that would act is not drawn
  // (a bracketed "button" nobody can press is a lie), and one that starts a Claude turn (✦) never is. What stays is information:
  // a section title (key `sec-…`, without its fold mark since nothing folds here), and a chip that shows a state, such as `● all 0`
  // against `○ bad 0`, with a gap after it so neighbours do not run together.
  if (type === 'Button') {
    const label = clean(props.label).trim()

    if (label.includes('✦')) return []

    if (typeof props.key === 'string' && props.key.startsWith('sec-')) return [cut(`${sgr({ bold: true }, depth)}${label.replace(/^[▾▸]\s*/, '')}${depth === 'none' ? '' : RESET}`, width)]

    return /^[●○]/.test(label) ? [cut(`${sgr({ dimColor: true }, depth)}${label}  ${depth === 'none' ? '' : RESET}`, width)] : []
  }

  if (type !== 'Box') return []

  const frame = props.borderStyle === 'round' || props.borderStyle === 'single' ? BORDER[props.borderStyle] : null
  const padX = typeof props.paddingX === 'number' && props.paddingX > 0 ? Math.min(4, Math.floor(props.paddingX)) : 0
  const inner = Math.max(1, width - (frame === null ? 0 : 2) - padX * 2)
  const children = flat(props.children)
  let body: string[]

  if (props.flexDirection === 'row') {
    const gap = typeof props.gap === 'number' ? Math.min(4, Math.max(0, Math.floor(props.gap))) : 0
    const parts = children.map(child => render(child, inner, depth))
    // Every part but the last keeps its own width; the last takes what is left, so a value never wraps under its label.
    const widths = parts.map(lines => lines.reduce((most, line) => Math.max(most, widthOf(line)), 0))
    const used = widths.slice(0, -1).reduce((sum, w) => sum + w + gap, 0)
    const redo = children.map((child, i) => (i === children.length - 1 ? render(child, Math.max(1, inner - used), depth) : (parts[i] as string[])))
    const height = redo.reduce((most, lines) => Math.max(most, lines.length), 0)

    body = Array.from({ length: height }, (_, y) => redo.map((lines, i) => (i === redo.length - 1 ? (lines[y] ?? '') : pad(lines[y] ?? '', widths[i] as number))).join(' '.repeat(gap)))
    body = body.map(line => cut(line, inner))
  } else {
    body = children.flatMap(child => render(child, inner, depth))
  }

  if (padX > 0) body = body.map(line => ' '.repeat(padX) + line)
  if (frame === null) return body

  const edge = sgr({ color: props.borderColor }, depth)
  const close = edge === '' ? '' : RESET
  const across = inner + padX * 2

  return [`${edge}${frame[0]}${frame[4].repeat(across)}${frame[1]}${close}`, ...body.map(line => `${edge}${frame[5]}${close}${pad(line, across)}${edge}${frame[5]}${close}`), `${edge}${frame[2]}${frame[4].repeat(across)}${frame[3]}${close}`]
}

/** The kit the views build with: plain element records for `render`. No Raster and no Input, so a picture takes its words and a text field its command fallback. */
export function terminalKit(): Kit {
  const make = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never

  return { Box: make('Box'), Text: make('Text'), Button: make('Button') }
}
