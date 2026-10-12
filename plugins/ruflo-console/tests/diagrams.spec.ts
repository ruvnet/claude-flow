/**
 * Every diagram keeps its size across time (a blit must match the mounted Raster), counts on the real clock where its
 * motion is data, and stays inside the frame budget at 100 agents. Pure: run with `npx vitest run plugins/ruflo-console`.
 */
import { describe, expect, it } from 'vitest'

import { gaugePicture, pipelinePicture, radarPicture, samplesPicture, trendPicture } from '../hooks/gfx/charts'
import { flowModelOf, flowPicture, flowRows, ringOf } from '../hooks/gfx/flow'
import { federationPicture, ganttPicture, heatmapPicture } from '../hooks/gfx/maps'
import { BOOT_MODULES, BOOT_ROWS } from '../hooks/gfx/boot'
import { activityPicture, bannerPicture, bootPicture, curvePicture, edges, headerPicture, layout, markPicture, palettePicture, topologyPicture, type TopoModel } from '../hooks/gfx/pictures'
import { isBooting, newState, optionsOf } from '../hooks/state'
import type { Grid } from '../hooks/gfx/raster'
import { parseClaims, type ClaimRecord } from '../hooks/data/parse'
import { RUFLO_FILES } from './fixtures/ruflo-run'

const glyphs = (grid: Grid, y = 0) => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y))).join('')
const claims = parseClaims(RUFLO_FILES['.claude-flow/claims/claims.json'] ?? null)
const swarmOf = (n: number, topology: string, busyEvery = 3): TopoModel => ({
  topology,
  nodes: [{ id: 'q', label: 'queen', status: 'leader', isLeader: true }, ...Array.from({ length: n - 1 }, (_, i) => ({ id: `a${i}`, label: `agent-${i}`, status: i % busyEvery === 0 ? 'busy' : 'idle', isLeader: false, pulseAtMs: 1_000 }))],
})

/** Every diagram, drawn at instant `t`, at a fixed size per diagram. */
function all(t: number): [string, Grid, number, number][] {
  const cards = flowModelOf(claims, [])

  return [
    ['topology', topologyPicture(swarmOf(4, 'hierarchical'), 90, 12, t), 90, 12],
    ['topology-mesh', topologyPicture(swarmOf(8, 'mesh'), 90, 14, t), 90, 14],
    ['activity', activityPicture([{ label: 'a', values: [1, 2, 3] }, { label: 'b', values: [] }], 80, t), 80, 2],
    ['curve', curvePicture([true, false, true], 80, 6, t, 500), 80, 6],
    ['mark', markPicture(true, t), 2, 1],
    ['header', headerPicture('◆ ruflo · proj', 40, t), 40, 1],
    ['flow', flowPicture(cards, 100, flowRows(cards), t), 100, flowRows(cards)],
    ['pipeline', pipelinePicture([{ name: 'RETRIEVE', count: 30_797, source: '' }, { name: 'JUDGE', count: 9, source: '' }, { name: 'DISTILL', count: null, source: '' }, { name: 'CONSOLIDATE', count: 0, source: '' }], 100, t, [null, 900, null, null]), 100, 4],
    ['radar', radarPicture([42, 12, 35, 90, 6].map((value, i) => ({ name: `d${i}`, value })), 80, 13, t, 0), 80, 13],
    ['trend', trendPicture([0, 2, 1, 3], 80, 4, 4, { top: 'critical', bottom: 'clean', empty: 'n/a' }), 80, 4],
    ['gauge', gaugePicture(3.9, 5, 60, 9), 60, 9],
    ['burn', samplesPicture('spend', [{ value: 0.1 }, { value: 0.4 }], 80), 80, 1],
    ['fedmap', federationPicture('this node', [{ label: 'peer-a', trust: 'pinned', trafficAtMs: 0 }, { label: '#ops', trust: 'channel' }, { label: 'npub1x', trust: 'roster' }], 80, 11, t), 80, 11],
    ['health', heatmapPicture([{ name: 'core', cells: [true, true, true, null] }, { name: 'mods', cells: [false, null, false, true] }], ['installed', 'enabled', 'clone', 'mod'], 80, 5), 80, 5],
    ['gantt', ganttPicture([{ label: 'coder', spans: [{ fromMs: 0, toMs: 500, busy: true }], ticks: [200] }], 80, 0, 1_000), 80, 2],
  ]
}

describe('diagrams', () => {
  it('every diagram keeps its size across t, so every frame fits the mounted Raster', () => {
    for (const t of [0, 1_234, 99_999]) {
      for (const [name, grid, columns, rows] of all(t)) {
        expect([name, grid.columns, grid.rows]).toEqual([name, columns, rows])
        expect(grid.encode().length, name).toBe(Math.ceil((columns * rows * 12) / 3) * 4)
      }
    }
  })

  it('the topology lays out a tree, a ring and a mesh from the real topology, and wraps a large swarm into tiers', () => {
    expect(edges(swarmOf(5, 'hierarchical'))).toEqual([[0, 1], [0, 2], [0, 3], [0, 4]])
    expect(edges(swarmOf(4, 'ring'))).toEqual([[0, 1], [1, 2], [2, 3], [3, 0]])
    expect(edges(swarmOf(4, 'mesh'))).toHaveLength(6)
    expect(edges(swarmOf(100, 'mesh'))).toHaveLength(300)

    const tiers = new Set(layout(swarmOf(100, 'hierarchical'), 220, 96).slice(1).map(point => Math.round(point.y)))

    expect(tiers.size).toBeGreaterThan(1)
  })

  it('an event pulse is data: it runs only in the 1.4 s after its event, and the frames differ while it does', () => {
    const idle = (model: TopoModel): TopoModel => ({ ...model, nodes: model.nodes.map(node => (node.isLeader ? node : { ...node, status: 'idle' })) })
    const model = idle(swarmOf(3, 'hierarchical', 99))
    const frame = (t: number) => topologyPicture(model, 60, 12, t).encode()

    expect(frame(1_300)).not.toBe(frame(1_900))
    // Before the event, with every agent idle, at two instants where the heartbeat (decoration) rests: nothing else moves.
    expect(frame(0)).toBe(frame(Math.PI * 260))
  })

  it('work in flight is data too: a busy agent keeps a dot moving with no event, and it stops when the agent goes idle', () => {
    const busy: TopoModel = { topology: 'hierarchical', nodes: [{ id: 'q', label: 'queen', status: 'leader', isLeader: true }, { id: 'a', label: 'coder', status: 'busy', isLeader: false }] }
    const idle: TopoModel = { ...busy, nodes: busy.nodes.map(node => (node.isLeader ? node : { ...node, status: 'idle' })) }
    // Two instants where the leader's heartbeat rests, so only data can differ between them.
    const [t0, t1] = [0, Math.PI * 260]

    expect(topologyPicture(busy, 60, 12, t0).encode()).not.toBe(topologyPicture(busy, 60, 12, t1).encode())
    expect(topologyPicture(idle, 60, 12, t0).encode()).toBe(topologyPicture(idle, 60, 12, t1).encode())
  })

  it('claims fall in their lanes and a ring counts down a TTL on the real clock, else fills with age', () => {
    expect(flowModelOf(claims, []).map(card => [card.id, card.lane])).toEqual([
      ['console-demo-1', 'claimed'],
      ['console-demo-2', 'stealable'],
    ])

    const ttl = { id: 'c', owner: 'coder', lane: 'claimed' as const, claimedAtMs: 0, expiresAtMs: 100_000 }

    expect(ringOf(ttl, 10_000)).toMatchObject({ glyph: '●', words: 'ttl 90s', isExpired: false })
    expect(ringOf(ttl, 80_000)).toMatchObject({ glyph: '◔', isExpired: false })
    expect(ringOf(ttl, 200_000)).toMatchObject({ words: 'expired', isExpired: true })
    expect(ringOf({ ...ttl, expiresAtMs: undefined }, 12 * 3_600_000).glyph).toBe('◑')

    const handoff: ClaimRecord = { issueId: 'h1', status: 'handoff-pending', claimant: { kind: 'agent', id: 'a', agentType: 'coder' }, isStealable: false, handoffTo: 'tester-1' }

    expect(glyphs(flowPicture(flowModelOf([handoff], []), 100, 4, 0), 2)).toContain('╰─▶tester-1')
  })

  it('the gauge has no needle without a budget, and the learning stages print n/a for what nothing measures', () => {
    expect(glyphs(gaugePicture(1, null, 60, 9), 8)).toContain('no budget set')
    expect(glyphs(gaugePicture(3.9, 5, 60, 9), 8)).toContain('$3.90 of $5.00 (78%)')
    expect(glyphs(pipelinePicture([{ name: 'DISTILL', count: null, source: '' }], 40, 0, [null]), 2)).toContain('n/a')
  })

  it('a frame of the 100-agent topology stays within the 4 ms budget (median of 50)', () => {
    const model = swarmOf(100, 'hierarchical')
    const times: number[] = []

    for (let i = 0; i < 50; i++) {
      const start = performance.now()

      topologyPicture(model, 160, 24, i * 83).encode()
      times.push(performance.now() - start)
    }

    times.sort((a, b) => a - b)
    expect(times[25]).toBeLessThan(4)
  })
})

describe('BBS look', () => {
  const row = (grid: ReturnType<typeof bannerPicture>, y: number, width: number) => String.fromCodePoint(...Array.from({ length: width }, (_, x) => grid.glyph(x, y) || 32))

  it('the banner spells RUFLO in two half-block rows, names the node, and its cursor blinks', () => {
    const on = bannerPicture('ruflo-demo', 60, 0)
    const off = bannerPicture('ruflo-demo', 60, 530)

    expect(row(on, 0, 19)).toBe('█▀█ █ █ █▀▀ █   █▀█')
    expect(row(on, 1, 19)).toBe('█▀▄ █▄█ █▀  █▄▄ █▄█')
    expect(row(on, 1, 60)).toContain('▸ npx ruflo · ruflo-demo █')
    expect(row(off, 1, 60).slice(21)).not.toContain('█')
    expect(on.encode()).not.toBe(off.encode())
  })

  it('bbs is the default look; plain is the only other value', () => {
    expect(optionsOf(undefined).look).toBe('bbs')
    expect(optionsOf({ look: 'plain' } as never).look).toBe('plain')
    expect(optionsOf({ look: 'neon' } as never).look).toBe('bbs')
  })
})

describe('BBS boot screen', () => {
  const text = (grid: ReturnType<typeof bootPicture>, width: number) => Array.from({ length: grid.rows }, (_, y) => String.fromCodePoint(...Array.from({ length: width }, (_, x) => grid.glyph(x, y) || 32))).join('\n')

  it('draws the logo and fills a bar from elapsed time and answered reads, with no modem dial-up', () => {
    for (const age of [100, 700, 2_000, 5_400]) {
      const shown = text(bootPicture('demo', 60, age, 5, 10), 60)

      expect(shown, `${age} ms`).not.toMatch(/ATDT|RING|CONNECT 115200/)
    }

    const done = text(bootPicture('demo', 60, 5_400, 10, 10), 60)

    expect(done).toContain('│ ~~~~~ │')
    expect(done).toContain('▐▌')
    // The tubes are dark before the sign switches on, lit once it has: the same cell, two colours.
    const fgAt = (age: number) => { const g = bootPicture('demo', 60, age, 3, 10); for (let i = 0; i < g.columns * g.rows; i++) if (g.cells[i * 3] === 0x256d) return g.cells[i * 3 + 1]; return -1 }
    expect(fgAt(300)).not.toBe(fgAt(3_800))
    expect(done).toContain('> handshake ok · node demo')
    expect(done).toContain('100%  reads 10/10')
  })

  it('brings every area online in a log under the sign, as many lines as the pane has rows, newest in view, READY last', () => {
    const rows = BOOT_ROWS + 1 + BOOT_MODULES.length + 1

    // Nothing is logged before the handshake; one line per 120 ms after it.
    expect(text(bootPicture('demo', 80, 1_000, 0, 10, rows), 80)).not.toContain('[ OK ]')
    expect(text(bootPicture('demo', 80, 1_550, 0, 10, rows), 80)).toContain('[ .. ] Missions')
    expect(text(bootPicture('demo', 80, 1_700, 0, 10, rows), 80)).toContain('[ OK ] Missions')
    expect(text(bootPicture('demo', 80, 1_700, 0, 10, rows), 80)).not.toContain('Hive-Mind')

    // Every area, in menu order, then READY.
    const full = text(bootPicture('demo', 80, 5_400, 10, 10, rows), 80)

    for (const entry of BOOT_MODULES) expect(full).toContain(entry.name)
    expect(full.indexOf('Missions')).toBeLessThan(full.indexOf('Settings'))
    expect(full).toContain(`[ OK ] READY`)
    expect(full).toContain(`${BOOT_MODULES.length} areas online`)
    expect(full).toContain('100%  reads 10/10')

    // A short pane shows the newest lines, not the oldest; no rows given: the sign alone, as before.
    const short = text(bootPicture('demo', 80, 5_400, 10, 10, BOOT_ROWS + 1 + 5), 80)

    expect(short).toContain('READY')
    expect(short).not.toContain('Missions')
    expect(bootPicture('demo', 80, 5_400, 10, 10).rows).toBe(BOOT_ROWS)
  })

  it('reports the self-check: [ OK ] only for an area whose check passed, [FAIL] and its problem for one that did not, READY counting what was verified', () => {
    const rows = BOOT_ROWS + 1 + BOOT_MODULES.length + 1
    const passing = BOOT_MODULES.map(entry => ({ area: entry.name, ok: true, problems: [] as string[] }))
    const withFailure = passing.map(result => (result.area === 'Security' ? { ...result, ok: false, problems: ['aid-check: an empty field must be refused'] } : result))
    const good = text(bootPicture('demo', 80, 5_400, 10, 10, rows, passing), 80)
    const bad = text(bootPicture('demo', 80, 5_400, 10, 10, rows, withFailure), 80)

    expect(good).toContain('[ OK ] Security')
    expect(good).toContain(`${BOOT_MODULES.length} of ${BOOT_MODULES.length} areas verified`)
    expect(good).toContain('[ OK ] READY')
    expect(good).not.toContain('[FAIL]')

    expect(bad).toContain('[FAIL] Security')
    expect(bad).toContain('aid-check: an empty field must be refused')
    expect(bad).toContain('[ OK ] Missions')
    expect(bad).toContain(`${BOOT_MODULES.length - 1} of ${BOOT_MODULES.length} areas verified · 1 failed`)
    expect(bad).toContain('[FAIL] READY')

    // An area still starting shows [ .. ] whatever its verdict: the result appears when the next area begins.
    const securityAt = 1_500 + 120 * BOOT_MODULES.findIndex(entry => entry.name === 'Security')

    expect(text(bootPicture('demo', 80, securityAt + 10, 10, 10, rows, withFailure), 80)).toContain('[ .. ] Security')
  })

  it('plays at least 5.4 s, longer while the first read is out, never past 8 s; only with the bbs look and boot on', () => {
    const state = newState({})

    state.pane.bootAtMs = 1_000
    expect(isBooting(state, 1_100)).toBe(true)
    expect(isBooting(state, 7_000)).toBe(true) // past the 5.4 s minimum, but no snapshot yet
    state.snapshot = {} as never
    expect(isBooting(state, 7_000)).toBe(false)
    expect(isBooting(state, 2_000)).toBe(true)
    state.snapshot = null
    expect(isBooting(state, 9_500)).toBe(false)
    expect(isBooting({ ...state, options: { ...state.options, boot: false } }, 1_100)).toBe(false)
    expect(isBooting({ ...state, options: { ...state.options, look: 'plain' } }, 1_100)).toBe(false)
  })
})

describe('the menu palette strip', () => {
  const colors = [0xff0000, 0x00ff00, 0x0000ff]
  const fg = (grid: ReturnType<typeof palettePicture>, x: number): number => grid.cells[x * 3 + 1] as number
  const base = (x: number, columns: number): number => colors[Math.min(colors.length - 1, Math.floor((x * colors.length) / columns))] as number
  /** The cell the light is on: the one furthest from its own colour. */
  const litAt = (grid: ReturnType<typeof palettePicture>): number => {
    const far = (x: number): number => [0, 8, 16].reduce((sum, shift) => sum + Math.abs(((fg(grid, x) >> shift) & 255) - ((base(x, grid.columns) >> shift) & 255)), 0)

    return Array.from({ length: grid.columns }, (_, x) => x).sort((a, b) => far(b) - far(a))[0] as number
  }

  it('is one row of blocks, and at rest is exactly the colours, a segment each', () => {
    const grid = palettePicture(60, 0, colors)

    expect([grid.columns, grid.rows]).toEqual([60, 1])
    for (let x = 0; x < 60; x++) {
      expect(grid.cells[x * 3], `char ${x}`).toBe(0x2580)
      expect(fg(grid, x), `colour ${x}`).toBe(base(x, 60))
    }
    expect(fg(grid, 0)).toBe(0xff0000)
    expect(fg(grid, 30)).toBe(0x00ff00)
    expect(fg(grid, 59)).toBe(0x0000ff)
  })

  it('has a band of light that brightens the cells it is on and leaves the rest alone', () => {
    const grid = palettePicture(60, 1_512, colors)

    expect(litAt(grid)).toBe(30)
    expect(fg(grid, 30)).not.toBe(base(30, 60))
    expect((fg(grid, 30) >> 16) & 255).toBeGreaterThan(150)
    expect(fg(grid, 0)).toBe(base(0, 60))
    expect(fg(grid, 59)).toBe(base(59, 60))
  })

  it('moves along the strip as the clock runs, about three cells a frame at 8 fps, and starts again after it leaves', () => {
    expect(litAt(palettePicture(60, 1_512, colors))).toBe(30)
    expect(litAt(palettePicture(60, 1_512 + 360, colors))).toBe(40)
    expect(Array.from(palettePicture(60, 36 * 84, colors).cells)).toEqual(Array.from(palettePicture(60, 0, colors).cells))
    expect(Array.from(palettePicture(60, 0, colors).cells)).not.toEqual(Array.from(palettePicture(60, 1_512, colors).cells))
  })

  it('holds for a tiny width and an empty list of colours without throwing', () => {
    expect(palettePicture(1, 500, colors).columns).toBe(1)
    expect(palettePicture(8, 500, []).rows).toBe(1)
  })
})
