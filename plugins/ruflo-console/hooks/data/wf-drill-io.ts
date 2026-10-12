/**
 * What the drill-down reads, and the only place it reads anything (ADR-459). Everything here is read-only, byte-capped and path-checked:
 *
 *   transcripts   `<configDir>/projects/**\/agent-<id>.jsonl`, whole up to TRANSCRIPT_CAP, else the last TAIL_BYTES where the host can
 *   the journal   `<run dir>/journal.jsonl`, up to JOURNAL_CAP, for the structured result of one agent
 *   a worktree    one `git diff --numstat` over the agent's worktree, only if it lies inside the project's folder
 *
 * A view never reads: it asks `textOf` / `parsedOf` for what is already in memory (the page's own refresh keeps live runs' transcripts in
 * the console's read cache), and a button calls a loader here for the rest. The loaders need the host, which no slot is handed, so the
 * merge owner binds it once (`bindDrill`); unbound, the drill still draws everything the cache holds and says what it could not read.
 * A refusal, a missing file or a file too large is a stated reason, never an empty success.
 */
import { readBounded, type ReadCache } from './files'
import { cleanLine, cleanPath, journalResult, type Capped, type Parsed } from './wf-activity'
import { activityOf, parsedStats, PARSED_BUDGET_CHARS, resetStore } from './wf-incr-store'
import { TAIL_BYTES, TRANSCRIPT_CAP, type WorkflowFs } from './workflows-read'
import type { WfAgent, WfRun } from './workflows'

export const JOURNAL_CAP = 1_000_000
/** Bytes of transcript one "read the run's transcripts" press may bring in (each is also held to TRANSCRIPT_CAP). */
export const LOAD_BUDGET = 24_000_000
const DIFF_CAP_LINES = 400

/** The engine pieces the loaders use; `Host` has them all. */
export type DrillHost = { fs: WorkflowFs; run: (argv: readonly string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr?: string }>; invalidate: () => void }
type Bound = { cache: ReadCache; configDir: string | null; cwd: string; host: DrillHost }

let bound: Bound | null = null

/** Gives the loaders the console's read cache, config directory, working directory and host. Call once at boot; calling again replaces it. */
export function bindDrill(state: { cache: ReadCache; configDir: string | null; cwd: string }, host: DrillHost): void {
  bound = { cache: state.cache, configDir: state.configDir, cwd: state.cwd, host }
}

export const isBound = (): boolean => bound !== null

/** For tests: forgets the binding and everything held. */
export function resetDrillIo(): void {
  bound = null
  resetStore()
  tails.clear()
  notes.clear()
  results.clear()
  diffs.clear()
}

/** True for a path under `<configDir>/projects/` with no `..` part and no NUL: the only place a run's files live. */
export function isRunFile(path: string, configDir: string | null): boolean {
  if (configDir === null || path.includes('\0') || path.includes('\n') || path.split('/').includes('..')) return false

  return path.startsWith(`${configDir.replace(/\/+$/, '')}/projects/`)
}

/** True for an absolute path inside the project's working directory (where Claude Code puts an agent's worktree), with no `..` part. */
export function isProjectDir(path: string, cwd: string): boolean {
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\n') || path.split('/').includes('..')) return false

  const root = cwd.replace(/\/+$/, '')

  return root !== '' && (path === root || path.startsWith(`${root}/`))
}

export type Note = { phase: 'loading' | 'ok' | 'none' | 'failed'; why?: string }
const notes = new Map<string, Note>()
const MAX_HELD = 24

const hold = <V>(map: Map<string, V>, key: string, value: V, max = MAX_HELD): void => {
  map.delete(key)
  map.set(key, value)

  if (map.size > max) map.delete(map.keys().next().value as string)
}

export const noteOf = (key: string): Note | undefined => notes.get(key)

/**
 * The parse memo is bounded by the text it holds, not by a count of files (data/wf-incr-store.ts): a live project has 6 runs x 60 agents, and a memo
 * of 24 entries was walked past by every frame that asked for all of them (the search panel does), so each draw parsed ~340 transcripts again
 * (bench-workflows.mjs: 66 ms a frame). A transcript that grew is parsed from where its last parse ended, not from its first line (ADR-473).
 */
export { parsedStats, PARSED_BUDGET_CHARS }

const tails = new Map<string, { text: string; size: number; tag: string }>()

export type Text = { text: string; isTail: boolean; /** Which version of the file a tail is (size and mtime): two windows can read the same at different places. */ tag: string }

/** The transcript text in memory for an agent: the console's read cache (whole files, handed in by the caller), else a tail this module read; null where neither has it. */
export function textOf(cache: ReadCache, agent: WfAgent): Text | null {
  const path = agent.transcriptPath

  if (path === undefined) return null

  const held = cache.get(path)

  if (held !== undefined && 'text' in held) return { text: held.text, isTail: false, tag: '' }

  const tail = tails.get(path)

  return tail === undefined ? null : { text: tail.text, isTail: true, tag: tail.tag }
}

/** The agent's transcript parsed, memoised by the text itself so an unchanged file is parsed once however often the page draws, and a grown one only from its new lines. */
export function parsedOf(cache: ReadCache, agent: WfAgent): Parsed | null {
  const text = textOf(cache, agent)
  const path = agent.transcriptPath

  if (text === null || path === undefined) return null

  return activityOf(path, text.text, text.isTail, text.tag)
}

/** Reads one agent's transcript into memory. Resolves when done; never rejects. */
export async function loadTranscript(agent: WfAgent): Promise<void> {
  const b = bound
  const path = agent.transcriptPath

  if (b === null || path === undefined) return

  if (!isRunFile(path, b.configDir) || !/\/agent-[A-Za-z0-9]+\.jsonl$/.test(path)) {
    notes.set(path, { phase: 'failed', why: 'that path is outside Claude Code\'s projects folder, so it is not read' })
    b.host.invalidate()

    return
  }

  notes.set(path, { phase: 'loading' })
  b.host.invalidate()

  try {
    const read = await readBounded(b.host.fs, b.cache, path, TRANSCRIPT_CAP, true)

    if (read.text !== null) notes.set(path, { phase: 'ok' })
    else if (read.reason === 'too-large' && b.host.fs.readTail !== undefined) {
      const tail = await b.host.fs.readTail(path, TAIL_BYTES)

      hold(tails, path, { text: tail, size: read.size ?? 0, tag: `${read.size ?? 0}` })
      notes.set(path, { phase: 'ok', why: `${(read.size ?? 0) / 1_000_000 >= 0.1 ? `${((read.size ?? 0) / 1_000_000).toFixed(1)} MB` : 'a large file'}: only the last ${Math.round(TAIL_BYTES / 1000)} KB is read` })
    } else notes.set(path, { phase: 'failed', why: read.reason === 'too-large' ? `${((read.size ?? 0) / 1_000_000).toFixed(1)} MB is over the ${(TRANSCRIPT_CAP / 1_000_000).toFixed(1)} MB read cap and this host cannot read a tail` : read.reason === 'missing' ? 'the file is gone' : 'the host refused the read' })
  } catch (error) {
    notes.set(path, { phase: 'failed', why: cleanLine(error instanceof Error ? error.message : String(error), 80) || 'the read was refused' })
  } finally {
    b.host.invalidate()
  }
}

/** Reads every workflow agent's transcript of a run that is not in memory yet, up to LOAD_BUDGET bytes in all. Returns how many were left for the budget. */
export async function loadRun(run: WfRun): Promise<{ loaded: number; left: number }> {
  const b = bound

  if (b === null) return { loaded: 0, left: 0 }

  const todo = run.phases.flatMap(phase => phase.agents).filter(agent => agent.ruflo === undefined && agent.transcriptPath !== undefined && textOf(b.cache, agent) === null)
  let spent = 0
  let loaded = 0

  for (const [i, agent] of todo.entries()) {
    const size = (await b.host.fs.stat(agent.transcriptPath as string).catch(() => undefined))?.size ?? 0

    if (spent + Math.min(size, TRANSCRIPT_CAP) > LOAD_BUDGET) return { loaded, left: todo.length - i }

    spent += Math.min(size, TRANSCRIPT_CAP)
    await loadTranscript(agent)
    loaded += 1
  }

  return { loaded, left: 0 }
}

/** Reads again every large transcript whose tail is held, so a followed log of one moves on: the last TAIL_BYTES, each time. */
export async function reloadTails(): Promise<void> {
  const b = bound

  if (b === null || b.host.fs.readTail === undefined) return

  for (const [path, held] of [...tails]) {
    if (!isRunFile(path, b.configDir)) continue

    try {
      const stat = await b.host.fs.stat(path).catch(() => undefined)
      const size = stat?.size ?? held.size

      hold(tails, path, { text: await b.host.fs.readTail(path, TAIL_BYTES), size, tag: `${size}:${stat?.mtimeMs ?? 0}` })
    } catch {
      // The held tail stays; the next tick tries again.
    }
  }

  b.host.invalidate()
}

const results = new Map<string, Capped | 'none'>()

/** The structured result a run's journal kept for an agent: the washed text, `'none'` where the journal has none, undefined before it is read. */
export const resultOf = (run: WfRun, agent: WfAgent): Capped | 'none' | undefined => results.get(`${run.id}/${agent.id}`)

export async function loadResult(run: WfRun, agent: WfAgent): Promise<void> {
  const b = bound
  const key = `${run.id}/${agent.id}`

  if (b === null || run.dir === undefined) return

  const path = `${run.dir.replace(/\/+$/, '')}/journal.jsonl`

  if (!isRunFile(path, b.configDir)) {
    notes.set(key, { phase: 'failed', why: 'the run folder is outside Claude Code\'s projects folder, so its journal is not read' })
    b.host.invalidate()

    return
  }

  notes.set(key, { phase: 'loading' })

  try {
    const read = await readBounded(b.host.fs, b.cache, path, JOURNAL_CAP, true)

    if (read.text === null) notes.set(key, { phase: 'failed', why: read.reason === 'too-large' ? `the journal is over the ${(JOURNAL_CAP / 1_000_000).toFixed(0)} MB read cap` : read.reason === 'missing' ? 'the journal is gone' : 'the host refused the read' })
    else {
      hold(results, key, journalResult(read.text, agent.id) ?? 'none')
      notes.set(key, { phase: 'ok' })
    }
  } catch {
    notes.set(key, { phase: 'failed', why: 'the read was refused' })
  } finally {
    b.host.invalidate()
  }
}

export type Diff = Map<string, { add: number | null; del: number | null }>
const diffs = new Map<string, { files: Diff; extra: number }>()

/** `git diff --numstat` lines: `12\t3\tpath`, and `-\t-\tpath` for a binary file (its counts are null). */
export function parseNumstat(stdout: string): { files: Diff; extra: number } {
  const files: Diff = new Map()
  let extra = 0

  for (const line of stdout.split('\n')) {
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)

    if (match === null) continue

    if (files.size >= DIFF_CAP_LINES) {
      extra += 1
      continue
    }

    files.set(cleanPath(match[3] as string), { add: match[1] === '-' ? null : Number(match[1]), del: match[2] === '-' ? null : Number(match[2]) })
  }

  return { files, extra }
}

export const diffOf = (agent: WfAgent): { files: Diff; extra: number } | undefined => (agent.worktreePath === undefined ? undefined : diffs.get(agent.worktreePath))

/**
 * The fixed argv of the one process this module runs: no shell, the path is its own argument after `-C`, no external diff driver, no text
 * conversion, no fsmonitor hook and no optional lock. A `filter.*.clean` command in the worktree's own config can still run when git compares
 * the working tree with HEAD; that is why only a worktree inside this project's folder is read.
 */
export const diffArgv = (worktree: string): string[] => ['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', worktree, 'diff', '--numstat', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD', '--']

export async function loadDiff(agent: WfAgent): Promise<void> {
  const b = bound
  const path = agent.worktreePath

  if (b === null || path === undefined) return

  if (!isProjectDir(path, b.cwd)) {
    notes.set(path, { phase: 'failed', why: 'the worktree is not inside this project\'s folder, so it is not read' })
    b.host.invalidate()

    return
  }

  notes.set(path, { phase: 'loading' })
  b.host.invalidate()

  try {
    const stat = await b.host.fs.stat(path).catch(() => undefined)

    if (stat === undefined) notes.set(path, { phase: 'none', why: 'the worktree folder no longer exists' })
    else {
      const result = await b.host.run(diffArgv(path), 8000)

      if (result.exitCode !== 0) notes.set(path, { phase: 'failed', why: cleanLine(result.stderr ?? `git exited ${result.exitCode}`, 100) || `git exited ${result.exitCode}` })
      else {
        hold(diffs, path, parseNumstat(result.stdout.slice(0, 200_000)))
        notes.set(path, { phase: 'ok' })
      }
    }
  } catch (error) {
    notes.set(path, { phase: 'failed', why: cleanLine(error instanceof Error ? error.message : String(error), 80) || 'the probe was refused' })
  } finally {
    b.host.invalidate()
  }
}
