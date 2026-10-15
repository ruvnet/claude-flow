/**
 * ruflo's own agents as runs on the Workflows page (ADR-458): the swarm record as its own run, and the agents it does not list as a separate,
 * plainly named "ruflo agents on disk" run. A swarm is never credited with the agent store (every agent ever spawned, in any swarm).
 */
import { agentLabels, type AgentRecord, type SwarmInfo } from './parse'
import { swarmRunState, swarmStatusOf, uniqueAgents } from './swarm-status'
import { groupPhases, tally, type AgentState, type RunState, type WfAgent, type WfRun } from './workflows'

/**
 * The id of the run that holds the agents no swarm record lists. It is `ruflo-swarm`, the id this same roster had before swarms were split from
 * the store, so a drill or a pin saved on an older console (.claude-flow/console/wf-views.json) still finds it.
 */
export const RUFLO_AGENTS_ID = 'ruflo-swarm'

const RUFLO_STATE = (status: string): AgentState => (/error|fail/i.test(status) ? 'failed' : /busy|active|running/i.test(status) ? 'running' : /stop|terminat|offline/i.test(status) ? 'done' : 'idle')

/**
 * Agents as a run: its phases are the agent types (that is the only grouping the store has), a stopped agent counts as done, an idle one as
 * ready. ruflo records no model, tokens or worktree per agent, so those stay n/a.
 */
function rosterRun(id: string, name: string, records: readonly AgentRecord[], nowMs: number): WfRun {
  // A store that holds an id twice is one agent, not two (the first record wins, as in data/swarm-status.ts).
  const agents = uniqueAgents(records)
  const labels = agentLabels(agents)
  const rows: WfAgent[] = agents.map(agent => ({
    id: agent.id,
    label: labels.get(agent.id) ?? agent.type,
    phase: agent.type,
    state: RUFLO_STATE(agent.status),
    hasWorktree: false,
    ...(agent.createdAtMs !== undefined && { startedMs: agent.createdAtMs, elapsedMs: Math.max(0, nowMs - agent.createdAtMs) }),
    ruflo: agent,
  }))
  const counts = tally(rows)
  const state: RunState = counts.running > 0 ? 'active' : counts.failed > 0 ? 'failed' : 'finished'

  return { id, name, kind: 'ruflo-swarm', state, phases: groupPhases(rows, []), running: counts.running, done: counts.done, failed: counts.failed, idle: counts.idle, total: rows.length, totalTokens: null, isTokensPartial: false, hasRecord: false }
}

/**
 * The swarm record as a run, always (an empty swarm right after `swarm init` included): its own listed agents that the store holds, and the
 * record's status and age (data/swarm-status.ts), so Workflows says what Overview says. With no swarm record, the agents on disk, or null.
 */
export function swarmRun(swarm: SwarmInfo | null, agents: readonly AgentRecord[], nowMs: number): WfRun | null {
  if (swarm === null) return agents.length === 0 ? null : rosterRun(RUFLO_AGENTS_ID, 'ruflo agents on disk', agents, nowMs)

  const status = swarmStatusOf(swarm, nowMs, agents)
  const run = rosterRun(swarm.id, `ruflo swarm · ${swarm.topology}`, status.members, nowMs)

  return { ...run, state: swarmRunState(status) ?? run.state, isStale: status.isStale, listed: status.listed, ...(status.updatedMs !== undefined && { updatedMs: status.updatedMs }) }
}

/** Every ruflo run: the swarm (when there is a record), then the agents on disk that it does not list (when there are any). */
export function rufloRuns(swarm: SwarmInfo | null, agents: readonly AgentRecord[], nowMs: number): WfRun[] {
  const own = swarmRun(swarm, agents, nowMs)

  if (swarm === null) return own === null ? [] : [own]

  const listed = new Set(swarm.agentIds)
  const rest = agents.filter(agent => !listed.has(agent.id))

  return rest.length === 0 || own === null ? (own === null ? [] : [own]) : [own, rosterRun(RUFLO_AGENTS_ID, 'ruflo agents on disk', rest, nowMs)]
}

/** True while a run is live: a swarm run (the one with `listed`) by its record's state (a stale "running" one is stalled, not live), anything else by an agent running. */
export const isLiveRun = (run: WfRun): boolean => (run.kind === 'ruflo-swarm' && run.listed !== undefined ? run.state === 'active' : run.running > 0)
