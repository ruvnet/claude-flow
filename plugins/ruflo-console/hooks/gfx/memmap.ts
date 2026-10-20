/**
 * The memory map: one dot per stored entry on a 2D plane, coloured by namespace, sized by access count. Pure functions of the
 * entries, the size and the search hits; nothing is drawn that the entries did not carry.
 *
 * Where a dot sits is a LAYOUT, not a measurement. `memory list` does not print vectors, so by default each namespace gets a
 * fixed place on a ring and each entry a hash-scattered place inside its namespace's cluster ('hash'): closeness means
 * "same namespace" and nothing more. When every entry carries its embedding, a fixed random projection puts similar
 * vectors nearby ('embedding'). The caller labels the mode; this file never claims more than it did.
 */
import { COLOR, Grid, mix } from './raster'

export type MapEntry = { key: string; namespace: string; accessCount?: number; hasVector: boolean; /** The stored embedding, only when a probe read it. */ vector?: readonly number[] }

export type MapMode = 'hash' | 'embedding'

export type MapPoint = { key: string; namespace: string; /** 0..1 across, 0..1 down. */ x: number; y: number; accessCount?: number; hasVector: boolean }

/** One colour per namespace, cycling; chosen to stay apart on dark and light themes. */
export const SPACE_COLORS = [0x2fa4c9, 0xe0a526, 0x2bb673, 0x8b7cf6, 0xe5534b, 0xd96fb0, 0x7fc8a9, 0xc9b458, 0x5f8bd6, 0xe08a4b] as const

/** 32-bit FNV-1a over a string, then a finaliser so near strings scatter. */
export function hash32(text: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0

  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0
  }

  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12

  return h >>> 0
}

/** A hash as a number in [0, 1). */
const unit = (text: string, seed: number): number => hash32(text, seed) / 0x1_0000_0000

/** Namespaces in a fixed order (by name), so a namespace keeps its colour and its place whatever else is listed. */
export const spacesOf = (entries: readonly { namespace: string }[]): string[] => [...new Set(entries.map(entry => entry.namespace))].sort()

/** The two hyperplanes' ±1 signs by dimension index, grown on demand: hashing the index per entry per dimension was the whole cost of an embedding layout. */
const signs: [Int8Array, Int8Array] = [new Int8Array(0), new Int8Array(0)]

function signsFor(length: number): [Int8Array, Int8Array] {
  if (signs[0].length < length) {
    const size = Math.max(length, 384)

    signs[0] = Int8Array.from({ length: size }, (_, i) => (hash32(String(i), 1) & 1 ? 1 : -1))
    signs[1] = Int8Array.from({ length: size }, (_, i) => (hash32(String(i), 2) & 1 ? 1 : -1))
  }

  return signs
}

/** A vector onto the plane through two fixed ±1 hyperplanes seeded by the dimension index; tanh keeps it inside 0..1. */
export function projectVector(vector: readonly number[]): { x: number; y: number } {
  const [sa, sb] = signsFor(vector.length)
  let a = 0
  let b = 0

  for (let i = 0; i < vector.length; i++) {
    const value = vector[i] as number

    a += (sa[i] as number) * value
    b += (sb[i] as number) * value
  }

  const scale = Math.sqrt(Math.max(1, vector.length)) / 2

  return { x: 0.5 + 0.5 * Math.tanh(a / scale), y: 0.5 + 0.5 * Math.tanh(b / scale) }
}

/** Every entry is embedded and carries its vector: the only case the map may call 'embedding'. */
export const modeOf = (entries: readonly MapEntry[]): MapMode => (entries.length > 0 && entries.every(entry => entry.vector !== undefined && entry.vector.length > 1) ? 'embedding' : 'hash')

const subsets = new WeakMap<readonly MapEntry[], { entries: readonly MapEntry[]; omitted: number }>()

/**
 * What is drawn. A store usually has some entries with no vector (an entry stored with embeddings off). If at least half have one, the
 * map draws only those, in the embedding layout, and says how many it left out; below half it keeps every entry in the hash layout. One
 * answer per entries array, so the picture and the rows of a frame agree and the layout cache still hits.
 */
export function drawable(entries: readonly MapEntry[]): { entries: readonly MapEntry[]; omitted: number } {
  const known = subsets.get(entries)

  if (known !== undefined) return known

  const withVector = entries.filter(entry => entry.vector !== undefined && entry.vector.length > 1)
  const answer = withVector.length > 0 && withVector.length < entries.length && withVector.length * 2 >= entries.length ? { entries: withVector, omitted: entries.length - withVector.length } : { entries, omitted: 0 }

  subsets.set(entries, answer)

  return answer
}

const laidOut = new WeakMap<readonly MapEntry[], { mode: MapMode; points: MapPoint[] }>()

/**
 * The plane: positions in 0..1 for each entry, by `modeOf`. Deterministic: the same entries land in the same places. Remembered per
 * entries array (a probe hands the same array to every frame until it refreshes), so the picture and the rows of one frame lay out once.
 */
export function layout(entries: readonly MapEntry[]): { mode: MapMode; points: MapPoint[] } {
  const known = laidOut.get(entries)

  if (known !== undefined) return known

  const placed = layoutOf(entries)

  laidOut.set(entries, placed)

  return placed
}

function layoutOf(entries: readonly MapEntry[]): { mode: MapMode; points: MapPoint[] } {
  const mode = modeOf(entries)
  const spaces = spacesOf(entries)
  const n = spaces.length
  const slot = new Map(spaces.map((space, i) => [space, i]))
  // Ring radius and cluster radius, in -1..1 units: clusters of neighbouring namespaces on the ring just touch.
  const ring = n === 1 ? 0 : 0.6
  const spread = n === 1 ? 0.85 : Math.min(0.4, 0.9 * ring * Math.sin(Math.PI / n))

  const points = entries.map((entry): MapPoint => {
    const meta = { key: entry.key, namespace: entry.namespace, hasVector: entry.hasVector, ...(entry.accessCount !== undefined && { accessCount: entry.accessCount }) }

    if (mode === 'embedding') return { ...meta, ...projectVector(entry.vector as readonly number[]) }

    const angle = ((slot.get(entry.namespace) ?? 0) / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2
    const around = unit(entry.key, 3) * Math.PI * 2
    const reach = Math.sqrt(unit(entry.key, 4)) * spread

    return { ...meta, x: (Math.cos(angle) * ring + Math.cos(around) * reach + 1) / 2, y: (Math.sin(angle) * ring + Math.sin(around) * reach + 1) / 2 }
  })

  return { mode, points }
}

/** A dot's glyph by how often the entry was read: a speck for never or unknown, then growing discs. */
export function glyphOf(accessCount: number | undefined): string {
  const reads = accessCount ?? 0

  return reads <= 0 ? '·' : reads < 3 ? '•' : reads < 10 ? '●' : '◉'
}

export const MAP_ROWS = 14

/**
 * The map. With hits, those entries are drawn bright as ◆ with a white ring cell beside them and every other dot is dimmed, so a
 * search reads as a lit set; with none, all dots are full colour. The busiest entry of a cell wins it, a hit always wins.
 */
export function memmapPicture(points: readonly MapPoint[], spaces: readonly string[], hits: ReadonlySet<string>, columns: number, rows = MAP_ROWS): Grid {
  const grid = new Grid(columns, rows)
  const searching = hits.size > 0
  const best = new Map<number, { rank: number; point: MapPoint }>()
  const rings: { x: number; y: number; color: number }[] = []

  for (const point of points) {
    const cx = Math.max(0, Math.min(columns - 1, Math.floor(point.x * columns)))
    const cy = Math.max(0, Math.min(rows - 1, Math.floor(point.y * rows)))
    const rank = (hits.has(`${point.namespace}/${point.key}`) ? 1_000_000 : 0) + (point.accessCount ?? 0)
    const held = best.get(cy * columns + cx)

    if (held === undefined || rank > held.rank) best.set(cy * columns + cx, { rank, point })
  }

  for (const [at, { rank, point }] of best) {
    const x = at % columns
    const y = Math.floor(at / columns)
    const color = SPACE_COLORS[Math.max(0, spaces.indexOf(point.namespace)) % SPACE_COLORS.length] as number

    if (rank >= 1_000_000) {
      grid.set(x, y, '◆', 0xffffff)
      rings.push({ x, y, color })
    } else {
      grid.set(x, y, glyphOf(point.accessCount), searching ? mix(color, 0x000000, 0.65) : color)
    }
  }

  // Rings go only into cells nothing else holds, so a hit never overwrites a neighbour.
  for (const { x, y, color } of rings) {
    if (grid.glyph(x - 1, y) === 0x20) grid.set(x - 1, y, '(', color)
    if (grid.glyph(x + 1, y) === 0x20) grid.set(x + 1, y, ')', color)
  }

  if (points.length === 0) grid.text(0, 0, 'no entries', COLOR.dim)

  return grid
}
