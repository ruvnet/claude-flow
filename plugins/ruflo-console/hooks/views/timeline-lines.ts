/**
 * The Timeline's page of lines (ADR-474): the lanes of one page, as cells, for a given width. The picture (views/frames.ts) and the text
 * (views/timeline.ts) both call this, so they are the same lines.
 */
import { activityOf } from '../activity-live'
import { buildLines, type Line } from '../data/timeline-lines'
import { LANES_PAGE, timelineUi, type TlModel } from '../timeline-ui'
import type { State } from '../state'

export function linesFor(state: State, model: TlModel, columns: number): Line[] {
  const ui = timelineUi(state)
  const act = activityOf(state)
  const page = Math.min(ui.page, Math.max(0, Math.ceil(model.entries.length / LANES_PAGE) - 1))
  const entries = model.entries.slice(page * LANES_PAGE, page * LANES_PAGE + LANES_PAGE)
  const lanes = model.entries.flatMap(entry => (entry.type === 'lane' ? [entry.lane] : []))

  return buildLines(entries, act.lanes, model.problems, model.lanes, model.win, model.concurrency, columns, lanes[ui.cursor]?.lane ?? null)
}
