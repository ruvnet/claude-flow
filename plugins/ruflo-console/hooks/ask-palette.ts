/** Palette entries for "ask Claude about this section", so `/ruflo ask <question>` works too; each asks first. */
import { askWired } from './ask-claude'
import type { ActionSpec } from './actions'
import type { PaletteEntry } from './palette'
import type { State } from './state'

export function askPalette(state: State): PaletteEntry[] {
  const wired = askWired(state)
  const why = 'open the console first'
  const local = (label: string, run: () => void | Promise<void>): ActionSpec | null => (wired === undefined ? null : { label, args: [], expect: label, isReadOnly: true, run: async () => void (await run()) })
  const text = (keyword: string, make: (value: string) => ActionSpec | null) => ({ kind: 'text' as const, keyword, make: (value: string) => (wired === undefined ? null : make(value)), why: () => why })

  return [
    { id: 'ask', group: 'ask', label: 'ask <question>: ask the main Claude about the section that is open (asks first)', run: text('ask', value => local('ask Claude', () => wired?.ask(value))) },
    { id: 'ask-aside', group: 'ask', label: 'ask-aside <question>: the same as a /btw aside beside the transcript (asks first)', run: text('ask-aside', value => local('ask Claude aside', () => wired?.aside(value))) },
  ]
}
