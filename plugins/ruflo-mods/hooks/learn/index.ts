import type { EngineInterface, On } from 'claude-code'

import { isMissing } from '../files'
import type { GuidanceHooks } from '../guidance'
import { redraw, under, type ModState } from '../state'
import { appendRecords, EDIT_TOOLS, editedFile, MAX_LINES, PENDING_PATH, rufloSessionId, SESSION_PATH } from './insights'

/** Written early once this many edits wait, so a long turn holds little. */
const FLUSH_AT = 50

/**
 * Writes the waiting edit records to pending-insights.jsonl. A file that
 * exists but cannot be read is never overwritten: the records wait (capped)
 * and the classic consolidator's file stays as it was.
 */
export async function flushEdits($: EngineInterface, state: ModState): Promise<void> {
  if (state.edits.length === 0) return
  const records = state.edits.splice(0)
  try {
    const session = await $.fs.read(under(state, SESSION_PATH)).catch(() => undefined)
    const sessionId = rufloSessionId(session)
    const existing = await $.fs.read(under(state, PENDING_PATH)).catch((error: unknown) => {
      if (isMissing(error)) return ''
      throw error
    })
    await $.fs.write(under(state, PENDING_PATH), appendRecords(existing, records.map(r => ({ ...r, sessionId }))))
  } catch (error) {
    state.edits.unshift(...records)
    state.edits.splice(0, Math.max(0, state.edits.length - MAX_LINES))
    try {
      $.ui.log(`ruflo mods: edit records not written yet (${String((error as Error)?.message ?? error)})`, { to: 'debug' })
    } catch {
      // nothing more to do: the records wait for the next turn
    }
  }
}

/**
 * `tool.call` on the edit tools: hook-handler.cjs `post-edit` in-process,
 * recording each finished edit (a failed one with `success: false`, ADR-174;
 * a denied one never ran, as PostToolUse never fires for it). Written per
 * turn at `turn.complete`, and at `session.end`.
 */
export function registerLearn(on: On, state: ModState, guidance?: GuidanceHooks) {
  on('tool.call', async ($, e, next) => {
    const task = guidance?.active()
    const result = await next(e)
    guidance?.tool(task, e, result)
    if (!state.owned.has('post-edit') || !EDIT_TOOLS.has(e.tool) || result.deny !== undefined) return result

    state.edits.push({
      type: 'edit',
      file: editedFile(e),
      success: result.isError !== true,
      timestamp: Date.now(),
      sessionId: null,
    })
    state.editCount++
    redraw(state)
    if (state.edits.length >= FLUSH_AT) await flushEdits($, state)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (guidance) {
      guidance.complete(e.turnId, e.isAborted)
      await guidance.flush({ read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text) })
    }
    await flushEdits($, state)
    return result
  })

  on('session.end', async ($, e, next) => {
    if (guidance) {
      guidance.end()
      await guidance.flush({ read: path => $.fs.read(path), write: (path, text) => $.fs.write(path, text) })
    }
    await flushEdits($, state)
    return next(e)
  })
}
