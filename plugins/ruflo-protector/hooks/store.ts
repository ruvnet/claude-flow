import type { Baseline } from './baseline'
import { maturity } from './baseline'
import type { Mode } from './options'
import { asMode } from './options'
import { RULES, type RuleMode, type Severity } from './rules'
import type { Ev } from './shapes'

export const DIR = '.claude-flow/protector-mod'
export const FILES = { status: `${DIR}/status.json`, rules: `${DIR}/rules.json`, baseline: `${DIR}/baseline.json`, alerts: `${DIR}/alerts.jsonl`, allow: `${DIR}/allow.json`, ring: `${DIR}/ring.json` } as const

export const MAX_ALERTS = 150
export const MAX_RING = 500

export type AlertState = 'open' | 'acked' | 'allowed'
export type Alert = {
  id: string
  at: number
  rule: string
  owasp: string[]
  severity: Severity
  action: 'blocked' | 'notified'
  tool: string
  /** A shape, never a value; at most 160 characters. */
  summary: string
  /** 12 hex characters over (rule, head, host or area). */
  fp: string
  state: AlertState
  session: string
  count?: number
}
export type AllowEntry = { fp: string; rule: string; at: number; note: string }
export type Overrides = { mode?: Mode; rules: Record<string, { mode: RuleMode; demoted?: boolean }> }

export type Status = {
  mode: Mode
  calls: number
  blocked: number
  startedAt: number
  updatedAt: number
  alertCounts: { open: number; critical: number; high: number; medium: number; low: number; total: number }
  baseline: Baseline
  ruleCounts: { total: number; block: number; notify: number; off: number }
  degraded: false | string
  suppressed: number
  version: string
}

export const MOD_VERSION = '0.1.1'

export function statusText(s: Status, now: number): string {
  const m = maturity(s.baseline, now)
  const o = s.alertCounts
  const summary = `Project Anatole · ${s.mode} · ${o.open} open alert${o.open === 1 ? '' : 's'} · ${s.blocked} blocked · baseline ${m.mature ? 'mature' : `learning ${m.pct}%`}${s.degraded ? ` · degraded: ${s.degraded}` : ''}`
  return `${JSON.stringify({
    // `version` and the two `*Ms` keys are what the console's mod scan (ADR-446) requires: without them the Mods page lists this file as refused.
    schemaVersion: 1, version: 1, name: 'protector', modVersion: s.version, mode: s.mode, guard: s.mode !== 'off', calls: s.calls, blocked: s.blocked,
    startedAt: s.startedAt, startedMs: s.startedAt, updatedAt: now, updatedMs: now, summary: summary.slice(0, 200), alerts: o,
    baseline: { state: m.mature ? 'mature' : 'learning', maturity: m.pct, events: s.baseline.events, sessions: s.baseline.sessions, firstSeenAt: s.baseline.firstSeenAt },
    rules: s.ruleCounts, degraded: s.degraded,
  }, null, 2)}\n`
}

export const alertsText = (alerts: readonly Alert[]) => (alerts.length ? `${alerts.map(a => JSON.stringify(a)).join('\n')}\n` : '')

export function parseAlerts(text: string): Alert[] {
  const out: Alert[] = []
  for (const line of text.split('\n').slice(-200)) {
    try {
      const a = JSON.parse(line) as Partial<Alert>
      if (typeof a.id === 'string' && typeof a.rule === 'string' && typeof a.fp === 'string') {
        out.push({ ...(a as Alert), summary: String(a.summary ?? '').slice(0, 160), state: a.state === 'acked' || a.state === 'allowed' ? a.state : 'open' })
      }
    } catch {
      /* a torn or foreign line is skipped */
    }
  }
  return out.slice(-MAX_ALERTS)
}

export const allowText = (entries: readonly AllowEntry[]) => `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`

export function parseAllow(text: string): AllowEntry[] {
  try {
    const o = JSON.parse(text) as { schemaVersion?: number; entries?: unknown }
    if (o.schemaVersion !== 1 || !Array.isArray(o.entries)) return []
    return o.entries.filter((e): e is AllowEntry => !!e && typeof (e as AllowEntry).fp === 'string' && /^[0-9a-f]{12}$/.test((e as AllowEntry).fp)).slice(0, 500)
  } catch {
    return []
  }
}

export const overridesText = (o: Overrides) => `${JSON.stringify({ schemaVersion: 1, ...(o.mode ? { mode: o.mode } : {}), rules: o.rules }, null, 2)}\n`

export function parseOverrides(text: string): Overrides {
  try {
    const o = JSON.parse(text) as { schemaVersion?: number; mode?: unknown; rules?: Record<string, { mode?: unknown; demoted?: unknown }> }
    if (o.schemaVersion !== 1) return { rules: {} }
    const rules: Overrides['rules'] = {}
    for (const r of RULES) {
      const m = o.rules?.[r.id]?.mode
      if (m === 'off' || m === 'notify' || m === 'block') rules[r.id] = { mode: m, ...(o.rules?.[r.id]?.demoted === true ? { demoted: true } : {}) }
    }
    const mode = asMode(o.mode)
    return { ...(mode ? { mode } : {}), rules }
  } catch {
    return { rules: {} }
  }
}

/** The ring as categorical records only (no flags beyond the closed set), for `/protector replay`. */
export const ringText = (ring: readonly Ev[]) => `${JSON.stringify({ schemaVersion: 1, events: ring.slice(-MAX_RING) })}\n`

export function parseRing(text: string): Ev[] {
  try {
    const o = JSON.parse(text) as { schemaVersion?: number; events?: unknown }
    return o.schemaVersion === 1 && Array.isArray(o.events) ? (o.events as Ev[]).filter(e => e && typeof e.tool === 'string' && Array.isArray(e.flags)).slice(-MAX_RING) : []
  } catch {
    return []
  }
}

/** 12 hex characters of FNV-1a over the key; a fingerprint, not a secret. */
export function fingerprint(key: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < key.length; i++) {
    a = Math.imul(a ^ key.charCodeAt(i), 0x01000193) >>> 0
    b = Math.imul(b ^ key.charCodeAt(i), 0x85ebca6b) >>> 0
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 12)
}
