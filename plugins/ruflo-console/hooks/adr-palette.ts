/**
 * Palette entries for the ADRs page (ADR-480), so `/ruflo run adr-propose <title>` works headless and Claude can reach the same actions
 * through `console_run` at the level the person allowed: looking is `read`; proposing, initialising, attaching and changing a status are
 * `write`, and a write still waits for the person's Yes with the exact file and diff in view. A status change is two steps by design: the
 * entry only prepares the change, and the confirm that follows shows the diff and writes only on the person's own Yes.
 */
import type { ActionSpec } from './actions'
import { adrOf, docByNumber, initSpec, proposeSpec } from './adr'
import { adrWired, titleFit } from './adr-actions'
import { STATUSES, type AdrStatus } from './data/adr'
import { plain } from './data/parse'
import type { PaletteEntry } from './palette'
import type { State } from './state'

const today = (): string => new Date().toISOString().slice(0, 10)
const NUMBER = /^(?:adr[-\s]*)?0*(\d{1,6})$/i

const TO: Record<string, AdrStatus> = { 'adr-accept': 'accepted', 'adr-reject': 'rejected', 'adr-deprecate': 'deprecated' }

export function adrPalette(state: State): PaletteEntry[] {
  const wired = adrWired(state)
  const adr = adrOf(state)
  // Why an entry has nothing to run, most basic first: no console in this session, the ADR folder not read yet (the page reads it when opened), then the value itself.
  const blocked = wired === undefined ? 'the console is not running in this session: open it first (console_open adrs)' : !adr.isLoaded ? 'the ADR folder has not been read this session: open the ADRs page first (console_open adrs), then run it again' : null
  const numbered = (keyword: string) => (value: string): string => {
    // adr-supersede takes two numbers; every other entry one, written as "3", "0003" or "adr-3".
    const words = keyword === 'adr-supersede' ? value.trim().split(/\s+/) : [value.trim()]
    const missing = words.find(word => docFor(word) === undefined)

    const usage = keyword === 'adr-supersede' ? `type two ADR numbers, the old then the new: "${keyword} 1 3"` : `type the ADR number: "${keyword} 3"`

    if (blocked !== null) return blocked
    if (missing === undefined || (keyword === 'adr-supersede' && words.length !== 2)) return usage

    const number = NUMBER.exec(missing)?.[1]

    return number === undefined ? usage : `no ADR ${Number(number)} in ${adr.dir ?? 'the ADR folder'}`
  }
  const local = (label: string, run: () => void, declared?: NonNullable<ActionSpec['declared']>): ActionSpec | null => (wired === undefined ? null : { label, args: [], expect: label, isReadOnly: true, ...(declared !== undefined && { declared }), run: async () => void run() })
  const text = (keyword: string, make: (value: string) => ActionSpec | null) => ({ kind: 'text' as const, keyword, make: (value: string) => (wired === undefined ? null : make(value)), why: numbered(keyword) })
  const docFor = (value: string) => {
    const match = NUMBER.exec(value.trim())

    return match === null ? undefined : docByNumber(state, Number(match[1]))
  }
  const needDoc = (value: string, then: (file: string) => void, label: string, declared?: NonNullable<ActionSpec['declared']>): ActionSpec | null => {
    const doc = docFor(value)

    return doc === undefined ? null : local(label.replace('N', String(doc.number)), () => then(doc.file), declared)
  }
  const status = (keyword: string, label: string): PaletteEntry => ({
    id: keyword,
    group: 'adrs',
    label: `${keyword} <number>: ${label} (prepares the change; the diff then asks for your Yes)`,
    run: text(keyword, value => needDoc(value, file => wired?.actions.status(file, TO[keyword] as AdrStatus), `prepare the status change of ADR N (the diff follows)`, 'write')),
  })

  return [
    { id: 'adr-open', group: 'adrs', label: 'open the ADRs page: your project’s Architecture Decision Records', run: { kind: 'view', view: 'adrs' } },
    {
      id: 'adr-show',
      group: 'adrs',
      label: 'adr-show <number>: select an ADR; its digest is on the ADRs page',
      run: text('adr-show', value => {
        const doc = docFor(value)

        return doc === undefined ? null : local(`show ADR ${doc.number}`, () => wired?.actions.select(doc.file))
      }),
    },
    { id: 'adr-init', group: 'adrs', label: 'initialise ADRs here: create the folder and a first record (asks first, never overwrites)', run: { kind: 'spec', spec: wired === undefined ? null : initSpec(state, wired.host, today()), why: blocked ?? 'this project already has an ADR folder' } },
    {
      id: 'adr-propose',
      group: 'adrs',
      label: 'adr-propose <title>: write a new proposed ADR in the project’s style (asks first, shows the file)',
      // A title over the limit is refused with its count, never cut (ADR-481): `/ruflo run` and console_run reach this, not the page's field.
      run: {
        ...text('adr-propose', value => (wired === undefined || !titleFit(value).ok ? null : proposeSpec(state, wired.host, value, today()))),
        why: (value: string) => {
          const fit = titleFit(value)

          return wired !== undefined && !fit.ok ? fit.message : blocked ?? (adr.dir === null ? 'this project has no ADR folder yet: adr-init first' : 'type a title: "adr-propose Use Postgres"')
        },
      },
    },
    status('adr-accept', 'mark a proposed ADR accepted'),
    status('adr-reject', 'mark a proposed ADR rejected'),
    status('adr-deprecate', 'mark an accepted ADR deprecated'),
    {
      id: 'adr-supersede',
      group: 'adrs',
      label: 'adr-supersede <old> <new>: mark an ADR superseded by another (prepares the change; the diff asks for your Yes)',
      run: text('adr-supersede', value => {
        const [old, by] = value.trim().split(/\s+/)
        const doc = docFor(old ?? '')
        const newer = docFor(by ?? '')

        return doc === undefined || newer === undefined ? null : local(`prepare superseding ADR ${doc.number} by ADR ${newer.number} (the diff follows)`, () => wired?.actions.supersede(doc.file, String(newer.number)), 'write')
      }),
    },
    { id: 'adr-attach', group: 'adrs', label: 'adr-attach <number>: attach an ADR to the active mission (Claude and the swarm are told its decision)', run: text('adr-attach', value => needDoc(value, file => wired?.actions.attach(file, true), 'attach ADR N to the active mission', 'write')) },
    { id: 'adr-detach', group: 'adrs', label: 'adr-detach <number>: detach an ADR from the active mission', run: text('adr-detach', value => needDoc(value, file => wired?.actions.attach(file, false), 'detach ADR N from the active mission', 'write')) },
    { id: 'adr-scope', group: 'adrs', label: 'compare the changed files with the paths in the active mission’s accepted ADRs (paths only)', run: { kind: 'spec', spec: local('compare changed files with the attached ADRs', () => wired?.actions.scope()), why: blocked ?? '' } },
  ].map(entry => ({ ...entry, label: plain(entry.label, 200) })) as PaletteEntry[]
}

export const ADR_STATUS_WORDS: readonly string[] = STATUSES
