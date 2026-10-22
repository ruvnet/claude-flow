/**
 * What the Workflows page keeps in `State` (ADR-464). A leaf module with type imports only, so state.ts can build the
 * empty value without a cycle: the reading itself is in ./wf-live, the keys in ./wf-actions.
 */
import type { WfRun } from './data/workflows'
import { newWfUi, type WfUi } from './data/workflows-nav'

/** The folder reader's answer with the runs already cleaned (control characters stripped, credentials masked) and the unread transcripts counted. */
export type WfRead = { runs: WfRun[]; root: string | null; capBytes: number; skipped: number; more: number }

export type WfState = {
  /** The last read, or null before the first one finishes. */
  read: WfRead | null
  readAtMs: number
  /** Why the last read failed, in plain words; null when it did not. A failed read keeps the previous runs on screen. */
  error: string | null
  isReading: boolean
  /** Where the cursor is (run, phase, agent, column, whether the inspector is open). */
  ui: WfUi
  /** The inspector's tab: `detail` is the page's own, any other is a registered slot tab (views/wf-slots.ts). */
  tab: string
  /** Each run's state as of the last read, by run id: what a notice is decided against. Null until the first read. */
  seen: Map<string, string> | null
}

export const emptyWf = (): WfState => ({ read: null, readAtMs: 0, error: null, isReading: false, ui: newWfUi(), tab: 'detail', seen: null })
