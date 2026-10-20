/**
 * The drill-down of the Workflows page (ADR-459), switched on by one line in views/wf-register.ts:
 *
 *   import '../wf-drill'
 *
 * Importing registers the drill panel, its keys, the search slot and the follow tick through the page's slots; nothing else is edited.
 * `bindWorkflowDrill(state, host)` is the one optional call that lets the buttons read what the page's own refresh does not (a finished
 * run's transcripts, a journal's result, a worktree's diff stat, the tail of a transcript over the read cap); unbound, everything the
 * console's read cache holds is still drawn, and the page says what it could not read and why.
 */
import { bindDrill, type DrillHost } from './data/wf-drill-io'
import type { State } from './state'
import { registerDrill, watchState } from './views/wf-detail'
import { registerSearch } from './views/wf-search'

/** What registering the slots came to: anything refused, with the reason (a hotkey another feature already holds, a full slot kind). */
export const refused: { slot: string; why: string }[] = [...registerDrill().map(entry => ({ slot: entry.verb, why: entry.why })), ...[registerSearch()].flatMap(why => (why === null ? [] : [{ slot: 'search', why }]))]

export function bindWorkflowDrill(state: State, host: DrillHost): void {
  bindDrill(state, host)
  watchState(state)
}
