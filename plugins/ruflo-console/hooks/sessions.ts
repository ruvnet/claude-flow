/**
 * The session workspace's runtime (ADR-486): one Workspace per console state (a side table, so nothing a transcript said can reach the state
 * that is snapshotted, exported or shown to a model), the scan that fills it, the selection, and the "read means viewed" commit.
 *
 * Scans are stat-first and incremental (data/harness-track.ts): a fast pass once a second while the pane is shown, a full relist every 15 s,
 * and almost nothing while it is closed. Nothing here starts a process, makes a model call, or touches a session it lists.
 */
import { buildIndex, type Index, type Scanned } from './data/sessions-index'
import { attentionOf, countsOf, markViewed, needsRewrite, viewedOf, type AttentionItem, type Viewed } from './data/sessions-attention'
import { claudeAdapter } from './data/harness-claude'
import { codexAdapter } from './data/harness-codex'
import { passBudget } from './data/harness-track'
import { rufloAdapter, type LedgerFacts, type RufloInput } from './data/harness-ruflo'
import type { HarnessAdapter, SessionFs } from './data/harness'
import { mcOf } from './mission-control'
import { replaceFile } from './activity-io'
import type { Host } from './host'
import type { State } from './state'

/** The fold key of the Sessions section (views/common.ts `section`: present means flipped from its default, which is closed). */
export const SESSIONS_FOLD = 'room/sessions'
export const VIEWED_KEY = 'ruflo-console/sessions-viewed'
const FAST_MS = 1000
const FULL_MS = 15_000
const CLOSED_MS = 30_000
const SHOWN_TTL_MS = 10_000

export type Workspace = {
  adapters: HarnessAdapter[]
  index: Index | null
  selected: string | null
  /** Which attention row the cursor is on (an index into the queue). */
  cursor: number
  viewed: Viewed | null
  scanning: boolean
  lastScanMs: number
  lastFullMs: number
  scanTimes: number[]
  /** Rows whose preview text a frame actually drew, with when: the page's evidence that content was displayed (data/sessions-attention.ts). */
  shown: Map<string, number>
  /** A line about the last action that could not run, with its reason. */
  note: string
  signature: string
  /** The counts last written to the summary file, so it is rewritten only when one changes or the heartbeat is due. */
  summary: string
  /** When the summary file was last written. */
  summaryAtMs: number
  /** After a failed summary write: how long the current wait is, and when the next attempt may run. */
  writeBackoffMs: number
  writeRetryAtMs: number
  timer: { cancel: () => void } | null
}

const spaces = new WeakMap<State, Workspace>()

export function rufloInputOf(state: State, nowMs: number): RufloInput {
  const ledger = new Map<string, LedgerFacts>()

  for (const mission of mcOf(state).missions.values()) ledger.set(mission.id, { ...(mission.adrs !== undefined && { adrs: mission.adrs }), tasks: mission.tasks.map(task => ({ id: task.id, dependsOn: task.dependsOn, ...(task.rufloTaskId !== undefined && { rufloTaskId: task.rufloTaskId }) })) })

  return { cwd: state.cwd, missions: state.snapshot?.missions ?? null, agents: state.snapshot?.agents ?? [], nowMs, ledger, claimedIssues: new Set((state.snapshot?.claims ?? []).filter(claim => claim.status !== 'released').map(claim => claim.issueId)) }
}

export function workspaceOf(state: State): Workspace {
  let found = spaces.get(state)

  if (found === undefined) {
    found = { adapters: [claudeAdapter(), codexAdapter(), rufloAdapter(() => rufloInputOf(state, Date.now()))], index: null, selected: null, cursor: 0, viewed: null, scanning: false, lastScanMs: 0, lastFullMs: 0, scanTimes: [], shown: new Map(), note: '', signature: '', summary: '', summaryAtMs: 0, writeBackoffMs: 0, writeRetryAtMs: 0, timer: null }
    spaces.set(state, found)
  }

  return found
}

/** The native ids of the sessions the console itself started (the terminal's saved conversations): everything else is outside Ruflo. */
export const ownIds = (state: State): ReadonlySet<string> => new Set(Object.values(state.terminal.sessions).filter((id): id is string => typeof id === 'string'))

const codexDirOf = (state: State): string | null => (state.home === null ? null : `${state.home.replace(/\/+$/, '')}/.codex`)

/** One pass over every adapter. Never rejects; a failing adapter leaves its report saying so and keeps its earlier rows. */
export async function scanSessions(state: State, host: Pick<Host, 'fs' | 'invalidate'>, full: boolean, nowMs: number = Date.now()): Promise<void> {
  const ws = workspaceOf(state)

  if (ws.scanning) return

  ws.scanning = true

  const started = performance.now()

  try {
    // One read budget for the whole pass, shared by every adapter (ADR-486 §2.4).
    const env = { fs: host.fs as SessionFs, claudeDir: state.configDir, codexDir: codexDirOf(state), nowMs, full, budget: passBudget() }
    const scans: Scanned[] = await Promise.all(
      ws.adapters.map(async adapter => ({
        id: adapter.id,
        label: adapter.label,
        capabilities: adapter.capabilities,
        result: await adapter.scan(env).catch(() => ({ state: 'failed' as const, rows: [], note: 'the scan threw; nothing was read' })),
      })),
    )

    ws.index = buildIndex(scans, ownIds(state), nowMs)
    ws.lastScanMs = nowMs
    if (full) ws.lastFullMs = nowMs
    if (ws.selected !== null && !ws.index.rows.some(row => row.key === ws.selected)) ws.selected = null
    ws.scanTimes.push(performance.now() - started)
    if (ws.scanTimes.length > 50) ws.scanTimes.shift()

    const signature = `${ws.index.rows.map(row => `${row.key}:${row.updatedMs}:${row.status}:${row.stale ?? ''}`).join(',')}|${state.pending?.label ?? ''}`

    if (signature !== ws.signature) {
      ws.signature = signature
      if (state.view === 'room' || state.view === 'overview') host.invalidate()
    }
  } finally {
    ws.scanning = false
  }
}

/** The queue as the page draws it (the console's own pending confirm included). Empty until the viewed state has loaded. */
export function queueOf(state: State): AttentionItem[] {
  const ws = workspaceOf(state)

  if (ws.index === null || ws.viewed === null) return state.pending === null ? [] : attentionOf([], { baselineMs: Date.now(), seen: {} }, { label: state.pending.label, askedAtMs: state.pending.askedAtMs })

  return attentionOf(ws.index.rows, ws.viewed, state.pending === null ? null : { label: state.pending.label, askedAtMs: state.pending.askedAtMs })
}

export const attentionCounts = (state: State) => countsOf(queueOf(state))

/** Selecting a row changes only which row is looked at: no read, no process, no wake. */
export function selectRow(state: State, key: string | null): void {
  const ws = workspaceOf(state)

  ws.selected = key !== null && ws.index?.rows.some(row => row.key === key) === true ? key : null
  ws.note = ''
}

/** The view calls this when it drew a row's preview text. It only notes the fact; `commitViewed` acts on it. */
export function noteShown(state: State, key: string, atMs: number = Date.now()): void {
  workspaceOf(state).shown.set(key, atMs)
}

/**
 * Read means viewed: an unread completion or a failure clears only for a row whose preview text a frame drew in the last few seconds while
 * the Room was the page in front. A placeholder, an error line, a hidden pane or another page clears nothing. Returns whether anything cleared.
 */
export function commitViewed(state: State, host: Pick<Host, 'storeSet' | 'invalidate'>, nowMs: number = Date.now()): boolean {
  const ws = workspaceOf(state)

  for (const [key, at] of ws.shown) if (nowMs - at > SHOWN_TTL_MS) ws.shown.delete(key)

  if (ws.viewed === null || state.view !== 'room' || !state.pane.isShown || ws.shown.size === 0) return false

  const items = queueOf(state).filter(item => item.rowKey !== null && ws.shown.has(item.rowKey))
  const next = markViewed(ws.viewed, items)

  ws.shown.clear()

  if (next === ws.viewed) return false

  ws.viewed = next
  void host.storeSet(VIEWED_KEY, next).catch(() => undefined)
  host.invalidate()

  return true
}

/** Where the counts-only summary ruflo-mods can show lives: the console's own state folder, in a ruflo project, rewritten when a count changes or the heartbeat is due. */
export const ATTENTION_FILE = '.claude-flow/console/attention.json'
/** The file is rewritten at least this often while the workspace runs, so a reader can tell a quiet queue from a console that stopped (ruflo-mods hooks/attention.ts ATTENTION_STALE_MS). */
export const ATTENTION_HEARTBEAT_MS = 5 * 60_000
/** The first wait after a failed write of the summary; it doubles up to ATTENTION_HEARTBEAT_MS. */
export const WRITE_RETRY_MS = 30_000

export async function mirrorAttention(state: State, host: Pick<Host, 'fs' | 'run'>, nowMs: number = Date.now()): Promise<void> {
  const ws = workspaceOf(state)

  if (ws.viewed === null || ws.index === null || state.snapshot?.isRufloProject !== true) return

  const counts = attentionCounts(state)
  const key = `${counts['needs-approval']}/${counts.question}/${counts.failed}/${counts['completed-unread']}`

  if (key === ws.summary && nowMs - ws.summaryAtMs < ATTENTION_HEARTBEAT_MS) return
  if (nowMs < ws.writeRetryAtMs) return

  ws.summary = key
  ws.summaryAtMs = nowMs
  // Counts only: no title, path or transcript text is in this file.
  const text = `${JSON.stringify({ schema: 'ruflo-console.attention/1', approve: counts['needs-approval'], question: counts.question, failed: counts.failed, unread: counts['completed-unread'], atMs: nowMs })}\n`

  if ((await replaceFile(host, state.cwd, `${state.cwd.replace(/\/+$/, '')}/${ATTENTION_FILE}`, text)) === null) {
    ws.writeBackoffMs = 0
    ws.writeRetryAtMs = 0

    return
  }

  // A failed write is retried, but not every tick: 30 s, doubling to 5 minutes, until one succeeds.
  ws.summary = ''
  ws.writeBackoffMs = ws.writeBackoffMs === 0 ? WRITE_RETRY_MS : Math.min(ATTENTION_HEARTBEAT_MS, ws.writeBackoffMs * 2)
  ws.writeRetryAtMs = nowMs + ws.writeBackoffMs
}

export type SessionActions = {
  select: (key: string) => void
  /** Moves the selection through the rows in the order the page lists them. */
  move: (by: number) => void
  /** Selects the session an attention item is about (the console's own confirm has none). */
  jump: (itemId: string) => void
  refresh: () => void
  /** Enter on a row: opens it natively only where the harness declared it can; otherwise says why not. */
  open: (key: string) => void
}

export function sessionActions(state: State, host: Pick<Host, 'fs' | 'invalidate'>): SessionActions {
  const ws = workspaceOf(state)
  const order = () => ws.index?.groups.flatMap(group => group.rows) ?? []

  return {
    select: key => {
      selectRow(state, key)
      host.invalidate()
    },
    move: by => {
      const rows = order()
      const at = rows.findIndex(row => row.key === ws.selected)

      if (rows.length > 0) selectRow(state, rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? (by > 0 ? -1 : rows.length) : at) + by))]?.key ?? null)
      host.invalidate()
    },
    jump: id => {
      const item = queueOf(state).find(candidate => candidate.id === id)

      if (item?.rowKey != null) {
        selectRow(state, item.rowKey)
        // The browser starts folded so the Room's own sections stay in view; jumping to a session opens it.
        state.sections.add(SESSIONS_FOLD)
      }
      host.invalidate()
    },
    refresh: () => void scanSessions(state, host, true),
    open: key => {
      const row = ws.index?.rows.find(candidate => candidate.key === key)
      const caps = ws.index?.reports.find(report => report.id === row?.harness)?.capabilities

      ws.note = row === undefined ? 'that session is gone' : caps?.resume.supported === true ? 'this harness can open sessions, but phase 1 wires no opener' : `open is unavailable for ${row.harness}: ${caps?.resume.why ?? 'not declared'}`
      host.invalidate()
    },
  }
}

/**
 * Loads the viewed map. The baseline is the first time this queue ever ran: older completions are history, not unread. It is stored so a
 * restart keeps it. A stored value that was not a Viewed, or held a stamp or baseline in the future, is written back repaired, once.
 */
export async function loadViewed(state: State, host: Pick<Host, 'storeGet' | 'storeSet'>, nowMs: number = Date.now()): Promise<void> {
  const ws = workspaceOf(state)
  let raw: unknown

  try {
    raw = await host.storeGet(VIEWED_KEY)
  } catch {
    ws.viewed = viewedOf(null, nowMs)

    return
  }

  ws.viewed = viewedOf(raw, nowMs)
  if (needsRewrite(raw, ws.viewed)) await host.storeSet(VIEWED_KEY, ws.viewed).catch(() => undefined)
}

/** Starts the watcher once. A closed pane scans rarely; a shown one every second (stat-only unless something changed). */
export function startSessions(state: State, host: Host): void {
  const ws = workspaceOf(state)

  if (ws.timer !== null) return

  void loadViewed(state, host)

  ws.timer = host.every(FAST_MS, () => {
    if (!state.options.sessionWorkspace) return

    const now = Date.now()
    const isSeen = state.pane.isOpen && state.pane.isShown

    if (!isSeen && now - ws.lastScanMs < CLOSED_MS) return

    void scanSessions(state, host, now - ws.lastFullMs >= FULL_MS, now).then(() => {
      commitViewed(state, host)
      void mirrorAttention(state, host, now)
    })
  })
}
