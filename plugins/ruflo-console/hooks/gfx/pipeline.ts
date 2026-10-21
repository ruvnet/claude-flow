/**
 * Two pictures for the Learning page (ADR-455): the learning pipeline as four stages, and the router's last route. Pure
 * functions of the models in data/pipeline.ts and a size; each returns a grid of exactly the size asked for. A stale stage
 * is drawn dim, an absent one dim with n/a: no colour here means a number the console did not read.
 */
import { MAX_CANDIDATES, stageNote, type PipeStage, type RouteModel, type RouteOwner } from '../data/pipeline'
import { COLOR, Grid, ramp } from './raster'

export const PIPELINE_ROWS = 5

const compact = (count: number): string => (count >= 10_000 ? `${(count / 1000).toFixed(1)}k` : String(count))

/** CONSOLIDATE (11) plus the box edges: the widest name, so no stage name is ever cut. */
const MIN_BOX = 13

/** The narrow form: `NAME count · age` per stage, dim where the stage is stale or absent. */
function stackedList(stages: readonly PipeStage[], columns: number): Grid {
  const grid = new Grid(columns, Math.max(1, stages.length))

  stages.forEach((stage, y) => {
    const count = stage.count === null ? 'n/a' : compact(stage.count)

    grid.text(0, y, `${stage.name} ${count} · ${stageNote(stage)}`, stage.state === 'live' ? COLOR.accent : stage.state === 'stale' ? COLOR.warn : COLOR.dim)
  })

  return grid
}

/** RETRIEVE → JUDGE → DISTILL → CONSOLIDATE: a box per stage with its count and how old its source is; stale and absent stages dim. */
export function pipelineDiagram(stages: readonly PipeStage[], columns: number): Grid {
  const n = Math.max(1, stages.length)
  const gap = columns >= 56 ? 3 : 1
  const box = Math.floor((columns - (n - 1) * gap) / n)

  // Too narrow for four boxes that keep every name, count and age whole: one line per stage, never a clipped number.
  if (box < MIN_BOX) return stackedList(stages, columns)

  const grid = new Grid(columns, PIPELINE_ROWS)
  const inner = box - 2
  const cell = (text: string): string => text.slice(0, inner).padEnd(inner)

  stages.forEach((stage, i) => {
    const x0 = i * (box + gap)
    const lit = stage.state === 'live'
    const edge = lit ? COLOR.line : COLOR.dim
    const count = stage.count === null ? 'n/a' : compact(stage.count)

    grid.text(x0, 0, `╭${'─'.repeat(inner)}╮`, edge)
    grid.text(x0, 1, `│${cell(stage.name)}│`, lit ? COLOR.accent : COLOR.dim)
    grid.text(x0, 2, `│${count.padStart(inner).slice(-inner)}│`, lit ? ramp(0.7) : COLOR.dim)
    grid.text(x0, 3, `│${cell(stageNote(stage))}│`, stage.state === 'stale' ? COLOR.warn : COLOR.dim)
    grid.text(x0, 4, `╰${'─'.repeat(inner)}╯`, edge)

    // The arrow into a stage is as dim as the stage: learning does not flow into something that is not measured.
    if (i > 0) grid.text(x0 - gap, 2, gap === 3 ? '──▶' : '▶', lit ? COLOR.line : COLOR.dim)
  })

  return grid
}

const OWNER_WORDS: Record<RouteOwner, { text: string; color: number }> = {
  mods: { text: 'ruflo-mods routes in-process', color: COLOR.ok },
  classic: { text: 'the classic hook-handler routes; ruflo-mods stands down', color: COLOR.info },
  unseated: { text: 'ruflo-mods not seated: no in-process route', color: COLOR.dim },
}

/** Rows the route picture needs: the owner line, one per candidate (at most five), and the source line. */
export const routeRows = (model: RouteModel): number => 2 + Math.max(1, Math.min(MAX_CANDIDATES, model.candidates.length))

/** The last route: who owns routing, then each candidate with a confidence bar, the pick first and brightest. */
export function routePicture(model: RouteModel, columns: number): Grid {
  const rows = routeRows(model)
  const grid = new Grid(columns, rows)
  const owner = OWNER_WORDS[model.owner]
  const shown = model.candidates.slice(0, MAX_CANDIDATES)
  const bar = Math.max(6, Math.min(24, columns - 34))

  grid.text(0, 0, `◆ ${owner.text}`, owner.color)

  if (shown.length === 0) grid.text(2, 1, 'no route recorded yet', COLOR.dim)

  shown.forEach((candidate, i) => {
    const y = 1 + i
    const filled = candidate.confidence === null ? 0 : Math.round(candidate.confidence * bar)
    const color = i === 0 ? COLOR.accent : COLOR.info

    grid.text(0, y, i === 0 ? '▸' : ' ', COLOR.accent)
    grid.text(2, y, candidate.agent.slice(0, 18).padEnd(18), i === 0 ? 0xd0d0d0 : COLOR.dim)
    grid.text(21, y, '█'.repeat(filled), color)
    grid.text(21 + filled, y, '░'.repeat(bar - filled), COLOR.line)
    grid.text(22 + bar, y, candidate.confidence === null ? 'n/a' : `${Math.round(candidate.confidence * 100)}%`, i === 0 ? COLOR.accent : COLOR.dim)
  })

  const source =
    model.source === 'router-query'
      ? `a prior, not a calibrated probability · from your route query ${model.asked ?? ''}`
      : model.source === 'mods'
        ? `${model.matched === true ? 'keyword match' : 'no match, default'} · only the winner is stored; runners-up need a route query`
        : 'run a route query in the Learning Lab to see candidates'

  grid.text(0, rows - 1, source.slice(0, columns), COLOR.dim)

  return grid
}
