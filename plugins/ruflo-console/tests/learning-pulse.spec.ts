/** The Learning pulse's charts: every group lines up, each bar means one thing, and nothing is drawn over the data. */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { pulseRows } from '../hooks/views/learning-pulse'

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const act = new Proxy({}, { get: () => () => undefined }) as unknown as Ctx['act']
const flat = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(flat)
  if (typeof node !== 'object' || node === null) return []
  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
/** Each drawn row as one string: its Text pieces joined in order. */
const linesOf = (nodes: unknown): string[] =>
  flat(nodes)
    .filter(el => el.kind === 'Box' && el.props.flexDirection === 'row')
    .map(box => flat(box.props.children).filter(el => el.kind === 'Text').map(el => String(el.props.children)).join(''))

function draw(snapshot: Record<string, unknown>, columns = 120): string[] {
  const state = newState({ boot: false })

  state.snapshot = snapshot as never

  return linesOf(pulseRows({ kit, state, act, columns, nowMs: 5_000, pictures: new Map() } as unknown as Ctx))
}

const SNAP = {
  router: { distribution: [{ model: 'sonnet', count: 6 }, { model: 'opus', count: 5 }] },
  outcomes: { points: Array.from({ length: 9 }, () => ({ ok: true })) },
  neural: { trajectories: 32_253, patterns: 32_236, signals: 20_200 },
}

describe('the learning pulse', () => {
  it('groups its charts under headings that say what each measures', () => {
    const lines = draw(SNAP)

    expect(lines.some(line => /Pipeline ─+/.test(line))).toBe(true)
    expect(lines.some(line => /Model mix ─+ share of 11 routed tasks/.test(line))).toBe(true)
    expect(lines.some(line => /Outcomes ─+ 9 of the last 9 succeeded · 100%/.test(line))).toBe(true)
    expect(lines.some(line => /Store ─+ bars are relative to the largest/.test(line))).toBe(true)
  })

  it('draws the model mix as each model\'s share of all routed tasks, so no bar is full unless it is the whole', () => {
    const lines = draw(SNAP)
    const sonnet = lines.find(line => line.includes('sonnet')) ?? ''
    const opus = lines.find(line => line.includes('opus')) ?? ''
    const filled = (line: string): number => (line.match(/█/g) ?? []).length

    expect(sonnet).toMatch(/55%/)
    expect(opus).toMatch(/45%/)
    expect(filled(sonnet)).toBeGreaterThan(filled(opus))
    expect(filled(sonnet) + (sonnet.match(/░/g) ?? []).length).toBe(filled(opus) + (opus.match(/░/g) ?? []).length)
    expect(filled(sonnet)).toBeLessThan(sonnet.match(/[█░]/g)?.length ?? 0)
    // A lone model is the whole: full.
    expect(draw({ ...SNAP, router: { distribution: [{ model: 'haiku', count: 4 }] } }).find(line => line.includes('haiku'))).toMatch(/█{10,}(?!░)/)
  })

  it('keeps every bar the same width, in a fixed label column, with nothing drawn over the data', () => {
    const lines = draw(SNAP)
    const bars = lines.filter(line => /[█░]{8,}/.test(line)).map(line => (/[█░▇▂]+/.exec(line.replace(/^[^█░▇▂]*/, ''))?.[0] ?? ''))
    const rows = lines.filter(line => /sonnet|opus|trajectories|patterns|signals/.test(line))

    expect(new Set(rows.map(line => line.slice(0, 16))).size).toBe(rows.length)
    expect(rows.every(line => /^ \S+ *\s{1,}/.test(line))).toBe(true)
    expect(new Set(bars.map(bar => bar.length)).size).toBe(1)
    for (const line of lines) expect(line).not.toMatch(/[▓┃]/)
  })

  it('draws one cell per recent outcome (a short cell for a failure) and says plainly when there is no data', () => {
    const mixed = draw({ ...SNAP, outcomes: { points: [{ ok: true }, { ok: false }, { ok: true }] } })

    expect(mixed.find(line => line.includes('last outcomes'))).toMatch(/▇▂▇ +2\/3/)
    expect(mixed.some(line => /2 of the last 3 succeeded · 67%/.test(line))).toBe(true)

    const empty = draw({ router: { distribution: [] }, outcomes: { points: [] } })

    expect(empty.join('\n')).not.toMatch(/[█░▇▂]/)
  })
})
