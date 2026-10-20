/**
 * The memory map's pure parts under vitest: the layout (deterministic, honest about its mode), the glyphs, the picture's
 * hit lighting, the readers for `memory list` and search lines, and the view's empty and filled states. Run with
 *   npx vitest run plugins/ruflo-console/tests/memmap.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { memmapProbe, hitsOf, isHit, mapEntriesOf } from '../hooks/data/memmap'
import { glyphOf, hash32, layout, memmapPicture, modeOf, projectVector, spacesOf, type MapEntry } from '../hooks/gfx/memmap'
import { memLines } from '../hooks/memory-lines'
import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { memmapPictures, memmapRows } from '../hooks/views/memmap'
import { MEM_OUT } from './fixtures/memory'

const entries = (): MapEntry[] => [
  ...Array.from({ length: 12 }, (_, i) => ({ key: `tok-${i}`, namespace: 'auth', hasVector: true, accessCount: i })),
  ...Array.from({ length: 12 }, (_, i) => ({ key: `note-${i}`, namespace: 'notes', hasVector: false, accessCount: 0 })),
]

describe('the layout', () => {
  it('is deterministic and keeps every point inside the plane', () => {
    const a = layout(entries())
    const b = layout(entries())

    expect(a).toEqual(b)
    for (const point of a.points) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(1)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(1)
    }
  })

  it('says hash unless every entry carries a vector, and clusters a namespace together in hash mode', () => {
    const { mode, points } = layout(entries())
    const centre = (space: string) => {
      const own = points.filter(point => point.namespace === space)

      return { x: own.reduce((sum, p) => sum + p.x, 0) / own.length, y: own.reduce((sum, p) => sum + p.y, 0) / own.length }
    }
    const [a, n] = [centre('auth'), centre('notes')]

    expect(mode).toBe('hash')
    expect(Math.hypot(a.x - n.x, a.y - n.y)).toBeGreaterThan(0.3)
    expect(modeOf([{ key: 'a', namespace: 'x', hasVector: true, vector: [1, 2, 3] }])).toBe('embedding')
    expect(modeOf([{ key: 'a', namespace: 'x', hasVector: true, vector: [1, 2, 3] }, { key: 'b', namespace: 'x', hasVector: true }])).toBe('hash')
    expect(modeOf([])).toBe('hash')
  })

  it('projects equal vectors to equal places and near vectors nearer than opposite ones', () => {
    const v = Array.from({ length: 64 }, (_, i) => Math.sin(i))
    const near = v.map((x, i) => x + 0.01 * Math.cos(i))
    const far = v.map(x => -x)
    const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y)

    expect(projectVector(v)).toEqual(projectVector(v))
    expect(d(projectVector(v), projectVector(near))).toBeLessThan(d(projectVector(v), projectVector(far)))
  })

  it('hashes stably, and orders namespaces by name so colour and place do not depend on the listing', () => {
    expect(hash32('auth/beta')).toBe(hash32('auth/beta'))
    expect(hash32('a')).not.toBe(hash32('b'))
    expect(spacesOf([{ namespace: 'z' }, { namespace: 'a' }, { namespace: 'z' }])).toEqual(['a', 'z'])
  })
})

describe('the picture', () => {
  const draw = (hits: Set<string>) => {
    const { points } = layout(entries())

    return memmapPicture(points, spacesOf(entries()), hits, 60, 14)
  }
  const glyphs = (grid: ReturnType<typeof draw>) => Array.from({ length: grid.columns * grid.rows }, (_, i) => String.fromCodePoint(grid.cells[i * 3] as number))

  it('sizes a dot by reads', () => {
    expect([undefined, 0, 1, 2, 3, 9, 10, 400].map(glyphOf)).toEqual(['·', '·', '•', '•', '●', '●', '◉', '◉'])
  })

  it('lights only the entries it was told, ringed, and draws none when nothing hit', () => {
    expect(glyphs(draw(new Set())).includes('◆')).toBe(false)

    const lit = glyphs(draw(new Set(['auth/tok-3', 'notes/note-5'])))

    expect(lit.filter(glyph => glyph === '◆').length).toBeGreaterThanOrEqual(1)
    expect(lit.filter(glyph => glyph === '◆').length).toBeLessThanOrEqual(2)
    expect(lit.includes('(')).toBe(true)
  })

  it('draws an honest note and no dots for an empty store', () => {
    const grid = memmapPicture([], [], new Set(), 30, 14)

    expect(glyphs(grid).join('').startsWith('no entries')).toBe(true)
  })
})

describe('the readers', () => {
  it('reads the access count and namespace from `memory list` and never invents a vector', () => {
    const list = mapEntriesOf(MEM_OUT.list as string)

    expect(list).toEqual([
      { key: 'beta', namespace: 'auth', hasVector: true, accessCount: 0 },
      { key: 'alpha', namespace: 'notes', hasVector: false, accessCount: 0 },
    ])
    expect(mapEntriesOf('not json')).toBeNull()
    expect(mapEntriesOf(JSON.stringify([{ key: 'k', namespace: 'n', accessCount: 4, embedding: [0.1, 0.2] }]))?.[0]?.vector).toEqual([0.1, 0.2])
  })

  it('asks for the same bounded list as the Namespaces sample, on the memory view only', () => {
    expect(memmapProbe.args).toEqual(['memory', 'list', '--format', 'json', '--limit', '500', '--embeddings'])
    expect(memmapProbe.views).toEqual(['memory'])
  })

  it('finds the hits the lab printed, and nothing in a non-hit line', () => {
    const hits = hitsOf(memLines('mem-search', MEM_OUT.search as string))

    expect([...hits]).toEqual(['auth/beta'])
    expect(hitsOf(['1 hit · semantic', '(no matches)', 'degraded: no model'])).toEqual(new Set())
    expect(isHit(new Set(['auth/beta']), { namespace: 'auth', key: 'beta' })).toBe(true)
    expect(isHit(new Set(['auth/beta']), { namespace: 'notes', key: 'beta' })).toBe(false)
    expect(isHit(new Set([`n/${'k'.repeat(60)}`]), { namespace: 'n', key: 'k'.repeat(90) })).toBe(true)
  })
})

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Raster: make('Raster') }
const act = new Proxy({}, { get: () => () => undefined }) as unknown as Ctx['act']
const flat = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(flat)
  if (typeof node !== 'object' || node === null) return []
  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
const texts = (nodes: unknown): string[] => flat(nodes).filter(el => el.kind === 'Text').map(el => String(el.props.children))
const ctxOf = (state: ReturnType<typeof newState>): Ctx => ({ kit, state, act, columns: 100, nowMs: 5_000, pictures: new Map() }) as unknown as Ctx

describe('the view', () => {
  it('says what it is waiting for, not a blank map, when nothing is listed', () => {
    const shown = texts(memmapRows(ctxOf(newState({ boot: false })))).join('\n')

    expect(shown).toContain('Memory map')
    expect(shown).toContain('reading `memory list`')
    expect(flat(memmapRows(ctxOf(newState({ boot: false })))).some(el => el.kind === 'Raster')).toBe(false)
  })

  it('draws a raster, labels the hash layout as not similarity, and counts what the last search lit', () => {
    const state = newState({ boot: false })

    state.probes.set('memmap', { value: entries(), error: null, okAtMs: 4_000 } as never)
    state.memoryLab.query = 'token'
    state.lab.result = { id: 'mem-search', label: 'search', ok: true, exitCode: 0, lines: ['2 hits · semantic', '0.912  auth/tok-3  jwt', '0.500  auth/tok-4  jwt', '0.400  other/zzz  elsewhere'], atMs: 4_500 }

    const nodes = memmapRows(ctxOf(state))
    const shown = texts(nodes).join('\n')

    expect(flat(nodes).filter(el => el.kind === 'Raster')).toHaveLength(1)
    expect(shown).toContain('hash layout')
    expect(shown).toContain('NOT similarity')
    expect(shown).toContain('2 of 24 listed entries lit by “token”')
    expect(shown).toContain('1 more hit is outside the listed sample')
    expect(memmapPictures(state, 100).get('memmap')?.columns).toBe(100)
  })

  it('falls back to the Namespaces sample and says read counts are n/a', () => {
    const state = newState({ boot: false })

    state.probes.set('namespaces', { value: { sampled: 1, byName: [{ name: 'auth', count: 1 }], entries: [{ key: 'beta', namespace: 'auth', hasVector: true }] }, error: null, okAtMs: 4_000 } as never)

    expect(texts(memmapRows(ctxOf(state))).join('\n')).toContain('read counts n/a')
  })
})

describe('the optimised projection and layout cache', () => {
  it('projects exactly as the per-dimension hash definition does, at any length', () => {
    for (const length of [2, 7, 384, 1536]) {
      const v = Array.from({ length }, (_, i) => Math.cos(i * 1.7))
      let a = 0
      let b = 0

      v.forEach((value, i) => {
        a += (hash32(String(i), 1) & 1 ? 1 : -1) * value
        b += (hash32(String(i), 2) & 1 ? 1 : -1) * value
      })

      const scale = Math.sqrt(Math.max(1, length)) / 2

      expect(projectVector(v)).toEqual({ x: 0.5 + 0.5 * Math.tanh(a / scale), y: 0.5 + 0.5 * Math.tanh(b / scale) })
    }
  })

  it('lays an array out once and gives a new array its own layout', () => {
    const list = entries()

    expect(layout(list)).toBe(layout(list))
    expect(layout([...list])).not.toBe(layout(list))
    expect(layout([...list])).toEqual(layout(list))
  })
})

describe('bounds', () => {
  it('names at most 12 namespaces in the key and says colours repeat', () => {
    const state = newState({ boot: false })

    state.probes.set('memmap', { value: Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, namespace: `ns-${String(i).padStart(2, '0')}`, hasVector: false })), error: null, okAtMs: 4_000 } as never)

    const shown = texts(memmapRows(ctxOf(state))).join('\n')

    expect(shown).toContain('ns-11')
    expect(shown).not.toContain('ns-12 ')
    expect(shown).toContain('+ 48 more namespaces')
  })

  it('ignores an embedding longer than 4096 numbers rather than projecting it', () => {
    const long = JSON.stringify([{ key: 'k', namespace: 'n', embedding: Array.from({ length: 5000 }, () => 0.1) }])

    expect(mapEntriesOf(long)?.[0]?.vector).toBeUndefined()
  })
})

describe('registration', () => {
  it('runs the memmap probe from the controller, so the read counts are not permanently n/a', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')

    expect(readFileSync(fileURLToPath(new URL('../hooks/controller.ts', import.meta.url) as never), 'utf8')).toMatch(/ALL_PROBES = \[[^\]]*memmapProbe/)
  })
})
