import type { RenderElement } from 'claude-code'

import { lifecycleOf, PHASE_NAME, PROFILES, RIGORS, stageOf } from '../goap'
import { guidanceStatus } from '../mission-guidance'
import { activeMission, derive, mcOf, nextTask, progressOf, rufloTaskOf, type Derived, type LedgerTask, type McTab, type MissionRecord } from '../mission-control'
import { ACCENT, chip as inverseChip, TONE } from '../menu-colors'
import { barCells, percentOf, stripStatus } from '../mission-strip'
import { ago, button, clip, col, confirmHere, isBbs, row, rule, section, text, THEME, wrap, type Ctx } from './common'
import { GOALS_PLUGIN, isAvailable, MISSION_SKILLS, slashOf } from '../mission-skills'
import { observationRows } from './missions'
import { loopTabRows } from './mission-claude'
import { capabilityRows, launchRows } from './mission-launch'
import { researchStartRows } from './research-start'
import { fullRows } from './full-rows'

const GLYPH: Record<Derived, string> = { done: '●', running: '◐', ready: '○', waiting: '·', failed: '✖', cancelled: '⊘' }
const COLOR = (status: Derived): string => (status === 'done' ? THEME.ok : status === 'running' ? THEME.warn : status === 'failed' ? THEME.bad : status === 'ready' ? THEME.head : THEME.info)
const TABS: readonly { id: McTab; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'agents', label: 'Agents' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'loop', label: 'Loop' },
  { id: 'record', label: 'Record' },
]

const bar = (done: number, total: number, width = 10): string => (total === 0 ? '▯'.repeat(width) : '▮'.repeat(Math.round((done / total) * width)).padEnd(width, '▯'))

const chip = (ctx: Ctx, key: string, label: string, isOn: boolean, onPress: () => void): RenderElement =>
  ctx.kit.Button({ key, label: ` ${isOn ? '●' : '○'} ${label} `, plain: true, ...(isOn && { variant: 'primary' as const }), onPress })

/** A boxed one-line field: Enter applies it, and the field empties. */
function box(ctx: Ctx, key: string, label: string, placeholder: string, submit: string, onSubmit: (value: string) => void): RenderElement[] {
  const Input = ctx.kit.Input

  return Input === undefined ? [text(ctx, ` ${label}: use the palette (p)`, { dimColor: true })] : [ctx.kit.Box({ key: `${key}-box`, borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [Input({ key, label, placeholder, submitLabel: submit, onSubmit })] })]
}

/** The ruflo-goals skills as mission options: each runs in the main Claude UI on the goal (the unavailable ones say why). */
function skillRows(ctx: Ctx): RenderElement[] {
  const mc = mcOf(ctx.state)
  const rows: RenderElement[] = MISSION_SKILLS.map(skill => {
    const ok = isAvailable(ctx.state, skill)
    const suits = skill.suits.includes(mc.profile)

    return row(
      ctx,
      [
        ctx.kit.Text({ color: suits ? THEME.ok : THEME.info, children: suits ? ' ★ ' : '   ' }),
        ctx.kit.Button({ key: `mc-skill-${skill.id}`, label: `${skill.title} `.padEnd(26, '.'), plain: true, onPress: () => ctx.act.mission.skill(skill.id) }),
        ctx.kit.Button({ key: `mc-skill-about-${skill.id}`, label: clip(` ${skill.about}`, Math.max(10, ctx.columns - 40)), plain: true, dimColor: true, onPress: () => ctx.act.mission.skill(skill.id) }),
        ctx.kit.Button({ key: `mc-skill-run-${skill.id}`, label: ok ? ' ▸ run' : ' ✗ n/a', plain: true, dimColor: !ok, onPress: () => ctx.act.mission.skill(skill.id) }),
      ],
      `mc-skill-row-${skill.id}`,
    )
  })
  const missing = MISSION_SKILLS.filter(skill => !isAvailable(ctx.state, skill)).length

  return section(ctx, 'skills', 'Mission options', `${GOALS_PLUGIN} skills, run in the main Claude UI · ★ suits ${mc.profile}`, [...rows, text(ctx, missing > 0 ? ` ${missing} not offered by this session: install ${GOALS_PLUGIN} (Plugin Catalog), then /reload-plugins` : ` each runs /${GOALS_PLUGIN}:<skill> on the goal now, or prepares it in the prompt box while a turn runs`, { dimColor: true })])
}

function planRows(ctx: Ctx): RenderElement[] {
  const mc = mcOf(ctx.state)
  // The kind and rigor choices fold away: the header names what is chosen, and the plan's own line stays in view below.
  const options = section(
    ctx,
    'options',
    'Plan options',
    `${PROFILES.find(profile => profile.id === mc.profile)?.label ?? mc.profile} · ${mc.rigor}`,
    [
      row(ctx, [text(ctx, ' kind '), ...PROFILES.map(profile => chip(ctx, `mc-profile-${profile.id}`, profile.label, mc.profile === profile.id, () => ctx.act.mission.profile(profile.id)))], 'mc-profiles'),
      row(ctx, [text(ctx, ' rigor '), ...RIGORS.map(rigor => chip(ctx, `mc-rigor-${rigor}`, rigor, mc.rigor === rigor, () => ctx.act.mission.rigor(rigor)))], 'mc-rigors'),
    ],
    false,
  )
  const rows: RenderElement[] = [
    ...options,
    text(ctx, ` ${PROFILES.find(profile => profile.id === mc.profile)?.about ?? ''}`, { dimColor: true }),
  ]
  const planned = mc.planned

  if (planned === null) {
    rows.push(text(ctx, ' type a goal above: the planner finds the cheapest SPARC action sequence that reaches it', { color: THEME.warn }))

    return rows
  }

  rows.push(...guidanceRows(ctx))
  rows.push(rule(ctx, 'SPARC plan', `${planned.steps.length} tasks · cost ${planned.totalCost} · critical path ${planned.criticalCost} · ${planned.waves.length} waves`))

  rows.push(text(ctx, ` ${lifecycleOf(planned).map(entry => `${entry.stage}${entry.steps > 1 ? ` ×${entry.steps}` : ''}`).join(' → ')}`, { color: THEME.ok, bold: true }))

  for (const [i, wave] of planned.waves.entries()) {
    rows.push(text(ctx, ` wave ${i + 1}${wave.length > 1 ? ` · ${wave.length} in parallel` : ''}`, { bold: true, color: THEME.head }))

    for (const id of wave) {
      const step = planned.steps.find(candidate => candidate.id === id)

      if (step !== undefined) rows.push(text(ctx, `   ${step.id} [${stageOf(step.action)}] ${step.action.title}${step.dependsOn.length > 0 ? `  · after ${step.dependsOn.join(', ')}` : ''}  · ${step.action.agent}`))
    }
  }

  rows.push(...skillRows(ctx))
  rows.push(...capabilityRows(ctx))
  rows.push(...section(ctx, 'acceptance', 'Acceptance', `${planned.goal.length} criteria`, planned.goal.map(fact => text(ctx, `   ◇ ${fact}`, { dimColor: true })), false))

  return rows
}

/** Claude's guidance on the goal: asked for after a goal is entered; the answer streams into a section that collapses. */
function guidanceRows(ctx: Ctx): RenderElement[] {
  const guidance = mcOf(ctx.state).guidance
  const m = ctx.act.mission

  if (guidance === null) return []

  const control = guidance.stop === null ? button(ctx, 'mc-guidance-again', '↻ ask again', () => m.askGuidance()) : button(ctx, 'mc-guidance-stop', '■ stop', () => guidance.stop?.())
  const body = guidance.lines.length === 0 ? [text(ctx, '  waiting for the first words…', { dimColor: true })] : guidance.lines.map(line => text(ctx, `  ${line}`))

  // The header says what the run is doing: its spinner, the seconds it has run, and thinking or writing with a word count.
  return section(ctx, 'guidance', '✦ Claude guidance', guidanceStatus(guidance, ctx.nowMs), [...body, row(ctx, [control], 'mc-guidance-ctl')], true)
}

function taskRow(ctx: Ctx, mission: MissionRecord, task: LedgerTask, status: Derived, isNext: boolean): RenderElement {
  const press = () => ctx.act.mission.tab('evidence')

  return row(
    ctx,
    [
      ctx.kit.Text({ bold: true, color: COLOR(status), children: ` ${GLYPH[status]} ` }),
      ctx.kit.Button({ key: `mc-task-${task.id}`, label: `${task.id} [${task.stage ?? task.phase}] ${clip(task.title, 44)}`.padEnd(54), plain: true, onPress: press }),
      ctx.kit.Text({ dimColor: true, children: `${task.agent}${task.dependsOn.length > 0 ? ` · after ${task.dependsOn.join(',')}` : ''} · ${status}${isNext ? ' · next' : ''}` }),
    ],
    `mc-row-${mission.id}-${task.id}`,
  )
}

function tasksRows(ctx: Ctx, mission: MissionRecord): RenderElement[] {
  const tasks = ctx.state.snapshot?.tasks ?? []
  const status = derive(mission, tasks)
  const next = nextTask(mission, tasks)

  return [text(ctx, ' ● done  ◐ running  ○ ready  · waiting on a dependency  ✖ failed  ⊘ cancelled · status is the ruflo task store’s', { dimColor: true }), ...mission.tasks.map(task => taskRow(ctx, mission, task, status.get(task.id) ?? 'waiting', next?.id === task.id))]
}

function agentsRows(ctx: Ctx, mission: MissionRecord): RenderElement[] {
  const tasks = ctx.state.snapshot?.tasks ?? []
  const status = derive(mission, tasks)
  const agents = ctx.state.snapshot?.agents ?? []
  const roles = [...new Set(mission.tasks.map(task => task.agent))]

  return roles.map(role => {
    const mine = mission.tasks.filter(task => task.agent === role)
    const done = mine.filter(task => status.get(task.id) === 'done').length
    const live = agents.filter(agent => agent.type === role || agent.type.startsWith(role.split('-')[0] ?? role))

    return text(ctx, ` ${role.padEnd(22)} ${done}/${mine.length} tasks done · ${live.length === 0 ? 'no swarm agent of this type (Claude plays the role)' : `${live.length} swarm agent${live.length === 1 ? '' : 's'}: ${live.slice(0, 3).map(agent => `${agent.id.slice(0, 12)} ${agent.status}`).join(', ')}`}`)
  })
}

function evidenceRows(ctx: Ctx, mission: MissionRecord): RenderElement[] {
  const tasks = ctx.state.snapshot?.tasks ?? []
  const status = derive(mission, tasks)
  const rows: RenderElement[] = []
  const finished = mission.tasks.filter(task => status.get(task.id) === 'done')

  if (finished.length === 0) rows.push(text(ctx, ' no task is complete yet: what Claude records with task_complete appears here', { dimColor: true }))

  for (const task of finished) {
    const record = rufloTaskOf(tasks, task)

    rows.push(text(ctx, ` ● ${task.id} ${clip(task.title, 50)}  · ${record?.completedAtMs !== undefined ? `done ${ago(record.completedAtMs, ctx.nowMs)}` : 'done'} · ref task:${task.rufloTaskId ?? '?'}`, { color: THEME.ok }))
    rows.push(text(ctx, `     ${record?.resultText ?? 'no result text recorded'}`, { dimColor: record?.resultText === undefined }))
  }

  rows.push(...section(ctx, 'criteria', 'Acceptance criteria', `${mission.acceptance.length}`, mission.acceptance.map(criterion => text(ctx, `   ◇ ${clip(criterion.check, ctx.columns - 8)}`, { dimColor: true })), false))
  rows.push(text(ctx, ' recorded is not verified: only an independent check closes a criterion', { dimColor: true }))

  return rows
}

function recordRows(ctx: Ctx, mission: MissionRecord): RenderElement[] {
  return [...mission.events.slice(-14).map(event => text(ctx, ` #${String(event.seq).padEnd(3)} ${ago(event.atMs, ctx.nowMs).padEnd(10)} ${event.type.padEnd(18)} ${event.taskId ?? ''} ${event.status ?? ''}${event.evidenceRef !== undefined ? ` ref ${clip(event.evidenceRef, 28)}` : ''}${event.note !== undefined ? ` · ${event.note}` : ''}`, { dimColor: true })), ...observationRows(ctx)]
}

/** The control row: hand out the next task, pause or resume, cancel, auto-run, and the two asks (aside and guide). */
function controlRows(ctx: Ctx, mission: MissionRecord): RenderElement[] {
  const m = ctx.act.mission
  const tasks = ctx.state.snapshot?.tasks ?? []
  const { done, total } = progressOf(mission, tasks)
  const state = mission.cancelled ? 'cancelled' : mission.paused ? 'paused' : done === total ? 'complete' : 'running'
  const rows: RenderElement[] = [
    // The status on one line; the objective under it in full (the ruflo record holds it whole).
    text(ctx, ` ${mission.id} · ${state} · ${bar(done, total)} ${done}/${total}`, { bold: true, color: state === 'complete' ? THEME.ok : state === 'paused' ? THEME.info : state === 'cancelled' ? THEME.bad : THEME.head }),
    ...fullRows(ctx, ' objective: ', mission.objective, { key: 'mc-objective', dimColor: true, maxLines: 12, hint: 'the ruflo mission record holds all of it' }),
    row(
      ctx,
      [
        ctx.kit.Button({ key: 'mc-next', label: ' ▶ Run next task ', variant: 'primary', onPress: () => m.next() }),
        mission.paused ? button(ctx, 'mc-resume', '▶ Resume', () => m.resume()) : button(ctx, 'mc-pause', '⏸ Pause', () => m.pause()),
        button(ctx, 'mc-cancel', '✖ Cancel', () => m.cancel()),
        chip(ctx, 'mc-auto', 'auto-run', mission.auto, () => m.auto(!mission.auto)),
      ],
      'mc-controls',
    ),
    ...box(ctx, 'mc-aside', '? ask aside', 'a question about the current work: /btw answers beside the task, outside the conversation (Enter)', 'ask', value => m.aside(value)),
    ...box(ctx, 'mc-guide', '✎ guide Claude', 'a visible instruction to the Claude session: it asks first (Enter)', 'send', value => m.guide(value)),
    ...(mcOf(ctx.state).lastGuide === '' ? [] : fullRows(ctx, ' last: ', mcOf(ctx.state).lastGuide, { key: 'mc-guide-line', dimColor: true, after: button(ctx, 'mc-edit-guide', '✎ edit', () => ctx.act.editField('mc-guide', mcOf(ctx.state).lastGuide)) })),
    ...confirmHere(ctx, 'guide'),
  ]

  return rows
}

/** The mission's stages on one dim line, wrapped to the width so a narrow pane reads it as lines instead of losing the end. */
const FLOW = 'research → create (ADRs, SOP) → build → test → validate → secure → benchmark → learn'
const flowRows = (ctx: Ctx): RenderElement[] => wrap(FLOW, Math.max(20, ctx.columns - 4)).map((line, i) => text(ctx, `${i === 0 ? ' ' : '   '}${line}`, { dimColor: true }))

/**
 * Mission Control: a goal becomes a SPARC plan found by a goal-oriented planner, the plan a governed mission and a ruflo
 * task per node, and the Claude session does the work one task at a time with its result recorded in the task store
 * (the one authority for status). Tabs: Plan, Tasks, Agents, Evidence, Record. Asks first before anything that writes a
 * mission or starts a Claude turn; ▶ auto-run is the person's opt-in to skip that confirm for the next ready task.
 */
export function missionControlView(ctx: Ctx): RenderElement {
  const mc = mcOf(ctx.state)
  const mission = activeMission(ctx.state)
  const rows: RenderElement[] = [rule(ctx, 'Mission Control', mission === null ? 'goal → SPARC plan → tasks → Claude' : `${mission.id.slice(0, 12)}…`)]

  rows.push(...box(ctx, 'mc-goal', '✎ goal', mc.goal === '' ? 'what should get done? e.g. add a dark mode toggle to settings (Enter plans it)' : 'a planned goal is below — type another goal to re-plan', 'plan', value => ctx.act.mission.goal(value)))

  if (mc.goal !== '') rows.push(...fullRows(ctx, ' goal: ', mc.goal, { key: 'mc-goal-line', bold: true, after: button(ctx, 'mc-edit-goal', '✎ edit', () => ctx.act.editField('mc-goal', mc.goal)) }))
  rows.push(...launchRows(ctx), ...researchStartRows(ctx))

  if (mc.missions.size > 1) rows.push(row(ctx, [...mc.missions.values()].slice(-6).map(candidate => chip(ctx, `mc-pick-${candidate.id}`, candidate.id.slice(4, 10), candidate.id === mc.active, () => ctx.act.mission.select(candidate.id))), 'mc-picker'))

  if (mission !== null) rows.push(...controlRows(ctx, mission))

  if (mc.last !== null) rows.push(...fullRows(ctx, ` ${mc.last.ok ? '✓' : '✗'} `, `${mc.last.label}${mc.last.detail === '' ? '' : ` — ${mc.last.detail}`}`, { key: 'mc-last', color: mc.last.ok ? THEME.ok : THEME.bad, maxLines: 12, hint: 'your text is still in its field' }), ...(mc.last.lines ?? []).slice(0, 8).map(line => text(ctx, `   ${line}`, { dimColor: true })))

  rows.push(row(ctx, TABS.filter(tab => mission !== null || tab.id === 'plan' || tab.id === 'record').map(tab => chip(ctx, `mc-tab-${tab.id}`, tab.label, mc.tab === tab.id, () => ctx.act.mission.tab(tab.id))), 'mc-tabs'))

  const tab = mission === null && mc.tab !== 'record' ? 'plan' : mc.tab

  rows.push(...(mission === null ? (tab === 'record' ? observationRows(ctx) : planRows(ctx)) : tab === 'plan' ? planRows(ctx) : tab === 'tasks' ? tasksRows(ctx, mission) : tab === 'agents' ? agentsRows(ctx, mission) : tab === 'evidence' ? evidenceRows(ctx, mission) : tab === 'loop' ? loopTabRows(ctx, mission) : recordRows(ctx, mission)))

  return col(ctx, rows, 'mission-control')
}

/**
 * The strip as a card in the BBS look: a solid title bar, the goal with a coloured bar and the percentage, a line that says what the
 * mission is doing (it said "nothing ready" for four different things), and the buttons under it. Every key is the one the plain
 * strip had, so a hotkey, a test and a click land where they did.
 */
function stripCard(ctx: Ctx, mission: ReturnType<typeof activeMission>, field: RenderElement[], open: RenderElement): RenderElement {
  const m = ctx.act.mission
  const accent = ACCENT.SWARM as string
  const inner = Math.max(24, ctx.columns - 4)
  const rows: RenderElement[] = [ctx.kit.Box({ key: 'menu-mc-bar', children: [ctx.kit.Text({ ...inverseChip(accent), wrap: 'truncate-end', children: ' ▓▒░ MISSION CONTROL ░▒▓'.padEnd(inner).slice(0, inner) })] })]

  if (mission === null) {
    rows.push(...field, ...flowRows(ctx), row(ctx, [open], 'menu-mission-links'))
  } else {
    const tasks = ctx.state.snapshot?.tasks ?? []
    const { done, total } = progressOf(mission, tasks)
    const states = derive(mission, tasks)
    const running = mission.tasks.find(task => states.get(task.id) === 'running')
    const next = nextTask(mission, tasks)
    const status = stripStatus({ done, total, paused: mission.paused, running: running === undefined ? null : { id: running.id, title: running.title }, next: next === null ? null : { id: next.id, stage: next.stage ?? next.phase, title: next.title } }, Math.max(24, inner - 4))
    const cells = barCells(done, total, Math.min(20, Math.max(8, Math.floor(inner / 4))))

    rows.push(
      ...field,
      row(
        ctx,
        [
          ctx.kit.Text({ bold: true, children: ` ${clip(mission.objective, Math.max(12, inner - cells.filled - cells.empty - 14))}  ` }),
          ctx.kit.Text({ color: TONE.live, children: '▮'.repeat(cells.filled) }),
          ctx.kit.Text({ color: TONE.wait, children: '▯'.repeat(cells.empty) }),
          ctx.kit.Text({ bold: true, children: ` ${done}/${total} ${percentOf(done, total)}%` }),
        ],
        'menu-mission-goal',
      ),
      ctx.kit.Text({ color: TONE[status.tone], bold: status.tone === 'live' || status.tone === 'ready', children: ` ${status.text}` }),
      row(
        ctx,
        [
          ...(next === null ? [] : [ctx.kit.Button({ key: 'menu-mc-next', label: ' ▶ run next ', variant: 'primary' as const, onPress: () => m.next() })]),
          ctx.kit.Button({ key: 'menu-mc-pause', label: mission.paused ? ' ▶ resume ' : ' ⏸ pause ', plain: true, onPress: () => (mission.paused ? m.resume() : m.pause()) }),
          open,
        ],
        'menu-mission-ctl',
      ),
      ...confirmHere(ctx, 'controls'),
    )
  }

  return ctx.kit.Box({ key: 'menu-mission-card', flexDirection: 'column', borderStyle: 'round', borderColor: accent, paddingX: 1, children: rows })
}

/**
 * Mission Control at the top of the main menu: the active mission's progress and what is next, with the buttons to hand the next
 * task to Claude, pause and open it; or, with none, the goal field (Enter plans it, asks Claude for guidance, and opens Missions).
 */
export function missionStrip(ctx: Ctx): RenderElement[] {
  const mission = activeMission(ctx.state)
  const m = ctx.act.mission
  const title = ctx.kit.Text({ bold: true, color: THEME.head, children: '▓▒░ MISSION CONTROL ░▒▓' })
  const open = ctx.kit.Button({ key: 'menu-go-missions-top', label: ' (1) open Missions ', plain: true, onPress: () => ctx.act.view('missions') })

  // The goal field is always here, with or without an active mission: Enter plans the goal and opens Missions.
  const field = box(ctx, 'menu-goal', '✎ goal', mission === null ? 'what do you want done? e.g. add a dark mode toggle to settings' : 'a new goal, planned in place of this one', 'plan', value => {
    ctx.act.view('missions')
    m.goal(value)
  })

  // The BBS look draws the strip as a card; the plain look keeps its lines.
  if (isBbs()) return [stripCard(ctx, mission, field, open)]

  if (mission === null) {
    return [
      row(ctx, [title, open], 'menu-mission-title'),
      ...field,
      ...flowRows(ctx),
      text(ctx, ' '),
    ]
  }

  const tasks = ctx.state.snapshot?.tasks ?? []
  const { done, total } = progressOf(mission, tasks)
  const next = nextTask(mission, tasks)

  return [
    row(ctx, [title, open], 'menu-mission-title'),
    ...field,
    text(ctx, ` ${clip(mission.objective, Math.max(20, ctx.columns - 22))}  ${bar(done, total)} ${done}/${total}${mission.paused ? '  · paused' : ''}`, { bold: true }),
    row(
      ctx,
      [
        text(ctx, next === null ? ' nothing ready' : ` next ${next.id} [${next.stage ?? next.phase}] ${clip(next.title, Math.max(16, ctx.columns - 46))}`, { dimColor: next === null }),
        ...(next === null ? [] : [ctx.kit.Button({ key: 'menu-mc-next', label: ' ▶ run next ', variant: 'primary' as const, onPress: () => m.next() })]),
        ctx.kit.Button({ key: 'menu-mc-pause', label: mission.paused ? ' ▶ resume ' : ' ⏸ pause ', plain: true, onPress: () => (mission.paused ? m.resume() : m.pause()) }),
      ],
      'menu-mission-ctl',
    ),
    ...confirmHere(ctx, 'controls'),
    text(ctx, ' '),
  ]
}
