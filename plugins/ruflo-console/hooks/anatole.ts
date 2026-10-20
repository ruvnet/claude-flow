/**
 * Project Anatole in the console (ADR-453 §9): the shipped rule table as static metadata, the slash strings every button sends, and the
 * palette entries behind them. A change goes to the mod as `host.runSlash('protector', '<verb args>')` after the console's confirm; the mod
 * answers locally. Pure: no `$`. Every value that reaches a command passes a fixed pattern first (data/anatole.ts).
 */
import type { ActionSpec } from './actions'
import { ALERT_ID, FINGERPRINT, MODES, RULE_ID, RULE_MODES, type AnatoleAlert, type AnatoleMode, type RuleMode } from './data/anatole'
import { plain } from './data/parse'
import type { Host } from './host'
import { textLines } from './secure'
import type { State } from './state'
import type { PaletteEntry } from './palette'

export type RuleMeta = { id: string; title: string; owasp: readonly string[]; severity: 'critical' | 'high' | 'medium'; fallback: RuleMode }

/** The 13 rules of version 1 (ADR-453 §5): what the page lists. The mod's own list is not reachable from here, so it is kept in step with the ADR by a test. */
export const ANATOLE_RULES: readonly RuleMeta[] = [
  { id: 'PR-001', title: 'secret leaves the machine', owasp: ['LLM02', 'T2'], severity: 'critical', fallback: 'block' },
  { id: 'PR-002', title: 'remote code piped into an interpreter', owasp: ['T11', 'LLM06'], severity: 'critical', fallback: 'block' },
  { id: 'PR-003', title: 'persistence or self-modification', owasp: ['T3', 'T11', 'LLM06'], severity: 'high', fallback: 'block' },
  { id: 'PR-004', title: 'credential store read, then egress', owasp: ['LLM02', 'T3'], severity: 'high', fallback: 'notify' },
  { id: 'PR-005', title: 'risky action in a tainted turn', owasp: ['LLM01', 'T6'], severity: 'high', fallback: 'notify' },
  { id: 'PR-006', title: 'destructive operation', owasp: ['LLM06', 'T2'], severity: 'critical', fallback: 'block' },
  { id: 'PR-007', title: 'unbounded consumption', owasp: ['LLM10', 'T4'], severity: 'medium', fallback: 'notify' },
  { id: 'PR-008', title: 'unseen host carrying a body', owasp: ['LLM02'], severity: 'medium', fallback: 'notify' },
  { id: 'PR-009', title: 'files outside the known areas', owasp: ['LLM06', 'T3'], severity: 'medium', fallback: 'notify' },
  { id: 'PR-010', title: 'instruction override in an agent message', owasp: ['T12', 'LLM01'], severity: 'high', fallback: 'notify' },
  { id: 'PR-011', title: 'agent spawn that escalates', owasp: ['T13', 'T3'], severity: 'medium', fallback: 'notify' },
  { id: 'PR-012', title: 'unfamiliar dependency source', owasp: ['LLM03'], severity: 'medium', fallback: 'notify' },
  { id: 'PR-013', title: 'system prompt sent to a network sink', owasp: ['LLM07'], severity: 'high', fallback: 'notify' },
]

/** The slash strings, one place: the buttons, the palette and the tests all read these. */
export const slashOf = {
  run: () => 'run',
  replay: () => 'replay',
  mode: (mode: AnatoleMode) => `mode ${mode}`,
  rule: (id: string, mode: RuleMode) => `rule ${id} ${mode}`,
  ack: (id: string) => `ack ${id}`,
  allow: (fp: string) => `allow ${fp}`,
  reset: () => 'reset-baseline',
}

export const INSTALL_LINE = 'Project Anatole is not installed: claude plugin install ruflo-protector@ruflo'
export const UNAUTH = 'reported by the mod, unauthenticated: any process can write these files'

/** Result-panel ids of the two reads; the Security page shows them in its Result block. */
export const ANATOLE_RESULTS = ['anatole-run', 'anatole-replay'] as const
export const isAnatoleResult = (id: string): boolean => (ANATOLE_RESULTS as readonly string[]).includes(id)

const wired = new WeakMap<State, Host>()

/** The host the palette needs to send a slash command; set once with the other actions. */
export const wireAnatole = (state: State, host: Host): void => void wired.set(state, host)

const NOT_WIRED = 'open the console first'

type Make = { label: string; verb: string; note: string; expect: string; declared?: 'write' | 'delete' | 'install'; read?: boolean }

/** A spec that sends `/protector <verb>`. A read runs at once and its answer fills the Result panel; a change asks first and says its effect. */
function slashSpec(state: State, make: Make): ActionSpec | null {
  const host = wired.get(state)

  if (host === undefined) return null

  const id = make.read === true ? `anatole-${make.verb}` : null

  return {
    label: make.label,
    args: [],
    expect: make.expect,
    shows: `/protector ${make.verb}`,
    note: make.note,
    ...(make.declared !== undefined && { declared: make.declared }),
    ...(make.read === true && { isReadOnly: true }),
    run: async () => {
      if (id !== null) state.lab.running = { id, label: make.label, startedAtMs: Date.now() }

      host.invalidate()

      try {
        const answer = await host.runSlash('protector', make.verb)
        const text = typeof answer === 'object' && answer !== null && typeof answer.text === 'string' ? answer.text : ''
        const lines = text === '' ? ['the mod returned no text: its answer is in the conversation; this page reads the files it wrote'] : textLines(text)

        if (id !== null) state.lab.result = { id, label: make.label, ok: true, exitCode: null, note: UNAUTH, lines, atMs: Date.now() }
        else state.outcome = { label: make.label, ok: true, verified: 'n/a', detail: `sent /protector ${make.verb}; the page reads the result from the mod's files`, atMs: Date.now() }
      } catch (error) {
        const why = plain(error instanceof Error ? error.message : String(error), 160) || 'refused'

        if (id !== null) state.lab.result = { id, label: make.label, ok: false, exitCode: null, lines: [`/protector ${make.verb} did not run: ${why}`, 'is the ruflo-protector plugin loaded? /reload-plugins'], atMs: Date.now() }
        else state.outcome = { label: make.label, ok: false, verified: 'n/a', detail: `/protector ${make.verb} did not run: ${why}`, atMs: Date.now() }
      } finally {
        state.lab.running = null
        host.invalidate()
      }
    },
  }
}

const EFFECT = 'Effect: the mod changes only its own settings under .claude-flow/protector-mod/; tool calls are not touched until enforce'

export const runSpec = (state: State): ActionSpec | null => slashSpec(state, { label: 'Anatole run: scan the Claude configuration', verb: slashOf.run(), read: true, expect: 'findings in the Result panel', note: 'Effect: reads the event ring and this project’s Claude configuration; changes nothing' })
export const replaySpec = (state: State): ActionSpec | null => slashSpec(state, { label: 'Anatole replay: what would have fired', verb: slashOf.replay(), read: true, expect: 'alerts that would have fired, in the Result panel', note: 'Effect: re-scores the recorded events against the current rules; changes nothing' })

export function modeSpec(state: State, mode: AnatoleMode): ActionSpec | null {
  const enforce = mode === 'enforce'

  return slashSpec(state, {
    label: enforce ? 'Anatole mode enforce: rules marked block will deny tool calls' : `Anatole mode ${mode}`,
    verb: slashOf.mode(mode),
    expect: `mode ${mode} in status.json`,
    // Enforce changes how Claude behaves for every unattended run: it is the class that always asks Claude's tools too.
    ...(enforce && { declared: 'install' as const }),
    note: enforce ? 'Effect: a tool call that matches a rule set to block is denied; replay first to check for false positives' : EFFECT,
  })
}

export const ruleSpec = (state: State, id: string, mode: RuleMode): ActionSpec | null => (RULE_ID.test(id) ? slashSpec(state, { label: `Anatole rule ${id} ${mode}`, verb: slashOf.rule(id, mode), expect: `${id} ${mode} in rules.json`, note: EFFECT }) : null)
export const ackSpec = (state: State, id: string): ActionSpec | null => (ALERT_ID.test(id) ? slashSpec(state, { label: `Anatole ack ${id}: mark it a false positive`, verb: slashOf.ack(id), expect: 'the alert acked', note: 'Effect: marks the alert a false positive and teaches the baseline; the rule’s acked share rises' }) : null)
export const allowSpec = (state: State, fp: string): ActionSpec | null => (FINGERPRINT.test(fp) ? slashSpec(state, { label: `Anatole allow ${fp}`, verb: slashOf.allow(fp), expect: 'the fingerprint in allow.json', note: 'Effect: this shape no longer raises an alert; a hard rule class is never allowed by it' }) : null)
export const resetSpec = (state: State): ActionSpec | null => slashSpec(state, { label: 'Anatole reset-baseline: forget what is normal', verb: slashOf.reset(), declared: 'delete', expect: 'baseline back to learning', note: 'Effect: deletes the learned baseline; anomaly alerts stop until it matures again' })

/** `PR-002 off` → its parts, or null. */
const ruleArgs = (text: string): [string, RuleMode] | null => {
  const [id, mode, ...rest] = text.trim().split(/\s+/)
  const found = RULE_MODES.find(candidate => candidate === mode)

  return rest.length === 0 && id !== undefined && RULE_ID.test(id) && found !== undefined ? [id, found] : null
}

/** The palette's Anatole entries: `/ruflo run anatole-rule PR-002 off`, so Claude's console tools and the buttons share one path. */
export function anatolePalette(state: State): PaletteEntry[] {
  const g = 'security'
  const alerts: readonly AnatoleAlert[] = state.snapshot?.anatole?.alerts ?? []
  const spec = (id: string, label: string, made: ActionSpec | null, why = NOT_WIRED): PaletteEntry => ({ id, group: g, label, run: { kind: 'spec', spec: made, why } })
  const text = (id: string, label: string, make: (value: string) => ActionSpec | null, why: string): PaletteEntry => ({ id, group: g, label, run: { kind: 'text', keyword: id, make, why: () => why } })

  return [
    spec('anatole-run', 'Project Anatole: run (scan the Claude configuration)', runSpec(state)),
    spec('anatole-replay', 'Project Anatole: replay (what would have fired)', replaySpec(state)),
    text('anatole-mode', 'anatole-mode off|learn|notify|enforce: set the Project Anatole mode (asks first)', value => MODES.find(mode => mode === value.trim()) === undefined ? null : modeSpec(state, value.trim() as AnatoleMode), 'type anatole-mode off, learn, notify or enforce'),
    text('anatole-rule', 'anatole-rule PR-### off|notify|block: set one rule’s mode (asks first)', value => { const parts = ruleArgs(value); return parts === null ? null : ruleSpec(state, parts[0], parts[1]) }, 'type anatole-rule PR-002 off, notify or block'),
    text('anatole-ack', 'anatole-ack <alert id>: mark an alert a false positive (asks first)', value => ackSpec(state, value.trim()), 'type anatole-ack and an alert id'),
    text('anatole-allow', 'anatole-allow <12-hex fingerprint>: allow a shape without an alert (asks first)', value => allowSpec(state, value.trim()), 'type anatole-allow and a 12-character fingerprint'),
    spec('anatole-reset', 'Project Anatole: reset the baseline (asks first; deletes what it learned)', resetSpec(state)),
    // One entry per open alert, so a model can address it by its id exactly (ADR-450 T13).
    ...alerts.filter(alert => alert.state === 'open').slice(0, 20).flatMap(alert => [spec(`anatole-ack-${alert.id}`, `ack alert ${alert.id} (${alert.rule})`, ackSpec(state, alert.id)), ...(alert.fp === null ? [] : [spec(`anatole-allow-${alert.fp}`, `allow fingerprint ${alert.fp} (${alert.rule})`, allowSpec(state, alert.fp))])]),
  ]
}
