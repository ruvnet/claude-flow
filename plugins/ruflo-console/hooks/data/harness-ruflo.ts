/**
 * The `ruflo` worker adapter (ADR-486): what the console already knows without reading a transcript. A mission as the CLI observed it
 * (`.claude-flow/missions/observation.json`, ADR-406) and the agents the swarm and hive stores list. Nothing is read from disk here;
 * a state the observation does not record is not invented. `awaitingAuthorization` is the one state that means "waiting for a yes".
 */
import { no, yes, type Capabilities, type HarnessAdapter, type ScanEnv, type ScanResult, type SessionRow, type SessionStatus } from './harness'
import type { Mission, MissionObservation } from './missions'
import type { AgentRecord } from './parse'
import { shown } from './harness-text'

export const RUFLO_CAPS: Capabilities = {
  discovery: yes('the mission observation and the agent stores the console already reads'),
  preview: yes('state, task and evidence counts; there is no transcript to show'),
  approvals: yes('a mission in awaitingAuthorization is waiting for a yes'),
  resume: no('missions are driven from the Missions page'),
  fork: no('not in phase 1'),
  messaging: no('broadcast and guide stay on the Room and Missions pages, each asking first'),
  stop: no('pause and cancel stay on the Missions page, each asking first'),
}

/** What the console's own mission ledger and claims add to an observed mission, by mission id; each is shown only when it holds something. */
export type LedgerFacts = { adrs?: readonly string[]; tasks: readonly { id: string; dependsOn: readonly string[]; rufloTaskId?: string }[] }
export type RufloInput = { cwd: string; missions: MissionObservation | null; agents: readonly AgentRecord[]; nowMs: number; ledger?: ReadonlyMap<string, LedgerFacts>; claimedIssues?: ReadonlySet<string> }

function contextOf(mission: Mission, input: RufloInput): string[] {
  const lines: string[] = []
  const facts = input.ledger?.get(mission.id)
  const active = mission.plan.tasks.find(task => task.status === 'running' || task.status === 'inProgress' || task.status === 'in_progress')

  if (active !== undefined) lines.push(`task ${shown(active.id, 30)}: ${shown(active.title, 80)}${active.dependsOn.length === 0 ? '' : ` · after ${active.dependsOn.slice(0, 4).map(dep => shown(dep, 20)).join(', ')}`}`)
  if (facts !== undefined) {
    const claimed = facts.tasks.filter(task => input.claimedIssues?.has(task.id) === true || (task.rufloTaskId !== undefined && input.claimedIssues?.has(task.rufloTaskId) === true)).length

    if (claimed > 0) lines.push(`claims: ${claimed} of this mission's tasks are claimed`)
    if ((facts.adrs ?? []).length > 0) lines.push(`ADRs: ${(facts.adrs ?? []).slice(0, 4).map(adr => shown(adr, 50)).join(', ')}`)
  }

  if (mission.evidence.count > 0) lines.push(`verification: ${mission.evidence.verified} of ${mission.evidence.count} evidence verified`)

  return lines
}

const MISSION_STATUS: Record<string, SessionStatus> = { running: 'working', verifying: 'working', queued: 'working', completed: 'done', failed: 'failed' }
const AGENT_BAD = /^(?:failed|error|crashed|dead)$/i
const AGENT_BUSY = /^(?:busy|working|running|active)$/i

const costOf = (mission: Mission): SessionRow['cost'] => {
  const budget = mission.budget

  if (budget === null) return { label: 'unavailable', note: 'the mission records no budget' }
  if (budget.settledMinor !== undefined) return budget.currency === 'USD' ? { label: 'reported', usd: budget.settledMinor / 100 } : { label: 'reported', note: `${budget.currency} ${budget.settledMinor} minor units` }
  if (budget.estimatedMinor !== undefined) return budget.currency === 'USD' ? { label: 'estimated', usd: budget.estimatedMinor / 100 } : { label: 'estimated', note: `${budget.currency} ${budget.estimatedMinor} minor units` }

  return { label: 'unavailable', note: 'the mission records no spend' }
}

export function rufloRows(input: RufloInput): SessionRow[] {
  const home = 'ruflo'
  const rows: SessionRow[] = []

  for (const mission of input.missions?.missions ?? []) {
    const tasks = mission.plan.tasks
    const done = tasks.filter(task => task.status === 'completed' || task.status === 'done').length

    rows.push({
      key: `ruflo:${home}:mission-${mission.id}`,
      harness: 'ruflo',
      home,
      nativeId: `mission-${mission.id}`,
      title: shown(mission.objective, 80) || mission.id,
      status: MISSION_STATUS[mission.state] ?? 'idle',
      cwd: input.cwd,
      folder: 'missions',
      repo: input.cwd,
      worktree: null,
      branch: null,
      mission: mission.id,
      updatedMs: mission.updatedAtMs ?? input.missions?.observedAtMs ?? 0,
      size: 0,
      unassigned: null,
      stale: null,
      external: false,
      cost: costOf(mission),
      signals: { question: false, approval: mission.state === 'awaitingAuthorization', failed: mission.state === 'failed', turnEndedAtMs: mission.state === 'completed' ? (mission.updatedAtMs ?? null) : null },
      context: contextOf(mission, input),
      preview: { latest: `${mission.state}${mission.blockedReason === undefined ? '' : `: ${shown(mission.blockedReason, 120)}`} · ${done} of ${tasks.length} tasks · ${mission.evidence.verified} of ${mission.evidence.count} evidence verified`, tool: null, files: [], test: mission.evidence.count === 0 ? null : `${mission.evidence.verified} of ${mission.evidence.count} verified` },
      noPreview: null,
    })
  }

  for (const agent of input.agents.slice(0, 40)) {
    const name = shown(agent.name ?? agent.id, 40)

    rows.push({
      key: `ruflo:${home}:agent-${agent.id}`,
      harness: 'ruflo',
      home,
      nativeId: `agent-${agent.id}`,
      title: `${name} (${shown(agent.type, 20)})`,
      status: AGENT_BAD.test(agent.status) ? 'failed' : AGENT_BUSY.test(agent.status) ? 'working' : 'idle',
      cwd: input.cwd,
      folder: 'workers',
      repo: input.cwd,
      worktree: null,
      branch: null,
      mission: null,
      updatedMs: agent.createdAtMs ?? 0,
      size: 0,
      unassigned: null,
      stale: null,
      external: false,
      cost: { label: 'unavailable', note: 'the agent store records no spend' },
      signals: { question: false, approval: false, failed: AGENT_BAD.test(agent.status), turnEndedAtMs: null },
      context: [],
      preview: { latest: `${shown(agent.status, 20)}${agent.taskCount === undefined ? '' : ` · ${agent.taskCount} tasks`}`, tool: null, files: [], test: null },
      noPreview: null,
    })
  }

  return rows
}

export function rufloAdapter(input: () => RufloInput): HarnessAdapter {
  return {
    id: 'ruflo',
    label: 'Ruflo workers',
    capabilities: RUFLO_CAPS,
    async scan(_env: ScanEnv): Promise<ScanResult> {
      const rows = rufloRows(input())

      return { state: rows.length === 0 ? 'not-detected' : 'ok', rows, note: rows.length === 0 ? 'no missions or agents recorded' : `${rows.length} missions and workers` }
    },
  }
}
