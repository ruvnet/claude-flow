/**
 * The rows the shell pins under the page bar (ADR-489 phase 6): the confirm card of a change the person asked for, or what the last action
 * printed. The card is the console's own `state.pending` (the same text `confirmRow` draws: who asked, the exact argv, the effect); only the
 * wording of the keys differs, because this terminal has no buttons. It counts as shown (`state.shownCard`, the console's own gate for a bare
 * typed yes) only when every row of it is on screen, so a window too small to show the argv can never answer it.
 */
import { askedBy } from '../hooks/data/room'
import type { State } from '../hooks/state'
import { THEME } from '../hooks/views/common'
import { clean, render, terminalKit, type Depth } from './ansi'

/** How long the result of an action stays pinned. */
export const RESULT_MS = 20_000
const MAX_RESULT_LINES = 8

export function pinnedLines(state: State, columns: number, depth: Depth, room: number): string[] {
  const kit = terminalKit()
  const pending = state.pending

  if (pending !== null) {
    const hasMoney = pending.note !== undefined && /money|models/i.test(pending.note)
    const tree = kit.Box({
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: THEME.warn,
      paddingX: 1,
      children: [
        kit.Text({ bold: true, color: THEME.warn, children: '▶ CONFIRM NEEDED: y runs it · n or Esc cancels' }),
        kit.Text({ bold: true, color: THEME.warn, wrap: 'wrap', children: `Confirm: ${askedBy(pending)}${pending.label.replace(/\?+$/, '')}?` }),
        // Wrapped, not clipped: a yes is a yes to the whole argv.
        kit.Text({ dimColor: true, wrap: 'wrap', children: `runs: ${pending.shows ?? `ruflo ${pending.args.join(' ')}`}` }),
        ...(pending.note !== undefined ? [kit.Text({ bold: hasMoney, color: hasMoney ? THEME.bad : THEME.warn, wrap: 'wrap', children: `Effect: ${pending.note}` })] : []),
      ],
    })
    const lines = render(tree, columns, depth)

    // Leave the page at least three rows: a card that crowds it out is not on screen in full.
    if (lines.length <= Math.max(0, room - 3)) {
      state.shownCard = pending.id ?? null

      return lines
    }

    state.shownCard = null

    return [clean('▶ CONFIRM NEEDED, but this window is too small to show the whole command: make it taller (or press n).')].map(line => line.slice(0, columns))
  }

  const outcome = state.outcome

  if (outcome === null || Date.now() - outcome.atMs > RESULT_MS) return []

  const head = `${outcome.ok ? '✔' : '✘'} ${clean(outcome.label).slice(0, 80)}: ${clean(outcome.detail).slice(0, 120)}`
  const more = (outcome.lines ?? []).slice(0, MAX_RESULT_LINES).map(line => `  ${clean(line)}`)

  return render(kit.Box({ flexDirection: 'column', children: [kit.Text({ bold: true, color: outcome.ok ? THEME.ok : THEME.bad, wrap: 'truncate-end', children: head }), ...more.map(line => kit.Text({ dimColor: true, wrap: 'truncate-end', children: line }))] }), columns, depth)
}
