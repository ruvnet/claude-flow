/** Public ruOS run observations. This is advisory data, never authority to launch, stop or approve a process. */
import { idOf, jsonObject, msOf, plain, recordOf } from './parse'

export const RUOS_CONTRACT = 'ruflo.ruos-observation/1'
export const RUOS_MAX_BYTES = 128_000
export const RUOS_MAX_RUNS = 50
export const RUOS_STALE_MS = 5 * 60_000
export const RUOS_STATES = ['starting', 'running', 'stopping', 'disconnected', 'unknown', 'completed', 'failed', 'stopped'] as const
export type RemoteState = (typeof RUOS_STATES)[number]
export type RemoteRun = {
  runId: string
  agentId: string
  desktopId: string
  jobId: string | null
  jobs: 'exec-poll' | 'jobs-api'
  state: RemoteState
  connection: 'healthy' | 'disconnected' | 'unknown'
  revision: number
  nextOffset: number
  startedAtMs: number | null
  updatedAtMs: number | null
  binding: { missionId?: string; missionRevision?: number; worktree?: string; commit?: string; sourceDigest?: string } | null
  bindingDigest?: string
  exitCode?: number | null
}
export type RuosObservation = { observedAtMs: number | null; isTruncated: boolean; runs: RemoteRun[] }
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const digest = (value: unknown): string | undefined => typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/i.test(value) ? value : undefined
const commit = (value: unknown): string | undefined => typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value) ? value : undefined

/** Bounded and strict on identity. Duplicate ids are all omitted rather than choosing one process's facts. */
export function parseRuos(text: string | null): RuosObservation | null {
  if (text === null || text.length > RUOS_MAX_BYTES) return null
  const root = jsonObject(text)
  if (root?.contract !== RUOS_CONTRACT || root.schemaVersion !== 1 || !Array.isArray(root.runs)) return null
  const ids = new Map<string, number>()
  for (const value of root.runs) {
    const id = idOf(recordOf(value)?.runId)
    if (id !== null) ids.set(id, (ids.get(id) ?? 0) + 1)
  }
  const runs: RemoteRun[] = root.runs.slice(0, RUOS_MAX_RUNS).flatMap(raw => {
    const value = recordOf(raw)
    const runId = idOf(value?.runId)
    const agentId = idOf(value?.agentId)
    const desktopId = idOf(value?.desktopId)
    if (value === null || runId === null || ids.get(runId) !== 1 || agentId === null || desktopId === null || !uint(value.revision) || !uint(value.nextOffset)) return []
    if (value.jobs !== 'exec-poll' && value.jobs !== 'jobs-api') return []
    const jobId = value.jobId === null ? null : idOf(value.jobId)
    if (value.jobId !== null && jobId === null) return []
    const binding = recordOf(value.binding)
    const missionId = idOf(binding?.missionId)
    const sourceCommit = commit(binding?.commit)
    const sourceDigest = digest(binding?.sourceDigest)
    const bindingDigest = digest(value.bindingDigest)
    const worktree = plain(binding?.worktree, 300)
    const out: RemoteRun = {
      runId, agentId, desktopId, jobId, jobs: value.jobs,
      state: RUOS_STATES.includes(value.state as RemoteState) ? value.state as RemoteState : 'unknown',
      connection: value.connection === 'healthy' || value.connection === 'disconnected' ? value.connection : 'unknown',
      revision: value.revision, nextOffset: value.nextOffset,
      startedAtMs: msOf(value.startedAt) ?? null, updatedAtMs: msOf(value.updatedAt) ?? null,
      binding: binding === null ? null : {
        ...(missionId !== null && { missionId }),
        ...(uint(binding.missionRevision) && { missionRevision: binding.missionRevision }),
        ...(worktree !== '' && { worktree }),
        ...(sourceCommit !== undefined && { commit: sourceCommit }),
        ...(sourceDigest !== undefined && { sourceDigest }),
      },
      ...(bindingDigest !== undefined && { bindingDigest }),
      ...(value.exitCode === null || (typeof value.exitCode === 'number' && Number.isSafeInteger(value.exitCode)) ? { exitCode: value.exitCode } : {}),
    }
    return [out]
  })
  return { observedAtMs: msOf(root.observedAt) ?? null, isTruncated: root.truncated === true || root.runs.length > RUOS_MAX_RUNS, runs }
}

export const remoteTerminal = (run: RemoteRun): boolean => run.state === 'completed' || run.state === 'failed' || run.state === 'stopped'

/** Never renew freshness on a redraw. A disconnected transport says nothing about whether the remote job stopped. */
export function reconcileReason(run: RemoteRun, observation: RuosObservation, nowMs: number): string | null {
  if (remoteTerminal(run)) return null
  if (run.state === 'disconnected' || run.connection === 'disconnected') return 'connection lost; the remote process may still be running'
  if (run.state === 'unknown' || run.connection === 'unknown' || run.jobId === null) return 'remote process identity, connection or state is unresolved'
  if ([run.updatedAtMs, observation.observedAtMs].some(at => at === null || at <= 0 || at > nowMs + 60_000)) return 'observation time is unknown'
  if (nowMs - Math.min(run.updatedAtMs as number, observation.observedAtMs as number) > RUOS_STALE_MS) return 'remote observation is stale; reconcile before retrying'
  return null
}
