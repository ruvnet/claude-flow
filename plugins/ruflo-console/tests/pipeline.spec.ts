/** The learning pipeline diagram and the router picture (ADR-455): staleness is a clock rule, nothing is drawn that was not read. */
import { describe, expect, it } from 'vitest'

import { candidatesFromLines, MAX_CANDIDATES, pipeStagesOf, routeModelOf, routeOwnerOf, stageNote, stageStateOf, STALE_AFTER_MS } from '../hooks/data/pipeline'
import { pipelineDiagram, routePicture, routeRows } from '../hooks/gfx/pipeline'
import { COLOR, type Grid } from '../hooks/gfx/raster'
import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { learningView } from '../hooks/views/learning'

const NOW = 100 * 86_400_000
const HOUR = 3_600_000
const rowText = (grid: Grid, y: number): string => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y))).join('')
const fg = (grid: Grid, x: number, y: number): number => grid.cells[(y * grid.columns + x) * 3 + 1] as number

describe('stage staleness', () => {
  it('is absent without a count, live without a timestamp, stale only past 24h', () => {
    expect(stageStateOf(null, NOW, NOW).state).toBe('absent')
    expect(stageStateOf(5, null, NOW)).toEqual({ state: 'live', ageMs: null })
    expect(stageStateOf(5, NOW - STALE_AFTER_MS, NOW).state).toBe('live')
    expect(stageStateOf(5, NOW - STALE_AFTER_MS - 1, NOW).state).toBe('stale')
    expect(stageStateOf(0, NOW - HOUR, NOW).state).toBe('live')
    expect(stageStateOf(5, NOW + HOUR, NOW)).toEqual({ state: 'live', ageMs: 0 })
  })

  it('words each state', () => {
    const [a, b, c, d] = pipeStagesOf(
      [{ name: 'A', count: 3 }, { name: 'B', count: 3 }, { name: 'C', count: 3 }, { name: 'D', count: null }],
      { A: NOW - 3 * HOUR, B: NOW - 8 * 86_400_000 },
      NOW,
    )

    expect([a, b, c, d].map(stage => stageNote(stage!))).toEqual(['3h ago', 'stale 8d', 'age n/a', 'no data'])
  })
})

describe('the pipeline diagram', () => {
  const stages = pipeStagesOf([{ name: 'RETRIEVE', count: 32_253 }, { name: 'JUDGE', count: 9 }, { name: 'DISTILL', count: 7 }, { name: 'CONSOLIDATE', count: null }], { RETRIEVE: NOW - HOUR, JUDGE: NOW - 9 * 86_400_000, DISTILL: NOW - HOUR }, NOW)

  it('draws four stages with the real counts, in order', () => {
    const grid = pipelineDiagram(stages, 80)

    expect(rowText(grid, 1)).toMatch(/RETRIEVE.*JUDGE.*DISTILL.*CONSOLIDA/)
    expect(rowText(grid, 2)).toMatch(/32\.3k.*9.*7.*n\/a/)
    expect(rowText(grid, 3)).toContain('stale 9d')
    expect(rowText(grid, 2)).toContain('──▶')
  })

  it('dims a stale stage and an absent one, and leaves a live one lit', () => {
    const grid = pipelineDiagram(stages, 80)
    const at = (name: string) => rowText(grid, 1).indexOf(name)

    expect(fg(grid, at('RETRIEVE'), 1)).toBe(COLOR.accent)
    expect(fg(grid, at('JUDGE'), 1)).toBe(COLOR.dim)
    expect(fg(grid, at('CONSOLIDA'), 1)).toBe(COLOR.dim)
    expect(fg(grid, at('JUDGE') - 1, 0)).toBe(COLOR.dim)
  })

  it('never clips a name, count or age: a narrow pane stacks one line per stage', () => {
    const grid = pipelineDiagram(stages, 40)

    expect(grid.columns).toBe(40)
    expect(grid.rows).toBe(4)
    expect(rowText(grid, 0)).toContain('RETRIEVE 32.3k · 1h ago')
    expect(rowText(grid, 1)).toContain('JUDGE 9 · stale 9d')
    expect(rowText(grid, 3)).toContain('CONSOLIDATE n/a · no data')
    expect(rowText(pipelineDiagram(stages, 80), 1)).toContain('CONSOLIDATE')
  })

  it('keeps its size on a narrow pane', () => {
    const grid = pipelineDiagram(stages, 24)

    expect(grid.columns).toBe(24)
    expect(rowText(grid, 0).trimEnd().length).toBeLessThanOrEqual(24)
  })
})

describe('the route model', () => {
  const route = { agent: 'coder', confidence: 0.72, matched: true, reason: 'keyword' }

  it('names who owns routing', () => {
    expect(routeOwnerOf(false, false)).toBe('unseated')
    expect(routeOwnerOf(true, true)).toBe('classic')
    expect(routeOwnerOf(true, false)).toBe('mods')
  })

  it('reads the pick and the runners-up from a Lab route result', () => {
    expect(candidatesFromLines(['→ coder · 87% · semantic · pattern x', '  or reviewer · 9%', '  or tester', 'because'])).toEqual([
      { agent: 'coder', confidence: 0.87 },
      { agent: 'reviewer', confidence: 0.09 },
      { agent: 'tester', confidence: null },
    ])
    expect(candidatesFromLines(['no json here'])).toEqual([])
    expect(candidatesFromLines(['→ x · 900%'])[0]?.confidence).toBe(1)
  })

  it('stops at the five the picture draws, keeping the pick and the first runner-ups in order', () => {
    const lines = ['→ a · 90%', ...Array.from({ length: 10_000 }, (_, i) => `  or r${i} · 5%`)]
    const found = candidatesFromLines(lines)

    expect(found).toHaveLength(MAX_CANDIDATES)
    expect(found.map(c => c.agent)).toEqual(['a', 'r0', 'r1', 'r2', 'r3'])
  })

  it('strips control characters from router text before it reaches a cell', () => {
    const [pick] = candidatesFromLines(['→ co\u001b[2Jder · 50%'])

    expect(pick?.agent).toBe('co[2Jder')
  })

  it('prefers a route query with candidates, else the mod pick, else says none', () => {
    const lab = { id: 'nn-route', label: 'which agent for "fix"', lines: ['→ coder · 80%', '  or tester · 10%'] }

    expect(routeModelOf({ seated: true, classicOwnsRoute: false, route, lab })).toMatchObject({ source: 'router-query', candidates: [{ agent: 'coder' }, { agent: 'tester' }] })
    expect(routeModelOf({ seated: true, classicOwnsRoute: false, route, lab: { ...lab, id: 'nn-status' } })).toMatchObject({ source: 'mods', candidates: [{ agent: 'coder', confidence: 0.72 }], matched: true })
    expect(routeModelOf({ seated: true, classicOwnsRoute: true, route: null, lab: null })).toMatchObject({ source: 'none', owner: 'classic', candidates: [] })
  })
})

describe('the route picture', () => {
  it('draws each candidate with a bar and its percentage, the pick first', () => {
    const model = routeModelOf({ seated: true, classicOwnsRoute: false, route: null, lab: { id: 'nn-route', label: 'q', lines: ['→ coder · 80%', '  or tester · 10%'] } })
    const grid = routePicture(model, 90)

    expect(grid.rows).toBe(routeRows(model))
    expect(rowText(grid, 0)).toContain('ruflo-mods routes in-process')
    expect(rowText(grid, 1)).toMatch(/▸ coder\s+█+░*\s+80%/)
    expect(rowText(grid, 2)).toMatch(/tester\s+█+░+\s+10%/)
  })

  it('says the classic hook owns routing and that nothing is recorded, without inventing a pick', () => {
    const grid = routePicture(routeModelOf({ seated: true, classicOwnsRoute: true, route: null, lab: null }), 90)

    expect(rowText(grid, 0)).toContain('classic hook-handler routes')
    expect(rowText(grid, 1)).toContain('no route recorded yet')
    expect(rowText(grid, 1)).not.toContain('█')
  })
})

describe('the Learning page', () => {
  type El = { kind: string; props: Record<string, unknown> }
  const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
  const act = new Proxy({}, { get: () => () => undefined }) as unknown as Ctx['act']
  const flat = (node: unknown): El[] => {
    if (Array.isArray(node)) return node.flatMap(flat)
    if (typeof node !== 'object' || node === null) return []
    const el = node as El
    const children = el.props.children

    return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
  }

  function page(kit: Record<string, unknown>) {
    const state = newState({ boot: false })

    state.snapshot = { outcomes: { total: 9, successes: 9, points: [{ ok: true, atMs: NOW - 9 * 86_400_000 }] }, router: null, neural: { trajectories: 12, patterns: 3, lastAdaptationMs: NOW - HOUR }, sona: null } as never
    state.ruflo = { ...state.ruflo, snapshot: { owned: [] } as never, route: null } as never

    return flat(learningView({ kit, state, act, columns: 130, nowMs: NOW, pictures: new Map() } as unknown as Ctx))
  }

  it('falls back to words where there is no Raster, still naming the stale stage and the owner', () => {
    const text = page({ Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') })
      .filter(el => el.kind === 'Text')
      .map(el => String(el.props.children))
      .join('\n')

    expect(text).toContain('JUDGE 9 (stale 9d)')
    expect(text).toContain('RETRIEVE 12 (1h ago)')
    expect(text).toContain('classic owns routing')
  })

  it('draws both pictures as rasters where the terminal has one', () => {
    const keys = page({ Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Raster: make('Raster') })
      .filter(el => el.kind === 'Raster')
      .map(el => el.props.key)

    expect(keys).toContain('pipeline-stages')
    expect(keys).toContain('route')
  })
})
