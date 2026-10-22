/**
 * A result as a card: a round border in the result's colour, a header that says what it is and how it went (✓ or ✗, the title, how long
 * ago), then the body. A status that is one grey line is easy to miss, and a silent click looks like a click that did nothing.
 */
import type { RenderChildren, RenderElement } from 'claude-code'

import { ago, row, THEME, type Ctx } from './common'

export type StatusTone = 'ok' | 'bad' | 'warn' | 'run'

const COLOR: Record<StatusTone, () => string> = { ok: () => THEME.ok, bad: () => THEME.bad, warn: () => THEME.warn, run: () => THEME.info }
const MARK: Record<StatusTone, string> = { ok: '✓', bad: '✗', warn: '⚠', run: '…' }

/** The card: `title` bold beside the mark, `right` dim at the end of the header (a time, an exit code), then `body`. */
export function statusCard(ctx: Ctx, key: string, tone: StatusTone, title: string, right: string, body: readonly RenderChildren[]): RenderElement {
  return ctx.kit.Box({
    key,
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: COLOR[tone](),
    paddingX: 1,
    children: [row(ctx, [ctx.kit.Text({ bold: true, color: COLOR[tone](), wrap: 'truncate-end', children: `${MARK[tone]} ${title}` }), ...(right === '' ? [] : [ctx.kit.Text({ dimColor: true, children: `  ${right}` })])]), ...body],
  })
}

/** A launch or action outcome as a card: the detail wrapped (never clipped), then what to do next. `atMs` shows as "3s ago". */
export function outcomeCard(ctx: Ctx, key: string, outcome: { ok: boolean; label: string; detail: string; atMs?: number; next?: string }): RenderElement {
  return statusCard(ctx, key, outcome.ok ? 'ok' : 'bad', outcome.label, outcome.atMs === undefined ? '' : ago(outcome.atMs, ctx.nowMs), [
    ...(outcome.detail === '' ? [] : [ctx.kit.Text({ wrap: 'wrap', children: outcome.detail })]),
    ...(outcome.next === undefined ? [] : [ctx.kit.Text({ wrap: 'wrap', dimColor: true, children: `→ ${outcome.next}` })]),
  ])
}

export type ResultTone = 'ok' | 'bad' | 'run' | 'idle'

/**
 * Every view's Result panel inside one round border, coloured by how the run went: green for ok, red for failed, amber while it runs, and
 * dim when nothing has run yet. The rows (the `▓▒░ RESULT ░▒▓ … ✓ exit 0 · 3s ago` header, the label, the lines) are drawn exactly as before.
 */
export function frameResult(ctx: Ctx, rows: readonly RenderElement[], tone: ResultTone): RenderElement {
  return ctx.kit.Box({
    key: 'result-frame',
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: tone === 'ok' ? THEME.ok : tone === 'bad' ? THEME.bad : tone === 'run' ? THEME.warn : 'inactive',
    paddingX: 1,
    children: [...rows],
  })
}
