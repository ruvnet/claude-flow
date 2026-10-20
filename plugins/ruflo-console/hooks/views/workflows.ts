import type { RenderElement } from 'claude-code'

import type { ActionSpec } from '../actions'
import { fmtElapsed, fmtTokens, modelName, currentPhase, type AgentState, type WfAgent, type WfPhase, type WfRun } from '../data/workflows'
import { pick, type WfUi } from '../data/workflows-nav'
import { CONTROL_TAB, controlLine } from '../data/wf-control'
import { spawnAgent, stopAgent } from '../ops'
import { ago, clip, col, kv, row, rule, text, THEME, type Ctx } from './common'
import { flow, runTag } from './wf-layout'
import { slotsFor } from './wf-slots'

/** What the workflows view asks of the controller: a confirm-gated ruflo verb, or to name a transcript's path. */
export type WorkflowsHooks = { ask: (spec: ActionSpec) => void; show: (path: string) => void }

/** The runs as the integrator's reader returned them (`readWorkflowRuns`), with the swarm folded in by `allRuns`. */
export type WorkflowsModel = { runs: readonly WfRun[]; root: string | null; capBytes: number; skipped: number; more: number }

const SPIN = ['◐', '◓', '◑', '◒'] as const

const MARK = (state: AgentState, nowMs: number): string => (state === 'done' ? '✔' : state === 'failed' ? '✖' : state === 'running' ? (SPIN[Math.floor(nowMs / 250) % 4] as string) : state === 'stale' ? '◌' : state === 'idle' ? '●' : '○')
const COLOR = (state: AgentState): string | undefined => (state === 'done' ? THEME.ok : state === 'failed' ? THEME.bad : state === 'running' ? THEME.warn : state === 'idle' ? THEME.info : undefined)

function phaseMark(phase: WfPhase, nowMs: number): { mark: string; color: string | undefined } {
  if (phase.failed > 0) return { mark: '✖', color: THEME.bad }
  if (phase.running > 0) return { mark: SPIN[Math.floor(nowMs / 250) % 4] as string, color: THEME.warn }
  if (phase.total > 0 && phase.done === phase.total) return { mark: '✔', color: THEME.ok }

  return { mark: '○', color: undefined }
}

/** First row drawn so the cursor row is always inside a window of `size` rows (the list scrolls with it). */
const windowStart = (total: number, cursor: number, size: number): number => Math.max(0, Math.min(total - size, cursor - size + 1))

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`

/** The run header: its name and state, then agents running, done and failed, and the tokens the agents' records add up to. */
function header(ctx: Ctx, run: WfRun, runs: readonly WfRun[], at: number): RenderElement[] {
  const tone = run.state === 'failed' ? THEME.bad : run.running > 0 || run.state === 'active' ? THEME.warn : run.state === 'completed' ? THEME.ok : undefined
  const counts = run.kind === 'ruflo-swarm' ? `${run.running} busy · ${run.idle} idle · ${run.done} stopped · ${run.failed} failed` : `${run.running} running · ${run.done} done · ${run.failed} failed`
  // ruflo records no tokens: a swarm run says when its record was written instead (the same words as Overview and Swarm).
  const listed = run.listed !== undefined && run.listed !== run.total ? ` · ${run.listed} listed, ${run.total} found` : ''
  const tokens =
    run.kind !== 'ruflo-swarm'
      ? run.totalTokens === null ? 'tokens n/a' : `${fmtTokens(run.totalTokens, run.isTokensPartial)} tok`
      : run.listed === undefined ? 'agents ruflo recorded that no swarm record lists'
        : `updated ${run.updatedMs === undefined ? 'n/a' : ago(run.updatedMs, ctx.nowMs)}${run.isStale === true ? ' · stale' : ''}${listed}`
  const span = run.durationMs === undefined ? '' : ` · ${fmtElapsed(run.durationMs)}`
  const tabs = runs.length > 1 ? runs.map((entry, i) => `${i === at ? '▸' : ' '}${i + 1} ${clip(entry.name, 18)}`).join('  ') : ''

  return [
    row(ctx, [ctx.kit.Text({ bold: true, wrap: 'truncate-end', children: `${clip(run.name, Math.max(8, ctx.columns - 24))} ` }), ctx.kit.Text({ wrap: 'truncate-end', ...(tone !== undefined && { color: tone }), children: run.state })]),
    text(ctx, `${run.total} agents · ${counts} · ${tokens}${span}`, { dimColor: true }),
    ...(tabs === '' ? [] : [text(ctx, `${tabs}   [ ] switch run`, { dimColor: true })]),
  ]
}

/** Left cell: `❯ ✔ Build  4/4`, the cursor row bold, the run's current phase marked ❯. */
function phaseCell(ctx: Ctx, phase: WfPhase, index: number, flags: { isHere: boolean; isCurrent: boolean; width: number }): RenderElement {
  const { mark, color } = phaseMark(phase, ctx.nowMs)
  const count = `${phase.done}/${phase.total}`
  const title = clip(`${index + 1} ${phase.title}`, Math.max(4, flags.width - count.length - 6))

  return row(ctx, [
    ctx.kit.Text({ ...(flags.isHere && { bold: true }), children: `${flags.isHere ? '▸' : ' '}${flags.isCurrent ? '❯' : ' '}` }),
    ctx.kit.Text({ ...(color !== undefined && { color }), children: `${mark} ` }),
    ctx.kit.Text({ ...(flags.isHere && { bold: true }), children: `${title.padEnd(flags.width - count.length - 6)} ` }),
    ctx.kit.Text({ dimColor: true, children: count }),
  ])
}

/** Right cell: status mark, label, model, worktree badge, tokens, elapsed. A narrow screen drops the model, then the badge. */
function agentCell(ctx: Ctx, agent: WfAgent, isHere: boolean, width: number): RenderElement {
  // A space between the two columns: an age wider than its column ("68d06h", once "1638h18m") ran into "n/a tok".
  const tail = `${`${fmtTokens(agent.tokens, agent.isTokensPartial)} tok`.padStart(10)} ${fmtElapsed(agent.elapsedMs).padStart(6)}`
  const model = agent.ruflo === undefined ? modelName(agent.model).padEnd(11) : ''
  const badge = agent.hasWorktree ? 'worktree '.padEnd(10) : agent.ruflo === undefined ? ' '.repeat(10) : ''
  const fixed = 3 + tail.length + (width >= 62 ? model.length : 0) + (width >= 74 ? badge.length : 0)
  const label = clip(agent.label, Math.max(6, width - fixed - 1))

  return row(ctx, [
    ctx.kit.Text({ ...(COLOR(agent.state) !== undefined && { color: COLOR(agent.state) as string }), children: `${isHere ? '▸' : ' '}${MARK(agent.state, ctx.nowMs)} ` }),
    ctx.kit.Text({ wrap: 'truncate-end', ...(isHere && { bold: true }), children: `${label.padEnd(Math.max(6, width - fixed))}` }),
    ...(width >= 62 && model !== '' ? [ctx.kit.Text({ dimColor: true, children: model })] : []),
    ...(width >= 74 && badge !== '' ? [ctx.kit.Text({ color: THEME.info, children: badge })] : []),
    ctx.kit.Text({ dimColor: true, children: tail }),
  ])
}

/** Everything about one agent that the two columns have no room for, and the verbs that apply to it. */
function inspect(ctx: Ctx, run: WfRun, agent: WfAgent, hooks: WorkflowsHooks): RenderElement[] {
  const rows: RenderElement[] = [rule(ctx, 'Inspect', agent.label)]

  rows.push(kv(ctx, 'agent', `${agent.id} · phase ${agent.phase} · ${agent.state}`))

  if (agent.ruflo !== undefined) {
    const a = agent.ruflo

    rows.push(kv(ctx, 'ruflo agent', `${a.type}${a.name !== undefined ? ` · ${a.name}` : ''} · ${a.status}`))
    rows.push(kv(ctx, 'health / tasks', `${a.health === undefined ? 'n/a' : `${Math.round(a.health * 100)}%`} · ${a.taskCount ?? 'n/a'} tasks`))
    rows.push(kv(ctx, 'model / tokens', 'n/a (ruflo records neither per agent)'))
    rows.push(
      ...flow(ctx, [
        { key: 'wf-stop', label: 'Stop agent', onPress: () => { const spec = stopAgent(a); if (spec !== null) hooks.ask(spec) } },
        { key: 'wf-spawn', label: `Spawn another ${a.type}`, onPress: () => { const spec = spawnAgent(a.type, ctx.nowMs); if (spec !== null) hooks.ask(spec) } },
      ], 'wf-agent-actions'),
    )

    return rows
  }

  rows.push(kv(ctx, 'model', agent.model === undefined ? 'n/a' : `${modelName(agent.model)} (${agent.model})`))
  rows.push(kv(ctx, 'tokens', `${fmtTokens(agent.tokens, agent.isTokensPartial)} context tokens of its latest request${agent.isTokensPartial === true ? ' (tail of the transcript only: a floor)' : ''}`))
  rows.push(kv(ctx, 'elapsed', `${fmtElapsed(agent.elapsedMs)}${Number.isNaN(new Date(agent.startedMs ?? Number.NaN).getTime()) ? '' : ` · started ${new Date(agent.startedMs as number).toISOString().slice(11, 19)}Z`}`))
  rows.push(kv(ctx, 'worktree', agent.hasWorktree ? (agent.worktreePath ?? 'yes') : 'none'))
  if (agent.toolCalls !== undefined) rows.push(kv(ctx, 'tool calls', `${agent.toolCalls}${agent.lastTool === undefined ? '' : ` · last ${agent.lastTool}`}`))
  if (agent.resultPreview !== undefined) rows.push(text(ctx, `result: ${agent.resultPreview}`, { dimColor: true }))

  rows.push(kv(ctx, 'transcript', agent.transcriptPath === undefined ? 'n/a' : clip(agent.transcriptPath, Math.max(20, ctx.columns - 14))))
  if (agent.transcriptPath !== undefined) {
    const path = agent.transcriptPath

    rows.push(...flow(ctx, [{ key: 'wf-open', label: 'Open transcript', onPress: () => hooks.show(path), hotkey: 'o' }], 'wf-open-row'))
  }

  rows.push(text(ctx, run.kind === 'workflow' ? controlLine(slotsFor('tab').some(slot => slot.id === CONTROL_TAB)) : '', { dimColor: true }))

  return rows
}

/**
 * Swarm and workflow management in one page, drawn after Claude Code's /workflows panel: phases down the left with
 * done/total and a ❯ on the current one, that phase's agents on the right, the run header above. Reads only; the one write
 * is the ruflo agents' stop and spawn, each behind the confirm card.
 */
export function workflowsView(ctx: Ctx, model: WorkflowsModel | null, ui: WfUi, hooks: WorkflowsHooks): RenderElement {
  const rows: RenderElement[] = [rule(ctx, 'Workflows', model === null ? '' : `${model.runs.length} runs · j/k move · b/l column · d inspect`)]

  if (model === null) return col(ctx, [...rows, text(ctx, 'reading workflow runs…', { dimColor: true })], 'workflows')

  const here = pick(ui, model.runs)

  if (here.run === null) {
    rows.push(text(ctx, model.root === null ? 'No Claude Code config directory is known here, so no workflow runs can be read.' : `No workflow runs for this project under ${clip(model.root, Math.max(20, ctx.columns - 30))}, and no ruflo swarm yet.`, { color: THEME.warn }))
    rows.push(text(ctx, 'Claude Code writes a run folder when a Workflow script starts; ruflo agents appear once a swarm exists.', { dimColor: true }))

    return col(ctx, rows, 'workflows')
  }

  rows.push(...header(ctx, here.run, model.runs, here.ui.run))

  const run = here.run
  const wide = ctx.columns >= 56
  const left = wide ? Math.min(26, Math.max(18, Math.floor(ctx.columns / 3))) : ctx.columns
  const current = currentPhase(run.phases)
  const right = wide ? Math.max(20, ctx.columns - left - 3) : Math.max(20, ctx.columns - 1)
  const phase = here.phase

  rows.push(rule(ctx, 'Phases', phase === null ? '' : `${phase.title}${phase.detail === undefined ? '' : ` · ${clip(phase.detail, 40)}`}`))

  // Cells are built for the rows that are drawn only: a run can name thousands of agents, and a frame must not scale with them.
  const rowsMax = 14
  const phaseTotal = run.phases.length
  const agentList = phase?.agents ?? []
  const phaseFrom = windowStart(phaseTotal, here.ui.phase, rowsMax)
  const agentFrom = windowStart(agentList.length, here.ui.agent, rowsMax)
  const phases = run.phases.slice(phaseFrom, phaseFrom + rowsMax).map((entry, n) => phaseCell(ctx, entry, phaseFrom + n, { isHere: phaseFrom + n === here.ui.phase && here.ui.column === 'phases', isCurrent: phaseFrom + n === current, width: left }))
  const agents = agentList.slice(agentFrom, agentFrom + rowsMax).map((entry, n) => agentCell(ctx, entry, agentFrom + n === here.ui.agent && here.ui.column === 'agents', right))

  if (run.phases.length === 0) rows.push(text(ctx, 'This run has no agents yet.', { dimColor: true }))
  else if (wide) {
    for (let i = 0; i < Math.max(phases.length, agents.length); i += 1) {
      rows.push(row(ctx, [phases[i] ?? text(ctx, ' '.repeat(left)), ctx.kit.Text({ dimColor: true, children: ' │ ' }), agents[i] ?? text(ctx, ' ')], `wf-${i}`))
    }
  } else {
    rows.push(...phases, ...agents)
  }

  const hidden = Math.max(phaseTotal, agentList.length) - rowsMax

  if (hidden > 0) rows.push(text(ctx, `+${hidden} more (j/k scrolls to them)`, { dimColor: true }))
  if (phase !== null && phase.agents.length === 0) rows.push(text(ctx, 'No agent has started in this phase yet.', { dimColor: true }))

  if (here.ui.isInspecting && here.agent !== null) rows.push(...inspect(ctx, run, here.agent, hooks))

  if (run.kind === 'workflow') {
    rows.push(text(ctx, run.hasRecord ? 'Figures are from the run record Claude Code wrote when it finished.' : `Figures are derived from the journal and transcripts (read up to ${mb(model.capBytes)} each${model.skipped > 0 ? `; ${model.skipped} larger left unread, their tokens n/a` : ''}); ≥ marks a floor.`, { dimColor: true }))
  }

  if (model.more > 0) rows.push(text(ctx, `+${model.more} older runs not shown`, { dimColor: true }))
  if (wide && !here.ui.isInspecting) rows.push(text(ctx, `${runTag(run.id)} · d inspects the agent · u/i switches run`, { dimColor: true }))

  return col(ctx, rows, 'workflows')
}
