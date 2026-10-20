/**
 * Stop, Message and Redirect on the Workflows page (ADR-465), through the page's slot registry only: one inspector tab (`control`) and one
 * action button (`ctl-stop`), no hotkey, no edit of any shared file. Importing this module registers them (the merge owner adds
 * `import './wf-control'` to views/wf-register.ts and calls `wireWfControl(state, host)` from hooks/wf-wire.ts). Each action draws the EXACT
 * engine call it will make and how far that path is proven; the engine's own permission check and dialog decide it, and its answer is what the
 * footer outcome row says. Where this build binds no tool calls, the tab says so and offers the prompt-box text instead.
 */
import type { RenderElement } from 'claude-code'

import { cleanText } from '../data/wf-clean'
import { controlActions, taskIdOf, taskPattern, transcriptOf, type ControlAction, type ControlInput, type TaskRef } from '../data/wf-control'
import { tidy } from '../data/wf-send'
import type { Host } from '../host'
import type { State } from '../state'
import type { WfRun } from '../data/workflows'
import { isRunPath } from '../wf-actions'
import { button, col, kv, text, THEME, type Ctx } from './common'
import { registerSlot, type SlotEnv } from './wf-slots'

const hosts = new WeakMap<State, Host>()
const drafts = new WeakMap<State, { text: string }>()

/** The wiring: the host whose tool bridge the actions call. A slot is handed none, so this is bound once per console state. */
export const wireWfControl = (state: State, host: Host): void => void hosts.set(state, host)

/** For tests. */
export function resetControl(state: State): void {
  hosts.delete(state)
  drafts.delete(state)
  tasks.delete(state)
}

const draftOf = (state: State): { text: string } => {
  let held = drafts.get(state)

  if (held === undefined) {
    held = { text: '' }
    drafts.set(state, held)
  }

  return held
}

const COLOR: Record<ControlAction['proof'], string | undefined> = { verified: THEME.ok, 'does-not-work': THEME.bad, prefill: undefined }

/** The task ids found (or why not), by run: TaskStop takes the Workflow tool's task id, which only the session transcript holds while a run is live (ADR-471). */
const tasks = new WeakMap<State, Map<string, { ref: TaskRef; atMs: number; isPending: boolean }>>()
/** The id is read again after this long: a reason because the launch line may not have been written yet, an id because a RESUME gives the same run a new task id. */
const RETRY_MS = 5_000
const SMALL = 2_000_000

/** Reads the run's task id once per run: the transcript in full when it is small, else a search of it; every failure is a reason, never a guess. */
async function findTask(state: State, host: Host, run: Pick<WfRun, 'id' | 'dir'>): Promise<TaskRef> {
  const path = transcriptOf(run, candidate => isRunPath(candidate, state.configDir))

  if (path === null) return { why: 'the run\'s session transcript is not at a path the console may read' }

  try {
    const size = (await host.fs.stat(path).catch(() => undefined))?.size

    if (size === undefined) return { why: 'the session transcript that launched this run is not there (a run started by another session cannot be stopped from here)' }

    const found = size <= SMALL ? taskIdOf(await host.fs.read(path), run.id) : await searchTask(host, path, run.id)

    return found === null ? { why: 'this run\'s task id is not in the session transcript (it was launched by another session): stop it in Claude Code\'s Workflows panel' } : { id: found }
  } catch {
    return { why: 'the session transcript could not be read' }
  }
}

/** A transcript too large to read whole: grep prints only the launch result's task and run ids (argv, no shell; the path is a checked run path). */
async function searchTask(host: Host, path: string, runId: string): Promise<string | null> {
  const result = await host.run(['grep', '-o', '-E', taskPattern(runId), path], 10_000)

  return result.exitCode === 0 ? taskIdOf(result.stdout, runId) : null
}

function taskOf(state: State, host: Host | undefined, run: WfRun): TaskRef {
  let held = tasks.get(state)

  if (held === undefined) {
    held = new Map()
    tasks.set(state, held)
  }

  const known = held.get(run.id)
  const now = Date.now()

  if (known !== undefined && (known.isPending || now - known.atMs < RETRY_MS)) return known.ref

  if (host === undefined) return { why: 'no host to read the session transcript' }

  // A stale answer stays on screen while it is read again (so a button never flickers to "reading"); a first read has nothing to show yet.
  const pending: TaskRef = known?.ref ?? { why: 'reading the session transcript for this run\'s task id: draw again in a moment' }

  held.set(run.id, { ref: pending, atMs: now, isPending: true })
  void findTask(state, host, run).then(found => {
    held?.set(run.id, { ref: found, atMs: Date.now(), isPending: false })
    host.invalidate()
  })

  return pending
}

/** The inputs the data module needs, from the page's cursor; null where there is no run or no host to act through. */
export function inputOf(env: Pick<SlotEnv, 'ctx' | 'run' | 'agent'>, text: string): ControlInput | null {
  const host = hosts.get(env.ctx.state)

  if (env.run === null || host === undefined) return null

  const { state } = env.ctx

  return {
    run: env.run,
    agent: env.agent,
    task: env.run.kind === 'workflow' ? taskOf(state, host, env.run) : { why: 'a ruflo swarm has no workflow task' },
    text,
    bridge: { toolCall: host.toolCall, toolCheck: host.toolCheck, fillPrompt: host.fillPrompt },
    report: (label, ok, detail) => {
      state.outcome = { label: tidy(label, 80), ok, verified: 'n/a', detail: tidy(detail, 240), atMs: Date.now() }
      host.invalidate()
    },
    isRunPath: path => isRunPath(path, state.configDir),
  }
}

function controlTab(env: SlotEnv): RenderElement[] {
  const { ctx, run, agent } = env
  const input = inputOf(env, draftOf(ctx.state).text)

  if (run === null) return [text(ctx, 'No run picked.', { dimColor: true })]
  if (input === null) return [text(ctx, 'The console is not wired to a host here: nothing can be called.', { dimColor: true })]

  const draft = draftOf(ctx.state)
  const actions = controlActions(input)
  const host = hosts.get(ctx.state)
  const field = ctx.kit.Input === undefined ? text(ctx, 'this surface has no text field: message and redirect need one', { dimColor: true }) : ctx.kit.Input({ key: 'wf-control-text', label: 'message', placeholder: 'what to tell the agent, or what to change on a redirect', submitLabel: 'set', onSubmit: value => { draft.text = value; ctx.act.workflows.setUi({}) } })
  const rows: RenderElement[] = [kv(ctx, 'run', cleanText(run.name)), kv(ctx, 'agent', agent === null ? 'none picked: stop and message need one' : cleanText(agent.label)), kv(ctx, 'tool calls', host?.toolCall === undefined ? 'not bound in this build: only the prompt-box text is offered' : 'bound: each call goes through the engine\'s permission check and dialog', host?.toolCall === undefined ? THEME.warn : undefined), field, text(ctx, draft.text === '' ? 'message: none typed yet' : `message: ${draft.text}`, { color: draft.text === '' ? undefined : THEME.info })]

  for (const action of actions) {
    rows.push(button(ctx, `wf-control-${action.id}`, action.label, () => ctx.act.workflows.ask(action.spec, action.why)))
    // Wrapped, not cut: the measured words end with the version and the day they were measured on.
    rows.push(ctx.kit.Text({ wrap: 'wrap', dimColor: true, children: `   call: ${action.spec === null ? `none (${action.why})` : action.call}` }))
    rows.push(ctx.kit.Text({ wrap: 'wrap', ...(COLOR[action.proof] === undefined ? { dimColor: true } : { color: COLOR[action.proof] as string }), children: `   proof: ${action.proof} · ${action.proofText}` }))
  }

  rows.push(text(ctx, 'A refusal by the engine is shown and nothing else is tried in its place. Stopping is not undone by resuming.', { dimColor: true }))

  return [col(ctx, rows, 'wf-control')]
}

/** The stop action of the extras row: always the whole run (the engine cannot stop one workflow agent, ADR-471). Null (with the reason on the confirm row) where it cannot be made. */
export function stopSlotSpec(env: SlotEnv): ReturnType<typeof controlActions>[number]['spec'] {
  const input = inputOf(env, '')

  if (input === null) return null

  const actions = controlActions(input)

  return actions.find(action => action.id === 'stop-run')?.spec ?? null
}

/** Registers this module's slots; a repeat is refused harmlessly (the registry keeps the first). */
export function registerControlSlots(): void {
  registerSlot({ kind: 'tab', id: 'control', label: 'control', when: env => env.run !== null && env.run.kind === 'workflow', render: controlTab })
  registerSlot({ kind: 'action', id: 'ctl-stop', label: 'stop', why: 'nothing to stop: a ruflo swarm run (use x), a run whose task id is not in this session\'s transcript, or a build with no tool bridge', spec: stopSlotSpec })
}

registerControlSlots()
