/**
 * The Workflows page's one wiring point (ADR-464), kept out of the controller (its 500-line limit): bindings.ts calls
 * `wireWorkflows(state, host)` once, where the state and the built host both exist. It hands each feature the host it cannot get
 * from a slot's environment, and registers what runs after every read of the run folders (views/../wf-live.ts `afterRead`):
 * the mission-event ledger, the saved views, and the cost and guard figures. Every hook is isolated: one that throws leaves the rest.
 */
import type { Host } from './host'
import type { State } from './state'
import { isUnread } from './data/wf-cost'
import type { ExportCost } from './data/wf-export'
import type { WfRun } from './data/workflows'
import { guards, refreshWfGuards } from './wf-cost-live'
import { bindWorkflowDrill } from './wf-drill'
import { afterRead } from './wf-live'
import { syncSavedViews } from './wf-saved-live'
import { recordRunEvents } from './views/wf-guide'
import { setExportCostSource, setExportFs } from './views/wf-export'
import { wireAutopilot } from './ap-live'
import { wireWfAnatole } from './views/wf-anatole'
import { wireWfControl } from './views/wf-control'
import { wireWfConvo } from './views/wf-convo'
import { wireWfTemplates } from './views/wf-templates'
import { wireWfWorktrees } from './views/wf-worktrees'

let isWired = false

/** The export's cost, from the figures the Cost section shows (ADR-462), never a number the page does not hold: an unread run, or one with no priced token, is null (n/a). A floor or an estimate says so in the source words. */
export function exportCostOf(run: WfRun): ExportCost | null {
  const cost = guards.costs.get(run.id)

  if (cost === undefined || isUnread(cost.total) || cost.total.pricedTokens === 0) return null

  const caveats = [cost.total.isFloor || cost.total.unpricedTokens > 0 ? `a floor: ${cost.covered} of ${cost.count} agents read or some tokens unpriced` : '', cost.total.isApprox ? 'rough family price' : ''].filter(Boolean)

  return { usd: cost.total.usd, source: `price-book estimate, not a bill${caveats.length > 0 ? `; ${caveats.join('; ')}` : ''}` }
}

export function wireWorkflows(state: State, host: Host): void {
  bindWorkflowDrill(state, host)
  setExportFs(host.fs)
  setExportCostSource(exportCostOf)
  wireWfWorktrees(state, host)
  wireWfTemplates(state, host)
  wireWfAnatole(state, host)
  wireWfControl(state, host)
  wireWfConvo(state, host, state.options.convoTargets)
  wireAutopilot(state, host, host.toolCheck === undefined ? {} : { toolCheck: (tool: string, input?: unknown) => host.toolCheck!(tool, input ?? {}) })

  if (isWired) return

  isWired = true
  afterRead.push(
    (s, h, before, runs, nowMs) => void recordRunEvents(s, h, before, runs, nowMs),
    (s, h, _before, _runs, nowMs) => syncSavedViews(s, h, nowMs),
    (s, h, _before, _runs, nowMs) => refreshWfGuards(s, h, false, nowMs),
  )
}
