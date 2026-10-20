/**
 * The Workflows page's guards (ADR-462): two spend ceilings and the person's own alert rules, as plain options and one pure
 * evaluator. A guard only SAYS: it returns alerts for the notice ring and never stops, pauses or messages anything (stopping is the
 * control tab's action, ADR-465, and always the person's own confirmed press).
 *
 * Options (all optional; the defaults leave every guard off):
 *   wfBudgetRunUsd   number, 0 off, else 0.01 to 10000: one run's spend that raises a notice
 *   wfBudgetDayUsd   number, 0 off, else 0.01 to 10000: the spend of the workflow runs started in the last 24 hours
 *   wfAlertRules     text, words separated by spaces or commas: `stuck>20m` `tokens>2M` `dirty`
 */
import type { WfRun } from './workflows'

export type GuardOptions = { wfBudgetRunUsd: number; wfBudgetDayUsd: number; wfAlertRules: string }


const usdOption = (value: unknown): number => {
  const amount = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : Number.NaN

  return Number.isFinite(amount) && amount >= 0.01 && amount <= 10_000 ? amount : 0
}

/** The options as the settings hold them, each one checked: a value that is not a dollar amount from 0.01 to 10000 is off. */
export function guardOptionsOf(raw: unknown): GuardOptions {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  return {
    wfBudgetRunUsd: usdOption(value.wfBudgetRunUsd),
    wfBudgetDayUsd: usdOption(value.wfBudgetDayUsd),
    // Control characters never reach a notice or a cell: the rules are parsed word by word and only a known shape survives.
    wfAlertRules: typeof value.wfAlertRules === 'string' ? value.wfAlertRules.slice(0, 200) : '',
  }
}

/** The guards in force. `null` is off. `problems` names each rule word that was not understood (it is shown, not dropped silently). */
export type GuardRules = { stuckMin: number | null; tokens: number | null; isDirty: boolean; runUsd: number | null; dayUsd: number | null; problems: string[] }

export const NO_RULES: GuardRules = { stuckMin: null, tokens: null, isDirty: false, runUsd: null, dayUsd: null, problems: [] }

const TOKEN_UNIT: Record<string, number> = { '': 1, k: 1e3, m: 1e6, g: 1e9 }

/** `stuck>20m` `stuck>20` (minutes) `tokens>2M` `tokens>500000` `dirty`; the last of a kind wins. */
export function parseGuardRules(options: Partial<GuardOptions>): GuardRules {
  const rules: GuardRules = { ...NO_RULES, problems: [], runUsd: usdOption(options.wfBudgetRunUsd) || null, dayUsd: usdOption(options.wfBudgetDayUsd) || null }

  for (const word of (options.wfAlertRules ?? '').split(/[\s,;]+/).filter(Boolean).slice(0, 12)) {
    const stuck = /^stuck>(\d{1,4})m?$/i.exec(word)
    const tokens = /^tokens>(\d{1,10}(?:\.\d+)?)([kmg]?)$/i.exec(word)

    if (/^dirty$/i.test(word)) rules.isDirty = true
    else if (stuck !== null && Number(stuck[1]) >= 1 && Number(stuck[1]) <= 1440) rules.stuckMin = Number(stuck[1])
    else if (tokens !== null && Number(tokens[1]) * (TOKEN_UNIT[(tokens[2] ?? '').toLowerCase()] ?? 1) >= 1000) rules.tokens = Math.round(Number(tokens[1]) * (TOKEN_UNIT[(tokens[2] ?? '').toLowerCase()] ?? 1))
    else rules.problems.push(`rule "${word.replace(/[^\w>.]/g, '?').slice(0, 20)}" not understood (stuck>20m, tokens>2M, dirty)`)
  }

  return rules
}

/** A running agent's last sign of progress as the console saw it: what it showed, and since when it has shown only that. */
export type Mark = { sig: string; sinceMs: number }

/** 52 bits of FNV-1a over two seeds, in base 36: a notice key is cut to 40 characters downstream, and two 17-character ids joined would not fit. */
const hash = (value: string): string => {
  let a = 0x811c9dc5
  let b = 0x9747b28c

  for (let i = 0; i < value.length; i += 1) {
    a = Math.imul(a ^ value.charCodeAt(i), 0x01000193)
    b = Math.imul(b ^ value.charCodeAt(i), 0x85ebca6b)
  }

  return `${(a >>> 0).toString(36)}${((b >>> 0) % 0x100000).toString(36)}`
}

/** The key of one alert: short and stable, whatever the length of the ids it is about. */
export const alertKey = (kind: 'budget-run' | 'tokens' | 'stuck' | 'dirty', runId: string, agentId?: string): string => `${kind}:${hash(agentId === undefined ? runId : `${runId}/${agentId}`)}`

/** The key of an agent across runs. */
export const agentKey = (runId: string, agentId: string): string => `${runId}/${agentId}`

/**
 * Marks for the running agents of `runs`: an agent whose tokens, tool calls and last tool are unchanged since the last read keeps its
 * mark, a changed one starts a new mark at `nowMs`. The first sight of an agent starts at `nowMs`: the console cannot say how long
 * it was quiet before it looked.
 */
export function trackProgress(prev: ReadonlyMap<string, Mark>, runs: readonly WfRun[], nowMs: number): Map<string, Mark> {
  const next = new Map<string, Mark>()

  for (const run of runs) {
    for (const phase of run.phases) {
      for (const agent of phase.agents) {
        if (agent.state !== 'running') continue

        const key = agentKey(run.id, agent.id)
        const sig = `${agent.tokens ?? ''}|${agent.toolCalls ?? ''}|${agent.lastTool ?? ''}`
        const held = prev.get(key)

        next.set(key, held !== undefined && held.sig === sig ? held : { sig, sinceMs: nowMs })
      }
    }
  }

  return next
}

/** What the guards decide from, beyond the runs. `dirty` is null where no reading was made (the rule is then silent, not false). */
export type GuardInput = {
  runs: readonly WfRun[]
  rules: GuardRules
  marks: ReadonlyMap<string, Mark>
  dirty: ReadonlyMap<string, boolean> | null
  /** Dollars per run id from the cost read, with whether the figure is a floor. A run with no figure is absent. */
  spend: ReadonlyMap<string, { usd: number; isFloor: boolean }>
  nowMs: number
}

export type GuardAlert = { key: string; level: 'warn' | 'bad'; text: string; runId: string }

/** No sign of life for this long and the reader itself shows an agent as stale (data/workflows.ts STALE_MS). */
const STALE_MIN = 15
const DAY_MS = 86_400_000

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const clean = (value: string, max: number): string => value.replace(CONTROL, ' ').slice(0, max)
const usd = (value: number): string => `$${value >= 100 ? Math.round(value) : value.toFixed(2)}`
const tok = (value: number): string => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${Math.round(value / 1e3)}k` : String(value))

/** Every guard that is true now. Pure: the same input gives the same alerts, in run order. Text is for a notice: short, with no control characters. */
export function evaluateGuards(input: GuardInput): GuardAlert[] {
  const { rules, nowMs } = input
  const out: GuardAlert[] = []
  let dayUsd = 0
  let dayFloor = false
  let dayRuns = 0

  for (const run of input.runs) {
    if (run.kind !== 'workflow') continue

    const name = clean(run.name, 30)
    const spend = input.spend.get(run.id)

    if (rules.runUsd !== null && spend !== undefined && spend.usd >= rules.runUsd) {
      out.push({ key: alertKey('budget-run', run.id), level: 'warn', runId: run.id, text: `workflow ${name} spent ${spend.isFloor ? '≥' : ''}${usd(spend.usd)}, over your ${usd(rules.runUsd)} run ceiling (nothing was stopped)` })
    }

    if (spend !== undefined && run.startedMs !== undefined && nowMs - run.startedMs <= DAY_MS) {
      dayUsd += spend.usd
      dayFloor ||= spend.isFloor
      dayRuns += 1
    }

    if (rules.tokens !== null && run.totalTokens !== null && run.totalTokens >= rules.tokens) {
      out.push({ key: alertKey('tokens', run.id), level: 'warn', runId: run.id, text: `workflow ${name} is at ${run.isTokensPartial ? '≥' : ''}${tok(run.totalTokens)} tokens, over your ${tok(rules.tokens)} rule` })
    }

    for (const phase of run.phases) {
      for (const agent of phase.agents) {
        const label = clean(agent.label, 30)
        const mark = input.marks.get(agentKey(run.id, agent.id))

        if (rules.stuckMin !== null) {
          const quietMin = agent.state === 'stale' ? STALE_MIN : agent.state === 'running' && mark !== undefined ? (nowMs - mark.sinceMs) / 60_000 : 0

          if (quietMin >= rules.stuckMin) out.push({ key: alertKey('stuck', run.id, agent.id), level: 'warn', runId: run.id, text: `agent ${label} in ${name}: no progress for ${agent.state === 'stale' ? '15m or more' : `${Math.floor(quietMin)}m`} (rule stuck>${rules.stuckMin}m)` })
        }

        // A finished or failed agent whose worktree still holds uncommitted work: a running agent's is dirty by design.
        if (rules.isDirty && agent.hasWorktree && agent.state !== 'running' && agent.state !== 'queued' && input.dirty?.get(agentKey(run.id, agent.id)) === true) {
          out.push({ key: alertKey('dirty', run.id, agent.id), level: 'warn', runId: run.id, text: `agent ${label} in ${name} ended with an uncommitted worktree` })
        }
      }
    }
  }

  if (rules.dayUsd !== null && dayRuns > 0 && dayUsd >= rules.dayUsd) {
    out.push({ key: 'budget-day', level: 'warn', runId: '', text: `workflow runs of the last 24h spent ${dayFloor ? '≥' : ''}${usd(dayUsd)} over ${dayRuns} run${dayRuns === 1 ? '' : 's'}, over your ${usd(rules.dayUsd)} day ceiling (nothing was stopped)` })
  }

  return out
}

/**
 * Edge trigger: the alerts whose key was not raised before, and the keys now in force (a key that stopped being true is forgotten, so
 * the same trouble raises again if it returns). The notice ring's own 60 second dedupe is a second guard on top of this one.
 */
export function newAlerts(alerts: readonly GuardAlert[], raised: ReadonlySet<string>): { fresh: GuardAlert[]; raised: Set<string> } {
  return { fresh: alerts.filter(alert => !raised.has(alert.key)), raised: new Set(alerts.map(alert => alert.key).slice(0, 200)) }
}
