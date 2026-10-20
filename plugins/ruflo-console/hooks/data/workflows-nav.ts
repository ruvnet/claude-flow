/**
 * Where the cursor is in the workflows view, and how a key moves it (ADR-458). Pure, so the keys are tested without a
 * screen: j/k move within the focused column, h/l switch column, Enter inspects the row, [ and ] switch run.
 */
import { isLiveRun, rufloRuns } from './wf-swarm'
import { currentPhase, type WfAgent, type WfPhase, type WfRun } from './workflows'
import type { AgentRecord, SwarmInfo } from './parse'

export type WfColumn = 'phases' | 'agents'
export type WfUi = { run: number; phase: number; agent: number; column: WfColumn; isInspecting: boolean }
export type WfKey = 'j' | 'k' | 'h' | 'l' | 'enter' | 'escape' | '[' | ']'

export const newWfUi = (): WfUi => ({ run: 0, phase: 0, agent: 0, column: 'phases', isInspecting: false })

/** Workflow runs and the ruflo swarm in one list: whatever is running first, the rest as they come (newest first). */
export function allRuns(workflows: readonly WfRun[], swarm: SwarmInfo | null, agents: readonly AgentRecord[], nowMs: number): WfRun[] {
  const runs = [...workflows, ...rufloRuns(swarm, agents, nowMs)]

  // A swarm is live by its record's state (data/swarm-status.ts): a stale "running" record ranks with the finished runs.
  return [...runs.filter(isLiveRun), ...runs.filter(run => !isLiveRun(run))]
}

const clamp = (value: number, size: number): number => (size <= 0 ? 0 : Math.max(0, Math.min(size - 1, value)))

/** The run, phase and agent the cursor is on, each null where the list is empty; indexes that fell off a shorter list are pulled back. */
export function pick(ui: WfUi, runs: readonly WfRun[]): { run: WfRun | null; phase: WfPhase | null; agent: WfAgent | null; ui: WfUi } {
  const run = runs[clamp(ui.run, runs.length)] ?? null
  const phase = run?.phases[clamp(ui.phase, run.phases.length)] ?? null
  const agent = phase?.agents[clamp(ui.agent, phase.agents.length)] ?? null

  return { run, phase, agent, ui: { ...ui, run: clamp(ui.run, runs.length), phase: clamp(ui.phase, run?.phases.length ?? 0), agent: clamp(ui.agent, phase?.agents.length ?? 0) } }
}

/** A run's first view: the cursor starts on the phase the run is in. */
export const startOn = (ui: WfUi, run: WfRun | null): WfUi => ({ ...ui, phase: run === null ? 0 : (currentPhase(run.phases) ?? 0), agent: 0, isInspecting: false })

export function walk(ui: WfUi, runs: readonly WfRun[], key: WfKey): WfUi {
  const here = pick(ui, runs)
  const at = here.ui

  switch (key) {
    case 'h':
      return { ...at, column: 'phases' }
    case 'l':
      return here.phase !== null && here.phase.agents.length > 0 ? { ...at, column: 'agents' } : at
    case 'j':
    case 'k': {
      const by = key === 'j' ? 1 : -1

      return at.column === 'phases' ? { ...at, phase: clamp(at.phase + by, here.run?.phases.length ?? 0), agent: 0 } : { ...at, agent: clamp(at.agent + by, here.phase?.agents.length ?? 0) }
    }
    case 'enter':
      return at.isInspecting ? { ...at, isInspecting: false } : here.agent === null ? at : { ...at, isInspecting: true, column: 'agents' }
    case 'escape':
      return { ...at, isInspecting: false }
    case '[':
    case ']': {
      const run = clamp(at.run + (key === ']' ? 1 : -1), runs.length)

      return run === at.run ? at : startOn({ ...at, run, column: 'phases' }, runs[run] ?? null)
    }
  }
}
