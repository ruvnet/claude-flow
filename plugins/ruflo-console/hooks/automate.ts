/**
 * The Automation view's work: workflows, the twelve background workers and their daemon, autopilot, sessions, config
 * and tasks, each as one fixed argv checked against @claude-flow/cli 3.51.1 (commands/{workflow,hooks,daemon,autopilot,
 * session,config,task}.ts and the mcp-tools they call). A read ($0, changes nothing) runs at once and its output lands
 * in the result panel; anything that writes, deletes, starts a process or may call a paid model asks first, and its
 * confirm row says so. Free text passes `freeText`, keys `configKeyOf`, ids `idOf`, paths `relPathOf`. Pure: specs and
 * entries only, built from the state; the runner runs them.
 *
 * What cannot work is said, not faked: `hooks worker status` and `cancel` keep workers in a per-process map, so a fresh
 * `ruflo` run never sees a worker another run dispatched; the cards read the daemon's own state file instead.
 */
import { ARGV_TEXT_MAX } from './full-text'
import type { ActionSpec } from './actions'
import { configKeyOf, freeText, keyValueOf, isSecretKey, laneOf, looksSecret, MASK, objectIn, parseAutopilot, parseConfig, parseSessions, parseTemplates, parseWorkflows, relPathOf, shownValue, WORKER_ABOUT, WORKER_NAMES } from './data/automate'
import { idOf, plain, type AgentRecord, type TaskRecord } from './data/parse'
import { labLines, type LabCost } from './mh-lab'
import type { State } from './state'
import { selection } from './views/select'

/** An `mcp exec` argv: the params are one JSON argv element, never a shell string (numbers and booleans keep their type). */
export const tool = (name: string, params: Record<string, unknown>): readonly string[] => ['mcp', 'exec', '-t', name, '-p', JSON.stringify(params)]

/** One palette entry from this view: a spec (null with its reason when it cannot run now), or a text entry whose id is its keyword. */
export type AutoEntry = { id: string; group: string; label: string; spec?: ActionSpec | null; why?: string; make?: (text: string) => ActionSpec | null }

type Extra = { note?: string; read?: ActionSpec['read']; timeoutMs?: number; verify?: ActionSpec['verify']; expect?: string }

/** A lab spec: it reports into the result panel (and `/ruflo run <id>` answers with it); only a read skips the confirm. */
export function autoSpec(id: string, label: string, cost: LabCost, args: readonly string[], extra: Extra = {}): ActionSpec {
  return {
    label,
    args,
    expect: extra.expect ?? (cost === 'read' ? 'its output in the result panel' : `its result in the result panel${extra.note !== undefined ? `; ${extra.note}` : ''}`),
    lab: id,
    ...(cost === 'read' && { isReadOnly: true }),
    ...(extra.note !== undefined && { note: extra.note }),
    ...(extra.read !== undefined && { read: extra.read }),
    ...(extra.timeoutMs !== undefined && { timeoutMs: extra.timeoutMs }),
    ...(extra.verify !== undefined && { verify: extra.verify }),
  }
}

/** Keeps a parsed list when the output had one, then answers the panel's lines from it (or the CLI's own when it had none). */
function keep<T>(parse: (stdout: string) => T[] | null, put: (list: T[]) => void, line: (item: T) => string, empty: string): ActionSpec['read'] {
  return (stdout, stderr) => {
    const list = parse(stdout)

    if (list === null) return labLines('auto', stdout, stderr)

    put(list)

    return list.length === 0 ? [empty] : list.map(line)
  }
}

/** The ids and statuses a write answered: a workflow's new status is kept on its row, the rest is shown as is. */
function statusRead(state: State): ActionSpec['read'] {
  return (stdout, stderr) => {
    const value = objectIn(stdout)
    const id = idOf(value?.workflowId)
    const status = typeof value?.status === 'string' ? plain(value.status, 20) : null
    const row = state.auto.workflows?.find(workflow => workflow.id === id)

    if (row !== undefined && status !== null) row.status = status

    return labLines('auto', stdout, stderr)
  }
}

const DISPATCH_NOTE = 'writes a job file to .claude-flow/daemon-queue for the daemon; with no daemon running nothing executes, and a --headless daemon may call claude under its AI budget'
export const WORKER_CANCEL_WHY = 'n/a: hooks worker status and cancel keep workers in a per-process map, so a fresh ruflo run never sees a worker another run dispatched; the cards read .claude-flow/daemon-state.json instead'

/** The fixed entries: lists and reads, the daemon, autopilot, and the typed ones. Per-row entries come from `rowEntries`. */
function fixedEntries(state: State): AutoEntry[] {
  const out: AutoEntry[] = []
  const spec = (id: string, group: string, label: string, cost: LabCost, args: readonly string[], extra?: Extra) => out.push({ id, group, label, spec: autoSpec(id, label, cost, args, extra) })
  const auto = state.auto

  spec('auto-wf-list', 'workflows', 'workflows: list them with their status', 'read', tool('workflow_list', { limit: 20 }), {
    read: keep(parseWorkflows, list => (auto.workflows = list), row => `${row.id} · ${row.name} · ${row.status} · ${row.steps} step${row.steps === 1 ? '' : 's'}`, '(no workflows yet: create one below)'),
  })
  spec('auto-wf-templates', 'workflows', 'workflow templates: list the saved ones', 'read', tool('workflow_template', { action: 'list' }), {
    read: keep(parseTemplates, list => (auto.templates = list), row => `${row.id} · ${row.name} · ${row.steps} steps`, '(no templates: ▸ tpl saves a workflow as one)'),
  })

  for (const name of WORKER_NAMES) {
    spec(`auto-worker-${name}`, 'workers', `dispatch the ${name} worker (${WORKER_ABOUT[name]})`, 'writes', ['hooks', 'worker', 'dispatch', '--trigger', name], { note: DISPATCH_NOTE, expect: 'the worker queued for the daemon' })
  }

  spec('auto-workers-list', 'workers', 'workers: the twelve, their priority and time', 'read', ['hooks', 'worker', 'list'])
  spec('auto-workers-status', 'workers', 'workers: status of this process’s dispatches', 'read', ['hooks', 'worker', 'status', '--all'])
  out.push({ id: 'auto-worker-cancel', group: 'workers', label: 'cancel a running worker', spec: null, why: WORKER_CANCEL_WHY })
  spec('auto-daemon-status', 'workers', 'daemon: its status and every worker’s runs', 'read', ['daemon', 'status'])
  spec('auto-daemon-start', 'workers', 'start the worker daemon (local-only workers)', 'local', ['daemon', 'start'], {
    note: 'starts a background process for this project that runs the enabled workers on their schedule, local-only (no --headless, so no model calls), until ruflo daemon stop or its 12 h TTL',
    verify: snapshot => snapshot.daemon?.running === true,
  })
  spec('auto-daemon-stop', 'workers', 'stop the worker daemon', 'writes', ['daemon', 'stop'], { note: 'stops this project’s daemon and its workers', verify: snapshot => snapshot.daemon?.running !== true })

  spec('auto-ap-status', 'autopilot', 'autopilot: enabled, iterations, task progress', 'read', ['autopilot', 'status', '--json'], {
    read: (stdout, stderr) => {
      const status = parseAutopilot(stdout)

      if (status === null) return labLines('auto', stdout, stderr)
      auto.autopilot = status

      return [`${status.isEnabled ? 'ENABLED' : 'disabled'} · iteration ${status.iterations}/${status.maxIterations} · timeout ${status.timeoutMinutes} min`, `tasks ${status.done}/${status.total} (${status.percent}%) · sources ${status.sources.join(', ') || 'n/a'}`]
    },
  })
  spec('auto-ap-enable', 'autopilot', 'enable autopilot: keep agents working until every task is done', 'writes', ['autopilot', 'enable'], { note: 'writes .claude-flow/data/autopilot-state.json; the stop hook then re-engages the session until its tasks are done or the iteration cap is hit' })
  spec('auto-ap-disable', 'autopilot', 'disable autopilot', 'writes', ['autopilot', 'disable'], { note: 'writes .claude-flow/data/autopilot-state.json' })
  spec('auto-ap-reset', 'autopilot', 'reset autopilot’s iteration counter and timer', 'writes', ['autopilot', 'reset'], { note: 'writes .claude-flow/data/autopilot-state.json' })
  spec('auto-ap-predict', 'autopilot', 'autopilot predict: the next best action', 'read', ['autopilot', 'predict', '--json'])
  spec('auto-ap-learn', 'autopilot', 'autopilot learn: success patterns from past completions', 'read', ['autopilot', 'learn', '--json'])
  spec('auto-ap-log', 'autopilot', 'autopilot log: the last 20 events', 'read', ['autopilot', 'log', '--last', '20', '--json'])
  out.push({ id: 'auto-ap-history', group: 'autopilot', label: 'auto-ap-history <query>: search past completions', make: text => historySpec(text) })

  spec('auto-ses-list', 'sessions', 'sessions: list the saved ones', 'read', tool('session_list', { limit: 20 }), {
    read: keep(parseSessions, list => (auto.sessions = list), row => `${row.id} · ${row.name}`, '(no saved sessions: save one below)'),
  })
  spec('auto-ses-current', 'sessions', 'session: the current one', 'read', tool('session_current', {}))
  out.push({ id: 'auto-ses-save', group: 'sessions', label: 'auto-ses-save <name>: save memory, agents and tasks as a session', make: text => sessionSave(state, text) })

  spec('auto-cfg-list', 'config', 'config: every key, secrets masked', 'read', tool('config_list', {}), {
    read: keep(parseConfig, list => (auto.config = list), row => `${row.key} = ${row.shown} (${row.source})`, '(no config values)'),
  })
  out.push({ id: 'auto-cfg-get', group: 'config', label: 'auto-cfg-get <key>: one config value (secrets masked)', make: configGet })
  out.push({ id: 'auto-cfg-set', group: 'config', label: 'auto-cfg-set <key> <value>: set a config value', make: configSet })

  spec('auto-task-list', 'tasks', 'tasks: list them with status and agents', 'read', tool('task_list', { limit: 50 }))
  out.push({ id: 'auto-task-new', group: 'tasks', label: 'auto-task-new [type:] <description>: create a task', make: taskCreate })
  out.push({ id: 'auto-wf-new', group: 'workflows', label: 'auto-wf-new <prompt>: a one-step workflow for an agent', make: text => workflowCreate(state, text) })
  out.push({ id: 'auto-wf-validate', group: 'workflows', label: 'auto-wf-validate <file>: check a workflow file’s structure', make: workflowValidate })

  return out
}

export function historySpec(text: string): ActionSpec | null {
  const query = freeText(text, ARGV_TEXT_MAX)

  return query === null ? null : autoSpec('auto-ap-history', `autopilot history for "${query.slice(0, 40)}"`, 'read', ['autopilot', 'history', '--query', query, '--json'])
}

export function sessionSave(state: State, text: string): ActionSpec | null {
  const name = freeText(text, 256)

  return name === null
    ? null
    : autoSpec('auto-ses-save', `save the session "${name}"`, 'writes', tool('session_save', { name }), {
        note: 'writes a session file in .claude-flow/sessions holding memory, agents and tasks',
        read: (stdout, stderr, ok) => {
          if (ok) state.auto.sessions = null

          return labLines('auto-ses-save', stdout, stderr)
        },
      })
}

/** A config value through the masks: the key or value that looks secret is never drawn, nor its previous value. */
function configRead(stdout: string, stderr: string): string[] {
  const value = objectIn(stdout)
  const key = typeof value?.key === 'string' ? configKeyOf(value.key) : null

  if (value === null || key === null) return labLines('auto-cfg', stdout, stderr).map(line => (looksSecret(line.split(': ').pop()) ? MASK : line))

  const now = shownValue(key, value.value)
  const before = 'previousValue' in value ? ` (was ${shownValue(key, value.previousValue).shown})` : ''

  return [`${key} = ${now.shown}${before}`, `source ${plain(String(value.source ?? value.scope ?? 'n/a'), 20)}${value.path !== undefined ? ` · ${plain(String(value.path), 120)}` : ''}`]
}

export function configGet(text: string): ActionSpec | null {
  const key = configKeyOf(text)

  return key === null ? null : autoSpec('auto-cfg-get', `config value of ${key}`, 'read', tool('config_get', { key }), { read: configRead })
}

/** A set never carries a secret: the confirm row prints the argv, so a credential-shaped key or value is refused here. */
export function configSet(text: string): ActionSpec | null {
  const pair = keyValueOf(text)

  if (pair === null || isSecretKey(pair.key) || looksSecret(pair.value)) return null

  return autoSpec('auto-cfg-set', `set config ${pair.key} to ${JSON.stringify(pair.value)}`, 'writes', tool('config_set', { key: pair.key, value: pair.value }), { note: 'writes .claude-flow/config.json', read: configRead })
}

const TASK_TYPES = ['feature', 'bugfix', 'research', 'refactor', 'test', 'docs'] as const

/** `bugfix: the login loop` makes a bugfix; with no known type first, a feature. */
export function taskCreate(text: string): ActionSpec | null {
  const match = /^(\w+):\s*(.*)$/.exec(text.trim())
  const type = match !== null && (TASK_TYPES as readonly string[]).includes(match[1]?.toLowerCase() ?? '') ? (match[1] ?? 'feature').toLowerCase() : 'feature'
  const description = freeText(match !== null && type !== 'feature' ? (match[2] ?? '') : text, ARGV_TEXT_MAX)

  return description === null
    ? null
    : autoSpec('auto-task-new', `create a ${type} task "${description.slice(0, 40)}"`, 'writes', tool('task_create', { type, description }), {
        note: 'writes .claude-flow/tasks/store.json',
        expect: 'the task on the board as pending',
        verify: snapshot => snapshot.tasks.some(task => task.description === description),
      })
}

/** One task step for the agent picked on the board (a run needs one); the prompt is the person's, the name its first words. */
export function workflowCreate(state: State, text: string): ActionSpec | null {
  const prompt = freeText(text, ARGV_TEXT_MAX)
  const agentId = idOf(selection(state).agent?.id)

  if (prompt === null) return null

  return autoSpec('auto-wf-new', `create a workflow "${prompt.slice(0, 40)}"${agentId === null ? ' (no agent yet: a run needs one)' : ` for ${agentId}`}`, 'writes', tool('workflow_create', { name: prompt.slice(0, 60), description: prompt, steps: [{ name: 'task', type: 'task', config: { prompt, ...(agentId !== null && { agentId }) } }] }), {
    note: 'writes .claude-flow/workflows/store.json; nothing runs until ▸ run',
    read: (stdout, stderr, ok) => {
      if (ok) state.auto.workflows = null

      return labLines('auto-wf-new', stdout, stderr)
    },
  })
}

export function workflowValidate(text: string): ActionSpec | null {
  const file = relPathOf(text)

  return file === null ? null : autoSpec('auto-wf-validate', `validate the workflow file ${file}`, 'read', tool('workflow_validate', { file }))
}

/** The buttons a workflow row offers, by its status: running pauses or cancels, paused resumes, the rest run. */
export function workflowVerbs(status: string): ('status' | 'run' | 'pause' | 'resume' | 'cancel' | 'tpl')[] {
  if (status === 'running') return ['status', 'pause', 'cancel']
  if (status === 'paused') return ['status', 'resume', 'cancel', 'tpl']

  return ['status', 'run', 'tpl']
}

/** The lanes a task's buttons move it along: pending is assigned or cancelled, running completed or cancelled, done retried. */
export function taskVerbs(status: string): ('assign' | 'done' | 'cancel' | 'retry')[] {
  const lane = laneOf(status)

  return lane === 'pending' ? ['assign', 'cancel'] : lane === 'running' ? ['done', 'cancel'] : /fail|cancel/.test(status) ? ['retry'] : []
}

export function taskSpec(verb: 'assign' | 'done' | 'cancel' | 'retry', task: TaskRecord, agent: AgentRecord | null): ActionSpec | null {
  const taskId = idOf(task.id)
  const id = `auto-task-${verb}-${task.id}`
  const agentId = idOf(agent?.id)

  if (taskId === null) return null

  switch (verb) {
    case 'assign':
      return agentId === null
        ? null
        : autoSpec(id, `assign task ${taskId} to ${agent?.name ?? agent?.type ?? agentId}`, 'writes', tool('task_assign', { taskId, agentIds: [agentId] }), { note: 'writes .claude-flow/tasks/store.json', verify: snapshot => snapshot.tasks.some(entry => entry.id === taskId && entry.assignedTo.includes(agentId)) })
    case 'done':
      return autoSpec(id, `mark task ${taskId} complete`, 'writes', tool('task_complete', { taskId }), { note: 'writes .claude-flow/tasks/store.json', verify: snapshot => snapshot.tasks.some(entry => entry.id === taskId && entry.status === 'completed') })
    case 'cancel':
      return autoSpec(id, `cancel task ${taskId}`, 'writes', tool('task_cancel', { taskId, reason: 'cancelled from ruflo-console' }), { note: 'writes .claude-flow/tasks/store.json', verify: snapshot => snapshot.tasks.some(entry => entry.id === taskId && entry.status === 'cancelled') })
    case 'retry':
      return autoSpec(id, `retry task ${taskId} as a new pending task`, 'writes', tool('task_retry', { taskId }), { note: 'writes .claude-flow/tasks/store.json: a new pending copy of the task' })
  }
}

const WF_NOTE = 'writes .claude-flow/workflows/store.json'

export function workflowSpec(verb: 'status' | 'run' | 'pause' | 'resume' | 'cancel' | 'tpl', workflowId: string, state: State): ActionSpec | null {
  const id = idOf(workflowId)
  const lab = `auto-wf-${verb}-${workflowId}`

  if (id === null) return null

  switch (verb) {
    case 'status':
      return autoSpec(lab, `status of workflow ${id}`, 'read', tool('workflow_status', { workflowId: id, verbose: true }), { read: statusRead(state) })
    case 'run':
      return autoSpec(lab, `run workflow ${id} (its task steps call a model)`, 'spends', tool('workflow_execute', { workflowId: id }), {
        note: 'COSTS MONEY: each task step calls the agent’s configured model (agent_execute) until the workflow ends, fails or is paused',
        read: statusRead(state),
        timeoutMs: 600_000,
      })
    case 'pause':
      return autoSpec(lab, `pause workflow ${id}`, 'writes', tool('workflow_pause', { workflowId: id }), { note: `${WF_NOTE}; a run stops before its next step`, read: statusRead(state) })
    case 'resume':
      return autoSpec(lab, `resume workflow ${id}`, 'writes', tool('workflow_resume', { workflowId: id }), { note: `${WF_NOTE}; marks it running, its steps do not execute until ▸ run`, read: statusRead(state) })
    case 'cancel':
      return autoSpec(lab, `cancel workflow ${id}`, 'writes', tool('workflow_cancel', { workflowId: id, reason: 'cancelled from ruflo-console' }), { note: `${WF_NOTE}; skips its remaining steps`, read: statusRead(state) })
    case 'tpl':
      return autoSpec(lab, `save workflow ${id} as a template`, 'writes', tool('workflow_template', { action: 'save', workflowId: id }), { note: WF_NOTE })
  }
}

export function sessionSpec(verb: 'restore' | 'export' | 'delete', sessionId: string): ActionSpec | null {
  const id = idOf(sessionId)
  const lab = `auto-ses-${verb}-${sessionId}`

  if (id === null) return null

  switch (verb) {
    case 'restore':
      return autoSpec(lab, `restore session ${id}`, 'writes', tool('session_restore', { sessionId: id }), { note: 'OVERWRITES this project’s current memory, agents and tasks with the saved ones' })
    case 'export':
      // The export holds memory entries: only its id, path and time are shown, never the data.
      return autoSpec(lab, `export session ${id} to session-${id}.json`, 'writes', tool('session_export', { sessionId: id, outputPath: `session-${id}.json` }), {
        note: `writes session-${id}.json in the project; it holds the session’s memory entries`,
        read: (stdout, stderr) => {
          const value = objectIn(stdout)

          return value === null ? labLines(lab, '', stderr) : [`${plain(String(value.sessionId ?? id), 80)} → ${plain(String(value.path ?? value.error ?? 'n/a'), 160)}`, `exported ${plain(String(value.exportedAt ?? 'n/a'), 40)}`]
        },
      })
    case 'delete':
      return autoSpec(lab, `delete session ${id}`, 'writes', tool('session_delete', { sessionId: id }), { note: 'DELETES the saved session file; it cannot be undone' })
  }
}

/** Every entry for the state as it is: the fixed ones, then one per verb of each listed workflow, template, session and task. */
export function automateEntries(state: State): AutoEntry[] {
  const out = fixedEntries(state)
  // Assign goes to the agent picked on the board (a, as on the claims board).
  const agent = selection(state).agent

  for (const workflow of (state.auto.workflows ?? []).slice(0, 8)) {
    for (const verb of workflowVerbs(workflow.status)) out.push({ id: `auto-wf-${verb}-${workflow.id}`, group: 'workflows', label: `${verb} workflow ${workflow.name}`, spec: workflowSpec(verb, workflow.id, state), why: 'that workflow id cannot be passed to ruflo' })
  }

  for (const template of (state.auto.templates ?? []).slice(0, 6)) {
    const templateId = idOf(template.id)

    out.push({ id: `auto-tpl-new-${template.id}`, group: 'workflows', label: `new workflow from template ${template.name}`, spec: templateId === null ? null : autoSpec(`auto-tpl-new-${template.id}`, `new workflow from template ${templateId}`, 'writes', tool('workflow_template', { action: 'create', templateId }), { note: WF_NOTE }), why: 'that template id cannot be passed to ruflo' })
  }

  for (const session of (state.auto.sessions ?? []).slice(0, 8)) {
    for (const verb of ['restore', 'export', 'delete'] as const) out.push({ id: `auto-ses-${verb}-${session.id}`, group: 'sessions', label: `${verb} session ${session.name}`, spec: sessionSpec(verb, session.id), why: 'that session id cannot be passed to ruflo' })
  }

  for (const task of (state.snapshot?.tasks ?? []).slice(0, 24)) {
    for (const verb of taskVerbs(task.status)) out.push({ id: `auto-task-${verb}-${task.id}`, group: 'tasks', label: `${verb} task ${task.id}`, spec: taskSpec(verb, task, agent), why: verb === 'assign' ? 'no agent to assign it to: spawn one (Swarm)' : 'that task id cannot be passed to ruflo' })
  }

  return out
}

