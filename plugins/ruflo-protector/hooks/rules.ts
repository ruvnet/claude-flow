import { type Baseline, known } from './baseline'
import { EXEMPT_ARGV, type Ev } from './shapes'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type RuleMode = 'off' | 'notify' | 'block'
/** `hard` rules are literal shapes and never consult the baseline; `corr` rules correlate two events; `anomaly` rules need a mature baseline and a risky action. */
export type Kind = 'hard' | 'corr' | 'anomaly'

/** What a rule may look at besides the event: the baseline, this turn's facts and the last minute's counts. */
export type Ctx = {
  readonly baseline: Baseline
  readonly mature: boolean
  readonly credRead: boolean
  readonly promptWords: ReadonlySet<string>
  readonly calls1m: number
  readonly spawns1m: number
}

export type Rule = {
  readonly id: string
  readonly owasp: readonly string[]
  readonly severity: Severity
  readonly default: Exclude<RuleMode, 'off'>
  readonly kind: Kind
  readonly summary: string
  /** Exact-argv commands the rule does not fire on (see shapes.ts EXEMPT_ARGV); empty where the ADR names none. */
  readonly exempt: readonly string[]
  readonly fires: (ev: Ev, c: Ctx) => boolean
}

const has = (ev: Ev, f: Ev['flags'][number]) => ev.flags.includes(f)
const named = (c: Ctx, w: string) => c.promptWords.has(w) || [...c.promptWords].some(p => p.endsWith(`.${w}`))
const hostNamed = (ev: Ev, c: Ctx) => ev.host !== '' && [...c.promptWords].some(p => p === ev.host || p.endsWith(`.${ev.host}`) || ev.host.endsWith(`.${p}`))

/** PR-005: a risky action after outside content, one the person's own prompt did not name. */
function taintedUnasked(ev: Ev, c: Ctx): boolean {
  if (!ev.tainted) return false
  if (ev.risk === 'net') return !hostNamed(ev, c) && !(c.mature && ev.host !== '' && known(c.baseline.hosts, ev.host, true))
  if (!c.mature) return false
  if (ev.risk === 'exec') return ev.heads.some(h => !known(c.baseline.commands, h, true) && !named(c, h.split(' ')[0] as string))
  if (ev.risk === 'write') return ev.areas.some(a => a.startsWith('outside:') && !known(c.baseline.areas, a, true))
  return false
}

/** PR-007: a spawn fan-out of 8 in a minute, or a call rate over three times the baseline p95 (and over 60). */
function tooFast(ev: Ev, c: Ctx): boolean {
  if (!c.mature) return false
  if (ev.k === 'spawn') return c.spawns1m >= 8
  return c.calls1m > Math.max(60, 3 * c.baseline.rate.p95)
}

const R = (id: string, owasp: string[], severity: Severity, def: 'block' | 'notify', kind: Kind, summary: string, fires: Rule["fires"], exempt: readonly string[] = []): Rule => ({ id, owasp, severity, default: def, kind, summary, exempt, fires })



/** Version 1 of the catalogue (ADR-453 §5). Each rule is a pure function of the normalised event. */
export const RULES: readonly Rule[] = [
  R('PR-001', ['LLM02', 'T2'], 'critical', 'block', 'hard', 'a secret-shaped value sent to a network sink', ev => has(ev, 'secret')),
  R('PR-002', ['T11', 'LLM06'], 'critical', 'block', 'hard', 'remote code piped into an interpreter', ev => has(ev, 'pipe-shell')),
  R('PR-003', ['T3', 'T11', 'LLM06'], 'high', 'block', 'hard', 'persistence or self-modification (Claude config, hooks, rc files, cron, authorized_keys, git hooks)', ev => has(ev, 'persist'), EXEMPT_ARGV),
  R('PR-004', ['LLM02', 'T3'], 'high', 'notify', 'corr', 'credential store read, then network egress in the same turn', (ev, c) => c.credRead && ev.risk === 'net' && ev.host !== 'local'),
  R('PR-005', ['LLM01', 'T6'], 'high', 'notify', 'corr', 'a risky action in a tainted turn that the prompt did not ask for', taintedUnasked),
  R('PR-006', ['LLM06', 'T2'], 'critical', 'block', 'hard', 'destructive operation (root/home/project delete, force push to default branch, DROP DATABASE, disk wipe)', ev => has(ev, 'destroy')),
  R('PR-007', ['LLM10', 'T4'], 'medium', 'notify', 'anomaly', 'tool-call rate or agent-spawn fan-out far above the baseline', tooFast),
  R('PR-008', ['LLM02'], 'medium', 'notify', 'anomaly', 'a network host never seen in the baseline, carrying a body', (ev, c) => c.mature && ev.risk === 'net' && has(ev, 'body') && ev.host !== '' && ev.host !== 'local' && !known(c.baseline.hosts, ev.host, true)),
  R('PR-009', ['LLM06', 'T3'], 'medium', 'notify', 'anomaly', 'a write outside the project root in an area the baseline has never touched', (ev, c) => c.mature && ev.risk === 'write' && ev.areas.some(a => a.startsWith('outside:') && !known(c.baseline.areas, a, true))),
  R('PR-010', ['T12', 'LLM01'], 'high', 'notify', 'hard', 'an inter-agent message carrying instruction-override phrasing', ev => has(ev, 'override')),
  R('PR-011', ['T13', 'T3'], 'medium', 'notify', 'anomaly', 'an agent spawn that escalates permissions or is of a type never used', (ev, c) => ev.k === 'spawn' && (has(ev, 'escalate') || (c.mature && !known(c.baseline.spawns, ev.head, true)))),
  R('PR-012', ['LLM03'], 'medium', 'notify', 'hard', 'a dependency installed from a git URL, tarball or non-default index', ev => has(ev, 'dep-url')),
  R('PR-013', ['LLM07'], 'high', 'notify', 'hard', 'system prompt or instruction markers sent to a network sink', ev => has(ev, 'sysprompt')),
]

export const ruleById = (id: string): Rule | undefined => RULES.find(r => r.id === id)

/** The rules an event trips, in catalogue order. */
export const hitsOf = (ev: Ev, c: Ctx): Rule[] => RULES.filter(r => r.fires(ev, c))
