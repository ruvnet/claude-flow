/**
 * Replay on the Workflows page (ADR-461): a board slot that scrubs the picked run back and forth through its agents' start and end
 * moments and draws the board as it stood at each step (data/wf-replay.ts). Importing this module registers it AND the three
 * other slots of the feature (compare, export, saved views), so the merge owner adds one line to views/wf-register.ts:
 *
 *   import './wf-replay'
 *
 * The replay reads run files; it cannot rewind a run, so it replays what the files say happened and nothing else (stopping or messaging a live run is the control tab's, ADR-465, on the run itself).
 */
import type { RenderElement } from 'claude-code'

import { boardAt, buildTimeline, describeStep, isPlaying, newReplay, offsetOf, settle, SPEEDS, stepNow, stepReplay, type ReplayCommand, type ReplayUi, type Timeline } from '../data/wf-replay'
import { fmtElapsed, fmtTokens, type WfAgent, type WfRun } from '../data/workflows'
import { button, clip, row, text, THEME, type Ctx } from './common'
import { fold, redraw } from './wf-fold'
import { flow, safe } from './wf-layout'
import { registerSlot, type SlotEnv } from './wf-slots'
import './wf-compare'
import './wf-export'
import './wf-saved'

const replays = new Map<string, ReplayUi>()
const timelines = new Map<string, { sig: string; tl: Timeline }>()
const MAX_RUNS_KEPT = 12

/** The timeline of a run, rebuilt only when the run's own figures changed (a live run grows; a finished one never does). */
export function timelineOf(run: WfRun): Timeline {
  const sig = `${run.state}|${run.total}|${run.done}|${run.failed}|${run.running}|${run.durationMs ?? ''}`
  const kept = timelines.get(run.id)

  if (kept?.sig === sig) return kept.tl

  const tl = buildTimeline(run)

  timelines.delete(run.id)
  timelines.set(run.id, { sig, tl })
  if (timelines.size > MAX_RUNS_KEPT) timelines.delete(timelines.keys().next().value as string)

  return tl
}

export const replayOf = (runId: string): ReplayUi => replays.get(runId) ?? newReplay()

/** Applies one command to a run's replay and keeps the result. Exported so the buttons and a test share it. */
export function applyReplay(run: WfRun, command: ReplayCommand, nowMs: number): ReplayUi {
  const next = stepReplay(replayOf(run.id), timelineOf(run), command, nowMs)

  replays.delete(run.id)
  replays.set(run.id, next)
  if (replays.size > MAX_RUNS_KEPT) replays.delete(replays.keys().next().value as string)

  return next
}

/** How often a playing replay advances and redraws, on the console's clock. */
export const TICK_MS = 400

/**
 * One tick of a playing replay: brings it up to `nowMs` (bounded: data/wf-replay.ts `settle`) and says whether it is still playing. False for a
 * paused, finished or unknown replay, which ends its timer.
 */
export function replayTick(run: WfRun, nowMs: number): boolean {
  const ui = replays.get(run.id)

  if (ui === undefined || ui.playFromMs === null) return false

  const next = settle(ui, timelineOf(run), nowMs)

  replays.set(run.id, next)

  return next.playFromMs !== null
}

/** Starts the replay's clock for a run while it plays (one timer per run; asking again is harmless). Needs the page's `tick` action, which a surface without a clock lacks: then it advances on each redraw as it always did. */
const startTick = (ctx: Ctx, run: WfRun): void => ctx.act.workflows.tick?.(`replay-${run.id}`, TICK_MS, () => replayTick(run, Date.now()))

/** For tests. */
export const resetReplays = (): void => (replays.clear(), timelines.clear())

const MARK: Record<WfAgent['state'], string> = { done: '✔', failed: '✖', running: '◐', stale: '◌', idle: '●', queued: '○' }
const COLOR = (state: WfAgent['state']): string | undefined => (state === 'done' ? THEME.ok : state === 'failed' ? THEME.bad : state === 'running' ? THEME.warn : undefined)

const clock = (ms: number): string => `+${fmtElapsed(ms)}`

function bar(fraction: number, width: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)

  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

/** The replayed board in rows: each phase with its counts, its agents beneath, capped so a frame never scales with the run. */
function boardRows(ctx: Ctx, board: WfRun): RenderElement[] {
  const rows: RenderElement[] = []
  const budget = 22
  let used = 0

  for (const phase of board.phases) {
    if (used >= budget) break

    const mark = phase.failed > 0 ? '✖' : phase.total > 0 && phase.done === phase.total ? '✔' : phase.running > 0 ? '◐' : '○'

    rows.push(text(ctx, ` ${mark} ${phase.title}  ${phase.done}/${phase.total}${phase.running > 0 ? ` · ${phase.running} running` : ''}`, { bold: true, ...(phase.failed > 0 ? { color: THEME.bad } : {}) }))
    used += 1

    for (const agent of phase.agents) {
      if (used >= budget) break

      const color = COLOR(agent.state)

      rows.push(text(ctx, `   ${MARK[agent.state]} ${clip(agent.label, Math.max(8, ctx.columns - 34)).padEnd(Math.max(8, Math.min(30, ctx.columns - 34)))} ${agent.state.padEnd(7)} ${fmtTokens(agent.tokens, agent.isTokensPartial).padStart(8)} ${fmtElapsed(agent.elapsedMs).padStart(7)}`, color === undefined ? { dimColor: agent.state === 'queued' } : { color }))
      used += 1
    }
  }

  const hidden = board.phases.reduce((sum, phase) => sum + 1 + phase.agents.length, 0) - used

  if (hidden > 0) rows.push(text(ctx, ` +${hidden} more rows not drawn (the export holds all of them)`, { dimColor: true }))

  return rows
}

export function replayBody(env: SlotEnv, run: WfRun): RenderElement[] {
  const { ctx, nowMs } = env
  const tl = timelineOf(run)

  if (tl.why !== null) return [text(ctx, ` ${tl.why}`, { dimColor: true })]

  const ui = replayOf(run.id)
  const step = stepNow(ui, tl, nowMs)
  const n = tl.events.length
  const playing = isPlaying(ui, tl, nowMs)
  const board = boardAt(run, tl, step)
  const go = (command: ReplayCommand) => () => {
    const next = applyReplay(run, command, Date.now())

    if (next.playFromMs !== null) startTick(ctx, run)
    redraw(ctx)
  }

  // A replay that is playing when the page is drawn (the person left it and came back) gets its clock again.
  if (playing) startTick(ctx, run)
  const span = tl.t1 - tl.t0

  return [
    text(ctx, ` step ${step}/${n} · ${clock(offsetOf(tl, step))} of ${clock(span)} · ${ui.speed}x · ${playing ? '▶ playing' : step >= n ? '■ at the end' : '⏸ paused'}`),
    text(ctx, ` ${bar(span === 0 ? (step >= n ? 1 : 0) : offsetOf(tl, step) / span, Math.max(10, Math.min(48, ctx.columns - 6)))}`, { dimColor: true }),
    text(ctx, ` ▸ ${clip(describeStep(tl, step), Math.max(10, ctx.columns - 6))}`, { color: THEME.info }),
    ...flow(ctx, [
      { key: 'wf-rp-first', label: '⏮', onPress: go('first') },
      { key: 'wf-rp-pphase', label: '◂◂ phase', onPress: go('prev-phase') },
      { key: 'wf-rp-prev', label: '◂ step', onPress: go('prev') },
      { key: 'wf-rp-play', label: playing ? '⏸ pause' : '▶ play', onPress: go('play'), primary: true },
      { key: 'wf-rp-next', label: 'step ▸', onPress: go('next') },
      { key: 'wf-rp-nphase', label: 'phase ▸▸', onPress: go('next-phase') },
      { key: 'wf-rp-last', label: '⏭', onPress: go('last') },
    ], 'wf-rp-controls'),
    row(ctx, [text(ctx, ' speed '), button(ctx, 'wf-rp-slower', '−', safe(go('slower'))), text(ctx, ` ${ui.speed}x `), button(ctx, 'wf-rp-faster', '+', safe(go('faster'))), ...(ctx.columns >= 64 ? [text(ctx, ` of ${SPEEDS.join(' · ')}`, { dimColor: true })] : [])], 'wf-rp-speed'),
    ...boardRows(ctx, board),
    ...(tl.untimed.length > 0 ? [text(ctx, ` ${tl.untimed.length} agent${tl.untimed.length === 1 ? '' : 's'} left off: no start time (or no span) in the run's files, so there is no moment to place ${tl.untimed.length === 1 ? 'it' : 'them'} at`, { color: THEME.warn })] : []),
    text(ctx, step >= n ? ' This is the run\'s real final board.' : ' Tokens show n/a until an agent ends: only its final figure is recorded. A running agent\'s time is measured to this step.', { dimColor: true }),
    text(ctx, ' This replay cannot rewind a run; stop or message one from its control tab.', { dimColor: true }),
  ]
}

registerSlot({
  kind: 'board',
  id: 'replay',
  title: 'Replay',
  order: 40,
  render: env => {
    const run = env.run

    if (run === null) return []
    if (run.kind !== 'workflow') return [text(env.ctx, ' Replay is for Claude Code workflow runs: the ruflo swarm is a live roster with no history to step through.', { dimColor: true })]

    const tl = timelineOf(run)

    return fold(env.ctx, 'replay', tl.why ?? `${tl.events.length} moments in ${fmtElapsed(tl.t1 - tl.t0)}: scrub back and forth, jump by phase, play at up to ${SPEEDS[SPEEDS.length - 1]}x`, () => replayBody(env, run))
  },
})
