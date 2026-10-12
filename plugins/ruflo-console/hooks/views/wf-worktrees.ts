/**
 * Worktrees on the Workflows page (ADR-463): a board section that lists the repository's git worktrees (branch, ahead and behind
 * origin/main, dirty, age, which run and agent made it) and one confirm-gated action that removes the ones that are merged, clean,
 * idle and not the one this session is in. Registered through the slot seams (views/wf-slots.ts): `import './wf-worktrees'` in
 * views/wf-register.ts, and `wireWfWorktrees(state, host)` once where the other actions are wired.
 *
 * Reads run only while the page is open: the page's refresh asks the notice slot below, which re-reads at most once a minute.
 * The live-process check (it lists every process's cwd, exe and fds) runs on the read button and before a removal, never on
 * the timer. A removal asks first with the exact list, then re-checks each worktree just before removing it, one at a time,
 * with `git worktree remove` and no --force: git itself refuses a dirty or locked one.
 */
import type { RenderElement } from 'claude-code'

import type { ActionSpec } from '../actions'
import { plain } from '../data/parse'
import { cleanText } from '../data/wf-clean'
import { checkProcs, failureOf, inUseOf, planRemoval, readSummary, readWorktrees, REMOVE_ARGV, REMOVE_MAX, whyKept, type ProcCheck, type WtIo, type WtRead, type WtRow } from '../data/wf-worktrees'
import type { Host } from '../host'
import type { State } from '../state'
import { workflowsModelOf } from '../wf-live'
import { ago, clip, row, text, THEME, type Ctx } from './common'
import { flow } from './wf-layout'
import { registerSlot, type SlotEnv } from './wf-slots'

type Store = { read: WtRead | null; check: ProcCheck | null; isReading: boolean; error: string | null; lastMs: number }

const stores = new WeakMap<State, Store>()
const hosts = new WeakMap<State, Host>()
let active: State | null = null

/** The page's clock for ages and freshness; a test sets it. */
export const clock = { now: (): number => Date.now() }

/** Re-read no more often than this on the timer. */
export const AUTO_MS = 60_000
/** Rows drawn; the rest are counted, never silently dropped. */
export const SHOWN = 14

const storeOf = (state: State): Store => stores.get(state) ?? stores.set(state, { read: null, check: null, isReading: false, error: null, lastMs: 0 }).get(state)!

/** The host the reads and the removal need; set once with the other actions. */
export function wireWfWorktrees(state: State, host: Host): void {
  hosts.set(state, host)
  active = state
}

const ioOf = (host: Host): WtIo => ({ run: (argv, ms) => host.run(argv, ms), stat: path => host.fs.stat(path) })
const runsOf = (state: State, nowMs: number) => workflowsModelOf(state, nowMs)?.runs ?? []

/** Reads the worktrees (and, when asked, the live processes). One read at a time; a failed read keeps the rows already shown and says why. */
export async function refreshWorktrees(state: State, host: Host, withProcs: boolean, nowMs: number = clock.now()): Promise<void> {
  const store = storeOf(state)

  if (store.isReading) return

  store.isReading = true
  store.lastMs = nowMs
  host.invalidate()

  try {
    const io = ioOf(host)
    const read = await readWorktrees(io, { cwd: state.cwd, nowMs, runs: runsOf(state, nowMs) })

    store.read = read
    store.error = null
    if (withProcs) store.check = await checkProcs(io, read.rows.map(entry => entry.path), nowMs)
  } catch (error) {
    store.error = failureOf(error)
  } finally {
    store.isReading = false
    host.invalidate()
  }
}

const dayAge = (ms: number): string => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : ms < 172_800_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / 86_400_000)}d`)

/** The path as the page names it: relative to the main worktree where it is inside, else the last two parts. */
export const nameOf = (root: string, path: string): string => plain(path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path.split('/').slice(-2).join('/'), 80)

function line(ctx: Ctx, read: WtRead, entry: WtRow, check: ProcCheck | null, nowMs: number): RenderElement {
  const why = whyKept(entry, read, check, nowMs)
  const inUse = inUseOf(check, entry.path)
  const counts = entry.ahead === null ? '↑? ↓?' : `↑${entry.ahead} ↓${entry.behind ?? '?'}`
  const dirty = entry.dirty === null ? 'dirty ?' : entry.dirty === 0 ? 'clean' : `${entry.dirty >= 200 ? '200+' : entry.dirty} changed`
  const age = entry.createdMs === null ? 'age ?' : dayAge(nowMs - entry.createdMs)
  const made = entry.maker === null ? 'not attributed' : `${cleanText(entry.maker.run)} · ${cleanText(entry.maker.agent)}${entry.maker.how === 'by name' ? ' (by name)' : ''}`
  const wide = ctx.columns >= 110
  const name = clip(nameOf(read.root, entry.path), wide ? 34 : 24).padEnd(wide ? 34 : 24)
  const branch = clip(entry.branch ?? (entry.isDetached ? 'detached' : '—'), 22).padEnd(22)
  const verdict = why === null ? 'removable' : `kept: ${why}`
  const tone = why === null ? THEME.ok : entry.isMain || entry.isCurrent ? THEME.info : undefined

  return row(ctx, [
    text(ctx, ` ${why === null ? '✔' : entry.isMain ? '■' : entry.isCurrent ? '▸' : '·'} `, { ...(tone !== undefined && { color: tone }) }),
    text(ctx, name, { bold: why === null }),
    ...(ctx.columns >= 90 ? [text(ctx, `${branch} `, { dimColor: true })] : []),
    text(ctx, `${counts} · ${dirty} · ${age}${inUse !== null && inUse > 0 ? ` · ${inUse} live` : ''} · ${made}  `, { dimColor: true }),
    text(ctx, verdict, { ...(tone !== undefined && { color: tone }), dimColor: tone === undefined }),
  ], `wt-${entry.path}`)
}

/** Removable first, then the longest-lived: the order a person cleaning up reads in. */
export function ordered(read: WtRead, check: ProcCheck | null, nowMs: number): WtRow[] {
  const rank = (entry: WtRow): number => (whyKept(entry, read, check, nowMs) === null ? 0 : entry.isMain || entry.isCurrent ? 2 : 1)

  return [...read.rows].sort((a, b) => rank(a) - rank(b) || (a.createdMs ?? Infinity) - (b.createdMs ?? Infinity))
}

export function boardRows(env: SlotEnv): RenderElement[] {
  const { ctx, nowMs } = env
  const store = storeOf(ctx.state)
  const rows: RenderElement[] = []

  if (hosts.get(ctx.state) === undefined) return [text(ctx, ' worktrees: not wired into this console yet (wireWfWorktrees)', { color: THEME.warn })]

  if (store.error !== null) rows.push(text(ctx, ` the last read failed (${clip(store.error, 80)})${store.read === null ? '' : ': showing the read before it'}`, { color: THEME.warn }))
  if (store.read === null) return [...rows, text(ctx, store.isReading ? ' reading the worktrees…' : store.error === null ? ' not read yet: it reads while this page is open, or press the read button (w)' : ' press the read button (w) to try again', { dimColor: true })]

  const { read, check } = store
  const plan = planRemoval(read, check, nowMs)
  const shown = ordered(read, check, nowMs)

  rows.push(text(ctx, ` ${readSummary(read)} · read ${ago(read.atMs, nowMs)} · origin/main as last fetched ${read.refAtMs === null ? 'n/a' : ago(read.refAtMs, nowMs)} (nothing is fetched here)`, { dimColor: true }))
  for (const entry of shown.slice(0, SHOWN)) rows.push(line(ctx, read, entry, check, nowMs))
  if (shown.length > SHOWN) rows.push(text(ctx, ` +${shown.length - SHOWN} more worktrees not drawn (the list is cut at ${SHOWN} rows)`, { dimColor: true }))

  rows.push(text(ctx, check === null ? ' live processes: not checked (the read button, w, checks them; the timer never does)' : check.ok ? ` live processes: ${check.seen} working directories seen, ${ago(check.atMs, nowMs)}, your own processes only` : ` live processes: ${check.why ?? 'unknown'}`, { dimColor: check?.ok === true, ...(check?.ok === true ? {} : { color: THEME.warn }) }))
  rows.push(text(ctx, plan.targets.length > 0 ? ` cleanup: ${plan.targets.length} worktree${plan.targets.length === 1 ? '' : 's'} ready to remove${plan.more > 0 ? ` (${plan.more} more after these ${REMOVE_MAX})` : ''}; the button lists them first` : ` cleanup: ${plan.blocked ?? 'nothing to remove'}`, { color: plan.targets.length > 0 ? THEME.ok : undefined, dimColor: plan.targets.length === 0 }))
  rows.push(text(ctx, ' removed: the directory only, never the branch, never with --force; each is re-checked just before it goes', { dimColor: true }))
  rows.push(...flow(ctx, [{ key: 'wt-read', label: store.isReading ? 'reading…' : 'read worktrees + live processes', onPress: () => void readFull(env.ctx.state) }], 'wt-actions'))

  return rows
}

async function readFull(state: State): Promise<void> {
  const host = hosts.get(state)

  if (host !== undefined) await refreshWorktrees(state, host, true)
}

/** The confirm card's spec: the exact list, then a run that re-checks and removes one at a time. Null when nothing qualifies. */
export function removalSpec(env: SlotEnv): ActionSpec | null {
  const { state } = env.ctx
  const host = hosts.get(state)
  const store = storeOf(state)
  const nowMs = clock.now()
  const plan = planRemoval(store.read, store.check, nowMs)
  const root = store.read?.root

  if (host === undefined || root === undefined || plan.targets.length === 0) return null

  const count = plan.targets.length
  const targets = plan.targets.map(entry => entry.path)

  return {
    label: `remove ${count} merged, clean worktree${count === 1 ? '' : 's'}`,
    scope: 'workflows',
    args: [],
    declared: 'delete',
    shows: targets.map(path => REMOVE_ARGV(root, path).join(' ')).join('  ·  '),
    expect: 'each directory gone and no longer in git worktree list',
    note: `Removes only these ${count} worktree director${count === 1 ? 'y' : 'ies'} (branches stay; files git ignores, such as build output, go with the directory). Each is re-checked just before it goes, one at a time, with no --force: git refuses a dirty or locked one.${plan.more > 0 ? ` ${plan.more} more qualify and wait for the next confirm.` : ''}`,
    run: async () => {
      const io = ioOf(host)
      const gone: string[] = []
      const skipped: string[] = []

      for (const path of targets) {
        const at = clock.now()
        const label = nameOf(root, path)

        try {
          const fresh = await readWorktrees(io, { cwd: state.cwd, nowMs: at, runs: runsOf(state, at), only: path })
          const entry = fresh.rows[0]
          const check = await checkProcs(io, [path], at)
          const why = entry === undefined || fresh.root !== root ? 'no longer listed under the same main worktree' : whyKept(entry, fresh, check, at)

          if (why !== null) {
            skipped.push(`${label}: ${why}`)
            continue
          }

          const result = await host.run(REMOVE_ARGV(root, path), 60_000)

          if (result.exitCode === 0) gone.push(label)
          else skipped.push(`${label}: git said ${cleanText(plain(result.stderr || result.stdout, 100)) || `exit ${result.exitCode}`}`)
        } catch (error) {
          skipped.push(`${label}: ${failureOf(error)}`)
        }
      }

      await refreshWorktrees(state, host, true)

      const now = storeOf(state).read
      const verified = gone.length === 0 ? 'n/a' : gone.every(label => now !== null && !now.rows.some(entry => nameOf(root, entry.path) === label)) ? 'yes' : 'no'

      state.outcome = { label: 'remove worktrees', ok: skipped.length === 0 && gone.length > 0, verified, detail: `${gone.length} removed, ${skipped.length} kept`, atMs: clock.now(), lines: [...gone.map(label => `removed ${label}`), ...skipped.map(entry => `kept ${entry}`)].slice(0, 20) }
      host.invalidate()
    },
  }
}

/** Registers this module's slots; the import below does it once, and a test that emptied the registry calls it again (a repeat is refused harmlessly). */
export function registerWorktreeSlots(): void {
  registerSlot({ kind: 'board', id: 'worktrees', title: 'Worktrees (read-only list; one confirm-gated removal)', order: 40, render: boardRows })
  registerSlot({ kind: 'key', id: 'wt-read', key: 'w', label: 'worktrees', run: env => void readFull(env.ctx.state) })
  registerSlot({ kind: 'action', id: 'wt-clean', label: 'clean worktrees', hotkey: 'c', why: 'nothing to remove: read the worktrees and live processes first (w); only clean worktrees fully inside origin/main, older than a day, with no live process, outside this session, qualify', spec: removalSpec })

  /** The page's refresh asks this after each read: the one place that runs on the timer while the page is open, never while it is closed. */
  registerSlot({
    kind: 'notice',
    id: 'wt-timer',
    between: (_prev, _next, nowMs) => {
      const state = active
      const host = state === null ? undefined : hosts.get(state)

      if (state !== null && host !== undefined && !storeOf(state).isReading && nowMs - storeOf(state).lastMs >= AUTO_MS) void refreshWorktrees(state, host, false, nowMs)

      return []
    },
  })
}

registerWorktreeSlots()

/** For tests: forgets what was read and wired. */
export const resetWorktrees = (state: State): void => {
  stores.delete(state)
  hosts.delete(state)
  if (active === state) active = null
}

/** For tests: what the store holds. */
export const storeFor = (state: State): Readonly<Store> => storeOf(state)
