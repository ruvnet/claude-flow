/**
 * Stop, Message and Redirect for a running workflow run or agent (ADR-465, measured in ADR-471). Pure: the run, the agent and the bridge in,
 * `ActionSpec`s out. Each spec goes through the page's confirm card, which shows the EXACT engine call; the call itself is `$.tool.call`
 * (through the host's `toolCall`), so the engine's permission check and dialog decide it, never this file. What an interactive session
 * answered (Claude Code 2.1.289, 2026-10-06, evidence in ADR-471):
 *
 *   TaskStop     the WORKFLOW'S TASK id (the `taskId` of the Workflow tool's result, read from the session transcript) stops the whole run and
 *                its agents. The `wf_` run id and the id of an agent inside the run are answered "No task found": no single workflow agent can
 *                be stopped through the engine. (An Agent-tool agent is a different case, see ADR-471; this page never lists those.)
 *   SendMessage  to a RUNNING workflow agent's id: delivered into that agent's own transcript within milliseconds and acted on. To a finished
 *                one: "could not be resumed". By its label: "not reachable".
 *   Redirect     the run stop above, then the resume text prepared in the prompt box (never sent): two halves, said as two.
 *
 * A refusal (`deny`) is shown and nothing else is tried: no other route is used to do what the engine would not. A failed or unreachable
 * call keeps the person's choice: the same words as a prepared prompt are one button away. Everything drawn is masked first.
 */
import type { ActionSpec } from '../actions'
import type { Host, ToolReply } from '../host'
import { cleanText } from './wf-clean'
import { ARGV_TEXT_MAX } from '../full-text'
import { guardText } from './wf-guide'
import { idOf, plain } from './parse'
import type { WfAgent, WfRun } from './workflows'

/** What the control actions need of the host; a test passes fakes. */
export type Bridge = Pick<Host, 'toolCall' | 'toolCheck'>

export type ControlKind = 'stop-agent' | 'stop-run' | 'message' | 'redirect' | 'text'
/** What was measured: it worked, the engine refuses it, or nothing is called (the text is only prepared). */
export type Proof = 'verified' | 'does-not-work' | 'prefill'

export type ControlAction = {
  id: ControlKind
  label: string
  /** The exact engine call, or the exact prepared text. */
  call: string
  proof: Proof
  /** In words, what is known about this path. */
  proofText: string
  spec: ActionSpec | null
  /** Said on the confirm row when `spec` is null. */
  why: string
}

/** Where a run's task id stands: found in the session transcript, or why not (still being read, no transcript, not in it). */
export type TaskRef = { id: string } | { why: string }

export type ControlInput = {
  run: WfRun
  agent: WfAgent | null
  /** The Workflow tool's task id for the run (TaskStop takes this, not the `wf_` run id): read from the session transcript by the view. */
  task: TaskRef
  /** The sentence typed for Message and Redirect. */
  text: string
  bridge: Bridge & Pick<Host, 'fillPrompt'>
  /** Says the result on the outcome row (and draws again). */
  report: (label: string, ok: boolean, detail: string) => void
  isRunPath: (path: string) => boolean
}

/** The id of the inspector tab this module registers (views/wf-control.ts); a page that says where Stop is done asks whether it exists. */
export const CONTROL_TAB = 'control'

/** The sentence a page says about stopping and messaging a workflow, true to whether the control tab is switched on. */
export const controlLine = (isOn: boolean): string => (isOn ? 'Stop, message and redirect: the control tab calls the engine\'s own TaskStop and SendMessage, behind its permission check, after showing the exact call.' : 'Stop and message from this page need the control tab, which is not switched on in this build: use Claude Code\'s Workflows panel or TaskStop.')

/** An id the engine hands out is letters, digits, dash and underscore; anything else is not passed to a tool. */
export const ENGINE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/

/** Which build and day the capability words below were measured on (ADR-471). */
export const MEASURED = { version: '2.1.289', date: '2026-10-06' } as const
const AT = `Claude Code ${MEASURED.version}, ${MEASURED.date}`

const RUN_ID = /^wf_[A-Za-z0-9-]{1,40}$/

/** The text a task-id search looks for in the session transcript: the Workflow tool's launch result carries its `taskId` and `runId` together. */
export const taskPattern = (runId: string): string => `"taskId":"[A-Za-z0-9]{6,40}","taskType":"local_workflow"[^}]{0,600}"runId":"${runId}"`

/**
 * The Workflow task id of a run in the text of its session transcript (or of a search's matching lines); null when it is not there. A RESUMED
 * run keeps its run id and gets a new task id (measured: `resumeFromRunId` answered the same runId with a different taskId), so the LAST launch wins.
 */
export function taskIdOf(text: string, runId: string): string | null {
  if (!RUN_ID.test(runId)) return null

  const hits = [...text.matchAll(new RegExp(taskPattern(runId), 'g'))]
  const last = hits.at(-1)

  return last === undefined ? null : (/"taskId":"([A-Za-z0-9]{6,40})"/.exec(last[0])?.[1] ?? null)
}

/** The session transcript that launched a run: the run's directory (`<session>/subagents/workflows/<run>`) without its tail, plus `.jsonl`. Null when the path is not a run path. */
export function transcriptOf(run: Pick<WfRun, 'dir'>, isRunPath: (path: string) => boolean): string | null {
  if (run.dir === undefined || !isRunPath(run.dir)) return null

  const session = run.dir.replace(/\/subagents\/workflows\/[^/]+\/?$/, '')

  return session === run.dir ? null : `${session}.jsonl`
}

const CAP = 240
const stopCall = (id: string): string => `TaskStop ${JSON.stringify({ task_id: id })}`
const messageCall = (to: string, message: string): string => `SendMessage ${JSON.stringify({ to, message })}`

/** The fields a tool's answer carries, wherever it put them: the structured result first, then JSON in the text. */
function fieldsOf(reply: ToolReply): Record<string, unknown> | null {
  const raw = reply.result ?? (typeof reply.text === 'string' && reply.text.trim().startsWith('{') ? safeParse(reply.text) : undefined)

  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export type Outcome = { ok: boolean; kind: 'done' | 'denied' | 'error' | 'not-wired'; text: string }

/** One answer, in the words the outcome row shows: masked, one line, capped. `deny` is a refusal; `isError` and `success:false` are failures. */
export function classifyReply(reply: ToolReply | undefined): Outcome {
  if (reply === undefined) return { ok: false, kind: 'not-wired', text: 'the host does not bind tool calls here' }
  if (typeof reply.deny === 'string') return { ok: false, kind: 'denied', text: `the engine refused it: ${clean(reply.deny)}` }

  const fields = fieldsOf(reply)
  const said = clean(typeof fields?.message === 'string' ? fields.message : (reply.text ?? (reply.result === undefined ? '' : JSON.stringify(reply.result))))

  if (reply.isError === true || fields?.success === false || fields?.isError === true) return { ok: false, kind: 'error', text: said === '' ? 'the engine answered with an error' : said }

  return { ok: true, kind: 'done', text: said === '' ? 'the engine answered ok with no text' : said }
}

const clean = (value: string): string => cleanText(plain(value.replace(/<\/?tool_use_error>/g, ''), 400)).slice(0, CAP)

/** Calls one tool and classifies the answer; a rejection (no such tool, aborted) is an error outcome, never thrown. */
export async function callTool(bridge: Bridge, input: { tool: string } & Record<string, unknown>): Promise<Outcome> {
  if (bridge.toolCall === undefined) return classifyReply(undefined)

  try {
    return classifyReply(await bridge.toolCall(input))
  } catch (error) {
    return { ok: false, kind: 'error', text: clean(error instanceof Error ? error.message : String(error)) || 'the call was rejected' }
  }
}

/** The engine's permission verdict now, in a phrase; a missing check says so rather than guessing "allow". */
export async function permissionOf(bridge: Bridge, tool: string, input: unknown): Promise<{ decision: 'allow' | 'ask' | 'deny' | 'unknown'; text: string }> {
  if (bridge.toolCheck === undefined) return { decision: 'unknown', text: 'the host cannot ask the engine for its permission verdict; the call is still checked when it runs' }

  try {
    const verdict = await bridge.toolCheck(tool, input)

    return { decision: verdict.decision, text: `the engine's permission check: ${verdict.decision}${verdict.reason === undefined ? '' : ` (${clean(verdict.reason)})`}` }
  } catch {
    return { decision: 'unknown', text: 'the permission check could not be asked' }
  }
}

/** Text for the main session after a stop: resume the run with the guidance added. Never sent: the person presses Enter. */
export function resumeText(run: WfRun, agent: WfAgent | null, text: string, isRunPath: (path: string) => boolean): string | null {
  const session = run.dir === undefined || !isRunPath(run.dir) ? null : run.dir.replace(/\/subagents\/workflows\/[^/]+\/?$/, '')
  const where = session === null ? 'its scripts folder (<session>/workflows/scripts)' : `${session}/workflows/scripts/${plain(run.name, 40)}-${plain(run.id, 40)}.js`

  return idOf(run.id) === null ? null : `Claude Code workflow run ${run.id} (${plain(run.name, 40)}${agent === null ? '' : `, agent "${plain(agent.label, 60)}"`}) was stopped from the ruflo console. Resume it with Workflow({ scriptPath: <${where}>, resumeFromRunId: "${run.id}" }) after adding this guidance to the affected agent's prompt: ${text}`
}

/** The prompt that asks the main session to deliver a message to a workflow agent, for where the console cannot. */
export const relayText = (run: WfRun, agent: WfAgent | null, text: string): string => `Send this to ${agent === null ? `the agents of Claude Code workflow run ${run.id}` : `agent "${plain(agent.label, 60)}" (${agent.id}) of workflow run ${run.id}`} with SendMessage, then tell me what the tool answered: ${text}`

const prefillSpec = (input: ControlInput, label: string, prompt: string, note: string): ActionSpec => ({
  label,
  args: [],
  shows: `into the prompt box, not sent: ${prompt.slice(0, 200)}`,
  expect: 'the text in the prompt box (it is not sent)',
  note,
  run: async () => {
    const isFilled = await Promise.resolve(input.bridge.fillPrompt(prompt)).catch(() => false)

    input.report(label, isFilled, isFilled ? 'prepared in the prompt box: press Enter there to send it' : 'there is no prompt box to fill here')
  },
})

/** A TaskStop of `id`: the permission is asked first, a refusal ends it, and the engine's own words are the result. */
function stopSpec(input: ControlInput, id: string, label: string, proofNote: string, after?: () => Promise<string>): ActionSpec {
  return {
    label,
    args: [],
    shows: stopCall(id),
    expect: 'the engine answers that the task was stopped',
    declared: 'write',
    note: `Calls the engine's TaskStop through the session's own permission check and dialog. ${proofNote} Stopped work is not undone by resuming: a resumed run starts its unfinished agents again.`,
    run: async () => {
      const verdict = await permissionOf(input.bridge, 'TaskStop', { task_id: id })

      if (verdict.decision === 'deny') return input.report(label, false, `${verdict.text}: nothing was stopped and no other route is tried`)

      const outcome = await callTool(input.bridge, { tool: 'TaskStop', task_id: id })

      if (!outcome.ok) return input.report(label, false, `${outcome.text}${outcome.kind === 'denied' ? ': nothing was stopped and no other route is tried' : ''}`)

      const tail = after === undefined ? '' : ` ${await after().catch(() => '')}`

      input.report(label, true, `${outcome.text}${tail} (re-read the run to see its state change)`)
    },
  }
}

const STOP_AGENT_ANSWER = (id: string): string => `TaskStop {"task_id":"${id}"} is answered "No task found with ID: ${id}"`

/**
 * What the control tab offers for the cursor. Message and Redirect need the typed sentence; every action says what it sends and what the
 * engine answered when it was tried (ADR-471). A ruflo swarm agent is not a Claude task: its stop and notes are the page's own.
 */
export function controlActions(input: ControlInput): ControlAction[] {
  const { run, agent, bridge } = input
  const out: ControlAction[] = []
  const add = (entry: Omit<ControlAction, 'call'> & { call?: string }) => out.push({ ...entry, call: entry.call ?? entry.spec?.shows ?? 'nothing yet' })

  if (run.kind !== 'workflow') {
    out.push({ id: 'text', label: 'ruflo agents', call: 'nothing', proof: 'prefill', proofText: 'A ruflo swarm agent is not a Claude Code task: stop it with the page\'s stop (x); message it with the guide tab (broadcast, task note).', spec: null, why: 'pick a Claude Code workflow run for these' })

    return out
  }

  const taskId = 'id' in input.task && ENGINE_ID.test(input.task.id) ? input.task.id : null
  const taskWhy = 'why' in input.task ? input.task.why : 'the run\'s task id is not one the engine can be given'
  const agentId = agent !== null && ENGINE_ID.test(agent.id) ? agent.id : null
  const wired = bridge.toolCall !== undefined
  const typed = guardText(input.text, ARGV_TEXT_MAX)
  const resume = typed.ok ? resumeText(run, agent, typed.text, input.isRunPath) : null
  const stopWhy = !wired ? 'this host does not bind tool calls: stop it in Claude Code\'s Workflows panel' : taskWhy

  add({
    id: 'stop-agent',
    label: agent === null ? 'stop the agent' : `stop agent ${clean(agent.label).slice(0, 30)}`,
    proof: 'does-not-work',
    proofText: `does not work: the engine stops a whole workflow run, not one agent of it. ${STOP_AGENT_ANSWER(agentId ?? '<agent id>')} (${AT}). Use "stop the whole run".`,
    spec: null,
    why: `the engine cannot stop one workflow agent: ${STOP_AGENT_ANSWER(agentId ?? '<agent id>')}; stop the whole run instead`,
  })

  add({
    id: 'stop-run',
    label: `stop the whole run ${clean(run.name).slice(0, 30)}`,
    proof: 'verified',
    proofText: `verified: TaskStop with the run's TASK id stopped the run and both of its agents mid-tool-call (${AT}). The wf_ run id is answered "No task found", so the task id is read from the session transcript.`,
    spec: !wired || taskId === null ? null : stopSpec(input, taskId, `stop workflow run ${clean(run.name).slice(0, 40)}`, 'The id is the Workflow tool\'s task id for this run, read from the session transcript. A run started by another session is answered "No task found".'),
    why: stopWhy,
  })

  if (!typed.ok) {
    add({ id: 'message', label: 'message the agent', proof: 'verified', proofText: MESSAGE_TEXT, spec: null, why: typed.why })
    add({ id: 'redirect', label: 'redirect: stop, then resume with guidance', proof: 'verified', proofText: REDIRECT_TEXT, spec: null, why: typed.why })

    return out
  }

  const to = agentId
  const messageSpec: ActionSpec | null =
    !wired || to === null
      ? null
      : {
          label: `message agent ${clean(agent?.label ?? to).slice(0, 40)}`,
          args: [],
          shows: messageCall(to, typed.text),
          expect: 'the engine answers that the message was sent to the agent',
          declared: 'write',
          note: `Calls the engine's SendMessage through the session's permission check. Measured (${AT}): to a RUNNING workflow agent's id it lands in that agent's own transcript within milliseconds; the answer says "Resuming agent", and the agent may also show as a background agent. A finished or stopped agent is answered "could not be resumed: No transcript found"; its label is answered "not reachable". Whatever the agent then does (a tool needing approval) raises its own dialog.`,
          run: async () => {
            const verdict = await permissionOf(bridge, 'SendMessage', { to, message: typed.text })

            if (verdict.decision === 'deny') return input.report('message agent', false, `${verdict.text}: nothing was sent and no other route is tried`)

            const outcome = await callTool(bridge, { tool: 'SendMessage', to, message: typed.text, summary: typed.text.slice(0, 40) })

            input.report('message agent', outcome.ok, outcome.ok ? `${outcome.text} (the engine's words; it is delivered while the agent runs, and a finished agent is answered "could not be resumed")` : `${outcome.text}${outcome.kind === 'denied' ? ': nothing was sent and no other route is tried' : ' (use "prepare as text" to ask the main session to relay it)'}`)
          },
        }

  add({ id: 'message', label: agent === null ? 'message the agent' : `message ${clean(agent.label).slice(0, 30)}`, proof: 'verified', proofText: MESSAGE_TEXT, spec: messageSpec, why: !wired ? 'this host does not bind tool calls: prepare the text instead' : agent === null ? 'pick an agent first (the cursor)' : 'that agent\'s id is not one the engine can be given' })

  const redirectSpec: ActionSpec | null =
    !wired || taskId === null || resume === null
      ? null
      : stopSpec(input, taskId, `redirect run ${clean(run.name).slice(0, 36)}: stop, then prepare the resume`, 'Half one of two: the stop. Half two prepares the resume text in your prompt box, only when the stop worked.', async () => {
          const isFilled = await Promise.resolve(bridge.fillPrompt(resume)).catch(() => false)

          return isFilled ? 'The resume text with your guidance is in the prompt box: press Enter there to resume.' : 'There is no prompt box to put the resume text in.'
        })

  add({ id: 'redirect', label: 'redirect: stop, then resume with guidance', proof: 'verified', proofText: REDIRECT_TEXT, spec: redirectSpec === null ? null : { ...redirectSpec, shows: `${stopCall(taskId ?? '')}, then into the prompt box: ${resume?.slice(0, 120) ?? ''}` }, why: stopWhy })

  const prompt = relayText(run, agent, typed.text)

  add({ id: 'text', label: 'prepare as text instead', proof: 'prefill', proofText: 'Nothing is called: the words wait in your prompt box and Claude (the main session) acts on them when you press Enter, under its own permissions.', spec: prefillSpec(input, 'prepare the message for the main session', prompt, 'Text only: it goes to the main Claude session, which would use SendMessage itself.'), why: 'nothing to prepare' })

  return out
}

const MESSAGE_TEXT = `verified: a message to a RUNNING workflow agent's id arrived in that agent's own transcript within ~30 ms and it began to act on it (${AT}). A finished agent: "could not be resumed". Its label: "not reachable".`
const REDIRECT_TEXT = `verified: the stop (as "stop the whole run", ${AT}); the resume is only text prepared in your prompt box, never sent for you.`
