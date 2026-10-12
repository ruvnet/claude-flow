/**
 * Missions that Claude knows about (ADR-443): the glue between Mission Control and four pure modules. The context section Claude reads
 * every turn (mission-context.ts), gate evidence (mission-verify.ts), the loop manager (mission-loop.ts) and the mission's spend
 * (data/mission-cost.ts, mission-guard.ts). Nothing here reaches the network or runs anything unasked: a gate run and a loop hand-off
 * both go through the confirm row, and the loop is only ever prepared in the prompt box (Claude owns the schedule).
 */
import type { ActionSpec } from './actions'
import type { Host } from './host'
import { activeMission, derive, mcOf, nextTask, record, saveLedger } from './mission-control'
import { CONTEXT_SECTION_ID, contextEnabled, missionContextKey, missionContextText, turnNote, type TurnReason } from './mission-context'
import { armed, isTick, parseLoop, rearmCommand, startCommand, stop, stopRequest, tick, tickPlan, type LoopState } from './mission-loop'
import { adrBlockFor, attachedOf, scopeCheck } from './adr-mission'
import { evidenceEvent, parseGates } from './mission-verify'
import { costOf, capOf } from './mission-guard'
import { checkpoint, checkpointDone, offerConsult, wireAdvisor } from './mission-advisor-live'
import { plain } from './data/parse'
import { nudgeFor } from './grounding'
import { modelLine } from './model-tools'
import type { LedgerTask, MissionActions, MissionRecord } from './mission-types'
import type { Runner } from './runner'
import { settingsOf } from './settings'
import type { State } from './state'

/** The mission's loop as it was saved (validated; a bad value is no loop). */
export const loopOf = (mission: MissionRecord): LoopState | null => parseLoop(mission.loop)

const setLoop = (mission: MissionRecord, loop: LoopState): void => void (mission.loop = loop)

/** The task Claude is on, else the next ready one: what the context section describes. */
function currentTask(state: State, mission: MissionRecord): { task: LedgerTask | null; status: ReturnType<typeof derive> extends Map<string, infer S> ? S : never } {
  const tasks = state.snapshot?.tasks ?? []
  const statuses = derive(mission, tasks)
  const task = mission.tasks.find(candidate => statuses.get(candidate.id) === 'running') ?? nextTask(mission, tasks)

  return { task, status: task === null ? 'ready' : (statuses.get(task.id) ?? 'ready') }
}

let held: { key: string; text: string } | null = null

/**
 * The section `prompt.compose` adds, or null (no mission, a finished one, or the setting off). The text is rebuilt only when its key
 * changes, and the key changes only with the task: a changed system prompt makes Claude re-read the whole conversation.
 */
export function contextSection(state: State): { id: string; text: string; scope: 'session' } | null {
  const mission = activeMission(state)

  if (mission === null || !contextEnabled(settingsOf(state).ai.missionContext)) return null

  const statuses = derive(mission, state.snapshot?.tasks ?? [])

  if (mission.tasks.length > 0 && mission.tasks.every(task => statuses.get(task.id) === 'done')) return null

  const { task, status } = currentTask(state, mission)
  const loop = loopOf(mission)
  const info = loop === null || loop.status === 'idle' ? null : { interval: loop.interval, status: loop.status }
  const adrBlock = adrBlockFor(state, mission)
  const nudge = nudgeFor(state, [mission.objective, task?.title ?? '', task?.requirement ?? '', adrBlock], modelLine) ?? ''
  const key = missionContextKey(mission, task, info, status, adrBlock, nudge)

  if (held?.key !== key) held = { key, text: missionContextText(mission, task, info, status, adrBlock, nudge) }

  return { id: CONTEXT_SECTION_ID, text: held.text, scope: 'session' }
}

/** A turn ended: note it on the running task (never that the task finished: the task store says that). */
export function onTurnComplete(state: State, host: Host, reason: TurnReason): void {
  const mission = activeMission(state)

  if (mission === null) return

  // ADR-483: with every task done, the pre-done consult is offered once. A no-op with the setting off.
  const offer = (): void => {
    try {
      checkpointDone(state, host)
    } catch {
      // An offer that could not be made never changes the turn.
    }
  }
  const running = mission.tasks.find(task => derive(mission, state.snapshot?.tasks ?? []).get(task.id) === 'running') ?? null
  const note = turnNote(reason, running)

  if (note === null) return offer()

  record(mission, note)
  saveLedger(state, host)
  offer()
}

/** A prompt was submitted: when it carries a mission's loop marker it is that loop's tick (or its first run). */
export function onPromptSubmit(state: State, host: Host, text: string): void {
  const now = Date.now()

  for (const mission of mcOf(state).missions.values()) {
    if (!isTick(text, mission.id)) continue

    const prefs = settingsOf(state).ai
    const before = loopOf(mission)
    const loop = before !== null && before.status === 'armed' ? before : armed(before, mission, before?.interval ?? prefs.loopInterval, now)
    const cost = costOf(state, mission)
    const plan = tickPlan({ mission, loop, prefs, gatesConfigured: parseGates(prefs.loopGates).gates.length > 0, spendUsd: cost?.usd ?? null, capUsd: capOf(state), nowMs: now, taskStatus: derive(mission, state.snapshot?.tasks ?? []), advisor: prefs.advisor })

    setLoop(mission, tick(loop, now))
    record(mission, { type: 'loop.tick', note: plain(`${plan.action}: ${plan.reason}`, 200) })
    saveLedger(state, host)
    // ADR-483: a tick that finds a repeated failure stops the line or offers the consult (once); never starts a billed turn by itself.
    if (prefs.advisor) checkpoint(state, host, mission)
    host.invalidate()
  }
}

/** The actions the Loop tab calls: verify with the person's gates, and the loop manager's start, stop and re-arm. */
export function claudeActions(state: State, host: Host, runner: Runner): Pick<MissionActions, 'verify' | 'loop' | 'advisor'> {
  wireAdvisor(state, runner)

  const say = (label: string, ok: boolean, detail: string) => {
    mcOf(state).last = { label, ok, detail }
    host.invalidate()
  }
  const prepare = (label: string, text: string, done: () => void): ActionSpec => ({
    label,
    scope: 'controls',
    args: [],
    shows: `in the prompt box, for you to send: “${plain(text, 160)}”`,
    expect: 'the text in Claude’s prompt box',
    note: 'Claude owns the recurring schedule; the console only prepares the text and watches the ticks. Nothing is scheduled until you press Enter there.',
    run: async () => {
      const isFilled = await host.fillPrompt(text).catch(() => false)

      if (isFilled) done()
      say(label, isFilled, isFilled ? 'prepared in the prompt box: press Enter there' : 'no prompt box to fill here')
    },
  })

  return {
    verify: () => {
      const mission = activeMission(state)
      const gates = parseGates(settingsOf(state).ai.loopGates).gates

      if (mission === null) return say('verify', false, 'no active mission')
      if (gates.length === 0) return say('verify', false, 'no gates configured: add your own commands in Settings → Mission gates')

      const { task } = currentTask(state, mission)
      const taskId = task?.id

      runner.ask(
        {
          label: `run ${gates.length} gate${gates.length === 1 ? '' : 's'}${taskId === undefined ? '' : ` for ${taskId}`}`,
          scope: 'controls',
          args: [],
          shows: gates.map(gate => gate.argv.join(' ')).join('  ·  '),
          expect: 'each gate’s exit code and a short output summary recorded as evidence on the mission',
          note: 'Runs the commands you configured, one after another, without a shell, in this project. Their output is evidence; nothing is changed by the console. With ADRs attached to the mission it then compares the changed files (git status and git log, read-only) with the paths those ADRs name, as a warning in the record.',
          run: async () => {
            let failed = 0

            for (const gate of gates) {
              const result = await host.run(gate.argv, 180_000).catch(() => null)

              record(mission, evidenceEvent(gate, result === null ? { exitCode: null, stdout: '', stderr: '' } : { exitCode: result.exitCode ?? null, stdout: result.stdout, stderr: result.stderr }, taskId))
              if (result === null || result.exitCode !== 0) failed += 1
            }

            // ADR-480: with ADRs attached, the changed files are compared with their scope. A warning in the record; it never changes the gates' result.
            const adrLines = attachedOf(mission).length > 0 ? await scopeCheck(state, host).catch(() => []) : []
            const adrWarnings = adrLines.filter(line => line.startsWith('warning')).length

            saveLedger(state, host)

            const advisorNote = failed === 0 ? null : checkpoint(state, host, mission)

            say('gates', failed === 0, `${failed === 0 ? `all ${gates.length} passed` : `${failed} of ${gates.length} did not pass: see Evidence`}${advisorNote === null ? '' : `; advisor: ${advisorNote}`}${adrLines.length > 0 ? `; ADR scope: ${adrWarnings === 0 ? 'no warning' : `${adrWarnings} warning${adrWarnings === 1 ? '' : 's'} in the record`}` : ''}`)
          },
        },
        'nothing to run',
      )
    },
    advisor: kind => {
      const mission = activeMission(state)

      if (mission === null) return say('advisor', false, 'no active mission')

      const why = offerConsult(state, host, runner, mission, kind, kind === 'stuck' ? 'manual' : '', true)

      if (why !== null) say('advisor', false, why)
    },
    loop: {
      start: () => {
        const mission = activeMission(state)

        if (mission === null) return say('loop', false, 'no active mission')

        const prefs = settingsOf(state).ai
        const interval = loopOf(mission)?.interval ?? prefs.loopInterval

        runner.ask(prepare('start the mission loop', startCommand(mission, prefs, interval), () => record(mission, { type: 'loop.prepared', note: `/loop ${interval}` })), 'no active mission')
      },
      stop: () => {
        const mission = activeMission(state)
        const loop = mission === null ? null : loopOf(mission)

        if (mission === null || loop === null) return say('loop', false, 'no loop to stop')

        runner.ask(prepare('ask Claude to stop the mission loop', stopRequest(loop, mission), () => {
          setLoop(mission, stop(loop))
          record(mission, { type: 'loop.stop-requested' })
          saveLedger(state, host)
        }), 'no loop to stop')
      },
      rearm: () => {
        const mission = activeMission(state)
        const loop = mission === null ? null : loopOf(mission)
        const command = mission === null ? null : rearmCommand(loop, mission, settingsOf(state).ai, Date.now())

        if (mission === null || command === null) return say('loop', false, 'the loop is not stopped, expired or overdue')

        runner.ask(prepare('re-arm the mission loop', command, () => record(mission, { type: 'loop.rearm-prepared' })), 'nothing to re-arm')
      },
    },
  }
}
