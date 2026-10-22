/**
 * The links, nesting, mission-script and guidance parts of the Workflows page (ADR-460), plugged into the page only through its slot
 * registry (views/wf-slots.ts): two boards, two inspector tabs and a notice slot, no hotkeys, no edit of any shared file. Importing this
 * module registers them (the merge owner adds `import './wf-guide'` to views/wf-register.ts). Every number drawn is counted from the
 * records the page already holds; an empty source says so. Every write is an ActionSpec through the page's confirm card.
 */
import type { RenderElement } from 'claude-code'

import { activeMission, mcOf, missionWired, saveLedger } from '../mission-control'
import { cleanText } from '../data/wf-clean'
import { applyMissionEvents, eventsBetween } from '../data/wf-events'
import { guideActions, nestingOf, type GuideAction, type NestKind } from '../data/wf-guide'
import { agentKey, agentLinkLine, linkAgents, refsOf, taskLinkLine, type LinkIndex, type MissionTaskRef } from '../data/wf-links'
import { draftScript, estimateLines, scriptMissionOf, type Draft } from '../data/wf-mission-script'
import type { WfRun } from '../data/workflows'
import type { ActionSpec } from '../actions'
import type { Host } from '../host'
import type { State } from '../state'
import { isRunPath } from '../wf-actions'
import { button, clip, col, kv, row, section, text, THEME, type Ctx } from './common'
import { CONTROL_TAB, controlLine } from '../data/wf-control'
import { registerSlot, slotsFor, type Registered, type SlotEnv } from './wf-slots'

const GLYPH: Record<NestKind, string> = { swarm: '◎', hive: '⬡', queen: '♛', worker: '●', claim: '⚑', task: '▪', note: '·' }
/** The script review shows at most this many lines; the full text is what the launch prepares, and the page says how many it holds. */
export const REVIEW_LINES = 80

/** What the guide tab keeps between frames: the sentence typed. */
const drafts = new WeakMap<State, { text: string }>()
const draftOf = (state: State): { text: string } => {
  let held = drafts.get(state)

  if (held === undefined) {
    held = { text: '' }
    drafts.set(state, held)
  }

  return held
}

/** The link index for this frame: the ledger and the observed missions against every agent the page holds. */
export function indexOf(env: SlotEnv): { index: LinkIndex; refs: MissionTaskRef[] } {
  const state = env.ctx.state
  const refs = refsOf(mcOf(state).missions.values(), state.snapshot?.missions?.missions)

  return { index: linkAgents(refs, env.runs, state.snapshot?.tasks ?? []), refs }
}

/** Puts text in the main session's prompt box and says so on the outcome row; never sends it. */
function prepareIn(state: State, label: string): (text: string) => Promise<void> {
  return async text => {
    const host = missionWired(state)?.host
    const say = (ok: boolean, detail: string) => {
      state.outcome = { label, ok, verified: 'n/a', detail, atMs: Date.now() }
      host?.invalidate()
    }

    if (host === undefined) return say(false, 'the console is not wired to a host here')

    say(await host.fillPrompt(text).catch(() => false), 'prepared in the prompt box: press Enter there to send it')
  }
}

const line = (ctx: Ctx, value: string, props: { color?: string; dimColor?: boolean; bold?: boolean } = {}): RenderElement => text(ctx, cleanText(value), props)

function linksBoard(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const { index, refs } = indexOf(env)
  const rows: RenderElement[] = [line(ctx, `${index.links.length} agent-to-task links · ${index.unlinked.length} agents unlinked · ${refs.length} mission tasks known`, { dimColor: true })]

  if (refs.length === 0) rows.push(line(ctx, 'No mission yet in the ledger or the observation: make one in Mission Control. Agents then link by their ruflo task tags (mission:<id> task:<id>) or by the label tag a drafted script adds.', { dimColor: true }))

  for (const ref of refs.filter(entry => (index.byTask.get(`${entry.missionId}/${entry.taskId}`) ?? []).length > 0).slice(0, 8)) rows.push(line(ctx, ` ${ref.missionId}/${ref.taskId} ${ref.title} -> ${taskLinkLine(index, ref)}`))

  const open = refs.filter(entry => (index.byTask.get(`${entry.missionId}/${entry.taskId}`) ?? []).length === 0).length

  if (refs.length > 0) rows.push(line(ctx, `${open} mission tasks unlinked: no agent names them`, { dimColor: true }))

  const why = [...new Set(index.unlinked.map(entry => entry.why))].slice(0, 2)

  for (const reason of why) rows.push(line(ctx, ` agents unlinked: ${reason}`, { dimColor: true }))

  return rows
}

function nestingBoard(env: SlotEnv): RenderElement[] {
  const { ctx, run } = env
  const snap = ctx.state.snapshot

  if (run === null || run.kind !== 'ruflo-swarm') return [line(ctx, 'Pick the ruflo swarm run ([ ] to switch) to see how its swarm, hive, workers, claims and tasks nest.', { dimColor: true })]

  const rows = nestingOf({ swarm: snap?.swarm ?? null, hive: snap?.hive ?? null, agents: snap?.agents ?? [], hiveAgents: snap?.hiveAgents ?? [], claims: snap?.claims ?? [], tasks: snap?.tasks ?? [] })

  return rows.map(entry => line(ctx, `${'  '.repeat(entry.depth)}${GLYPH[entry.kind]} ${entry.label}  ${entry.detail}`, entry.kind === 'note' ? { dimColor: true } : entry.kind === 'queen' ? { color: THEME.warn } : {}))
}

/** The launch: the reviewed script, handed to the main session behind the confirm card (it writes the file and runs it when the person presses Enter there). */
export function launchSpec(state: State, draft: Extract<Draft, { ok: true }>, missionId: string): ActionSpec {
  const prompt = `Write exactly this script to ${draft.path} (create the folder if it is missing), then run it with Workflow({ name: "${draft.name}" }) and report what it returns.\n\n\`\`\`js\n${draft.source}\`\`\``

  return {
    label: `prepare the workflow for mission ${cleanText(missionId).slice(0, 40)} in the main session`,
    args: [],
    shows: `${draft.path}: ${draft.estimate.agents} agents in ${draft.estimate.levels} levels, ${draft.source.split('\n').length} lines, prepared in the prompt box`,
    expect: 'the script text in the prompt box (it is not sent)',
    note: 'Starts nothing here: the text waits in your prompt box. When you press Enter, Claude writes the file and runs the workflow, and every agent bills as a subagent does. It can be stopped afterwards with the control tab (the engine\'s TaskStop, where that tab is switched on) or from Claude Code\'s Workflows panel.',
    run: () => prepareIn(state, 'workflow script')(prompt),
  }
}

function missionBoard(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const mission = activeMission(ctx.state)

  if (mission === null) return [line(ctx, 'No active mission: create one in Mission Control, and its SPARC plan can be drafted here as a workflow script for review.', { dimColor: true })]

  const draft = draftScript(scriptMissionOf(mission))

  if (!draft.ok) return [line(ctx, `Mission ${mission.id} cannot be drafted: ${draft.why}`, { color: THEME.warn })]

  const lines = draft.source.split('\n')
  const shown = lines.slice(0, REVIEW_LINES)
  const rows: RenderElement[] = [kv(ctx, 'mission', cleanText(`${mission.id} · ${clip(mission.objective, 60)}`)), kv(ctx, 'script', draft.path), ...estimateLines(draft).map(entry => line(ctx, ` ${entry}`, { dimColor: true }))]

  rows.push(...section(ctx, 'wf-script', 'Review the script', `${shown.length} of ${lines.length} lines shown`, shown.map(entry => text(ctx, entry, { dimColor: true })), false))
  if (lines.length > shown.length) rows.push(line(ctx, `${lines.length - shown.length} more lines are not drawn here; the prepared text holds all ${lines.length}.`, { dimColor: true }))
  rows.push(row(ctx, [button(ctx, 'wf-mission-launch', 'Prepare to run as a workflow', () => ctx.act.workflows.ask(launchSpec(ctx.state, draft, mission.id), 'no script to prepare'))], 'wf-mission-run'))

  return rows
}

function missionTab(env: SlotEnv): RenderElement[] {
  const { ctx, run, agent } = env

  if (run === null || agent === null) return [line(ctx, 'Pick an agent first.', { dimColor: true })]

  const { index } = indexOf(env)
  const mine = index.byAgent.get(agentKey(run.id, agent.id)) ?? []

  return [
    kv(ctx, 'agent', cleanText(agent.label)),
    kv(ctx, 'mission task', agentLinkLine(index, run.id, agent.id), mine.length === 0 ? THEME.warn : undefined),
    ...mine.slice(0, 6).map(link => line(ctx, ` ${link.missionId}/${link.taskId} ${link.title} · via ${link.via === 'ruflo-task' ? 'a ruflo task assigned to it' : 'its label tag'}${link.taskStatus === undefined ? '' : ` · task ${link.taskStatus}`}`, { dimColor: true })),
  ]
}

function guideRows(ctx: Ctx, actions: readonly GuideAction[], run: WfRun): RenderElement[] {
  const rows: RenderElement[] = []

  for (const action of actions) {
    rows.push(button(ctx, `wf-guide-${action.id}`, action.label, () => ctx.act.workflows.ask(action.spec, action.why)))
    rows.push(line(ctx, `   sends: ${action.sends}`, { dimColor: true }))
    if (action.acts !== '') rows.push(line(ctx, `   acts: ${action.acts}`, { dimColor: true }))
  }

  rows.push(line(ctx, run.kind === 'workflow' ? `${controlLine(slotsFor('tab').some(slot => slot.id === CONTROL_TAB))} The note here is found by a memory search; the redirect here is text for the main session.` : 'ruflo agents are not interrupted by any of these: each writes a record that an agent sees when it reads that store.', { dimColor: true }))

  return rows
}

function guideTab(env: SlotEnv): RenderElement[] {
  const { ctx, run, agent } = env

  if (run === null) return [line(ctx, 'No run picked.', { dimColor: true })]

  const draft = draftOf(ctx.state)
  const snap = ctx.state.snapshot
  const field = ctx.kit.Input === undefined ? line(ctx, 'this surface has no text field: the guide needs one', { dimColor: true }) : ctx.kit.Input({ key: 'wf-guide-text', label: 'guidance', placeholder: 'what the agents should know or do differently', submitLabel: 'set', onSubmit: value => { draft.text = value; ctx.act.workflows.setUi({}) } })
  const actions = guideActions({ text: draft.text, run, agent, hive: snap?.hive ?? null, agents: snap?.agents ?? [], claims: snap?.claims ?? [], tasks: snap?.tasks ?? [], nowMs: env.nowMs, prepare: prepareIn(ctx.state, 'redirect'), isRunPath: path => isRunPath(path, ctx.state.configDir) })

  return [field, line(ctx, draft.text === '' ? 'guidance: none typed yet' : `guidance: ${draft.text}`, { color: draft.text === '' ? undefined : THEME.info }), col(ctx, guideRows(ctx, actions, run), 'wf-guide-actions')]
}

/**
 * For the merge owner, after a read: records the mission events the change between two reads raised into the ledger, once each, and
 * saves it. Returns how many were recorded. It lives here, not in the notice slot, because only this side holds the state and host.
 */
export function recordRunEvents(state: State, host: Host, before: readonly WfRun[] | null, next: readonly WfRun[], nowMs: number): number {
  const added = applyMissionEvents(mcOf(state).missions, eventsBetween(before, next).mission, nowMs)

  if (added > 0) saveLedger(state, host)

  return added
}

/** Registers this feature's slots. A refusal comes back as a reason (the registry never throws), so a clash is visible to the test. */
export function registerGuide(): Registered[] {
  return [
    registerSlot({ kind: 'board', id: 'links', title: 'Mission links', order: 30, render: linksBoard }),
    registerSlot({ kind: 'board', id: 'nesting', title: 'Swarm nesting', order: 40, render: nestingBoard }),
    registerSlot({ kind: 'board', id: 'mission-run', title: 'Run a mission as a workflow', order: 50, render: missionBoard }),
    registerSlot({ kind: 'tab', id: 'mission', label: 'mission', when: env => env.agent !== null, render: missionTab }),
    registerSlot({ kind: 'tab', id: 'guide', label: 'guide', when: env => env.run !== null, render: guideTab }),
    registerSlot({ kind: 'notice', id: 'links', between: (prev, next) => eventsBetween(prev, next).notices }),
  ]
}

registerGuide()
