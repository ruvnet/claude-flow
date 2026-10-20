/**
 * What the Events page derives from state the console already holds (ADR-474): workflow runs, the autopilot's steps, Anatole alerts,
 * the band's notices, permission denies and plugin or mod load changes. Each source is a pure function of the previous memo and the
 * current facts; the first call for a source is a baseline and yields nothing (what was already there is not "an event"). The text of
 * every event is washed by the caller before it is drawn or written.
 */
import type { AnatoleAlert } from './anatole'
import type { StepRec } from './ap-loop'
import type { ConsoleEvent, EventKind } from './events'
import type { WfRun } from './workflows'
import { maskLine } from './event-mask'

type Make = (kind: EventKind, text: string, src: string, ref?: string) => ConsoleEvent

const maker = (atMs: number): Make => (kind, text, src, ref) => ({ atMs, kind, text: maskLine(text, 200), src, ...(ref !== undefined && { ref }) })

export type Memo = {
  runs: Map<string, string> | null
  steps: Map<string, string> | null
  phase: string | null
  killed: boolean | null
  parked: Set<string> | null
  alerts: Set<string> | null
  noticeSeq: number | null
  /** The denies seen last pass, as `<atMs>|<tool>|<reason>`: the console keeps only its newest 20, so a count of them cannot say what is new. */
  denied: Set<string> | null
  mods: Map<string, boolean> | null
}

export const newMemo = (): Memo => ({ runs: null, steps: null, phase: null, killed: null, parked: null, alerts: null, noticeSeq: null, denied: null, mods: null })

/** Run started, finished, failed, stuck or empty: from the state of each run between two reads. */
export function runEvents(memo: Memo, runs: readonly WfRun[], atMs: number): ConsoleEvent[] {
  const make = maker(atMs)
  const out: ConsoleEvent[] = []
  const next = new Map(runs.filter(run => run.kind === 'workflow').map(run => [run.id, run.state === 'completed' && run.total === 0 ? 'empty' : run.state]))

  if (memo.runs !== null) {
    for (const run of runs) {
      if (run.kind !== 'workflow') continue

      const was = memo.runs.get(run.id)
      const now = next.get(run.id) as string
      const ref = `run:${run.id}`
      const name = run.name === run.id ? run.id : `${run.name} (${run.id})`

      if (was === now) continue
      if (was === undefined) out.push(make('workflows', `run ${name} ${now === 'running' || now === 'active' ? 'started' : `seen ${now}`}`, 'workflows', ref))
      else if (now === 'failed') out.push(make('workflows', `run ${name} failed (${run.failed} of ${run.total} agents)`, 'workflows', ref))
      else if (now === 'stalled') out.push(make('workflows', `run ${name} is stuck: no progress`, 'workflows', ref))
      else if (now === 'empty') out.push(make('workflows', `run ${name} finished empty: no agents`, 'workflows', ref))
      else if (now === 'completed' || now === 'finished') out.push(make('workflows', `run ${name} finished: ${run.done} of ${run.total} agents done`, 'workflows', ref))
      else out.push(make('workflows', `run ${name}: ${was} → ${now}`, 'workflows', ref))
    }
  }

  memo.runs = next

  return out
}

export type ApFacts = { phase: string; steps: readonly StepRec[]; killed: boolean; parked: readonly { id: string; question: string; answer?: string }[]; reason: string | null }

/** Start, stop, a step handed over, done, failed or parked, and the kill flag. */
export function apEvents(memo: Memo, facts: ApFacts, atMs: number): ConsoleEvent[] {
  const make = maker(atMs)
  const out: ConsoleEvent[] = []
  const steps = new Map(facts.steps.map(step => [step.id, step.status]))
  const parked = new Set(facts.parked.filter(item => item.answer === undefined).map(item => item.id))

  if (memo.steps !== null && memo.parked !== null) {
    if (memo.phase !== facts.phase) {
      if (facts.phase === 'running' && memo.phase !== 'paused') out.push(make('autopilot', 'autopilot started', 'autopilot'))
      else if (facts.phase === 'running') out.push(make('autopilot', 'autopilot resumed', 'autopilot'))
      else if (facts.phase === 'paused') out.push(make('autopilot', `autopilot paused${facts.reason === null ? '' : `: ${facts.reason}`}`, 'autopilot'))
      else if (facts.phase === 'stopped') out.push(make('autopilot', `autopilot stopped${facts.reason === null ? '' : `: ${facts.reason}`}`, 'autopilot'))
    }

    for (const step of facts.steps) {
      const was = memo.steps.get(step.id)
      const ref = `step:${step.id}`

      if (was === step.status) continue
      if (step.status === 'started') out.push(make('autopilot', `step ${step.id} handed over: ${step.task.slice(0, 60)}`, 'autopilot', ref))
      else if (step.status === 'done') out.push(make('autopilot', `step ${step.id} done${step.verified === true ? ' (verified)' : ''}`, 'autopilot', ref))
      else out.push(make('autopilot', `step ${step.id} failed${step.why === undefined ? '' : `: ${step.why.slice(0, 80)}`}`, 'autopilot', ref))
    }

    for (const item of facts.parked) {
      if (parked.has(item.id) && !memo.parked.has(item.id)) out.push(make('autopilot', `step ${item.id} parked: ${item.question.slice(0, 80)}`, 'autopilot', `step:${item.id}`))
    }

    if (memo.killed === false && facts.killed) out.push(make('autopilot', 'kill flag set: the autopilot is blocked', 'autopilot'))
    if (memo.killed === true && !facts.killed) out.push(make('autopilot', 'kill flag cleared', 'autopilot'))
  }

  memo.steps = steps
  memo.parked = parked
  memo.phase = facts.phase
  memo.killed = facts.killed

  return out
}

/** Each Anatole alert not seen before: blocked or notified, with its rule. */
export function anatoleEvents(memo: Memo, alerts: readonly AnatoleAlert[], atMs: number): ConsoleEvent[] {
  const ids = new Set(alerts.map(alert => alert.id))
  const out: ConsoleEvent[] = []

  if (memo.alerts !== null) {
    for (const alert of alerts) {
      if (memo.alerts.has(alert.id)) continue

      out.push({ atMs: alert.atMs ?? atMs, kind: 'anatole', text: maskLine(`Anatole ${alert.action} ${alert.tool}: rule ${alert.rule} (${alert.severity})`, 200), src: 'anatole', ref: `rule:${maskLine(alert.rule, 40)}` })
    }
  }

  memo.alerts = ids

  return out
}

export type NoticeLike = { id: number; level: string; text: string; key: string; atMs: number }

/** Each band notice raised since the last pass. A notice an alert rule raised is not turned back into an event. */
export function noticeEvents(memo: Memo, notices: readonly NoticeLike[], seq: number): ConsoleEvent[] {
  const out: ConsoleEvent[] = []

  if (memo.noticeSeq !== null) {
    for (const notice of notices) {
      if (notice.id <= memo.noticeSeq || notice.key.startsWith('events-rule:')) continue

      out.push({ atMs: notice.atMs, kind: 'notices', text: maskLine(`band: ${notice.text}`, 200), src: 'notices' })
    }
  }

  memo.noticeSeq = seq

  return out
}

/** Permission denies new since the last pass. */
export function denyEvents(memo: Memo, denied: readonly { tool: string; reason: string; atMs: number }[]): ConsoleEvent[] {
  const out: ConsoleEvent[] = []
  const keyOf = (item: { tool: string; reason: string; atMs: number }): string => `${item.atMs}|${item.tool}|${item.reason}`

  if (memo.denied !== null) {
    for (const item of denied) {
      if (!memo.denied.has(keyOf(item))) out.push({ atMs: item.atMs, kind: 'tools', text: maskLine(`permission denied: ${item.tool}${item.reason === '' ? '' : ` (${item.reason})`}`, 200), src: 'permissions' })
    }
  }

  memo.denied = new Set(denied.map(keyOf))

  return out
}

/** A plugin or mod that loaded or was refused since the last pass. */
export function modEvents(memo: Memo, mods: readonly { name: string; isLoaded: boolean; reason?: string }[], atMs: number): ConsoleEvent[] {
  const make = maker(atMs)
  const out: ConsoleEvent[] = []
  const next = new Map(mods.map(mod => [mod.name, mod.isLoaded]))

  if (memo.mods !== null) {
    for (const mod of mods) {
      const was = memo.mods.get(mod.name)

      if (was === mod.isLoaded) continue
      out.push(make('mods', `mod ${mod.name} ${mod.isLoaded ? 'loaded' : `refused${mod.reason === undefined ? '' : `: ${mod.reason.slice(0, 80)}`}`}`, 'mods'))
    }

    for (const name of memo.mods.keys()) if (!next.has(name)) out.push(make('mods', `mod ${name} left the list`, 'mods'))
  }

  memo.mods = next

  return out
}
