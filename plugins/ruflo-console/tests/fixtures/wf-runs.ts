/** Finished runs for the replay, compare, export and saved-views specs: built through the real `buildRun` from a run record. */
import { buildRun, type WfRun } from '../../hooks/data/workflows'
import { T0 } from './workflows'

export type RecAgent = { id: string; label: string; phase: string; state?: string; at?: number; tokens?: number; ms?: number; model?: string }

/** `at` and `ms` are seconds from T0; an agent given neither has no start time or span. */
export function runOf(id: string, agents: readonly RecAgent[], over: Record<string, unknown> = {}, name = 'demo-run'): WfRun {
  const record = {
    runId: id,
    status: 'completed',
    workflowName: name,
    startTime: T0,
    durationMs: 90_000,
    phases: [{ title: 'Build' }, { title: 'Review' }],
    workflowProgress: agents.map(a => ({ type: 'workflow_agent', label: a.label, phaseTitle: a.phase, agentId: a.id, state: a.state ?? 'done', ...(a.at !== undefined && { startedAt: T0 + a.at * 1000 }), ...(a.tokens !== undefined && { tokens: a.tokens }), ...(a.ms !== undefined && { durationMs: a.ms * 1000 }), ...(a.model !== undefined && { model: a.model }) })),
    ...over,
  }

  return buildRun({ id, journal: null, agents: new Map(), record: JSON.stringify(record), script: null, nowMs: T0 + 600_000 })
}

/** build:a runs 0-60s, build:b fails at 5s, review:a runs 60-90s. */
export const BASE: readonly RecAgent[] = [
  { id: 'ra1', label: 'build:a', phase: 'Build', at: 0, ms: 60, tokens: 180_000 },
  { id: 'ra2', label: 'build:b', phase: 'Build', state: 'failed', at: 0, ms: 5, tokens: 1200 },
  { id: 'ra3', label: 'review:a', phase: 'Review', at: 60, ms: 30, tokens: 90_000 },
]
