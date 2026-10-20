/**
 * Saved views and pins on the Workflows page (ADR-461): a board slot that says what the page remembers (cursor, filters, search,
 * pinned runs), pins or unpins the picked run, jumps to a pinned run, and forgets the saved file (behind the confirm card). The
 * reading and writing is hooks/wf-saved-live.ts; registered by importing views/wf-replay.ts.
 */
import type { RenderElement } from 'claude-code'

import { MAX_PINS, SAVED_FILE, SAVED_MAX_BYTES, isPinned, pinsIn, togglePin } from '../data/wf-saved'
import { currentPhase, type WfRun } from '../data/workflows'
import { forgetSpec, savedFor, updateSaved } from '../wf-saved-live'
import { ago, button, clip, row, text, THEME } from './common'
import { fold, redraw } from './wf-fold'
import { registerSlot, type SlotEnv } from './wf-slots'

export function savedBody(env: SlotEnv, run: WfRun | null): RenderElement[] {
  const { ctx, runs, nowMs } = env
  const cwd = ctx.state.cwd
  const own = savedFor(cwd)
  const pins = pinsIn(own.saved, runs)
  const filters = Object.entries(own.saved.filters).map(([key, value]) => `${key}=${clip(value, 24)}`).join(' · ')
  const pin = (): void => {
    if (run === null) return

    const next = togglePin(own.saved, run, Date.now())

    updateSaved(cwd, () => next.saved, next.said)
    redraw(ctx)
  }

  return [
    text(ctx, ` File ${SAVED_FILE} (≤ ${SAVED_MAX_BYTES / 1000} kB, versioned) · ${own.saved.savedAtMs === 0 ? 'not saved yet' : `saved ${ago(own.saved.savedAtMs, nowMs)}`}${own.isDirty ? ' · change waiting to be written' : ''}`, { dimColor: true }),
    text(ctx, ` Remembers the cursor (run, phase, agent by name), filters and search, and pins. Written by the console itself, only there; forgetting asks first.`, { dimColor: true }),
    ...(own.problem === null ? [] : [text(ctx, ` ${own.problem}`, { color: THEME.warn })]),
    ...(own.error === null ? [] : [text(ctx, ` The last write failed (${clip(own.error, 60)}): the change is kept and tried again.`, { color: THEME.warn })]),
    ...(own.restored === null ? [] : [text(ctx, own.restored === 'exact' ? ' The cursor was put back where you left it.' : own.restored === 'name' ? ' That run is gone: the cursor went to the newest run of the same workflow.' : ' The run you left on is no longer among the runs read: the cursor is where it was.', { dimColor: true })]),
    text(ctx, ` search: ${own.saved.search === '' ? 'none' : `"${clip(own.saved.search, 40)}"`} · filters: ${filters === '' ? 'none' : filters}`, { dimColor: true }),
    row(ctx, [
      ...(run === null ? [] : [button(ctx, 'wf-saved-pin', isPinned(own.saved, run.id) ? 'Unpin this run' : 'Pin this run', pin)]),
      button(ctx, 'wf-saved-forget', 'Forget saved views', () => ctx.act.workflows.ask(forgetSpec(cwd))),
    ], 'wf-saved-controls'),
    ...(own.said === null ? [] : [text(ctx, ` ${own.said}`, { color: THEME.info })]),
    ...(pins.length === 0 ? [text(ctx, ` No pinned runs (up to ${MAX_PINS}).`, { dimColor: true })] : pins.map(entry => (entry.index === null || entry.run === null ? text(ctx, ` ◌ ${clip(entry.pin.name, 40)} · not among the runs read now`, { dimColor: true }) : row(ctx, [button(ctx, `wf-saved-go-${entry.index}`, `▸ ${clip(entry.pin.name, 28)}`, () => jump(env, entry.index as number, entry.run as WfRun)), text(ctx, ` ${entry.run.state} · ${entry.run.done}/${entry.run.total} agents`, { dimColor: true })], `wf-saved-pin-${entry.index}`)))),
  ]
}

/** Puts the cursor on a run, on the phase it is in. */
function jump(env: SlotEnv, index: number, run: WfRun): void {
  env.ctx.act.workflows.setUi({ run: index, phase: currentPhase(run.phases) ?? 0, agent: 0, column: 'phases', isInspecting: false })
}

registerSlot({
  kind: 'board',
  id: 'saved',
  title: 'Saved views and pins',
  order: 70,
  render: env => {
    const own = savedFor(env.ctx.state.cwd)

    return fold(env.ctx, 'saved', `${own.saved.pins.length} pinned · the cursor is remembered across restarts`, () => savedBody(env, env.run))
  },
})
