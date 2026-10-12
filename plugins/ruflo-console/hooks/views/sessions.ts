/**
 * The session workspace on the Room and a line on the Overview (ADR-486): the attention queue ("Needs you"), the session browser grouped by
 * repository and worktree, and the preview of the selected session. Every string drawn from a transcript went through the one sanitiser
 * (data/harness-text.ts `shown`) when it was read. The preview is drawn only when the page is drawn for a person: `ctx.text` (a text answer
 * a model may read) gets the structure and never a line of a transcript. A frame that drew a preview says so (`noteShown`), and that is the
 * only thing that ever clears an unread completion.
 */
import type { RenderElement } from 'claude-code'

import type { AttentionKind, SessionRow } from '../data/harness'
import { CAPABILITIES } from '../data/harness'
import { rowOf } from '../data/sessions-index'
import { attentionCounts, noteShown, queueOf, workspaceOf } from '../sessions'
import { ago, button, clip, row, rule, section, text, THEME, type Ctx } from './common'
import { fullRows } from './full-rows'

const KIND_LABEL: Record<AttentionKind, string> = { 'needs-approval': 'needs your yes', question: 'asked a question', failed: 'failed', 'completed-unread': 'finished' }
const KIND_COLOR: Record<AttentionKind, string> = { 'needs-approval': THEME.warn, question: THEME.warn, failed: THEME.bad, 'completed-unread': THEME.ok }
const STATUS_MARK: Record<SessionRow['status'], string> = { working: '●', idle: '○', done: '✓', failed: '✗', unknown: '?' }
/** A title the harness wrote is transcript text: a text answer a model may read names the session by harness and id instead. */
const titleOf = (ctx: Ctx, harness: string, key: string | null, title: string): string => (ctx.text === true && harness !== 'ruflo' && harness !== 'console' ? `${harness} session ${(key?.split(':').pop() ?? '').slice(0, 8)}` : title)
/**
 * A group heading is a path a transcript recorded (another project's directory, a worktree name): a text answer names it by harness and
 * position instead. Only a group made of the console's own ruflo records keeps its label, which is the console's own working directory.
 */
const groupLabelOf = (ctx: Ctx, group: { label: string; unassigned: boolean; rows: readonly SessionRow[] }, n: number): string => {
  if (ctx.text !== true || group.unassigned) return group.label

  const harnesses = [...new Set(group.rows.map(found => found.harness))]

  return harnesses.every(harness => harness === 'ruflo') ? group.label : `${harnesses.filter(harness => harness !== 'ruflo').join('+')} repo ${n}`
}
const SHOWN_ROWS = 30
const QUEUE_ROWS = 8

const costText = (cost: SessionRow['cost']): string => (cost.label === 'unavailable' ? 'cost n/a' : `${cost.usd === undefined ? '' : `$${cost.usd.toFixed(2)} `}${cost.label}${cost.note === undefined ? '' : ` (${cost.note})`}`.trim())

/** The Overview's one line: how many things need the person, or that nothing does. Empty when the workspace is off. */
export function attentionOverviewRows(ctx: Ctx): RenderElement[] {
  if (!ctx.state.options.sessionWorkspace) return []

  const counts = attentionCounts(ctx.state)
  const total = counts['needs-approval'] + counts.question + counts.failed + counts['completed-unread']
  const detail = total === 0 ? 'nothing needs you' : `${counts['needs-approval']} to approve · ${counts.question} questions · ${counts.failed} failed · ${counts['completed-unread']} finished`

  return [row(ctx, [text(ctx, ` sessions: ${detail}`, { color: total === 0 ? THEME.ok : THEME.warn }), button(ctx, 'overview-sessions', 'open in the Room', () => ctx.act.view('room'))], 'overview-sessions-row')]
}

function previewRows(ctx: Ctx, found: SessionRow): RenderElement[] {
  const { state, nowMs } = ctx
  const caps = workspaceOf(state).index?.reports.find(report => report.id === found.harness)?.capabilities
  const rows: RenderElement[] = [rule(ctx, 'Preview', `${found.harness} · ${clip(found.nativeId, 12)}`)]

  rows.push(text(ctx, ` ${titleOf(ctx, found.harness, found.key, found.title)}`, { bold: true }))
  rows.push(text(ctx, ` ${found.status}${found.stale === null ? '' : ` · STALE: ${found.stale}`} · ${found.external ? 'started outside Ruflo' : 'started by Ruflo'} · updated ${found.updatedMs > 0 ? ago(found.updatedMs, nowMs) : 'n/a'} · ${costText(found.cost)}`, { dimColor: true }))
  // The recorded cwd and git branch are transcript text (a branch name can be any words): drawn for a person, never in a text answer.
  if (found.cwd !== null && ctx.text !== true) rows.push(text(ctx, ` in ${clip(found.cwd, Math.max(20, ctx.columns - 10))}${found.branch === null ? '' : ` @ ${found.branch}`}`, { dimColor: true }))
  for (const [i, line] of found.context.entries()) rows.push(text(ctx, ` ${clip(line, ctx.columns - 6)}`, { dimColor: true, ...(i === 0 && { bold: false }) }))

  if (found.unassigned !== null) {
    rows.push(text(ctx, ` Unassigned: ${found.unassigned}. Nothing is shown for it, so it cannot be mistaken for another session.`, { color: THEME.warn }))

    return rows
  }

  if (!state.options.sessionPreview) {
    rows.push(text(ctx, ' The preview is off (Settings: sessionPreview); no transcript text is drawn.', { dimColor: true }))
  } else if (ctx.text === true) {
    rows.push(text(ctx, ' (transcript text is not included in text answers)', { dimColor: true }))
  } else if (found.preview === null) {
    rows.push(text(ctx, ` No preview: ${found.noPreview ?? 'nothing was read yet'}.`, { dimColor: true }))
  } else {
    const p = found.preview

    if (p.latest !== '') rows.push(...fullRows(ctx, ' latest: ', p.latest, { key: 'sess-latest', maxLines: 6 }))
    else rows.push(text(ctx, ' latest: nothing said yet', { dimColor: true }))

    rows.push(text(ctx, ` tool: ${p.tool ?? 'none seen'}`, { dimColor: true }))
    rows.push(text(ctx, ` files: ${p.files.length === 0 ? 'none edited' : clip(p.files.join(', '), Math.max(20, ctx.columns - 12))}`, { dimColor: true }))
    rows.push(text(ctx, ` tests: ${p.test ?? 'none run'}`, { dimColor: true }))
    // Drawn text is the evidence "viewed" waits for; the page's tick commits it (sessions.ts `commitViewed`).
    if (p.latest !== '' || p.tool !== null || p.files.length > 0 || p.test !== null) noteShown(state, found.key, nowMs)
  }

  const open = caps?.resume
  const openText = open?.supported === true ? 'open is not wired in this version' : `open: unavailable (${open?.why ?? 'not declared'})`

  rows.push(row(ctx, [text(ctx, ` ${openText}`, { dimColor: true }), button(ctx, `sess-open-${found.key}`, 'open', () => ctx.act.sessions.open(found.key))], 'sess-open-row'))

  return rows
}

/** The queue, the browser and the preview, in that order. Empty when the workspace is off. */
export function sessionRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx

  if (!state.options.sessionWorkspace) return []

  const ws = workspaceOf(state)
  const queue = queueOf(state)
  const rows: RenderElement[] = [rule(ctx, 'Needs you', queue.length === 0 ? 'nothing' : `${queue.length}`)]

  if (queue.length === 0) rows.push(text(ctx, ' Nothing needs you. Approvals, questions, failures and finished work from every session appear here, from sessions started outside Ruflo too.', { dimColor: true }))

  for (const item of queue.slice(0, QUEUE_ROWS)) {
    rows.push(
      row(
        ctx,
        [
          text(ctx, ` ${KIND_LABEL[item.kind].padEnd(14)}`, { bold: true, color: KIND_COLOR[item.kind] }),
          text(ctx, `${item.harness.padEnd(8)}`, { dimColor: true }),
          item.rowKey === null ? text(ctx, clip(item.title, ctx.columns - 36)) : button(ctx, `sess-jump-${item.id}`, clip(titleOf(ctx, item.harness, item.rowKey, item.title), Math.max(12, ctx.columns - 36)), () => ctx.act.sessions.jump(item.id)),
          text(ctx, ` ${ago(item.atMs, nowMs)}${item.stale ? ' · stale' : ''}`, { dimColor: true }),
        ],
        `sess-q-${item.id}`,
      ),
    )
  }

  if (queue.length > QUEUE_ROWS) rows.push(text(ctx, ` +${queue.length - QUEUE_ROWS} more`, { dimColor: true }))

  const index = ws.index
  const body: RenderElement[] = []
  const right = index === null ? 'looking…' : `${index.rows.length} found${index.unassigned > 0 ? ` · ${index.unassigned} unassigned` : ''}`

  if (index === null) return [...rows, ...section(ctx, 'sessions', 'Sessions', right, body, false)]

  for (const report of index.reports) {
    const caps = CAPABILITIES.map(cap => `${cap} ${report.capabilities[cap].supported ? '✓' : '✗'}`).join(' · ')

    body.push(text(ctx, ` ${report.label}: ${report.state === 'not-detected' ? 'not detected' : report.state === 'failed' ? 'FAILED, showing the last read' : `${report.count} tracked`} · ${clip(report.note, 60)}`, { color: report.state === 'failed' ? THEME.warn : undefined, dimColor: report.state !== 'failed' }))
    body.push(text(ctx, `   can: ${caps}`, { dimColor: true }))
  }

  let left = SHOWN_ROWS

  for (const [n, group] of index.groups.entries()) {
    if (left <= 0) break

    body.push(text(ctx, ` ${groupLabelOf(ctx, group, n + 1)}`, { bold: true, color: group.unassigned ? THEME.warn : THEME.head }))

    for (const found of group.rows.slice(0, left)) {
      const picked = ws.selected === found.key

      left -= 1
      body.push(
        row(
          ctx,
          [
            text(ctx, `  ${STATUS_MARK[found.status]} `, { color: found.status === 'failed' ? THEME.bad : found.status === 'working' ? THEME.ok : undefined, dimColor: found.status === 'idle' || found.status === 'unknown' }),
            button(ctx, `sess-${found.key}`, `${picked ? '▾' : '▸'} ${clip(titleOf(ctx, found.harness, found.key, found.title), Math.max(12, ctx.columns - 46))}`, () => ctx.act.sessions.select(found.key)),
            text(ctx, ` ${found.harness} · ${found.updatedMs > 0 ? ago(found.updatedMs, nowMs) : 'n/a'}${found.external ? ' · outside' : ''}${found.stale === null ? '' : ' · stale'}`, { dimColor: true }),
          ],
          `sess-row-${found.key}`,
        ),
      )
    }
  }

  if (index.rows.length > SHOWN_ROWS) body.push(text(ctx, ` +${index.rows.length - SHOWN_ROWS} more, the newest are listed first`, { dimColor: true }))

  body.push(row(ctx, [button(ctx, 'sess-prev', '◂ prev', () => ctx.act.sessions.move(-1)), button(ctx, 'sess-next', 'next ▸', () => ctx.act.sessions.move(1)), button(ctx, 'sess-refresh', 'rescan', ctx.act.sessions.refresh)], 'sess-nav'))

  const found = rowOf(index, ws.selected)

  if (found === undefined) body.push(text(ctx, ' Pick a session to see its latest response, current tool, edited files and test result. Browsing never wakes or starts anything.', { dimColor: true }))
  else body.push(...previewRows(ctx, found))

  if (ws.note !== '') body.push(text(ctx, ` ${ws.note}`, { color: THEME.warn }))

  rows.push(...section(ctx, 'sessions', 'Sessions', right, body, false))

  return rows
}
