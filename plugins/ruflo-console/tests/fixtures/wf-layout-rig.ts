/**
 * A layout meter for a recorded element tree (ADR-469). The engine lays a row out left to right and gives a Button or a plain Text
 * the width it asks for; only a Text with `wrap: 'truncate-*'` gives way, and a Text squeezed below its length wraps by letter.
 * This meter does the same sum: a row whose fixed parts (buttons at label + 4 for `[ ` and ` ]`, plain texts at their length)
 * come to more than the pane is overflowing, and a plain Text left almost nothing is a letter-per-row wrap.
 */
export type El = { kind: string; props: Record<string, unknown> }
export type Finding = { kind: 'overflow' | 'letters'; at: string; width: number; avail: number }

/** Terminal cells of a string: the emoji-presentation glyphs the console draws count two, so a row is never judged narrower than it is. */
export function cells(text: string): number {
  let n = 0

  for (const ch of text) {
    const cp = ch.codePointAt(0) as number

    n += cp >= 0x1f000 || (cp >= 0x23e9 && cp <= 0x23fa) || cp === 0x2b50 || cp === 0x2705 || cp === 0x274c ? 2 : 1
  }

  return n
}

const textOf = (el: El): string => {
  const c = el.props.children

  return typeof c === 'string' || typeof c === 'number' ? String(c) : Array.isArray(c) ? c.filter(x => typeof x === 'string' || typeof x === 'number').join('') : ''
}

const shrinks = (el: El): boolean => typeof el.props.wrap === 'string' && el.props.wrap.startsWith('truncate')
const childrenOf = (el: El): El[] => {
  const c = el.props.children
  const list = Array.isArray(c) ? c.flat(3) : [c]

  return list.filter((x): x is El => typeof x === 'object' && x !== null && 'kind' in x)
}
const chrome = (el: El): number => (el.props.borderStyle !== undefined ? 2 : 0) + (typeof el.props.paddingX === 'number' ? el.props.paddingX * 2 : 0)

/** The width a node asks for, with `floor` for what it can give up (a truncating Text asks for one cell). */
export function ask(el: El, mode: 'fixed' | 'full'): number {
  if (el.kind === 'Button') return cells(String(el.props.label ?? '')) + 4
  if (el.kind === 'Text') return mode === 'fixed' && shrinks(el) ? 1 : cells(textOf(el))
  if (el.kind === 'Box') {
    const parts = childrenOf(el).map(child => ask(child, mode))

    return chrome(el) + (el.props.flexDirection === 'row' ? parts.reduce((a, b) => a + b, 0) : Math.max(0, ...parts))
  }

  return 0
}

/** Every row of the tree that does not fit `avail` columns, and every plain Text a row squeezes to two cells or fewer. */
export function measure(node: unknown, avail: number, path = 'page', out: Finding[] = []): Finding[] {
  if (typeof node !== 'object' || node === null || !('kind' in node)) return out

  const el = node as El

  if (el.kind !== 'Box') return out

  const inner = avail - chrome(el)
  const kids = childrenOf(el)
  const name = `${path}/${String(el.props.key ?? 'box')}`

  if (el.props.flexDirection === 'row') {
    const fixed = kids.reduce((sum, kid) => sum + ask(kid, 'fixed'), 0)

    if (fixed > inner) out.push({ kind: 'overflow', at: `${name} [${kids.map(k => (k.kind === 'Button' ? `[${String(k.props.label)}]` : textOf(k) || k.kind)).join('|').slice(0, 90)}]`, width: fixed, avail: inner })

    for (const kid of kids) {
      if (kid.kind !== 'Text' || shrinks(kid) || cells(textOf(kid)) <= 3) continue

      const left = inner - (fixed - ask(kid, 'fixed'))

      if (left <= 2) out.push({ kind: 'letters', at: `${name} "${textOf(kid).slice(0, 40)}"`, width: cells(textOf(kid)), avail: left })
    }

    for (const kid of kids) measure(kid, Math.max(1, inner - (fixed - ask(kid, 'fixed'))), name, out)
  } else for (const kid of kids) measure(kid, inner, name, out)

  return out
}

export const flatten = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flatten(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flatten((node as El).props?.children, out)
  }

  return out
}
