/**
 * The Hive-Mind's empty state: a dim, empty comb with one glowing egg in its centre cell, where the queen will sit once
 * a hive is started. It comes in two pictures so the view can put the start buttons between them, inside the comb:
 * the top holds the egg, the bottom a band of cells that closes the comb under the buttons. Still: nothing moves
 * before there is a hive.
 */
import { Grid } from './raster'
import { addLight, cellOrigin, drawWalls, fieldOf, fillInterior, HIVE_COLOR } from './hive'

export const EGG_TOP_ROWS = 13
export const EGG_BOTTOM_ROWS = 7
const EGG = 0xffffd7
const NEST = 0x875f00

/** The egg's three rows, two cells wide, sitting in the middle of a cell's interior. */
export const EGG_GLYPHS = ['▄▄', '██', '▀▀'] as const

export function eggTopPicture(columns: number): Grid {
  const grid = new Grid(columns, EGG_TOP_ROWS)
  const field = fieldOf(columns, EGG_TOP_ROWS)

  for (const [q, r] of field) {
    const { x, y } = cellOrigin(q, r, columns, EGG_TOP_ROWS)
    const isNeighbour = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === 1

    // The egg's light reaches the six cells around it: their walls warm to gold.
    drawWalls(grid, x, y, isNeighbour ? addLight(HIVE_COLOR.faint, HIVE_COLOR.yellow, 0.45) : HIVE_COLOR.faint)
  }

  const { x, y } = cellOrigin(0, 0, columns, EGG_TOP_ROWS)

  fillInterior(grid, x, y, NEST)
  drawWalls(grid, x, y, HIVE_COLOR.gold, NEST)
  EGG_GLYPHS.forEach((glyphs, i) => grid.text(x + 3, y + 1 + i, glyphs, EGG, NEST))

  return grid
}

/** A band of empty cells, the comb going on under the start buttons: a taller comb cut off at the band's last row. */
export function eggBottomPicture(columns: number): Grid {
  const grid = new Grid(columns, EGG_BOTTOM_ROWS)
  const comb = EGG_BOTTOM_ROWS + 2

  for (const [q, r] of fieldOf(columns, comb)) {
    const { x, y } = cellOrigin(q, r, columns, comb)

    drawWalls(grid, x, y, HIVE_COLOR.faint)
  }

  return grid
}
