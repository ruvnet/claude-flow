/**
 * Shared drawing helpers. Views are pure: `(ctx) => tree`, built from the surface's element table, reading the state
 * and the pictures computed for this frame. They call nothing on the engine; buttons call the closures in `ctx.act`.
 * Text colours are theme names only, so nothing fades on a light background.
 */
import type { AskActions } from '../ask-claude'
import type { OptimizerActions } from '../optimizer'
import { askedBy } from '../data/room'
import type { RoomActions } from '../room'
import type { SessionActions } from '../sessions'
import type { WatchActions } from '../watch'
import type { WhatsNewActions } from '../whatsnew'
import type { AdrActions } from '../adr-actions'
import type { EventsActions } from '../events-ui'
import type { TimelineActions } from '../timeline-ui'
import type { Attention } from './attention'
import { HEADS, mark as marked } from './marks'
import type { LoopActions } from '../loops'
import type { Elements, RenderChildren, RenderElement } from 'claude-code'

import type { ProbeResult } from '../data/cli'
import type { EvolveActions } from '../evolve'
import type { MissionActions } from '../mission-control'
import type { CatalogActions } from '../plugin-catalog'
import type { SettingsActions } from '../settings'
import type { DevtoolsActions } from '../devtools'
import type { Grid } from '../gfx/raster'
import type { MemoryActions } from '../memory-lab'
import type { NavActions } from '../nav-state'
import type { SkillActions } from '../skills'
import type { HelpActions } from '../help-actions'
import type { PluginOp } from '../plugin-ops'
import { START_LABEL, type StartId } from '../starts'
import type { MoreSkillActions } from '../skills-lab'
import { VIEWS, type HarnessId, type NavStyle, type State, type ViewId } from '../state'
import type { UpdatesMode } from '../updates'
import type { ToastMode } from '../toast-policy'
import { chip, COST_CHIP } from '../menu-colors'
import { accentOfView } from '../nav-state'
import type { VectorActions } from '../vector'
import type { WorkflowsActions } from '../wf-actions'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'> & { Raster?: Elements['terminal']['Raster']; Input?: Elements['terminal']['Input'] }

/** What a button can ask for: every one a closure over the controller. */
export type Actions = {
  view: (id: ViewId) => void
  refresh: () => void
  /** Refresh and replay the intro boot screen: the footer button and the r key. */
  restart: () => void
  help: () => void
  close: () => void
  back: () => void
  /** Runs the pending ask; `seen` is the id of the card the Yes came from, so a card that took its place meanwhile is not the one run. */
  confirm: (seen?: number) => void
  cancel: () => void
  /** j/k: moves the selection of the view in front. */
  select: (by: number) => void
  agentNext: () => void
  taskNext: () => void
  /** Drills into the selected agent. */
  drill: () => void
  claim: () => void
  release: () => void
  handoff: () => void
  steal: () => void
  palette: (context: 'all' | 'selection') => void
  paletteQuery: (text: string) => void
  paletteRun: (id: string) => void
  paletteSubmit: () => void
  run: (id: string, text?: string) => boolean
  costBudgetDraft: (text: string) => void
  /** Cycles the events view's filter. */
  filter: () => void
  /** The terminal view: pick a harness, follow the field, ask to run its text, stop the run, clear the scrollback. */
  /** A one-click start for an empty section (init, swarm, hive, workers…): asks, runs, and re-reads the disk. */
  /** Puts the keys in one of the pane's fields by its key (a row that takes text focuses its field). */
  focus: (key: string) => void
  start: (id: StartId, text?: string) => void
  /** The marketplace update on the Plugins and Plugin Catalog pages: asks first, then runs one `claude plugin` command. */
  plugin: (op: PluginOp) => void
  /** The main menu's prompt: a key or a name takes the person to that area. */
  menu: (text: string) => void
  term: { harness: (id: HarnessId) => void; draft: (text: string) => void; submit: (text: string) => void; stop: () => void; fresh: () => void; clear: () => void; load: (id: HarnessId, text: string) => void; /** A click on an ask link: opens the terminal, picks the agent and sends the text at once (read-only, plan mode, the saved per-turn budget): the reply streams in with no second click. */ ask: (id: HarnessId, text: string) => void; /** Moves the window up (positive) or down by screen rows. */ scroll: (by: number) => void; /** Puts an earlier question back in the field. */ reuse: (text: string) => void }
  /** The skills view: list, search, and the confirm-gated add, remove, update and create; edit loads the terminal. */
  skills: SkillActions & MoreSkillActions
  /** The Memory Lab: its fields, search, browse filter, and an entry's open or delete (each through the runner). */
  memory: MemoryActions
  /** The Vector Lab: its fields, its entries (asked or run through the runner), and rvlite queries handed to the terminal. */
  vector: VectorActions
  /** The Self-Evolution view: read its files again; ▸ ask types a repo prompt into the AI terminal. */
  evolve: EvolveActions
  /** The Dev Tools view: keep a field's text, and Enter in a field runs its entry. */
  devtools: DevtoolsActions
  /** The Loop Manager (Automation): presets, the configurator, and the launcher into the Claude UI. */
  loops: LoopActions
  /** The Optimizer (Overview): scope, fixes (each asks first) and asking Claude about a finding. */
  optimizer: OptimizerActions
  /** The Timeline and Events pages: look-back range, kind filter, search, pause, paging, an event's detail, and asking about one. */
  watch: WatchActions
  /** The Events page (ADR-474): query, level, window, follow, mutes, pins, saved searches, alert rules, export. */
  events: EventsActions
  /** The Timeline page (ADR-474): window, zoom, pan, lane groups, sort, lane detail, cross-links, export. */
  timeline: TimelineActions
  /** The Room (ADR-448): the draft, what to send through, the feed's source filter, search, pause and paging. */
  room: RoomActions
  /** The session workspace (ADR-486): select, move, jump from the attention queue, rescan, and the (unavailable) native open. */
  sessions: SessionActions
  /** Ask Claude about this section (a visible prompt or a /btw aside) or run the plugin command that fits it: each asks first. */
  ask: AskActions
  /** ruHelp, the built-in help: a question, a guide, a step's button, and asking Claude with the docs. */
  ruhelp: HelpActions
  /** Mission Control: goal, profile, create, run next, pause/resume/cancel, auto-run, ask aside, guide Claude. */
  mission: MissionActions
  /** Claude's control of the console (ADR-444): the person takes it back, or gives it back. */
  control: { pause: (on: boolean) => void }
  /** The Plugin Catalog: read the clone, filter, select a plugin, view or use an item, change a plugin (each asks first). */
  catalog: CatalogActions
  /** Puts text back in an entry field and gives it the keys, so what was entered can be edited and sent again. */
  editField: (key: string, text: string) => void
  /** Empties an entry field after its Enter. */
  clearField: (key: string) => void
  /** The confirm row's "always allow this kind of action": remembers the kind (Settings forgets it) and runs the pending ask. */
  remember: (seen?: number) => void
  /** Forgets one remembered kind of action, or all of them (an empty key). */
  forget: (key: string) => void
  /** The nav card: show a group's pages, search the pages, clear the search. */
  navigator: NavActions
  /** Sets how the main nav spells its tabs (saved). */
  nav: (style: NavStyle) => void
  /** Sets whether to check for a newer published ruflo-console: ask first, update without asking, or never (saved). */
  updates: (mode: UpdatesMode) => void
  /** Checks now, whatever the daily gate or an off setting says (it still asks before installing, and skips a development checkout). */
  checkUpdates: () => void
  /** The Toasts setting (ADR-477): which levels draw (all, important, off), and muting or unmuting one source's toasts (saved; every toast is still recorded). */
  toasts: { mode: (mode: ToastMode) => void; mute: (source: string) => void }
  /** What's new (ADR-478): dismiss a pinned breaking change (or all of them), toggle the toast for a new version. */
  whatsnew: WhatsNewActions
  /** ADR-480: the ADRs page: filter, select, initialise, propose, change a status, attach to a mission, check scope. */
  adrs: AdrActions
  /** Opens or closes a collapsible section (`<view>/<id>`). */
  toggle: (key: string) => void
  /** The Workflows page: cursor keys, the inspector's tab, the confirm-gated ruflo agent verbs, and naming a transcript's path. */
  workflows: WorkflowsActions
  /** Settings: the level, a plugin, an option or ruflo config change (each asks first), AI preferences, and ▸ ask claude/codex. */
  settings: SettingsActions
}

export type Ctx = {
  kit: Kit
  state: State
  nowMs: number
  columns: number
  /** Every picture of this view, by Raster key, already drawn for this frame. */
  pictures: Map<string, Grid>
  act: Actions
  /** True while the page is drawn in cards (views/card.ts): a section header then needs no blank row above it. */
  cards?: boolean
  /** The page's attention panel (views/attention.ts): lab views hand their result rows to it with `slot`. */
  attention?: Attention
  /** True while the page is drawn as a text answer a model may read (viewText): a transcript is never drawn then (ADR-486). */
  text?: boolean
}

export type Look = 'bbs' | 'plain'

/** The terminal theme's own colours: readable on light and dark backgrounds alike. */
const PLAIN = { head: 'claude', ok: 'success', bad: 'error', warn: 'warning', info: 'suggestion' }
/** The BBS look: neon magenta headings, cyan values, matrix-green labels; amber stays for attention. */
const NEON = { head: '#ff2a6d', ok: '#39ff14', bad: '#ff3355', warn: '#ffd319', info: '#05d9e8' }
const NEON_LABEL = '#2fbf71'

/** The palette every view reads; `setLook` swaps it in place before a render, so callers keep using THEME.x. */
export const THEME: { head: string; ok: string; bad: string; warn: string; info: string } = { ...PLAIN }
let look: Look = 'plain'

export function setLook(next: Look): void {
  if (next === look) return
  look = next
  Object.assign(THEME, next === 'bbs' ? NEON : PLAIN)
}

export const isBbs = (): boolean => look === 'bbs'

/**
 * A cost tag (`$0`, `wr`, `net`, `$$`) on a run row. In the BBS look it is a solid chip, the way the menu draws a key: the ink on a ground
 * by how much the run asks (a read green, local work or a write cyan, the network amber, spending or deleting red). In the plain look it
 * is coloured text, as it always was. `color` is the tag's theme colour; a colour that is none of the four stays text.
 */
export function tagChip(ctx: Ctx, text: string, color: string): RenderElement {
  const ground = look !== 'bbs' ? undefined : color === THEME.ok ? COST_CHIP.ok : color === THEME.info ? COST_CHIP.info : color === THEME.warn ? COST_CHIP.warn : color === THEME.bad ? COST_CHIP.bad : undefined

  if (ground === undefined) return ctx.kit.Text({ bold: true, color, children: ` ${text}` })

  return ctx.kit.Box({ flexDirection: 'row', children: [ctx.kit.Text({ children: ' ' }), ctx.kit.Text({ ...chip(ground), children: text })] })
}

/** Words wrapped to `width`, so a long line reads as several instead of running off the edge. */
export function wrap(line: string, width: number): string[] {
  const out: string[] = []
  let current = ''

  for (const word of line.split(' ')) {
    if (current !== '' && current.length + word.length + 1 > width) {
      out.push(current)
      current = word
    } else current = current === '' ? word : `${current} ${word}`
  }

  return current === '' ? out : [...out, current]
}

export const clip = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`)

export function ago(atMs: number | null | undefined, nowMs: number): string {
  if (atMs === null || atMs === undefined || !Number.isFinite(atMs)) return 'n/a'

  const s = Math.max(0, Math.round((nowMs - atMs) / 1000))

  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`

  return `${Math.floor(s / 86_400)}d ago`
}

/** A count as people read it (12.3k), or n/a for a value nobody measured. */
export function count(value: number | null | undefined): string {
  // A count is whole and not negative; a hostile 1e300 is "1T+", never a display value (#3817).
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return 'n/a'
  if (value >= 1e12) return '1T+'
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}k`

  return String(Math.round(value * 100) / 100)
}

export const pct = (value: number | null | undefined): string => (value === null || value === undefined || !Number.isFinite(value) ? 'n/a' : `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`)

export function text(ctx: Ctx, children: string, props: { color?: string; bold?: boolean; dimColor?: boolean; italic?: boolean } = {}): RenderElement {
  return ctx.kit.Text({ wrap: 'truncate-end', ...props, children: clip(children, Math.max(4, ctx.columns)) })
}

/**
 * Prose a person needs to read in full (an approval's text, a mission's objective): wrapped on word breaks into as many rows as it takes, each
 * continuation row indented by `indent`, so a narrow terminal (80 columns in tmux) shows all of it instead of cutting it at the edge with "…".
 */
export function paragraph(ctx: Ctx, line: string, props: { color?: string; bold?: boolean; dimColor?: boolean; italic?: boolean } = {}, indent = ''): RenderElement[] {
  const lead = line.match(/^ */)?.[0] ?? ''
  const width = Math.max(16, ctx.columns - Math.max(lead.length, indent.length))
  // A word longer than the row (an id, a path) is cut into row-sized pieces, so no character of it is lost to the edge.
  const words = line.trimStart().split(' ').flatMap(word => (word.length <= width ? [word] : (word.match(new RegExp(`.{1,${width}}`, 'gu')) ?? [word])))
  const parts = wrap(words.join(' '), width)

  return (parts.length === 0 ? [''] : parts).map((part, i) => text(ctx, `${i === 0 ? lead : indent}${part}`, props))
}

export function row(ctx: Ctx, parts: readonly RenderChildren[], key?: string): RenderElement {
  return ctx.kit.Box({ flexDirection: 'row', ...(key !== undefined && { key }), children: [...parts] })
}

export function col(ctx: Ctx, parts: readonly RenderChildren[], key?: string): RenderElement {
  return ctx.kit.Box({ flexDirection: 'column', ...(key !== undefined && { key }), children: [...parts] })
}

/** The colour a BBS page's section headers wear: the accent of its nav group (the menu's colours), else the theme's. Plain look: the theme's. */
function accentOf(ctx: Ctx): string {
  return look === 'bbs' ? (accentOfView(ctx.state.view === 'agent' ? ctx.state.back : ctx.state.view) ?? THEME.info) : THEME.info
}

/**
 * A collapsible section: its header is a button (▾ open, ▸ closed) and the rows follow only while it is open. `open` is the
 * section's default; pressing the header flips it for this session. The header reads as `rule` does.
 */
export function section(ctx: Ctx, id: string, title: string, right: string, children: readonly RenderElement[], isOpenByDefault = true): RenderElement[] {
  const key = `${ctx.state.view}/${id}`
  const isOpen = isOpenByDefault !== ctx.state.sections.has(key)
  const mark = isOpen ? '▾' : '▸'
  const head = look === 'bbs' ? `▓▒░ ${mark} ${title.toUpperCase()} ░▒▓` : `${mark} ${title}`
  const fill = Math.max(1, ctx.columns - head.length - right.length - 2)

  return [
    ...(look === 'bbs' && ctx.cards !== true ? [ctx.kit.Text({ children: ' ' })] : []),
    marked(
      HEADS,
      row(
        ctx,
        [
          ctx.kit.Button({ key: `sec-${id}`, label: head, plain: true, onPress: () => ctx.act.toggle(key) }),
          ctx.kit.Text({ color: accentOf(ctx), dimColor: true, children: `${(look === 'bbs' ? '═' : '─').repeat(fill)} ` }),
          ctx.kit.Text({ color: accentOf(ctx), children: right }),
        ],
        `sec-row-${id}`,
      ),
    ),
    ...(isOpen ? children : []),
  ]
}

/** A section title with a rule to the right edge. */
export function rule(ctx: Ctx, title: string, right = ''): RenderElement {
  if (look === 'bbs') {
    // BBS section header: ▓▒░ SWARM ░▒▓══════════ right
    const head = `▓▒░ ${clip(title, Math.max(4, ctx.columns - 12)).toUpperCase()} ░▒▓`
    const room = Math.max(0, ctx.columns - head.length - 3)
    const tail = clip(right, room)
    const fill = Math.max(1, ctx.columns - head.length - tail.length - 2)

    const line = row(ctx, [ctx.kit.Text({ bold: true, color: accentOf(ctx), wrap: 'truncate-end', children: head }), ctx.kit.Text({ color: accentOf(ctx), dimColor: true, children: `${'═'.repeat(fill)} ` }), ctx.kit.Text({ color: accentOf(ctx), wrap: 'truncate-end', children: tail })])

    // In a card the header is the card's first row; otherwise a blank line above each section, so the board breathes instead of packing every block together.
    return ctx.cards === true ? marked(HEADS, line) : marked(HEADS, col(ctx, [ctx.kit.Text({ children: ' ' }), line]))
  }

  const name = clip(title, Math.max(4, ctx.columns - 4))
  const tail = clip(right, Math.max(0, ctx.columns - name.length - 4))
  const fill = Math.max(1, ctx.columns - name.length - tail.length - 3)

  return marked(HEADS, row(ctx, [ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: name }), ctx.kit.Text({ dimColor: true, children: ` ${'─'.repeat(fill)} ` }), ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: tail })]))
}

/** A label and its value; the value dims when it is n/a. */
export function kv(ctx: Ctx, label: string, value: string, color?: string): RenderElement {
  const isNa = value === 'n/a' || value.startsWith('n/a ') || value === 'missing'

  // BBS: green labels and cyan values, the way a sysop screen lists its stats.
  const neonValue = look === 'bbs' && color === undefined ? { color: THEME.info } : {}

  return row(ctx, [
    // BBS rows sit indented one column, with two spaces between label and value.
    ctx.kit.Text(look === 'bbs' ? { color: NEON_LABEL, children: ` ${label.padEnd(16)}  ` } : { dimColor: true, children: `${label.padEnd(16)} ` }),
    ctx.kit.Text({ wrap: 'truncate-end', ...(isNa ? { dimColor: true } : color !== undefined ? { color } : neonValue), children: clip(value, Math.max(4, ctx.columns - (look === 'bbs' ? 20 : 18))) }),
  ])
}

/** A Raster for a picture of this frame, or a dim note where the surface has no Raster. */
export function picture(ctx: Ctx, key: string, fallback: string): RenderElement {
  const grid = ctx.pictures.get(key)

  if (grid === undefined || ctx.kit.Raster === undefined) {
    return text(ctx, fallback, { dimColor: true })
  }

  return ctx.kit.Raster(grid.toRaster(key))
}

export function button(ctx: Ctx, key: string, label: string, onPress: () => void, options: { hotkey?: string; primary?: boolean } = {}): RenderElement {
  return ctx.kit.Button({ key, label, onPress, ...(options.hotkey !== undefined && { hotkey: options.hotkey }), ...(options.primary === true && { variant: 'primary' as const }) })
}

/** A start that takes a sentence (a task, a mission objective): a text field whose Enter asks, with the confirm after. */
export function startField(ctx: Ctx, id: StartId, placeholder: string): RenderElement {
  return ctx.kit.Input === undefined
    ? text(ctx, ` ${START_LABEL[id]}: this surface has no text field (/ruflo run ${id} <text>)`, { dimColor: true })
    : ctx.kit.Input({ key: `start-field-${id}`, label: START_LABEL[id], placeholder, submitLabel: 'ask', onSubmit: value => ctx.act.start(id, value) })
}

/**
 * What an empty section offers instead of a command to copy: a line saying what is missing, then a button per start
 * (each asks first, with the exact command on the confirm row, and the view fills in once it has run).
 */
export function starts(ctx: Ctx, why: string, ids: readonly StartId[], scope = ''): RenderElement {
  return col(ctx, [
    text(ctx, ` ${why}`, { color: THEME.warn }),
    row(ctx, [text(ctx, ' '), ...ids.map(id => button(ctx, `start-${scope}${id}`, `▸ ${START_LABEL[id]}`, () => ctx.act.start(id)))]),
  ])
}

/** How a CLI-sourced fact reads: its value's age, running, failing with a stale value, or never measured. */
export function sourceLine(result: ProbeResult | undefined, nowMs: number, what: string): { text: string; color?: string } {
  if (result === undefined || (result.okAtMs === null && result.error === null)) {
    return { text: result?.isRunning === true ? `${what}: asking the ruflo CLI…` : `${what}: not asked yet` }
  }

  if (result.error !== null && (result.errorAtMs ?? 0) >= (result.okAtMs ?? 0)) {
    return { text: `${what}: ${clip(result.error, 80)}${result.okAtMs !== null ? ` (last good ${ago(result.okAtMs, nowMs)}, not shown as live)` : ''}`, color: THEME.warn }
  }

  return { text: `${what}: ruflo CLI, ${ago(result.okAtMs, nowMs)}` }
}

/** The value of a probe only while it is the newest answer: a value older than the latest failure is stale. */
export function live<T>(result: ProbeResult | undefined): T | null {
  if (result === undefined || result.value === null) return null
  if (result.error !== null && (result.errorAtMs ?? 0) >= (result.okAtMs ?? 0)) return null

  return result.value as T
}

/**
 * The ask a click or an Enter raised, with the exact command, its note, and Yes / Cancel (and the remember choices). A view
 * in INLINE_CONFIRM draws it itself, right under the field the person typed in; every other view gets it above its body.
 * `scope` is where the ask came from: a view draws only the asks that belong under its own fields.
 */
export function confirmRow(ctx: Ctx): RenderElement | null {
  const pending = ctx.state.pending

  if (pending === null) return null

  // An ask belongs to the page that raised it: anywhere else it is one line, with a way there and a way to drop it.
  if (pending.view !== undefined && pending.view !== ctx.state.view) {
    const where = VIEWS.find(entry => entry.id === pending.view)

    return row(
      ctx,
      [
        text(ctx, `⚠ An ask is waiting on ${where?.label ?? pending.view}: ${clip(askedBy(pending) + pending.label, Math.max(16, ctx.columns - 64))} `, { bold: true, color: THEME.warn }),
        button(ctx, 'confirm-go', 'Go there', () => ctx.act.view(pending.view as ViewId)),
        button(ctx, 'cancel', 'Cancel (n)', ctx.act.cancel, { hotkey: 'n' }),
      ],
      'confirm',
    )
  }

  // One bordered card in the warning colour: the person says yes to everything in it, so it reads as a unit, not as loose lines. Its border and
  // padding take four columns, so the text inside is clipped to the narrower width.
  const inner: Ctx = { ...ctx, columns: Math.max(20, ctx.columns - 4) }
  // Drawn for a person in a pane they can see: this is now the card a bare typed yes may answer. A text answer for a model shows it to no one.
  if (ctx.text !== true && ctx.state.pane.isShown && pending.id !== undefined) ctx.state.shownCard = pending.id

  const hasMoney = pending.note !== undefined && /money|models/i.test(pending.note)

  return ctx.kit.Box({
    key: 'confirm',
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: THEME.warn,
    paddingX: 1,
    children: [
      row(ctx, [ctx.kit.Text({ bold: true, color: THEME.warn, children: '▶ CONFIRM NEEDED' }), ctx.kit.Text({ dimColor: true, children: '  click Yes or press y' })]),
      text(inner, '─'.repeat(inner.columns), { dimColor: true }),
      text(inner, `Confirm: ${askedBy(pending)}${pending.label.replace(/\?+$/, '')}?`, { bold: true, color: THEME.warn }),
      // Wrapped, not clipped: the person says yes to the whole argv, so all of it shows (a JSON argument runs long).
      ctx.kit.Text({ dimColor: true, wrap: 'wrap', children: `runs: ${pending.shows ?? `ruflo ${pending.args.join(' ')}`}` }),
      ...(pending.note !== undefined ? [ctx.kit.Text({ wrap: 'wrap', bold: hasMoney, color: hasMoney ? THEME.bad : THEME.warn, children: `Effect: ${pending.note}` })] : []),
      ctx.kit.Box({
        flexDirection: 'row',
        marginTop: 1,
        children: [
          button(ctx, 'confirm', 'Yes, run it (y)', () => ctx.act.confirm(pending.id), { hotkey: 'y', primary: true }),
          button(ctx, 'cancel', 'Cancel (n)', ctx.act.cancel, { hotkey: 'n' }),
          // A low-risk ruflo action may be remembered: it is not asked again (Settings lists and forgets it).
          ...(pending.rememberKey !== undefined ? [button(ctx, 'remember', `Always allow “${pending.rememberKey}”`, () => ctx.act.remember(pending.id))] : []),
          // An AI terminal turn (claude -p in plan mode, codex read-only, the budget cap) may be always accepted: Settings resets it.
          ...(ctx.state.terminal.asked !== null && pending.id !== undefined && pending.id === ctx.state.terminal.asked.card && ctx.state.terminal.harness !== 'ruflo' ? [button(ctx, 'always', 'Always accept AI turns', () => ctx.act.settings.alwaysAccept(pending.id))] : []),
        ],
      }),
    ],
  })
}

/** Views that draw the confirm themselves, under the field it came from (the pane then does not draw it above the body). */
export const INLINE_CONFIRM: ReadonlySet<string> = new Set(['missions', 'hive'])

/** True when the view draws this ask itself (under what raised it), so the pane does not also draw it at the top. */
export const confirmInline = (view: string, scope: string | undefined): boolean => (scope === 'ask' ? false : view === 'memory' ? scope?.startsWith('mem:') === true : INLINE_CONFIRM.has(view))

/** The confirm row when the pending ask came from this scope (or has none, and this is the view's default place for it). */
export function confirmHere(ctx: Ctx, scope: string, isDefault = false): RenderElement[] {
  const pending = ctx.state.pending

  if (pending === null || (pending.scope ?? (isDefault ? scope : '')) !== scope) return []

  const row = confirmRow(ctx)

  return row === null ? [] : [row]
}
