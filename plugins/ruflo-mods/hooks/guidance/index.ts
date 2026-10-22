import { cachedFile, type FileHost } from '../files'
import type { ModOptions } from '../options'
import { under, type ModState } from '../state'
import { finishTask, flushObservations, newRunId, OBSERVATIONS_DIR, type ActiveTask } from './observations'
import { MAX_PROJECTION_BYTES, parseProjection, PROJECTION_PATH, selectGuidance } from './projection'

export type GuidanceHooks = {
  start: () => void
  prompt: (text: string, fs: FileHost) => Promise<string | undefined>
  active: () => ActiveTask | undefined
  check: (task: ActiveTask | undefined, decision: unknown) => void
  tool: (task: ActiveTask | undefined, event: unknown, result: { deny?: unknown; isError?: boolean }) => void
  complete: (turnId: unknown, isAborted?: boolean) => void
  end: () => void
  flush: (fs: { read: (path: string) => Promise<string>; write: (path: string, text: string) => Promise<void> }) => Promise<void>
}

/**
 * Optional feature helpers composed INSIDE the existing hooks. Claude Code
 * permits one unmatched handler per event per plugin. No second tool, prompt,
 * session or turn handler is registered, and no new host capability is added.
 */
export function createGuidance(state: ModState, options: ModOptions): GuidanceHooks | undefined {
  if (!options.guidanceContext && !options.guidanceLearning) return undefined
  const s = state.guidance
  const projection = cachedFile(() => under(state, PROJECTION_PATH), parseProjection)

  return {
    start() {
      if (!s.runId) { s.runId = newRunId(); s.status = 'missing' }
    },
    async prompt(text, fs) {
      if (!s.runId) return undefined
      if (options.guidanceLearning) finishTask(s, 'interrupted')
      const read = await projection({
        stat: async path => {
          const stat = await fs.stat(path)
          if (stat.isLink || stat.size > MAX_PROJECTION_BYTES) throw new Error('invalid guidance file')
          return stat
        },
        read: fs.read,
      })
      s.status = read.kind === 'ok' ? 'ready' : read.kind === 'absent' ? 'missing' : 'unreadable'
      if (read.kind !== 'ok') return undefined
      const selected = selectGuidance(text, read.value)
      if (options.guidanceLearning) {
        s.active = { taskId: ++s.taskSeq, projection: read.value, ruleIds: options.guidanceContext ? selected.ids : [], checks: { allow: 0, ask: 0, deny: 0 }, tools: { ok: 0, error: 0, denied: 0 }, toolIds: new Set(), idsDropped: 0 }
      }
      return options.guidanceContext ? selected.context : undefined
    },
    active: () => s.active,
    check(task, decision) {
      if (task && (decision === 'allow' || decision === 'ask' || decision === 'deny')) task.checks[decision]++
    },
    tool(task, event, result) {
      if (!task) return
      try {
        const id = (event as { tool_use_id?: unknown }).tool_use_id
        if (typeof id === 'string') {
          if (task.toolIds.has(id)) return
          if (task.toolIds.size >= 256) { task.idsDropped++; return }
          task.toolIds.add(id)
        }
        if (result.deny !== undefined) task.tools.denied++
        else if (result.isError === true) task.tools.error++
        else task.tools.ok++
      } catch {
        // Observation failure preserves the underlying tool's settled result.
      }
    },
    complete(turnId, isAborted) {
      if (!options.guidanceLearning || !s.runId) return
      if (typeof turnId === 'string') {
        if (s.seenTurns.has(turnId)) return
        if (s.seenTurns.size < 256) s.seenTurns.add(turnId)
      }
      finishTask(s, isAborted ? 'aborted' : 'completed')
    },
    end() {
      if (options.guidanceLearning && s.runId) finishTask(s, 'interrupted')
    },
    async flush(fs) {
      if (options.guidanceLearning && s.runId) await flushObservations(s, under(state, `${OBSERVATIONS_DIR}/${s.runId}.json`), fs)
    },
  }
}
