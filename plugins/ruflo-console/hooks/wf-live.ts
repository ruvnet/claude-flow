/**
 * The Workflows page's refresh (ADR-464), kept out of the controller: it reads Claude Code's run folders through the host's
 * read-only `fs` only while the page is the one in front, once per refresh tick (the controller's own cadence, the pane's
 * `refreshSeconds`), and never while the pane is closed or hidden. A read still running is joined, not stacked. A failed
 * read keeps the runs already on screen and says why. After a read the notice slots are asked what changed (views/wf-slots.ts),
 * and the page itself announces a run that finished or failed, from the change between two reads only: the first read announces nothing.
 */
import { cleanRun, cleanText } from './data/wf-clean'
import { readWorkflowRuns, type WorkflowFs } from './data/workflows-read'
import { allRuns, startOn } from './data/workflows-nav'
import type { WfRun } from './data/workflows'
import { plain } from './data/parse'
import type { Host } from './host'
import { addNotice, type NoticeDraft } from './notices'
import type { State } from './state'
import { slotsFor } from './views/wf-slots'
import type { WorkflowsModel } from './views/workflows'

/** What runs after each successful read, registered once by hooks/wf-wire.ts (a module that needs this one cannot be imported here). */
export type AfterRead = (state: State, host: Host, before: readonly WfRun[] | null, runs: readonly WfRun[], nowMs: number) => void | Promise<void>
export const afterRead: AfterRead[] = []

/** The notices one read raises: a workflow run that ended since the last read (finished, or failed), seen against each run's earlier state. */
export function runNotices(prev: ReadonlyMap<string, string> | null, next: readonly WfRun[]): NoticeDraft[] {
  if (prev === null) return []

  const out: NoticeDraft[] = []

  for (const run of next) {
    const before = prev.get(run.id)

    if (before === undefined || before === run.state) continue
    if (run.state === 'completed' || run.state === 'finished') out.push({ level: 'ok', text: `workflow ${run.name} finished: ${run.done}/${run.total} agents`, key: `wf-${run.id}-done`, go: 'workflows' })
    else if (run.state === 'failed') out.push({ level: 'bad', text: `workflow ${run.name} failed: ${run.failed} of ${run.total} agents`, key: `wf-${run.id}-failed`, go: 'workflows' })
  }

  return out
}

/** The page's model for this frame: the read runs with the ruflo swarm folded in; null before the first read finishes. */
export function workflowsModelOf(state: State, nowMs: number): WorkflowsModel | null {
  const read = state.wf.read

  if (read === null) return null

  return { runs: allRuns(read.runs, state.snapshot?.swarm ?? null, state.snapshot?.agents ?? [], nowMs), root: read.root, capBytes: read.capBytes, skipped: read.skipped, more: read.more }
}

/**
 * Reads the runs now if the page is in front and the pane is shown (or there is no pane, as in a dump). `force` skips the
 * pane check for the open of the page itself. Resolves when the read is done or was not needed.
 */
export async function refreshWorkflows(state: State, host: Host, force = false, nowMs: number = Date.now()): Promise<void> {
  if (state.view !== 'workflows' || state.wf.isReading) return
  if (!force && state.isInteractive && !(state.pane.isOpen && state.pane.isShown)) return

  const wf = state.wf

  wf.isReading = true

  try {
    const result = await readWorkflowRuns(host.fs as WorkflowFs, state.cache, { configDir: state.configDir, cwd: state.cwd, nowMs })
    const runs = result.runs.map(cleanRun)
    const first = wf.read === null
    const prev = wf.seen
    const before = wf.read?.runs ?? null

    wf.read = { runs, root: result.root, capBytes: result.capBytes, skipped: result.skipped.length, more: result.more }
    wf.readAtMs = nowMs
    wf.error = null
    wf.seen = new Map(runs.map(run => [run.id, run.state]))

    // The cursor starts on the phase the first run is in; later reads leave it where the person put it.
    if (first) wf.ui = startOn(wf.ui, allRuns(runs, state.snapshot?.swarm ?? null, state.snapshot?.agents ?? [], nowMs)[0] ?? null)

    for (const draft of runNotices(prev, runs)) addNotice(state, draft, nowMs)

    for (const slot of slotsFor('notice')) {
      try {
        for (const draft of slot.between(before, runs, nowMs)) addNotice(state, { ...draft, text: cleanText(draft.text), key: `${slot.id}:${plain(draft.key, 40)}` }, nowMs)
      } catch {
        // A slot that throws raises nothing; the page still reads.
      }
    }

    for (const hook of afterRead) {
      try {
        await hook(state, host, before, runs, nowMs)
      } catch {
        // A hook that throws loses its own work only.
      }
    }
  } catch (error) {
    wf.error = cleanText(plain(error instanceof Error ? error.message : String(error), 100)) || 'the read was refused'
  } finally {
    wf.isReading = false
    host.invalidate()
  }
}
