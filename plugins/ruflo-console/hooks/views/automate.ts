import type { RenderElement } from 'claude-code'

import { automateEntries, taskVerbs, workflowVerbs, WORKER_CANCEL_WHY } from '../automate'
import { laneOf, WORKER_ABOUT, WORKER_NAMES, type WorkerName } from '../data/automate'
import type { TaskRecord } from '../data/parse'
import type { LabCost } from '../mh-lab'
import { neuralEntries } from '../neural'
import { slot } from './attention'
import { loopRows } from './loops'
import { ago, button, clip, col, type Ctx, row, rule, tagChip, text, THEME } from './common'
import { frameResult } from './status-card'
import { selection } from './select'

/** Result lines in view at once; j/k scroll the rest. */
const RESULT_ROWS = 12

/** Each cost as a four-cell tag, as the MetaHarness lab draws them. */
export const TAG: Record<LabCost, { text: string; color: () => string }> = {
  read: { text: ' $0 ', color: () => THEME.ok },
  writes: { text: ' wr ', color: () => THEME.info },
  local: { text: 'cpu ', color: () => THEME.warn },
  spends: { text: ' $$ ', color: () => THEME.bad },
}

export type Item = { id: string; label: string; cost: LabCost }

/** A strip of buttons, each after its cost tag: a $0 one runs at once, the rest ask first. */
export function strip(ctx: Ctx, key: string, items: readonly Item[]): RenderElement {
  return row(
    ctx,
    items.flatMap(item => [tagChip(ctx, TAG[item.cost].text, TAG[item.cost].color()), ctx.kit.Button({ key: `run-${item.id}`, label: `▸ ${item.label}`, plain: true, onPress: () => void ctx.act.run(item.id) })]),
    key,
  )
}

/** True when Enter repeats the text the pending ask came from: the field holds the keys, so Enter again confirms. */
export function isAskedAgain(ctx: Ctx, id: string, value: string): boolean {
  const pending = ctx.state.pending
  const again = ctx.state.askedAgain

  // The same entry, the same text, and the very card that text raised (its id): a card with the same words that replaced it is not it.
  return pending !== null && pending.id !== undefined && again !== null && value.trim() !== '' && again.entry === id && again.text === value.trim() && again.card === pending.id
}

/** A typed entry's field: Enter runs a read at once, or asks for a change; Enter again on the same text confirms it. */
export function field(ctx: Ctx, id: string, label: string, placeholder: string, submitLabel = 'ask'): RenderElement {
  if (ctx.kit.Input === undefined) return text(ctx, ` ${label}: this surface has no text field; /ruflo run ${id} <text> does the same`, { dimColor: true })

  return ctx.kit.Input({ key: `in-${id}`, label, placeholder, submitLabel, onSubmit: value => (isAskedAgain(ctx, id, value) ? ctx.act.confirm(ctx.state.pending?.id) : void ctx.act.run(id, value)) })
}

/** The last run whose id has one of `prefixes`: what it was, how it exited, its cost note and a window of its lines. */
export function resultRows(ctx: Ctx, prefixes: readonly string[]): RenderElement[] {
  const { state, nowMs } = ctx
  const mine = (id: string | undefined) => id !== undefined && prefixes.some(prefix => id.startsWith(prefix))
  const result = mine(state.lab.result?.id) ? state.lab.result : null
  const running = mine(state.lab.running?.id) ? state.lab.running : null
  const right = running !== null ? `running ${Math.round((nowMs - running.startedAtMs) / 1000)}s` : result === null ? 'nothing run yet' : `${result.ok ? '✓' : '✗'} exit ${result.exitCode ?? 'n/a'} · ${ago(result.atMs, nowMs)}`
  const rows: RenderElement[] = [rule(ctx, 'Result', right)]

  if (running !== null) rows.push(text(ctx, ` ▸ ${running.label} … ${Math.floor(nowMs / 500) % 2 === 0 ? '█' : ' '}`, { color: THEME.warn }))
  if (result === null) {
    if (running === null) rows.push(text(ctx, ' ▸ press any entry: a $0 read shows here at once; wr, cpu and $$ ask first (y), then show here', { dimColor: true }))

    return [frameResult(ctx, rows, running !== null ? 'run' : 'idle')]
  }

  rows.push(text(ctx, ` ${result.label}`, { bold: true, color: result.ok ? THEME.ok : THEME.bad }))
  if (result.note !== undefined) rows.push(text(ctx, ` ${result.note}`, { color: /money|models/i.test(result.note) ? THEME.bad : THEME.warn }))

  const top = Math.max(0, Math.min(state.select.item, result.lines.length - RESULT_ROWS))

  for (const line of result.lines.slice(top, top + RESULT_ROWS)) rows.push(text(ctx, `   ${line}`))
  if (result.lines.length > RESULT_ROWS) {
    rows.push(row(ctx, [text(ctx, ` lines ${top + 1}-${Math.min(result.lines.length, top + RESULT_ROWS)} of ${result.lines.length} `, { dimColor: true }), button(ctx, 'res-up', 'up', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'res-down', 'down', () => ctx.act.select(1), { hotkey: 'j' })]))
  }

  return slot(ctx, [frameResult(ctx, rows, result.ok ? 'ok' : 'bad')])
}

/** One worker's light: running now (◌), failing (◐), has run (●), or never run here (○). */
function light(ctx: Ctx, name: WorkerName): { glyph: string; color: string; line: string } {
  const record = ctx.state.snapshot?.daemon?.workers.find(worker => worker.name === name)

  if (ctx.state.lab.running?.id === `auto-worker-${name}`) return { glyph: '◌', color: THEME.warn, line: 'dispatching…' }
  if (record === undefined || record.runs === 0) return { glyph: '○', color: THEME.info, line: 'never run here' }
  if (record.failures > 0) return { glyph: '◐', color: THEME.warn, line: `${record.runs} runs · ${record.failures} failed` }

  return { glyph: '●', color: THEME.ok, line: `${record.runs} runs · 0 failed` }
}

/** The twelve workers as cards, four to a row where they fit: light, name, purpose, runs, last run, and ▸ run. */
function workerRows(ctx: Ctx): RenderElement[] {
  const { state, nowMs } = ctx
  const daemon = state.snapshot?.daemon ?? null
  const perRow = ctx.columns >= 100 ? 4 : ctx.columns >= 72 ? 3 : 2
  const width = Math.max(18, Math.floor((ctx.columns - perRow) / perRow))
  const said = daemon === null ? 'no .claude-flow/daemon-state.json: the daemon has never run here' : `${daemon.running ? 'running' : 'stopped'} per daemon-state.json${daemon.savedAtMs !== undefined ? `, written ${ago(daemon.savedAtMs, nowMs)}` : ''}`
  const rows: RenderElement[] = [rule(ctx, 'Workers', `daemon ${daemon?.running === true ? '● on' : '○ off'}`)]

  rows.push(text(ctx, ` daemon: ${said}`, { color: daemon?.running === true ? THEME.ok : THEME.warn }))

  const card = (name: WorkerName) => {
    const lit = light(ctx, name)
    const record = daemon?.workers.find(worker => worker.name === name)

    return ctx.kit.Box({
      flexDirection: 'column',
      width,
      borderStyle: 'single',
      borderColor: lit.color,
      key: `worker-${name}`,
      children: [
        ctx.kit.Text({ bold: true, color: lit.color, wrap: 'truncate-end', children: clip(`${lit.glyph} ${name.toUpperCase()}`, width - 2) }),
        ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(WORKER_ABOUT[name], width - 2) }),
        ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: clip(`${lit.line}${record?.lastRunMs !== undefined ? ` · ${ago(record.lastRunMs, nowMs)}` : ''}`, width - 2) }),
        ctx.kit.Button({ key: `run-auto-worker-${name}`, label: '▸ run', plain: true, onPress: () => void ctx.act.run(`auto-worker-${name}`) }),
      ],
    })
  }

  for (let i = 0; i < WORKER_NAMES.length; i += perRow) rows.push(ctx.kit.Box({ flexDirection: 'row', gap: 1, key: `workers-${i}`, children: WORKER_NAMES.slice(i, i + perRow).map(card) }))

  rows.push(text(ctx, ' ● has run · ◐ has failures · ○ never run here · ▸ run queues it for the daemon (asks first)', { dimColor: true }))
  rows.push(strip(ctx, 'workers-strip', [
    { id: 'auto-daemon-status', label: 'daemon status', cost: 'read' },
    { id: 'auto-workers-list', label: 'list', cost: 'read' },
    { id: 'auto-workers-status', label: 'dispatches', cost: 'read' },
    { id: daemon?.running === true ? 'auto-daemon-stop' : 'auto-daemon-start', label: daemon?.running === true ? 'stop daemon' : 'start daemon', cost: daemon?.running === true ? 'writes' : 'local' },
  ]))
  rows.push(text(ctx, ` cancel: ${WORKER_CANCEL_WHY}`, { dimColor: true }))

  return rows
}

/** One kanban card: the task, its type and agents, and the buttons that move it on. */
function taskCard(ctx: Ctx, task: TaskRecord, width: number): RenderElement {
  const agent = selection(ctx.state).agent

  return ctx.kit.Box({
    flexDirection: 'column',
    key: `task-${task.id}`,
    children: [
      ctx.kit.Text({ bold: true, color: THEME.head, wrap: 'truncate-end', children: clip(`${task.type} · ${task.status}`, width - 2) }),
      ctx.kit.Text({ color: THEME.info, wrap: 'truncate-end', children: clip(task.description || task.id, width - 2) }),
      ...(task.assignedTo.length > 0 ? [ctx.kit.Text({ dimColor: true, wrap: 'truncate-end', children: clip(`→ ${task.assignedTo.join(', ')}`, width - 2) })] : []),
      ctx.kit.Box({
        flexDirection: 'row',
        children: taskVerbs(task.status).map(verb => ctx.kit.Button({ key: `run-auto-task-${verb}-${task.id}`, label: `▸ ${verb === 'assign' ? `→${clip(agent?.name ?? agent?.type ?? 'agent', 10)}` : verb} `, plain: true, dimColor: verb === 'assign' && agent === null, onPress: () => void ctx.act.run(`auto-task-${verb}-${task.id}`) })),
      }),
    ],
  })
}

/** The task board: pending, running and done side by side, from .claude-flow/tasks/store.json as last read. */
function kanbanRows(ctx: Ctx): RenderElement[] {
  const tasks = ctx.state.snapshot?.tasks ?? []
  const agent = selection(ctx.state).agent
  const width = Math.max(16, Math.floor((ctx.columns - 2) / 3))
  const lanes = (['pending', 'running', 'done'] as const).map(lane => ({ lane, tasks: tasks.filter(task => laneOf(task.status) === lane) }))
  const rows: RenderElement[] = [rule(ctx, 'Tasks', `${lanes.map(lane => `${lane.tasks.length} ${lane.lane}`).join(' · ')} · tasks/store.json`)]

  rows.push(row(ctx, [text(ctx, ` assign goes to: ${agent === null ? 'no agent on disk (spawn one in Swarm)' : `${agent.name ?? agent.type} (${agent.status}) `}`, { color: THEME.info }), ...(agent !== null ? [button(ctx, 'task-agent-next', 'next agent', ctx.act.agentNext, { hotkey: 'a' })] : [])], 'task-agent'))
  rows.push(
    ctx.kit.Box({
      flexDirection: 'row',
      gap: 1,
      key: 'kanban',
      children: lanes.map(({ lane, tasks: list }) =>
        ctx.kit.Box({
          flexDirection: 'column',
          width,
          borderStyle: 'single',
          borderColor: lane === 'running' ? THEME.warn : lane === 'done' ? THEME.ok : THEME.info,
          key: `lane-${lane}`,
          children: [
            ctx.kit.Text({ bold: true, color: THEME.head, children: `${lane.toUpperCase()} (${list.length})` }),
            ...(list.length === 0 ? [ctx.kit.Text({ dimColor: true, children: '(none)' })] : list.slice(0, 6).map(task => taskCard(ctx, task, width))),
            ...(list.length > 6 ? [ctx.kit.Text({ dimColor: true, children: `+${list.length - 6} more` })] : []),
          ],
        }),
      ),
    }),
  )
  rows.push(field(ctx, 'auto-task-new', 'new task', 'bugfix: the login loop (a type first is optional; feature by default)'))
  rows.push(strip(ctx, 'tasks-strip', [{ id: 'auto-task-list', label: 'list tasks', cost: 'read' }]))

  return rows
}

const STATUS_COLOR = (status: string): string => (status === 'running' ? THEME.warn : status === 'completed' ? THEME.ok : /fail|cancel/.test(status) ? THEME.bad : THEME.info)

function workflowRows(ctx: Ctx): RenderElement[] {
  const { workflows, templates } = ctx.state.auto
  const rows: RenderElement[] = [rule(ctx, 'Workflows', workflows === null ? 'not listed yet' : `${workflows.length} listed · workflows/store.json`)]

  rows.push(strip(ctx, 'wf-strip', [{ id: 'auto-wf-list', label: 'list', cost: 'read' }, { id: 'auto-wf-templates', label: 'templates', cost: 'read' }]))
  if (workflows === null) rows.push(text(ctx, ' ▸ list reads them (workflow_list): each row then gets status, run ($$), pause, resume, cancel', { dimColor: true }))

  for (const workflow of (workflows ?? []).slice(0, 8)) {
    rows.push(
      row(
        ctx,
        [
          ctx.kit.Text({ bold: true, color: THEME.head, children: clip(` ${workflow.name} `, 28).padEnd(28, '.') }),
          ctx.kit.Text({ color: STATUS_COLOR(workflow.status), children: ` ${workflow.status} · ${workflow.steps} step${workflow.steps === 1 ? '' : 's'} ` }),
          ...workflowVerbs(workflow.status).map(verb => ctx.kit.Button({ key: `run-auto-wf-${verb}-${workflow.id}`, label: ` ▸ ${verb === 'run' ? 'run $$' : verb}`, plain: true, dimColor: verb !== 'run', onPress: () => void ctx.act.run(`auto-wf-${verb}-${workflow.id}`) })),
        ],
        `wf-${workflow.id}`,
      ),
    )
  }

  for (const template of (templates ?? []).slice(0, 6)) {
    rows.push(row(ctx, [text(ctx, ` template ${clip(template.name, 40)} · ${template.steps} steps `, { dimColor: true }), ctx.kit.Button({ key: `run-auto-tpl-new-${template.id}`, label: ' ▸ new', plain: true, onPress: () => void ctx.act.run(`auto-tpl-new-${template.id}`) })], `tpl-${template.id}`))
  }

  rows.push(field(ctx, 'auto-wf-new', 'new workflow', 'the prompt for its one task step, for the agent picked on the board'))
  rows.push(field(ctx, 'auto-wf-validate', 'validate', 'a workflow file in the project, e.g. workflows/build.json', 'check'))

  return rows
}

function autopilotRows(ctx: Ctx): RenderElement[] {
  const status = ctx.state.auto.autopilot
  const rows: RenderElement[] = [rule(ctx, 'Autopilot', status === null ? 'not read yet' : status.isEnabled ? '● enabled' : '○ disabled')]

  rows.push(
    text(ctx, status === null ? ' ▸ status reads .claude-flow/data/autopilot-state.json and the task sources' : ` iteration ${status.iterations}/${status.maxIterations} · timeout ${status.timeoutMinutes} min · tasks ${status.done}/${status.total} (${status.percent}%) · ${status.sources.join(', ')}`, {
      color: status?.isEnabled === true ? THEME.ok : THEME.info,
    }),
  )
  rows.push(strip(ctx, 'ap-read', [{ id: 'auto-ap-status', label: 'status', cost: 'read' }, { id: 'auto-ap-predict', label: 'predict', cost: 'read' }, { id: 'auto-ap-learn', label: 'learn', cost: 'read' }, { id: 'auto-ap-log', label: 'log', cost: 'read' }]))
  rows.push(strip(ctx, 'ap-write', [{ id: status?.isEnabled === true ? 'auto-ap-disable' : 'auto-ap-enable', label: status?.isEnabled === true ? 'disable' : 'enable', cost: 'writes' }, { id: 'auto-ap-reset', label: 'reset', cost: 'writes' }]))
  rows.push(field(ctx, 'auto-ap-history', 'history', 'search past completions: auth refactor', 'search'))

  return rows
}

function sessionRows(ctx: Ctx): RenderElement[] {
  const sessions = ctx.state.auto.sessions
  const rows: RenderElement[] = [rule(ctx, 'Sessions', sessions === null ? 'not listed yet' : `${sessions.length} saved`)]

  rows.push(strip(ctx, 'ses-strip', [{ id: 'auto-ses-list', label: 'list', cost: 'read' }, { id: 'auto-ses-current', label: 'current', cost: 'read' }]))

  for (const session of (sessions ?? []).slice(0, 8)) {
    rows.push(
      row(
        ctx,
        [
          ctx.kit.Text({ bold: true, color: THEME.head, children: clip(` ${session.name} `, 30).padEnd(30, '.') }),
          ctx.kit.Text({ color: THEME.info, children: ` ${session.savedAtMs !== undefined ? ago(session.savedAtMs, ctx.nowMs) : 'n/a'} ` }),
          ...(['restore', 'export', 'delete'] as const).map(verb => ctx.kit.Button({ key: `run-auto-ses-${verb}-${session.id}`, label: ` ▸ ${verb}`, plain: true, dimColor: verb !== 'export', onPress: () => void ctx.act.run(`auto-ses-${verb}-${session.id}`) })),
        ],
        `ses-${session.id}`,
      ),
    )
  }

  rows.push(field(ctx, 'auto-ses-save', 'save as', 'a name for memory, agents and tasks as they are now', 'save'))

  return rows
}

function configRows(ctx: Ctx): RenderElement[] {
  const config = ctx.state.auto.config
  const rows: RenderElement[] = [rule(ctx, 'Config', config === null ? 'not listed yet' : `${config.length} keys · ${config.filter(entry => entry.isSecret).length} masked`)]

  rows.push(strip(ctx, 'cfg-strip', [{ id: 'auto-cfg-list', label: 'list', cost: 'read' }]))

  for (const entry of (config ?? []).slice(0, 16)) {
    rows.push(row(ctx, [ctx.kit.Text({ color: THEME.ok, children: ` ${entry.key.padEnd(28)} ` }), ctx.kit.Text({ color: entry.isSecret ? THEME.warn : THEME.info, wrap: 'truncate-end', children: clip(`${entry.shown}  (${entry.source})`, Math.max(4, ctx.columns - 32)) })], `cfg-${entry.key}`))
  }

  rows.push(field(ctx, 'auto-cfg-get', 'get', 'a key: swarm.topology', 'get'))
  rows.push(field(ctx, 'auto-cfg-set', 'set', 'a key and a value: swarm.maxAgents 8 (credentials are never set here)', 'set'))

  return rows
}

/**
 * Automation: the background workers as cards with their daemon, the task kanban, workflows, autopilot, sessions and
 * config. Nothing runs on open: the cards and the board come from ruflo's own files; every list is a $0 click; every
 * change asks first with its exact argv, and its cost or what it deletes on the confirm row.
 */
export function automateView(ctx: Ctx): RenderElement {
  return col(
    ctx,
    [
      ...resultRows(ctx, ['auto-']),
      ...loopRows(ctx),
      ...workerRows(ctx),
      ...kanbanRows(ctx),
      ...workflowRows(ctx),
      ...autopilotRows(ctx),
      ...sessionRows(ctx),
      ...configRows(ctx),
      text(ctx, ` $0 read, runs at once · wr writes · cpu local compute or a process · $$ calls a paid model · a field's Enter asks, Enter again (or y) runs`, { dimColor: true }),
    ],
    'automate',
  )
}

/** This view's result block alone: the pane asks for it to place under the row that was clicked. */
export const automateResult = (ctx: Ctx): RenderElement[] => resultRows(ctx, ['auto-'])
