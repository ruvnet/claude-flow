/**
 * The Workflows page's cost and guard readings (ADR-462), kept out of the controller and out of the views: a draw never reads a disk.
 * `refreshWfGuards` runs once per refresh tick right after `refreshWorkflows`, under the same gate (the page in front, the pane shown),
 * and fills one module-level store that the board slots and the notice slot (views/wf-triage.ts) read:
 *   - the price book, from the ruflo-cost-tracker's `data/prices.json` (path from the validated install record, byte-capped);
 *   - each agent's transcript usage, one bounded read apiece: a file over TRANSCRIPT_CAP is tail-read where the host can (a floor, marked),
 *     a refresh reads at most READ_BUDGET bytes of files it has not parsed before, and the rest wait for the next refresh (shown as n/a);
 *   - the progress marks for the stuck rule, and (only when the `dirty` rule is on) a read-only `git status` of at most 12 worktrees.
 * Nothing is written, nothing is stopped, and a failed read leaves the last figures with the reason.
 */
import { agentKey, evaluateGuards, NO_RULES, parseGuardRules, trackProgress, type GuardAlert, type GuardRules, type Mark } from './data/wf-alerts'
import { costRun, parsePriceBook, spendOf, usageOfTranscript, type AgentUsage, type PriceBook, type RunCost } from './data/wf-cost'
import { trackerOf } from './data/cost-ledger'
import { cleanText } from './data/wf-clean'
import { readBounded, under } from './data/files'
import { TAIL_BYTES, TRANSCRIPT_CAP, type WorkflowFs } from './data/workflows-read'
import type { WfRun } from './data/workflows'
import type { Host } from './host'
import type { State } from './state'

/** The most of the price book that is read. */
export const BOOK_CAP = 300_000
/** The most bytes of transcripts parsed afresh in one refresh; a parsed file is remembered until it changes. */
export const READ_BUDGET = 24_000_000
export const MAX_DIRTY_PROBES = 12

export type Coverage = { read: number; total: number; bytes: number; /** Transcripts left for a later refresh or unreadable. */ left: number }

export type GuardStore = {
  book: PriceBook | null
  /** Why there is no book, in plain words; '' while there is one. */
  bookWhy: string
  costs: Map<string, RunCost>
  coverage: Coverage
  marks: Map<string, Mark>
  /** Worktree dirtiness by `<run>/<agent>`; null where the rule is off or nothing was read. */
  dirty: Map<string, boolean> | null
  rules: GuardRules
  /** The keys of the alerts raised and still true (views/wf-triage.ts: the notice slot). */
  raised: Set<string>
  readAtMs: number
  isReading: boolean
  error: string | null
}

const fresh = (): GuardStore => ({ book: null, bookWhy: 'prices not read yet', costs: new Map(), coverage: { read: 0, total: 0, bytes: 0, left: 0 }, marks: new Map(), dirty: null, rules: NO_RULES, raised: new Set(), readAtMs: 0, isReading: false, error: null })

/** The store the slots read. One console, one store. */
export let guards: GuardStore = fresh()

/** For tests: empties the store and the parse memory. */
export function resetWfGuards(): void {
  guards = fresh()
  parsed.clear()
}

type Parsed = { sig: string; usage: AgentUsage }
/** What each transcript parsed to, by path, valid while its size and mtime are what they were. Bounded, oldest out. */
const parsed = new Map<string, Parsed>()
const PARSED_MAX = 800

/** True for a path under `root` with no `..` part and no control character. */
export const isUnder = (path: string, root: string | null): boolean => root !== null && !/[\u0000-\u001f]/.test(path) && !path.split('/').includes('..') && path.startsWith(`${root.replace(/\/+$/, '')}/`)

const rememberParsed = (path: string, entry: Parsed): void => {
  parsed.delete(path)
  parsed.set(path, entry)
  if (parsed.size > PARSED_MAX) parsed.delete(parsed.keys().next().value as string)
}

/** One agent's usage from its transcript, or null (with whether it was left for later) when it cannot be had now. */
async function usageOf(fs: WorkflowFs, path: string, budget: { left: number; bytes: number }): Promise<{ usage: AgentUsage } | { later: boolean }> {
  const stat = await fs.stat(path).catch(() => undefined)

  // A link or anything but a file (a device, a pipe) is never read: its size would say 0 and the read would not end.
  if (stat === undefined || typeof stat.size !== 'number' || stat.isLink === true || (stat.kind !== undefined && stat.kind !== 'file')) return { later: false }

  const sig = `${stat.size}:${stat.mtimeMs ?? 0}`
  const held = parsed.get(path)

  if (held !== undefined && held.sig === sig) return { usage: held.usage }

  const isTail = stat.size > TRANSCRIPT_CAP
  const cost = isTail ? TAIL_BYTES : stat.size

  if (cost > budget.left) return { later: true }
  if (isTail && fs.readTail === undefined) return { later: false }

  // The bytes are spent before the read starts: files are read side by side, and the budget must hold across them.
  budget.left -= cost
  budget.bytes += cost

  const text = await (isTail ? (fs.readTail as NonNullable<WorkflowFs['readTail']>)(path, TAIL_BYTES) : fs.read(path)).catch(() => null)

  if (text === null) return { later: false }

  const usage: AgentUsage = { byModel: usageOfTranscript(text, isTail), isTail }

  rememberParsed(path, { sig, usage })

  return { usage }
}

/** Reads the price book of the cost tracker, or says why not. */
async function readBook(state: State, host: Host): Promise<{ book: PriceBook | null; why: string }> {
  const tracker = trackerOf(state)

  if (tracker.kind === 'absent') return { book: null, why: 'the ruflo-cost-tracker plugin is not installed, so tokens have no price' }
  if (tracker.kind === 'old') return { book: null, why: `ruflo-cost-tracker ${tracker.version} is too old to carry the price book` }

  const read = await readBounded(host.fs, state.cache, under(tracker.root, 'data/prices.json'), BOOK_CAP)
  const book = parsePriceBook(read.text)

  return book === null ? { book: null, why: read.text === null ? `the price book was not read (${read.reason})` : 'the price book is not in the expected shape' } : { book, why: '' }
}

/** `git status` of one worktree, read-only: no optional locks, no fsmonitor program from the repository's config, nothing written. */
async function isDirty(host: Host, path: string): Promise<boolean | undefined> {
  const result = await host.run(['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', path, 'status', '--porcelain=v1', '--untracked-files=no'], 5000).catch(() => null)

  return result === null || result.exitCode !== 0 ? undefined : result.stdout.trim() !== ''
}

/** Every guard that is true now over `runs`, from the store as the last cost read left it. Pure over the store; it reads nothing. */
export const activeAlerts = (runs: readonly WfRun[], nowMs: number): GuardAlert[] => evaluateGuards({ runs, rules: guards.rules, marks: guards.marks, dirty: guards.dirty, spend: spendOf(guards.costs.values()), nowMs })

/** The runs to price, running ones first, then as read (newest first). */
const priority = (runs: readonly WfRun[]): WfRun[] => [...runs.filter(run => run.kind === 'workflow' && run.running > 0), ...runs.filter(run => run.kind === 'workflow' && run.running === 0)]

/**
 * Reads the cost and guard figures for the runs `refreshWorkflows` last read. Same gate as that read; one at a time; resolves when done
 * or not needed. `force` skips the pane check (the open of the page). It never throws: a failure is `guards.error`.
 */
export async function refreshWfGuards(state: State, host: Host, force = false, nowMs: number = Date.now()): Promise<void> {
  if (state.view !== 'workflows' || guards.isReading || state.wf.read === null) return
  if (!force && state.isInteractive && !(state.pane.isOpen && state.pane.isShown)) return

  const store = guards
  const isFirst = store.readAtMs === 0

  store.isReading = true

  try {
    const runs = priority(state.wf.read.runs)
    const options = state.options as unknown as { wfBudgetRunUsd?: number; wfBudgetDayUsd?: number; wfAlertRules?: string }
    const rules = parseGuardRules(options)
    const fs = host.fs as WorkflowFs
    const { book, why } = await readBook(state, host)
    const budget = { left: READ_BUDGET, bytes: 0 }
    const usage = new Map<string, AgentUsage>()
    let total = 0
    let left = 0

    for (const run of runs) {
      await Promise.all(
        run.phases.flatMap(phase => phase.agents).map(async agent => {
          total += 1

          if (agent.transcriptPath === undefined || !isUnder(agent.transcriptPath, state.configDir === null ? null : `${state.configDir.replace(/\/+$/, '')}/projects`)) return

          const got = await usageOf(fs, agent.transcriptPath, budget)

          if ('usage' in got) usage.set(agentKey(run.id, agent.id), got.usage)
          else if (got.later) left += 1
        }),
      )
    }

    let dirty: Map<string, boolean> | null = null

    if (rules.isDirty) {
      dirty = new Map()

      const candidates = runs.flatMap(run => run.phases.flatMap(phase => phase.agents.map(agent => ({ run, agent })))).filter(({ agent }) => agent.hasWorktree && agent.state !== 'running' && agent.state !== 'queued' && agent.worktreePath !== undefined && isUnder(agent.worktreePath, state.cwd)).slice(0, MAX_DIRTY_PROBES)

      await Promise.all(
        candidates.map(async ({ run, agent }) => {
          const answer = await isDirty(host, agent.worktreePath as string)

          if (answer !== undefined) (dirty as Map<string, boolean>).set(agentKey(run.id, agent.id), answer)
        }),
      )
    }

    store.book = book
    store.bookWhy = why
    store.costs = new Map(runs.map(run => [run.id, costRun(run, usage, book)]))
    store.coverage = { read: usage.size, total, bytes: budget.bytes, left }
    store.marks = trackProgress(store.marks, state.wf.read.runs, nowMs)
    store.dirty = dirty
    store.rules = rules
    store.readAtMs = nowMs
    store.error = null

    // The first reading announces nothing, as the page's own notices do: what is already true when the console looks is on the Cost board, and only a crossing after it raises a notice.
    if (isFirst) store.raised = new Set(activeAlerts(state.wf.read.runs, nowMs).map(alert => alert.key))
  } catch (error) {
    store.error = error instanceof Error ? cleanText(error.message).slice(0, 100) : 'the read was refused'
  } finally {
    store.isReading = false
    host.invalidate()
  }
}
