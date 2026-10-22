import { readBounded, under, type ReadCache, type ReaderFs } from './files'
import { jsonObject, plain, recordOf } from './parse'

/**
 * Project Anatole's files (ADR-453 §8) under `.claude-flow/protector-mod/`, read through the bounded, regular-file-only reader (ADR-450 T2).
 * Everything here is what the mod REPORTED: any process can write these files, so the page labels it unauthenticated and never lets a
 * value from a file reach a command except through the tight patterns below (`RULE_ID`, `FINGERPRINT`, `ALERT_ID`).
 */
export const ANATOLE_DIR = '.claude-flow/protector-mod'
/** A file over this is refused, not trimmed (status and rules); the alert log is read whole under ALERTS_MAX and cut to its last lines. */
export const ANATOLE_MAX_BYTES = 65_536
export const ALERTS_MAX_BYTES = 512 * 1024
export const ALERTS_TAIL = 200
/** A status file older than this was written by a session that has ended. */
export const ANATOLE_STALE_MS = 6 * 3_600_000

export const RULE_ID = /^PR-\d{3}$/
export const FINGERPRINT = /^[0-9a-f]{12}$/
export const ALERT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,39}$/
const OWASP = /^(LLM\d{2}|T\d{1,2})$/

export const MODES = ['off', 'learn', 'notify', 'enforce'] as const
export type AnatoleMode = (typeof MODES)[number]
export const RULE_MODES = ['off', 'notify', 'block'] as const
export type RuleMode = (typeof RULE_MODES)[number]
export const ALERT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]
export type AlertState = 'open' | 'acked' | 'allowed'

export type AnatoleStatus = {
  mode: AnatoleMode | null
  modVersion: string | null
  calls: number
  blocked: number
  updatedMs: number | null
  summary: string
  open: Record<AlertSeverity, number> & { total: number }
  baseline: { state: 'learning' | 'mature'; maturity: number; events: number; sessions: number } | null
  /** `false`, or the short reason the mod gave (ADR-453 §2.3: the protector failed open). */
  degraded: false | string
}

export type RuleOverride = { mode: RuleMode; demoted: boolean }
export type AnatoleAlert = { id: string; atMs: number | null; rule: string; owasp: string[]; severity: AlertSeverity; action: 'blocked' | 'notified'; tool: string; summary: string; fp: string | null; state: AlertState }

/** What the folder held. `present` is false when no file of the three exists (the plugin was never loaded here). */
export type AnatoleFacts = {
  present: boolean
  status: AnatoleStatus | null
  /** The person's own mode override from rules.json, when it set one. */
  modeOverride: AnatoleMode | null
  overrides: Record<string, RuleOverride>
  alerts: AnatoleAlert[]
  /** Names of files that existed but were refused (too large, not regular, unknown shape). */
  refused: string[]
  /** How many alert lines were not usable (malformed, hostile). */
  badAlerts: number
}

export const NO_ANATOLE: AnatoleFacts = { present: false, status: null, modeOverride: null, overrides: {}, alerts: [], refused: [], badAlerts: 0 }

const whole = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER) : 0)
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => list.find(item => item === v) ?? null
const isV1 = (value: Record<string, unknown>): boolean => value.schemaVersion === 1
const stamp = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v)

  const parsed = typeof v === 'string' && v.length <= 40 ? Date.parse(v) : Number.NaN

  return Number.isFinite(parsed) ? parsed : null
}

/** status.json, or null when it is not version 1 of an object. Counts are whole numbers, maturity is clamped to 0-100, text is cleaned and short. */
export function parseAnatoleStatus(text: string | null): AnatoleStatus | null {
  const value = jsonObject(text)

  if (value === null || !isV1(value)) return null

  const alerts = recordOf(value.alerts) ?? {}
  const base = recordOf(value.baseline)
  const open = { critical: whole(alerts.critical), high: whole(alerts.high), medium: whole(alerts.medium), low: whole(alerts.low), total: 0 }

  open.total = Math.max(whole(alerts.open), open.critical + open.high + open.medium + open.low)

  const state = base?.state === 'mature' ? 'mature' : 'learning'
  const version = typeof value.modVersion === 'string' && /^[0-9][0-9A-Za-z.+-]{0,15}$/.test(value.modVersion) ? value.modVersion : null

  return {
    mode: oneOf(MODES, value.mode),
    modVersion: version,
    calls: whole(value.calls),
    blocked: whole(value.blocked),
    updatedMs: stamp(value.updatedAt) ?? stamp(value.updatedMs),
    summary: plain(value.summary, 120),
    open,
    baseline: base === null ? null : { state, maturity: Math.min(100, whole(base.maturity)), events: whole(base.events), sessions: whole(base.sessions) },
    degraded: value.degraded === false || value.degraded === undefined || value.degraded === null ? false : plain(typeof value.degraded === 'string' ? value.degraded : 'degraded', 80) || 'degraded',
  }
}

/** rules.json: only the person's overrides. A rule id that is not `PR-###` or a mode that is not off|notify|block is dropped. `demoted` is read only if the mod set it (the schema does not define it). */
export function parseAnatoleRules(text: string | null): { mode: AnatoleMode | null; overrides: Record<string, RuleOverride> } | null {
  const value = jsonObject(text)

  if (value === null || !isV1(value)) return null

  const overrides: Record<string, RuleOverride> = {}

  for (const [id, entry] of Object.entries(recordOf(value.rules) ?? {}).slice(0, 64)) {
    const mode = oneOf(RULE_MODES, recordOf(entry)?.mode)

    if (RULE_ID.test(id) && mode !== null) overrides[id] = { mode, demoted: recordOf(entry)?.demoted === true }
  }

  return { mode: oneOf(MODES, value.mode), overrides }
}

/** One alert line: every enum whitelisted, every token that can reach a command matched against its pattern, a hostile line is null. */
export function parseAlertLine(line: string): AnatoleAlert | null {
  const value = line.length <= 4096 ? jsonObject(line) : null

  if (value === null) return null

  const severity = oneOf(ALERT_SEVERITIES, value.severity)
  const rule = typeof value.rule === 'string' && RULE_ID.test(value.rule) ? value.rule : null
  const id = typeof value.id === 'string' && ALERT_ID.test(value.id) ? value.id : null
  const state = oneOf(['open', 'acked', 'allowed'] as const, value.state)

  if (severity === null || rule === null || id === null || state === null) return null

  return {
    id,
    atMs: stamp(value.at),
    rule,
    owasp: (Array.isArray(value.owasp) ? value.owasp : []).filter((tag): tag is string => typeof tag === 'string' && OWASP.test(tag)).slice(0, 6),
    severity,
    action: value.action === 'blocked' ? 'blocked' : 'notified',
    tool: plain(value.tool, 40),
    summary: plain(value.summary, 160),
    fp: typeof value.fp === 'string' && FINGERPRINT.test(value.fp) ? value.fp : null,
    state,
  }
}

/** The last ALERTS_TAIL lines of the log, newest last; returns the usable alerts and how many lines were not. */
export function parseAlerts(text: string | null): { alerts: AnatoleAlert[]; bad: number } {
  if (text === null) return { alerts: [], bad: 0 }

  const lines = text.split('\n').filter(line => line.trim() !== '').slice(-ALERTS_TAIL)
  const alerts = lines.flatMap(line => parseAlertLine(line) ?? [])

  return { alerts, bad: lines.length - alerts.length }
}

/** Reads the folder; never rejects. A missing file is absence, not an error; a file that exists and is refused is named in `refused`. */
export async function readAnatole(fs: ReaderFs, cache: ReadCache, cwd: string): Promise<AnatoleFacts> {
  const at = (name: string) => under(cwd, `${ANATOLE_DIR}/${name}`)
  const [status, rules, log] = await Promise.all([readBounded(fs, cache, at('status.json'), ANATOLE_MAX_BYTES, true), readBounded(fs, cache, at('rules.json'), ANATOLE_MAX_BYTES, true), readBounded(fs, cache, at('alerts.jsonl'), ALERTS_MAX_BYTES, true)])
  const present = [status, rules, log].some(read => read.text !== null || read.reason !== 'missing')

  if (!present) return NO_ANATOLE

  const refused: string[] = []
  const check = (name: string, read: typeof status, parsed: unknown) => {
    if (read.text === null ? read.reason !== 'missing' : parsed === null) refused.push(name)
  }
  const parsedStatus = parseAnatoleStatus(status.text)
  const parsedRules = parseAnatoleRules(rules.text)
  const tail = parseAlerts(log.text)

  check('status.json', status, parsedStatus)
  check('rules.json', rules, parsedRules)
  check('alerts.jsonl', log, log.text === null ? null : {})

  return { present: true, status: parsedStatus, modeOverride: parsedRules?.mode ?? null, overrides: parsedRules?.overrides ?? {}, alerts: tail.alerts, refused, badAlerts: tail.bad }
}
