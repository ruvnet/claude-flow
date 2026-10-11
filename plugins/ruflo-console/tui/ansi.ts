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
/** Visible length of a line: SGR sequences cost nothing (only ours are ever in it), every code point is one cell. */
export const widthOf = (line: string): number => [...line.replace(/\u001b\[[0-9;]*m/g, '')].length

/** Cuts a styled line to `width` cells, keeping the sequences, and closes any style left open. */
function cut(line: string, width: number, mark = ''): string {
  if (widthOf(line) <= width) return line

  let out = ''
  let seen = 0
  const keep = Math.max(0, width - [...mark].length)

  for (const part of line.split(/(\u001b\[[0-9;]*m)/)) {
    if (part.startsWith('\u001b[')) out += part
    else
      for (const ch of part) {
        if (seen >= keep) break
        out += ch
        seen++
      }
  }

  return `${out}${mark}${out.includes('\u001b') ? RESET : ''}`
}

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(' ')) {
    let rest = word

    while ([...rest].length > width) {
      if (current !== '') lines.push(current), (current = '')
      lines.push([...rest].slice(0, width).join(''))
      rest = [...rest].slice(width).join('')
    }

    if (current !== '' && [...current].length + [...rest].length + 1 > width) {
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

  if (type === 'Button') {
    const label = clean(props.label)

    return [cut(`${sgr({ dimColor: true }, depth)}[${props.hotkey === undefined ? '' : `${clean(props.hotkey)} `}${label}]${depth === 'none' ? '' : RESET}`, width)]
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
