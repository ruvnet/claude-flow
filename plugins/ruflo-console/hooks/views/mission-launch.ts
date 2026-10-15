import type { RenderElement } from 'claude-code'

import { activeMission, derive, mcOf, nextTask, progressOf } from '../mission-control'
import { blocksCreate, blocksGuidance, capabilitiesOf, PLUGIN_NOTES } from '../mission-options'
import { settingsOf } from '../settings'
import { clip, col, confirmHere, row, section, text, THEME, type Ctx } from './common'

type StepState = 'done' | 'next' | 'todo' | 'running' | 'blocked' | 'skip'
type Step = { id: string; label: string; state: StepState; detail: string; action?: { key: string; label: string; run: () => void } }

const GLYPH: Record<StepState, string> = { done: '✔', next: '▶', todo: '○', running: '◐', blocked: '✖', skip: '–' }
const COLOR: Record<StepState, string> = { done: THEME.ok, next: THEME.head, todo: THEME.info, running: THEME.warn, blocked: THEME.bad, skip: THEME.info }

/** The launch to-do list: what has happened to this goal and what is next, in the order a mission goes. */
export function launchSteps(ctx: Ctx): Step[] {
  const { state } = ctx
  const mc = mcOf(state)
  const m = ctx.act.mission
  const mission = activeMission(state)
  const tasks = state.snapshot?.tasks ?? []
  const planned = mc.planned !== null
  const guidance = mc.guidance
  const steps: Step[] = []

  steps.push({ id: 'goal', label: 'Goal entered and planned', state: planned ? 'done' : 'next', detail: planned ? `${mc.planned?.steps.length ?? 0} tasks across ${mc.planned?.waves.length ?? 0} waves` : 'type it in the box above, then Enter' })

  const screen = mc.screen

  steps.push({
    id: 'screen',
    label: 'AIDefence screen',
    state: !mc.isScreenOn ? 'skip' : screen === null ? (planned ? 'running' : 'todo') : blocksGuidance(screen) ? 'blocked' : screen.status === 'unavailable' ? 'skip' : 'done',
    detail: !mc.isScreenOn ? 'off (turn it on below)' : screen === null ? (planned ? 'screening the goal…' : 'screens the goal for injection and PII') : screen.detail,
  })

  const guidanceOff = !settingsOf(state).ai.guidance

  steps.push({
    id: 'guidance',
    label: 'Claude guidance',
    state: guidanceOff ? 'skip' : blocksGuidance(screen) ? 'blocked' : guidance?.status === 'done' ? 'done' : guidance?.status === 'running' ? 'running' : 'todo',
    detail: guidanceOff ? 'off in Settings' : guidance === null ? 'claude -p advises by stage and suggests ruflo capabilities (asks first)' : guidance.status === 'running' ? 'writing…' : guidance.note,
    ...(planned && !guidanceOff && !blocksGuidance(screen) && (screen !== null || !mc.isScreenOn) && guidance?.status !== 'running' ? { action: { key: 'mc-todo-guidance', label: guidance === null ? ' ✦ ask Claude ' : ' ↻ again ', run: () => m.askGuidance() } } : {}),
  })

  steps.push({
    id: 'create',
    label: 'Create the mission and its tasks',
    state: mission !== null ? 'done' : !planned ? 'todo' : blocksCreate(screen) ? 'blocked' : 'todo',
    detail: mission !== null ? mission.id.slice(0, 16) : 'writes the mission record and one ruflo task per plan node; runs no agent',
    ...(mission === null && planned && !blocksCreate(screen) ? { action: { key: 'mc-create', label: ' ✚ create ', run: () => m.create() } } : {}),
  })

  const { done, total } = mission === null ? { done: 0, total: mc.planned?.steps.length ?? 0 } : progressOf(mission, tasks)
  const status = mission === null ? null : derive(mission, tasks)
  const isRunning = mission !== null && [...(status?.values() ?? [])].includes('running')
  const next = mission === null ? null : nextTask(mission, tasks)

  steps.push({
    id: 'run',
    label: 'Hand tasks to Claude',
    state: mission === null ? 'todo' : total > 0 && done >= total ? 'done' : isRunning ? 'running' : 'todo',
    detail: mission === null ? 'after the mission exists' : `${done}/${total} done${mission.paused ? ' · paused' : ''}${next !== null ? ` · next ${next.id} ${clip(next.title, 40)}` : ''}`,
    ...(next !== null ? { action: { key: 'mc-todo-run', label: ' ▶ run next ', run: () => m.next() } } : {}),
  })

  const first = steps.find(step => step.state === 'todo' || step.state === 'next')

  if (first !== undefined) first.state = 'next'

  return steps
}

/**
 * The to-do list under the goal, with the ask each step raised drawn inside it: the person types a goal, and what to do next
 * (screen, guidance, create, run) is right below, each with its button, the next one highlighted.
 */
export function launchRows(ctx: Ctx): RenderElement[] {
  const mc = mcOf(ctx.state)

  if (mc.goal === '') return []

  const steps = launchSteps(ctx)
  const next = steps.find(step => step.state === 'next')
  const lines = steps.map(step =>
    row(
      ctx,
      [
        ctx.kit.Text({ bold: step.state === 'next', color: COLOR[step.state], children: ` ${GLYPH[step.state]} ${step.label.padEnd(32)}` }),
        ctx.kit.Text({ dimColor: step.state !== 'next', wrap: 'truncate-end', children: clip(step.detail, Math.max(16, ctx.columns - 50)) }),
        ...(step.action === undefined ? [] : [ctx.kit.Button({ key: step.action.key, label: step.action.label, ...(step.state === 'next' && { variant: 'primary' as const }), onPress: step.action.run })]),
      ],
      `todo-${step.id}`,
    ),
  )

  return [
    ctx.kit.Box({
      key: 'mc-todo',
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: THEME.ok,
      paddingX: 1,
      children: [
        ctx.kit.Text({ bold: true, color: THEME.head, children: `▓▒░ NEXT STEP${next === undefined ? ' · all done' : `: ${next.label}`} ░▒▓` }),
        ...lines,
        ...confirmHere(ctx, 'goal', true),
        ...confirmHere(ctx, 'controls'),
      ],
    }),
  ]
}

export const launchView = (ctx: Ctx): RenderElement => col(ctx, launchRows(ctx), 'mc-launch')

const noteOf = (plugin: string): string => (PLUGIN_NOTES[plugin] === undefined ? '' : ` — ${PLUGIN_NOTES[plugin]}`)

/** The AIDefence screen toggle and every other ruflo plugin the session offers (ruOS, SPARC, swarm, ...) as options run on the goal. */
export function capabilityRows(ctx: Ctx): RenderElement[] {
  const mc = mcOf(ctx.state)
  const groups = capabilitiesOf(ctx.state)
  const toggle = row(
    ctx,
    [
      ctx.kit.Text({ bold: true, color: THEME.head, children: ' 🛡 AIDefence ' }),
      ctx.kit.Button({ key: 'mc-screen', label: ` ${mc.isScreenOn ? '●' : '○'} screen mission text `, plain: true, ...(mc.isScreenOn && { variant: 'primary' as const }), onPress: () => ctx.act.mission.screen(!mc.isScreenOn) }),
      ctx.kit.Text({ dimColor: true, children: ' the goal and guide text are checked for injection and PII before a model sees them' }),
    ],
    'mc-screen-row',
  )
  const body = groups.flatMap(group => [
    ctx.kit.Text({ bold: true, color: THEME.ok, children: ` ${group.label}${noteOf(group.plugin)}` }),
    ...group.items.map(item =>
      row(
        ctx,
        [
          ctx.kit.Button({ key: `mc-cap-${item.slash}`, label: `   ${clip(item.title, 28)} `.padEnd(34, '.'), plain: true, onPress: () => ctx.act.mission.capability(item.slash) }),
          ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: clip(` /${item.slash}`, Math.max(12, ctx.columns - 50)) }),
          ctx.kit.Button({ key: `mc-cap-run-${item.slash}`, label: ' ▸ run', plain: true, onPress: () => ctx.act.mission.capability(item.slash) }),
        ],
        `mc-cap-row-${item.slash}`,
      ),
    ),
  ])

  return [
    toggle,
    ...section(ctx, 'caps', 'Capabilities', groups.length === 0 ? 'no other ruflo plugin is loaded in this session' : `${groups.length} ruflo plugin${groups.length === 1 ? '' : 's'}: each command runs on the goal in the main Claude UI`, groups.length === 0 ? [text(ctx, ' install ruflo plugins from the Plugin Catalog, then /reload-plugins', { dimColor: true })] : body, false),
  ]
}
