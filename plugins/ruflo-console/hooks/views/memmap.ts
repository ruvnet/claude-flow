import type { RenderElement } from 'claude-code'

import type { Namespaces } from '../data/cli'
import { hitsOf, isHit } from '../data/memmap'
import { drawable, layout, MAP_ROWS, memmapPicture, SPACE_COLORS, spacesOf, type MapEntry, type MapPoint } from '../gfx/memmap'
import type { Grid } from '../gfx/raster'
import type { State } from '../state'
import { clip, count, live, row, rule, text, type Ctx } from './common'
import { note } from './subhead'

/** Namespaces named in the key at most: a store with hundreds would otherwise grow the page without bound. */
const LEGEND_MAX = 12

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`

/** The entries the map draws: the map's own probe (has read counts), else the Namespaces sample (no counts, so every dot is a speck). */
export function mapEntriesFrom(state: State): { entries: MapEntry[]; hasCounts: boolean } {
  const own = live<MapEntry[]>(state.probes.get('memmap'))

  if (own !== null) return { entries: own, hasCounts: true }

  const sample = live<Namespaces>(state.probes.get('namespaces'))

  return { entries: (sample?.entries ?? []).map(entry => ({ key: entry.key, namespace: entry.namespace, hasVector: entry.hasVector })), hasCounts: false }
}

/** The last memory search's hits as the `namespace/key` of entries on the map. */
function litOf(state: State, points: readonly MapPoint[]): { lit: Set<string>; named: number } {
  const result = state.lab.result
  const hits = result !== null && result.ok && (result.id === 'mem-search' || result.id === 'mem-unified') ? hitsOf(result.lines) : new Set<string>()
  const lit = new Set(points.filter(point => isHit(hits, point)).map(point => `${point.namespace}/${point.key}`))

  return { lit, named: hits.size }
}

/** The map for one frame, by Raster key; none while there is nothing to draw (the view then says so). */
export function memmapPictures(state: State, columns: number): Map<string, Grid> {
  const listed = mapEntriesFrom(state).entries
  const pictures = new Map<string, Grid>()

  if (listed.length === 0) return pictures

  const { entries } = drawable(listed)
  const { points } = layout(entries)

  pictures.set('memmap', memmapPicture(points, spacesOf(entries), litOf(state, points).lit, Math.max(20, Math.min(columns, 100)), MAP_ROWS))

  return pictures
}

/** The frame's mounted map if the integrator wired one, else the same picture drawn here (static: the map does not animate). */
function mapPicture(ctx: Ctx, entries: number, spaces: number): RenderElement {
  const grid = ctx.pictures.get('memmap') ?? memmapPictures(ctx.state, ctx.columns - 2).get('memmap')

  return grid === undefined || ctx.kit.Raster === undefined ? text(ctx, `the map needs a terminal that draws pictures: ${entries} entries in ${spaces} namespaces`, { dimColor: true }) : ctx.kit.Raster(grid.toRaster('memmap'))
}

/** The memory map section: the picture, what its places mean (said plainly), the namespace colours and what the last search lit. */
export function memmapRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const { entries: listed, hasCounts } = mapEntriesFrom(state)

  if (listed.length === 0) {
    return [rule(ctx, 'Memory map'), text(ctx, sourceFallback(state, nowMs), { dimColor: true })]
  }

  const { entries, omitted } = drawable(listed)
  const { mode, points } = layout(entries)
  const spaces = spacesOf(entries)
  const { lit, named } = litOf(state, points)
  const result = state.lab.result
  const searched = result !== null && (result.id === 'mem-search' || result.id === 'mem-unified')
  const rows: RenderElement[] = [
    rule(ctx, 'Memory map', `${entries.length} entries · ${spaces.length} namespace${spaces.length === 1 ? '' : 's'} · ${mode === 'embedding' ? 'embedding layout' : 'hash layout'}${omitted > 0 ? ` · ${omitted} without a vector not drawn` : ''}`),
    mapPicture(ctx, entries.length, spaces.length),
  ]

  // Namespace colours, in rows no wider than the pane: the entry count is the listed sample's, like the bars above.
  const perSpace = new Map<string, number>()

  for (const entry of entries) perSpace.set(entry.namespace, (perSpace.get(entry.namespace) ?? 0) + 1)

  let line: RenderElement[] = []
  let used = 0
  let index = 0

  for (const space of spaces.slice(0, LEGEND_MAX)) {
    const label = ` ● ${clip(space, 20)} ${count(perSpace.get(space))} `

    if (used + label.length > ctx.columns - 4 && line.length > 0) {
      rows.push(row(ctx, line, `memmap-key-${index}`))
      line = []
      used = 0
    }

    line.push(ctx.kit.Text({ color: hex(SPACE_COLORS[index % SPACE_COLORS.length] as number), children: label }))
    used += label.length
    index += 1
  }

  if (line.length > 0) rows.push(row(ctx, line, `memmap-key-${index}`))

  if (spaces.length > LEGEND_MAX) rows.push(note(ctx, `+ ${spaces.length - LEGEND_MAX} more namespaces not in the key; colours repeat after ${SPACE_COLORS.length}, so a colour is not a unique namespace`))
  else if (spaces.length > SPACE_COLORS.length) rows.push(note(ctx, `colours repeat after ${SPACE_COLORS.length} namespaces, so a colour is not a unique namespace`))

  rows.push(note(ctx, hasCounts ? 'dot size is how often the entry was read:  · never   • 1-2   ● 3-9   ◉ 10 or more' : 'read counts n/a (the map’s own list is not loaded yet): every dot is drawn as a speck'))

  rows.push(
    note(
      ctx,
      mode === 'embedding'
        ? `layout: each entry’s stored embedding projected to 2D by a fixed random projection (read from the store, not recomputed); near means similar, but a 2D projection loses most of the distance${omitted > 0 ? `; ${omitted} listed entr${omitted === 1 ? 'y has' : 'ies have'} no stored vector and ${omitted === 1 ? 'is' : 'are'} left off the map` : ''}`
        : 'layout: NOT similarity. No stored vectors were read for most entries (an older CLI does not print them, or most entries have none), so each namespace has a fixed place and each entry a hash of its key scatters it inside; near means the same namespace only',
    ),
  )

  rows.push(
    text(
      ctx,
      searched
        ? lit.size > 0
          ? ` ◆ ${lit.size} of ${entries.length} listed entries lit by “${clip(state.memoryLab.query, 40)}”${named > lit.size ? ` · ${named - lit.size} more hit${named - lit.size === 1 ? ' is' : 's are'} outside the listed sample` : ''}`
          : ` the last search named ${named === 0 ? 'no entries' : `${named} entr${named === 1 ? 'y' : 'ies'}, none in the listed sample`}: nothing to light`
        : ' search below (Enter) to light the entries it finds',
      lit.size > 0 ? {} : { dimColor: true },
    ),
  )

  return rows
}

/** Why there is nothing to map: the probe's own state, or an empty store. */
function sourceFallback(state: State, nowMs: number): string {
  const probe = state.probes.get('memmap') ?? state.probes.get('namespaces')

  if (probe === undefined || (probe.value === null && probe.error === null)) return ' reading `memory list` …'
  if (probe.error !== null && probe.value === null) return ` n/a: ${probe.error} (${Math.round((nowMs - (probe.errorAtMs ?? nowMs)) / 1000)}s ago)`

  return ' nothing stored yet: store an entry or import your Claude memories, and it appears here'
}
