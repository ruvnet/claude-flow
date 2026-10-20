/** The confirm-gated writes of Mission Control: create the mission and its tasks, hand a task to Claude, cancel. */
import type { ActionSpec } from './actions'
import { plain, type TaskRecord } from './data/parse'
import { resultOf } from './data/mcp-run'
import { taskStatusOf } from './data/automate'
import type { Host } from './host'
import { adrBlockFor } from './adr-mission'
import { EVENT_RESUMED, stoppedByAdvisor } from './mission-advisor'
import { activeMission, instructionOf, mcOf, nextTask, record, rufloTaskOf, saveLedger } from './mission-control'
import type { LedgerTask, MissionRecord, ResumeBy } from './mission-types'
import { argvOf } from './mission-create'
import type { State } from './state'

/** The JSON object the tool answered after its own `Result:` line, or null (a failure prints none: the Parameters line is never read as one). */
export { resultOf } from './data/mcp-run'
export { createSpec, createWhy, RETRY_WAITS_MS } from './mission-create'

/** Mark one task in progress and hand it to the primary session as a visible prompt. One confirm: it starts a model turn. */
/** Tasks handed over in the last seconds: the task store has not refreshed yet, so they still read ready. */
/** How many times auto-run hands one task to Claude before the mission pauses and waits for the person (#3818). */
export const MAX_HANDOUTS = 3

/** True when a tool run's output says it worked: exit 0, and no `"success": false`, error line or `isError` in what it printed. */
const worked = (result: { exitCode: number; stdout: string }): boolean => result.exitCode === 0 && !/"success"\s*:\s*false|"isError"\s*:\s*true|\[ERROR\]/.test(result.stdout)

const inflight = new WeakSet<LedgerTask>()

export const isInflight = (task: LedgerTask): boolean => inflight.has(task)

/** `isReady` replaces the one-at-a-time check for a caller that has its own bound (autopilot's `startable`); without it the mission's own `nextTask` rule applies. */
export function dispatchSpec(state: State, host: Host, mission: MissionRecord, task: LedgerTask, send: (text: string) => Promise<void>, isReady?: (mission: MissionRecord, tasks: readonly TaskRecord[], task: LedgerTask) => boolean): ActionSpec {
  const text = instructionOf(mission, task, adrBlockFor(state, mission))

  return {
    label: `hand task ${task.id} to Claude: ${task.title}`,
    scope: 'controls',
    args: [],
    shows: `task_update ${task.rufloTaskId ?? ''} in_progress, then this prompt to the Claude Code session: “${plain(text, 140)}…”`,
    expect: 'a visible prompt in the transcript; the task in progress',
    note: 'Starts a Claude Code turn on your plan (billed as any turn is); the prompt is visible and Claude records the result with task_complete.',
    run: async () => {
      // The ask stays open for a while: the mission may have moved (paused, cancelled, auto-run took it, a double press).
      if (mission.paused || mission.cancelled || inflight.has(task) || !(isReady === undefined ? nextTask(mission, state.snapshot?.tasks ?? [])?.id === task.id : isReady(mission, state.snapshot?.tasks ?? [], task))) {
        mcOf(state).last = { label: `task ${task.id} not handed over`, ok: false, detail: 'the mission changed since you asked (paused, cancelled, or that task already went)' }
        host.invalidate()

        return
      }

      inflight.add(task)
      host.after(15_000, () => inflight.delete(task))
      // Every attempt counts, so a task whose hand-out keeps failing is not retried without end (auto-run pauses at MAX_HANDOUTS).
      task.handouts = (task.handouts ?? 0) + 1

      // The task store must say in_progress BEFORE the prompt goes: if it did not take, the task is still pending and would be sent again on the next idle.
      const update = await host.run(argvOf(state, 'task_update', { taskId: task.rufloTaskId, status: 'in_progress', progress: 5 }), 60_000).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }))

      if (!worked(update)) {
        inflight.delete(task)
        record(mission, { type: 'task.handout-failed', taskId: task.id, note: `the task store did not take in_progress (attempt ${task.handouts})` })
        saveLedger(state, host)
        mcOf(state).last = { label: `task ${task.id} was not handed over`, ok: false, detail: 'the ruflo task store refused the in_progress update, so no prompt was sent' }
        host.invalidate()

        return
      }

      task.dispatchedAtMs = Date.now()
      record(mission, { type: 'task.dispatched', taskId: task.id, status: 'in_progress', evidenceRef: task.rufloTaskId })
      saveLedger(state, host)

      try {
        await send(text)
      } catch (error) {
        // The prompt did not go: put the task back so the mission does not stall on a task nobody is doing.
        await host.run(argvOf(state, 'task_update', { taskId: task.rufloTaskId, status: 'pending', progress: 0 }), 60_000).catch(() => undefined)
        task.dispatchedAtMs = undefined
        inflight.delete(task)
        mcOf(state).last = { label: `task ${task.id} was not sent`, ok: false, detail: plain(error instanceof Error ? error.message : String(error), 140) }
        host.invalidate()

        return
      }

      mcOf(state).last = { label: `task ${task.id} handed to Claude`, ok: true, detail: 'it is in the transcript now; the pane follows the task store' }
      host.invalidate()
    },
  }
}

/**
 * Pause or resume dispatching, kept in the ledger (a session-bound mission has no durable executor to pause). Only the person's resume re-arms
 * hand-outs: Claude may resume at write:auto without a Yes, so its resume keeps every task's count (and an advisor stop-the-line stays stopped),
 * and a task that used its MAX_HANDOUTS is not handed out again (no new billed turn) until the person resumes it themselves (#3823).
 */
export function setPaused(state: State, host: Host, paused: boolean, by: ResumeBy = 'person'): void {
  const mission = activeMission(state)

  if (mission === null || mission.cancelled) return

  const isPerson = by === 'person'
  const spent = mission.tasks.filter(task => (task.handouts ?? 0) >= MAX_HANDOUTS).length

  mission.paused = paused
  // The person resuming has seen why it stopped: each task gets its hand-outs again.
  if (!paused && isPerson) for (const task of mission.tasks) task.handouts = 0
  record(mission, { type: paused ? 'mission.paused' : 'mission.resumed', status: paused ? 'paused' : 'running', ...(!paused && !isPerson && { note: `resumed by Claude: hand-out counts kept${spent > 0 ? ` (${spent} task${spent === 1 ? '' : 's'} at the limit)` : ''}` }) })
  // ADR-483: the person resuming after an advisor stop-the-line gives the failing check a fresh run of tries. Claude's resume does not, for the
  // same reason it keeps the hand-out counts: the next checkpoint stops the line again (#3823).
  if (!paused && isPerson && stoppedByAdvisor(mission)) record(mission, { type: EVENT_RESUMED })

  const detail = paused ? 'a task already handed to Claude finishes first' : !isPerson && spent > 0 ? `${spent} task${spent === 1 ? '' : 's'} used every hand-out: only your own resume gives them more` : 'Run next hands out the next ready task'

  mcOf(state).last = { label: paused ? 'paused: no more tasks are handed out' : isPerson ? 'resumed' : 'resumed by Claude', ok: true, detail }
  saveLedger(state, host)
  host.invalidate()
}

/** Cancel: cancel every task not done in the ruflo task store, then ask the mission record to cancel (allowed only from some states). */
export function cancelSpec(state: State, host: Host, mission: MissionRecord, tasks: readonly TaskRecord[]): ActionSpec {
  const open = mission.tasks.filter(task => task.rufloTaskId !== undefined && !['completed', 'cancelled'].includes(taskStatusOf(rufloTaskOf(tasks, task)?.status)))

  return {
    label: `cancel mission ${mission.id} (${open.length} open tasks)`,
    scope: 'controls',
    args: [],
    shows: `task_cancel × ${open.length}, then mission_request_action cancel (the record may refuse from its state)`,
    expect: 'every open task cancelled',
    note: 'Cancels this mission’s open tasks in the ruflo task store. A task already finished stays finished.',
    run: async () => {
      for (const task of open) await host.run(argvOf(state, 'task_cancel', { taskId: task.rufloTaskId, reason: 'mission cancelled from the console' }), 60_000)

      const refused = resultOf((await host.run(argvOf(state, 'mission_request_action', { requestId: `console-cancel-${Date.now().toString(36)}`, missionId: mission.id, expectedRevision: 2, action: 'cancel', reason: 'cancelled from the console' }), 60_000)).stdout)

      mission.cancelled = true
      record(mission, { type: 'mission.cancelled', status: 'cancelled', note: refused?.ok === true ? 'record cancelled' : `record: ${plain(String(refused?.message ?? 'not asked'), 100)}` })
      mcOf(state).last = { label: `mission ${mission.id} cancelled`, ok: true, detail: `${open.length} tasks cancelled${refused?.ok === true ? '' : `; the record said: ${plain(String(refused?.message ?? ''), 100)}`}` }
      saveLedger(state, host)
      host.invalidate()
    },
  }
}
