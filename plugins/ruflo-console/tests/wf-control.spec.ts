/**
 * Stop, Message and Redirect (ADR-465, measured in ADR-471): the exact engine call on the card, the engine's permission respected, the REAL
 * answers of an interactive Claude Code (tests/fixtures/control-real.ts) classified, and every failure said as itself. Fake bridges only. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-control.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import type { ToolReply } from '../hooks/host'
import { callTool, classifyReply, controlActions, ENGINE_ID, permissionOf, relayText, resumeText, taskIdOf, transcriptOf, type Bridge, type ControlAction, type ControlInput, type TaskRef } from '../hooks/data/wf-control'
import { LAUNCH_LINE, REAL, WF } from './fixtures/control-real'
import type { WfAgent, WfRun } from '../hooks/data/workflows'

const AGENT = 'acf991387298086c7'
const RUN = 'wf_abc12345'
const TASK = 'wyp2n5acy'

const agent = (over: Partial<WfAgent> = {}): WfAgent => ({ id: AGENT, label: 'sleeper', phase: 'Build', state: 'running', hasWorktree: false, ...over })
const run = (over: Partial<WfRun> = {}): WfRun => ({ id: RUN, name: 'my flow', kind: 'workflow', state: 'running', phases: [{ title: 'Build', agents: [agent()], done: 0, total: 1, running: 1, failed: 0 }], running: 1, done: 0, failed: 0, idle: 0, total: 1, totalTokens: null, isTokensPartial: false, hasRecord: false, dir: '/home/u/.claude/projects/-p/sess/subagents/workflows/wf_abc12345', ...over })

type Calls = { tool: Record<string, unknown>[]; check: { tool: string; input: unknown }[]; fill: string[]; said: { label: string; ok: boolean; detail: string }[] }

function harness(over: { reply?: ToolReply | ((input: Record<string, unknown>) => ToolReply); verdict?: 'allow' | 'ask' | 'deny'; task?: TaskRef; reject?: string; noTool?: boolean; fill?: boolean; text?: string; agent?: WfAgent | null; run?: WfRun } = {}): { input: ControlInput; calls: Calls } {
  const calls: Calls = { tool: [], check: [], fill: [], said: [] }
  const reply = over.reply ?? { text: JSON.stringify({ message: 'Successfully stopped task: acf991387298086c7 (sleeper)', task_type: 'local_agent' }) }
  const bridge: Bridge & { fillPrompt: (text: string) => Promise<boolean> } = {
    ...(over.noTool === true ? {} : { toolCall: async (input: Record<string, unknown> & { tool: string }) => { calls.tool.push(input); if (over.reject !== undefined) throw new Error(over.reject); return typeof reply === 'function' ? reply(input) : reply } }),
    toolCheck: async (tool, input) => { calls.check.push({ tool, input }); return { decision: over.verdict ?? 'allow', ...(over.verdict === 'deny' && { reason: 'Bash(*) is denied' }) } },
    fillPrompt: async text => { calls.fill.push(text); return over.fill ?? true },
  }

  return { calls, input: { task: over.task ?? { id: TASK }, run: over.run ?? run(), agent: over.agent === undefined ? agent() : over.agent, text: over.text ?? '', bridge, report: (label, ok, detail) => calls.said.push({ label, ok, detail }), isRunPath: path => path.startsWith('/home/u/.claude/projects/') && !path.includes('..') } }
}

const by = (actions: ControlAction[], id: string): ControlAction => actions.find(action => action.id === id) as ControlAction

describe('classifyReply: the engine\'s own words, as an interactive session answered them (ADR-471)', () => {
  it('reads every real TaskStop answer: the workflow task stops; the run id, an agent of the run and another session\'s task are "No task found", with no tag wrapper', () => {
    expect(classifyReply(REAL.stopWorkflowTask as never)).toMatchObject({ ok: true, kind: 'done', text: expect.stringContaining('Successfully stopped task: wyp2n5acy') })
    expect(classifyReply(REAL.stopUnnamedBackgroundAgent as never)).toMatchObject({ ok: true, kind: 'done' })
    expect(classifyReply(REAL.stopNamedAgentByTeammateId as never)).toMatchObject({ ok: true, kind: 'done' })

    for (const miss of [REAL.stopWorkflowRunId, REAL.stopWorkflowAgent, REAL.stopNamedAgentById, REAL.stopTaskOfAnotherSession]) {
      const outcome = classifyReply(miss as never)

      expect(outcome).toMatchObject({ ok: false, kind: 'error', text: expect.stringContaining('No task found with ID') })
      expect(outcome.text).not.toContain('<tool_use_error>')
    }
  })

  it('reads every real SendMessage answer: delivered, inbox, queued for the next turn, a refusal by label, a finished agent, a peer session', () => {
    expect(classifyReply(REAL.messageRunningWorkflowAgent as never)).toMatchObject({ ok: true, text: 'Resuming agent af95708' })
    expect(classifyReply(REAL.messageNamedTeammateByName as never)).toMatchObject({ ok: true, text: "Message sent to sleeper's inbox" })
    expect(classifyReply(REAL.messageRunningTeammateById as never)).toMatchObject({ ok: true, text: expect.stringContaining('queued your message for its next turn') })
    expect(classifyReply(REAL.messagePeerSession as never)).toMatchObject({ ok: true, text: expect.stringContaining('in that session') })
    expect(classifyReply(REAL.messageWorkflowAgentByLabel as never)).toMatchObject({ ok: false, kind: 'error', text: expect.stringContaining("No agent named 'wa' is reachable") })
    expect(classifyReply(REAL.messageFinishedWorkflowAgent as never)).toMatchObject({ ok: false, kind: 'error', text: expect.stringContaining('could not be resumed: No transcript found') })
  })

  it('the real dialog answers: a refused Write is a deny (nothing written), an accepted Bash is its output', () => {
    expect(classifyReply(REAL.writeRefusedInDialog as never)).toMatchObject({ ok: false, kind: 'denied', text: expect.stringContaining('the engine refused it') })
    expect(classifyReply(REAL.bashAcceptedInDialog as never)).toMatchObject({ ok: true, kind: 'done' })
  })

  it('a deny is a refusal, not an error; a missing bridge says so; nothing is invented for an empty answer', () => {
    expect(classifyReply({ deny: 'Permission to use TaskStop has been denied' })).toMatchObject({ ok: false, kind: 'denied', text: expect.stringContaining('the engine refused it') })
    expect(classifyReply(undefined)).toMatchObject({ ok: false, kind: 'not-wired' })
    expect(classifyReply({})).toMatchObject({ ok: true, text: 'the engine answered ok with no text' })
  })

  it('masks a credential and strips escapes from what the engine said', () => {
    const said = classifyReply({ text: 'failed \u001b[31mred\u001b[0m token=sk-live-AAAABBBBCCCCDDDD', isError: true }).text

    expect(said).not.toContain('sk-live')
    expect(said).not.toContain('\u001b')
  })

  it('callTool turns a rejection into an error outcome and never throws', async () => {
    const { input } = harness({ reject: 'no such tool' })

    expect(await callTool(input.bridge, { tool: 'Nope' })).toMatchObject({ ok: false, kind: 'error', text: 'no such tool' })
    expect(await callTool({}, { tool: 'TaskStop' })).toMatchObject({ kind: 'not-wired' })
  })

  it('permissionOf reports the engine\'s verdict, and says so when it cannot ask', async () => {
    expect((await permissionOf(harness({ verdict: 'deny' }).input.bridge, 'TaskStop', {})).text).toContain('deny (Bash(*) is denied)')
    expect(await permissionOf({}, 'TaskStop', {})).toMatchObject({ decision: 'unknown' })
  })
})

describe('Stop: the whole run by its TASK id; one workflow agent cannot be stopped', () => {
  it('shows the exact call with the task id, runs it through the host after the permission check, and reports the engine\'s own words', async () => {
    const { input, calls } = harness({ reply: REAL.stopWorkflowTask as never })
    const stop = by(controlActions(input), 'stop-run')

    expect(stop.proof).toBe('verified')
    expect(stop.proofText).toMatch(/^verified: TaskStop with the run's TASK id stopped the run and both of its agents.*Claude Code 2\.1\.289, 2026-10-06/)
    expect(stop.call).toBe(`TaskStop {"task_id":"${TASK}"}`)
    expect(stop.spec?.declared).toBe('write')
    expect(calls.tool).toHaveLength(0)

    await stop.spec?.run?.()

    expect(calls.check).toEqual([{ tool: 'TaskStop', input: { task_id: TASK } }])
    expect(calls.tool).toEqual([{ tool: 'TaskStop', task_id: TASK }])
    expect(calls.said).toEqual([expect.objectContaining({ ok: true, detail: expect.stringContaining('Successfully stopped task: wyp2n5acy') })])
    expect(calls.said[0]?.detail).toContain('re-read the run')
  })

  it('never passes the wf_ run id or an agent id to TaskStop (the engine answers "No task found" for both: measured)', async () => {
    const { input, calls } = harness({ reply: REAL.stopWorkflowTask as never })

    for (const action of controlActions(input)) await action.spec?.run?.()

    expect(calls.tool.filter(call => call.tool === 'TaskStop').every(call => call.task_id === TASK)).toBe(true)
    expect(JSON.stringify(calls.tool)).not.toContain(RUN)
    expect(JSON.stringify(calls.tool)).not.toContain(AGENT)
  })

  it('stopping one agent does not work: no spec, and the engine\'s real refusal is on the row', () => {
    const stop = by(controlActions(harness().input), 'stop-agent')

    expect(stop.proof).toBe('does-not-work')
    expect(stop.spec).toBeNull()
    expect(stop.proofText).toMatch(/does not work.*No task found with ID: acf991387298086c7.*2\.1\.289/)
    expect(stop.why).toMatch(/cannot stop one workflow agent/)
    expect(REAL.stopWorkflowAgent?.text).toContain('No task found with ID')
  })

  it('an engine "deny" from the permission check stops it before any call: no other route is tried', async () => {
    const { input, calls } = harness({ verdict: 'deny' })

    await by(controlActions(input), 'stop-run').spec?.run?.()

    expect(calls.tool).toHaveLength(0)
    expect(calls.said[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/permission check: deny.*no other route is tried/) })
  })

  it('a deny answered by the call itself is shown the same way; a task the engine does not know is shown as its error', async () => {
    const denied = harness({ reply: { deny: 'Claude requested permissions to stop which is blocked' } })

    await by(controlActions(denied.input), 'stop-run').spec?.run?.()
    expect(denied.calls.said[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/engine refused it.*no other route/) })

    const missing = harness({ reply: REAL.stopTaskOfAnotherSession as never })

    await by(controlActions(missing.input), 'stop-run').spec?.run?.()
    expect(missing.calls.said[0]).toMatchObject({ ok: false, detail: expect.stringContaining('No task found with ID: wyp2n5acy') })
  })

  it('with no task id there is no stop spec and the reason says why (reading it, not in the transcript); no tool bridge says so too', () => {
    const none = controlActions(harness({ task: { why: 'this run\'s task id is not in the session transcript' } }).input)

    expect(by(none, 'stop-run').spec).toBeNull()
    expect(by(none, 'stop-run').why).toMatch(/not in the session transcript/)
    expect(by(none, 'redirect').spec).toBeNull()
    expect(by(controlActions(harness({ noTool: true }).input), 'stop-run').why).toMatch(/does not bind tool calls/)
    expect(by(controlActions(harness({ task: { id: 'a b;rm' } }).input), 'stop-run').spec).toBeNull()
    expect(ENGINE_ID.test('a1')).toBe(false)
  })
})

describe('the run\'s task id comes from the session transcript', () => {
  it('reads the real Workflow launch result: the task id beside the run id', () => {
    expect(taskIdOf(`{"x":1}\n${LAUNCH_LINE}\n{"y":2}`, WF.runId)).toBe(WF.taskId)
    expect(taskIdOf(LAUNCH_LINE, 'wf_other-run')).toBeNull()
    expect(taskIdOf('', WF.runId)).toBeNull()
  })

  it('a RESUMED run has two launches under one run id: the last task id is the live one (measured: same runId, new taskId)', () => {
    const resumed = LAUNCH_LINE.replace('wyp2n5acy', 'wekh7caqa')

    expect(taskIdOf(`${LAUNCH_LINE}\n{"other":1}\n${resumed}`, WF.runId)).toBe('wekh7caqa')
    expect(taskIdOf(`${resumed}\n${LAUNCH_LINE}`, WF.runId)).toBe(WF.taskId)
  })

  it('refuses a run id that is not a run id (it is put in a pattern), and a task id that is not letters and digits', () => {
    expect(taskIdOf(LAUNCH_LINE, 'wf_.*')).toBeNull()
    expect(taskIdOf(LAUNCH_LINE, 'x"|"')).toBeNull()
    expect(taskIdOf(LAUNCH_LINE.replace('wyp2n5acy', 'a b;rm -rf'), WF.runId)).toBeNull()
  })

  it('finds the launching transcript from the run directory, and only inside the projects folder', () => {
    const ok = (path: string): boolean => path.startsWith('/home/u/.claude/projects/')

    expect(transcriptOf({ dir: '/home/u/.claude/projects/-p/sess-1/subagents/workflows/wf_abc12345' }, ok)).toBe('/home/u/.claude/projects/-p/sess-1.jsonl')
    expect(transcriptOf({ dir: '/etc/subagents/workflows/wf_abc12345' }, ok)).toBeNull()
    expect(transcriptOf({ dir: '/home/u/.claude/projects/-p/elsewhere' }, ok)).toBeNull()
    expect(transcriptOf({}, ok)).toBeNull()
  })
})

describe('Message', () => {
  it('needs the typed sentence, then shows the exact SendMessage, labelled verified with what was measured', async () => {
    expect(by(controlActions(harness().input), 'message').spec).toBeNull()
    expect(by(controlActions(harness().input), 'message').why).toMatch(/type the guidance/)

    const { input, calls } = harness({ text: 'use the cache', reply: REAL.messageRunningWorkflowAgent as never })
    const message = by(controlActions(input), 'message')

    expect(message.proof).toBe('verified')
    expect(message.proofText).toMatch(/^verified: a message to a RUNNING workflow agent's id arrived in that agent's own transcript.*2\.1\.289.*could not be resumed.*not reachable/)
    expect(message.call).toBe(`SendMessage {"to":"${AGENT}","message":"use the cache"}`)
    await message.spec?.run?.()
    expect(calls.tool).toEqual([{ tool: 'SendMessage', to: AGENT, message: 'use the cache', summary: 'use the cache' }])
    expect(calls.said[0]).toMatchObject({ ok: true, detail: expect.stringMatching(/Resuming agent af95708.*could not be resumed/) })
  })

  it('a finished agent and an agent named by its label are errors that offer the prompt-box text, not successes', async () => {
    for (const real of [REAL.messageFinishedWorkflowAgent, REAL.messageWorkflowAgentByLabel]) {
      const { input, calls } = harness({ text: 'hello', reply: real as never })

      await by(controlActions(input), 'message').spec?.run?.()
      expect(calls.said[0]).toMatchObject({ ok: false, detail: expect.stringContaining('prepare as text') })
    }
  })

  it('a text with a credential in it, or a leading dash, is not sent at all', () => {
    expect(by(controlActions(harness({ text: 'use token=sk-live-AAAABBBBCCCCDDDD' }).input), 'message').why).toMatch(/credential/)
    expect(by(controlActions(harness({ text: '--force' }).input), 'message').why).toMatch(/dash/)
  })

  it('the prompt-box prefill calls nothing and fills the relay text, saying the main session acts on it', async () => {
    const { input, calls } = harness({ text: 'use the cache' })
    const text = by(controlActions(input), 'text')

    expect(text.proof).toBe('prefill')
    await text.spec?.run?.()
    expect(calls.tool).toHaveLength(0)
    expect(calls.fill).toEqual([relayText(run(), agent(), 'use the cache')])
    expect(calls.fill[0]).toContain('with SendMessage')
    expect(calls.said[0]).toMatchObject({ ok: true, detail: expect.stringContaining('press Enter') })
  })
})

describe('Redirect: two halves, said as two', () => {
  it('stops the run, then prepares the resume text with the guidance; the card shows both', async () => {
    const { input, calls } = harness({ text: 'prefer the cache' })
    const redirect = by(controlActions(input), 'redirect')

    expect(redirect.call).toContain(`TaskStop {"task_id":"${TASK}"}, then into the prompt box`)
    expect(redirect.proofText).toMatch(/^verified: the stop.*the resume is only text prepared in your prompt box/)
    expect(redirect.spec?.note).toMatch(/only when the stop worked/)
    await redirect.spec?.run?.()
    expect(calls.tool).toEqual([{ tool: 'TaskStop', task_id: TASK }])
    expect(calls.fill).toHaveLength(1)
    expect(calls.fill[0]).toContain(`resumeFromRunId: "${RUN}"`)
    expect(calls.fill[0]).toContain('prefer the cache')
    expect(calls.fill[0]).toContain('/home/u/.claude/projects/-p/sess/workflows/scripts/my flow-wf_abc12345.js')
    expect(calls.said[0]).toMatchObject({ ok: true, detail: expect.stringContaining('press Enter there to resume') })
  })

  it('when the stop fails the resume text is NOT prepared (a resume against a live run would fight it)', async () => {
    const { input, calls } = harness({ text: 'x y', reply: REAL.stopWorkflowRunId as never })

    await by(controlActions(input), 'redirect').spec?.run?.()
    expect(calls.fill).toHaveLength(0)
    expect(calls.said[0]?.ok).toBe(false)
  })

  it('resumeText refuses a run dir outside the projects folder (it names the scripts folder generically instead)', () => {
    expect(resumeText(run({ dir: '/etc/../x' }), null, 'g', () => false)).toContain('<session>/workflows/scripts')
    expect(resumeText(run({ id: 'a b' }), null, 'g', () => true)).toBeNull()
  })
})

describe('a ruflo swarm run', () => {
  it('has no Claude task to stop or message: the page says where its own verbs are, and offers no spec', () => {
    const actions = controlActions(harness({ run: run({ kind: 'ruflo-swarm' }) }).input)

    expect(actions).toHaveLength(1)
    expect(actions[0]?.spec).toBeNull()
    expect(actions[0]?.proofText).toMatch(/not a Claude Code task/)
  })
})
