/**
 * Answers open where they were asked, on every page. When a button or field raises an ask (a confirm) or an answer (an outcome),
 * the runner records which element it was (`state.origin`). The page is then drawn through a kit whose column boxes watch for that
 * element: the confirm and the outcome are placed right after the row that holds it, so the person never scrolls to the top to find
 * what to click. If the element is not on screen (a hotkey, the palette, a folded section), the panel falls back to the top.
 *
 * Nothing here reads the engine's element shapes: each Button and Input the page builds is remembered by identity with its key, each
 * Box inherits the keys of its children, and the first column Box that holds the key gets the panel after that child.
 */
import type { RenderElement } from 'claude-code'

import type { State } from '../state'
import { confirmInline, confirmRow, text, THEME, type Ctx } from './common'

/** Presses that answer an ask rather than raise one: they never move the origin. */
export const ANSWER_KEYS: ReadonlySet<string> = new Set(['confirm', 'cancel', 'remember', 'always'])

export type Attention = {
  /** The key of the element the ask or answer came from. */
  key: string | null
  /** What to place after it. */
  panel: RenderElement[]
  placed: boolean
  keys: WeakMap<object, Set<string>>
  /** `collect`: a lab's result block hands its rows over (`slot`); `hide`: the panel carries them, so the block draws nothing; `draw`: the block draws itself. */
  mode: 'draw' | 'collect' | 'hide'
  donated: RenderElement[]
}

const flat = (children: unknown): unknown[] => (Array.isArray(children) ? children.flatMap(flat) : children === null || children === undefined || typeof children === 'boolean' ? [] : [children])
const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

const donations = new WeakMap<State, { stamp: string; rows: RenderElement[] }>()

/**
 * The rows a lab view donated for this state, reused while nothing they show has changed (the view, the width, the result, its scroll
 * and the running spinner), so the extra drawing that finds them happens once per result rather than on every frame.
 */
export function donated(ctx: Ctx, draw: () => RenderElement[]): RenderElement[] {
  const { state, nowMs } = ctx
  const result = state.lab.result
  const running = state.lab.running
  const stamp = [state.view, ctx.columns, result?.atMs ?? 0, result?.id ?? '', state.select.item, running === null ? 0 : Math.floor(nowMs / 500) + 1, state.origin].join('|')
  const kept = donations.get(state)

  if (kept !== undefined && kept.stamp === stamp) return kept.rows

  const rows = draw()

  donations.set(state, { stamp, rows })

  return rows
}

export const newAttention = (key: string | null, panel: RenderElement[]): Attention => ({ key, panel, placed: false, keys: new WeakMap(), mode: 'draw', donated: [] })

const keyOfElement = (element: unknown): string | null => {
  const key = (element as { key?: unknown }).key ?? (element as { props?: { key?: unknown } }).props?.key

  return typeof key === 'string' && key !== '' ? key : null
}

/**
 * The kit for this frame. While an ask or answer is waiting for its place (an origin is set), every column Box is watched: the first
 * one that holds the origin's element gets the panel after that child. Otherwise the kit is returned as it is, so a quiet page costs
 * nothing extra. Which element was pressed is recorded by the `ui.press` and `ui.input` hooks (register.ts), not here.
 */
export function wrapKit(kit: Ctx['kit'], state: State, attention: Attention): Ctx['kit'] {
  // A headless ask still needs its inline confirm tracked, so the pane can fall back when that section is folded.
  if (attention.key === null && state.pending === null) return kit

  const Box: Ctx['kit']['Box'] = props => {
    const kids = flat((props as { children?: unknown }).children)
    let next = props

    if (!attention.placed && (props as { flexDirection?: string }).flexDirection === 'column' && attention.panel.length > 0) {
      const at = kids.findIndex(kid => isObject(kid) && (attention.keys.get(kid)?.has(attention.key as string) === true || keyOfElement(kid) === attention.key))

      if (at >= 0) {
        attention.placed = true
        kids.splice(at + 1, 0, ...attention.panel)
        next = { ...props, children: kids } as typeof props
      }
    }

    const element = kit.Box(next)
    const keys = new Set<string>()

    for (const kid of kids) {
      if (!isObject(kid)) continue

      const own = keyOfElement(kid)

      if (own !== null) keys.add(own)
      for (const key of attention.keys.get(kid) ?? []) keys.add(key)
    }

    if (keys.size > 0 && isObject(element)) attention.keys.set(element, keys)

    return element
  }

  return { ...kit, Box }
}

/**
 * Where a lab view draws its result block: normally the rows themselves (at the foot of the lab); while the page is being drawn to
 * find them (`collect`) they are handed to the panel instead, which places them under the row that was clicked.
 */
export function slot(ctx: Ctx, rows: RenderElement[]): RenderElement[] {
  const attention = ctx.attention

  if (attention?.mode === 'collect') attention.donated.push(...rows)

  return attention === undefined || attention.mode === 'draw' ? rows : []
}

/** The outcome of the last action as rows: what ran, whether it worked, and its first lines. Nothing when it is old. */
export function outcomeRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const outcome = state.outcome

  if (outcome === null || nowMs - outcome.atMs >= 90_000) return []

  return [
    text(ctx, `${outcome.ok ? '✓' : '✗'} ${outcome.label}${outcome.verified === 'yes' ? ' · on disk' : outcome.verified === 'no' ? ' · not on disk yet' : ''}: ${outcome.detail}`, { color: outcome.ok ? THEME.ok : THEME.bad }),
    ...(outcome.lines ?? []).slice(0, 8).map(line => text(ctx, `  ${line}`, { dimColor: true })),
  ]
}

/** The panel for this frame: the confirm (unless the page draws its own) and the outcome. Empty when the ask came from nowhere on screen. */
export function panelOf(ctx: Ctx, donated: readonly RenderElement[] = []): RenderElement[] {
  const confirm = confirmRow(ctx)
  const own = ctx.state.pending !== null && confirmInline(ctx.state.view, ctx.state.pending.scope)
  const rows = [...(confirm !== null && !own ? [confirm] : []), ...outcomeRows(ctx), ...donated]

  return rows.length === 0 ? [] : [ctx.kit.Box({ key: 'attention', flexDirection: 'column', paddingX: 1, children: rows })]
}
