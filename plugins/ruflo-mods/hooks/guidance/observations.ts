import { isMissing } from '../files'
import type { GuidanceProjection } from './projection'

export type Observation = {
  version: 1
  kind: 'guidance-observation'
  id: string
  runId: string
  taskId: number
  bundleId: string
  sourceRevision: string
  ruleIds: string[]
  checks: { allow: number; ask: number; deny: number }
  tools: { ok: number; error: number; denied: number }
  completion: 'completed' | 'aborted' | 'interrupted'
  verified: false
  learningEligible: false
}

export type ActiveTask = {
  taskId: number
  projection: GuidanceProjection
  ruleIds: string[]
  checks: Observation['checks']
  tools: Observation['tools']
  toolIds: Set<string>
  idsDropped: number
}

export type GuidanceState = {
  runId: string
  taskSeq: number
  active?: ActiveTask
  seenTurns: Set<string>
  pending: Observation[]
  saved: number
  dropped: number
  idsDropped: number
  status: 'off' | 'ready' | 'missing' | 'unreadable'
  flush: Promise<void>
}

export const OBSERVATIONS_DIR = '.claude-flow/mods/guidance/observations'
export const MAX_OBSERVATIONS = 128
export const MAX_QUEUE_CHARS = 256 * 1024

export const guidanceState = (): GuidanceState => ({ runId: '', taskSeq: 0, seenTurns: new Set(), pending: [], saved: 0, dropped: 0, idsDropped: 0, status: 'off', flush: Promise.resolve() })

/** A storage namespace, never an authenticated host session identity. */
export const newRunId = () => `mod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`

const KEYS = ['version', 'kind', 'id', 'runId', 'taskId', 'bundleId', 'sourceRevision', 'ruleIds', 'checks', 'tools', 'completion', 'verified', 'learningEligible']
const counts = (value: Record<string, unknown>, names: string[]) => value && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(k => Number.isSafeInteger(value[k]) && Number(value[k]) >= 0 && Number(value[k]) <= 100000)

/** Same strict allowlist as the external CLI consumer, without host imports. */
export function validObservation(r: Observation): boolean {
  return !!r && Object.keys(r).length === KEYS.length && Object.keys(r).every(k => KEYS.includes(k)) &&
    r.version === 1 && r.kind === 'guidance-observation' && /^mod-[a-z0-9]+-[a-z0-9]{1,12}-[a-z0-9]{1,12}$/.test(r.runId ?? '') &&
    Number.isSafeInteger(r.taskId) && r.taskId > 0 && r.id === `${r.runId}:${r.taskId}` &&
    /^[a-f0-9]{64}$/.test(r.bundleId ?? '') && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(r.sourceRevision ?? '') &&
    Array.isArray(r.ruleIds) && r.ruleIds.length <= 5 && new Set(r.ruleIds).size === r.ruleIds.length && r.ruleIds.every(id => typeof id === 'string' && /^[A-Z]{1,58}-?\d{3,4}$/.test(id)) &&
    counts(r.checks, ['allow', 'ask', 'deny']) && counts(r.tools, ['ok', 'error', 'denied']) &&
    ['completed', 'aborted', 'interrupted'].includes(r.completion) && r.verified === false && r.learningEligible === false
}

export function finishTask(s: GuidanceState, completion: Observation['completion']): void {
  const active = s.active
  s.active = undefined
  if (!active) return
  s.idsDropped += active.idsDropped
  if (s.pending.length + s.saved >= MAX_OBSERVATIONS) { s.dropped++; return }
  s.pending.push({
    version: 1, kind: 'guidance-observation', id: `${s.runId}:${active.taskId}`, runId: s.runId, taskId: active.taskId,
    bundleId: active.projection.bundleId, sourceRevision: active.projection.sourceRevision, ruleIds: [...active.ruleIds],
    checks: { ...active.checks }, tools: { ...active.tools }, completion, verified: false, learningEligible: false,
  })
}

/**
 * One file per registration lifetime prevents cross-process read/write races.
 * Same-process flushes serialize. Corrupt/unreadable existing bytes are never
 * replaced. Native fs.write has no atomic append: a crash can still lose this
 * registration's observations; none are accepted learning evidence.
 */
export function flushObservations(s: GuidanceState, path: string, fs: { read: (path: string) => Promise<string>; write: (path: string, text: string) => Promise<void> }): Promise<void> {
  s.flush = s.flush.then(async () => {
    if (!s.pending.length) return
    let previous: Observation[] = []
    let existing: string | undefined
    try {
      existing = await fs.read(path)
    } catch (error) {
      // Only the read can say "no queue yet"; a parse error can quote the file's own text.
      if (!isMissing(error, path)) return
    }
    if (existing !== undefined) {
      if (existing.length > MAX_QUEUE_CHARS) return
      let parsed: unknown
      try {
        parsed = JSON.parse(existing)
      } catch {
        return
      }
      if (!Array.isArray(parsed) || parsed.length > MAX_OBSERVATIONS || parsed.some(r => !validObservation(r) || r.runId !== s.runId) || new Set(parsed.map(r => r.id)).size !== parsed.length) return
      previous = parsed
    }
    const ids = new Set(previous.map(r => r.id))
    const additions = s.pending.filter(r => !ids.has(r.id))
    const records = [...previous, ...additions]
    const text = `${JSON.stringify(records)}\n`
    if (records.length > MAX_OBSERVATIONS || text.length > MAX_QUEUE_CHARS) return
    try {
      await fs.write(path, text)
      s.pending = s.pending.filter(r => !records.some(saved => saved.id === r.id))
      s.saved = records.length
    } catch {
      // Keep pending for the next lifecycle flush; no raw error/path is logged.
    }
  }).catch(() => undefined)
  return s.flush
}
