/**
 * The Events page (ADR-474): history kept across restarts, every source the console observes, a level on every event, a small query
 * language, bursts collapsed, a detail pane with the entity's state now, a stacked activity chart, pins, saved searches, alert rules
 * and an export. Each row is measured to fit 56 to 125 columns; only the visible page is built.
 */
import type { RenderElement } from 'claude-code'

import { activityOf, storeNote } from '../activity-live'
import { barsLine, bars as barsOf, dayHour, heatLine, WINDOWS } from '../data/event-stats'
import { EVENT_KINDS } from '../data/events'
import { LEVELS } from '../data/event-severity'
import { MAX_PINS, MAX_RULES, MAX_SEARCHES } from '../data/activity-store'
import { sparkline } from '../memory-lines'
import { chartOf, eventsModel, eventsUi, PAGE, rangeOf } from '../events-ui'
import { ago, clip, col, picture, row, rule, text, THEME, type Ctx } from './common'
import { chip, detailRows, eventRow, KIND_COLOR, LEVEL_COLOR, LEVEL_MARK } from './events-parts'
import { flow, safe, type Btn } from './wf-layout'

/** The words a long note is wrapped into, each line at most `width` cells, by the ` · ` joints. */
export function notelines(note: string, width: number): string[] {
  const out: string[] = []
  let current = ''

  for (const part of note.split(' · ')) {
    if (current !== '' && current.length + part.length + 3 > width) {
      out.push(current)
      current = part
    } else current = current === '' ? part : `${current} · ${part}`
  }

  if (current !== '') out.push(current)

  return out.map(item => clip(item, width))
}

export function eventsView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const ui = eventsUi(state)
  const act = activityOf(state)
  const a = ctx.act.events
  const model = eventsModel(state, nowMs)
  const pages = Math.max(1, Math.ceil(model.rows.length / PAGE))
  const page = Math.min(ui.page, pages - 1)
  const visible = model.rows.slice(page * PAGE, page * PAGE + PAGE)
  const range = rangeOf(state, ui, nowMs)
  const filter = state.eventFilter
  const windowLabel = ui.narrowed !== null ? 'narrowed' : (WINDOWS.find(item => item.id === ui.window)?.label ?? ui.window)
  const rows: RenderElement[] = [rule(ctx, 'Events', `${model.shown.length} of ${model.total} · ${windowLabel}${model.warnBad > 0 ? ` · ${model.warnBad} warn/bad` : ''}${ui.pausedSeq === null ? ' · live' : ` · paused (${model.unread} new)`}${ui.followRef === null ? '' : ` · following ${clip(ui.followRef, 24)}`}`)]

  rows.push(...flow(ctx, [chip('ev-kind-all', `all ${model.total}`, filter === 'all', () => ctx.act.watch.kind('all')), ...EVENT_KINDS.filter(kind => (model.kindCounts.get(kind) ?? 0) > 0 || filter === kind).map(kind => chip(`ev-kind-${kind}`, `${kind} ${model.kindCounts.get(kind) ?? 0}`, filter === kind, () => ctx.act.watch.kind(kind)))], 'ev-kinds', 'kind '))
  rows.push(...flow(ctx, [chip('ev-level-all', 'any', ui.level === 'all', () => a.level('all')), ...LEVELS.map(level => chip(`ev-level-${level}`, `${LEVEL_MARK[level]} ${level} ${model.levelCounts.get(level) ?? 0}`, ui.level === level, () => a.level(level)))], 'ev-levels', 'level '))
  rows.push(...flow(ctx, WINDOWS.map(item => chip(`ev-win-${item.id}`, item.label, ui.narrowed === null && ui.window === item.id, () => a.window(item.id))), 'ev-windows', 'window '))

  const Input = ctx.kit.Input

  if (Input !== undefined) rows.push(ctx.kit.Box({ key: 'ev-query-box', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [Input({ key: 'ev-query', label: '🔎', placeholder: 'words "phrase" -not kind:swarm level:bad agent:x since:1h a|b /re/', submitLabel: 'find', onSubmit: (value: string) => a.query(value) })] }))
  if (ui.parsed.errors.length > 0) rows.push(text(ctx, `⚠ ${ui.parsed.errors[0]}`, { color: THEME.warn }))
  else if (ui.said !== null && ui.said !== '') rows.push(text(ctx, ui.said, { dimColor: true }))

  if (model.skipped > 0) rows.push(text(ctx, `⚠ that /regex/ is slow: ${model.skipped} older events were not searched. Narrow the window or simplify it.`, { color: THEME.warn }))

  const tools: Btn[] = [
    { key: 'ev-pause', label: ui.pausedSeq === null ? ' ⏸ pause ' : ` ▶ resume (${model.unread} new) `, onPress: a.pause, hotkey: 't', ...(ui.pausedSeq !== null && { primary: true }) },
    { key: 'ev-level-cycle', label: ' level ', onPress: a.cycleLevel, hotkey: 'l' },
    { key: 'ev-clear', label: ' ✕ clear filters ', onPress: a.clearFilters, hotkey: 'c' },
    { key: 'ev-group', label: ui.isGrouped ? ' bursts: folded ' : ' bursts: all ', onPress: a.toggleGroup },
    { key: 'ev-chart-by', label: ` chart by ${ui.chartBy} `, onPress: a.chartBy },
    { key: 'ev-copy-focused', label: ' ⧉ copy focused ', onPress: () => a.copy(null), hotkey: 'v' },
  ]

  rows.push(...flow(ctx, tools, 'ev-tools'))

  const { data } = chartOf(state, model, nowMs, ctx.columns)

  rows.push(picture(ctx, 'ev-chart', ' '))
  rows.push(text(ctx, ` ${windowLabel} ${barsLine(data)} now · bars of ${Math.round(data.stepMs / 60_000)} min, by ${ui.chartBy}`, { color: THEME.info }))
  rows.push(text(ctx, ` last 15 min  ${sparkline(barsOf(model.shown, ['x'], () => 'x', 15 * 60_000, nowMs, 15).stacks.map(stack => stack[0] ?? 0))}`, { dimColor: true }))

  if (data.stacks.length > 1) {
    const peak = data.stacks.map(stack => stack.reduce((x, y) => x + y, 0))
    const at = peak.indexOf(Math.max(...peak))

    if ((peak[at] ?? 0) > 0) rows.push(...flow(ctx, [{ key: 'ev-zoom-peak', label: ` ⌖ zoom to the busiest bar (${peak[at]}) `, onPress: () => a.narrow(data.fromMs + at * data.stepMs, data.fromMs + (at + 1) * data.stepMs) }, ...(ui.narrowed === null ? [] : [{ key: 'ev-zoom-reset', label: ' ⤢ back out ', onPress: () => a.window(ui.window) }])], 'ev-zoom'))
  }

  if (ui.window === 'all' || ui.window === '24h') {
    const grid = dayHour(model.shown, nowMs)

    if (grid.some(day => day.some(n => n > 0))) {
      rows.push(text(ctx, ' day × hour (local, 0h to 23h)', { dimColor: true }))
      grid.forEach((day, i) => rows.push(text(ctx, `  ${new Date(nowMs - (6 - i) * 86_400_000).toISOString().slice(5, 10)} ${heatLine(day)}`, { color: THEME.info })))
    }
  }

  if (ui.mutedKinds.size + ui.mutedTemplates.size > 0) rows.push(...flow(ctx, [...[...ui.mutedKinds].map(kind => ({ key: `ev-unmute-${kind}`, label: ` ✕ muted ${kind} `, onPress: a.unmute })), ...(ui.mutedTemplates.size > 0 ? [{ key: 'ev-unmute-like', label: ` ✕ ${ui.mutedTemplates.size} muted line${ui.mutedTemplates.size === 1 ? '' : 's'} `, onPress: a.unmute }] : [])], 'ev-muted'))

  const saved: Btn[] = [{ key: 'ev-save', label: ` ★ save search (${act.prefs.searches.length}/${MAX_SEARCHES}) `, onPress: a.saveSearch }, { key: 'ev-rule', label: ` 🔔 alert on this (${act.prefs.rules.length}/${MAX_RULES}) `, onPress: a.addRule }, ...act.prefs.searches.map((item, i) => ({ key: `ev-search-${i}`, label: ` ${clip(item.name, 16)} `, onPress: () => a.runSearch(item.name) }))]

  rows.push(...flow(ctx, saved, 'ev-saved'))
  if (act.prefs.rules.length > 0) rows.push(...flow(ctx, act.prefs.rules.map((item, i) => ({ key: `ev-rule-${i}`, label: ` ✕ 🔔 ${clip(item.name, 16)} `, onPress: () => a.removeRule(item.name) })), 'ev-rules', 'rules '))
  if (act.prefs.searches.length > 0) rows.push(...flow(ctx, act.prefs.searches.map((item, i) => ({ key: `ev-del-${i}`, label: ` ✕ ${clip(item.name, 12)} `, onPress: () => a.deleteSearch(item.name) })), 'ev-dels', 'forget '))

  if (act.prefs.pins.length > 0) {
    rows.push(text(ctx, ` 📌 pinned (${act.prefs.pins.length}/${MAX_PINS})`, { bold: true }))

    for (const [i, pin] of act.prefs.pins.slice(-3).reverse().entries()) {
      rows.push(row(ctx, [ctx.kit.Text({ color: LEVEL_COLOR[pin.level](), children: ` ${LEVEL_MARK[pin.level]} ${ago(pin.atMs, nowMs).padStart(8)} ` }), ctx.kit.Text({ children: clip(pin.text, Math.max(8, ctx.columns - 26)) }), ctx.kit.Button({ key: `ev-unpin-${i}`, label: '✕', plain: true, onPress: safe(() => a.unpin(pin.atMs, pin.text)) })], `ev-pin-${i}`))
    }
  }

  if (model.rows.length === 0) {
    rows.push(text(ctx, state.events.length === 0 && act.log.length === 0 ? 'Nothing has changed since the console loaded, and no history is kept for this project yet. Events are what changed between reads, and what this session did.' : 'no event matches this filter, window and search', { dimColor: true }))
  }

  for (const entry of visible) {
    const isOpen = ui.open === entry.id

    rows.push(eventRow(ctx, entry, ui.parsed, model.rows[ui.focus]?.id === entry.id, isOpen, nowMs))
    if (isOpen) rows.push(...detailRows(ctx, entry, model.shown, nowMs))
  }

  if (pages > 1) rows.push(...flow(ctx, [...(page < pages - 1 ? [{ key: 'ev-older', label: 'older ▸', onPress: () => a.page(1) }] : []), ...(page > 0 ? [{ key: 'ev-newer', label: '◂ newer', onPress: () => a.page(-1) }] : []), { key: 'ev-move-down', label: ' j ', onPress: () => a.move(1), hotkey: 'j' }, { key: 'ev-move-up', label: ' k ', onPress: () => a.move(-1), hotkey: 'k' }], 'ev-pages', ` page ${page + 1}/${pages} `))
  else rows.push(...flow(ctx, [{ key: 'ev-move-down', label: ' j ', onPress: () => a.move(1), hotkey: 'j' }, { key: 'ev-move-up', label: ' k ', onPress: () => a.move(-1), hotkey: 'k' }], 'ev-pages'))

  rows.push(...flow(ctx, [{ key: 'ev-export-md', label: ' ⇩ export .md ', onPress: () => void a.exportTo('md', `events-${new Date(nowMs).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`) }, { key: 'ev-export-jsonl', label: ' ⇩ export .jsonl ', onPress: () => void a.exportTo('jsonl', `events-${new Date(nowMs).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jsonl`) }, { key: 'ev-forget', label: ' 🗑 forget history ', onPress: a.forget }, { key: 'filter', label: ` kind: ${filter} (cycle) `, onPress: ctx.act.filter, hotkey: 'f' }], 'ev-foot'))

  for (const [i, note] of notelines(storeNote(state), Math.max(20, ctx.columns - 2)).entries()) rows.push(text(ctx, ` ${note}`, { dimColor: true, ...(i === 0 ? {} : {}) }))

  return col(ctx, rows, 'events')
}

