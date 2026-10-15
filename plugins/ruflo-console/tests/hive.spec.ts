/**
 * The Hive-Mind's pure parts: the hive file read with every field the CLI writes (and never its token), the CLI's quorum
 * arithmetic, the actions' argv, the vote events, and the honeycomb's layout, size and stillness. Pure: run with
 * `npx vitest run plugins/ruflo-console/tests/hive.spec.ts`.
 */
import { describe, expect, it } from 'vitest'

import { diffEvents } from '../hooks/data/events'
import { Arrivals, faultTolerance, membersOf, nextVoter, pickedProposal, proposalStrategyOf, proposeBlock, requiredVotes, tallyOf, waveOf } from '../hooks/data/hive'
import { parseAgents, parseHive, parseHiveAgents, type HiveInfo } from '../hooks/data/parse'
import type { Snapshot } from '../hooks/data/snapshot'
import { CELL_BG, CELL_H, CELL_W, cellOrigin, drawWalls, fieldOf, haloColor, HEARTBEAT_MS, heroRows, hexDistance, HIVE_COLOR, hivePicture, INTERIOR, type HiveCell, type HivePictureModel, type Role } from '../hooks/gfx/hive'
import { chamberLayout, chamberRows, chambersPicture, type Chamber } from '../hooks/gfx/hive-chamber'
import { EGG_BOTTOM_ROWS, EGG_TOP_ROWS, eggBottomPicture, eggTopPicture } from '../hooks/gfx/hive-egg'
import { axisAt, STRIP_ROWS, stripPicture, tickerShift, type StripModel } from '../hooks/gfx/hive-strip'
import { DEFAULT, Grid } from '../hooks/gfx/raster'
import { hiveBroadcast, hivePropose, hiveSpawn, hiveVote, proposalText } from '../hooks/hive'
import { BFT_ID, HIVE_AGENTS, HIVE_STATE, RAFT_ID, WORKERS } from './fixtures/hive'
import { HIVE_TOKEN } from './fixtures/ruflo-run'
import { stripOf } from '../hooks/views/hive'

const hive = parseHive(JSON.stringify(HIVE_STATE)) as HiveInfo
const NOW = Date.parse('2026-10-02T01:10:10.000Z')
const withHive = (next: HiveInfo | null) => ({ hive: next, agents: [], claims: [], tasks: [], swarm: null, neural: null, outcomes: null, federationNodes: null, missions: null, hasNostrKey: null }) as unknown as Snapshot
const ROLES: Role[] = ['worker', 'specialist', 'scout']
const cellModel = (members: number, extra: Partial<HiveCell> = {}, scars: HivePictureModel['scars'] = []): HivePictureModel => ({
  queen: { tag: 'T2', isKnown: true },
  members: Array.from({ length: members }, (_, i) => ({ id: `w${i}`, role: ROLES[i % 3] as Role, glow: i % 2 === 0 ? 'busy' : 'idle', tag: `w${i}`, ...(i === 0 && extra) })),
  scars,
})

/** A picture as text, one line per row, for a still in the test output. */
const stillOf = (grid: Grid): string =>
  Array.from({ length: grid.rows }, (_, y) =>
    Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y)))
      .join('')
      .trimEnd(),
  ).join('\n')
const fg = (grid: Grid, x: number, y: number) => grid.cells[(y * grid.columns + x) * 3 + 1] as number
const bg = (grid: Grid, x: number, y: number) => grid.cells[(y * grid.columns + x) * 3 + 2] as number
const at = (grid: Grid, x: number, y: number) => String.fromCodePoint(grid.glyph(x, y))

/** The xterm-256 index Claude Code would draw a colour as where the terminal has no true colour: nearest of 16..255. */
function xterm256(color: number): number {
  const levels = [0, 95, 135, 175, 215, 255]
  const table: number[] = []

  for (const r of levels) for (const g of levels) for (const b of levels) table.push((r << 16) | (g << 8) | b)
  for (let i = 0; i < 24; i++) table.push((8 + 10 * i) * 0x010101)

  const distance = (a: number, b: number) => [16, 8, 0].reduce((sum, shift) => sum + (((a >> shift) & 255) - ((b >> shift) & 255)) ** 2, 0)
  let best = 0

  table.forEach((entry, i) => {
    if (distance(entry, color) < distance(table[best] as number, color)) best = i
  })

  return best + 16
}

describe('the hive file', () => {
  it('reads the queen, term, strategy, ballots, raft and bft fields, history, broadcasts and memory keys', () => {
    expect(hive).toMatchObject({ topology: 'hierarchical', strategy: 'raft', queen: 'queen-1790903321632', queenTerm: 2, workers: [...WORKERS] })
    expect(hive.pending[0]).toMatchObject({ id: RAFT_ID, type: 'design', strategy: 'raft', term: 2, value: 'use raft for the console', proposedBy: 'console-operator', votesFor: 1, votesAgainst: 0, ballots: [{ voter: WORKERS[0], isFor: true }] })
    expect(hive.pending[0]?.timeoutAtMs).toBe(Date.parse('2026-10-02T01:10:30.000Z'))
    expect(hive.pending[1]).toMatchObject({ id: BFT_ID, strategy: 'bft', value: '{"target":"staging"}', byzantine: [WORKERS[2]], votesAgainst: 1 })
    expect(hive.history.map(entry => [entry.type, entry.result, entry.strategy, entry.byzantine])).toEqual([['naming', 'approved', 'raft', 0], ['budget', 'rejected', 'bft', 1]])
    expect(hive.broadcasts.map(entry => [entry.priority, entry.from, entry.message])).toEqual([['normal', 'console-operator', 'standup in 5'], ['high', 'system', 'freeze the main branch']])
    expect(hive.memoryKeys).toEqual(['broadcasts', 'design-notes'])
    expect(JSON.stringify(hive)).not.toContain(HIVE_TOKEN)
  })

  it('keeps each spawned worker\'s hive role, and says which hive workers no store knows', () => {
    const spawned = parseHiveAgents(JSON.stringify(HIVE_AGENTS))
    const members = membersOf(hive, spawned, parseAgents(null))

    expect(spawned.map(agent => agent.role)).toEqual(['worker', 'specialist'])
    expect(members.map(member => [member.role, member.liveness, member.isKnown])).toEqual([['worker', 'busy', true], ['specialist', 'idle', true], ['n/a', 'unknown', false]])
  })
})

describe('quorum, as the CLI counts it', () => {
  it('requires the votes calculateRequiredVotes does', () => {
    expect(requiredVotes('bft', 4)).toBe(3)
    expect(requiredVotes('raft', 4)).toBe(3)
    expect(requiredVotes('raft', 3)).toBe(2)
    expect(requiredVotes('quorum', 4, 'unanimous')).toBe(4)
    expect(requiredVotes('quorum', 6, 'supermajority')).toBe(5)
    expect(requiredVotes('raft', 0)).toBe(1)
  })

  it('states fault tolerance only where the strategy has a bound', () => {
    expect(faultTolerance('byzantine', 4)).toEqual({ faulty: 1, of: 4, rule: 'byzantine f < n/3' })
    expect(faultTolerance('raft', 5)).toEqual({ faulty: 2, of: 5, rule: 'raft f < n/2' })
    expect(faultTolerance('gossip', 5)).toBeNull()
    expect(faultTolerance('raft', 0)).toBeNull()
    expect([proposalStrategyOf('byzantine'), proposalStrategyOf('quorum'), proposalStrategyOf('crdt')]).toEqual(['bft', 'quorum', null])
  })

  it('tallies a proposal against its bar, and sees a raft timeout', () => {
    const tally = tallyOf(hive, hive.pending[0] as HiveInfo['pending'][number], NOW)

    expect([tally.required, tally.nodes, tally.isTimedOut, tally.isDeadlocked]).toEqual([2, 3, false, false])
    expect(tallyOf(hive, hive.pending[0] as HiveInfo['pending'][number], NOW + 60_000).isTimedOut).toBe(true)
    expect(pickedProposal(hive, -1)?.id).toBe(BFT_ID)
  })
})

describe('hive actions', () => {
  it('votes as the next worker without a ballot, through the subcommand that carries the token', () => {
    const proposal = hive.pending[0] as HiveInfo['pending'][number]

    expect(nextVoter(hive, proposal)).toBe(WORKERS[1])
    expect(hiveVote(hive, proposal, false)?.args).toEqual(['hive-mind', 'consensus', '--action', 'vote', '--proposal-id', RAFT_ID, '--vote', 'no', '--voter-id', WORKERS[1], '--format', 'json'])
    expect(hiveVote({ ...hive, workers: [] }, proposal, true)).toBeNull()
  })

  it('refuses a second raft proposal in the same term before asking', () => {
    expect(proposeBlock(hive)).toMatch(/^raft term 2 already has design/)
    expect(hivePropose(hive, 'design: anything')).toBeNull()

    const open = { ...hive, pending: hive.pending.filter(entry => entry.strategy !== 'raft') }

    expect(hivePropose(open, 'review: ship it')?.args).toEqual(['mcp', 'exec', '-t', 'hive-mind_consensus', '-p', JSON.stringify({ action: 'propose', type: 'review', value: 'ship it', voterId: 'console-operator', strategy: 'raft' })])
    expect(proposalText('no prefix here')).toEqual({ type: 'general', value: 'no prefix here' })
    expect(hivePropose(open, '--flag')).toBeNull()
  })

  it('broadcasts and spawns with fixed argv, and only roles the CLI accepts', () => {
    expect(hiveBroadcast('hello hive')?.args).toEqual(['mcp', 'exec', '-t', 'hive-mind_broadcast', '-p', JSON.stringify({ message: 'hello hive', priority: 'normal', fromId: 'console-operator' })])
    expect(hiveSpawn(hive, 'scout')?.args).toEqual(['mcp', 'exec', '-t', 'hive-mind_spawn', '-p', JSON.stringify({ role: 'scout', agentType: 'worker', prefix: 'hive-worker' })])
    expect(hiveSpawn(hive, 'queen')).toBeNull()
  })
})

describe('hive events', () => {
  it('emits one event per new ballot and per join, tagged with that worker', () => {
    const before = { ...hive, workers: WORKERS.slice(0, 2), pending: hive.pending.map(entry => ({ ...entry, ballots: [], votesFor: 0, votesAgainst: 0 })) }
    const events = diffEvents(withHive(before), withHive(hive), 5)

    expect(events.map(event => [event.agentId, event.text])).toEqual(
      expect.arrayContaining([
        [WORKERS[0], `${WORKERS[0]} voted for design (${RAFT_ID})`],
        [WORKERS[1], `${WORKERS[1]} voted against deploy (${BFT_ID})`],
        [WORKERS[2], `${WORKERS[2]} joined the hive`],
      ]),
    )
  })
})

describe('the honeycomb', () => {
  it('fills a comb wider than tall, the queen first, then by distance, no two interiors overlapping, every cell whole', () => {
    const field = fieldOf(110, 21)
    const interiors = new Set<string>()

    expect(field[0]).toEqual([0, 0])
    expect(field.length).toBeGreaterThan(40)
    field.slice(1).forEach(([q, r], i) => expect(hexDistance(q, r)).toBeGreaterThanOrEqual(hexDistance(...(field[i] as [number, number]))))
    expect(field.slice(1, 7).map(([q, r]) => hexDistance(q, r))).toEqual([1, 1, 1, 1, 1, 1])

    for (const [q, r] of field) {
      const { x, y } = cellOrigin(q, r, 110, 21)

      expect(x >= 0 && y >= 0 && x + CELL_W <= 110 && y + CELL_H <= 21).toBe(true)

      for (const [dy, from, to] of INTERIOR) {
        for (let dx = from; dx <= to; dx++) {
          const key = `${x + dx},${y + dy}`

          expect(interiors.has(key)).toBe(false)
          interiors.add(key)
        }
      }
    }
  })

  it('shares every wall with its six neighbours: drawing a neighbour never changes a wall the queen drew', () => {
    const alone = new Grid(40, 21)
    const { x, y } = cellOrigin(0, 0, 40, 21)

    drawWalls(alone, x, y, 1)

    for (const [q, r] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const) {
      const both = new Grid(40, 21)
      const next = cellOrigin(q, r, 40, 21)

      drawWalls(both, x, y, 1)
      drawWalls(both, next.x, next.y, 2)

      for (let cy = 0; cy < 21; cy++) for (let cx = 0; cx < 40; cx++) if (alone.glyph(cx, cy) !== 0x20) expect([cx, cy, at(both, cx, cy)]).toEqual([cx, cy, at(alone, cx, cy)])
    }
  })

  it('crowns the queen in the centre and rings her workers by role, the free cells dim, one ring of rows until it is full', () => {
    const grid = hivePicture(cellModel(6), 80, 0)
    const queen = cellOrigin(0, 0, 80, grid.rows)
    const field = fieldOf(80, grid.rows)
    const glyphAt = (i: number) => {
      const { x, y } = cellOrigin(...(field[i] as [number, number]), 80, grid.rows)

      return at(grid, x + 3, y + 2)
    }

    expect(at(grid, queen.x + 3, queen.y + 2)).toBe('♛')
    expect(fg(grid, queen.x + 3, queen.y + 2)).toBe(HIVE_COLOR.gold)
    // Two of each role, grouped: workers hold one arc of the ring, specialists the next, scouts the last.
    expect([1, 2, 3, 4, 5, 6].map(glyphAt)).toEqual(['●', '●', '◆', '◆', '▲', '▲'])
    expect(glyphAt(7)).toBe(' ')
    const free = cellOrigin(...(field[field.length - 1] as [number, number]), 80, grid.rows)

    expect(fg(grid, free.x + 1, free.y + 1)).toBe(HIVE_COLOR.faint)
    expect([heroRows(0), heroRows(6), heroRows(7), heroRows(60)]).toEqual([13, 13, 21, 21])
    expect([0, 1_234, 99_999].map(t => hivePicture(cellModel(9), 80, t).rows)).toEqual([21, 21, 21])
  })

  it('shows liveness as brightness, on colours that stay distinct in 256 colours', () => {
    const grid = hivePicture(cellModel(2), 60, 0)
    const busy = cellOrigin(...(fieldOf(60, grid.rows)[1] as [number, number]), 60, grid.rows)

    expect(bg(grid, busy.x + 3, busy.y + 2)).toBe(CELL_BG.worker.busy)

    for (const role of ROLES) {
      const levels = [CELL_BG[role].busy, CELL_BG[role].idle, CELL_BG[role].down].map(color => xterm256(color as number))

      expect(new Set(levels).size).toBe(3)
    }

    expect(new Set([HIVE_COLOR.red, HIVE_COLOR.pink, HIVE_COLOR.green, HIVE_COLOR.wall].map(xterm256)).size).toBe(4)
  })

  it('drops each ballot as a dot in its voter\'s cell and walls a Byzantine voter in red', () => {
    const voted = hivePicture({ ...cellModel(3), members: cellModel(3).members.map((cell, i) => ({ ...cell, vote: (['for', 'against', 'pending'] as const)[i] })) }, 60, 0)
    const cells = fieldOf(60, voted.rows).slice(1, 4).map(([q, r]) => cellOrigin(q, r, 60, voted.rows))

    expect(cells.map(({ x, y }) => [at(voted, x + 4, y + 1), fg(voted, x + 4, y + 1)])).toEqual([
      ['●', HIVE_COLOR.green],
      ['●', HIVE_COLOR.pink],
      ['·', HIVE_COLOR.grey],
    ])

    const traitor = hivePicture(cellModel(3, { isByzantine: true, vote: 'for' }), 60, 0)
    const { x, y } = cells[0] as { x: number; y: number }
    let red = 0

    for (let dy = 0; dy < CELL_H; dy++) for (let dx = 0; dx < CELL_W; dx++) if (fg(traitor, x + dx, y + dy) === HIVE_COLOR.red) red += 1

    expect(at(traitor, x + 4, y + 1)).toBe('✖')
    expect(red).toBeGreaterThan(6)
  })

  it('leaves a scar for each decision in the outermost free cells: ✔ passed, ✘ failed', () => {
    const grid = hivePicture(cellModel(2, {}, [{ label: 'naming', isPassed: true }, { label: 'budget', isPassed: false }]), 70, 0)
    const field = fieldOf(70, grid.rows)
    const scar = (i: number) => {
      const { x, y } = cellOrigin(...(field[field.length - 1 - i] as [number, number]), 70, grid.rows)

      return [at(grid, x + 3, y + 2), stillOf(grid).split('\n')[y + 3]?.slice(x + 2, x + 6)]
    }

    expect([scar(0), scar(1)]).toEqual([
      ['✔', 'nami'],
      ['✘', 'budg'],
    ])
  })

  it('beats the queen\'s heart on a fixed period, and only in her halo', () => {
    const still = cellModel(8)
    const grid = hivePicture(still, 90, 1_000)
    const queen = cellOrigin(0, 0, 90, grid.rows)
    const half = hivePicture(still, 90, 1_000 + HEARTBEAT_MS / 2)

    expect(hivePicture(still, 90, 1_000 + HEARTBEAT_MS).encode()).toBe(grid.encode())
    // At rest the halo is still pink in 256 colours, not a grey wall, and it brightens at the beat.
    expect(new Set([haloColor(0), haloColor((HEARTBEAT_MS * 3) / 8), HIVE_COLOR.wall, HIVE_COLOR.faint].map(xterm256)).size).toBe(4)
    expect(half.encode()).not.toBe(grid.encode())

    for (let y = 0; y < grid.rows; y++) {
      for (let x = 0; x < grid.columns; x++) {
        const isHalo = x >= queen.x - 6 && x < queen.x + 6 + CELL_W && y >= queen.y - 4 && y < queen.y + 4 + CELL_H

        if (!isHalo) expect([x, y, fg(half, x, y), at(half, x, y)]).toEqual([x, y, fg(grid, x, y), at(grid, x, y)])
      }
    }
  })

  it('runs a wave from a voter to the queen for two seconds after the vote lands, and is still otherwise', () => {
    const wave = { kind: 'for' as const, atMs: 10_000 }
    const model = cellModel(12)
    const waving = { ...model, members: model.members.map((cell, i) => (i === 11 ? { ...cell, wave } : cell)) }
    const queen = cellOrigin(0, 0, 100, heroRows(12))
    const head = (t: number) => {
      const grid = hivePicture(waving, 100, t)

      for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.columns; x++) if (at(grid, x, y) === '◉') return Math.hypot(x - queen.x - 4, (y - queen.y - 2) * 2)

      return null
    }
    const near = head(11_700)
    const far = head(10_300)

    expect(far).not.toBeNull()
    expect(near).not.toBeNull()
    expect(near as number).toBeLessThan(far as number)
    expect(hivePicture(waving, 100, 10_300).encode()).not.toBe(hivePicture(model, 100, 10_300).encode())
    expect(hivePicture(waving, 100, 12_000).encode()).toBe(hivePicture(model, 100, 12_000).encode())
    expect(hivePicture(waving, 100, 9_000).encode()).toBe(hivePicture(model, 100, 9_000).encode())
    expect(new Set([10_000, 10_500, 11_999, 12_000].map(t => `${hivePicture(waving, 100, t).columns}x${hivePicture(waving, 100, t).rows}`)).size).toBe(1)
  })
})

describe('the hive\'s motion comes from events', () => {
  it('reads a vote, a join and a leave from the words diffEvents writes, only while fresh', () => {
    const before = { ...hive, workers: WORKERS.slice(0, 2), pending: hive.pending.map(entry => ({ ...entry, ballots: [], votesFor: 0, votesAgainst: 0 })) }
    const events = diffEvents(withHive(before), withHive(hive), 5_000)

    expect(waveOf(events, WORKERS[0], 5_100)).toEqual({ kind: 'for', atMs: 5_000 })
    expect(waveOf(events, WORKERS[1], 5_100)).toEqual({ kind: 'against', atMs: 5_000 })
    expect(waveOf(events, WORKERS[2], 5_100)).toEqual({ kind: 'join', atMs: 5_000 })
    expect(waveOf(diffEvents(withHive(hive), withHive(before), 5_000), WORKERS[2], 5_100)).toEqual({ kind: 'leave', atMs: 5_000 })
    expect(waveOf(events, WORKERS[0], 7_000)).toBeNull()
    expect(waveOf(events, 'nobody', 5_100)).toBeNull()
  })

  it('says a broadcast arrived only once it is new: what the first read finds is old', () => {
    const log = new Arrivals()

    expect(log.arrivedAt('h1', ['a', 'b'], 5_000).get('a')).toBe(Number.NEGATIVE_INFINITY)
    expect(log.arrivedAt('h1', ['a', 'b', 'c'], 6_000).get('c')).toBe(6_000)
    expect(log.arrivedAt('h1', ['a', 'b', 'c'], 7_000).get('c')).toBe(6_000)
    expect(log.arrivedAt('h2', ['c'], 8_000).get('c')).toBe(Number.NEGATIVE_INFINITY)
  })
})

describe('the voting chambers', () => {
  const chamber: Chamber = { label: 'design', note: 'raft T2', votesFor: 1, votesAgainst: 1, required: 2, nodes: 3, ballots: [{ tag: 'a1b2', isFor: true, atMs: 10_000 }, { tag: 'c3d4', isFor: false }], byzantine: ['e5f6'], isPicked: true }

  it('fills for from the left and against from the right toward their quorum lines', () => {
    expect(chamberLayout({ votesFor: 1, votesAgainst: 0, required: 2, nodes: 3 }, 30)).toEqual({ forCells: 10, againstCells: 0, passAt: 19, rejectAt: 10 })
    expect(chamberLayout({ votesFor: 3, votesAgainst: 3, required: 2, nodes: 3 }, 30)).toMatchObject({ forCells: 30, againstCells: 0 })
    expect(chamberLayout({ votesFor: 0, votesAgainst: 2, required: 2, nodes: 4 }, 20)).toEqual({ forCells: 0, againstCells: 10, passAt: 9, rejectAt: 10 })
  })

  it('puts a dot per ballot, a red ✖ for a Byzantine voter, and blinks a new ballot for two seconds only', () => {
    const grid = chambersPicture([chamber], 100, 0)
    const ballots = stillOf(grid).split('\n')[1] ?? ''

    expect(grid.rows).toBe(chamberRows(1))
    expect([...ballots].filter(ch => ch === '●')).toHaveLength(2)
    expect(ballots).toContain('✖')
    expect(stillOf(grid)).toContain('DESIGN')
    expect(stillOf(grid)).toContain('1 for · 1 against · need 2 of 3')
    expect(chambersPicture([chamber], 100, 10_100).encode()).not.toBe(grid.encode())
    expect(chambersPicture([chamber], 100, 12_000).encode()).toBe(grid.encode())
    expect([1, 4, 9].map(chamberRows)).toEqual([4, 16, 16])
  })
})

describe('the strip', () => {
  const model: StripModel = {
    shield: { faulty: 1, of: 3, rule: 'raft f < n/2' },
    strategy: 'raft',
    startMs: 0,
    endMs: 100_000,
    term: 2,
    electedAtMs: 40_000,
    marks: [
      { atMs: 10_000, kind: 'passed', label: 'naming', term: 1 },
      { atMs: 70_000, kind: 'opened', label: 'design', term: 2 },
    ],
    pheromones: [
      { id: 'b', text: '[high] system: freeze the main branch', isLoud: true, arrivedAtMs: 50_000 },
      { id: 'a', text: 'console-operator: standup in 5', isLoud: false, arrivedAtMs: Number.NEGATIVE_INFINITY },
    ],
    keys: ['design-notes'],
  }

  it('draws the shield as f of n, and dim n/a where the strategy states no bound', () => {
    expect(stillOf(stripPicture(model, 100, 0))).toMatch(/f 1 of 3/)
    expect(stillOf(stripPicture({ ...model, shield: null, strategy: 'gossip' }, 100, 0))).toContain('f n/a')
  })

  it('marks the election and the dated decisions where their time falls, and the terms only the file records', () => {
    const still = stillOf(stripPicture(model, 100, 0))

    expect([axisAt(0, 0, 100, 11), axisAt(50, 0, 100, 11), axisAt(500, 0, 100, 11)]).toEqual([0, 5, 10])
    expect(still).toContain('♛T2')
    expect(still).toContain('T1')
    expect(still).toContain('✔')
    expect(still).toContain('◇')
  })

  it('holds the timeline still between writes: its axis ends at the hive\'s last write, not the clock', () => {
    const now = stripPicture(stripOf(hive, NOW), 100, 0)

    expect(stripPicture(stripOf(hive, NOW + 50_000), 100, 0).encode()).toBe(now.encode())
    expect(stillOf(now)).toContain('last write')
  })

  it('slides a new pheromone in for two seconds, then holds still, at one size', () => {
    expect(tickerShift(model.pheromones, 50_000)).toBe((model.pheromones[0]?.text.length ?? 0) + 5)
    expect(tickerShift(model.pheromones, 51_000)).toBeGreaterThan(0)
    expect(tickerShift(model.pheromones, 52_000)).toBe(0)
    expect(stripPicture(model, 100, 51_000).encode()).not.toBe(stripPicture(model, 100, 60_000).encode())
    expect(stripPicture(model, 100, 60_000).encode()).toBe(stripPicture(model, 100, 90_000).encode())
    expect(stillOf(stripPicture(model, 100, 60_000))).toContain('[high] system: freeze the main branch  ⬡  console-operator: standup in 5')
    expect([0, 51_000].map(t => stripPicture(model, 100, t).rows)).toEqual([STRIP_ROWS, STRIP_ROWS])
  })
})

describe('the empty comb', () => {
  it('glows an egg in the centre cell, with no queen and no worker yet', () => {
    const top = eggTopPicture(96)
    const { x, y } = cellOrigin(0, 0, 96, EGG_TOP_ROWS)
    const glyphs = new Set(stillOf(top).replace(/\s/g, ''))

    expect([at(top, x + 3, y + 1), at(top, x + 3, y + 2), at(top, x + 3, y + 3)]).toEqual(['▄', '█', '▀'])
    expect(bg(top, x + 3, y + 2)).not.toBe(DEFAULT)
    expect([...glyphs].every(ch => '▁╱╲▄█▀'.includes(ch))).toBe(true)
    expect([top.rows, eggBottomPicture(96).rows]).toEqual([EGG_TOP_ROWS, EGG_BOTTOM_ROWS])
  })
})

describe('stills for review', () => {
  it('records each state as text', () => {
    const busy: HivePictureModel = {
      queen: { tag: 'T2', isKnown: true },
      members: [
        ...cellModel(9).members.map((cell, i) => ({ ...cell, vote: i % 3 === 0 ? ('for' as const) : i % 3 === 1 ? ('against' as const) : ('pending' as const) })),
        { id: 'bad', role: 'worker', glow: 'error', tag: 'e5f6', isByzantine: true },
        { id: 'lost', role: 'unknown', glow: 'unknown', tag: 'zz99' },
      ],
      scars: [
        { label: 'naming', isPassed: true },
        { label: 'budget', isPassed: false },
      ],
    }
    const waving = { ...busy, members: busy.members.map((cell, i) => (i === 7 ? { ...cell, wave: { kind: 'against' as const, atMs: 0 } } : cell)) }
    const stills = {
      'empty comb (egg + start buttons between)': `${stillOf(eggTopPicture(96))}\n   [▸ start a hive-mind (raft)] [▸ spawn 3 hive workers]\n${stillOf(eggBottomPicture(96))}`,
      'a queen and three workers': stillOf(hivePicture(cellModel(3), 96, 0)),
      'a busy hive: ballots, a byzantine voter, scars, a wave mid-flight at 900 ms': stillOf(hivePicture(waving, 110, 900)),
      'the strip: shield, terms, pheromones': stillOf(stripPicture(stripOf(hive, NOW), 110, 0)),
      'voting chambers': stillOf(chambersPicture([{ label: 'design', note: 'raft T2 · timed out', votesFor: 1, votesAgainst: 0, required: 2, nodes: 3, ballots: [{ tag: 'a1b2', isFor: true }], byzantine: [], isPicked: true }, { label: 'deploy', note: 'bft', votesFor: 0, votesAgainst: 1, required: 3, nodes: 3, ballots: [{ tag: 'c3d4', isFor: false }], byzantine: ['e5f6'], isPicked: false }], 110, 0)),
    }

    for (const [name, still] of Object.entries(stills)) console.log(`── ${name} ──\n${still}\n`)

    expect(Object.values(stills).every(still => still.length > 0)).toBe(true)
  })
})
