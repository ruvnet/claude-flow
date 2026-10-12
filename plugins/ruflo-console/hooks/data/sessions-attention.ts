/**
 * The attention queue (ADR-486): what needs the person, across every harness. Four kinds, in this order: needs-approval, question, failed,
 * completed-unread. An approval or a question stays until the harness stops reporting it (viewing never clears one). A failure or a completion
 * clears once its content was actually displayed (`markViewed`, committed by the page after the frame that drew the preview), and comes back
 * only if the session moves on to something newer. Completions older than the baseline (when this queue first ran) are history, not unread.
 * An unassigned row raises nothing: its identity is in doubt.
 */
import { ATTENTION_KINDS, type AttentionKind, type SessionRow } from './harness'
import { FUTURE_SLACK_MS } from './harness-text'

export type Viewed = { baselineMs: number; seen: Record<string, number> }
export const SEEN_MAX = 500

export type AttentionItem = { id: string; kind: AttentionKind; rowKey: string | null; title: string; harness: string; atMs: number; detail: string; stale: boolean }
export type PendingAsk = { label: string; askedAtMs: number } | null

const DETAIL: Record<AttentionKind, string> = { 'needs-approval': 'waiting for your yes', question: 'asked you a question', failed: 'the last tool failed', 'completed-unread': 'finished since you looked' }

export const newViewed = (nowMs: number): Viewed => ({ baselineMs: nowMs, seen: {} })

/** A stored value read back: anything not shaped like a Viewed is a fresh one, never trusted. */
export function viewedOf(raw: unknown, nowMs: number): Viewed {
  if (typeof raw !== 'object' || raw === null) return newViewed(nowMs)

  const value = raw as { baselineMs?: unknown; seen?: unknown }
  const seen: Record<string, number> = {}

  if (typeof value.seen === 'object' && value.seen !== null) {
    // A stamp in the future (stored from a skewed timestamp before times were held to the clock) would silence its session forever: dropped.
    for (const [key, stamp] of Object.entries(value.seen).slice(0, SEEN_MAX)) if (typeof stamp === 'number' && Number.isFinite(stamp) && stamp <= nowMs + FUTURE_SLACK_MS) seen[key.slice(0, 300)] = stamp
  }

  // A baseline in the future would make every completion until then "history": it is held to now.
  return { baselineMs: typeof value.baselineMs === 'number' && Number.isFinite(value.baselineMs) ? Math.min(value.baselineMs, nowMs) : nowMs, seen }
}

/** Whether the stored value differs from what `viewedOf` made of it (not a Viewed, or a stamp dropped or held): the store needs the repaired one. */
export function needsRewrite(raw: unknown, viewed: Viewed): boolean {
  if (typeof raw !== 'object' || raw === null) return true

  const value = raw as { baselineMs?: unknown; seen?: unknown }
  const seen = typeof value.seen === 'object' && value.seen !== null ? (value.seen as Record<string, unknown>) : null

  if (value.baselineMs !== viewed.baselineMs || seen === null) return true

  const keys = Object.keys(viewed.seen)

  return Object.keys(seen).length !== keys.length || keys.some(key => seen[key] !== viewed.seen[key])
}

const seenKey = (rowKey: string, kind: AttentionKind) => `${rowKey}|${kind}`

export function attentionOf(rows: readonly SessionRow[], viewed: Viewed, pending: PendingAsk): AttentionItem[] {
  const items: AttentionItem[] = []

  if (pending !== null) items.push({ id: 'console:pending', kind: 'needs-approval', rowKey: null, title: pending.label, harness: 'console', atMs: pending.askedAtMs, detail: 'a confirm is waiting for your yes', stale: false })

  for (const row of rows) {
    if (row.unassigned !== null) continue

    const add = (kind: AttentionKind, atMs: number) => items.push({ id: seenKey(row.key, kind), kind, rowKey: row.key, title: row.title, harness: row.harness, atMs, detail: DETAIL[kind], stale: row.stale !== null })

    if (row.signals.approval) add('needs-approval', row.updatedMs)
    if (row.signals.question) add('question', row.updatedMs)
    // A time is never believed past the row's own last write (the adapters also hold it to the clock: harness-text.ts believedAt), so nothing
    // stored as seen can sit in the future and silence the session.
    const held = (ms: number): number => Math.max(1, Math.min(ms, row.updatedMs > 0 ? row.updatedMs : Number.POSITIVE_INFINITY))

    // Failed is the adapter's verdict (status), which waits out the quiet period, not the raw signal; it is keyed on when the failure was
    // recorded, so a title or cost line appended later does not bring a seen failure back.
    if (row.signals.failed && row.status === 'failed') {
      const at = held(row.signals.failedAtMs ?? row.updatedMs)

      if (at > (viewed.seen[seenKey(row.key, 'failed')] ?? 0)) add('failed', at)
    }

    const ended = row.signals.turnEndedAtMs === null ? null : held(row.signals.turnEndedAtMs)

    if (ended !== null && ended >= viewed.baselineMs && ended > (viewed.seen[seenKey(row.key, 'completed-unread')] ?? 0) && !row.signals.question) add('completed-unread', ended)
  }

  return items.sort((a, b) => ATTENTION_KINDS.indexOf(a.kind) - ATTENTION_KINDS.indexOf(b.kind) || b.atMs - a.atMs)
}

/** Records that the content of these items was displayed. Approvals and questions are not recorded: only the harness resolves them. */
export function markViewed(viewed: Viewed, items: readonly AttentionItem[]): Viewed {
  const seen = { ...viewed.seen }
  let changed = false

  for (const item of items) {
    if (item.rowKey === null || (item.kind !== 'failed' && item.kind !== 'completed-unread')) continue
    if ((seen[item.id] ?? 0) >= item.atMs) continue

    seen[item.id] = item.atMs
    changed = true
  }

  if (!changed) return viewed

  const kept = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, SEEN_MAX)

  return { baselineMs: viewed.baselineMs, seen: Object.fromEntries(kept) }
}

export const countsOf = (items: readonly AttentionItem[]): Record<AttentionKind, number> => ({
  'needs-approval': items.filter(item => item.kind === 'needs-approval').length,
  question: items.filter(item => item.kind === 'question').length,
  failed: items.filter(item => item.kind === 'failed').length,
  'completed-unread': items.filter(item => item.kind === 'completed-unread').length,
})
