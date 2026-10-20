/**
 * The band above the prompt: one row saying what is happening here now, with a mark that pulses while Claude works.
 * Parts come most-urgent first, so a narrow band truncates the least useful ones: what needs a person, who is
 * working on what (and for how long), the AI terminal's runs, the newest event while it is fresh; only then the
 * standing context (claims, this session's spend). With nothing happening it says so, and when it last did.
 * Each part is a fact on disk or n/a; a part with nothing to say is left out rather than shown as zero.
 */
import { activeMission, derive, progressOf } from '../mission-control'
import type { RenderElement } from 'claude-code'

import { alertsOf, waitingApprovalsOf } from '../data/alerts'
import { agentLabels } from '../data/parse'
import { swarmStatusOf } from '../data/swarm-status'
import { secMemo, securityBand } from '../secure'
import type { State, ViewId } from '../state'
import { sparkline } from '../memory-lines'
import { visibleNotice, type Notice } from '../notices'
import { ago, clip, type Kit } from './common'

export const BAR_KEY = 'mark'

/**
 * One part of the band: its words, how loud, and the view a click on it opens. `row` is where it sits: the status row (what needs a
 * person, the mission, who is working, a fresh event) or the standing row (the last tool call, claims, spend, findings, an update), so
 * a long mission title in the first cannot push the second out.
 */
export type BarPart = { text: string; tone: 'attention' | 'live' | 'plain'; go?: ViewId; row?: 'status' | 'standing'; /** A shorter form, used when the row would otherwise cut a part. */ compact?: string }

/** How long an event counts as "now" on the band. */
const FRESH_MS = 60_000

/** The window of the activity sparkline: one bar per minute. */
export const ACTIVITY_MINUTES = 10

/**
 * Tool calls per minute over the last ten minutes, oldest left, one bar a minute: how busy an unattended session has been, at a glance.
 * Null when fewer than three calls fell in the window (a rhythm needs more than a blip). Counts only what the console observed.
 */
export function activityBars(events: readonly { atMs: number; kind: string }[], nowMs: number): string | null {
  const start = nowMs - ACTIVITY_MINUTES * 60_000
  const counts = Array.from({ length: ACTIVITY_MINUTES }, () => 0)
  let total = 0

  for (const event of events) {
    if (event.kind !== 'tools' || event.atMs < start || event.atMs > nowMs) continue
    counts[Math.min(ACTIVITY_MINUTES - 1, Math.floor((event.atMs - start) / 60_000))] += 1
    total += 1
  }

  return total < 3 ? null : sparkline(counts)
}

const since = (atMs: number | undefined, nowMs: number): string => (atMs === undefined ? '' : ` ${ago(atMs, nowMs).replace(' ago', '')}`)

/** Who is working, each on what: the agent's in-progress task, or just "working". At most two, then a count. */
function workingParts(state: State, nowMs: number): BarPart[] {
  const snap = state.snapshot

  if (snap === null) return []

  const busy = snap.agents.filter(agent => /busy|active|working/i.test(agent.status))
  const labels = agentLabels(snap.agents)
  const parts = busy.slice(0, 2).map(agent => {
    const task = snap.tasks.find(entry => entry.assignedTo.includes(agent.id) && /progress|running|active/i.test(entry.status))
    const what = task !== undefined ? ` on ${clip(task.description || task.type, 40)}` : ' working'
    const span = state.statusLog.get(agent.id)?.at(-1)?.atMs

    return { text: `▶ ${labels.get(agent.id) ?? agent.type}${what}${since(span, nowMs)}`, tone: 'live' as const, go: 'swarm' as const }
  })

  if (busy.length > 2) parts.push({ text: `+${busy.length - 2} more working`, tone: 'live', go: 'swarm' })

  return parts
}

/** Dollars a person reads at a glance: cents under $100, whole dollars with separators above. */
export function money(usd: number): string {
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd).toLocaleString('en-US')}`
}

/** The active mission as a band part: progress and the running task, or paused; none when there is no mission, or it is done or cancelled. */
export function missionPart(state: State): BarPart | null {
  const mission = activeMission(state)

  if (mission === null || mission.cancelled) return null

  const tasks = state.snapshot?.tasks ?? []
  const { done, total } = progressOf(mission, tasks)
  const status = derive(mission, tasks)
  const running = mission.tasks.find(task => status.get(task.id) === 'running')

  if (total === 0 || done >= total) return null

  return { text: `🎯 ${done}/${total}${mission.paused ? ' paused' : running !== undefined ? ` · ${running.id} ${clip(running.title, 28)}` : ''} (1)`, tone: running !== undefined ? 'live' : 'plain', go: 'missions' }
}

/**
 * A module's own band parts (the autopilot's segment, views/ap-band.ts): registered once at import, drawn on the first row after the
 * mission. A source returns nothing when it has nothing to say, and one that throws is skipped, so it can never blank the band.
 */
const sources: ((state: State, nowMs: number) => BarPart[])[] = []

export const registerBarSource = (source: (state: State, nowMs: number) => BarPart[]): void => void (sources.includes(source) || sources.push(source))

export function barParts(state: State, nowMs: number = Date.now()): BarPart[] {
  const snap = state.snapshot
  const parts: BarPart[] = []

  // What needs a person: approvals waiting and warn/bad alerts. Info alerts (a claim held for days) stay in the pane.
  const approvals = waitingApprovalsOf(state).length
  const alerts = alertsOf(state, nowMs, state.loadedAtMs).filter(alert => alert.level !== 'info').length

  if (approvals > 0) parts.push({ text: `${approvals} to approve (q)`, tone: 'attention', go: 'approvals' })
  if (alerts > 0) parts.push({ text: `⚠ ${alerts} alert${alerts === 1 ? '' : 's'}`, tone: 'attention', go: 'overview' })

  // The active mission: how far along, and the task Claude is on (or that it is paused); a click opens Mission Control.
  const missing = missionPart(state)

  if (missing !== null) parts.push(missing)

  for (const source of sources) {
    try {
      parts.push(...source(state, nowMs))
    } catch {
      // A source that fails draws nothing.
    }
  }

  // What is happening now: how long Claude has been on this turn, agents at work, the AI terminal's runs, and the newest event while it is fresh.
  if (state.turnActive && state.turnStartedMs !== null) parts.push({ text: `▶ Claude working${since(state.turnStartedMs, nowMs)}`, tone: 'live', go: 'events' })

  parts.push(...workingParts(state, nowMs))

  for (const [agent, run] of state.terminal.runs) parts.push({ text: `💻 ${agent} answering${since(run.startedAtMs, nowMs)}`, tone: 'live', go: 'terminal' })

  const latest = state.events.at(-1)
  const isFresh = latest !== undefined && nowMs - latest.atMs < FRESH_MS

  if (isFresh) parts.push({ text: `${clip(latest.text, 44)} ·${since(latest.atMs, nowMs)} ago`, tone: 'plain', go: 'events' })

  // Nothing moving: say so, with how many agents stand ready. (When something did happen, the last event is a standing part below.)
  if (!parts.some(part => part.tone === 'live') && !isFresh && snap?.swarm != null) {
    // The swarm's own members (data/swarm-status.ts), not the agent store (every agent ever spawned, in any swarm). Only an agent the store
    // holds can be "ready": a listed id it lacks is counted as listed, never as ready.
    const { listed, found } = swarmStatusOf(snap.swarm, nowMs, snap.agents)
    const note = listed === found ? '' : ` (${listed} listed, ${found} found)`

    parts.push({ text: found > 0 ? `idle · ${found} agent${found === 1 ? '' : 's'} ready${note}` : listed > 0 ? `swarm, ${listed} listed, none found` : 'swarm, no agents', tone: 'plain', go: 'swarm' })
  }

  // Standing context, on its own row: the last tool call or event with how long ago (it used to vanish after a minute, taking what Claude
  // last did with it), claims held, this session's spend, what the last scan found, and a published update not yet taken.
  if (latest !== undefined && !isFresh) parts.push({ text: `${clip(latest.text, 44)} ·${since(latest.atMs, nowMs)} ago`, tone: 'plain', go: 'events', row: 'standing', compact: `${clip(latest.text, 18)} ·${since(latest.atMs, nowMs)} ago` })

  const bars = activityBars(state.events, nowMs)

  if (bars !== null) parts.push({ text: `${bars} tool calls, ${ACTIVITY_MINUTES}m`, tone: 'plain', go: 'events', row: 'standing', compact: bars })

  const claims = snap?.claims ?? []

  if (claims.length > 0) {
    const stealable = claims.filter(claim => claim.isStealable).length

    parts.push({ text: `${claims.length} claim${claims.length === 1 ? '' : 's'}${stealable > 0 ? ` (${stealable} stealable)` : ''}`, tone: 'plain', go: 'claims', row: 'standing', compact: `${claims.length} claim${claims.length === 1 ? '' : 's'}` })
  }

  if (state.usage?.costUsd !== undefined && state.usage.costUsd >= 0.01) parts.push({ text: `${money(state.usage.costUsd)} this session`, tone: 'plain', go: 'cost', row: 'standing', compact: money(state.usage.costUsd) })

  // The context window filling: quiet until it matters, amber when it is close, with the hint that acts on it.
  const context = state.usage?.contextPercent

  if (context !== undefined && context >= 60) {
    parts.push({ text: `ctx ${Math.round(context)}%${context >= 85 ? ' · /compact soon' : ''}`, tone: context >= 80 ? 'attention' : 'plain', go: 'cost', row: 'standing', compact: `ctx ${Math.round(context)}%` })
  }

  const security = securityBand(secMemo(state).findings)

  if (security !== null) parts.push({ text: security.text, tone: security.isAttention ? 'attention' : 'plain', go: 'secure', row: 'standing', compact: security.compact })
  if (state.updateAvailable !== '') parts.push({ text: `⬆ ${state.updateAvailable} available`, tone: 'attention', go: 'settings', row: 'standing' })

  return parts
}

/** The band's words, for `/ruflo status` and anything that wants it as one line. */
export function barText(state: State, nowMs: number = Date.now()): string {
  return ['ruflo', ...barParts(state, nowMs).map(part => part.text)].join(' · ')
}

/**
 * The band's panel: a dark ground with a border, in colours from the 256-colour cube and grey ramp. They are explicit, not theme
 * names, so the text stays readable on the ground and a name the host does not know cannot make it refuse the whole band. (A
 * Button cannot be coloured: its label takes the theme's, which reads on a dark theme; on a light one it is dim on the dark ground.)
 */
export const PANEL = { ground: '#1c1c1c', border: '#5f5faf', text: '#d0d0d0', dim: '#8a8a8a', attention: '#ffaf00', live: '#5fd75f', bad: '#ff5f5f' } as const

/** Links at the end of the standing row, each opening the console on that view: where to go next, whatever is happening. */
export const BAND_LINKS: readonly { label: string; go: ViewId }[] = [
  { label: 'Missions', go: 'missions' },
  { label: 'Swarm', go: 'swarm' },
  { label: 'Security', go: 'secure' },
  { label: 'Memory', go: 'memory' },
  { label: 'Cost', go: 'cost' },
  { label: 'Menu', go: 'menu' },
]

/**
 * The band's overall state, which colours its border so it reads from across the room: a notice that is bad (or Anatole blocking) is red,
 * something that needs a person is amber, Claude at work is green, and a quiet band keeps its usual purple.
 */
export type BandTone = 'bad' | 'attention' | 'live' | 'idle'

export function bandTone(parts: readonly BarPart[], notice: Notice | null): BandTone {
  if (notice?.level === 'bad') return 'bad'
  if (parts.some(part => part.tone === 'attention') || notice?.level === 'warn') return 'attention'
  if (parts.some(part => part.tone === 'live')) return 'live'

  return 'idle'
}

const BORDER: Record<BandTone, string> = { bad: PANEL.bad, attention: PANEL.attention, live: PANEL.live, idle: PANEL.border }
const NOTICE_MARK = { ok: '✓', info: 'ℹ', warn: '⚠', bad: '✖' } as const
const NOTICE_COLOR = { ok: PANEL.live, info: PANEL.text, warn: PANEL.attention, bad: PANEL.bad } as const

const toneColor = (tone: BarPart['tone']): string => (tone === 'attention' ? PANEL.attention : tone === 'live' ? PANEL.live : PANEL.text)

/**
 * The band, in a bordered panel with a background, two rows. The first is what is happening now (what needs a person, the mission,
 * who is working, a fresh event). The second is what stands: the last tool call and how long ago, claims, spend, findings, an update,
 * then links to the main views. They are separate rows so a long mission title cannot push the standing facts out. Each part is a
 * link: a click opens the console on the view it is about. `onGo` opens the console there; `onOpen` opens it as it was.
 */
export function barView(kit: Kit, state: State, columns: number, mark: RenderElement | null, onOpen: () => void, onGo?: (view: ViewId) => void, onDismiss?: () => void): RenderElement {
  // A stale marketplace clone is one of the alerts, so it already turns the band's attention part on.
  const parts = barParts(state)
  const notice = visibleNotice(state, Date.now())
  const inner = Math.max(16, columns - 4)
  const sep = (): RenderElement => kit.Text({ color: PANEL.dim, children: ' · ' })

  // One part: a button to its view where it has one, else words in its tone's colour.
  const partElement = (part: BarPart, key: string, room: number): RenderElement => {
    const go = part.go
    const label = clip(part.text, room - 3)

    if (go !== undefined && onGo !== undefined) return kit.Button({ key, label, plain: true, ...(part.tone === 'plain' && { dimColor: true }), onPress: () => onGo(go) })

    return kit.Text({ wrap: 'truncate-end', color: toneColor(part.tone), children: label })
  }
  // A row whose parts do not all fit in full uses their compact forms (a part with none keeps its words), so a part is shortened by
  // its own choice of words, not cut in the middle of one.
  // `bare` is a row whose lead already ends in its own space (the standing row's "↳ "): its first part needs no separator before it.
  const fill = (lead: RenderElement[], room: number, shown: BarPart[], from: number, bare = false): { children: RenderElement[]; room: number } => {
    const children = [...lead]
    const tight = shown.reduce((sum, part) => sum + part.text.length + 3, 0) > room
    const forms = shown.map(part => (tight && part.compact !== undefined ? { ...part, text: part.compact } : part))

    for (const [i, part] of forms.entries()) {
      if (room <= 6) break
      children.push(...(bare && i === 0 ? [] : [sep()]), partElement(part, `band-${from + i}`, room))
      room -= part.text.length + (bare && i === 0 ? 0 : 3)
    }

    return { children, room }
  }

  const status = parts.filter(part => part.row !== 'standing')
  const standing = parts.filter(part => part.row === 'standing')
  const first = fill([mark !== null ? mark : kit.Text({ color: PANEL.attention, children: '◆ ' }), kit.Text({ bold: true, color: PANEL.text, children: 'ruflo' })], inner - 5 - (state.pane.isOpen ? 0 : 18), status, 0)

  if (!state.pane.isOpen) first.children.push(kit.Text({ children: '  ' }), kit.Button({ key: 'open-console', label: 'open console', plain: true, onPress: onOpen }))

  // The second row: the standing facts, then the links with what room is left (a link that does not fit is dropped, not cut).
  const second = fill([kit.Text({ color: PANEL.dim, children: '↳ ' })], inner - 2, standing, status.length, true)
  let room = second.room

  for (const [i, link] of BAND_LINKS.entries()) {
    if (room < link.label.length + 5) break
    // A bar sets the links off from the facts before them; between links, a space.
    if (i > 0) second.children.push(kit.Text({ children: ' ' }))
    else if (standing.length > 0) second.children.push(kit.Text({ color: PANEL.dim, children: ' │ ' }))

    second.children.push(onGo !== undefined ? kit.Button({ key: `band-link-${link.go}`, label: link.label, plain: true, dimColor: true, onPress: () => onGo(link.go) }) : kit.Text({ color: PANEL.dim, children: link.label }))
    room -= link.label.length + (i === 0 ? 3 : 1)
  }

  // An announcement, on its own row: what changed, a link to where it is, and a dismiss. It goes by itself after a short while.
  const noticeRow = notice === null ? [] : [
    kit.Box({
      flexDirection: 'row',
      children: [
        kit.Text({ bold: true, color: NOTICE_COLOR[notice.level], children: `${NOTICE_MARK[notice.level]} ` }),
        kit.Text({ color: NOTICE_COLOR[notice.level], wrap: 'truncate-end', children: clip(notice.text, Math.max(10, inner - 24)) }),
        kit.Text({ children: '  ' }),
        ...(notice.go !== undefined && onGo !== undefined ? [kit.Button({ key: 'band-notice-go', label: 'view', plain: true, onPress: () => onGo(notice.go as ViewId) })] : []),
        ...(onDismiss !== undefined ? [kit.Text({ children: ' ' }), kit.Button({ key: 'band-notice-dismiss', label: '✕', plain: true, dimColor: true, onPress: onDismiss })] : []),
      ],
    }),
  ]

  return kit.Box({
    flexDirection: 'column',
    borderStyle: 'round',
    borderColor: BORDER[bandTone(parts, notice)],
    backgroundColor: PANEL.ground,
    paddingX: 1,
    children: [kit.Box({ flexDirection: 'row', children: first.children }), ...(state.bandCompact ? [] : [kit.Box({ flexDirection: 'row', children: second.children })]), ...noticeRow],
  })
}
