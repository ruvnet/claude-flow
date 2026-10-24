/** Read-only remote run cards. These are persistent jobs linked to missions, not the mission execution scheduler. */
import type { RenderElement } from 'claude-code'
import { reconcileReason, type RemoteRun } from '../data/ruos'
import { ago, button, paragraph, rule, text, THEME, type Ctx } from './common'

export function remoteRunRows(ctx: Ctx): RenderElement[] {
  const observation = ctx.state.snapshot?.ruos
  if (observation == null || observation.runs.length === 0) return []
  const needs = (run: RemoteRun) => reconcileReason(run, observation, ctx.nowMs)
  const runs = [...observation.runs].sort((a, b) => Number(needs(b) !== null) - Number(needs(a) !== null) || (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0))
  const rows: RenderElement[] = [
    rule(ctx, 'Remote runs', `${runs.length}${observation.isTruncated ? '+' : ''} · observed ${ago(observation.observedAtMs, ctx.nowMs)}`),
    ...paragraph(ctx, 'Persistent ruOS jobs, linked to mission records when a binding exists. A disconnected client does not mean the remote process stopped.', { dimColor: true }),
  ]
  for (const run of runs.slice(0, 8)) {
    const reason = needs(run)
    rows.push(...paragraph(ctx, `${reason === null ? run.state === 'completed' ? '✓' : '○' : '?'} ${run.runId} · recorded ${run.state} · rev ${run.revision}`, { bold: true, color: reason !== null ? THEME.warn : run.state === 'failed' ? THEME.bad : THEME.info }))
    rows.push(...paragraph(ctx, `connection ${run.connection} · desktop ${run.desktopId} · job ${run.jobId ?? 'unresolved'} · replay offset ${run.nextOffset} · seen ${ago(run.updatedAtMs, ctx.nowMs)}`, { dimColor: true }, '  '))
    if (reason !== null) rows.push(...paragraph(ctx, `Reconcile: ${reason}. Attach to the existing run before considering a retry.`, { color: THEME.warn }, '  '))
    if (run.binding?.missionId !== undefined) rows.push(...paragraph(ctx, `mission ${run.binding.missionId}${run.binding.missionRevision === undefined ? '' : ` · mission rev ${run.binding.missionRevision}`}`, { dimColor: true }, '  '))
    if (run.binding?.worktree !== undefined) rows.push(...paragraph(ctx, `worktree ${run.binding.worktree}`, { dimColor: true }, '  '))
    if (run.binding?.commit !== undefined) rows.push(...paragraph(ctx, `commit ${run.binding.commit}`, { dimColor: true }, '  '))
    if (run.binding?.sourceDigest !== undefined) rows.push(...paragraph(ctx, `source ${run.binding.sourceDigest}`, { dimColor: true }, '  '))
  }
  if (runs.length > 8) rows.push(text(ctx, `${runs.length - 8} more remote runs in the Room.`, { dimColor: true }))
  if (!ctx.state.isStandalone) rows.push(button(ctx, 'remote-runs-room', 'inspect remote runs in the Room', () => ctx.act.view('room')))
  rows.push(...paragraph(ctx, 'Observation only. Viewing or preparing an attach never launches work or authorizes a stop. Session-bound missions retain their existing execution gates.', { dimColor: true }))
  return rows
}
