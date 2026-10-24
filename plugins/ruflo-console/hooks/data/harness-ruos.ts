/** Remote run rows join the existing Ruflo adapter without claiming to be the mission scheduler. */
import { repoOf, type SessionRow } from './harness'
import { reconcileReason, type RuosObservation } from './ruos'

export function ruosRows(observation: RuosObservation | null | undefined, cwd: string, nowMs: number): SessionRow[] {
  if (observation == null) return []
  return observation.runs.map(run => {
    const reason = reconcileReason(run, observation, nowMs)
    const workspace = run.binding?.worktree ?? null
    const location = workspace === null ? { repo: cwd, worktree: null } : repoOf(workspace)
    const status = reason !== null ? 'unknown' : run.state === 'completed' ? 'done' : run.state === 'failed' ? 'failed' : run.state === 'stopped' ? 'idle' : 'working'
    const updatedMs = run.updatedAtMs !== null && run.updatedAtMs <= nowMs + 60_000 ? run.updatedAtMs : 0
    return {
      key: `ruflo:ruos:run-${run.runId}`, harness: 'ruflo', home: 'ruos', nativeId: run.runId,
      title: `ruOS remote run ${run.runId}`, status, cwd: workspace, folder: 'remote runs', ...location, branch: null,
      mission: run.binding?.missionId ?? null, updatedMs, size: 0, unassigned: null, stale: reason, external: false,
      cost: { label: 'unavailable', note: 'the remote observation records no spend' },
      signals: { question: false, approval: false, failed: run.state === 'failed', turnEndedAtMs: run.state === 'completed' && updatedMs > 0 ? updatedMs : null, ...(reason !== null && { reconcile: reason }) },
      context: [
        `remote run: ${run.state} · connection ${run.connection} · desktop ${run.desktopId} · job ${run.jobId ?? 'unresolved'}`,
        `revision ${run.revision} · replay offset ${run.nextOffset} · ${run.jobs}`,
        ...(run.binding?.missionId === undefined ? [] : [`mission ${run.binding.missionId}${run.binding.missionRevision === undefined ? '' : ` at revision ${run.binding.missionRevision}`}; linked remote job, not mission scheduler execution`]),
        ...(run.binding?.commit === undefined ? [] : [`commit ${run.binding.commit}`]),
        ...(run.binding?.sourceDigest === undefined ? [] : [`source ${run.binding.sourceDigest}`]),
      ],
      preview: { latest: reason === null ? `remote run ${run.state}${run.exitCode == null ? '' : ` · exit ${run.exitCode}`}` : `${reason}. Attach to the existing run; do not launch a replacement.`, tool: null, files: [], test: null },
      noPreview: null,
    } satisfies SessionRow
  })
}
