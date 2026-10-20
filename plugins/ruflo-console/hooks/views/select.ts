import type { AgentRecord, ClaimRecord, TaskRecord } from '../data/parse'
import type { State } from '../state'

const at = <T>(list: readonly T[], index: number): T | null => (list.length === 0 ? null : (list[((index % list.length) + list.length) % list.length] ?? null))

/** Tasks no claim names and ruflo does not mark done, newest first: what "Claim task" can take. */
export const openTasks = (state: State): TaskRecord[] => {
  const claimed = new Set((state.snapshot?.claims ?? []).map(claim => claim.issueId))

  return (state.snapshot?.tasks ?? []).filter(task => !claimed.has(task.id) && !/complete|done|cancel|fail/i.test(task.status)).sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
}

/** What the claims view's buttons act on: indexes wrap, so a re-read that shortens a list never strands them. */
export function selection(state: State): { claim: ClaimRecord | null; agent: AgentRecord | null; task: TaskRecord | null } {
  return {
    claim: at(state.snapshot?.claims ?? [], state.select.claim),
    agent: at(state.snapshot?.agents ?? [], state.select.agent),
    task: at(openTasks(state), state.select.task),
  }
}
