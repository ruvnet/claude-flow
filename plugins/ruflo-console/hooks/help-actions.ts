/**
 * ruHelp's actions: the question and the open guide live in `state.help`; a question is answered from the built-in guides at once, for
 * nothing. "Ask Claude with these docs" is the only thing that starts a model turn, and like every ask in the console it asks first with
 * the exact words, screens a typed question with AIDefence, and mid-turn only fills the prompt box.
 */
import { checkLimit, LONG_TEXT_MAX } from './full-text'
import { plain } from './data/parse'
import { helpPrompt, searchDocs, type Go } from './help-docs'
import { TOPICS } from './help-topics'
import type { Host } from './host'
import { mcOf } from './mission-control'
import { blocksGuidance, screenText } from './mission-options'
import type { Runner } from './runner'
import type { State } from './state'
import type { Actions } from './views/common'

export type HelpActions = {
  /** Sets the question: results show as it changes. */
  query: (text: string) => void
  /** Opens a guide (null: the index). */
  open: (id: string | null) => void
  /** Asks the main Claude, with the best guides as data. */
  ask: (text?: string) => void
  /** A step's button: a page, a palette entry or a start. */
  go: (target: Go) => void
}

export function helpActions(state: State, host: Host, runner: Runner, act: () => Actions): HelpActions {
  const say = (label: string, ok: boolean, detail: string) => {
    mcOf(state).last = { label, ok, detail }
    host.invalidate()
  }

  return {
    query: text => {
      // The field is also the live search: never cut as it is typed (ADR-481); an ask over the prompt limit is refused below.
      state.help.query = plain(text, Number.MAX_SAFE_INTEGER)
      state.help.topic = null
      host.invalidate()
    },
    open: id => {
      state.help.topic = id
      state.help.query = ''
      host.invalidate()
    },
    ask: text => {
      const typed = plain(text ?? state.help.query, Number.MAX_SAFE_INTEGER).trim()

      if (typed === '') return say('ask ruHelp something first', false, 'type a question in the ruHelp field')

      const fit = checkLimit(typed, LONG_TEXT_MAX, 'the question', 'sent to Claude as one prompt')

      if (!fit.ok) return say('question not sent', false, fit.message)

      const prompt = helpPrompt(typed, searchDocs(TOPICS, typed, 3))
      const ask = () =>
        runner.ask(
          {
            label: 'ask Claude with ruHelp’s docs',
            scope: 'ask',
            args: [],
            shows: `“${plain(typed, 120)}” with the best matching guides as data — ${prompt.length} characters`,
            expect: 'the question in the transcript, and Claude’s answer',
            note: 'Starts a Claude Code turn (billed as any turn is); mid-turn it is only prepared in the prompt box.',
            run: async () => {
              try {
                if (state.turnActive) await host.fillPrompt(prompt)
                else await host.submitPrompt(prompt)
              } catch (error) {
                say('Claude did not take it', false, plain(error instanceof Error ? error.message : String(error), 140))
              }
            },
          },
          'nothing to ask',
        )

      if (!mcOf(state).isScreenOn) return ask()

      void screenText(state, host, typed).then(screen => (blocksGuidance(screen) ? say('AIDefence blocked the question', false, screen.detail) : ask()))
    },
    go: target => {
      if ('view' in target) act().view(target.view)
      else if ('run' in target) void act().run(target.run)
      else act().start(target.start)
    },
  }
}
