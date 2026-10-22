import { takeKept } from '../field-keep'
import { countOf, grouped, INPUT_VALUE_MAX, showTail } from '../full-text'

/** Lines the typing mirror grows to before it shows the last lines with a marker. */
export const ECHO_LINES = 12
import type { State } from '../state'
import type { Kit } from './common'

const longs = new WeakMap<State, Set<string>>()

/** The keys of the fields whose text is, as last typed, longer than a line (so their echo is drawn). */
function longOf(state: State): Set<string> {
  let found = longs.get(state)

  if (found === undefined) {
    found = new Set()
    longs.set(state, found)
  }

  return found
}

/** What `withClearing` needs to show a long entry in full while it is typed: the pane width and a way to redraw. */
export type Echo = { columns: number; repaint: () => void }

/**
 * The host's Input is one line: text longer than the field scrolls out of sight. Under an Input whose text is longer than a line, the
 * whole text is shown wrapped (ADR-481), so a person sees all of what they typed and what Enter will send. Short text changes nothing:
 * the Input is returned as it was.
 */
function withEcho(kit: Kit, input: ReturnType<NonNullable<Kit['Input']>>, key: string, label: string | undefined, text: string, columns: number): ReturnType<NonNullable<Kit['Input']>> {
  const lineWidth = Math.max(12, columns - 8)
  const fieldWidth = Math.max(10, lineWidth - 8 - (label?.length ?? 0))

  if (countOf(text) <= fieldWidth && !/[\r\n]|\\n/.test(text)) return input

  // The host field is one line: a bordered live mirror under it holds every line typed, growing with the text (up to ECHO_LINES, then the last lines
  // and a marker), with a line count.
  const shown = showTail(text, lineWidth - 2, ECHO_LINES)

  return kit.Box({
    key: `${key}-full`,
    flexDirection: 'column',
    flexGrow: 1,
    children: [
      input,
      kit.Box({
        key: `${key}-mirror`,
        flexDirection: 'column',
        borderStyle: 'round',
        paddingX: 1,
        children: [...shown.lines.map(line => kit.Text({ dimColor: false, children: line === '' ? ' ' : line })), kit.Text({ dimColor: true, children: `${shown.total} line${shown.total === 1 ? '' : 's'} · ${grouped(countOf(text))} characters · Enter sends all of it · type \\n for a new line` })],
      }),
    ],
  })
}

/**
 * Makes every one-shot entry field clear when Enter is pressed. A field that passes its own `value` is a form field its
 * caller owns (a memory key, a search the buttons beside it use) and is left alone; every other field is drawn from
 * `state.fieldText`, filled as the person types and emptied after its submit, so what was entered never lingers.
 * With `echo`, a long entry (either kind) is also shown in full under its field.
 */
export function withClearing(kit: Kit, state: State, clear: (key: string) => void, echo?: Echo): Kit {
  const Input = kit.Input

  if (Input === undefined) return kit

  return {
    ...kit,
    Input: props => {
      if (props.value !== undefined) {
        const own = Input(props)

        return echo === undefined ? own : withEcho(kit, own, props.key, props.label, props.value, echo.columns)
      }

      // A value over the host's bound would make the engine refuse the whole pane: never drawn.
      const stored = state.fieldText.get(props.key) ?? ''
      const current = countOf(stored) > INPUT_VALUE_MAX ? '' : stored
      const drawn = Input({
        ...props,
        value: current,
        onInput: (value, e) => {
          const wasLong = longOf(state).has(props.key)
          const isLong = echo !== undefined && countOf(value) > Math.max(10, Math.max(12, echo.columns - 8) - 8 - (props.label?.length ?? 0)) || /[\r\n]|\\n/.test(value)

          state.fieldText.set(props.key, value)
          if (isLong) longOf(state).add(props.key)
          else longOf(state).delete(props.key)
          props.onInput?.(value, e)
          // Only a field that is, or just stopped being, long needs the echo redrawn.
          if (echo !== undefined && (isLong || wasLong)) echo.repaint()
        },
        onSubmit: (value, e) => {
          props.onSubmit?.(value, e)
          longOf(state).delete(props.key)
          // A refused entry (over a real limit) was put back by the action: it stays for the person to edit.
          if (takeKept(state, value)) state.fieldText.set(props.key, value)
          else clear(props.key)
        },
      })

      return echo === undefined ? drawn : withEcho(kit, drawn, props.key, props.label, current, echo.columns)
    },
  }
}
