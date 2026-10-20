/**
 * `/ruflo events <args>` and `/ruflo timeline <args>` (ADR-474), carried out: the filters are set (pure, in events-ui.ts and
 * timeline-ui.ts), the export and forget verbs ask through the confirm card like every other write, and the page is brought up.
 */
import type { Controller } from './controller'
import type { Intent } from './commands'
import { applyEventsArgs } from './events-args'
import { applyTimelineArgs } from './timeline-ui'
import { eventsUi } from './events-ui'
import { timelineUi } from './timeline-ui'
import type { State } from './state'

const pendingText = (state: State): string | null => (state.pending === null ? null : `Asked: ${state.pending.label}. Confirm with /ruflo yes (or y in the pane), cancel with /ruflo no.${state.pending.shows === undefined ? '' : `\nruns: ${state.pending.shows}`}`)

export async function watchCommand(control: Controller, state: State, intent: Extract<Intent, { kind: 'events' | 'timeline' }>): Promise<{ text: string }> {
  const isEvents = intent.kind === 'events'
  const done = isEvents ? applyEventsArgs(state, intent.args) : applyTimelineArgs(state, intent.args)
  const actions = control.actions

  control.setView(isEvents || 'follow' in done && done.follow !== undefined ? 'events' : 'timeline')

  if (isEvents && 'forget' in done && done.forget === true) actions.events.forget()
  else if (done.export !== undefined) {
    const target = done.export

    if (isEvents) await actions.events.exportTo(target.format === 'csv' ? 'md' : target.format, target.path)
    else await actions.timeline.exportTo(target.format === 'jsonl' ? 'md' : target.format, target.path)
  }

  control.host.invalidate()

  const opened = await control.open()
  const asked = pendingText(state)
  const why = opened.isPlaced ? '' : ` (the pane could not be shown: ${opened.reason})`

  const said = done.export === undefined ? done.text : (isEvents ? eventsUi(state).said : timelineUi(state).said) ?? done.text

  return { text: `${asked ?? said}${why}` }
}
