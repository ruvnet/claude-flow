/** Mission Control as text for the transcript: the plan, the status, and what a headless `/ruflo run mission-…` answers. */
import { gatesOf, isWriter, lifecycleOf, loopCommand, type LoopPrefs, type Plan, stageOf } from './goap'
import { activeMission, derive, mcOf, nextTask, progressOf } from './mission-control'
import { settingsOf } from './settings'
import type { State } from './state'

type PlanStep = Plan['steps'][number]

/**
 * How the mission runs as a loop (ADR-441), as lines: the command, the per-tick checklist, the gates, the finish condition, the
 * defaults taken up front (so nothing is asked mid-loop) and the stop rule. What may leave the branch follows the settings, only.
 */
export function loopLines(p: Plan, goal: string, prefs: LoopPrefs): string[] {
  const commit = prefs.loopCommit ? 'commit to the mission branch only' : 'make no commits: leave changes in the worktree for review'
  const push = prefs.loopPush ? 'the mission branch may be pushed to its remote' : 'do not push'
  const publish = prefs.loopPublish ? 'releases or packages the mission names may be published' : 'do not publish, release or deploy'
  const writers = `${prefs.loopWorktrees ? 'each writer in its own git worktree' : 'writers share the checkout, one at a time'}; at most ${prefs.loopWriters} concurrent writers on disjoint files`

  return [
    `LOOP: ${loopCommand(goal, prefs)}  (every ${prefs.loopInterval}, bounded: it ends at the finish condition or the stop rule)`,
    'each tick: 1 check progress against the plan; 2 fix what failed; 3 run the gates; 4 repeat until every phase is complete and green',
    `gates: ${gatesOf(p).join(', ')}; a gate counts only when its real output was read, and a fix is mutation-checked (break it once, see the test fail, restore)`,
    'finish when: every phase’s acceptance checks pass and every gate is green on the same clean commit; then stop the loop and report',
    `defaults taken, not asked: ${prefs.loopInterval} interval; ${writers}; ${commit}; ${push}; ${publish}`,
    'stop and ask only when: a gate fails the same way three ticks running, an acceptance check cannot be met within the scope, or an action would leave the branch without its setting',
  ]
}

/** What a step must show, and who may write while it runs: a writer owns its files alone; readers only read. */
function stepNotes(step: PlanStep, waveWriters: number, prefs: LoopPrefs): string[] {
  const notes = [`    accept: ${step.action.requirement}`]

  if (!isWriter(step.action)) return [...notes, '    read-only']

  return [...notes, `    owns: ${waveWriters > 1 ? 'its own files, disjoint from the other writers in this wave' : 'the files it changes'}${prefs.loopWorktrees ? ', in its own worktree' : ''}`]
}

/** The plan as text for the transcript (`/ruflo plan <goal>`): phases, waves, what each step must show, and (given the loop settings) how the loop runs it. */
export function planText(p: Plan, goal: string, loop?: LoopPrefs): string {
  const lines = [`SPARC plan (${p.profile}, ${p.rigor}) for: ${goal}`, `${p.steps.length} tasks · cost ${p.totalCost} · critical path ${p.criticalCost} · ${p.waves.length} waves`, `lifecycle: ${lifecycleOf(p).map(entry => entry.stage).join(' → ')}`]

  for (const [i, wave] of p.waves.entries()) {
    const members = wave.map(id => p.steps.find(candidate => candidate.id === id)).filter((step): step is PlanStep => step !== undefined)
    const writers = members.filter(step => isWriter(step.action)).length

    lines.push(`wave ${i + 1}:${loop !== undefined && writers > 1 ? ` (${Math.min(writers, loop.loopWriters)} of ${writers} writers at a time)` : ''}`)

    for (const step of members) {
      lines.push(`  ${step.id} [${stageOf(step.action)}] ${step.action.title}${step.dependsOn.length > 0 ? ` (after ${step.dependsOn.join(', ')})` : ''} — ${step.action.agent}`)
      if (loop !== undefined) lines.push(...stepNotes(step, writers, loop))
    }
  }

  return (loop === undefined ? lines : [...lines, ...loopLines(p, goal, loop)]).join('\n')
}

/** The active mission's state for the transcript: progress, each task's status from the ruflo task store, and what is next. */
export function statusText(state: State): string {
  const mission = activeMission(state)

  if (mission === null) return 'No active mission. /ruflo plan <goal> shows a SPARC plan; the Missions view creates the mission from it.'

  const tasks = state.snapshot?.tasks ?? []
  const status = derive(mission, tasks)
  const { done, total } = progressOf(mission, tasks)
  const next = nextTask(mission, tasks)
  const lines = [`Mission ${mission.id}: ${mission.objective}`, `${mission.cancelled ? 'cancelled' : mission.paused ? 'paused' : done === total ? 'complete' : 'running'} · ${done}/${total} tasks done${mission.auto ? ' · auto-run on' : ''}`]

  for (const task of mission.tasks) lines.push(`  ${task.id} ${status.get(task.id) ?? '?'} — ${task.title} (${task.agent})`)

  lines.push(next === null ? 'next: nothing to hand out now' : `next: ${next.id} ${next.title} (/ruflo run mission-next hands it to Claude)`)

  return lines.join('\n')
}

/** What a headless `/ruflo run mission-<verb>` answers, or null for an id that is not a mission one. */
export function missionAnswer(state: State, paletteId: string | null): string | null {
  if (paletteId === null || !paletteId.startsWith('mission-')) return null

  const mc = mcOf(state)

  if (paletteId === 'mission-goal') return mc.planned === null ? 'type a goal after the id: /ruflo plan <goal>' : planText(mc.planned, mc.goal, settingsOf(state).ai)
  if (paletteId === 'mission-status') return statusText(state)

  return mc.last === null ? null : [`${mc.last.ok ? '✓' : '✗'} ${mc.last.label}${mc.last.detail === '' ? '' : ` — ${mc.last.detail}`}`, ...(mc.last.lines ?? []).map(line => `  ${line}`)].join('\n')
}
