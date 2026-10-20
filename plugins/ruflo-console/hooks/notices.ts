/**
 * Notices: short announcements the band raises when something changes while nobody is looking at it: new approvals or alerts, a mission
 * finishing, a long Claude turn ending, Project Anatole blocking a call. A notice is recorded (a ring of 30, listed by `/ruflo notices`),
 * shown on the band's notice row for a short while, and linked to the view it is about. They come only from changes the console observed
 * between two reads: nothing is synthesised, and the first read announces nothing. Pure, apart from the helpers that edit `state`.
 */
import { alertsOf, waitingApprovalsOf } from './data/alerts'
import { agentLabels } from './data/parse'
import { activeMission, failedOf, progressOf } from './mission-control'
import type { State, ViewId } from './state'

export type NoticeLevel = 'ok' | 'info' | 'warn' | 'bad'

export type Notice = { id: number; atMs: number; level: NoticeLevel; text: string; key: string; go?: ViewId; seen: boolean }

/** What a notice is raised from, before it gets an id and a time. */
export type NoticeDraft = { level: NoticeLevel; text: string; key: string; go?: ViewId }

export const MAX_NOTICES = 30
/** How long an unseen notice stays on the band's notice row. */
export const SHOW_MS = 20_000
/** The same kind of notice (its key) is not raised again inside this window. */
export const DEDUPE_MS = 60_000

/** The few counts a notice is decided from, read off the state at one moment. */
export type Facts = {
  approvals: number
  alerts: number
  /** `failed` is the count of failed tasks (absent: none known). */
  mission: { id: string; done: number; total: number; failed?: number } | null
  anatole: { blocked: number; critical: number; degraded: string | null } | null
}

export function factsOf(state: State, nowMs: number = Date.now()): Facts {
  const mission = activeMission(state)
  const tasks = state.snapshot?.tasks ?? []
  const progress = mission === null || mission.cancelled ? null : progressOf(mission, tasks)
  const status = state.snapshot?.anatole?.status ?? null

  return {
    approvals: waitingApprovalsOf(state).length,
    alerts: alertsOf(state, nowMs, state.loadedAtMs).filter(alert => alert.level !== 'info').length,
    mission: mission === null || progress === null ? null : { id: mission.id, done: progress.done, total: progress.total, failed: failedOf(mission, tasks) },
    anatole: status === null ? null : { blocked: status.blocked, critical: status.open.critical, degraded: status.degraded === false ? null : String(status.degraded).slice(0, 60) },
  }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** What changed between two reads that a person would want announced. The newest Anatole alert's rule rides on a block. */
export function noticesBetween(before: Facts, after: Facts, newestRule: string | null = null): NoticeDraft[] {
  const out: NoticeDraft[] = []

  if (after.approvals > before.approvals) out.push({ level: 'warn', text: `${plural(after.approvals - before.approvals, 'new approval')} waiting (q)`, key: 'approvals', go: 'approvals' })
  if (after.alerts > before.alerts) out.push({ level: 'warn', text: `${plural(after.alerts - before.alerts, 'new alert')}`, key: 'alerts', go: 'overview' })

  if (before.mission !== null && before.mission.done < before.mission.total && after.mission !== null && after.mission.id === before.mission.id && after.mission.done >= after.mission.total) {
    out.push({ level: 'ok', text: `🎯 mission finished: ${after.mission.done}/${after.mission.total} tasks`, key: 'mission-done', go: 'missions' })
  }

  if (before.mission !== null && after.mission !== null && after.mission.id === before.mission.id && (after.mission.failed ?? 0) > (before.mission.failed ?? 0)) {
    out.push({ level: 'bad', text: `🎯 mission task failed: ${plural(after.mission.failed ?? 0, 'task')} failed, ${after.mission.done}/${after.mission.total} done`, key: 'mission-failed', go: 'missions' })
  }

  if (before.anatole !== null && after.anatole !== null) {
    if (after.anatole.blocked > before.anatole.blocked) out.push({ level: 'bad', text: `🛡 Anatole blocked ${plural(after.anatole.blocked - before.anatole.blocked, 'call')}${newestRule === null ? '' : ` · ${newestRule}`}`, key: 'anatole-blocked', go: 'secure' })
    else if (after.anatole.critical > before.anatole.critical) out.push({ level: 'bad', text: '🛡 Anatole: a new critical alert', key: 'anatole-critical', go: 'secure' })
    if (after.anatole.degraded !== null && before.anatole.degraded === null) out.push({ level: 'warn', text: `🛡 Anatole is degraded: ${after.anatole.degraded}`, key: 'anatole-degraded', go: 'secure' })
  }

  return out
}

/** The notices a person should hear about wherever they are looking, not only on the band: a mission ending well or badly (ADR-477). */
export const TOASTED_KEYS: ReadonlySet<string> = new Set(['mission-done', 'mission-failed'])

/** After a read: announces what changed since `before` (the newest open Anatole alert's rule rides on a block). Returns the notices that were recorded. */
export function announceChanges(state: State, before: Facts, nowMs: number): NoticeDraft[] {
  const open = (state.snapshot?.anatole?.alerts ?? []).filter(alert => alert.state === 'open')

  return noticesBetween(before, factsOf(state, nowMs), open.at(-1)?.rule ?? null).filter(draft => addNotice(state, draft, nowMs))
}

/** Records a notice, unless one with the same key was raised a minute ago. The ring keeps the newest 30. Returns whether it was recorded. */
export function addNotice(state: State, draft: NoticeDraft, nowMs: number = Date.now()): boolean {
  if (state.notices.some(notice => notice.key === draft.key && nowMs - notice.atMs < DEDUPE_MS)) return false

  state.noticeSeq += 1
  state.notices.push({ id: state.noticeSeq, atMs: nowMs, level: draft.level, text: draft.text.slice(0, 120), key: draft.key, ...(draft.go !== undefined && { go: draft.go }), seen: false })
  if (state.notices.length > MAX_NOTICES) state.notices.splice(0, state.notices.length - MAX_NOTICES)

  return true
}

/** The notice the band shows now: the newest unseen one still young, none while the person has asked for quiet. */
export function visibleNotice(state: State, nowMs: number): Notice | null {
  if (nowMs < state.noticesQuietUntilMs) return null

  for (let i = state.notices.length - 1; i >= 0; i--) {
    const notice = state.notices[i] as Notice

    if (!notice.seen && nowMs - notice.atMs < SHOW_MS) return notice
  }

  return null
}

/** Dismisses what is showing (and anything older and unseen), so the next notice shows on its own. */
export function dismissNotices(state: State): void {
  for (const notice of state.notices) notice.seen = true
}

const AGO = (ms: number): string => (ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${Math.round(ms / 3_600_000)}h`)

/** `/ruflo notices`: the last ten, newest first; listing them marks them seen. `clear` empties the ring. */
export function noticesReply(state: State, nowMs: number, clear: boolean): string {
  if (clear) {
    const n = state.notices.length

    state.notices.length = 0

    return n === 0 ? 'no notices to clear' : `cleared ${plural(n, 'notice')}`
  }

  const recent = state.notices.slice(-10).reverse()

  dismissNotices(state)

  if (recent.length === 0) return 'no notices yet: the band raises one when approvals or alerts arrive, a mission finishes, a long turn ends, or Anatole blocks a call'

  const mark = { ok: '✓', info: 'ℹ', warn: '⚠', bad: '✖' } as const

  return [`notices (newest first${nowMs < state.noticesQuietUntilMs ? `; quiet for ${AGO(state.noticesQuietUntilMs - nowMs)} more` : ''}):`, ...recent.map(notice => `  ${mark[notice.level]} ${notice.text} · ${AGO(nowMs - notice.atMs)} ago${notice.go === undefined ? '' : ` · /ruflo ${notice.go}`}`)].join('\n')
}

/** `/ruflo quiet [minutes|off]`: silence the notice row for a while (notices are still recorded and listed). */
export function quietReply(state: State, nowMs: number, arg: string): string {
  const word = arg.trim().toLowerCase()

  if (word === 'off' || word === '0') {
    state.noticesQuietUntilMs = 0

    return 'notices are on again'
  }

  if (word === '') return nowMs < state.noticesQuietUntilMs ? `notices are quiet for ${AGO(state.noticesQuietUntilMs - nowMs)} more (/ruflo quiet off)` : 'notices are on (/ruflo quiet <minutes> silences the band\'s notice row)'

  const minutes = Number(word)

  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return 'quiet takes a number of minutes from 1 to 1440, or off'

  state.noticesQuietUntilMs = nowMs + Math.round(minutes) * 60_000

  return `notices are quiet for ${Math.round(minutes)}m: they are still recorded (/ruflo notices lists them)`
}

/** `/ruflo band [auto|on|off|compact|full|reset]`: the band's show/hide and size for this session, over the option. */
export function bandReply(state: State, arg: string): string {
  const word = arg.trim().toLowerCase()

  if (word === 'auto' || word === 'on' || word === 'off') state.bandMode = word
  else if (word === 'compact') state.bandCompact = true
  else if (word === 'full') state.bandCompact = false
  else if (word === 'reset') {
    state.bandMode = null
    state.bandCompact = false
  } else if (word !== '') return 'band takes auto, on, off, compact, full or reset'

  return `band: ${state.bandMode ?? `${state.options.bar} (the plugin option)`} · ${state.bandCompact ? 'compact (one row)' : 'full (two rows)'}`
}

/** A readable name for a subagent in the event stream: the ruflo agent's label when it is one, else "subagent" and the id's first six characters. */
export function agentName(state: State, agentId: string | undefined): string {
  if (agentId === undefined) return 'claude'

  const agents = state.snapshot?.agents ?? []
  const known = agentLabels(agents).get(agentId)

  return known !== undefined ? known : `subagent ${agentId.replace(/[^a-z0-9]/gi, '').slice(0, 6)}`
}

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b)

export const median = (values: readonly number[]) => sorted(values)[Math.floor(values.length / 2)] ?? 0
export const p95 = (values: readonly number[]) => sorted(values)[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0

/** With the band off, the console's words ride ruflo-mods' status line instead: claims and a stale marketplace only. */
export function segmentOf(state: State): string | null {
  const claims = state.snapshot?.claims ?? []
  const parts = [claims.length > 0 ? `${claims.length} claims` : '', state.snapshot?.plugins.missingFromClone.length ? 'marketplace stale' : ''].filter(Boolean)

  return parts.length === 0 ? null : parts.join(' · ')
}
