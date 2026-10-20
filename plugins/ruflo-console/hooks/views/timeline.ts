/**
 * The Timeline page (ADR-474): lanes in groups over a window you can zoom and pan, with the Events log's warn and bad events laid on
 * them, a parallelism strip, idle gaps, a lane detail, an export and cross-links to the Events page. The picture and the text lines
 * are built from the same list (data/timeline-lines.ts), so the text carries everything the picture does. Only one page of lanes is built.
 */
import type { RenderElement } from 'claude-code'

import { activityOf, storeNote } from '../activity-live'
import { LEGEND, runsOf, type Line, type Tone } from '../data/timeline-lines'
import { clockOf, SORTS, TL_WINDOWS, type LaneView } from '../data/timeline-model'
import { refOf } from '../data/events'
import { levelOfEvent } from '../data/event-severity'
import { laneRef, LANES_PAGE, timelineModel, timelineUi, type TlModel } from '../timeline-ui'
import { linesFor } from './timeline-lines'
import { clip, col, picture, row, rule, text, THEME, type Ctx } from './common'
import { LEVEL_COLOR, LEVEL_MARK, chip } from './events-parts'
import { notelines } from './events'
import { flow, type Btn } from './wf-layout'

const TONE = (tone: Tone): { color?: string; dimColor?: boolean } => (tone === 'busy' ? { color: THEME.warn } : tone === 'idle' ? { color: THEME.info, dimColor: true } : tone === 'tool' ? { color: THEME.head } : tone === 'bad' ? { color: THEME.bad } : tone === 'warn' ? { color: THEME.warn } : { dimColor: true })

const dur = (ms: number): string => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`)

function textLines(ctx: Ctx, lines: readonly Line[]): RenderElement[] {
  return lines.map((line, i) =>
    row(
      ctx,
      line.kind === 'group'
        ? [ctx.kit.Text({ bold: true, color: THEME.head, children: clip(line.label, ctx.columns) })]
        : [ctx.kit.Text({ ...(line.isCursor === true ? { bold: true, color: THEME.head } : { dimColor: line.kind === 'axis' }), children: `${line.label} ` }), ...runsOf(line.cells).map(run => ctx.kit.Text({ ...TONE(run.tone), children: run.text }))],
      `tl-line-${i}`,
    ),
  )
}

function laneDetail(ctx: Ctx, lane: LaneView, model: TlModel, nowMs: number): RenderElement[] {
  const { ref, go } = laneRef(lane)
  const a = ctx.act.timeline
  const act = activityOf(ctx.state)
  const spans = lane.spans.slice(-8)
  const out: RenderElement[] = [text(ctx, ` ${lane.group} · ${lane.label}`, { bold: true }), text(ctx, `   busy ${lane.busyPct === null ? 'n/a' : `${lane.busyPct}%`} of ${dur(lane.observedMs)} observed · longest busy stretch ${dur(lane.longestMs)} · ${lane.calls} tool call${lane.calls === 1 ? '' : 's'}`, { dimColor: true })]

  if (spans.length === 0) out.push(text(ctx, '   no busy or idle stretch was observed in this window', { dimColor: true }))

  spans.forEach((span, i) => {
    const next = spans[i + 1]
    const gap = next === undefined ? '' : next.fromMs - span.toMs > 1000 ? ` · gap ${dur(next.fromMs - span.toMs)}` : ''

    out.push(text(ctx, `   ${clockOf(span.fromMs)} ${span.busy ? '█ busy' : '▁ idle'} ${dur(span.toMs - span.fromMs)}${gap}`, { color: span.busy ? THEME.warn : THEME.info }))
  })

  if (lane.byTool.length > 0) out.push(text(ctx, `   tools: ${lane.byTool.slice(0, 6).map(([tool, n]) => `${tool} ${n}`).join(' · ')}`, { dimColor: true }))

  const events = act.log.filter(event => refOf(event) === ref).slice(-10).reverse()

  if (events.length > 0) out.push(text(ctx, `   last ${events.length} events:`, { dimColor: true }))
  for (const event of events) out.push(text(ctx, `   ${LEVEL_MARK[levelOfEvent(event)]} ${clockOf(event.atMs)} ${event.text}`, { color: LEVEL_COLOR[levelOfEvent(event)]() }))
  void nowMs
  void model

  out.push(...flow(ctx, [{ key: 'tl-lane-events', label: ' ⤳ follow on Events ', onPress: () => a.events(lane) }, { key: 'tl-lane-go', label: ` open ${go} `, onPress: () => a.go(lane) }, { key: 'tl-lane-ask', label: ' ✦ ask Claude ', onPress: () => a.ask(lane) }, { key: 'tl-lane-close', label: ' close ', onPress: () => a.open(null) }], 'tl-lane-btns'))

  return out
}

export function timelineView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const ui = timelineUi(state)
  const a = ctx.act.timeline
  const act = activityOf(state)
  const model = timelineModel(state, nowMs, Math.max(8, ctx.columns - 10))
  const label = TL_WINDOWS.find(item => item.id === ui.window)?.label ?? ui.window
  const rows: RenderElement[] = [rule(ctx, 'Timeline', `${label}${ui.offsetMs > 0 ? ` · ${dur(ui.offsetMs)} back` : ' · live'} · ${clockOf(model.win.fromMs, model.win.spanMs > 86_400_000)} to ${clockOf(model.win.toMs, model.win.spanMs > 86_400_000)} · ${model.total} lanes`)]

  rows.push(...flow(ctx, TL_WINDOWS.map(item => chip(`tl-win-${item.id}`, item.label, ui.window === item.id, () => a.window(item.id))), 'tl-windows', 'window '))
  rows.push(
    ...flow(
      ctx,
      [
        { key: 'tl-back', label: ' ◂ earlier ', onPress: () => a.pan(-1), hotkey: 'b' },
        { key: 'tl-fwd', label: ' later ▸ ', onPress: () => a.pan(1), hotkey: 'n' },
        { key: 'tl-zin', label: ' ＋ zoom in ', onPress: () => a.zoom(-1) },
        { key: 'tl-zout', label: ' － zoom out ', onPress: () => a.zoom(1) },
        { key: 'tl-now', label: ' ⏺ now ', onPress: a.now },
        { key: 'tl-start', label: ' ⏮ start ', onPress: a.start },
        { key: 'tl-problem', label: ' ⚠ last problem ', onPress: a.problem },
        { key: 'tl-sort', label: ` sort: ${ui.sort} `, onPress: a.sort, hotkey: 's' },
      ],
      'tl-controls',
    ),
  )

  if (model.lanes.length === 0) {
    rows.push(text(ctx, state.snapshot === null ? 'Reading ruflo state…' : 'No lane was observed in this window. Lanes appear when a ruflo agent reports a status, Claude Code calls a tool, a workflow agent or a mission task runs, or the autopilot hands over a step.', { dimColor: true }))
  } else {
    const lines = linesFor(state, model, ctx.columns)

    rows.push(...flow(ctx, model.entries.flatMap(entry => (entry.type === 'group' ? [{ key: `tl-group-${entry.group}`, label: ` ${entry.isOpen ? '▾' : '▸'} ${entry.group} (${entry.count}) `, onPress: () => a.toggleGroup(entry.group) }] : [])), 'tl-groups', 'groups '))
    rows.push(ctx.pictures.has('tl-picture') ? picture(ctx, 'tl-picture', ' ') : col(ctx, textLines(ctx, lines), 'tl-text'))

    const pages = Math.max(1, Math.ceil(model.entries.length / LANES_PAGE))
    const page = Math.min(ui.page, pages - 1)
    const cursor = model.entries.flatMap(entry => (entry.type === 'lane' ? [entry.lane] : []))[ui.cursor]
    const nav: Btn[] = [{ key: 'tl-down', label: ' j ', onPress: () => a.move(1), hotkey: 'j' }, { key: 'tl-up', label: ' k ', onPress: () => a.move(-1), hotkey: 'k' }, ...(cursor === undefined ? [] : [{ key: 'tl-open', label: ` ▸ open ${clip(cursor.label, 18)} `, onPress: () => a.open(cursor.lane), hotkey: 'o' }]), ...(pages > 1 ? [...(page < pages - 1 ? [{ key: 'tl-next', label: 'more lanes ▸', onPress: () => a.page(1) }] : []), ...(page > 0 ? [{ key: 'tl-prev', label: '◂ back', onPress: () => a.page(-1) }] : [])] : [])]

    rows.push(...flow(ctx, nav, 'tl-nav', pages > 1 ? ` page ${page + 1}/${pages} ` : ''))
    rows.push(text(ctx, ` ${LEGEND}`, { dimColor: true }))

    const conc = model.concurrency

    rows.push(text(ctx, ` parallel: peak ${conc.peak}, mean ${conc.mean} lanes busy at once${conc.peakAtMs === null ? '' : ` (peak ${clockOf(conc.peakAtMs)})`}${model.busiest === null ? '' : ` · busiest minute ${clockOf(model.busiest.atMs)}: ${model.busiest.n} tool calls`}${model.problems.length === 0 ? '' : ` · ${model.problems.length} warn/bad events`}`, { color: THEME.info }))

    for (const gap of model.gaps.slice(0, 3)) rows.push(text(ctx, ` idle ${dur(gap.toMs - gap.fromMs)}: ${gap.label} ${clockOf(gap.fromMs)} to ${clockOf(gap.toMs)} while others were busy`, { color: THEME.warn }))

    const open = ui.open === null ? undefined : model.lanes.find(lane => lane.lane === ui.open)

    if (open !== undefined) rows.push(...laneDetail(ctx, open, model, nowMs))
  }

  if (ui.said !== null) rows.push(text(ctx, ` ${ui.said}`, { dimColor: true }))

  const stamp = new Date(nowMs).toISOString().slice(0, 16).replace(/[:T]/g, '-')

  rows.push(...flow(ctx, [{ key: 'tl-export-md', label: ' ⇩ export .md ', onPress: () => void a.exportTo('md', `timeline-${stamp}.md`) }, { key: 'tl-export-csv', label: ' ⇩ export .csv ', onPress: () => void a.exportTo('csv', `timeline-${stamp}.csv`) }, { key: 'tl-ask', label: ' ✦ ask Claude about this window ', onPress: () => ctx.act.watch.ask(`In my ruflo console's timeline (${label}) ${model.total} lanes ran with peak parallelism ${model.concurrency.peak} and ${model.problems.length} warn/bad events. Anything worth looking at?`) }], 'tl-foot'))
  rows.push(text(ctx, 'ruflo agents\' own tool calls are not visible to Claude Code: their lanes show status only', { dimColor: true }))

  for (const note of notelines(`lanes observed since the console loaded, plus ${act.loaded.lanesBytes > 0 ? `${Math.round(act.loaded.lanesBytes / 1000)} kB of history` : 'no history yet'} · ${storeNote(state)}`, Math.max(20, ctx.columns - 2))) rows.push(text(ctx, ` ${note}`, { dimColor: true }))

  return col(ctx, rows, 'timeline')
}

export { SORTS }
