/**
 * Voting chambers: each open proposal as a hex-ended meter, four rows tall. Votes for fill from the left, votes against
 * from the right, toward their quorum lines (green ┃ where "for" passes, pink ┃ where "against" rejects; one yellow ┃
 * where both fall together). Above the fill, one ballot dot per voter: green for, pink against, a red ✖ for a voter
 * excluded as Byzantine. A ballot the console has just seen arrive blinks white for HIVE_PULSE_MS; nothing else
 * moves. The bar's arithmetic is the CLI's: `required` and `nodes` come from `tallyOf`.
 */
import { Grid } from './raster'
import { addLight, HIVE_COLOR, waveAge } from './hive'

export type ChamberBallot = { tag: string; isFor: boolean; atMs?: number }

export type Chamber = {
  label: string
  note: string
  votesFor: number
  votesAgainst: number
  required: number
  nodes: number
  ballots: ChamberBallot[]
  byzantine: string[]
  isPicked: boolean
}

export const CHAMBER_ROWS = 4
export const MAX_CHAMBERS = 4

export const chamberRows = (chambers: number): number => Math.min(MAX_CHAMBERS, chambers) * CHAMBER_ROWS

/** The bar's width in cells: what the columns leave beside the words, between 8 and 48. */
export const barWidth = (columns: number): number => Math.max(8, Math.min(48, columns - 44))

/** Where the fills and the quorum lines fall on a bar `width` cells wide: proportional to the hive's nodes. */
export function chamberLayout(chamber: Pick<Chamber, 'votesFor' | 'votesAgainst' | 'required' | 'nodes'>, width: number): { forCells: number; againstCells: number; passAt: number; rejectAt: number } {
  const of = (votes: number) => Math.round((Math.min(votes, chamber.nodes) / Math.max(1, chamber.nodes)) * width)
  const forCells = of(chamber.votesFor)

  return { forCells, againstCells: Math.min(width - forCells, of(chamber.votesAgainst)), passAt: Math.min(width - 1, Math.max(0, of(chamber.required) - 1)), rejectAt: Math.max(0, Math.min(width - 1, width - of(chamber.required))) }
}

function drawChamber(grid: Grid, chamber: Chamber, y: number, columns: number, t: number): void {
  const width = barWidth(columns)
  const { forCells, againstCells, passAt, rejectAt } = chamberLayout(chamber, width)
  const wall = chamber.isPicked ? HIVE_COLOR.yellow : HIVE_COLOR.wall
  const x0 = 1

  // The hex: slanted ends, a lid and a floor.
  grid.text(x0 + 1, y, `╱${'▔'.repeat(width + 2)}╲`, wall)
  grid.set(x0, y + 1, '╱', wall)
  grid.set(x0, y + 2, '╲', wall)
  grid.set(x0 + width + 5, y + 1, '╲', wall)
  grid.set(x0 + width + 5, y + 2, '╱', wall)
  grid.text(x0 + 1, y + 3, `╲${'▁'.repeat(width + 2)}╱`, wall)

  const bx = x0 + 3

  for (let i = 0; i < width; i++) {
    const isFor = i < forCells
    const isAgainst = i >= width - againstCells
    const color = isFor ? HIVE_COLOR.green : isAgainst ? HIVE_COLOR.pink : HIVE_COLOR.faint

    grid.set(bx + i, y + 2, isFor || isAgainst ? '█' : '░', color)
  }

  // The quorum lines sit on the fill and are drawn over it, so a bar that has crossed its line still shows it.
  const both = passAt === rejectAt

  grid.set(bx + passAt, y + 2, '┃', both ? HIVE_COLOR.yellow : addLight(HIVE_COLOR.green, HIVE_COLOR.white, passAt < forCells ? 0.6 : 0))
  if (!both) grid.set(bx + rejectAt, y + 2, '┃', addLight(HIVE_COLOR.pink, HIVE_COLOR.white, rejectAt >= width - againstCells ? 0.6 : 0))

  // One dot per ballot: "for" from the left, "against" from the right, Byzantine voters beside the against side.
  const slot = (n: number) => Math.max(1, Math.floor(width / Math.max(1, chamber.nodes))) * n
  const dot = (x: number, ballot: { atMs?: number }, color: number, ch = '●') => {
    const age = waveAge(ballot.atMs === undefined ? undefined : { kind: 'for', atMs: ballot.atMs }, t)

    grid.set(x, y + 1, ch, age !== null && Math.floor(age / 250) % 2 === 0 ? HIVE_COLOR.white : color)
  }
  const fors = chamber.ballots.filter(ballot => ballot.isFor)
  const againsts = chamber.ballots.filter(ballot => !ballot.isFor)

  fors.forEach((ballot, i) => dot(bx + Math.min(width - 1, slot(i)), ballot, HIVE_COLOR.green))
  againsts.forEach((ballot, i) => dot(bx + Math.max(0, width - 1 - slot(i)), ballot, HIVE_COLOR.pink))
  chamber.byzantine.forEach((_, i) => dot(bx + Math.max(0, width - 1 - slot(againsts.length + i)), {}, HIVE_COLOR.red, '✖'))

  const words = x0 + width + 7
  const room = Math.max(0, columns - words)

  grid.text(words, y + 1, `${chamber.isPicked ? '▸ ' : ''}${chamber.label.toUpperCase()}`.slice(0, room), chamber.isPicked ? HIVE_COLOR.yellow : HIVE_COLOR.grey)
  grid.text(words, y + 2, `${chamber.votesFor} for · ${chamber.votesAgainst} against · need ${chamber.required} of ${chamber.nodes}`.slice(0, room), chamber.isPicked ? HIVE_COLOR.cyan : HIVE_COLOR.grey)
  if (chamber.note !== '') grid.text(words, y + 3, chamber.note.slice(0, room), HIVE_COLOR.wall)
}

export function chambersPicture(chambers: readonly Chamber[], columns: number, t: number): Grid {
  const grid = new Grid(columns, Math.max(1, chamberRows(chambers.length)))

  chambers.slice(0, MAX_CHAMBERS).forEach((chamber, i) => drawChamber(grid, chamber, i * CHAMBER_ROWS, columns, t))

  return grid
}
