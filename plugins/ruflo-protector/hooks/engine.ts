import { type Baseline, closeMinute, emptyBaseline, learn, maturity } from './baseline'
import type { Mode, ModOptions } from './options'
import { type Ctx, hitsOf, ruleById, RULES, type Rule, type RuleMode } from './rules'
import type { Ev } from './shapes'
import { type Alert, type AllowEntry, fingerprint, MAX_ALERTS, MAX_RING, MOD_VERSION, type Overrides, type Status } from './store'

export type Verdict = 'allow' | 'note' | 'notify' | 'block'
export type Outcome = { verdict: Verdict; deny?: string; alert?: Alert; rules: string[] }

const HOUR = 3_600_000
const MAX_ALERTS_PER_HOUR = 20
const DEMOTE = { min: 10, share: 0.3, window: 50 }
const SEV = { critical: 0, high: 1, medium: 2, low: 3 } as const

/** Everything one session of the protector knows. Pure state and decisions: no `$`, no files. */
export class Engine {
  mode: Mode
  baseline: Baseline = emptyBaseline()
  overrides: Overrides = { rules: {} }
  allow: AllowEntry[] = []
  alerts: Alert[] = []
  ring: Ev[] = []
  degraded: false | string = false
  calls = 0
  blocked = 0
  suppressed = 0
  startedAt = 0
  session = ''
  root = ''
  /** Per-turn facts; never persisted. */
  credRead = false
  tainted = false
  promptWords = new Set<string>()
  private seq = 0
  private evs = new Map<string, Ev>()
  private fpSeen = new Map<string, Alert>()
  private stamps: number[] = []
  private minute = { at: 0, calls: 0, spawns: 0 }
  readonly hits: Record<string, number> = {}

  constructor(private readonly opts: ModOptions) {
    this.mode = opts.mode
  }

  begin(session: string, root: string, now: number) {
    this.session = session
    this.root = root
    this.startedAt = now
    this.baseline.sessions++
    if (this.baseline.firstSeenAt === 0) this.baseline.firstSeenAt = now
  }

  load(overrides: Overrides, allow: AllowEntry[], alerts: Alert[], baseline: Baseline, ring: Ev[]) {
    this.overrides = overrides
    if (overrides.mode) this.mode = overrides.mode
    this.allow = allow
    this.alerts = alerts
    this.baseline = baseline
    this.ring = ring
    for (const a of alerts) this.hits[a.rule] = (this.hits[a.rule] ?? 0) + 1
  }

  modeOf(rule: Rule): RuleMode {
    return this.overrides.rules[rule.id]?.mode ?? rule.default
  }

  newTurn(prompt: string) {
    this.credRead = false
    this.tainted = false
    this.promptWords = new Set(prompt.toLowerCase().split(/[^a-z0-9.-]+/).filter(w => w.length > 1).slice(0, 2000))
  }

  private tick(now: number, spawn: boolean) {
    const at = Math.floor(now / 60_000)
    if (at !== this.minute.at) {
      if (this.minute.at !== 0) closeMinute(this.baseline, this.minute.calls)
      this.minute = { at, calls: 0, spawns: 0 }
    }
    if (spawn) this.minute.spawns++
    else this.minute.calls++
  }

  private ctx(now: number): Ctx {
    return { baseline: this.baseline, mature: maturity(this.baseline, now).mature, credRead: this.credRead, promptWords: this.promptWords, calls1m: this.minute.calls, spawns1m: this.minute.spawns }
  }

  /**
   * Score one event. `denied` is true when the chain beneath already refused the call (it is never learned). Returns the verdict (§4.3):
   * only a rule marked `block`, in `enforce`, ever denies; a learned anomaly alone never does.
   */
  evaluate(ev: Ev, now: number, denied: boolean): Outcome {
    this.calls++
    this.tick(now, ev.k === 'spawn')
    if (ev.flags.includes('cred-read')) this.credRead = true
    ev.tainted = this.tainted
    this.ring.push(ev)
    if (this.ring.length > MAX_RING) this.ring.shift()
    if (this.mode === 'off') return { verdict: 'allow', rules: [] }

    const fired = hitsOf(ev, this.ctx(now))
    const live = fired.filter(r => this.modeOf(r) !== 'off' && !this.allowed(fingerprintOf(r, ev)))
    for (const r of fired) this.hits[r.id] = (this.hits[r.id] ?? 0) + 1
    if (fired.length === 0 && !denied && !ev.tainted) learn(this.baseline, ev, this.session, now)
    if (live.length === 0) return { verdict: 'allow', rules: [] }
    const top = [...live].sort((a, b) => SEV[a.severity] - SEV[b.severity])[0] as Rule
    const rules = live.map(r => r.id)
    if (this.mode === 'learn') return { verdict: 'note', rules }

    const block = this.mode === 'enforce' ? live.filter(r => this.modeOf(r) === 'block').sort((a, b) => SEV[a.severity] - SEV[b.severity])[0] : undefined
    const chosen = block ?? top
    const fp = fingerprintOf(chosen, ev)
    const alert = this.raise(chosen, ev, fp, block ? 'blocked' : 'notified', now)
    if (block) {
      this.blocked++
      return { verdict: 'block', rules, alert, deny: `ruflo-protector (Project Anatole) blocked this call: ${block.id} ${block.summary}. If it is intended, allow it with /protector allow ${fp} (or set mode notify).` }
    }
    return { verdict: alert ? 'notify' : 'note', rules, alert }
  }

  private allowed(fp: string) {
    return this.allow.some(a => a.fp === fp)
  }

  /** One alert per fingerprint per session (a repeat only raises its count); at most 20 new alerts an hour; the rest are counted, not written. */
  private raise(r: Rule, ev: Ev, fp: string, action: Alert['action'], now: number): Alert | undefined {
    const prior = this.fpSeen.get(fp)
    if (prior) {
      prior.count = (prior.count ?? 1) + 1
      return undefined
    }
    this.stamps = this.stamps.filter(t => now - t < HOUR)
    if (this.stamps.length >= MAX_ALERTS_PER_HOUR) {
      this.suppressed++
      return undefined
    }
    this.stamps.push(now)
    const shape = [ev.tool, ev.head && `head ${ev.head}`, ev.host && `host ${ev.host}`, ev.areas[0] && `area ${ev.areas[0]}`].filter(Boolean).join(' · ')
    const a: Alert = {
      id: `${this.session.slice(0, 6) || 's'}-${++this.seq}`, at: now, rule: r.id, owasp: [...r.owasp], severity: r.severity, action, tool: ev.tool.slice(0, 40),
      summary: `${r.summary} (${shape})`.slice(0, 160), fp, state: 'open', session: this.session.slice(0, 12),
    }
    this.alerts.push(a)
    if (this.alerts.length > MAX_ALERTS) this.alerts.shift()
    this.fpSeen.set(fp, a)
    this.evs.set(a.id, ev)
    this.demoteIfNoisy(r.id)
    return a
  }

  /** A rule whose recent alerts are mostly acked (more than 30%, at least 10 alerts) drops to notify. */
  demoteIfNoisy(id: string): boolean {
    const recent = this.alerts.filter(a => a.rule === id).slice(-DEMOTE.window)
    const rule = ruleById(id)
    if (!rule || recent.length < DEMOTE.min || this.modeOf(rule) !== 'block') return false
    if (recent.filter(a => a.state === 'acked').length / recent.length <= DEMOTE.share) return false
    this.overrides.rules[id] = { mode: 'notify', demoted: true }
    return true
  }

  ack(id: string, now: number): 'ok' | 'missing' {
    const a = this.alerts.find(x => x.id === id)
    if (!a) return 'missing'
    a.state = 'acked'
    this.addAllow(a.fp, a.rule, now, 'acked')
    const ev = this.evs.get(id)
    if (ev) learn(this.baseline, { ...ev, flags: [] }, this.session, now)
    this.demoteIfNoisy(a.rule)
    return 'ok'
  }

  unack(id: string): 'ok' | 'missing' {
    const a = this.alerts.find(x => x.id === id)
    if (!a) return 'missing'
    a.state = 'open'
    this.allow = this.allow.filter(e => e.fp !== a.fp)
    return 'ok'
  }

  addAllow(fp: string, rule: string, now: number, note: string) {
    if (!this.allowed(fp)) this.allow.push({ fp, rule, at: now, note })
    if (this.allow.length > 500) this.allow.shift()
    for (const a of this.alerts) if (a.fp === fp && a.state === 'open') a.state = 'allowed'
  }

  /** Learn graduates to notify on maturity when `autoGraduate` is on; it never reaches enforce. */
  graduate(now: number): boolean {
    if (this.mode !== 'learn' || !this.opts.autoGraduate || !maturity(this.baseline, now).mature) return false
    this.mode = 'notify'
    this.overrides.mode = 'notify'
    return true
  }

  setMode(m: Mode) {
    this.mode = m
    this.overrides.mode = m
  }

  setRule(id: string, mode: RuleMode) {
    this.overrides.rules[id] = { mode }
  }

  resetBaseline() {
    this.baseline = emptyBaseline()
    this.baseline.sessions = 1
    this.baseline.firstSeenAt = this.startedAt
  }

  status(): Status {
    const open = this.alerts.filter(a => a.state === 'open')
    const by = (s: string) => open.filter(a => a.severity === s).length
    const modes = RULES.map(r => this.modeOf(r))
    return {
      mode: this.mode, calls: this.calls, blocked: this.blocked, startedAt: this.startedAt, updatedAt: 0, suppressed: this.suppressed, degraded: this.degraded, version: MOD_VERSION,
      alertCounts: { open: open.length, critical: by('critical'), high: by('high'), medium: by('medium'), low: by('low'), total: this.alerts.length },
      baseline: this.baseline, ruleCounts: { total: RULES.length, block: modes.filter(m => m === 'block').length, notify: modes.filter(m => m === 'notify').length, off: modes.filter(m => m === 'off').length },
    }
  }

  /** Per-rule row for `/protector list`: hits and the acked share of the recent alerts. */
  rows() {
    return RULES.map(r => {
      const mine = this.alerts.filter(a => a.rule === r.id)
      return { rule: r, mode: this.modeOf(r), hits: this.hits[r.id] ?? 0, acked: mine.length ? Math.round((mine.filter(a => a.state === 'acked').length / mine.length) * 100) : 0, demoted: this.overrides.rules[r.id]?.demoted === true, changed: this.overrides.rules[r.id] !== undefined && this.overrides.rules[r.id]?.mode !== r.default }
    })
  }
}

export const fingerprintOf = (r: Rule, ev: Ev) => fingerprint(`${r.id}|${ev.head}|${ev.host || ev.areas[0] || ''}`)
