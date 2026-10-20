/**
 * The seams of the Workflows page (ADR-464). A feature that adds to the page registers a slot from its own module and edits
 * no shared file: the page (views/wf-page.ts) draws whatever is registered, and the band's notice pass (wf-live.ts) asks the
 * notice slots. Five kinds:
 *
 *   board   extra sections under the run board                  render(env) -> rows
 *   tab     extra tabs in the inspector, beside `detail`        render(env) -> rows, shown while the tab is picked
 *   key     extra key handlers: a hotkey button                 run(env), no change to the run
 *   action  extra actions: a confirm-gated ruflo verb           spec(env) -> the ActionSpec the confirm card shows, or null (then `why` is said)
 *   notice  extra notices raised after a read                   between(prev, next, nowMs) -> drafts (their text is masked here, not by the slot)
 *
 * Registering is pure and cheap: a slot that is malformed, takes a hotkey the page or another slot owns, or repeats an id is
 * refused with a reason (never thrown), so one feature's mistake cannot take the page down. A slot's render or handler that throws
 * is caught where it is called and drawn as one line naming the slot. A module reaches the registry by being imported from
 * views/wf-register.ts, the one file the merge owner edits (one import line per feature).
 */
import type { RenderElement } from 'claude-code'

import type { ActionSpec } from '../actions'
import type { WfAgent, WfPhase, WfRun } from '../data/workflows'
import type { WfUi } from '../data/workflows-nav'
import type { NoticeDraft } from '../notices'
import type { Ctx } from './common'

/** What a slot is handed: the frame's context, the page's model and where the cursor is. `run`, `phase` and `agent` are null where the list is empty. */
export type SlotEnv = { ctx: Ctx; runs: readonly WfRun[]; run: WfRun | null; phase: WfPhase | null; agent: WfAgent | null; ui: WfUi; nowMs: number }

export type BoardSlot = { kind: 'board'; id: string; title: string; /** Lower draws first; ties keep registration order. */ order?: number; render: (env: SlotEnv) => RenderElement[] }
export type TabSlot = { kind: 'tab'; id: string; label: string; /** False hides the tab for this cursor (a tab about worktrees for an agent without one). */ when?: (env: SlotEnv) => boolean; render: (env: SlotEnv) => RenderElement[] }
export type KeySlot = { kind: 'key'; id: string; /** One lowercase letter or digit the page does not own. */ key: string; label: string; run: (env: SlotEnv) => void }
export type ActionSlot = { kind: 'action'; id: string; label: string; hotkey?: string; /** Said on the confirm row when `spec` answers null. */ why: string; spec: (env: SlotEnv) => ActionSpec | null }
export type NoticeSlot = { kind: 'notice'; id: string; between: (prev: readonly WfRun[] | null, next: readonly WfRun[], nowMs: number) => NoticeDraft[] }

export type Slot = BoardSlot | TabSlot | KeySlot | ActionSlot | NoticeSlot
export type SlotKind = Slot['kind']
export type SlotOf<K extends SlotKind> = Extract<Slot, { kind: K }>

/** Keys the page owns: the footer (p x r h), the confirm row (y n), the page's own (j k l b d o) and the run switch (u i). */
export const RESERVED_KEYS: readonly string[] = ['p', 'x', 'r', 'h', 'y', 'n', 'j', 'k', 'l', 'b', 'd', 'o', 'u', 'i']

/** The tab every inspector has; a slot may not take its id. */
export const DETAIL_TAB = 'detail'

const ID = /^[a-z][a-z0-9-]{1,31}$/
const MAX_PER_KIND = 24

const registry: Slot[] = []

export type Registered = { ok: true } | { ok: false; why: string }

const refuse = (why: string): Registered => ({ ok: false, why })

const hotkeyOf = (slot: Slot): string | undefined => (slot.kind === 'key' ? slot.key : slot.kind === 'action' ? slot.hotkey : undefined)

/** Adds a slot, or says why not. The first registration of an id wins: a second module cannot replace another's slot. */
export function registerSlot(slot: Slot): Registered {
  if (typeof slot !== 'object' || slot === null) return refuse('a slot is an object')
  if (!ID.test(slot.id)) return refuse(`id "${String(slot.id).slice(0, 24)}" is not a lowercase word of 2 to 32 letters, digits and dashes`)
  if (registry.some(held => held.kind === slot.kind && held.id === slot.id)) return refuse(`${slot.kind} slot "${slot.id}" is already registered`)
  if (registry.filter(held => held.kind === slot.kind).length >= MAX_PER_KIND) return refuse(`at most ${MAX_PER_KIND} ${slot.kind} slots`)

  const own = slot.kind === 'board' ? slot.render : slot.kind === 'tab' ? slot.render : slot.kind === 'key' ? slot.run : slot.kind === 'action' ? slot.spec : slot.kind === 'notice' ? slot.between : null

  if (typeof own !== 'function') return refuse(`${String((slot as { kind?: unknown }).kind).slice(0, 12)} slot "${slot.id}" has no function to call`)
  if ((slot.kind === 'board' || slot.kind === 'tab') && (typeof (slot.kind === 'board' ? slot.title : slot.label) !== 'string' || (slot.kind === 'board' ? slot.title : slot.label).trim() === '')) return refuse(`slot "${slot.id}" needs a title`)
  if (slot.kind === 'tab' && slot.id === DETAIL_TAB) return refuse(`"${DETAIL_TAB}" is the inspector's own tab`)
  if ((slot.kind === 'key' || slot.kind === 'action') && (typeof slot.label !== 'string' || slot.label.trim() === '')) return refuse(`slot "${slot.id}" needs a label`)
  if (slot.kind === 'action' && (typeof slot.why !== 'string' || slot.why.trim() === '')) return refuse(`action slot "${slot.id}" needs a why for the confirm row`)

  const key = hotkeyOf(slot)

  if (key !== undefined) {
    if (!/^[a-z0-9]$/.test(key)) return refuse(`hotkey "${String(key).slice(0, 4)}" is not one lowercase letter or digit`)
    if (RESERVED_KEYS.includes(key)) return refuse(`hotkey "${key}" belongs to the page`)
    if (registry.some(held => hotkeyOf(held) === key)) return refuse(`hotkey "${key}" is taken by slot "${registry.find(held => hotkeyOf(held) === key)?.id}"`)
  }

  registry.push(slot)

  return { ok: true }
}

/** The slots of one kind, in registration order (boards by `order`, then registration). */
export function slotsFor<K extends SlotKind>(kind: K): readonly SlotOf<K>[] {
  const list = registry.filter((slot): slot is SlotOf<K> => slot.kind === kind)

  return kind === 'board' ? ([...list].sort((a, b) => ((a as BoardSlot).order ?? 100) - ((b as BoardSlot).order ?? 100)) as SlotOf<K>[]) : list
}

/** For tests: empties the registry. Nothing in the console calls it. */
export const resetSlots = (): void => void (registry.length = 0)
