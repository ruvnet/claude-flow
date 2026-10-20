/**
 * What the ADRs page and its palette entries call (ADR-480): filter, select, initialise, propose, change a status, attach, check scope.
 * Each write is a spec for the runner's confirm row; this file only wires them.
 */
import type { ActionSpec } from './actions'
import { adrOf, docByNumber, docOf, initSpec, loadAdrs, proposeSpec, say, statusSpec, type AdrFilter } from './adr'
import { draftSpec, scopeCheck, setAttached } from './adr-mission'
import { STATUSES, type AdrStatus } from './data/adr'
import { ADR_TITLE_MAX, titleFit } from './data/adr-write'
import { plain } from './data/parse'
import type { Host } from './host'
import type { Runner } from './runner'
import type { State } from './state'

export type AdrActions = {
  reload: () => void
  filter: (patch: Partial<AdrFilter>) => void
  select: (file: string | null) => void
  page: (to: number) => void
  init: () => void
  propose: (title: string) => void
  status: (file: string, to: AdrStatus) => void
  supersede: (file: string, byNumber: string) => void
  attach: (file: string, on: boolean) => void
  scope: () => void
  draft: () => void
}

export type AdrWired = { host: Host; actions: AdrActions }
const wired = new WeakMap<State, AdrWired>()
export const adrWired = (state: State): AdrWired | undefined => wired.get(state)

/** Re-exported: the limit and the check live with the title rules in data/adr-write.ts, where proposeSpec applies them too (ADR-481). */
export { ADR_TITLE_MAX, titleFit }

const today = (): string => new Date().toISOString().slice(0, 10)

export function adrActions(state: State, host: Host, runner: Runner): AdrActions {
  const adr = adrOf(state)
  const reason = 'open the ADRs page to read the project’s ADR folder first'
  const ask = (spec: ActionSpec | null, why: string) => runner.ask(spec, why)
  const actions: AdrActions = {
    reload: () => void loadAdrs(state, host),
    filter: patch => {
      adr.page = 0
      adr.filter = { ...adr.filter, ...patch, status: patch.status !== undefined && (patch.status === 'all' || STATUSES.includes(patch.status as (typeof STATUSES)[number])) ? patch.status : adr.filter.status }
      host.invalidate()
    },
    page: to => {
      adr.page = Math.max(0, Math.floor(to))
      host.invalidate()
    },
    select: file => {
      adr.selected = file
      host.invalidate()
    },
    init: () => ask(initSpec(state, host, today()), adr.dir === null ? 'cannot initialise' : 'this project already has an ADR folder'),
    propose: title => {
      // The title is the record's heading and its file name: one line of at most ADR_TITLE_MAX characters. Longer is refused with the count, never cut (ADR-481).
      const fit = titleFit(title)

      if (!fit.ok) return say(state, host, 'propose ADR', false, [fit.message])

      ask(proposeSpec(state, host, title, today()), adr.dir === null ? reason : 'type a title for the record')
    },
    status: (file, to) => {
      const doc = docOf(state, file)

      if (doc === undefined) return say(state, host, 'change ADR', false, [`${plain(file, 60)} is not an ADR here`])

      void statusSpec(state, host, doc, to).then(spec => (spec === null ? undefined : ask(spec, 'nothing to change')))
    },
    supersede: (file, byNumber) => {
      const doc = docOf(state, file)
      const by = /^\d{1,6}$/.test(byNumber.trim()) ? docByNumber(state, Number(byNumber.trim())) : undefined

      if (doc === undefined || by === undefined) return say(state, host, 'supersede ADR', false, ['give the number of the record that replaces this one'])

      void statusSpec(state, host, doc, 'superseded', by).then(spec => (spec === null ? undefined : ask(spec, 'nothing to change')))
    },
    attach: (file, on) => void setAttached(state, host, file, on),
    scope: () => void scopeCheck(state, host).then(lines => say(state, host, 'ADR scope check', true, lines)),
    draft: () => ask(draftSpec(state, host, today()), 'no active mission to draft from, or no ADR folder yet'),
  }

  wired.set(state, { host, actions })

  return actions
}
