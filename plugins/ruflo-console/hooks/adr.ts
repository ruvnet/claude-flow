/**
 * The ADRs page's logic (ADR-480): find the ADR folder of the project the console is running in, read and index its records, write a
 * new one or change a status through the confirm row (with the exact file and diff in view), attach records to a mission, and keep the
 * digest the mission, the loop and the swarm agents read. Every read and write may fail; none throws. Writes stay inside the project
 * root: a folder or file that is a link is never read or written through, a new file never overwrites, and a status change is refused
 * if the file moved since the diff was shown. The pure parts are in data/adr.ts, data/adr-write.ts and data/adr-scope.ts.
 */
import type { ActionSpec, RunReport } from './actions'
import { replaceFile } from './activity-io'
import { indexOf, lint, MAX_FILE, MAX_FILES, parseAdr, type AdrDoc, type AdrStatus, type Finding, type Registry, STATUSES } from './data/adr'
import { checkScope, digestBlock, reportLines, suggest, type ScopeReport, type Suggestion } from './data/adr-scope'
import { adrDirText, detectStyle, draftFromMission, fileNameFor, initialRecord, lineDiff, nextNumber, renderNew, titleClean, titleFit, withStatus, withSupersedes, type Style, type StyleName } from './data/adr-write'
import { record as recordEvents } from './data/events'
import { readBounded, type ReadCache } from './data/files'
import { plain } from './data/parse'
import { checkNoLinks, dirOf, newFileArgv, replaceFileArgv } from './data/wf-file'
import { writeFlavorReady } from './data/write-flavor'
import type { Host } from './host'
import { activeMission, mcOf, record, saveLedger } from './mission-control'
import type { MissionRecord } from './mission-types'
import type { Runner } from './runner'
import { settingsOf } from './settings'
import type { State } from './state'

/** Where projects keep ADRs, in the order they are tried when the person has not named a folder. */
export const ADR_FOLDERS: readonly string[] = ['docs/adr', 'docs/adrs', 'doc/adr', 'doc/adrs', 'adr', 'adrs', 'docs/architecture/decisions', 'docs/architecture/adr', 'docs/decisions', 'architecture/decisions', 'decisions']
/** The folder `initialise` creates when the project has none. */
export const DEFAULT_FOLDER = 'docs/adr'

const INDEX_FILE = /^(?:readme|index|_index|summary)\.md$|^index[-_.].*\.md$/i
const SKIP_FILE = /template/i
const ADR_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.md$/
export const MAX_RESULT_LINES = 40

export type AdrFilter = { status: AdrStatus | 'all'; text: string; scope: string }
export type AdrLast = { label: string; ok: boolean; lines: string[] }

export type AdrState = {
  /** The folder was looked for and read (until then the page says it is reading). */
  isLoaded: boolean
  isLoading: boolean
  /** The folder, relative to the project; null when there is none (or it was refused). */
  dir: string | null
  /** Why there is no folder or what was skipped, in a line. */
  why: string
  registry: Registry
  findings: Finding[]
  files: string[]
  index: string | null
  style: Style
  filter: AdrFilter
  page: number
  selected: string | null
  last: AdrLast | null
  scope: ScopeReport | null
  loadedAtMs: number
  cache: ReadCache
}

const empty = (): Registry => indexOf([])
const states = new WeakMap<State, AdrState>()

export function adrOf(state: State): AdrState {
  let found = states.get(state)

  if (found === undefined) {
    found = { isLoaded: false, isLoading: false, dir: null, why: 'not read yet', registry: empty(), findings: [], files: [], index: null, style: detectStyle([]), filter: { status: 'all', text: '', scope: '' }, page: 0, selected: null, last: null, scope: null, loadedAtMs: 0, cache: new Map() }
    states.set(state, found)
  }

  return found
}

export const root = (state: State): string => state.cwd.replace(/\/+$/, '')
const isDir = (kind: string | undefined): boolean => kind === 'dir' || kind === 'directory'

/** The folder the project keeps its ADRs in: the setting if there is one, else the first usual place that exists. A link is refused. */
export async function discover(host: Pick<Host, 'fs'>, cwd: string, setting: string): Promise<{ dir: string | null; why: string }> {
  const base = cwd.replace(/\/+$/, '')
  const named = adrDirText(setting)
  const tries = named !== null && named !== '' ? [named] : ADR_FOLDERS
  let refused = ''

  if (base === '' || !base.startsWith('/')) return { dir: null, why: 'no project folder is known' }

  for (const candidate of tries) {
    const stat = await host.fs.stat(`${base}/${candidate}`).catch(() => undefined)

    if (stat === undefined) continue

    // Every folder on the way down must be a real one: a link could lead out of the project.
    const safe = await checkNoLinks(host.fs, `${base}/${candidate}/.adr-probe`, { cwd: base }, { allowExisting: true })

    if (!safe.ok) {
      refused = refused === '' ? `${candidate}: ${safe.why}` : refused
      continue
    }
    if (!isDir(stat.kind)) {
      refused = refused === '' ? `${candidate} is not a folder` : refused
      continue
    }

    return { dir: candidate, why: '' }
  }

  return { dir: null, why: refused !== '' ? `not read: ${refused}` : named !== null && named !== '' ? `no folder ${named} in this project` : `no ADR folder found (looked for ${ADR_FOLDERS.slice(0, 5).join(', ')} and ${ADR_FOLDERS.length - 5} more)` }
}

/** Reads the folder again: finds it, parses every record (bounded), lints, detects the style. Never throws. */
export async function loadAdrs(state: State, host: Pick<Host, 'fs' | 'invalidate'>): Promise<void> {
  const adr = adrOf(state)

  if (adr.isLoading) return

  adr.isLoading = true
  host.invalidate()

  try {
    const prefs = settingsOf(state).ai
    const found = await discover(host, state.cwd, prefs.adrDir)

    if (found.dir === null) {
      adr.dir = null
      adr.why = found.why
      adr.registry = empty()
      adr.findings = []
      adr.files = []
      adr.index = null
    } else {
      const entries = await host.fs.list(`${root(state)}/${found.dir}`).catch(() => [])
      const names = entries.filter(entry => entry.kind !== 'symlink' && entry.kind !== 'link' && !isDir(entry.kind) && ADR_NAME.test(entry.name)).map(entry => entry.name).sort()
      const indexName = names.find(name => INDEX_FILE.test(name)) ?? null
      const candidates = names.filter(name => !INDEX_FILE.test(name) && !SKIP_FILE.test(name))
      const kept = candidates.slice(0, MAX_FILES)
      const docs: AdrDoc[] = []
      let skipped = 0

      for (let i = 0; i < kept.length; i += 16) {
        const reads = await Promise.all(kept.slice(i, i + 16).map(async name => ({ name, read: await readBounded(host.fs, adr.cache, `${root(state)}/${found.dir}/${name}`, MAX_FILE * 4, true).catch(() => null) })))

        for (const { name, read } of reads) {
          if (read === null || read.text === null) skipped += 1
          else docs.push(parseAdr(name, read.text))
        }
      }

      const indexRead = indexName === null ? null : await readBounded(host.fs, adr.cache, `${root(state)}/${found.dir}/${indexName}`, 400_000, true).catch(() => null)

      adr.dir = found.dir
      adr.why = skipped > 0 ? `${skipped} file${skipped === 1 ? '' : 's'} could not be read (a link, too large, or refused)` : ''
      adr.registry = indexOf(docs, candidates.length > MAX_FILES)
      adr.files = names
      adr.index = indexRead?.text ?? null
      adr.findings = lint(adr.registry, names, adr.index)
    }

    adr.style = detectStyle(adr.registry.docs, { style: prefs.adrStyle, pattern: prefs.adrPattern })
    adr.isLoaded = true
    adr.loadedAtMs = Date.now()
    if (adr.selected !== null && !adr.registry.docs.some(doc => doc.file === adr.selected)) adr.selected = null
  } catch {
    adr.why = 'the ADR folder could not be read'
  } finally {
    adr.isLoading = false
    host.invalidate()
  }
}

export const docOf = (state: State, file: string): AdrDoc | undefined => adrOf(state).registry.docs.find(doc => doc.file === file)
export const docByNumber = (state: State, number: number): AdrDoc | undefined => adrOf(state).registry.byNumber.get(number)?.[0]

export const say = (state: State, host: Pick<Host, 'invalidate'>, label: string, ok: boolean, lines: string[]): void => {
  adrOf(state).last = { label, ok, lines: lines.slice(0, MAX_RESULT_LINES).map(line => plain(line, 200)) }
  host.invalidate()
}

/**
 * The page's last result as a run's report, so the runner keeps it as the outcome Claude reads too. The detail is the line that says what
 * happened: the first of a success, the last of a failure (whatever was written before it stays in the lines).
 */
export function reported(state: State): RunReport | undefined {
  const last = adrOf(state).last

  if (last === null) return undefined

  const at = last.ok ? 0 : Math.max(0, last.lines.length - 1)

  return { label: last.label, ok: last.ok, detail: last.lines[at] ?? '', lines: last.lines.filter((_, index) => index !== at) }
}

/** One event on the Events page and one toast (source console, level info): the ADR said what happened, once. */
export function announce(state: State, host: Pick<Host, 'toast'>, text: string): void {
  const line = plain(text, 118)

  recordEvents(state.events, [{ atMs: Date.now(), kind: 'notices', text: `adr: ${line}` }])
  if (state.isInteractive) host.toast(line, 6000, 'info')
}

export const abs = (state: State, dir: string, name: string): string => `${root(state)}/${dir}/${name}`

async function writeNew(state: State, host: Pick<Host, 'fs' | 'run'>, dir: string, name: string, text: string): Promise<string | null> {
  const path = abs(state, dir, name)
  const safe = await checkNoLinks(host.fs, path, { cwd: root(state) })

  if (!safe.ok) return safe.why

  const hasDir = (await host.fs.stat(dirOf(path)).catch(() => undefined)) !== undefined
  const result = await host.run(newFileArgv(path, hasDir, await writeFlavorReady()), 10_000, text).catch((error: unknown) => ({ exitCode: null, stdout: '', stderr: error instanceof Error ? error.message : 'the command could not start' }))

  if (result.exitCode !== 0) return writeFailure(result.exitCode, result.stderr)

  const back = await host.fs.read(path).catch(() => null)

  return back === text ? null : 'the file was written but reads back differently'
}

/**
 * Why a create failed, in the person's words: the write's own reason (its first stderr line, plain and capped) and that nothing was
 * replaced. It does not guess at a race: a file that appeared meanwhile says so in that reason ("cannot overwrite existing file", "File exists").
 */
export function writeFailure(exitCode: number | null, stderr: string | undefined): string {
  const reason = plain((stderr ?? '').split('\n').map(line => line.trim()).find(line => line !== '') ?? '', 160)

  return `the write failed (${exitCode === null ? 'it could not run' : `exit ${exitCode}`}${reason === '' ? '' : `: ${reason}`}); no file was replaced`
}

/** The new file as the confirm shows it: every line, up to 40, each marked +. */
const preview = (text: string): string => `${text.split('\n').slice(0, 40).map(line => `+${line}`).join('\n')}${text.split('\n').length > 40 ? '\n+… (the rest of the file is the same template)' : ''}`

/** The confirm for creating the project's first record (and its folder). Never overwrites. */
export function initSpec(state: State, host: Pick<Host, 'fs' | 'run' | 'invalidate' | 'toast'>, today: string): ActionSpec | null {
  const adr = adrOf(state)

  if (adr.dir !== null) return null

  const dir = adrDirText(settingsOf(state).ai.adrDir) || DEFAULT_FOLDER
  const style = detectStyle([], { style: settingsOf(state).ai.adrStyle === 'auto' ? 'nygard' : settingsOf(state).ai.adrStyle, pattern: settingsOf(state).ai.adrPattern })
  const first = initialRecord(style, today)

  return {
    label: `initialise ADRs here: create ${dir}/${first.file}`,
    scope: 'adrs',
    args: [],
    declared: 'write',
    shows: `create ${dir}/${first.file} inside this project (a new file; an existing file is never overwritten)\n${preview(first.text)}`,
    expect: `${dir}/${first.file} in this project`,
    note: 'Creates the folder if it is missing and one new file in it. Nothing is overwritten and nothing outside this project is touched.',
    run: async () => {
      const problem = await writeNew(state, host, dir, first.file, first.text)

      await loadAdrs(state, host)
      say(state, host, 'initialise ADRs', problem === null, problem === null ? [`created ${dir}/${first.file}`, 'your project now has an ADR folder; propose the next record from this page'] : [problem])
      if (problem === null) announce(state, host, `ADRs initialised: ${dir}/${first.file}`)

      return reported(state)
    },
  }
}

/** The confirm for a new proposed record: the next number, the project's file name and headings, never overwriting. */
export function proposeSpec(state: State, host: Pick<Host, 'fs' | 'run' | 'invalidate' | 'toast'>, rawTitle: string, today: string, extra: { context?: string; decision?: string; scope?: string[] } = {}): ActionSpec | null {
  const adr = adrOf(state)
  const title = titleClean(rawTitle)

  // Over the limit is no proposal at all, never a cut one (ADR-481); the caller says why with titleFit's count.
  if (adr.dir === null || title === '' || !titleFit(rawTitle).ok) return null

  const dir = adr.dir
  const number = nextNumber(adr.registry.docs)
  const name = fileNameFor(adr.style, number, title)

  if (!ADR_NAME.test(name) || adr.files.includes(name)) return null

  const text = renderNew(adr.style, { number, title, date: today, status: 'proposed', ...(extra.scope !== undefined && { scope: extra.scope }), ...(extra.context !== undefined && { context: extra.context }), ...(extra.decision !== undefined && { decision: extra.decision }) })

  return {
    label: `propose ADR ${number}: ${title}`,
    scope: 'adrs',
    args: [],
    declared: 'write',
    shows: `create ${dir}/${name} (a new file; an existing file is never overwritten)\n${preview(text)}`,
    expect: `${dir}/${name} in this project`,
    note: `Writes one new file in your project's ADR folder, in the style ${adr.style.name} (${adr.style.source}). It is only proposed: nothing binds anyone until it is accepted.`,
    run: async () => {
      const problem = await writeNew(state, host, dir, name, text)

      await loadAdrs(state, host)
      if (problem === null) adrOf(state).selected = name
      say(state, host, `propose ADR ${number}`, problem === null, problem === null ? [`created ${dir}/${name}`, 'edit its Context and Decision, then accept it from this page'] : [problem])
      if (problem === null) announce(state, host, `ADR ${number} proposed: ${title}`)

      return reported(state)
    },
  }
}

const TRANSITIONS: Record<AdrStatus, AdrStatus[]> = { proposed: ['accepted', 'rejected'], accepted: ['superseded', 'deprecated'], superseded: [], deprecated: ['accepted'], rejected: ['proposed'], unknown: ['proposed', 'accepted'] }
export const transitionsOf = (doc: AdrDoc): AdrStatus[] => TRANSITIONS[doc.status]

type Change = { file: string; before: string; after: string }

/** The files a status change would edit, as before and after: one, or two when an ADR is superseded by another. */
export async function planStatus(state: State, host: Pick<Host, 'fs'>, doc: AdrDoc, to: AdrStatus, by: AdrDoc | null): Promise<{ ok: true; changes: Change[] } | { ok: false; why: string }> {
  const adr = adrOf(state)

  if (adr.dir === null) return { ok: false, why: 'no ADR folder' }
  if (to === doc.status) return { ok: false, why: `it is already ${to}` }
  if (!TRANSITIONS[doc.status].includes(to)) return { ok: false, why: `${doc.status} → ${to} is not a change this page makes (${TRANSITIONS[doc.status].join(', ') || 'none'} follow ${doc.status})` }
  if (to === 'superseded' && (by === null || by.number === null || by === doc || by.status === 'rejected')) return { ok: false, why: 'superseding needs another record (accepted or proposed) that replaces this one' }

  const read = async (file: string): Promise<string | null> => (await readBounded(host.fs, new Map(), abs(state, adr.dir as string, file), MAX_FILE * 4, true).catch(() => null))?.text ?? null
  const before = await read(doc.file)

  if (before === null) return { ok: false, why: `${doc.file} could not be read` }

  const byRef = by === null || by.number === null ? null : { number: by.number, title: by.title, file: by.file }
  const edited = withStatus(before, doc, adr.style, to, byRef)

  if (!edited.ok) return { ok: false, why: edited.why }

  const changes: Change[] = [{ file: doc.file, before, after: edited.text }]

  if (to === 'superseded' && by !== null && doc.number !== null) {
    const newer = await read(by.file)

    if (newer === null) return { ok: false, why: `${by.file} could not be read` }

    const linked = withSupersedes(newer, by, adr.style, { number: doc.number, title: doc.title, file: doc.file })

    if (!linked.ok) return { ok: false, why: linked.why }
    if (linked.text !== newer) changes.push({ file: by.file, before: newer, after: linked.text })
  }

  return { ok: true, changes }
}

/** The confirm for a status change: the exact files and the diff of each. At run time each file is read again and must be unchanged. */
export async function statusSpec(state: State, host: Pick<Host, 'fs' | 'run' | 'invalidate' | 'toast'>, doc: AdrDoc, to: AdrStatus, by: AdrDoc | null = null): Promise<ActionSpec | null> {
  const adr = adrOf(state)
  const plan = await planStatus(state, host, doc, to, by)

  if (!plan.ok) {
    say(state, host, `change ADR ${doc.number ?? doc.file}`, false, [plan.why])

    return null
  }

  const dir = adr.dir as string
  const word = to === 'superseded' && by !== null ? `superseded by ADR ${by.number}` : to

  return {
    label: `mark ADR ${doc.number ?? doc.file} ${word}`,
    scope: 'adrs',
    args: [],
    declared: 'write',
    shows: plan.changes.map(change => `${dir}/${change.file}\n${lineDiff(change.before, change.after, change.file).join('\n')}`).join('\n\n'),
    expect: plan.changes.map(change => `${dir}/${change.file}`).join(' and '),
    note: `Changes only the lines shown, in ${plan.changes.length} file${plan.changes.length === 1 ? '' : 's'} of your project. A file that changed since this diff was made is left alone.`,
    run: async () => {
      const done: string[] = []
      const failed = (lines: string[]): RunReport | undefined => (say(state, host, `change ADR ${doc.number ?? doc.file}`, false, lines), reported(state))

      for (const change of plan.changes) {
        const path = abs(state, dir, change.file)
        const safe = await checkNoLinks(host.fs, path, { cwd: root(state) }, { allowExisting: true })

        if (!safe.ok) return failed([...done, safe.why])

        const now = await host.fs.read(path).catch(() => null)

        if (now !== change.before) return failed([...done, `${change.file} changed since the diff was shown: nothing was written to it. Ask again.`])

        const result = await host.run(replaceFileArgv(path, true, await writeFlavorReady()), 10_000, change.after).catch(() => null)
        const back = await host.fs.read(path).catch(() => null)

        if (result === null || result.exitCode !== 0 || back !== change.after) return failed([...done, `${change.file} could not be written as shown`])

        done.push(`wrote ${change.file}`)
      }

      await loadAdrs(state, host)
      say(state, host, `change ADR ${doc.number ?? doc.file}`, true, done)
      announce(state, host, `ADR ${doc.number ?? doc.file} ${to === 'superseded' && by !== null ? `superseded by ADR ${by.number}` : to}`)

      return reported(state)
    },
  }
}
