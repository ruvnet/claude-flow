/**
 * Project Anatole's alerts matched to the Workflows page's runs and agents (ADR-463). Pure apart from `readSessionAlerts`.
 *
 * What the mod writes per alert (ADR-453 §8): `{id, at, rule, owasp, severity, action, tool, summary, fp, state, session}`. There is
 * no agent field. The console's own alert parser (data/anatole.ts) drops `session`, so this reads the same file again, through the
 * same bounded regular-file reader and the same per-line validation, and keeps the session. A workflow run's directory names the
 * session that started it, so an alert is matched in steps, and the page says which step matched:
 *
 *   agent    the alert itself names an agent id (the schema has no such field today; read if a later mod version adds one)
 *   window   the alert is from the run's session, inside the run's time span, and exactly one agent was running at that moment
 *   run      the alert is from the run's session and inside the run's time span: some agent of it, or the session itself
 *   none     anything else: no session, a session no run read here has, or a time outside every run of that session
 *
 * Everything is what the mod REPORTED, and any process can write those files: the page labels it unauthenticated.
 */
import { ALERTS_MAX_BYTES, ALERTS_TAIL, ANATOLE_DIR, parseAlertLine, type AnatoleAlert, type RuleMode } from './anatole'
import { readBounded, under, type ReadCache, type ReaderFs } from './files'
import { jsonObject } from './parse'
import type { WfAgent, WfRun } from './workflows'

export type SessionAlert = AnatoleAlert & { session: string | null; agentId: string | null }

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/

/** The alerts of the log's last ALERTS_TAIL lines with their session; a line that fails the console's own validation is counted in `bad`. */
export function parseSessionAlerts(text: string | null): { alerts: SessionAlert[]; bad: number } {
  if (text === null) return { alerts: [], bad: 0 }

  const lines = text.split('\n').filter(line => line.trim() !== '').slice(-ALERTS_TAIL)
  const alerts: SessionAlert[] = []

  for (const line of lines) {
    const base = parseAlertLine(line)

    if (base === null) continue

    const value = jsonObject(line)
    const session = typeof value?.session === 'string' && TOKEN.test(value.session) ? value.session : null
    const agent = typeof value?.agentId === 'string' ? value.agentId : typeof value?.agent === 'string' ? value.agent : null

    alerts.push({ ...base, session, agentId: agent !== null && TOKEN.test(agent) ? agent : null })
  }

  return { alerts, bad: lines.length - alerts.length }
}

/** Reads the alert log with its sessions; never rejects. A missing log is an empty list, a refused one says why in `refused`. */
export async function readSessionAlerts(fs: ReaderFs, cache: ReadCache, cwd: string): Promise<{ alerts: SessionAlert[]; bad: number; refused: string | null }> {
  const read = await readBounded(fs, cache, under(cwd, `${ANATOLE_DIR}/alerts.jsonl`), ALERTS_MAX_BYTES, true)

  if (read.text === null) return { alerts: [], bad: 0, refused: read.reason === 'missing' ? null : read.reason }

  return { ...parseSessionAlerts(read.text), refused: null }
}

/** The session a workflow run belongs to: the directory above `subagents/` in its run directory. Null for a ruflo swarm or an unreadable path. */
export function sessionOf(run: Pick<WfRun, 'dir'>): string | null {
  const parts = (run.dir ?? '').split('/')
  const at = parts.lastIndexOf('subagents')
  const session = at > 0 ? parts[at - 1] : undefined

  return session !== undefined && TOKEN.test(session) ? session : null
}

export type Level = 'agent' | 'window' | 'run' | 'none'

export const LEVEL_WORDS: Record<Level, string> = {
  agent: 'named by the mod',
  window: 'the only agent running then',
  run: 'during this run, agent not told',
  none: 'not attributed',
}

export type Match = { level: Level; runId: string | null; agentId: string | null }

const NONE: Match = { level: 'none', runId: null, agentId: null }

/** When an agent was active: from its start for its elapsed time, or until `nowMs` while it runs. Null when its start is not known. */
function spanOf(agent: WfAgent, nowMs: number): [number, number] | null {
  if (agent.startedMs === undefined) return null

  return [agent.startedMs, agent.state === 'running' ? nowMs : agent.startedMs + (agent.elapsedMs ?? 0)]
}

function runSpan(run: WfRun, nowMs: number): [number, number] | null {
  if (run.startedMs === undefined) return null

  return [run.startedMs, run.durationMs !== undefined ? run.startedMs + run.durationMs : run.running > 0 ? nowMs : run.startedMs]
}

/** The agents of a run whose active span holds `atMs`. */
const activeAt = (run: WfRun, atMs: number, nowMs: number): WfAgent[] => run.phases.flatMap(phase => phase.agents).filter(agent => {
  const span = spanOf(agent, nowMs)

  return span !== null && atMs >= span[0] && atMs <= span[1]
})

/** Matches one alert against the runs read, as far as the files allow. A run with no known start or span never matches: a guess would read as fact. */
export function matchAlert(alert: SessionAlert, runs: readonly WfRun[], nowMs: number): Match {
  if (alert.session === null || alert.atMs === null) return NONE

  const at = alert.atMs
  const candidates = runs.filter(run => run.kind === 'workflow' && sessionOf(run) === alert.session)
  const run = candidates.find(entry => {
    const span = runSpan(entry, nowMs)

    return span !== null && at >= span[0] && at <= span[1]
  })

  if (run === undefined) return NONE

  const named = alert.agentId === null ? undefined : run.phases.flatMap(phase => phase.agents).find(agent => agent.id === alert.agentId)

  if (named !== undefined) return { level: 'agent', runId: run.id, agentId: named.id }

  const active = activeAt(run, at, nowMs)

  return active.length === 1 ? { level: 'window', runId: run.id, agentId: (active[0] as WfAgent).id } : { level: 'run', runId: run.id, agentId: null }
}

export type RuleCount = { id: string; count: number; mode: RuleMode | null }
export type Verdicts = { blocked: number; notified: number; open: number; rules: RuleCount[]; alerts: SessionAlert[] }

const emptyVerdicts = (): Verdicts => ({ blocked: 0, notified: 0, open: 0, rules: [], alerts: [] })

/** `modeOf` answers a rule's mode now (the person's override, else the shipped default), or null when unknown. */
function add(into: Verdicts, alert: SessionAlert, modeOf: (rule: string) => RuleMode | null): void {
  if (alert.action === 'blocked') into.blocked += 1
  else into.notified += 1
  if (alert.state === 'open') into.open += 1

  const held = into.rules.find(entry => entry.id === alert.rule)

  if (held === undefined) into.rules.push({ id: alert.rule, count: 1, mode: modeOf(alert.rule) })
  else held.count += 1

  into.alerts.push(alert)
}

export type RunProtector = {
  runId: string
  session: string | null
  /** Per agent id, only agents with at least one alert matched at `agent` or `window` level. */
  byAgent: Map<string, Verdicts & { level: 'agent' | 'window' }>
  /** Alerts inside the run's span from its session where no one agent can be named. */
  unnamed: Verdicts
  /** Alerts in the tail that no run read here accounts for. */
  notAttributed: number
  total: number
}

/** The protector's record for one run: what each agent was matched to, what was only the run's, and what is nobody's. */
export function protectorFor(run: WfRun, alerts: readonly SessionAlert[], runs: readonly WfRun[], modeOf: (rule: string) => RuleMode | null, nowMs: number): RunProtector {
  const out: RunProtector = { runId: run.id, session: sessionOf(run), byAgent: new Map(), unnamed: emptyVerdicts(), notAttributed: 0, total: alerts.length }

  for (const alert of alerts) {
    const match = matchAlert(alert, runs, nowMs)

    if (match.level === 'none') out.notAttributed += 1
    if (match.runId !== run.id) continue

    if (match.agentId !== null && (match.level === 'agent' || match.level === 'window')) {
      const held = out.byAgent.get(match.agentId) ?? { ...emptyVerdicts(), level: match.level }

      // One alert named by the mod outranks a window match: the entry says the strongest level it holds.
      if (match.level === 'agent') held.level = 'agent'
      add(held, alert, modeOf)
      out.byAgent.set(match.agentId, held)
    } else add(out.unnamed, alert, modeOf)
  }

  return out
}
