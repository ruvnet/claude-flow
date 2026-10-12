/**
 * The memory map with real vectors (ADR-472): `memory list --embeddings` rows (int8 + scale) decoded, the layout that follows, and the
 * label that is dropped only when stored vectors drove it. Run with
 *   npx vitest run plugins/ruflo-console/tests/memmap-vectors.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { encodeEmbeddingQ8 } from '../../../v3/@claude-flow/cli/src/memory/embedding-q8'
import { decodeQ8, mapEntriesOf, memmapProbe } from '../hooks/data/memmap'
import { drawable, layout, modeOf, type MapEntry } from '../hooks/gfx/memmap'
import { newState } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { memmapRows } from '../hooks/views/memmap'

const unit = (n: number, seed: number): number[] => {
  const v = Array.from({ length: n }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233))
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))

  return v.map(x => x / norm)
}
const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0
  let na = 0
  let nb = 0

  for (let i = 0; i < a.length; i++) {
    dot += (a[i] as number) * (b[i] as number)
    na += (a[i] as number) ** 2
    nb += (b[i] as number) ** 2
  }

  return dot / Math.sqrt(na * nb)
}
const row = (key: string, namespace: string, vector?: number[]) => ({ key, namespace, hasEmbedding: vector !== undefined, accessCount: 1, ...(vector !== undefined && { embeddingQ8: encodeEmbeddingQ8(JSON.stringify(vector)) }) })

describe('decoding what the CLI prints', () => {
  it('reads int8 + scale back to within quantisation error of the stored vector, using the CLI’s own encoder', () => {
    const v = unit(384, 5)
    const back = decodeQ8(encodeEmbeddingQ8(JSON.stringify(v)))

    expect(back).toHaveLength(384)
    expect(cosine(back ?? [], v)).toBeGreaterThan(0.9999)
  })

  it('refuses a shape that does not check out rather than drawing a guess', () => {
    const good = encodeEmbeddingQ8([0.5, -0.25, 0.1, 0.9]) as { dims: number; scale: number; b64: string }

    expect(decodeQ8(good)).toHaveLength(4)
    for (const bad of [null, 'x', {}, { ...good, dims: 5 }, { ...good, dims: 3 }, { ...good, scale: 0 }, { ...good, scale: -1 }, { ...good, scale: Infinity }, { ...good, b64: '!!!!' }, { ...good, b64: 3 }, { ...good, dims: 1.5 }, { dims: 5000, scale: 1, b64: 'AAAA' }]) {
      expect(decodeQ8(bad), JSON.stringify(bad)).toBeUndefined()
    }
  })

  it('puts a decoded vector on each listed entry, and none on a row without one', () => {
    const entries = mapEntriesOf(JSON.stringify([row('a', 'n', unit(8, 1)), row('b', 'n')]))

    expect(entries?.[0]?.vector).toHaveLength(8)
    expect(entries?.[0]?.hasVector).toBe(true)
    expect(entries?.[1]?.vector).toBeUndefined()
  })

  it('asks for the vectors, and an older CLI that ignores the flag leaves the hash layout (no vectors, no claim)', () => {
    expect(memmapProbe.args).toContain('--embeddings')

    const older = mapEntriesOf(JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, namespace: 'n', hasEmbedding: true, accessCount: 0 }))))

    expect(older).toHaveLength(6)
    expect(modeOf(older ?? [])).toBe('hash')
  })

  it('fits the 500 x 384 case inside the 1,000,000 characters the reader parses, and decodes all of it', () => {
    const stdout = JSON.stringify(Array.from({ length: 500 }, (_, i) => row(`entry-${i}`, `ns-${i % 6}`, unit(384, i))), null, 2)
    const started = performance.now()
    const entries = mapEntriesOf(stdout)
    const ms = performance.now() - started

    console.log(`memmap vectors: 500 x 384 stdout ${stdout.length} chars, parsed and decoded in ${ms.toFixed(1)} ms`)
    expect(stdout.length).toBeLessThan(1_000_000)
    expect(entries).toHaveLength(500)
    expect(entries?.every(entry => entry.vector?.length === 384)).toBe(true)
    expect(modeOf(entries ?? [])).toBe('embedding')
  })
})

describe('what is drawn', () => {
  const mixed = (withVector: number, without: number): MapEntry[] => [
    ...Array.from({ length: withVector }, (_, i) => ({ key: `v${i}`, namespace: 'a', hasVector: true, vector: unit(16, i) })),
    ...Array.from({ length: without }, (_, i) => ({ key: `n${i}`, namespace: 'b', hasVector: false })),
  ]

  it('draws only the entries that have a vector when at least half do, and counts the rest', () => {
    const list = mixed(6, 2)
    const got = drawable(list)

    expect(got.entries).toHaveLength(6)
    expect(got.omitted).toBe(2)
    expect(layout(got.entries).mode).toBe('embedding')
    expect(drawable(list)).toBe(got)
  })

  it('keeps every entry in the hash layout when fewer than half have a vector, or when all do or none do', () => {
    const few = mixed(2, 6)

    expect(drawable(few)).toEqual({ entries: few, omitted: 0 })
    expect(layout(drawable(few).entries).mode).toBe('hash')
    expect(drawable(mixed(0, 5)).omitted).toBe(0)
    expect(drawable(mixed(5, 0)).omitted).toBe(0)
    expect(drawable([])).toEqual({ entries: [], omitted: 0 })
  })

  it('places similar stored vectors nearer than unrelated ones', () => {
    const base = unit(64, 3)
    const near = base.map((x, i) => x + 0.02 * Math.sin(i))
    const far = unit(64, 99)
    const placed = layout([{ key: 'base', namespace: 'a', hasVector: true, vector: base }, { key: 'near', namespace: 'a', hasVector: true, vector: near }, { key: 'far', namespace: 'a', hasVector: true, vector: far }]).points
    const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y)

    expect(dist(placed[0] as never, placed[1] as never)).toBeLessThan(dist(placed[0] as never, placed[2] as never))
  })
})

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Raster: make('Raster') }
const flat = (node: unknown): El[] => {
  if (Array.isArray(node)) return node.flatMap(flat)
  if (typeof node !== 'object' || node === null) return []
  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
const shownOf = (value: MapEntry[]): string => {
  const state = newState({ boot: false })

  state.probes.set('memmap', { value, error: null, okAtMs: 4_000 } as never)

  const ctx = { kit, state, nowMs: 5_000, columns: 200, pictures: new Map(), act: new Proxy({}, { get: () => () => undefined }) } as unknown as Ctx

  return flat(memmapRows(ctx)).filter(el => el.kind === 'Text').map(el => String(el.props.children)).join('\n')
}

describe('the labels', () => {
  const vec = (i: number): MapEntry => ({ key: `v${i}`, namespace: 'a', hasVector: true, vector: unit(16, i) })
  const bare = (i: number): MapEntry => ({ key: `n${i}`, namespace: 'b', hasVector: false })

  it('drops "NOT similarity" only when stored vectors drove the layout, and says how many entries were left off', () => {
    const shown = shownOf([...[1, 2, 3, 4, 5].map(vec), bare(1)])

    expect(shown).toContain('embedding layout')
    expect(shown).toContain('1 without a vector not drawn')
    expect(shown).toContain('read from the store, not recomputed')
    expect(shown).not.toContain('NOT similarity')
  })

  it('keeps the hash label when vectors were not read, or are too few to draw from', () => {
    for (const list of [[1, 2, 3].map(bare), [vec(1), bare(1), bare(2), bare(3)]]) {
      const shown = shownOf(list)

      expect(shown).toContain('hash layout')
      expect(shown).toContain('NOT similarity')
      expect(shown).not.toContain('embedding layout')
    }
  })
})
